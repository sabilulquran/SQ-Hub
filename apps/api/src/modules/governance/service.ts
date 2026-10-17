import type { Pool } from "pg";

import { governanceSummaryUrl } from "../application-access/service.js";
import type { IdentityRef } from "../application-access/types.js";
import { HubAuthError } from "../hub-auth/service.js";
import type { HubSessionRecord } from "../hub-auth/repository.js";
import type { Organ } from "../organ-membership/repository.js";
import { validateGovernanceSummary, type GovernanceSummaryV1 } from "./contract.js";
import type { TokenExchanger } from "./token-exchange.js";

export interface GovernanceApplication {
  applicationKey: string;
  name: string;
  canonicalUrl: string;
  summaryPath: string;
  audience: string;
  order: number;
}

export type GovernanceCard =
  | { applicationKey: string; state: "ready"; summary: GovernanceSummaryV1 }
  | { applicationKey: string; state: "failed"; name: string };

export interface GovernanceSnapshot {
  membership: { organ: Organ; positionLabel?: string };
  cards: GovernanceCard[];
  generatedAt: string;
}

export type ObservationOutcome = "ready" | "forbidden" | "not_found" | "dropped" | "failed";

type FetchOutcome =
  | { kind: "ready"; summary: GovernanceSummaryV1 }
  | { kind: "hidden"; reason: "forbidden" | "not_found" | "dropped" }
  | { kind: "failed" };

export interface GovernanceApplicationSource {
  /** Active applications with a summary path and an active Application Access grant for the identity. */
  listForIdentity(identity: IdentityRef): Promise<GovernanceApplication[]>;
}

export interface GovernanceObservationStore {
  record(identity: IdentityRef, applicationKey: string, outcome: ObservationOutcome): Promise<void>;
  list(identity: IdentityRef): Promise<Array<{ applicationKey: string; outcome: ObservationOutcome; observedAt: string }>>;
}

export class GovernanceForbiddenError extends Error {
  readonly statusCode = 403;
  readonly code = "GOVERNANCE_FORBIDDEN";
}

export interface GovernanceLogEntry {
  applicationKey: string;
  status: number | "timeout" | "exchange_failed" | "network" | "invalid_body" | "application_mismatch" | "foreign_origin";
  latencyMs: number;
}

const MAX_BODY_BYTES = 128 * 1024;

/**
 * HUB-IMPL-021 §4. Fetches each application's governance summary as the signed-in user via
 * token exchange. Summaries live only in this process's memory for at most `cacheTtlMs` per
 * session; they are never written to the database, logs or audit events.
 */
