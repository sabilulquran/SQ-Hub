import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { HubSessionRecord } from "../src/modules/hub-auth/repository.js";
import { HubAuthError, type HubAuthRuntime } from "../src/modules/hub-auth/service.js";
import {
  GovernanceForbiddenError,
  GovernanceService,
  type GovernanceApplication,
  type GovernanceLogEntry,
  type ObservationOutcome,
} from "../src/modules/governance/service.js";
import { KeycloakTokenExchanger, type TokenExchanger } from "../src/modules/governance/token-exchange.js";
import { summaryFor } from "./governance.fixture.js";

const issuer = "https://login.example.test/realms/sq-staff";
const session: HubSessionRecord = {
  sessionId: "session-governance-1",
  issuer,
  subject: "member-subject",
  displayName: "Pengurus Sintetis",
  username: "pengurus@example.test",
  email: "pengurus@example.test",
  emailVerified: true,
  accountRefreshTokenCiphertext: "sealed",
  createdAt: new Date("2026-10-17T00:00:00Z"),
  expiresAt: new Date("2026-10-17T12:00:00Z"),
};

const app = (key: string, order: number): GovernanceApplication => ({
  applicationKey: key,
  name: key.toUpperCase(),
  canonicalUrl: `https://${key}.example.test`,
  summaryPath: "/api/governance/summary",
  audience: `${key}-governance`,
  order,
});

type Responder = (url: URL, token: string, signal: AbortSignal) => Promise<Response>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function hang(signal: AbortSignal): Promise<Response> {
  return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
}

function harness(options: {
  applications?: GovernanceApplication[];
  responders?: Record<string, Responder>;
  member?: boolean;
  timeoutMs?: number;
  exchanger?: TokenExchanger;
} = {}) {
  let now = Date.parse("2026-10-17T03:00:00Z");
  let applications = options.applications ?? [app("hcis", 1), app("aset", 2)];
  let member = options.member ?? true;
  const exchanges: Array<{ subject: string; audience: string }> = [];
  const requests: Array<{ url: string; token: string }> = [];
  const logs: GovernanceLogEntry[] = [];
  const observations: Array<{ key: string; outcome: ObservationOutcome }> = [];
  const responders: Record<string, Responder> = {
    hcis: async (url) => json(summaryFor("hcis", url.origin)),
    aset: async (url) => json(summaryFor("aset", url.origin)),
    ...options.responders,
  };
  const service = new GovernanceService({
    memberships: { getEffective: async () => (member ? { organ: "pengurus" as const, positionLabel: "Ketua Pengurus" } : null) },
    applications: { listForIdentity: async () => applications },
    userAccessToken: async () => "hub-user-access-token",
    exchanger: options.exchanger ?? {
      exchange: async (subject, audience) => {
        exchanges.push({ subject, audience });
        return `exchanged-for-${audience}`;
      },
    },
    fetch: (async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const token = String((init?.headers as Record<string, string>).Authorization).replace("Bearer ", "");
      requests.push({ url: url.href, token });
      const key = url.hostname.split(".")[0]!;
      return responders[key]!(url, token, init!.signal!);
    }) as typeof fetch,
    observations: {
      record: async (_identity, key, outcome) => { observations.push({ key, outcome }); },
      list: async () => [],
    },
    log: (entry) => logs.push(entry),
    now: () => now,
    timeoutMs: options.timeoutMs ?? 3000,
  });
  return {
    service,
    exchanges,
    requests,
    logs,
    observations,
    advance: (ms: number) => { now += ms; },
    setApplications: (next: GovernanceApplication[]) => { applications = next; },
    setMember: (next: boolean) => { member = next; },
  };
}

