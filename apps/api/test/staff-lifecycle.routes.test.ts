import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { HubAuthError, type HubAuthRuntime } from "../src/modules/hub-auth/service.js";
import { PlatformAdminAuthorizationError } from "../src/modules/platform-admin/service.js";
import type { StaffLifecycleService } from "../src/modules/staff-lifecycle/service.js";

const hubOrigin = "https://hub-staging.example.test";
const session = { sessionId: "session-go5c-001", issuer: "https://login.example.test/realms/staff", subject: "platform-admin-subject", displayName: "Synthetic Platform Admin", createdAt: new Date("2026-09-04T01:00:00Z"), expiresAt: new Date("2026-09-04T12:00:00Z") };

function fakeHub(overrides: Partial<HubAuthRuntime> = {}): HubAuthRuntime {
  return {
    beginLogin: async () => ({ authorizationUrl: new URL("https://login.example.test/authorize"), setCookie: "sq_hub_oidc_tx=opaque" }), completeLogin: async () => ({ setCookies: [] }),
    getWorkspace: async () => ({ user: { displayName: session.displayName, initials: "SP" }, applications: [], capabilities: { platformAdministration: true } }), getSession: async () => session,
    logout: async () => ({ clearCookie: "sq_hub_session=", logoutUrl: null }), clearTransactionCookie: () => "sq_hub_oidc_tx=", ...overrides,
  };
}

function fakeService(calls: string[] = []): StaffLifecycleService {
  return {
    provision: async () => { calls.push("provision"); return { identity: { subject: "created", username: "19870001" }, credentialInitialization: "sent" as const }; },
    setEnabled: async () => { calls.push("status"); return { outcome: "succeeded" as const, identity: { subject: "staff-001", enabled: false } }; },
    sendPasswordInitialization: async () => { calls.push("password"); return { outcome: "succeeded" as const, requiredAction: "UPDATE_PASSWORD" as const }; },
    previewOffboarding: async () => { calls.push("preview"); return { activeApplications: [], platformAdministrator: false, globalIdentityEnabled: true, hcisEmployeeStatus: "not_read_or_inferred" as const }; },
    offboard: async () => { calls.push("offboard"); return { outcome: "succeeded" as const, steps: [] }; },
  } as unknown as StaffLifecycleService;
}

function makeApp(input: { hubAuth?: HubAuthRuntime; authorize?: () => Promise<void>; calls?: string[] }) {
  return buildApp({ accessService: { checkAccess: async () => ({ allowed: true, applicationKey: "hcis", decision: "active_grant" }) }, verifyMachineToken: async () => ({ clientId: "synthetic-client" }), hubAuth: input.hubAuth ?? fakeHub(), hubRedirectUri: `${hubOrigin}/auth/callback`, adminAllowedOrigin: hubOrigin, platformAdmin: { authorize: input.authorize ?? (async () => undefined) }, staffLifecycle: fakeService(input.calls) });
}

const headers = { cookie: "sq_hub_session=opaque", origin: hubOrigin, "content-type": "application/json" };

describe("Go 5C staff lifecycle routes", () => {
  it("requires authenticated Hub session", async () => {
    const app = makeApp({ hubAuth: fakeHub({ getSession: async () => { throw new HubAuthError(401, "UNAUTHENTICATED", "missing"); } }) });
    const response = await app.inject({ method: "GET", url: "/admin/staff-lifecycle/staff-001/offboarding-preview" }); await app.close();
    expect(response.statusCode).toBe(401); expect(response.json()).toEqual({ error: "UNAUTHENTICATED" });
  });

  it("denies ordinary Staff and stale privileged sessions before lifecycle code", async () => {
    for (const code of ["ADMIN_FORBIDDEN", "ADMIN_REAUTH_REQUIRED"] as const) {
      const calls: string[] = []; const app = makeApp({ calls, authorize: async () => { throw new PlatformAdminAuthorizationError(code); } });
      const response = await app.inject({ method: "POST", url: "/admin/staff-lifecycle/offboard", headers, payload: { subject: "staff-001", reason: "approved", disableIdentity: false, confirm: true } }); await app.close();
      expect(response.statusCode).toBe(403); expect(response.json()).toEqual({ error: code }); expect(calls).toEqual([]);
    }
  });

  it("requires trusted Origin for mutations", async () => {
    const calls: string[] = []; const app = makeApp({ calls });
    const response = await app.inject({ method: "POST", url: "/admin/staff-lifecycle/status", headers: { cookie: headers.cookie, "content-type": "application/json", origin: "https://evil.example.test" }, payload: { subject: "staff-001", enabled: false, reason: "approved", confirm: true } }); await app.close();
    expect(response.statusCode).toBe(403); expect(response.json()).toEqual({ error: "ADMIN_ORIGIN_FORBIDDEN" }); expect(calls).toEqual([]);
  });

  it("prevents self-disable and self-offboarding", async () => {
    const calls: string[] = []; const app = makeApp({ calls });
    const disable = await app.inject({ method: "POST", url: "/admin/staff-lifecycle/status", headers, payload: { subject: session.subject, enabled: false, reason: "approved", confirm: true } });
    const offboard = await app.inject({ method: "POST", url: "/admin/staff-lifecycle/offboard", headers, payload: { subject: session.subject, reason: "approved", disableIdentity: false, confirm: true } }); await app.close();
    expect(disable.statusCode).toBe(409); expect(offboard.statusCode).toBe(409); expect(calls).toEqual([]);
  });

  it("rejects forged actor and secret fields", async () => {
    const calls: string[] = []; const app = makeApp({ calls });
    const response = await app.inject({ method: "POST", url: "/admin/staff-lifecycle/provision", headers, payload: { staffType: "employee", employeeNumber: "19870001", username: "19870001", firstName: "Synthetic", lastName: "Staff", email: "staff@example.test", emailVerified: true, enabled: true, reason: "approved", actor: { kind: "human", ref: "forged" }, clientSecret: "forged-secret" } }); await app.close();
    expect(response.statusCode).toBe(400); expect(response.json()).toEqual({ error: "INVALID_REQUEST" }); expect(calls).toEqual([]); expect(response.body).not.toContain("forged-secret");
  });
});
