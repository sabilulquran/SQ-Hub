import { createHash, randomUUID } from "node:crypto";

import type { Pool } from "pg";

import { governanceSummaryUrl } from "../application-access/service.js";
import type { IdentityRef } from "../application-access/types.js";
import type { HubSessionRecord } from "../hub-auth/repository.js";
import { HubAuthError } from "../hub-auth/service.js";
import type { TokenExchanger } from "../governance/token-exchange.js";
import { decisionListSchema, type DecisionCommand, type DecisionItem } from "./contract.js";

/**
 * ORGAN-IMPL-001 §4.2 / ADR-0012 D4 — forwarding one member's decision to the application that
 * owns the rule.
 *
 * Three things keep this narrow. The portal refuses before any token exchange when the step-up is
 * stale, so a session alone can never reach a decision route. Each action gets its own token, for
 * the decision audience only, which the browser never sees. And nothing of the request is kept
 * here: the only row written is an event with a digest of the actor, no name, note or reason.
 */

/** The scope that carries the decision audience's mapper. Never a default scope on the client. */
export const DECISION_SCOPE_PREFIX = "sq-organ-decision-";

/** ORGAN-IMPL-001 §4.2 step 2, `DRAFT` T-2. */
export const STEP_UP_MAX_AGE_SECONDS = 900;

export interface OrganDecisionApplication {
  applicationKey: string;
  name: string;
  canonicalUrl: string;
  decisionPath: string;
  decisionAudience: string;
  order: number;
}

export interface OrganDecisionApplicationSource {
  listForIdentity(identity: IdentityRef): Promise<OrganDecisionApplication[]>;
}

export interface OrganDecisionEventStore {
  record(input: {
    actorDigest: string;
    applicationKey: string;
    stepId: string;
    decision: "approve" | "reject";
    statusCode: number;
  }): Promise<void>;
}

export class StepUpRequiredError extends Error {
  readonly statusCode = 403;
  readonly code = "step_up_required";
}

export class DecisionApplicationUnknownError extends Error {
  readonly statusCode = 404;
  readonly code = "decision_application_unknown";
}

export class DecisionUnavailableError extends Error {
  readonly statusCode = 503;
  readonly code = "decision_unavailable";
}

/** The owning application refused or could not complete the decision; its answer is passed on. */
export class DecisionRefusedError extends Error {
  constructor(readonly statusCode: number, readonly code: string, readonly detail: string | null) {
    super(code);
  }
}

export interface OrganDecisionCard {
  applicationKey: string;
  name: string;
  state: "ready" | "failed";
  items: DecisionItem[];
}

const MAX_BODY_BYTES = 256 * 1024;

export function actorDigest(identity: IdentityRef): string {
  return createHash("sha256").update(`${identity.issuer}\n${identity.subject}`).digest("hex");
}

export class OrganDecisionService {
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(
    private readonly deps: {
      applications: OrganDecisionApplicationSource;
      /** The user's current Hub access token; never sent to the browser. */
      userAccessToken: (sessionToken: string | null) => Promise<string>;
      exchanger: TokenExchanger;
      events: OrganDecisionEventStore;
      fetch?: typeof fetch;
      now?: () => number;
      timeoutMs?: number;
      stepUpMaxAgeSeconds?: number;
    },
  ) {
    this.timeoutMs = deps.timeoutMs ?? 3000;
    this.now = deps.now ?? Date.now;
  }

  private get stepUpMaxAgeMs(): number {
    return (this.deps.stepUpMaxAgeSeconds ?? STEP_UP_MAX_AGE_SECONDS) * 1000;
  }

  /**
   * §4.2 step 1. Checked before anything else on both routes: a stale step-up means no exchange at
   * all, so a captured session cookie cannot be turned into a decision token by waiting.
   */
  assertFreshStepUp(session: HubSessionRecord): void {
    const steppedUpAt = session.steppedUpAt?.getTime();
    if (!steppedUpAt || this.now() - steppedUpAt > this.stepUpMaxAgeMs) {
      throw new StepUpRequiredError("the step-up is missing or stale");
    }
  }

  async list(session: HubSessionRecord, sessionToken: string | null): Promise<{ cards: OrganDecisionCard[]; generatedAt: string }> {
    this.assertFreshStepUp(session);
    const identity = { issuer: session.issuer, subject: session.subject };
    const applications = await this.deps.applications.listForIdentity(identity);

    const cards = await Promise.all(
      applications.map(async (application): Promise<OrganDecisionCard> => {
        try {
          const response = await this.call(application, sessionToken, { method: "GET" });
          if (response.status !== 200) return { applicationKey: application.applicationKey, name: application.name, state: "failed", items: [] };
          const parsed = decisionListSchema.safeParse(response.body);
          if (!parsed.success) return { applicationKey: application.applicationKey, name: application.name, state: "failed", items: [] };
          return { applicationKey: application.applicationKey, name: application.name, state: "ready", items: parsed.data.items };
        } catch (error) {
          if (error instanceof HubAuthError) throw error;
          return { applicationKey: application.applicationKey, name: application.name, state: "failed", items: [] };
        }
      }),
    );

    return { cards, generatedAt: new Date(this.now()).toISOString() };
  }