describe("Governance fetch layer (HUB-IMPL-021 §4)", () => {
  it("refuses without an effective membership (AC 1)", async () => {
    const { service, requests } = harness({ member: false });
    await expect(service.snapshot(session, "opaque")).rejects.toBeInstanceOf(GovernanceForbiddenError);
    expect(requests).toEqual([]);
  });

  it("exchanges per audience and sends each token only to its own application (AC 4, 8)", async () => {
    const { service, exchanges, requests } = harness();
    const snapshot = await service.snapshot(session, "opaque");
    expect(snapshot.membership).toEqual({ organ: "pengurus", positionLabel: "Ketua Pengurus" });
    expect(snapshot.cards.map((card) => `${card.applicationKey}:${card.state}`)).toEqual(["hcis:ready", "aset:ready"]);
    expect(exchanges).toEqual([
      { subject: "hub-user-access-token", audience: "hcis-governance" },
      { subject: "hub-user-access-token", audience: "aset-governance" },
    ]);
    expect(requests).toEqual([
      { url: "https://hcis.example.test/api/governance/summary", token: "exchanged-for-hcis-governance" },
      { url: "https://aset.example.test/api/governance/summary", token: "exchanged-for-aset-governance" },
    ]);
  });

  it("hides cards on 403/404 and fails on 5xx or an invalid body (AC 5)", async () => {
    const cases: Array<[Responder, string | null, ObservationOutcome]> = [
      [async () => json({ error: "FORBIDDEN" }, 403), null, "forbidden"],
      [async () => json({ error: "NOT_FOUND" }, 404), null, "not_found"],
      [async () => json({ error: "BOOM" }, 503), "failed", "failed"],
      [async () => json({ contractVersion: 1 }), "failed", "failed"],
      [async () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }), "failed", "failed"],
    ];
    for (const [responder, state, outcome] of cases) {
      const { service, observations } = harness({ responders: { hcis: responder } });
      const snapshot = await service.snapshot(session, "opaque");
      const card = snapshot.cards.find((item) => item.applicationKey === "hcis");
      expect(card?.state ?? null).toBe(state);
      if (card?.state === "failed") expect(card.name).toBe("HCIS");
      expect(snapshot.cards.find((item) => item.applicationKey === "aset")?.state).toBe("ready");
      expect(observations.find((item) => item.key === "hcis")?.outcome).toBe(outcome);
    }
  });

  it("times out one slow application without delaying the others beyond the budget (AC 5)", async () => {
    const { service, logs } = harness({ timeoutMs: 150, responders: { hcis: async (_url, _token, signal) => hang(signal) } });
    const started = Date.now();
    const snapshot = await service.snapshot(session, "opaque");
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(1000);
    expect(snapshot.cards.map((card) => `${card.applicationKey}:${card.state}`)).toEqual(["hcis:failed", "aset:ready"]);
    expect(logs.find((entry) => entry.applicationKey === "hcis")?.status).toBe("timeout");
  });

  it("treats a failed token exchange as a failed card", async () => {
    const { service } = harness({ exchanger: { exchange: async () => { throw new Error("400 invalid_request"); } } });
    const snapshot = await service.snapshot(session, "opaque");
    expect(snapshot.cards.every((card) => card.state === "failed")).toBe(true);
  });

  it("drops a card with a mismatched applicationKey or a foreign link (AC 6)", async () => {
    const { service, observations } = harness({
      responders: {
        hcis: async (url) => json(summaryFor("aset", url.origin)),
        aset: async () => json(summaryFor("aset", "https://evil.example.test")),
      },
    });
    const snapshot = await service.snapshot(session, "opaque");
    expect(snapshot.cards).toEqual([]);
    expect(observations.map((item) => item.outcome)).toEqual(["dropped", "dropped"]);
  });

  it("never exposes tokens or logs summary bodies (AC 7)", async () => {
    const { service, logs } = harness();
    const snapshot = await service.snapshot(session, "opaque");
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("exchanged-for");
    expect(serialized).not.toContain("hub-user-access-token");
    for (const entry of logs) expect(Object.keys(entry).sort()).toEqual(["applicationKey", "latencyMs", "status"]);
    expect(JSON.stringify(logs)).not.toContain("Pegawai aktif");
  });

  it("caches per session for at most 60 seconds and re-checks eligibility every request (AC 10)", async () => {
    const { service, requests, advance, setApplications, setMember } = harness();
    await service.snapshot(session, "opaque");
    await service.snapshot(session, "opaque");
    expect(requests).toHaveLength(2);
    await service.snapshot({ ...session, sessionId: "another-session" }, "opaque");
    expect(requests).toHaveLength(4);
    advance(60_001);
    await service.snapshot(session, "opaque");
    expect(requests).toHaveLength(6);
    // Application Access revoked for aset: the card disappears on the next request.
    setApplications([app("hcis", 1)]);
    expect((await service.snapshot(session, "opaque")).cards.map((card) => card.applicationKey)).toEqual(["hcis"]);
    setMember(false);
    await expect(service.snapshot(session, "opaque")).rejects.toBeInstanceOf(GovernanceForbiddenError);
  });

  it("does not cache failures; a retry for one application bypasses the cache", async () => {
    let fail = true;
    const { service, requests } = harness({ responders: { hcis: async (url) => (fail ? json({}, 500) : json(summaryFor("hcis", url.origin))) } });
    expect((await service.snapshot(session, "opaque")).cards[0]?.state).toBe("failed");
    fail = false;
    const retried = await service.snapshot(session, "opaque", { only: "hcis" });
    expect(retried.cards.map((card) => `${card.applicationKey}:${card.state}`)).toEqual(["hcis:ready"]);
    expect(requests.filter((request) => request.url.includes("hcis"))).toHaveLength(2);
  });
});

