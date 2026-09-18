import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { HubAuthError, type HubAuthRuntime } from "../src/modules/hub-auth/service.js";
import type { IdentityDirectory } from "../src/modules/identity-directory/client.js";
import { PlatformAdminAuthorizationError } from "../src/modules/platform-admin/service.js";

const hubOrigin = "https://hub-staging.example.test";
const session = {
  sessionId: "session-admin-routes-001",
  issuer: "https://login.example.test/realms/staff",
  subject: "opaque-platform-admin",
  displayName: "Synthetic Platform Admin",
  createdAt: new Date("2026-08-31T01:00:00Z"),
  expiresAt: new Date("2026-08-31T12:00:00Z"),
};

const staffIdentity = {
  identity: {
    issuer: "https://login.example.test/realms/staff",
    subject: "opaque-staff-subject",
  },
  username: "19870001",
  email: "synthetic@example.test",
  emailVerified: true,
  displayName: "Synthetic Staff",
  enabled: true,
  security: { totpConfigured: true, recoveryCodesConfigured: null },
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

function fakeDirectory(): IdentityDirectory {
  return {
    issuer: staffIdentity.identity.issuer,
    search: async () => [staffIdentity],
    inspect: async (subject) => (subject === staffIdentity.identity.subject ? staffIdentity : null),
  };
}

function makeApp(input: {
  hubAuth?: HubAuthRuntime;
  authorize?: () => Promise<void>;
}) {
  const applications = [
    {
      id: "app-001",
      applicationKey: "hcis",
      name: "HCIS",
      canonicalUrl: "https://hcis-staging.example.test",
      status: "active" as const,
    },
  ];
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
    hubRedirectUri: `${hubOrigin}/auth/callback`,
    hubAccountIssuer: session.issuer,
    adminAllowedOrigin: hubOrigin,
    platformAdmin: {
      authorize: input.authorize ?? (async () => undefined),
    },
    adminApplicationRegistry: {
      listApplications: async () => applications,
      upsertApplication: async (payload) => ({
        id: "app-created",
        applicationKey: payload.applicationKey,
        name: payload.name,
        canonicalUrl: payload.canonicalUrl,
        status: payload.status,
      }),
    },
    adminApplicationAccess: {
      listApplications: async () => applications,
      getAccess: async () => null,
      grant: async (payload) => ({
        id: "access-001",
        identity: payload.identity,
        applicationKey: payload.applicationKey,
        status: "active" as const,
        reason: payload.reason ?? null,
        actor: payload.actor,
        grantedAt: "2026-09-02T10:00:00.000Z",
        revokedAt: null,
        updatedAt: "2026-09-02T10:00:00.000Z",
      }),
      revoke: async (payload) => ({
        id: "access-001",
        identity: payload.identity,
        applicationKey: payload.applicationKey,
        status: "revoked" as const,
        reason: payload.reason ?? null,
        actor: payload.actor,
        grantedAt: null,
        revokedAt: "2026-09-02T10:05:00.000Z",
        updatedAt: "2026-09-02T10:05:00.000Z",
      }),
      listAudit: async () => [
        {
          id: "audit-001",
          actor: { kind: "human" as const, ref: "staff:safe-hash" },
          action: "application_access.grant",
          targetType: "application_access",
          targetRef: "https://login.example.test/realms/staff|opaque-staff-subject|hcis",
          outcome: "succeeded" as const,
          payload: { applicationKey: "hcis", reason: "UAT" },
          occurredAt: "2026-09-02T10:00:00.000Z",
        },
      ],
    },
    identityDirectory: fakeDirectory(),
  });
}

const mutationHeaders = {
  cookie: "sq_hub_session=opaque",
  "content-type": "application/json",
  origin: hubOrigin,
};

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

  it("returns browser-safe admin context and registry fields", async () => {
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
      capabilities: { platformAdministration: true, applicationAccessAdministration: true },
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

  it("bounds staff lookup and returns only safe readiness metadata", async () => {
    const app = makeApp({});
    const response = await app.inject({
      method: "GET",
      url: "/admin/staff?q=synthetic",
      headers: { cookie: "sq_hub_session=opaque" },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      staff: [
        {
          subject: "opaque-staff-subject",
          username: "19870001",
          email: "synthetic@example.test",
          emailVerified: true,
          displayName: "Synthetic Staff",
          enabled: true,
          security: { totpConfigured: true, recoveryCodesConfigured: null },
        },
      ],
    });
    expect(response.body).not.toContain("client_secret");
  });

  it("derives the mutation actor server-side and rejects browser actor/domain-role fields", async () => {
    const app = makeApp({});
    const rejected = await app.inject({
      method: "POST",
      url: "/admin/application-access/grant",
      headers: mutationHeaders,
      payload: {
        subject: "opaque-staff-subject",
        applicationKey: "hcis",
        reason: "Synthetic UAT",
        actor: { kind: "human", ref: "forged" },
        role: "SUPER_ADMIN",
      },
    });
    expect(rejected.statusCode).toBe(400);

    const accepted = await app.inject({
      method: "POST",
      url: "/admin/application-access/grant",
      headers: mutationHeaders,
      payload: {
        subject: "opaque-staff-subject",
        applicationKey: "hcis",
        reason: "Synthetic UAT",
      },
    });
    await app.close();

    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().access.status).toBe("active");
    expect(accepted.body).not.toContain("opaque-platform-admin");
    expect(accepted.body).not.toContain("forged");
  });

  it("requires a reason for browser grant/revoke mutations", async () => {
    const app = makeApp({});
    const response = await app.inject({
      method: "POST",
      url: "/admin/application-access/revoke",
      headers: mutationHeaders,
      payload: { subject: "opaque-staff-subject", applicationKey: "hcis", reason: "" },
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "INVALID_REQUEST" });
  });

  it("rejects privileged mutations from a sibling or missing origin", async () => {
    const app = makeApp({});
    for (const origin of ["https://hcis-staging.example.test", undefined]) {
      const response = await app.inject({
        method: "POST",
        url: "/admin/application-access/grant",
        headers: {
          cookie: "sq_hub_session=opaque",
          "content-type": "application/json",
          ...(origin ? { origin } : {}),
        },
        payload: {
          subject: "opaque-staff-subject",
          applicationKey: "hcis",
          reason: "Synthetic UAT",
        },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: "ADMIN_ORIGIN_FORBIDDEN" });
    }
    await app.close();
  });

  it("sanitizes raw access target references from audit responses", async () => {
    const app = makeApp({});
    const response = await app.inject({
      method: "GET",
      url: "/admin/audit?q=hcis",
      headers: { cookie: "sq_hub_session=opaque" },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("opaque-staff-subject");
    expect(response.body).not.toContain("targetRef");
    expect(response.json().audit[0].payload).toEqual({ applicationKey: "hcis", reason: "UAT" });
  });
});
