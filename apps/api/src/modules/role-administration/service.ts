import { createHash, randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { z } from "zod";

import type { ActorRef } from "../application-access/types.js";
import type { TokenExchanger } from "../governance/token-exchange.js";
import type { HubSessionRecord } from "../hub-auth/repository.js";
import { ChannelUnavailableError, type ChannelRequest, type ChannelResponse, type RoleAdministrationChannel } from "./channel.js";

/**
 * HUB-IMPL-023 §1.1 (K-5): the actor assertion is an exchanged token issued by `sq-hub` through
 * the OPTIONAL client scope `role-administration.actor`, whose audience mapper adds
 * `hcis-role-administration-actor`. The scope is named explicitly because Keycloak's `audience`
 * parameter only filters.
 */
export const ACTOR_ASSERTION_AUDIENCE = "hcis-role-administration-actor";
export const ACTOR_ASSERTION_SCOPE = "role-administration.actor";

const catalogSchema = z.object({
  roles: z.array(
    z.object({
      roleId: z.string().uuid(),
      roleKey: z.string().min(1).max(120),
      name: z.string().min(1).max(255),
      description: z.string().max(2000).nullable(),
      permissions: z.array(z.string().min(1).max(200)).max(500),
      allowedScopes: z.array(z.string().min(1).max(40)).max(10),
      mandateRequired: z.boolean(),
    }),
  ).max(500),
});

export type HcisRoleCatalog = z.infer<typeof catalogSchema>;

const createdSchema = z.object({ assignmentId: z.string().uuid(), requestId: z.string().uuid() });

export interface RoleGrantInput {
  accountId: string;
  requestId: string;
  roleId: string;
  scopeType: "own" | "unit" | "organization";
  organizationalUnitId: string | null;
  reason: string | null;
  startsOn: string | null;
  endsOn: string | null;
}

/**
 * HCIS answers the Hub forwards by code (spec §2 table). Anything else is reported as a channel
 * error without its body, so an unexpected HCIS payload never reaches the browser.
 */
const DOMAIN_CODES = new Set([
  "ROLE_DELEGATION_FORBIDDEN",
  "ROLE_IDENTITY_PERMISSION_FORBIDDEN",
  "ROLE_GRANT_ACTOR_INVALID",
  "ROLE_ADMIN_ACTOR_UNRESOLVED",
  "HCIS_ACCESS_DENIED",
]);
const CONFLICT_CODES = new Set(["ROLE_ADMIN_REQUEST_REPLAYED", "ROLE_ADMIN_ACTOR_ASSERTION_SPENT"]);
const UNAVAILABLE_CODES = new Set(["ROLE_ADMIN_CHANNEL_DISABLED", "APPLICATION_ACCESS_UNAVAILABLE"]);

export class RoleAdministrationError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    /** HCIS's own explanation, forwarded only for domain refusals (e.g. self-grant, AC 3). */
    public readonly detail?: string,
  ) {
    super(code);
    this.name = "RoleAdministrationError";
  }
}

export interface RoleAdministrationLogEntry {
  event: "role_administration.exchange" | "role_administration.channel";
  operation: "catalog" | "grant" | "revoke";
  status?: number | "exchange_failed" | "unavailable" | "timeout";
}

export interface RoleAdministrationAudit {
  record(entry: {
    actor: ActorRef;
    action: "hcis_role.assignment.create" | "hcis_role.assignment.remove";
    targetType: "hcis_account" | "hcis_role_assignment";
    targetRef: string;
    outcome: "succeeded" | "failed";
    payload: Record<string, string | null>;
  }): Promise<void>;
}

type Operation = RoleAdministrationLogEntry["operation"];

/**
 * HUB-IMPL-023. The Hub carries a Platform Administrator's command to HCIS; HCIS owns the roles,
 * their rules and their audit.
 *
 * H-0 is the first statement of every public method: the caller must be an active Platform
 * Administrator, and the check runs before any user token is refreshed or exchanged. A refusal
 * after the exchange would mean an assertion had already been issued for someone without the
 * right, valid until it expires. HCIS does not check authority on this channel at all (AUTH-014
 * §2.5), so this is the only authority check that exists.
 */
export class RoleAdministrationService {
  private readonly timeoutMs: number;

