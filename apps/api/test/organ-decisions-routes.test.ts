import Fastify from "fastify";
import { vi, describe, expect, it } from "vitest";

import type { GovernanceService } from "../src/modules/governance/service.js";
import type { HubOidcAuthorizationTransaction, HubOidcProviderLike, HubOidcStepUp } from "../src/modules/hub-auth/oidc-provider.js";
import type { HubAuthStore, HubSessionClient, HubSessionIdentity, HubSessionRecord } from "../src/modules/hub-auth/repository.js";
import { HubAuthService } from "../src/modules/hub-auth/service.js";
import { HubTokenVault } from "../src/modules/hub-auth/token-vault.js";
import { StepUpRequiredError, type OrganDecisionService } from "../src/modules/organ-decisions/service.js";
import {
  ORGAN_OIDC_TRANSACTION_COOKIE_NAME,
  ORGAN_SESSION_COOKIE_NAME,
  registerOrganAuthRoutes,
  registerOrganRoutes,
} from "../src/modules/organ-portal/routes.js";

// ORGAN-IMPL-001 §4.2 (R2) at the route edge. Synthetic identities only.

const ORIGIN = "https://organ.sabilulquran.or.id";
const HOST = { host: "organ.sabilulquran.or.id" };
const ISSUER = "https://login.example/realms/sq-staff";
const STEP = "step-1";
const ACTION = "11111111-1111-4111-8111-111111111111";

class MemoryStore implements HubAuthStore {
  transactions = new Map<string, { transaction: HubOidcAuthorizationTransaction; expiresAt: Date }>();
  sessions = new Map<string, HubSessionRecord & { clientId: string | null }>();
  async createTransaction(input: { tokenHash: string; transaction: HubOidcAuthorizationTransaction; expiresAt: Date }) {
    this.transactions.set(input.tokenHash, input);
  }
  async consumeTransaction(tokenHash: string) {
    const found = this.transactions.get(tokenHash) ?? null;
    this.transactions.delete(tokenHash);
    return found;
  }
  async createSession(input: { tokenHash: string; identity: HubSessionIdentity; expiresAt: Date; clientId?: string | null; steppedUpAt?: Date | null }) {
    const record = {
      ...input.identity,
      sessionId: `s${this.sessions.size + 1}`,
      accountRefreshTokenCiphertext: null,
      createdAt: new Date(),
      expiresAt: input.expiresAt,
      steppedUpAt: input.steppedUpAt ?? null,
      clientId: input.clientId ?? null,
    };
    this.sessions.set(input.tokenHash, record);
    return record;
  }
  async getSession(tokenHash: string, _idle: number, client?: HubSessionClient) {
    const found = this.sessions.get(tokenHash);
    if (!found) return null;
    if (client && found.clientId !== client.clientId && !(client.acceptLegacy && found.clientId === null)) return null;
    return found;
  }
  async updateAccountRefreshToken() {}
  async revokeSession(tokenHash: string) {
    this.sessions.delete(tokenHash);
  }
}

function provider(seen: { stepUp?: HubOidcStepUp | undefined }, completion: { acr?: string | null; authTime?: number | null } = {}): HubOidcProviderLike {
  return {
    async createAuthorizationRequest(_action, stepUp) {
      seen.stepUp = stepUp;
      const url = new URL("https://login.example/realms/sq-staff/auth?client_id=sq-organ");
      if (stepUp) {
        url.searchParams.set("acr_values", stepUp.acr);
        url.searchParams.set("max_age", String(stepUp.maxAgeSeconds));
      }
      return { url, transaction: { state: "s", codeVerifier: "v", nonce: "n", ...(stepUp ? { stepUp } : {}) } };
    },
    async completeAuthorization() {
      return {
        identity: { issuer: ISSUER, subject: "ketua", displayName: "Anggota Sintetis", username: null, email: null, emailVerified: null },
        refreshToken: null,
        acr: completion.acr ?? null,
        authTime: completion.authTime ?? null,
      };
    },
    async refreshAccountAccess() {
      throw new Error("unused");
    },
    async buildLogoutUrl() {
      return new URL("https://login.example/logout");
    },
  };
}