  async decide(
    session: HubSessionRecord,
    sessionToken: string | null,
    applicationKey: string,
    stepId: string,
    command: DecisionCommand,
  ): Promise<unknown> {
    this.assertFreshStepUp(session);
    const identity = { issuer: session.issuer, subject: session.subject };
    const application = (await this.deps.applications.listForIdentity(identity))
      .find((item) => item.applicationKey === applicationKey);
    if (!application) throw new DecisionApplicationUnknownError(applicationKey);

    const digest = actorDigest(identity);
    let response: { status: number; body: unknown };
    try {
      response = await this.call(application, sessionToken, {
        method: "POST",
        stepId,
        payload: command,
      });
    } catch (error) {
      if (error instanceof HubAuthError) throw error;
      // The result is genuinely unknown: the decision may or may not have landed. The portal
      // reloads rather than resending by itself, and the same requestId makes a later resend safe.
      await this.record(digest, applicationKey, stepId, command.decision, 0);
      throw new DecisionUnavailableError("the application could not be reached");
    }

    await this.record(digest, applicationKey, stepId, command.decision, response.status);

    if (response.status === 200) return response.body;
    const body = response.body as { code?: unknown; message?: unknown } | null;
    throw new DecisionRefusedError(
      response.status >= 400 && response.status <= 599 ? response.status : 503,
      typeof body?.code === "string" ? body.code : "decision_refused",
      typeof body?.message === "string" ? body.message.slice(0, 300) : null,
    );
  }

  private async record(
    actorDigestValue: string,
    applicationKey: string,
    stepId: string,
    decision: "approve" | "reject",
    statusCode: number,
  ): Promise<void> {
    try {
      await this.deps.events.record({
        actorDigest: actorDigestValue,
        applicationKey,
        stepId,
        decision,
        // 0 means "no answer": stored as 599 so the column keeps its HTTP-shaped domain.
        statusCode: statusCode === 0 ? 599 : statusCode,
      });
    } catch {
      // The event is a record of what the portal did, never a gate on doing it.
    }
  }

  /** One exchanged token per call (§4.2 step 3), used once and never stored or logged. */
  private async call(
    application: OrganDecisionApplication,
    sessionToken: string | null,
    input: { method: "GET" } | { method: "POST"; stepId: string; payload: DecisionCommand },
  ): Promise<{ status: number; body: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const subjectToken = await this.deps.userAccessToken(sessionToken);
      const exchanged = await this.deps.exchanger.exchange(
        subjectToken,
        {
          audience: application.decisionAudience,
          scope: `${DECISION_SCOPE_PREFIX}${application.applicationKey}`,
        },
        controller.signal,
      );

      const path = input.method === "GET"
        ? application.decisionPath
        : `${application.decisionPath.replace(/\/$/, "")}/${encodeURIComponent(input.stepId)}`;
      const url = governanceSummaryUrl(application.canonicalUrl, path);

      const response = await (this.deps.fetch ?? fetch)(url, {
        method: input.method,
        headers: {
          Authorization: `Bearer ${exchanged}`,
          Accept: "application/json",
          ...(input.method === "POST" ? { "Content-Type": "application/json" } : {}),
        },
        ...(input.method === "POST" ? { body: JSON.stringify(input.payload) } : {}),
        redirect: "error",
        signal: controller.signal,
      });

      const text = await readLimited(response, MAX_BODY_BYTES);
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      return { status: response.status, body };
    } finally {
      clearTimeout(timer);
    }
  }
}

async function readLimited(response: Response, limit: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new Error("response too large");
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export class PgOrganDecisionApplicationSource implements OrganDecisionApplicationSource {
  constructor(private readonly pool: Pool) {}

  async listForIdentity(identity: IdentityRef): Promise<OrganDecisionApplication[]> {
    const result = await this.pool.query<OrganDecisionApplication>(
      `SELECT
         a.application_key AS "applicationKey",
         a.name,
         a.canonical_url AS "canonicalUrl",
         a.decision_path AS "decisionPath",
         a.decision_audience AS "decisionAudience",
         a.governance_order AS "order"
       FROM applications a
       JOIN application_access aa ON aa.application_id = a.id
       WHERE aa.identity_issuer = $1 AND aa.identity_subject = $2
         AND aa.status = 'active' AND a.status = 'active'
         AND a.decision_path IS NOT NULL AND a.decision_audience IS NOT NULL
       ORDER BY a.governance_order, a.name, a.application_key`,
      [identity.issuer, identity.subject],
    );
    return result.rows;
  }
}

export class PgOrganDecisionEventStore implements OrganDecisionEventStore {
  constructor(private readonly pool: Pool) {}

  async record(input: {
    actorDigest: string;
    applicationKey: string;
    stepId: string;
    decision: "approve" | "reject";
    statusCode: number;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO organ_decision_events (id, actor_digest, application_key, step_id, decision, status_code)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), input.actorDigest, input.applicationKey, input.stepId.slice(0, 255), input.decision, input.statusCode],
    );
  }
}