  constructor(
    private readonly deps: {
      /** PlatformAdminService.authorize — throws for anyone who is not an active Platform Administrator. */
      authorize: (session: HubSessionRecord) => Promise<void>;
      /** The user's current Hub access token; the subject token of the exchange. */
      userAccessToken: (sessionToken: string | null) => Promise<string>;
      exchanger: TokenExchanger;
      /** Absent until the machine client is configured; H-0 still runs first. */
      channel?: RoleAdministrationChannel;
      audit?: RoleAdministrationAudit;
      log?: (entry: RoleAdministrationLogEntry) => void;
      timeoutMs?: number;
    },
  ) {
    this.timeoutMs = deps.timeoutMs ?? 10_000;
  }

  get configured(): boolean {
    return Boolean(this.deps.channel);
  }

  async catalog(session: HubSessionRecord, sessionToken: string | null): Promise<HcisRoleCatalog> {
    await this.deps.authorize(session);
    const response = await this.call("catalog", sessionToken, { method: "GET", path: "catalog" });
    if (response.status !== 200) throw this.refusal(response);
    const parsed = catalogSchema.safeParse(response.body);
    if (!parsed.success) throw new RoleAdministrationError(502, "ROLE_ADMIN_CHANNEL_ERROR");
    return parsed.data;
  }

  async grant(session: HubSessionRecord, sessionToken: string | null, input: RoleGrantInput): Promise<{ assignmentId: string; requestId: string }> {
    await this.deps.authorize(session);
    const { accountId, requestId, ...rest } = input;
    const outcome = await this.audited(
      session,
      { action: "hcis_role.assignment.create", targetType: "hcis_account", targetRef: `hcis-account:${accountId}` },
      { requestId, roleId: input.roleId, scopeType: input.scopeType },
      async () => {
        // The actor never travels in the body (spec §2 H-2); HCIS answers 400 if it does.
        const response = await this.call("grant", sessionToken, {
          method: "POST",
          path: `accounts/${encodeURIComponent(accountId)}/role-assignments`,
          body: { requestId, ...rest },
        });
        if (response.status !== 201) throw this.refusal(response);
        const created = createdSchema.safeParse(response.body);
        if (!created.success) throw new RoleAdministrationError(502, "ROLE_ADMIN_CHANNEL_ERROR");
        return created.data;
      },
    );
    return outcome;
  }

  async revoke(session: HubSessionRecord, sessionToken: string | null, input: { assignmentId: string; requestId: string }): Promise<void> {
    await this.deps.authorize(session);
    await this.audited(
      session,
      { action: "hcis_role.assignment.remove", targetType: "hcis_role_assignment", targetRef: `hcis-role-assignment:${input.assignmentId}` },
      { requestId: input.requestId },
      async () => {
        // H-2b: the requestId travels in the body of a DELETE; success is 204 without a body.
        const response = await this.call("revoke", sessionToken, {
          method: "DELETE",
          path: `role-assignments/${encodeURIComponent(input.assignmentId)}`,
          body: { requestId: input.requestId },
        });
        if (response.status !== 204) throw this.refusal(response);
      },
    );
  }