export class GovernanceService {
  private readonly cache = new Map<string, { expiresAt: number; outcome: Exclude<FetchOutcome, { kind: "failed" }> }>();
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly deps: {
      memberships: { getEffective(identity: IdentityRef): Promise<{ organ: Organ; positionLabel: string | null } | null> };
      applications: GovernanceApplicationSource;
      /** The user's current Hub access token (refreshed server-side; never sent to the browser). */
      userAccessToken: (sessionToken: string | null) => Promise<string>;
      exchanger: TokenExchanger;
      fetch?: typeof fetch;
      observations?: GovernanceObservationStore;
      log?: (entry: GovernanceLogEntry) => void;
      now?: () => number;
      timeoutMs?: number;
      cacheTtlMs?: number;
    },
  ) {
    this.timeoutMs = deps.timeoutMs ?? 3000;
    this.cacheTtlMs = Math.min(deps.cacheTtlMs ?? 60_000, 60_000);
    this.now = deps.now ?? Date.now;
  }

  async hasEffectiveMembership(identity: IdentityRef): Promise<boolean> {
    return Boolean(await this.deps.memberships.getEffective(identity));
  }

  async snapshot(session: HubSessionRecord, sessionToken: string | null, options: { only?: string } = {}): Promise<GovernanceSnapshot> {
    const identity = { issuer: session.issuer, subject: session.subject };
    const membership = await this.deps.memberships.getEffective(identity);
    if (!membership) throw new GovernanceForbiddenError("no effective organ membership");

    let applications = await this.deps.applications.listForIdentity(identity);
    if (options.only) applications = applications.filter((application) => application.applicationKey === options.only);

    let tokenPromise: Promise<string> | null = null;
    const userToken = () => {
      tokenPromise ??= this.withTimeout((signal) => this.raceAbort(this.deps.userAccessToken(sessionToken), signal));
      return tokenPromise;
    };

    const outcomes = await Promise.all(
      applications.map(async (application) => {
        const cacheKey = `${session.sessionId}|${application.applicationKey}`;
        const cached = this.cache.get(cacheKey);
        if (!options.only && cached && cached.expiresAt > this.now()) return { application, outcome: cached.outcome as FetchOutcome };
        const outcome = await this.fetchOne(application, userToken);
        if (outcome.kind !== "failed") this.remember(cacheKey, outcome);
        else this.cache.delete(cacheKey);
        await this.observe(identity, application.applicationKey, outcome);
        return { application, outcome };
      }),
    );

    const cards: GovernanceCard[] = [];
    for (const { application, outcome } of outcomes) {
      if (outcome.kind === "ready") cards.push({ applicationKey: application.applicationKey, state: "ready", summary: outcome.summary });
      else if (outcome.kind === "failed") cards.push({ applicationKey: application.applicationKey, state: "failed", name: application.name });
    }
    return {
      membership: { organ: membership.organ, ...(membership.positionLabel ? { positionLabel: membership.positionLabel } : {}) },
      cards,
      generatedAt: new Date(this.now()).toISOString(),
    };
  }

  private async fetchOne(application: GovernanceApplication, userToken: () => Promise<string>): Promise<FetchOutcome> {
    const started = this.now();
    const log = (status: GovernanceLogEntry["status"]) =>
      this.deps.log?.({ applicationKey: application.applicationKey, status, latencyMs: this.now() - started });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let subjectToken: string;
      let exchanged: string;
      try {
        subjectToken = await this.raceAbort(userToken(), controller.signal);
        exchanged = await this.deps.exchanger.exchange(subjectToken, application.audience, controller.signal);
      } catch (error) {
        if (error instanceof HubAuthError) throw error;
        log(controller.signal.aborted ? "timeout" : "exchange_failed");
        return { kind: "failed" };
      }

      let response: Response;
      try {
        response = await (this.deps.fetch ?? fetch)(governanceSummaryUrl(application.canonicalUrl, application.summaryPath), {
          method: "GET",
          headers: { Authorization: `Bearer ${exchanged}`, Accept: "application/json" },
          redirect: "error",
          signal: controller.signal,
        });
      } catch {
        log(controller.signal.aborted ? "timeout" : "network");
        return { kind: "failed" };
      }

      if (response.status === 403) {
        log(403);
        return { kind: "hidden", reason: "forbidden" };
      }
      if (response.status === 404) {
        log(404);
        return { kind: "hidden", reason: "not_found" };
      }
      if (response.status !== 200 || !response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
        log(response.status);
        return { kind: "failed" };
      }
      let body: unknown;
      try {
        body = JSON.parse(await readLimited(response, MAX_BODY_BYTES));
      } catch {
        log(controller.signal.aborted ? "timeout" : "invalid_body");
        return { kind: "failed" };
      }
      const validation = validateGovernanceSummary(body, application);
      if (!validation.ok) {
        log(validation.reason);
        return validation.reason === "invalid_body" ? { kind: "failed" } : { kind: "hidden", reason: "dropped" };
      }
      log(200);
      return { kind: "ready", summary: validation.summary };
    } finally {
      clearTimeout(timer);
    }
  }

  private async observe(identity: IdentityRef, applicationKey: string, outcome: FetchOutcome) {
    if (!this.deps.observations) return;
    const value: ObservationOutcome = outcome.kind === "ready" ? "ready" : outcome.kind === "failed" ? "failed" : outcome.reason;
    try {
      await this.deps.observations.record(identity, applicationKey, value);
    } catch {
      // A missing observation must never break the page.
    }
  }

  private remember(key: string, outcome: Exclude<FetchOutcome, { kind: "failed" }>) {
    const now = this.now();
    if (this.cache.size > 1000) {
      for (const [entryKey, entry] of this.cache) if (entry.expiresAt <= now) this.cache.delete(entryKey);
    }
    this.cache.set(key, { expiresAt: now + this.cacheTtlMs, outcome });
  }

  private async withTimeout<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await task(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  private raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(new Error("aborted"));
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(new Error("aborted"));
      signal.addEventListener("abort", onAbort, { once: true });
      promise.then(
        (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
        (error: unknown) => { signal.removeEventListener("abort", onAbort); reject(error); },
      );
    });
  }
}

async function readLimited(response: Response, limit: number): Promise<string> {
  if (!response.body) throw new Error("empty body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new Error("response too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export class PgGovernanceApplicationSource implements GovernanceApplicationSource {
  constructor(private readonly pool: Pool) {}

  async listForIdentity(identity: IdentityRef): Promise<GovernanceApplication[]> {
    const result = await this.pool.query<GovernanceApplication>(
      `SELECT
         a.application_key AS "applicationKey",
         a.name,
         a.canonical_url AS "canonicalUrl",
         a.governance_summary_path AS "summaryPath",
         a.governance_audience AS "audience",
         a.governance_order AS "order"
       FROM applications a
       JOIN application_access aa ON aa.application_id = a.id
       WHERE aa.identity_issuer = $1 AND aa.identity_subject = $2
         AND aa.status = 'active' AND a.status = 'active'
         AND a.governance_summary_path IS NOT NULL AND a.governance_audience IS NOT NULL
       ORDER BY a.governance_order, a.name, a.application_key`,
      [identity.issuer, identity.subject],
    );
    return result.rows;
  }
}

export class PgGovernanceObservationStore implements GovernanceObservationStore {
  constructor(private readonly pool: Pool) {}

  async record(identity: IdentityRef, applicationKey: string, outcome: ObservationOutcome): Promise<void> {
    await this.pool.query(
      `INSERT INTO governance_summary_observations (identity_issuer, identity_subject, application_key, outcome, observed_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (identity_issuer, identity_subject, application_key)
       DO UPDATE SET outcome = EXCLUDED.outcome, observed_at = now()`,
      [identity.issuer, identity.subject, applicationKey, outcome],
    );
  }

  async list(identity: IdentityRef) {
    const result = await this.pool.query<{ applicationKey: string; outcome: ObservationOutcome; observedAt: Date }>(
      `SELECT application_key AS "applicationKey", outcome, observed_at AS "observedAt"
       FROM governance_summary_observations WHERE identity_issuer = $1 AND identity_subject = $2`,
      [identity.issuer, identity.subject],
    );
    return result.rows.map((row) => ({ ...row, observedAt: row.observedAt.toISOString() }));
  }
}
