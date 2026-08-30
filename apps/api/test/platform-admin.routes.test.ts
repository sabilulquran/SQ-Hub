import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { HubAuthError, type HubAuthRuntime } from "../src/modules/hub-auth/service.js";
import type { PlatformAdminRuntime } from "../src/modules/platform-admin/service.js";

const session = {
  sessionId: "session-admin",
  issuer: "https://login.sabilulquran.or.id/realms/sq-staff-staging",
  subject: "opaque-admin-subject",
  displayName: "Synthetic Admin",
  createdAt: new Date("2026-08-30T01:00:00.000Z"),
  expiresAt: new Date("2026-08-30T12:00:00.000Z"),
};

function fakeHub(overrides: Partial<HubAuthRuntime> = {}): HubAuthRuntime {
  return {
    beginLogin: async () => ({
      authorizationUrl: new URL("https://login.example.test/authorize"),
      setCookie: "sq_hub_oidc_tx=opaque",
    }),
    completeLogin: async () => ({ setCookies: ["sq_hub_session=opaque"] }),
    getAuthenticatedSession: async () => session,
    getWorkspace: async () => ({
      user: { displayName: session.displayName, initials: "SA" },
      applications: [],
      capabilities: { platformAdministration: true },
    }),
    logout: async () => ({ clearCookie: "sq_hub_session=", logoutUrl: null }),
    clearTransactionCookie: () => "sq_hub_oidc_tx=",
    ...overrides,
  };
}

function fakePlatformAdmin(
  authorization: "authorized" | "forbidden" | "reauth_required" = "authorized",
): PlatformAdminRuntime {
  return {
    getMembership: async () => null,
    grant: async () => ({ outcome: "noop", membership: null }),
    revoke: async () => ({ outcome: "noop", membership: null }),
    authorizeSession: async () => ({ status: authorization }),
    getOverview: async () => ({
      applications: { total: 2, active: 1, inactive: 1 },
      applicationAccess: { total: 3, active: 2, revoked: 1 },
      auditEventsLast24Hours: 4,
    }),
  };
}

function build(hubAuth: HubAuthRuntime, platformAdmin: PlatformAdminRuntime) {
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
    platformAdmin,
  });
}

describe("SQ Admin Center API", () => {
  it("returns 401 when the Hub session is not authenticated", async () => {
    const app = build(
      fakeHub({
        getAuthenticatedSession: async () => {
          throw new HubAuthError(401, "UNAUTHENTICATED", "expired");
        },
      }),
      fakePlatformAdmin(),
    );
    const response = await app.inject({ method: "GET", url: "/admin/context" });
    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "UNAUTHENTICATED" });
  });

  it("denies a valid ordinary Hub session without platform administrator membership", async () => {
    const app = build(fakeHub(), fakePlatformAdmin("forbidden"));
    const response = await app.inject({
      method: "GET",
      url: "/admin/context",
      headers: { cookie: "sq_hub_session=opaque" },
    });
    await app.close();

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "ADMIN_FORBIDDEN" });
    expect(response.body).not.toContain("applications");
  });

  it("requires reauthentication for a pre-grant Hub session", async () => {
    const app = build(fakeHub(), fakePlatformAdmin("reauth_required"));
    const response = await app.inject({
      method: "GET",
      url: "/admin/context",
      headers: { cookie: "sq_hub_session=opaque" },
    });
    await app.close();

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "ADMIN_REAUTH_REQUIRED" });
  });

  it("returns a redacted authorized context and aggregate overview", async () => {
    const app = build(fakeHub(), fakePlatformAdmin("authorized"));
    const response = await app.inject({
      method: "GET",
      url: "/admin/context",
      headers: { cookie: "sq_hub_session=opaque" },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      authorized: true,
      displayName: "Synthetic Admin",
      capabilities: { platformAdministration: true },
      overview: {
        applications: { total: 2, active: 1, inactive: 1 },
        applicationAccess: { total: 3, active: 2, revoked: 1 },
        auditEventsLast24Hours: 4,
      },
    });
    expect(response.body).not.toContain(session.subject);
    expect(response.body).not.toContain(session.issuer);
  });

  it("fails closed when platform authorization verification throws", async () => {
    const platformAdmin = fakePlatformAdmin();
    platformAdmin.authorizeSession = async () => {
      throw new Error("platform admin store unavailable");
    };
    const app = build(fakeHub(), platformAdmin);
    const response = await app.inject({
      method: "GET",
      url: "/admin/context",
      headers: { cookie: "sq_hub_session=opaque" },
    });
    await app.close();

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("applications");
    expect(response.body).not.toContain(session.subject);
  });
});