  /**
   * One HCIS call. The machine token is fetched first, then the assertion is exchanged
   * immediately before the request that spends it (H-2c: HCIS limits its age from `iat`). An
   * assertion is never reused: when HCIS reports it spent, a new one is exchanged once for the
   * same requestId (AC 4) — safe, because HCIS refuses a second assignment for one requestId.
   */
  private async call(operation: Operation, sessionToken: string | null, request: ChannelRequest): Promise<ChannelResponse> {
    const channel = this.deps.channel;
    if (!channel) throw new RoleAdministrationError(503, "ROLE_ADMIN_CHANNEL_NOT_CONFIGURED");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const machineToken = await channel.machineToken(controller.signal);
      const subjectToken = await this.deps.userAccessToken(sessionToken);
      for (let attempt = 0; ; attempt += 1) {
        const actorAssertion = await this.exchange(operation, subjectToken, controller.signal);
        const response = await channel.send(request, { machineToken, actorAssertion }, controller.signal);
        this.deps.log?.({ event: "role_administration.channel", operation, status: response.status });
        if (attempt === 0 && operation !== "catalog" && errorCode(response) === "ROLE_ADMIN_ACTOR_ASSERTION_SPENT") continue;
        return response;
      }
    } catch (error) {
      if (error instanceof ChannelUnavailableError) {
        this.deps.log?.({ event: "role_administration.channel", operation, status: controller.signal.aborted ? "timeout" : "unavailable" });
        throw new RoleAdministrationError(503, "ROLE_ADMIN_CHANNEL_UNAVAILABLE");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async exchange(operation: Operation, subjectToken: string, signal: AbortSignal): Promise<string> {
    // Recorded before the request leaves, so a log without this line proves no exchange was tried.
    this.deps.log?.({ event: "role_administration.exchange", operation });
    try {
      return await this.deps.exchanger.exchange(subjectToken, { audience: ACTOR_ASSERTION_AUDIENCE, scope: ACTOR_ASSERTION_SCOPE }, signal);
    } catch {
      this.deps.log?.({ event: "role_administration.exchange", operation, status: "exchange_failed" });
      // Fail closed: there is no other route to HCIS (AGENTS.md §5).
      throw new RoleAdministrationError(502, "ROLE_ADMIN_ACTOR_EXCHANGE_FAILED");
    }
  }

  private refusal(response: ChannelResponse): RoleAdministrationError {
    const code = errorCode(response);
    if (code && UNAVAILABLE_CODES.has(code)) return new RoleAdministrationError(503, code);
    if (code && CONFLICT_CODES.has(code)) return new RoleAdministrationError(409, code);
    if (code && DOMAIN_CODES.has(code)) return new RoleAdministrationError(422, code, errorMessage(response));
    if (response.status === 400 && code === "INVALID_REQUEST") return new RoleAdministrationError(422, "ROLE_ADMIN_INVALID_REQUEST");
    // 401/403 FORBIDDEN_CLIENT, an invalid assertion, or anything unexpected: configuration, not the operator.
    return new RoleAdministrationError(502, "ROLE_ADMIN_CHANNEL_ERROR");
  }

  /** Hub-side record of each attempted change, keyed by the same requestId HCIS audits (AUTH-014 H-5). */
  private async audited<T>(
    session: HubSessionRecord,
    target: { action: "hcis_role.assignment.create" | "hcis_role.assignment.remove"; targetType: "hcis_account" | "hcis_role_assignment"; targetRef: string },
    payload: Record<string, string | null>,
    run: () => Promise<T>,
  ): Promise<T> {
    let result: T;
    try {
      result = await run();
    } catch (error) {
      await this.writeAudit(session, target, "failed", {
        ...payload,
        hcisCode: error instanceof RoleAdministrationError ? error.code : "ROLE_ADMIN_CHANNEL_ERROR",
      });
      throw error;
    }
    const assignmentId = (result as { assignmentId?: string } | undefined)?.assignmentId;
    await this.writeAudit(session, target, "succeeded", { ...payload, ...(assignmentId ? { assignmentId } : {}) });
    return result;
  }

  private async writeAudit(
    session: HubSessionRecord,
    target: { action: "hcis_role.assignment.create" | "hcis_role.assignment.remove"; targetType: "hcis_account" | "hcis_role_assignment"; targetRef: string },
    outcome: "succeeded" | "failed",
    payload: Record<string, string | null>,
  ) {
    if (!this.deps.audit) return;
    try {
      await this.deps.audit.record({ actor: actorForSession(session), ...target, outcome, payload });
    } catch {
      // HCIS holds the authoritative audit; a missing Hub row must not turn a done grant into an error.
    }
  }
}

function errorCode(response: ChannelResponse): string | null {
  const code = (response.body as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}

function errorMessage(response: ChannelResponse): string | undefined {
  const message = (response.body as { message?: unknown } | null)?.message;
  return typeof message === "string" && message.trim() ? message.trim().slice(0, 300) : undefined;
}

/** Same actor ref the Admin Center routes write for a signed-in staff member. */
function actorForSession(session: { issuer: string; subject: string }): ActorRef {
  const digest = createHash("sha256").update(`${session.issuer}\n${session.subject}`).digest("hex");
  return { kind: "human", ref: `staff:${digest}` };
}

export class PgRoleAdministrationAudit implements RoleAdministrationAudit {
  constructor(private readonly pool: Pool) {}

  async record(entry: Parameters<RoleAdministrationAudit["record"]>[0]): Promise<void> {
    await this.pool.query(
      `INSERT INTO platform_audit_events (id, actor_kind, actor_ref, action, target_type, target_ref, outcome, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [randomUUID(), entry.actor.kind, entry.actor.ref, entry.action, entry.targetType, entry.targetRef, entry.outcome, JSON.stringify(entry.payload)],
    );
  }
}
