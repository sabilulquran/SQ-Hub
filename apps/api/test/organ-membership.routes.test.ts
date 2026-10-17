import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { ApplicationRecord } from "../src/modules/application-access/types.js";
import { HubAuthError, type HubAuthRuntime } from "../src/modules/hub-auth/service.js";
import type { OrganMembershipRecord, OrganMembershipStore } from "../src/modules/organ-membership/repository.js";
import { OrganMembershipService } from "../src/modules/organ-membership/service.js";
import { PlatformAdminAuthorizationError } from "../src/modules/platform-admin/service.js";
import { FakeStaffRealm, issuer } from "./organ-membership.fixture.js";

const hubOrigin = "https://hub.example.test";
const session = {
  sessionId: "session-organ-routes",
  issuer,
  subject: "platform-admin-subject",
  displayName: "Synthetic Platform Admin",
  username: "19870001",
  email: "admin@example.test",
  emailVerified: true,
  accountRefreshTokenCiphertext: null,
  createdAt: new Date("2026-10-17T01:00:00Z"),
  expiresAt: new Date("2026-10-17T12:00:00Z"),
};

function fakeHub(overrides: Partial<HubAuthRuntime> = {}): HubAuthRuntime {
  return {
    beginLogin: async () => ({ authorizationUrl: new URL("https://login.example.test/authorize"), setCookie: "tx=1" }),
    completeLogin: async () => ({ setCookies: [], returnPath: "/" }),
    getWorkspace: async () => { throw new Error("not used"); },
    getSession: async () => session,
    getAccountAccess: async () => { throw new HubAuthError(428, "ACCOUNT_REAUTH_REQUIRED", "x"); },
    logout: async () => ({ clearCookie: "", logoutUrl: null }),
    clearTransactionCookie: () => "",
    ...overrides,
  };
}

class MemoryStore implements OrganMembershipStore {
  records: OrganMembershipRecord[] = [];
  audits: string[] = [];
  async getById(id: string) { return this.records.find((record) => record.id === id) ?? null; }
  async getActive(identity: { subject: string }) {
    return this.records.find((record) => record.identity.subject === identity.subject && record.status === "active") ?? null;
  }
  async getEffective(identity: { subject: string }) { return this.getActive(identity); }
  async listActive() { return this.records.filter((record) => record.status === "active"); }
  async listRecentlyEnded() { return []; }
  async listEndingWithin() { return []; }
  async create(input: Parameters<OrganMembershipStore["create"]>[0]) {
    const record: OrganMembershipRecord = {
      id: `00000000-0000-4000-8000-${String(this.records.length + 1).padStart(12, "0")}`,
      identity: input.identity, ...input.terms, status: "active", reason: input.reason,
      provisioningPath: input.provisioningPath, createdAt: "", updatedAt: "", endedAt: null,
    };
    this.records.push(record);
    this.audits.push("organ_membership.grant");
    return record;
  }
  async change(): Promise<OrganMembershipRecord> { throw new Error("not used"); }
  async end(input: { id: string }) {
    const record = (await this.getById(input.id))!;
    record.status = "ended";
    this.audits.push("organ_membership.end");
    return { outcome: "succeeded" as const, membership: record };
  }
  async markExistingStaff() { return "noop" as const; }
  async audit(input: { action: string }) { this.audits.push(input.action); }
}

const hcis: ApplicationRecord = {
  id: "app-hcis", applicationKey: "hcis", name: "HCIS", canonicalUrl: "https://hcis.example.test", status: "active",
  governanceSummaryPath: "/api/governance/summary", governanceAudience: "hcis-governance", governanceOrder: 1,
};

function makeApp(input: { hubAuth?: HubAuthRuntime; authorize?: () => Promise<void> } = {}) {
  const realm = new FakeStaffRealm();
  realm.add({ subject: session.subject, username: "19870001", totp: true });
  realm.add({ subject: "staff-1", username: "19870021", totp: true });
  const store = new MemoryStore();
  const grants: string[] = [];
  const service = new OrganMembershipService(
    store,
    {
      listApplications: async () => [hcis],
      getAccess: async () => null,
      grant: async (payload) => { grants.push(payload.applicationKey); return {} as never; },
    },
    realm.directory(),
    realm.management(),
  );
  const app = buildApp({
    accessService: { checkAccess: async () => ({ allowed: true, applicationKey: "hcis", decision: "active_grant" }) },
    verifyMachineToken: async () => ({ clientId: "synthetic" }),
    hubAuth: input.hubAuth ?? fakeHub(),
    hubRedirectUri: `${hubOrigin}/auth/callback`,
    adminAllowedOrigin: hubOrigin,
    platformAdmin: { authorize: input.authorize ?? (async () => undefined) },
    organMemberships: service,
  });
  return { app, store, grants, realm };
}

const headers = { cookie: "sq_hub_session=opaque", origin: hubOrigin, "content-type": "application/json" };
const body = {
  subject: "staff-1", organ: "pengurus", positionLabel: "Ketua Pengurus", termStart: "2026-01-01",
  termEnd: "2030-12-31", reason: "SK Pengurus", applicationKeys: ["hcis"],
};

