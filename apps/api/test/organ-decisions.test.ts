import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { HubSessionRecord } from "../src/modules/hub-auth/repository.js";
import type { ExchangeTarget } from "../src/modules/governance/token-exchange.js";
import {
  DecisionApplicationUnknownError,
  DecisionNotSentError,
  DecisionRefusedError,
  DecisionUnavailableError,
  OrganDecisionService,
  StepUpRequiredError,
  actorDigest,
  DECISION_SCOPE_PREFIX,
  type OrganDecisionApplication,
} from "../src/modules/organ-decisions/service.js";

// ORGAN-IMPL-001 §4.2 (R2). Synthetic identities, synthetic applications.

const ISSUER = "https://login.example/realms/sq-staff";
const NOW = new Date("2026-11-17T10:00:00Z");
const DIGEST_KEY = "synthetic-portal-secret";

const HCIS: OrganDecisionApplication = {
  applicationKey: "hcis",
  name: "HCIS",
  canonicalUrl: "https://hcis.example/",
  decisionPath: "/governance/decisions",
  decisionAudience: "hcis-organ-decision",
  order: 1,
};

function session(steppedUpAt: Date | null): HubSessionRecord {
  return {
    sessionId: "s1",
    issuer: ISSUER,
    subject: "ketua",
    displayName: "Anggota Sintetis",
    username: null,
    email: null,
    emailVerified: null,
    accountRefreshTokenCiphertext: null,
    createdAt: new Date(NOW.getTime() - 3_600_000),
    expiresAt: new Date(NOW.getTime() + 3_600_000),
    steppedUpAt,
  };
}

const item = {
  stepId: "step-1",
  requestId: "req-1",
  kind: "annual",
  requester: { name: "Pegawai Sintetis", positionLabel: "Direktur", unitName: "Unit Alfa" },
  period: { startOn: "2026-12-01", endOn: "2026-12-03", workingDays: 3 },
  reason: "Keperluan keluarga",
  submittedAt: "2026-11-16T02:00:00.000Z",
  history: [{ order: 1, status: "approved", decidedAt: "2026-11-16T03:00:00.000Z", approverRole: "Atasan langsung" }],
};

interface Call {
  url: string;
  method: string;
  authorization: string | null;
  body: unknown;
}