function setup(options: { decisions?: Partial<OrganDecisionService>; completion?: { acr?: string | null; authTime?: number | null } } = {}) {
  const store = new MemoryStore();
  const seen: { stepUp?: HubOidcStepUp | undefined } = {};
  const auth = new HubAuthService(
    store,
    provider(seen, options.completion ?? {}),
    { listAuthorizedApplications: async () => [] },
    {
      sessionIdleHours: 8,
      sessionMaxHours: 12,
      transactionTtlMinutes: 10,
      secureCookies: true,
      cookieNames: { session: ORGAN_SESSION_COOKIE_NAME, transaction: ORGAN_OIDC_TRANSACTION_COOKIE_NAME },
      sessionClientId: "sq-organ",
    },
    new HubTokenVault("organ-secret"),
  );
  const gate = {
    applicationKey: "organ",
    access: { checkAccess: async (_identity: { subject: string }, key: string) => ({ allowed: key === "organ" }) },
    memberships: { getEffective: async () => ({ organ: "pengurus" as const, positionLabel: "Ketua Pengurus" }) },
  };
  const governance = {
    snapshot: async () => ({ membership: { organ: "pengurus" }, cards: [], generatedAt: "2026-11-17T00:00:00.000Z" }),
  } as unknown as GovernanceService;

  const app = Fastify();
  registerOrganAuthRoutes(app, { auth, publicOrigin: ORIGIN, gate });
  registerOrganRoutes(app, {
    auth,
    governance,
    publicOrigin: ORIGIN,
    gate,
    ...(options.decisions ? { decisions: options.decisions as OrganDecisionService } : {}),
  });
  return { app, seen, store };
}

async function signIn(app: ReturnType<typeof Fastify>, url = "/auth/oidc/start") {
  const start = await app.inject({ method: "GET", url, headers: HOST });
  const tx = String(start.headers["set-cookie"]).split(";")[0]!;
  const callback = await app.inject({ method: "GET", url: "/auth/callback?code=abc&state=s", headers: { ...HOST, cookie: tx } });
  const cookies = ([] as string[]).concat((callback.headers["set-cookie"] as string[] | string | undefined) ?? []);
  return {
    start,
    callback,
    cookie: cookies.find((cookie) => cookie.startsWith(`${ORGAN_SESSION_COOKIE_NAME}=`) && !cookie.includes("Max-Age=0"))?.split(";")[0],
  };
}

describe("ORGAN-IMPL-001 §4.2: the decision routes exist only when R2 is on", () => {
  it("answers 404 on both routes while deciding is switched off", async () => {
    const { app } = setup();
    const { cookie } = await signIn(app);
    const list = await app.inject({ method: "GET", url: "/organ/decisions", headers: { ...HOST, cookie: cookie! } });
    const decide = await app.inject({
      method: "POST",
      url: `/organ/decisions/hcis/${STEP}`,
      headers: { ...HOST, cookie: cookie!, origin: ORIGIN },
      payload: { decision: "approve", requestId: ACTION },
    });
    await app.close();
    expect(list.statusCode).toBe(404);
    expect(decide.statusCode).toBe(404);
  });

  it("serves the list and forwards one decision when it is on", async () => {
    const calls: unknown[] = [];
    const { app } = setup({
      decisions: {
        list: async () => ({ cards: [{ applicationKey: "hcis", name: "HCIS", state: "ready" as const, items: [] }], generatedAt: "2026-11-17T00:00:00.000Z" }),
        decide: async (...args: unknown[]) => {
          calls.push(args.slice(2));
          return { requestStatus: "approved" };
        },
      } as unknown as Partial<OrganDecisionService>,
    });
    const { cookie } = await signIn(app);
    const list = await app.inject({ method: "GET", url: "/organ/decisions", headers: { ...HOST, cookie: cookie! } });
    const decide = await app.inject({
      method: "POST",
      url: `/organ/decisions/hcis/${STEP}`,
      headers: { ...HOST, cookie: cookie!, origin: ORIGIN },
      payload: { decision: "approve", requestId: ACTION, note: "Disetujui" },
    });
    await app.close();

    expect(list.statusCode).toBe(200);
    expect(list.json().cards).toHaveLength(1);
    expect(decide.statusCode).toBe(200);
    expect(calls).toEqual([["hcis", STEP, { decision: "approve", requestId: ACTION, note: "Disetujui" }]]);
  });

  it("refuses a decision posted from another origin, before the service is reached", async () => {
    let reached = false;
    const { app } = setup({
      decisions: { decide: async () => { reached = true; return {}; } } as unknown as Partial<OrganDecisionService>,
    });
    const { cookie } = await signIn(app);
    const response = await app.inject({
      method: "POST",
      url: `/organ/decisions/hcis/${STEP}`,
      headers: { ...HOST, cookie: cookie!, origin: "https://evil.example" },
      payload: { decision: "approve", requestId: ACTION },
    });
    await app.close();
    expect(response.statusCode).toBe(403);
    expect(reached).toBe(false);
  });

  it("refuses a body the decision contract does not allow", async () => {
    const { app } = setup({ decisions: { decide: async () => ({}) } as unknown as Partial<OrganDecisionService> });
    const { cookie } = await signIn(app);
    const headers = { ...HOST, cookie: cookie!, origin: ORIGIN };
    const noRequestId = await app.inject({ method: "POST", url: `/organ/decisions/hcis/${STEP}`, headers, payload: { decision: "approve" } });
    const unknownDecision = await app.inject({ method: "POST", url: `/organ/decisions/hcis/${STEP}`, headers, payload: { decision: "maybe", requestId: ACTION } });
    await app.close();
    expect(noRequestId.statusCode).toBe(400);
    expect(unknownDecision.statusCode).toBe(400);
  });

  it("turns a stale step-up into a redirect the browser can follow", async () => {
    const { app } = setup({
      decisions: {
        list: async () => { throw new StepUpRequiredError("stale"); },
      } as unknown as Partial<OrganDecisionService>,
    });
    const { cookie } = await signIn(app);
    const response = await app.inject({ method: "GET", url: "/organ/decisions", headers: { ...HOST, cookie: cookie! } });
    await app.close();
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "step_up_required", stepUpPath: "/api/auth/oidc/start?stepUp=1" });
  });
});

