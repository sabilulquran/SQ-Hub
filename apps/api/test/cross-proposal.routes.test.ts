import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { HubAuthRuntime } from "../src/modules/hub-auth/service.js";
import type { OrganizationalUnitService } from "../src/modules/organizational-units/service.js";
import type { StaffLifecycleService } from "../src/modules/staff-lifecycle/service.js";

const hubAuth = {
  beginLogin: async () => ({
    authorizationUrl: new URL("https://login.example.test/authorize"),
    setCookie: "sq_hub_oidc_tx=opaque",
  }),
  completeLogin: async () => ({ setCookies: [] }),
  getWorkspace: async () => ({
    user: { displayName: "Synthetic Admin", initials: "SA" },
    applications: [],
    capabilities: { platformAdministration: true },
  }),
  getSession: async () => ({
    sessionId: "session-integration",
    issuer: "https://login.example.test/realms/staff",
    subject: "admin-subject",
    displayName: "Synthetic Admin",
    createdAt: new Date("2026-09-04T01:00:00Z"),
    expiresAt: new Date("2026-09-04T12:00:00Z"),
  }),
  logout: async () => ({ clearCookie: "sq_hub_session=", logoutUrl: null }),
  clearTransactionCookie: () => "sq_hub_oidc_tx=",
} satisfies HubAuthRuntime;

describe("next-wave proposal route integration", () => {
  it("registers lifecycle and Organizational Unit capabilities together", async () => {
    const app = buildApp({
      accessService: {
        checkAccess: async () => ({
          allowed: true,
          applicationKey: "hcis",
          decision: "active_grant",
        }),
      },
      verifyMachineToken: async () => ({ clientId: "synthetic-client" }),
      hubAuth,
      hubRedirectUri: "https://hub.example.test/auth/callback",
      adminAllowedOrigin: "https://hub.example.test",
      platformAdmin: { authorize: async () => undefined },
      staffLifecycle: {} as StaffLifecycleService,
      organizationalUnits: {} as OrganizationalUnitService,
    });

    const routes = app.printRoutes();
    expect(routes).toContain("staff-lifecycle");
    expect(routes).toContain("organizational-units");
    await app.close();
  });
});
