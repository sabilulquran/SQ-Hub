import { createHash, randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { z } from "zod";

import type { ActorRef, IdentityRef } from "../application-access/types.js";
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

// H-1b (HCIS lookup contract, decided 2026-11-01). No name, e-mail or NIK comes back: the Hub
// already knows who it asked about, and the role channel is not a way to read employee data.
const lookupSchema = z.object({
  account: z.object({
    accountId: z.string().uuid(),
    principalType: z.string().max(60),
    status: z.string().max(60),
    employeeStatus: z.string().max(60).nullable(),
  }),
  assignments: z.object({
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
    items: z.array(z.object({
      assignmentId: z.string().uuid(),
      roleId: z.string().uuid(),
      roleKey: z.string().min(1).max(120),
      roleName: z.string().min(1).max(255),
      scopeType: z.string().max(40),
      organizationalUnitId: z.string().uuid().nullable(),
      organizationalUnitName: z.string().max(255).nullable(),
      startsOn: z.string().max(40).nullable(),
      endsOn: z.string().max(40).nullable(),
      createdAt: z.string().max(40),
      revocableViaHub: z.boolean(),
    })).max(100),
  }),
});

export type HcisAccountLookup = z.infer<typeof lookupSchema>;

/** A person with more assignments than this is not expected; the search stops rather than loops. */
const MAX_LOOKUP_PAGES = 10;

const createdSchema = z.object({ assignmentId: z.string().uuid(), requestId: z.string().uuid() });

export interface RoleGrantInput {
  requestId: string;
  roleId: string;
  scopeType: "own" | "unit" | "organization";
  organizationalUnitId: string | null;
  reason: string | null;
  startsOn: string | null;
  endsOn: string | null;
}

/**
 * How HCIS answers reach the operator (spec §2 table). HCIS's domain refusals (delegation, missing
 * mandate, scope, unknown role or unit, ...) are passed on by code with HCIS's fixed message;
 * configuration failures and anything without a well-formed code become one channel error, so an
 * unexpected HCIS payload never reaches the browser.
 */
const CONFLICT_CODES = new Set(["ROLE_ADMIN_REQUEST_REPLAYED", "ROLE_ADMIN_ACTOR_ASSERTION_SPENT"]);
const UNAVAILABLE_CODES = new Set(["ROLE_ADMIN_CHANNEL_DISABLED", "APPLICATION_ACCESS_UNAVAILABLE"]);
// The two proofs or the client setup are wrong: a configuration problem, never the operator's.
const CONFIGURATION_CODES = new Set(["UNAUTHENTICATED", "FORBIDDEN_CLIENT", "ROLE_ADMIN_ACTOR_ASSERTION_INVALID"]);
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,80}$/;

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
  event: "role_administration.exchange" | "role_administration.channel" | "role_administration.audit_failed";
  operation: "catalog" | "lookup" | "grant" | "revoke";
  status?: number | "exchange_failed" | "unavailable" | "timeout" | "outcome_unknown";
  /** HCIS's error code, which is not secret and tells the rollout which check refused. */
  hcisCode?: string;
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
type Send = (request: ChannelRequest) => Promise<ChannelResponse>;
type AuditTarget = {
  action: "hcis_role.assignment.create" | "hcis_role.assignment.remove";
  targetType: "hcis_account" | "hcis_role_assignment";
  targetRef: string;
};

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
    return this.withChannel("catalog", sessionToken, async (send) => {
      const response = await send({ method: "GET", path: "catalog" });
      if (response.status !== 200) throw this.refusal(response);
      const parsed = catalogSchema.safeParse(response.body);
      if (!parsed.success) throw new RoleAdministrationError(502, "ROLE_ADMIN_CHANNEL_ERROR");
      return parsed.data;
    });
  }

  /**
   * H-1b: the HCIS account and its role assignments for one person, found by issuer+subject. The
   * operator never types an HCIS id, so a pasted id can never put a role on the wrong person.
   */
  async lookup(session: HubSessionRecord, sessionToken: string | null, identity: IdentityRef, page = 1): Promise<HcisAccountLookup> {
    await this.deps.authorize(session);
    return this.withChannel("lookup", sessionToken, (send) => this.lookupWith(send, identity, page, 25));
  }

  async grant(
    session: HubSessionRecord,
    sessionToken: string | null,
    identity: IdentityRef,
    input: RoleGrantInput,
  ): Promise<{ assignmentId: string; requestId: string }> {
    await this.deps.authorize(session);
    refuseSelf(session, identity);
    return this.withChannel("grant", sessionToken, async (send) => {
      // The account is resolved inside the same action, from the person the operator picked.
      const { account } = await this.lookupWith(send, identity, 1, 1);
      const { requestId, ...rest } = input;
      return this.audited(
        session,
        { action: "hcis_role.assignment.create", targetType: "hcis_account", targetRef: `hcis-account:${account.accountId}` },
        { requestId, roleId: input.roleId, scopeType: input.scopeType },
        async () => {
          // The actor never travels in the body (spec §2 H-2); HCIS answers 400 if it does.
          const response = await send({
            method: "POST",
            path: `accounts/${encodeURIComponent(account.accountId)}/role-assignments`,
            body: { requestId, ...rest },
          });
          if (response.status !== 201) throw this.refusal(response);
          const created = createdSchema.safeParse(response.body);
          if (!created.success) throw new RoleAdministrationError(502, "ROLE_ADMIN_CHANNEL_ERROR");
          return created.data;
        },
      );
    });
  }

  async revoke(
    session: HubSessionRecord,
    sessionToken: string | null,
    identity: IdentityRef,
    input: { assignmentId: string; requestId: string },
  ): Promise<void> {
    await this.deps.authorize(session);
    refuseSelf(session, identity);
    await this.withChannel("revoke", sessionToken, async (send) => {
      // Only an assignment that belongs to the picked person, and that HCIS says the Hub may
      // revoke, is sent; the others are shown but never offered.
      const assignment = await this.findAssignment(send, identity, input.assignmentId);
      if (!assignment) throw new RoleAdministrationError(404, "ROLE_ADMIN_ASSIGNMENT_NOT_FOUND");
      if (!assignment.revocableViaHub) throw new RoleAdministrationError(422, "ROLE_ADMIN_ASSIGNMENT_NOT_REVOCABLE");
      await this.audited(
        session,
        { action: "hcis_role.assignment.remove", targetType: "hcis_role_assignment", targetRef: `hcis-role-assignment:${input.assignmentId}` },
        { requestId: input.requestId, roleId: assignment.roleId },
        async () => {
          // H-2b: the requestId travels in the body of a DELETE; success is 204 without a body.
          const response = await send({
            method: "DELETE",
            path: `role-assignments/${encodeURIComponent(input.assignmentId)}`,
            body: { requestId: input.requestId },
          });
          if (response.status !== 204) throw this.refusal(response);
        },
      );
    });
  }

  private async lookupWith(send: Send, identity: IdentityRef, page: number, pageSize: number): Promise<HcisAccountLookup> {
    const query = new URLSearchParams({
      issuer: identity.issuer,
      subject: identity.subject,
      page: String(page),
      pageSize: String(pageSize),
    });
    const response = await send({ method: "GET", path: `accounts?${query}` });
    // 404 means the person has no HCIS account — not that the operator may not look.
    if (response.status === 404 && errorCode(response) === "ROLE_ADMIN_ACCOUNT_NOT_FOUND") {
      throw new RoleAdministrationError(404, "ROLE_ADMIN_ACCOUNT_NOT_FOUND");
    }
    if (response.status !== 200) throw this.refusal(response);
    const parsed = lookupSchema.safeParse(response.body);
    if (!parsed.success) throw new RoleAdministrationError(502, "ROLE_ADMIN_CHANNEL_ERROR");
    return parsed.data;
  }

  private async findAssignment(send: Send, identity: IdentityRef, assignmentId: string) {
    for (let page = 1; page <= MAX_LOOKUP_PAGES; page += 1) {
      const { assignments } = await this.lookupWith(send, identity, page, 100);
      const found = assignments.items.find((item) => item.assignmentId === assignmentId);
      if (found) return found;
      if (page * assignments.pageSize >= assignments.total) return null;
    }
    return null;
  }

  /**
   * One user action against HCIS. The machine token and the subject token are fetched once; each
   * request then gets its own assertion, exchanged immediately before it is sent (H-2c: HCIS
   * limits its age from `iat`). An assertion is never reused: when HCIS reports a change's
   * assertion spent, a new one is exchanged once for the same requestId (AC 4) — safe, because
   * HCIS refuses a second assignment for one requestId.
   */
  private async withChannel<T>(operation: Operation, sessionToken: string | null, run: (send: Send) => Promise<T>): Promise<T> {
    const channel = this.deps.channel;
    if (!channel) throw new RoleAdministrationError(503, "ROLE_ADMIN_CHANNEL_NOT_CONFIGURED");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const machineToken = await channel.machineToken(controller.signal);
      const subjectToken = await this.deps.userAccessToken(sessionToken);
      const send: Send = async (request) => {
        for (let attempt = 0; ; attempt += 1) {
          const actorAssertion = await this.exchange(operation, subjectToken, controller.signal);
          let response: ChannelResponse;
          try {
            response = await channel.send(request, { machineToken, actorAssertion }, controller.signal);
          } catch (error) {
            // A change that left the Hub may have been applied even though no answer came back.
            if (error instanceof ChannelUnavailableError && request.method !== "GET") {
              this.deps.log?.({ event: "role_administration.channel", operation, status: "outcome_unknown" });
              throw new RoleAdministrationError(504, "ROLE_ADMIN_OUTCOME_UNKNOWN");
            }
            throw error;
          }
          const hcisCode = errorCode(response);
          this.deps.log?.({ event: "role_administration.channel", operation, status: response.status, ...(hcisCode ? { hcisCode } : {}) });
          if (attempt === 0 && request.method !== "GET" && errorCode(response) === "ROLE_ADMIN_ACTOR_ASSERTION_SPENT") continue;
          return response;
        }
      };
      return await run(send);
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
    if (response.status === 400 && code === "INVALID_REQUEST") return new RoleAdministrationError(422, "ROLE_ADMIN_INVALID_REQUEST");
    if (code && response.status >= 400 && response.status < 500 && !CONFIGURATION_CODES.has(code) && CODE_PATTERN.test(code)) {
      return new RoleAdministrationError(422, code, errorMessage(response));
    }
    return new RoleAdministrationError(502, "ROLE_ADMIN_CHANNEL_ERROR");
  }

  /** Hub-side record of each attempted change, keyed by the same requestId HCIS audits (AUTH-014 H-5). */
  private async audited<T>(session: HubSessionRecord, target: AuditTarget, payload: Record<string, string | null>, run: () => Promise<T>): Promise<T> {
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

  private async writeAudit(session: HubSessionRecord, target: AuditTarget, outcome: "succeeded" | "failed", payload: Record<string, string | null>) {
    if (!this.deps.audit) return;
    try {
      await this.deps.audit.record({ actor: actorForSession(session), ...target, outcome, payload });
    } catch {
      // HCIS holds the authoritative audit; a missing Hub row must not turn a done grant into an
      // error, but operations must see that it is missing.
      this.deps.log?.({ event: "role_administration.audit_failed", operation: target.action === "hcis_role.assignment.create" ? "grant" : "revoke" });
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

/**
 * HCIS refuses self-grant and self-revoke too; the Hub refuses first so no assertion is spent on
 * an action that cannot succeed, and says why (AC 3).
 */
function refuseSelf(session: { issuer: string; subject: string }, identity: IdentityRef) {
  if (session.issuer === identity.issuer && session.subject === identity.subject) {
    throw new RoleAdministrationError(422, "ROLE_ADMIN_SELF_FORBIDDEN");
  }
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
