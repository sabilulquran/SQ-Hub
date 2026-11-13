import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import type { GovernanceService } from "../src/modules/governance/service.js";
import { assertOrganPortalDistinct, loadOrganPortalConfig } from "../src/modules/organ-portal/config.js";
import type { HubOidcAuthorizationTransaction, HubOidcProviderLike } from "../src/modules/hub-auth/oidc-provider.js";
import type { HubAuthStore, HubSessionClient, HubSessionIdentity, HubSessionRecord } from "../src/modules/hub-auth/repository.js";
import { HubAuthService } from "../src/modules/hub-auth/service.js";
import { HubTokenVault } from "../src/modules/hub-auth/token-vault.js";
import {
  ORGAN_OIDC_TRANSACTION_COOKIE_NAME,
  ORGAN_SESSION_COOKIE_NAME,
  registerOrganAuthRoutes,
  registerOrganRoutes,
} from "../src/modules/organ-portal/routes.js";

// ORGAN-IMPL-001 R1: host, client-bound session, membership gate. Synthetic identities only.
const ORIGIN = "https://organ.sabilulquran.or.id";
const HOST = { host: "organ.sabilulquran.or.id" };
const ISSUER = "https://login.example/realms/sq-staff";

/** Honours the client binding the way the PostgreSQL repository does. */
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
  async createSession(input: { tokenHash: string; identity: HubSessionIdentity; expiresAt: Date; clientId?: string | null }) {
    const record = { ...input.identity, sessionId: `s${this.sessions.size + 1}`, accountRefreshTokenCiphertext: null, createdAt: new Date(), expiresAt: input.expiresAt, clientId: input.clientId ?? null };
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

function provider(subject: string): HubOidcProviderLike {
  return {
    async createAuthorizationRequest() {
      return { url: new URL("https://login.example/realms/sq-staff/auth?client_id=sq-organ"), transaction: { state: "s", codeVerifier: "v", nonce: "n" } };
    },
    async completeAuthorization() {
      return { identity: { issuer: ISSUER, subject, displayName: "Anggota Sintetis", username: null, email: null, emailVerified: null }, refreshToken: null };
    },
    async refreshAccountAccess() {
      throw new Error("unused");
    },
    async buildLogoutUrl() {
      return new URL("https://login.example/logout");
    },
  };
}

function setup(options: { subject?: string; members?: Set<string>; access?: Set<string> } = {}) {
  const store = new MemoryStore();
  const members = options.members ?? new Set(["ketua"]);
  const access = options.access ?? new Set(["ketua"]);
  const auth = new HubAuthService(
    store,
    provider(options.subject ?? "ketua"),
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
    access: { checkAccess: async (identity: { subject: string }, key: string) => ({ allowed: key === "organ" && access.has(identity.subject) }) },
    memberships: {
      getEffective: async (identity: { subject: string }) => (members.has(identity.subject) ? { organ: "pengurus" as const, positionLabel: "Ketua Pengurus" } : null),
    },
  };
  const snapshots: string[] = [];
  const governance = {
    snapshot: async (session: HubSessionRecord) => {
      snapshots.push(session.subject);
      return { membership: { organ: "pengurus" }, cards: [], generatedAt: "2026-11-12T00:00:00.000Z" };
    },
  } as unknown as GovernanceService;
  const app = Fastify();
  registerOrganAuthRoutes(app, { auth, publicOrigin: ORIGIN, gate });
  registerOrganRoutes(app, { auth, governance, publicOrigin: ORIGIN, gate });
  return { app, store, members, access, snapshots };
}

async function signIn(app: ReturnType<typeof Fastify>) {
  const start = await app.inject({ method: "GET", url: "/auth/oidc/start", headers: HOST });
  const tx = String(start.headers["set-cookie"]).split(";")[0]!;
  return app.inject({ method: "GET", url: "/auth/callback?code=abc&state=s", headers: { ...HOST, cookie: tx } });
}

function sessionCookie(response: Awaited<ReturnType<typeof signIn>>) {
  const cookies = ([] as string[]).concat((response.headers["set-cookie"] as string[] | string | undefined) ?? []);
  return cookies.find((cookie) => cookie.startsWith(`${ORGAN_SESSION_COOKIE_NAME}=`) && !cookie.includes("Max-Age=0"))?.split(";")[0];
}

describe("ORGAN-IMPL-001 R1 portal", () => {
  it("answers only on the organ host", async () => {
    const { app } = setup();
    for (const url of ["/auth/oidc/start", "/organ/session", "/organ/summaries"]) {
      expect((await app.inject({ method: "GET", url, headers: { host: "hub.sabilulquran.or.id" } })).statusCode).toBe(404);
    }
    const start = await app.inject({ method: "GET", url: "/auth/oidc/start", headers: HOST });
    expect(start.headers.location).toContain("client_id=sq-organ");
    expect(String(start.headers["set-cookie"])).toMatch(/^sq_organ_oidc_tx=/);
  });

  it("admits an effective member with portal access and serves the session and summaries", async () => {
    const { app, snapshots } = setup();
    const callback = await signIn(app);
    expect(callback.headers.location).toBe("/");
    const cookie = sessionCookie(callback)!;
    expect(cookie).toMatch(/^sq_organ_session=/);

    const session = await app.inject({ method: "GET", url: "/organ/session", headers: { ...HOST, cookie } });
    expect(session.statusCode).toBe(200);
    expect(session.headers["cache-control"]).toBe("no-store");
    expect(session.json()).toEqual({ user: { displayName: "Anggota Sintetis" }, membership: { organ: "pengurus", positionLabel: "Ketua Pengurus" } });

    const summaries = await app.inject({ method: "GET", url: "/organ/summaries", headers: { ...HOST, cookie } });
    expect(summaries.statusCode).toBe(200);
    expect(snapshots).toEqual(["ketua"]);
  });

  it.each([
    ["no effective membership", { members: new Set<string>() }, "organ_membership_required"],
    ["no Application Access to the portal", { access: new Set<string>() }, "organ_access_denied"],
  ])("refuses %s at the callback and keeps no session", async (_label, options, code) => {
    const { app, store } = setup(options);
    const callback = await signIn(app);
    expect(callback.headers.location).toBe(`/?authError=${code}`);
    expect(sessionCookie(callback)).toBeUndefined();
    expect(store.sessions.size).toBe(0);
  });

  it("re-checks the gate on every request, so an ended membership stops at once", async () => {
    const { app, members, snapshots } = setup();
    const cookie = sessionCookie(await signIn(app))!;
    members.delete("ketua");
    const session = await app.inject({ method: "GET", url: "/organ/session", headers: { ...HOST, cookie } });
    expect(session.statusCode).toBe(403);
    expect(session.json()).toEqual({ error: "organ_membership_required" });
    const summaries = await app.inject({ method: "GET", url: "/organ/summaries", headers: { ...HOST, cookie } });
    expect(summaries.statusCode).toBe(403);
    expect(snapshots).toEqual([]);
  });

  it("refuses a session issued to another client presented under the portal cookie (§1.2)", async () => {
    const { app, store } = setup();
    const cookie = sessionCookie(await signIn(app))!;
    const token = cookie.split("=")[1]!;
    for (const [hash, record] of store.sessions) store.sessions.set(hash, { ...record, clientId: "sq-hub" });
    const response = await app.inject({ method: "GET", url: "/organ/session", headers: { ...HOST, cookie: `${ORGAN_SESSION_COOKIE_NAME}=${token}` } });
    expect(response.statusCode).toBe(401);
  });

  it("logs out only from the portal origin", async () => {
    const { app } = setup();
    const cookie = sessionCookie(await signIn(app))!;
    const crossOrigin = await app.inject({ method: "POST", url: "/auth/logout", headers: { ...HOST, origin: "https://hub.sabilulquran.or.id", cookie } });
    expect(crossOrigin.statusCode).toBe(403);
    const logout = await app.inject({ method: "POST", url: "/auth/logout", headers: { ...HOST, origin: ORIGIN, cookie } });
    expect(logout.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/organ/session", headers: { ...HOST, cookie } })).statusCode).toBe(401);
  });
});

describe("ORGAN-IMPL-001 §12 configuration", () => {
  const env = {
    PORTAL_ORGAN_ENABLED: "true",
    ORGAN_OIDC_CLIENT_ID: "sq-organ",
    ORGAN_OIDC_CLIENT_SECRET: "synthetic",
    ORGAN_PUBLIC_ORIGIN: "https://organ.sabilulquran.or.id/",
  };

  it("is off by default and needs every value when on", () => {
    expect(loadOrganPortalConfig({})).toBeNull();
    expect(() => loadOrganPortalConfig({ PORTAL_ORGAN_ENABLED: "true" })).toThrow(/required/);
    expect(loadOrganPortalConfig(env)).toEqual({
      oidc: { clientId: "sq-organ", clientSecret: "synthetic" },
      publicOrigin: "https://organ.sabilulquran.or.id",
      applicationKey: "organ",
    });
  });

  it("refuses a client id or host shared with SQ Hub, Kirim or Kerja", () => {
    const config = loadOrganPortalConfig(env)!;
    expect(() => assertOrganPortalDistinct(config, { clientIds: ["sq-hub", undefined], origins: ["https://hub.sabilulquran.or.id"] })).not.toThrow();
    expect(() => assertOrganPortalDistinct(config, { clientIds: ["sq-organ"], origins: [] })).toThrow(/ORGAN_OIDC_CLIENT_ID/);
    expect(() => assertOrganPortalDistinct(config, { clientIds: [], origins: ["https://organ.sabilulquran.or.id:443"] })).toThrow(/ORGAN_PUBLIC_ORIGIN/);
  });
});