describe("Organ Yayasan admin routes (AC 3)", () => {
  it("requires a Hub session", async () => {
    const { app } = makeApp({ hubAuth: fakeHub({ getSession: async () => { throw new HubAuthError(401, "UNAUTHENTICATED", "x"); } }) });
    const response = await app.inject({ method: "GET", url: "/admin/organ-memberships" });
    await app.close();
    expect(response.statusCode).toBe(401);
  });

  it("requires a Platform Administrator with a fresh session before any change", async () => {
    for (const code of ["ADMIN_FORBIDDEN", "ADMIN_REAUTH_REQUIRED"] as const) {
      const { app, store } = makeApp({ authorize: async () => { throw new PlatformAdminAuthorizationError(code); } });
      const response = await app.inject({ method: "POST", url: "/admin/organ-memberships/existing-staff", headers, payload: body });
      await app.close();
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: code });
      expect(store.records).toEqual([]);
      expect(store.audits).toEqual([]);
    }
  });

  it("requires the exact Hub Origin for mutations", async () => {
    const { app, store } = makeApp();
    for (const origin of [undefined, "https://hcis.example.test"]) {
      const response = await app.inject({
        method: "POST", url: "/admin/organ-memberships/existing-staff",
        headers: { cookie: headers.cookie, "content-type": "application/json", ...(origin ? { origin } : {}) }, payload: body,
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: "ADMIN_ORIGIN_FORBIDDEN" });
    }
    await app.close();
    expect(store.records).toEqual([]);
  });

  it("requires a reason and rejects forged actor fields", async () => {
    const { app, store } = makeApp();
    const noReason = await app.inject({ method: "POST", url: "/admin/organ-memberships/existing-staff", headers, payload: { ...body, reason: "  " } });
    const forged = await app.inject({ method: "POST", url: "/admin/organ-memberships/existing-staff", headers, payload: { ...body, actor: { kind: "human", ref: "forged" } } });
    await app.close();
    expect(noReason.statusCode).toBe(400);
    expect(forged.statusCode).toBe(400);
    expect(store.records).toEqual([]);
  });

  it("refuses self-grant", async () => {
    const { app, store } = makeApp();
    const response = await app.inject({ method: "POST", url: "/admin/organ-memberships/existing-staff", headers, payload: { ...body, subject: session.subject } });
    await app.close();
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "ORGAN_SELF_MUTATION_FORBIDDEN" });
    expect(store.records).toEqual([]);
  });

  it("refuses ending one's own membership", async () => {
    const { app, store } = makeApp();
    await store.create({
      identity: { issuer, subject: session.subject },
      terms: { organ: "pembina", positionLabel: null, termStart: "2026-01-01", termEnd: null },
      reason: "seed", provisioningPath: "existing_staff", actor: { kind: "system", ref: "test" },
    });
    const id = store.records[0]!.id;
    const response = await app.inject({ method: "POST", url: `/admin/organ-memberships/${id}/end`, headers, payload: { reason: "x", confirm: true } });
    await app.close();
    expect(response.statusCode).toBe(409);
    expect(store.records[0]!.status).toBe("active");
  });

  it("grants with per-step results and never returns the raw request actor", async () => {
    const { app, store, grants } = makeApp();
    const response = await app.inject({ method: "POST", url: "/admin/organ-memberships/existing-staff", headers, payload: body });
    await app.close();
    expect(response.statusCode).toBe(201);
    expect(response.json().steps.map((step: { step: string }) => step.step)).toEqual(["totp_requirement", "organ_membership", "application_access"]);
    expect(store.audits).toEqual(["organ_membership.grant"]);
    expect(grants).toEqual(["hcis"]);
  });

  it("reports Path B as unavailable when identity management is not configured", async () => {
    const realm = new FakeStaffRealm();
    const service = new OrganMembershipService(new MemoryStore(), {
      listApplications: async () => [hcis], getAccess: async () => null, grant: async () => ({}) as never,
    }, realm.directory());
    const app = buildApp({
      accessService: { checkAccess: async () => ({ allowed: true, applicationKey: "hcis", decision: "active_grant" }) },
      verifyMachineToken: async () => ({ clientId: "synthetic" }),
      hubAuth: fakeHub(), hubRedirectUri: `${hubOrigin}/auth/callback`, adminAllowedOrigin: hubOrigin,
      platformAdmin: { authorize: async () => undefined }, organMemberships: service,
    });
    const response = await app.inject({
      method: "POST", url: "/admin/organ-memberships/new-identity", headers,
      payload: { firstName: "A", lastName: "B", email: "a@example.test", organ: "pembina", termStart: "2026-01-01", reason: "SK", applicationKeys: [] },
    });
    const overview = await app.inject({ method: "GET", url: "/admin/organ-memberships", headers });
    await app.close();
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "ORGAN_PROVISIONING_UNAVAILABLE" });
    expect(overview.json().capabilities).toEqual({ addNewIdentity: false, endNewIdentity: false });
    expect(overview.json().governanceApplications).toEqual([{ key: "hcis", name: "HCIS" }]);
  });
});
