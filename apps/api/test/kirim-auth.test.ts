import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import type { HubOidcAuthorizationTransaction, HubOidcProviderLike } from "../src/modules/hub-auth/oidc-provider.js";
import type { HubAuthStore, HubSessionIdentity, HubSessionRecord } from "../src/modules/hub-auth/repository.js";
import { registerHubAuthRoutes } from "../src/modules/hub-auth/routes.js";
import { HubAuthService } from "../src/modules/hub-auth/service.js";
import { HubTokenVault } from "../src/modules/hub-auth/token-vault.js";
import {
  KIRIM_OIDC_TRANSACTION_COOKIE_NAME,
  KIRIM_SESSION_COOKIE_NAME,
  registerKirimAuthRoutes,
} from "../src/modules/kirim/routes-admin.js";

const ORIGIN = "https://kirim.sabilulquran.or.id";

class MemoryStore implements HubAuthStore {
  transactions = new Map<string, { transaction: HubOidcAuthorizationTransaction; expiresAt: Date }>();
  sessions = new Map<string, HubSessionRecord>();
  async createTransaction(input: { tokenHash: string; transaction: HubOidcAuthorizationTransaction; expiresAt: Date }) {
    this.transactions.set(input.tokenHash, input);
  }
  async consumeTransaction(tokenHash: string) {
    const found = this.transactions.get(tokenHash) ?? null;
    this.transactions.delete(tokenHash);
    return found;
  }
  async createSession(input: { tokenHash: string; identity: HubSessionIdentity; expiresAt: Date }) {
    const record: HubSessionRecord = { ...input.identity, sessionId: "s1", accountRefreshTokenCiphertext: null, createdAt: new Date(), expiresAt: input.expiresAt };
    this.sessions.set(input.tokenHash, record);
    return record;
  }
  async getSession(tokenHash: string) {
    return this.sessions.get(tokenHash) ?? null;
  }
  async updateAccountRefreshToken() {}
  async revokeSession(tokenHash: string) {
    this.sessions.delete(tokenHash);
  }
}

function setup() {
  const callbacks: URL[] = [];
  const provider: HubOidcProviderLike = {
    async createAuthorizationRequest() {
      return { url: new URL("https://login.example/realms/sq-staff/auth?client_id=kirim-sq"), transaction: { state: "s", codeVerifier: "v", nonce: "n" } };
    },
    async completeAuthorization(url) {
      callbacks.push(url);
      return { identity: { issuer: "https://login.example/realms/sq-staff", subject: "kepala-hcm", displayName: "Kepala HCM", username: null, email: null, emailVerified: null }, refreshToken: null };
    },
    async refreshAccountAccess() {
      throw new Error("unused");
    },
    async buildLogoutUrl() {
      return new URL("https://login.example/logout");
    },
  };
  const auth = new HubAuthService(
    new MemoryStore(),
    provider,
    { listAuthorizedApplications: async () => [] },
    {
      sessionIdleHours: 8,
      sessionMaxHours: 12,
      transactionTtlMinutes: 10,
      secureCookies: true,
      cookieNames: { session: KIRIM_SESSION_COOKIE_NAME, transaction: KIRIM_OIDC_TRANSACTION_COOKIE_NAME },
    },
    new HubTokenVault("kirim-secret"),
  );
  const app = Fastify();
  registerKirimAuthRoutes(app, { auth, publicOrigin: ORIGIN });
  return { app, auth, callbacks };
}

describe("KIRIM-IMPL-001 D-1 login on the kirim. host", () => {
  it("answers only on the kirim host and uses host-only sq_kirim_* cookies", async () => {
    const { app, auth, callbacks } = setup();
    expect((await app.inject({ method: "GET", url: "/auth/oidc/start", headers: { host: "hub.sabilulquran.or.id" } })).statusCode).toBe(404);

    const start = await app.inject({ method: "GET", url: "/auth/oidc/start", headers: { host: "kirim.sabilulquran.or.id" } });
    expect(start.statusCode).toBe(302);
    expect(start.headers.location).toContain("client_id=kirim-sq");
    const txCookie = String(start.headers["set-cookie"]);
    expect(txCookie).toMatch(/^sq_kirim_oidc_tx=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=600; Secure$/);
    expect(txCookie).not.toMatch(/Domain=/i);

    const callback = await app.inject({
      method: "GET",
      url: "/auth/callback?code=abc&state=s",
      headers: { host: "kirim.sabilulquran.or.id", cookie: txCookie.split(";")[0]! },
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe("/");
    expect(callbacks[0]!.href).toBe(`${ORIGIN}/api/auth/callback?code=abc&state=s`);
    const cookies = ([] as string[]).concat(callback.headers["set-cookie"] as string[]);
    const session = cookies.find((cookie) => cookie.startsWith("sq_kirim_session="))!;
    expect(session).toMatch(/HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);
    expect(session).not.toMatch(/Domain=/i);
    expect(cookies.join(";")).not.toContain("sq_hub_session");
    const token = session.split(";")[0]!.split("=")[1]!;
    await expect(auth.getSession(token)).resolves.toMatchObject({ subject: "kepala-hcm" });

    const crossOrigin = await app.inject({ method: "POST", url: "/auth/logout", headers: { host: "kirim.sabilulquran.or.id", origin: "https://evil.example", cookie: `sq_kirim_session=${token}` } });
    expect(crossOrigin.statusCode).toBe(403);
    const logout = await app.inject({ method: "POST", url: "/auth/logout", headers: { host: "kirim.sabilulquran.or.id", origin: ORIGIN, cookie: `sq_kirim_session=${token}` } });
    expect(logout.json()).toEqual({ logoutUrl: "https://login.example/logout" });
    expect(String(logout.headers["set-cookie"])).toMatch(/^sq_kirim_session=; .*Max-Age=0/);
    await expect(auth.getSession(token)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("coexists with the Hub login routes on the same API, each host keeping its own cookies", async () => {
    const { app, auth } = setup();
    const hubLogins: string[] = [];
    registerHubAuthRoutes(app, {
      ...auth,
      beginLogin: async () => {
        hubLogins.push("hub");
        return { authorizationUrl: new URL("https://login.example/hub"), setCookie: "sq_hub_oidc_tx=x; Path=/" };
      },
      completeLogin: auth.completeLogin.bind(auth),
      getWorkspace: auth.getWorkspace.bind(auth),
      getSession: auth.getSession.bind(auth),
      getAccountAccess: auth.getAccountAccess.bind(auth),
      logout: auth.logout.bind(auth),
      clearTransactionCookie: () => "",
    }, "https://hub.sabilulquran.or.id/auth/callback");
    const hub = await app.inject({ method: "GET", url: "/auth/oidc/start", headers: { host: "hub.sabilulquran.or.id" } });
    expect(hub.headers.location).toBe("https://login.example/hub");
    expect(hubLogins).toEqual(["hub"]);
    const kirim = await app.inject({ method: "GET", url: "/auth/oidc/start", headers: { host: "kirim.sabilulquran.or.id" } });
    expect(kirim.headers.location).toContain("client_id=kirim-sq");
    expect(hubLogins).toEqual(["hub"]);
  });

  it("returns to the Kirim SQ page with an error when login fails", async () => {
    const { app } = setup();
    const callback = await app.inject({ method: "GET", url: "/auth/callback?code=abc", headers: { host: "kirim.sabilulquran.or.id" } });
    expect(callback.headers.location).toBe("/?authError=oidc_failed");
  });
});