function build(options: {
  applications?: OrganDecisionApplication[];
  respond?: (call: Call) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>;
  throwOnFetch?: boolean;
} = {}) {
  const calls: Call[] = [];
  const exchanges: ExchangeTarget[] = [];
  const events: Array<Record<string, unknown>> = [];
  const service = new OrganDecisionService({
    applications: { listForIdentity: async () => options.applications ?? [HCIS] },
    userAccessToken: async () => "user-access-token",
    exchanger: {
      exchange: async (_subject, target) => {
        exchanges.push(target);
        return `exchanged-for-${target.audience}`;
      },
    },
    events: { record: async (input) => { events.push(input as unknown as Record<string, unknown>); } },
    digestKey: DIGEST_KEY,
    now: () => NOW.getTime(),
    fetch: (async (input: URL | string, init?: RequestInit) => {
      const call: Call = {
        url: String(input),
        method: init?.method ?? "GET",
        authorization: (init?.headers as Record<string, string> | undefined)?.Authorization ?? null,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      };
      calls.push(call);
      if (options.throwOnFetch) throw new Error("network down");
      const answer = await (options.respond?.(call) ?? { status: 200, body: { items: [item] } });
      return new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch,
  });
  return { service, calls, exchanges, events };
}

describe("ORGAN-IMPL-001 §4.2 step 1: refuse before any exchange", () => {
  it.each([
    ["no step-up at all", null],
    ["a step-up from 16 minutes ago", new Date(NOW.getTime() - 960_000)],
  ])("refuses the list with %s and never exchanges a token", async (_label, steppedUpAt) => {
    const { service, calls, exchanges } = build();
    await expect(service.list(session(steppedUpAt), "token")).rejects.toBeInstanceOf(StepUpRequiredError);
    expect(exchanges).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("refuses a decision with a stale step-up, and writes no event", async () => {
    const { service, exchanges, events } = build();
    await expect(
      service.decide(session(new Date(NOW.getTime() - 960_000)), "token", "hcis", "step-1", {
        decision: "approve",
        requestId: "11111111-1111-4111-8111-111111111111",
      }),
    ).rejects.toBeInstanceOf(StepUpRequiredError);
    expect(exchanges).toEqual([]);
    expect(events).toEqual([]);
  });

  it("accepts a step-up inside the 900-second window", async () => {
    const { service } = build();
    await expect(service.list(session(new Date(NOW.getTime() - 899_000)), "token")).resolves.toMatchObject({
      cards: [{ applicationKey: "hcis", state: "ready" }],
    });
  });
});

describe("ORGAN-IMPL-001 §4.2 step 3: one token per action, for the decision audience", () => {
  const fresh = () => session(new Date(NOW.getTime() - 60_000));

  it("exchanges for the decision audience through its own optional scope", async () => {
    const { service, exchanges, calls } = build();
    await service.list(fresh(), "token");
    expect(exchanges).toEqual([{ audience: "hcis-organ-decision", scope: `${DECISION_SCOPE_PREFIX}hcis` }]);
    expect(calls[0]?.authorization).toBe("Bearer exchanged-for-hcis-organ-decision");
    expect(calls[0]?.url).toBe("https://hcis.example/governance/decisions");
  });

  it("exchanges again for the decision itself rather than reusing the list's token", async () => {
    const { service, exchanges, calls } = build({ respond: (call) => (call.method === "POST" ? { status: 200, body: { requestStatus: "approved" } } : { status: 200, body: { items: [item] } }) });
    const current = fresh();
    await service.list(current, "token");
    await service.decide(current, "token", "hcis", "step-1", {
      decision: "approve",
      note: "Disetujui",
      requestId: "11111111-1111-4111-8111-111111111111",
    });
    expect(exchanges).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      url: "https://hcis.example/governance/decisions/step-1",
      method: "POST",
      body: { decision: "approve", note: "Disetujui", requestId: "11111111-1111-4111-8111-111111111111" },
    });
  });

  it("refuses an application that takes no decisions, before any exchange", async () => {
    const { service, exchanges } = build();
    await expect(
      service.decide(fresh(), "token", "karir-sq", "step-1", { decision: "approve", requestId: "11111111-1111-4111-8111-111111111111" }),
    ).rejects.toBeInstanceOf(DecisionApplicationUnknownError);
    expect(exchanges).toEqual([]);
  });
});

describe("ORGAN-IMPL-001 §4.2: what the portal does with the application's answer", () => {
  const fresh = () => session(new Date(NOW.getTime() - 60_000));

  it("drops a card whose body does not match the contract instead of showing part of it", async () => {
    const { service } = build({
      respond: () => ({ status: 200, body: { items: [{ ...item, requester: { name: "Pegawai Sintetis" } }] } }),
    });
    await expect(service.list(fresh(), "token")).resolves.toMatchObject({ cards: [{ state: "failed", items: [] }] });
  });

  it("drops a card that carries a field the contract does not define", async () => {
    const { service } = build({
      respond: () => ({ status: 200, body: { items: [{ ...item, decisionNote: "catatan approver lain" }] } }),
    });
    await expect(service.list(fresh(), "token")).resolves.toMatchObject({ cards: [{ state: "failed" }] });
  });

  it("marks one application failed and keeps the others", async () => {
    const karir = { ...HCIS, applicationKey: "karir-sq", name: "Karir SQ", canonicalUrl: "https://karir.example/", decisionAudience: "karir-organ-decision" };
    const { service } = build({
      applications: [HCIS, karir],
      respond: (call) => (call.url.startsWith("https://karir.example") ? { status: 503, body: null } : { status: 200, body: { items: [item] } }),
    });
    const result = await service.list(fresh(), "token");
    expect(result.cards.map((card) => [card.applicationKey, card.state])).toEqual([["hcis", "ready"], ["karir-sq", "failed"]]);
  });

  it("passes the application's refusal through with its own code and status", async () => {
    const { service } = build({ respond: () => ({ status: 409, body: { code: "APPROVAL_STEP_DECIDED", message: "Tahap approval ini sudah diputuskan." } }) });
    const error = await service.decide(fresh(), "token", "hcis", "step-1", {
      decision: "approve",
      requestId: "11111111-1111-4111-8111-111111111111",
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DecisionRefusedError);
    expect(error).toMatchObject({ statusCode: 409, code: "APPROVAL_STEP_DECIDED" });
  });

  it("reports an unreachable application as unavailable rather than as a refusal", async () => {
    const { service, events } = build({ throwOnFetch: true });
    await expect(
      service.decide(fresh(), "token", "hcis", "step-1", { decision: "reject", requestId: "11111111-1111-4111-8111-111111111111" }),
    ).rejects.toBeInstanceOf(DecisionUnavailableError);
    // The attempt is still recorded: the decision may have landed, and the member will resend.
    expect(events).toEqual([{ actorDigest: expect.any(String), applicationKey: "hcis", stepId: "step-1", decision: "reject", statusCode: 599 }]);
  });
});

describe("ORGAN-IMPL-001 §4.2: a request that never went out is not an uncertain result", () => {
  const fresh = () => session(new Date(NOW.getTime() - 60_000));

  it("says the decision was not sent when the exchange fails, and records nothing", async () => {
    const calls: unknown[] = [];
    const events: unknown[] = [];
    const service = new OrganDecisionService({
      applications: { listForIdentity: async () => [HCIS] },
      userAccessToken: async () => "user-access-token",
      exchanger: { exchange: async () => { throw new Error("token exchange failed (400)"); } },
      events: { record: async (input) => { events.push(input); } },
      digestKey: DIGEST_KEY,
      now: () => NOW.getTime(),
      fetch: (async () => { calls.push("fetch"); return new Response("{}"); }) as unknown as typeof fetch,
    });

    await expect(service.decide(fresh(), "token", "hcis", "step-1", {
      decision: "approve", requestId: "11111111-1111-4111-8111-111111111111",
    })).rejects.toBeInstanceOf(DecisionNotSentError);
    // Nothing reached the application, so there is nothing to be uncertain about and nothing to
    // record: telling the member "the result is unclear" would stop them doing the right thing.
    expect(calls).toEqual([]);
    expect(events).toEqual([]);
  });

  it("marks a card failed, not ready, when the list cannot be exchanged for", async () => {
    const service = new OrganDecisionService({
      applications: { listForIdentity: async () => [HCIS] },
      userAccessToken: async () => "user-access-token",
      exchanger: { exchange: async () => { throw new Error("token exchange failed (400)"); } },
      events: { record: async () => undefined },
      digestKey: DIGEST_KEY,
      now: () => NOW.getTime(),
      fetch: (async () => new Response("{}")) as unknown as typeof fetch,
    });
    await expect(service.list(fresh(), "token")).resolves.toMatchObject({ cards: [{ state: "failed" }] });
  });
});

describe("ORGAN-IMPL-001 §4.2: what comes back from the application", () => {
  const fresh = () => session(new Date(NOW.getTime() - 60_000));

  it("accepts any 2xx as taken, not only 200", async () => {
    const { service } = build({ respond: () => ({ status: 202, body: { requestStatus: "approved" } }) });
    await expect(service.decide(fresh(), "token", "hcis", "step-1", {
      decision: "approve", requestId: "11111111-1111-4111-8111-111111111111",
    })).resolves.toMatchObject({ requestStatus: "approved" });
  });

  it("passes on the outcome and drops whatever else the application put in the body", async () => {
    const { service } = build({
      respond: () => ({
        status: 200,
        body: { requestStatus: "approved", stepStatus: "approved", approverName: "Pegawai Sintetis", decisionNote: "catatan" },
      }),
    });
    const result = await service.decide(fresh(), "token", "hcis", "step-1", {
      decision: "approve", requestId: "11111111-1111-4111-8111-111111111111",
    });
    expect(result).toEqual({ requestStatus: "approved", stepStatus: "approved" });
    expect(JSON.stringify(result)).not.toContain("Pegawai Sintetis");
  });
});

describe("ORGAN-IMPL-001 §4.2: the forwarding event", () => {
  const fresh = () => session(new Date(NOW.getTime() - 60_000));

  it("records the digest of the actor and nothing that names anyone", async () => {
    const { service, events } = build({ respond: () => ({ status: 200, body: { requestStatus: "approved" } }) });
    await service.decide(fresh(), "token", "hcis", "step-1", {
      decision: "approve",
      note: "Catatan yang tidak boleh tersimpan di Hub",
      requestId: "11111111-1111-4111-8111-111111111111",
    });

    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event).toEqual({
      actorDigest: createHmac("sha256", DIGEST_KEY).update(`${ISSUER}\nketua`).digest("hex"),
      applicationKey: "hcis",
      stepId: "step-1",
      decision: "approve",
      statusCode: 200,
    });
    const serialised = JSON.stringify(event);
    expect(serialised).not.toContain("ketua");
    expect(serialised).not.toContain("Catatan");
    expect(serialised).not.toContain("Pegawai Sintetis");
  });

  it("derives the digest from issuer and subject together", () => {
    expect(actorDigest({ issuer: ISSUER, subject: "ketua" }, DIGEST_KEY)).toMatch(/^[0-9a-f]{64}$/);
    expect(actorDigest({ issuer: ISSUER, subject: "ketua" }, DIGEST_KEY))
      .not.toBe(actorDigest({ issuer: ISSUER, subject: "sekretaris" }, DIGEST_KEY));
  });

  // Unkeyed, the digest would be a plain hash over a handful of subjects that sit in this same
  // database, so anyone who could read the event table could undo it by trying them all.
  it("cannot be recomputed without the key", () => {
    const identity = { issuer: ISSUER, subject: "ketua" };
    expect(actorDigest(identity, DIGEST_KEY)).not.toBe(actorDigest(identity, "another-secret"));
  });
});