describe("Keycloak token exchange request", () => {
  it("asks for an access token for one audience with its governance scope and no refresh token", async () => {
    const calls: Array<{ url: string; body: URLSearchParams }> = [];
    const exchanger = new KeycloakTokenExchanger({
      issuer: `${issuer}/`,
      clientId: "sq-hub",
      clientSecret: "test-only-client-secret",
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, body: init.body as URLSearchParams });
        return json({ access_token: "exchanged", token_type: "Bearer" });
      }) as unknown as typeof fetch,
    });
    await expect(exchanger.exchange("subject-token", "hcis", new AbortController().signal)).resolves.toBe("exchanged");
    expect(calls[0]!.url).toBe(`${issuer}/protocol/openid-connect/token`);
    const body = Object.fromEntries(calls[0]!.body);
    expect(body).toMatchObject({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      audience: "hcis",
      scope: "sq-governance-hcis",
    });
  });

  it("fails closed on a refused exchange", async () => {
    const exchanger = new KeycloakTokenExchanger({
      issuer, clientId: "sq-hub", clientSecret: "test-only-client-secret",
      fetch: (async () => json({ error: "invalid_request" }, 400)) as unknown as typeof fetch,
    });
    await expect(exchanger.exchange("subject-token", "evil", new AbortController().signal)).rejects.toMatchObject({ status: 400 });
  });
});

describe("Browser contract routes", () => {
  function hub(overrides: Partial<HubAuthRuntime> = {}): HubAuthRuntime {
    return {
      beginLogin: async () => ({ authorizationUrl: new URL("https://login.example.test"), setCookie: "" }),
      completeLogin: async () => ({ setCookies: [], returnPath: "/" }),
      getWorkspace: async () => { throw new Error("unused"); },
      getSession: async () => session,
      getAccountAccess: async () => ({ session, accessToken: "unused" }),
      logout: async () => ({ clearCookie: "", logoutUrl: null }),
      clearTransactionCookie: () => "",
      ...overrides,
    };
  }

  function appWith(service: GovernanceService, hubAuth = hub()) {
    return buildApp({
      accessService: { checkAccess: async () => ({ allowed: true, applicationKey: "hcis", decision: "active_grant" }) },
      verifyMachineToken: async () => ({ clientId: "synthetic" }),
      hubAuth,
      hubRedirectUri: "https://hub.example.test/auth/callback",
      governance: service,
    });
  }

  it("returns 401 without a session and 403 without an effective membership (AC 1)", async () => {
    const unauthenticated = appWith(harness().service, hub({ getSession: async () => { throw new HubAuthError(401, "UNAUTHENTICATED", "x"); } }));
    const noSession = await unauthenticated.inject({ method: "GET", url: "/governance/summaries" });
    await unauthenticated.close();
    expect(noSession.statusCode).toBe(401);

    const forbidden = appWith(harness({ member: false }).service);
    const response = await forbidden.inject({ method: "GET", url: "/governance/summaries", headers: { cookie: "sq_hub_session=opaque" } });
    await forbidden.close();
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "GOVERNANCE_FORBIDDEN" });
  });

  it("returns the snapshot with no-store and a single-card retry", async () => {
    const server = appWith(harness().service);
    const response = await server.inject({ method: "GET", url: "/governance/summaries", headers: { cookie: "sq_hub_session=opaque" } });
    const retry = await server.inject({ method: "GET", url: "/governance/summaries/aset", headers: { cookie: "sq_hub_session=opaque" } });
    await server.close();
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json().cards).toHaveLength(2);
    expect(response.body).not.toContain("exchanged-for");
    expect(retry.json().card.applicationKey).toBe("aset");
  });
});
