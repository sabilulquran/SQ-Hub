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
      // HCIS ORG-013-2: which account type a role is for, and whether it must end. Optional so a
      // HCIS release without them still parses; absent means an employee role with no end date.
      // Unknown types are kept as text so a new HCIS principal type cannot take the whole catalog
      // down; the screen offers a role only for a type it knows.
      targetPrincipalTypes: z.array(z.string().min(1).max(40)).min(1).max(10).optional(),
      endDateRequired: z.boolean().optional(),
    }),
  ).max(500),
});

export type HcisRoleCatalog = z.infer<typeof catalogSchema>;

// H-1b (HCIS §2.1b, main 7cb2d35f). No name, e-mail, NIK or employment status comes back: the Hub
// already knows who it asked about, and the role channel is not a way to read employee data.
// `grantable` only says whether HCIS would refuse a grant, and why. A SUPER_ADMIN account answers
// 404 like a missing one, on purpose; an organ (FOUNDATION_BOARD) account answers since HCIS
// ORG-013-2, so it can receive the governance Leave approver role.
const lookupSchema = z.object({
  account: z.object({
    accountId: z.string().uuid(),
    principalType: z.enum(["EMPLOYEE", "FOUNDATION_BOARD"]).optional(),
    grantable: z.boolean(),
    notGrantableReason: z.enum(["account_inactive", "employee_inactive"]).nullable(),
  }),
  assignments: z.object({
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
    pagination: z.object({
      page: z.number().int().min(1),
      pageSize: z.number().int().min(1).max(100),
      total: z.number().int().min(0),
      pageCount: z.number().int().min(0),
    }),
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
 * How HCIS answers reach the operator (spec §2 table). HCIS's domain refusals are passed on by code
 * with HCIS's fixed message, from an allowlist taken from HCIS role-assignment.ts plus the three
 * org-access-policy codes the channel names one by one (HCIS d7b2e58); anything else, credential
 * failures included, becomes one channel error, so an unexpected HCIS payload never reaches the
 * browser.
 */
const DOMAIN_CODES = new Set([
  "ROLE_DELEGATION_FORBIDDEN",
  "ROLE_IDENTITY_PERMISSION_FORBIDDEN",
  "ROLE_GRANT_ACTOR_INVALID",
  "ROLE_GRANT_SUPER_ADMIN_ONLY",
  "ROLE_ADMIN_ACTOR_UNRESOLVED",
  "HCIS_ACCESS_DENIED",
  "ADMIN_ORGANIZATION_MANDATE_REQUIRED",
  "ROLE_REASON_REQUIRED",
  "ROLE_SCOPE_INVALID",
  "ROLE_SCOPE_NOT_ALLOWED",
  "ACCOUNT_NOT_FOUND",
  "ASSIGNMENT_NOT_FOUND",
  "ROLE_NOT_FOUND",
  "UNIT_NOT_FOUND",
  "INVALID_ASSIGNMENT_PERIOD",
  "NON_UNIT_SCOPE_FORBIDS_UNIT",
  "UNIT_SCOPE_REQUIRES_UNIT",
]);
const CONFLICT_CODES = new Set(["ROLE_ADMIN_REQUEST_REPLAYED", "ROLE_ADMIN_ACTOR_ASSERTION_SPENT"]);
const UNAVAILABLE_CODES = new Set(["ROLE_ADMIN_CHANNEL_DISABLED", "APPLICATION_ACCESS_UNAVAILABLE"]);
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
    targetType: "staff_identity";
    targetRef: string;
    outcome: "succeeded" | "failed";
    payload: Record<string, string | null>;
  }): Promise<void>;
}

type Operation = RoleAdministrationLogEntry["operation"];
type Send = (request: ChannelRequest) => Promise<ChannelResponse>;
type AuditTarget = {
  action: "hcis_role.assignment.create" | "hcis_role.assignment.remove";
  targetType: "staff_identity";
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
    const { requestId, ...rest } = input;
    const payload: Record<string, string | null> = { requestId, roleId: input.roleId, scopeType: input.scopeType };
    // Audited from the first step, so a refusal before the change call (self, no account, exchange
    // failure) is recorded too. The target is the person; HCIS's account id joins the payload.
    return this.audited(session, { action: "hcis_role.assignment.create", ...staffTarget(identity) }, payload, async () => {
      refuseSelf(session, identity);
      return this.withChannel("grant", sessionToken, async (send) => {
        // The account is resolved inside the same action, from the person the operator picked.
        const { account } = await this.lookupWith(send, identity, 1, 1);
        payload.accountId = account.accountId;
        // The actor never travels in the body (spec §2 H-2); HCIS answers 400 if it does.
        const response = await send({
          method: "POST",
          path: `accounts/${encodeURIComponent(account.accountId)}/role-assignments`,
          body: { requestId, ...rest },
        });
        if (response.status !== 201) throw this.refusal(response);
        const created = createdSchema.safeParse(response.body);
        // A 201 that cannot be read still means HCIS took the change.
        if (!created.success) throw new RoleAdministrationError(504, "ROLE_ADMIN_OUTCOME_UNKNOWN");
        return created.data;
      });
    });
  }

  async revoke(
    session: HubSessionRecord,
    sessionToken: string | null,
    identity: IdentityRef,
    input: { assignmentId: string; requestId: string },
  ): Promise<void> {
    await this.deps.authorize(session);
    const payload: Record<string, string | null> = { requestId: input.requestId, assignmentId: input.assignmentId };
    await this.audited(session, { action: "hcis_role.assignment.remove", ...staffTarget(identity) }, payload, async () => {
      refuseSelf(session, identity);
      await this.withChannel("revoke", sessionToken, async (send) => {
        // Only an assignment that belongs to the picked person, and that HCIS says the Hub may
        // revoke, is sent; the others are shown but never offered.
        const assignment = await this.findAssignment(send, identity, input.assignmentId);
        if (!assignment) throw new RoleAdministrationError(404, "ROLE_ADMIN_ASSIGNMENT_NOT_FOUND");
        payload.roleId = assignment.roleId;
        if (!assignment.revocableViaHub) throw new RoleAdministrationError(422, "ROLE_ADMIN_ASSIGNMENT_NOT_REVOCABLE");
        // H-2b: the requestId travels in the body of a DELETE; success is 204 without a body.
        const response = await send({
          method: "DELETE",
          path: `role-assignments/${encodeURIComponent(input.assignmentId)}`,
          body: { requestId: input.requestId },
        });
        if (response.status !== 204) throw this.refusal(response);
      });
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
      if (page >= assignments.pagination.pageCount) return null;
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
      // Reads do not spend an assertion, so all reads of one action share one; HCIS audits each read
      // with the assertion's jti, and one action then shows as one jti instead of a burst.
      let readAssertion: string | null = null;
      const send: Send = async (request) => {
        for (let attempt = 0; ; attempt += 1) {
          const reuse = request.method === "GET" && attempt === 0 && readAssertion !== null;
          const actorAssertion = reuse ? readAssertion! : await this.exchange(operation, subjectToken, controller.signal);
          if (request.method === "GET") readAssertion = actorAssertion;
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
          const code = errorCode(response);
          const hcisCode = code && CODE_PATTERN.test(code) ? code : undefined;
          this.deps.log?.({ event: "role_administration.channel", operation, status: response.status, ...(hcisCode ? { hcisCode } : {}) });
          // A server error after a change left the Hub may come after HCIS committed it. Only the
          // switched-off channel is known to have changed nothing.
          if (request.method !== "GET" && response.status >= 500 && !(code && UNAVAILABLE_CODES.has(code))) {
            throw new RoleAdministrationError(504, "ROLE_ADMIN_OUTCOME_UNKNOWN");
          }
          // One fresh assertion, once: when a change's assertion was spent, or when HCIS found an
          // assertion invalid — usually too old (HCIS counts its age from iat), which a new one fixes.
          if (attempt === 0 && (code === "ROLE_ADMIN_ACTOR_ASSERTION_INVALID" || (request.method !== "GET" && code === "ROLE_ADMIN_ACTOR_ASSERTION_SPENT"))) {
            readAssertion = null;
            continue;
          }
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
    // Still invalid after one fresh assertion: retryable from the operator's side (clock skew,
    // slow Keycloak), and distinct from a contract violation.
    if (code === "ROLE_ADMIN_ACTOR_ASSERTION_INVALID") return new RoleAdministrationError(503, code);
    // HCIS's own status is kept, so a refusal about the actor (403) stays distinct from one about
    // the input (HCIS 400, answered as 422 because 400 is the Hub's own malformed-request answer).
    if (code && response.status >= 400 && response.status < 500 && DOMAIN_CODES.has(code)) {
      return new RoleAdministrationError(response.status === 400 ? 422 : response.status, code, errorMessage(response));
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
function staffTarget(identity: IdentityRef): { targetType: "staff_identity"; targetRef: string } {
  // The person a change is about, as the same digest used for actor refs (never the raw subject).
  return { targetType: "staff_identity", targetRef: actorForSession(identity).ref };
}

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
