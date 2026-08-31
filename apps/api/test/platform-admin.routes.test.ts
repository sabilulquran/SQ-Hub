import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { HubAuthError, type HubAuthRuntime } from "../src/modules/hub-auth/service.js";
import { PlatformAdminAuthorizationError } from "../src/modules/platform-admin/service.js";

const session = {
  sessionId: "session-admin-routes-001",
  issuer: "https://login.example.test/realms/staff",
  subject: "opaque-platform-admin",
  displayName: "Synthetic Platform Admin",
  createdAt: new Date("2026-08-31T01:00:00Z"),
  expiresAt: new Date("2026-08-31T12:00:00Z"),
};

function fakeHub(overrides: Partial<HubAuthRuntime> = {}): HubAuthRuntime {
  return {
    beginLogin: async () => ({
      authorizationUrl: new URL("https://login.example.test/authorize"),
      setCookie: "sq_hub_oidc_tx=opaque",
    }),
    completeLogin: async () => ({ setCookies: [] }),
    getWorkspace: async () => ({
      user: { displayName: session.displayName, initials: "SP" },
      applications: [],
      capabilities: { platformAdministration: true },
    }),
    getSession: async () => session,
    logout: async () => ({ clearCookie: "sq_hub_session=", logoutUrl: null }),
    clearTransactionCookie: () => "sq_hub_oidc_tx=",
    ...overrides,
  };
}

function makeApp(input: {
  hubAuth?: HubAuthRuntime;
  authorize?: () => Promise<void>;
}) {
  return buildApp({
    accessService: {
      checkAccess: async () => ({
        allowed: true,
        applicationKey: "hcis",
        decision: "active_grant",
      }),
    },
    verifyMachineToken: async () => ({ clientId: "hcis-api-staging" }),
    hubAuth: input.hubAuth ?? fakeHub(),
    hubRedirectUri: "https://hub-staging.example.test/auth/callback",
    platformAdmin: {
      authorize: input.authorize ?? (async () => undefined),
    },
    adminApplicationRegistry: {
      listApplications: async () => [
        {
          id: "app-001",
          applicationKey: "hcis",
          name: "HCIS",
          canonicalUrl: "https://hcis-staging.example.test",
          status: "active" as const,
        },
      ],
    },
  });
}

describe("SQ Admin Center routes", () => {
  it("requires an authenticated Hub session", async () => {
    const app = makeApp({
      hubAuth: fakeHub({
        getSession: async () => {
          throw new HubAuthError(401, "UNAUTHENTICATED", "missing");
        },
      }),
    });
    const response = await app.inject({ method: "GET", url: "/admin/context" });
    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "UNAUTHENTICATED" });
  });

  it("denies ordinary and stale privileged sessions without admin data", async () => {
    for (const code of ["ADMIN_FORBIDDEN", "ADMIN_REAUTH_REQUIRED"] as const) {
      const app = makeApp({
        authorize: async () => {
          throw new PlatformAdminAuthorizationError(code);
        },
      });
      const response = await app.inject({
        method: "GET",
        url: "/admin/applications",
        headers: { cookie: "sq_hub_session=opaque" },
      });
      await app.close();

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: code });
      expect(response.body).not.toContain("HCIS");
    }
  });

  it("returns only browser-safe admin context and read-only registry fields", async () => {
    const app = makeApp({});
    const context = await app.inject({
      method: "GET",
      url: "/admin/context",
      headers: { cookie: "sq_hub_session=opaque" },
    });
    const applications = await app.inject({
      method: "GET",
      url: "/admin/applications",
      headers: { cookie: "sq_hub_session=opaque" },
    });
    await app.close();

    expect(context.statusCode).toBe(200);
    expect(context.json()).toEqual({
      authorized: true,
      displayName: "Synthetic Platform Admin",
      capabilities: { platformAdministration: true },
    });
    expect(context.body).not.toContain("opaque-platform-admin");

    expect(applications.statusCode).toBe(200);
    expect(applications.json()).toEqual({
      applications: [
        {
          key: "hcis",
          name: "HCIS",
          canonicalUrl: "https://hcis-staging.example.test",
          status: "active",
        },
      ],
    });
    expect(applications.body).not.toContain("app-001");
  });
});