describe("ORGAN-IMPL-001 §4.2 step 2: the step-up itself", () => {
  it("asks the realm for the TOTP level and a fresh authentication only when asked to", async () => {
    const { app, seen } = setup();
    const plain = await app.inject({ method: "GET", url: "/auth/oidc/start", headers: HOST });
    expect(seen.stepUp).toBeUndefined();
    expect(plain.headers.location).not.toContain("acr_values");

    const stepUp = await app.inject({ method: "GET", url: "/auth/oidc/start?stepUp=1", headers: HOST });
    await app.close();
    expect(seen.stepUp).toEqual({ acr: "2", maxAgeSeconds: 900 });
    expect(stepUp.headers.location).toContain("acr_values=2");
    expect(stepUp.headers.location).toContain("max_age=900");
  });

  it("records the step-up only when the realm actually answered with the level asked for", async () => {
    const authTime = Math.floor(Date.now() / 1000) - 30;
    const proved = setup({ completion: { acr: "2", authTime } });
    const { cookie } = await signIn(proved.app, "/auth/oidc/start?stepUp=1");
    expect(cookie).toBeDefined();
    const session = [...proved.store.sessions.values()][0]!;
    expect(session.steppedUpAt?.getTime()).toBe(authTime * 1000);
    await proved.app.close();
  });

  it.each([
    ["a lower level", { acr: "1", authTime: Math.floor(Date.now() / 1000) }],
    ["no level at all", { acr: null, authTime: Math.floor(Date.now() / 1000) }],
    ["an authentication older than the window", { acr: "2", authTime: Math.floor(Date.now() / 1000) - 1200 }],
    ["no auth_time to judge", { acr: "2", authTime: null }],
  ])("refuses the sign-in when the realm answers with %s", async (_label, completion) => {
    const { app, store } = setup({ completion });
    const warn = vi.spyOn(app.log, "warn");
    const { callback } = await signIn(app, "/auth/oidc/start?stepUp=1");
    await app.close();
    expect(warn).toHaveBeenCalledWith(
      { event: "oidc_callback_refused", client: "organ", code: "OIDC_STEP_UP_FAILED" },
      "OIDC callback refused",
    );
    // The refusal lands on the portal's own page; no session, so nothing can be decided with it.
    // It has its own category, so the web entry does not retry it as an ordinary sign-in.
    expect(callback.headers.location).toBe("/?authError=organ_step_up_failed");
    expect(store.sessions.size).toBe(0);
  });

  it("leaves an ordinary sign-in without a step-up stamp", async () => {
    const { app, store } = setup({ completion: { acr: "2", authTime: Math.floor(Date.now() / 1000) } });
    await signIn(app);
    await app.close();
    expect([...store.sessions.values()][0]!.steppedUpAt).toBeNull();
  });
});
