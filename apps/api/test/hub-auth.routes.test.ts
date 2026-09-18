import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { accountConsoleUrlFromIssuer } from "../src/modules/hub-auth/routes.js";
import { HubAuthError, type HubAuthRuntime } from "../src/modules/hub-auth/service.js";

const accountIssuer = "https://login.example.test/realms/staff";

function appWithHub(hubAuth: HubAuthRuntime) {
  return buildApp({
    accessService: {
      checkAccess: async () => ({
        allowed: true,
        applicationKey: "hcis",
        decision: "active_grant",
      }),
    },
    verifyMachineToken: async () => ({ clientId: "hcis-api-staging" }),
    hubAuth,
    hubRedirectUri: "https://hub-staging.sabilulquran.or.id/auth/callback",
    hubAccountIssuer: accountIssuer,
  });
}

function fakeHub(overrides: Partial<HubAuthRuntime> = {}): HubAuthRuntime {
  return {
    beginLogin: async () => ({
      authorizationUrl: new URL("https://login.example.test/authorize"),
      setCookie: "sq_hub_oidc_tx=opaque; Path=/; HttpOnly; SameSite=Lax; Secure",
    }),
    completeLogin: async () => ({
      setCookies: [
        "sq_hub_session=opaque; Path=/; HttpOnly; SameSite=Lax; Secure",
        "sq_hub_oidc_tx=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure",
      ],
    }),
    getWorkspace: async () => ({
      user: { displayName: "Ahmad Fikri", initials: "AF" },
      applications: [
        {
          key: "hcis",
          name: "HCIS",
          canonicalUrl: "https://hcis.example",
        },
      ],
      capabilities: { platformAdministration: false },
    }),
    getSession: async () => ({
      sessionId: "session-001",
      issuer: accountIssuer,
      subject: "synthetic-subject",
      displayName: "Ahmad Fikri",
      createdAt: new Date("2026-09-18T00:00:00Z"),
      expiresAt: new Date("2026-09-18T12:00:00Z"),
    }),
    logout: async () => ({
      clearCookie: "sq_hub_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure",
      logoutUrl: new URL("https://login.example.test/logout"),
    }),
    clearTransactionCookie: () =>
      "sq_hub_oidc_tx=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure",
    ...overrides,
  };
}

describe("SQ Hub browser auth routes", () => {
  it("starts OIDC with an opaque HttpOnly transaction cookie", async () => {
    const app = appWithHub(fakeHub());
    const response = await app.inject({ method: "GET", url: "/auth/oidc/start" });
    await app.close();

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://login.example.test/authorize");
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
  });

  it("returns the authorized workspace without an identity subject field", async () => {
    const app = appWithHub(fakeHub());
    const response = await app.inject({
      method: "GET",
      url: "/workspace",
      headers: { cookie: "sq_hub_session=opaque" },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      user: { displayName: "Ahmad Fikri", initials: "AF" },
      applications: [{ key: "hcis", name: "HCIS" }],
      capabilities: { platformAdministration: false },
    });
    expect(response.body).not.toContain("subject");
  });

  it("uses 401 for a missing or expired Hub session", async () => {
    const app = appWithHub(
      fakeHub({
        getWorkspace: async () => {
          throw new HubAuthError(401, "UNAUTHENTICATED", "expired");
        },
      }),
    );
    const response = await app.inject({ method: "GET", url: "/workspace" });
    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "UNAUTHENTICATED" });
  });

  it("redirects an authenticated account request only to the configured issuer account console", async () => {
    const app = appWithHub(fakeHub());
    const response = await app.inject({
      method: "GET",
      url: "/account?redirect=https://evil.example/&target=javascript:alert(1)",
      headers: { cookie: "sq_hub_session=opaque" },
    });
    await app.close();

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://login.example.test/realms/staff/account");
    expect(response.headers.location).not.toContain("evil.example");
  });

  it("requires a valid Hub session before opening Account Console", async () => {
    const app = appWithHub(
      fakeHub({
        getSession: async () => {
          throw new HubAuthError(401, "UNAUTHENTICATED", "expired");
        },
      }),
    );
    const response = await app.inject({ method: "GET", url: "/account" });
    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "UNAUTHENTICATED" });
  });

  it("builds Account Console root from the configured issuer only", () => {
    expect(accountConsoleUrlFromIssuer("https://login.example.test/realms/staff/").href)
      .toBe("https://login.example.test/realms/staff/account");
  });

  it("clears the local session and returns the official OIDC logout URL", async () => {
    const app = appWithHub(fakeHub());
    const response = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie: "sq_hub_session=opaque" },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toContain("Max-Age=0");
    expect(response.json()).toEqual({ logoutUrl: "https://login.example.test/logout" });
  });
});
