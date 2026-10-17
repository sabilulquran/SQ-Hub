import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { PgApplicationAccessRepository } from "../src/modules/application-access/repository.js";
import { ApplicationAccessService } from "../src/modules/application-access/service.js";
import { PgOrganMembershipRepository } from "../src/modules/organ-membership/repository.js";
import { OrganMembershipService } from "../src/modules/organ-membership/service.js";
import { PgPlatformAdminRepository } from "../src/modules/platform-admin/repository.js";
import { PlatformAdminService } from "../src/modules/platform-admin/service.js";
import { PgLifecycleAuditWriter } from "../src/modules/staff-lifecycle/audit.js";
import { PgLifecycleOperationStore } from "../src/modules/staff-lifecycle/operation-store.js";
import { StaffLifecycleService } from "../src/modules/staff-lifecycle/service.js";
import { FakeStaffRealm, issuer } from "./organ-membership.fixture.js";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for integration tests");

const pool = new Pool({ connectionString: databaseUrl });
const access = new ApplicationAccessService(new PgApplicationAccessRepository(pool));
const store = new PgOrganMembershipRepository(pool);
const platformAdmin = new PlatformAdminService(new PgPlatformAdminRepository(pool));
const actor = { kind: "human" as const, ref: "staff:synthetic-admin-hash" };
const admin = { issuer, subject: "platform-admin-subject" };
const terms = { organ: "pengurus", positionLabel: "Bendahara Pengurus", termStart: "2026-01-01", termEnd: "2030-12-31" };

let realm: FakeStaffRealm;
let service: OrganMembershipService;
let lifecycle: StaffLifecycleService;

function build() {
  realm = new FakeStaffRealm();
  const management = realm.management();
  lifecycle = new StaffLifecycleService(
    management,
    access,
    platformAdmin,
    new PgLifecycleAuditWriter(pool),
    async (employeeNumber) => ({
      employeeId: "hcis:employee:00000000-0000-4000-8000-000000000021",
      employeeNumber,
      displayName: "Synthetic Pengurus",
      email: "pembina.sintetis@example.test",
      status: "active",
      verifiedAt: "2026-10-17T00:00:00.000Z",
    }),
    new PgLifecycleOperationStore(pool),
  );
  service = new OrganMembershipService(store, access, realm.directory(), management, lifecycle);
  lifecycle.attachOrganMemberships(service);
}

async function auditActions(): Promise<string[]> {
  const result = await pool.query<{ action: string; outcome: string }>(
    "SELECT action, outcome FROM platform_audit_events ORDER BY occurred_at, action",
  );
  return result.rows.map((row) => `${row.action}:${row.outcome}`);
}

beforeEach(async () => {
  await pool.query(
    "TRUNCATE organ_memberships, staff_lifecycle_operations, platform_administrators, platform_audit_events, application_access, applications CASCADE",
  );
  await access.upsertApplication({
    applicationKey: "hcis", name: "HCIS", canonicalUrl: "https://hcis.example.test", status: "active",
    governance: { summaryPath: "/api/governance/summary", audience: "hcis-governance", order: 1 }, actor,
  });
  await access.upsertApplication({
    applicationKey: "aset", name: "Aset SQ", canonicalUrl: "https://aset.example.test", status: "active",
    governance: { summaryPath: "/api/governance/summary", audience: "aset-governance", order: 2 }, actor,
  });
  await access.upsertApplication({
    applicationKey: "karir", name: "Karir SQ", canonicalUrl: "https://karir.example.test", status: "active", actor,
  });
  await pool.query("TRUNCATE platform_audit_events");
  build();
});

afterAll(async () => {
  await pool.end();
});

describe("Organ Yayasan membership store", () => {
  it("is effective only while active and inside its term (AC 2)", async () => {
    const identity = { issuer, subject: "member-1" };
    const created = await store.create({
      identity, terms: { organ: "pembina", positionLabel: null, termStart: "2026-02-01", termEnd: "2026-11-01" },
      reason: "SK Pembina", provisioningPath: "existing_staff", actor,
    });
    expect(await store.getEffective(identity, "2026-01-31")).toBeNull();
    expect((await store.getEffective(identity, "2026-02-01"))?.id).toBe(created.id);
    expect((await store.getEffective(identity, "2026-10-31"))?.id).toBe(created.id);
    // termEnd must be after today: on the end date it is no longer effective.
    expect(await store.getEffective(identity, "2026-11-01")).toBeNull();
    await store.end({ id: created.id, reason: "Masa jabatan selesai", actor });
    expect(await store.getEffective(identity, "2026-06-01")).toBeNull();
  });

  it("keeps at most one active membership per identity and lists terms ending within 30 days", async () => {
    const identity = { issuer, subject: "member-2" };
    await store.create({ identity, terms: { organ: "pengawas", positionLabel: null, termStart: "2025-01-01", termEnd: "2026-11-10" }, reason: "SK", provisioningPath: "existing_staff", actor });
    await expect(store.create({ identity, terms: { organ: "pembina", positionLabel: null, termStart: "2025-01-01", termEnd: null }, reason: "SK", provisioningPath: "existing_staff", actor }))
      .rejects.toMatchObject({ name: "OrganMembershipConflictError" });
    await store.create({ identity: { issuer, subject: "member-3" }, terms: { organ: "pembina", positionLabel: null, termStart: "2025-01-01", termEnd: null }, reason: "SK", provisioningPath: "existing_staff", actor });
    const ending = await store.listEndingWithin(30, "2026-10-17");
    expect(ending.map((record) => record.identity.subject)).toEqual(["member-2"]);
    expect(await store.listEndingWithin(30, "2026-09-01")).toEqual([]);
  });
});

describe("Path A — existing staff identity", () => {
  it("creates the membership with one audit event, requires TOTP, and grants selected access", async () => {
    realm.add({ subject: "staff-1", username: "19870021", totp: false });
    const result = await service.addExistingStaff(
      { subject: "staff-1", ...terms, reason: "SK Pengurus 2026", applicationKeys: ["hcis", "aset"] }, actor, admin,
    );
    expect(result.outcome).toBe("succeeded");
    expect(result.steps.map((step) => `${step.step}:${step.target}:${step.status}`)).toEqual([
      "totp_requirement:akun-sq:succeeded",
      "organ_membership:organ-membership:succeeded",
      "application_access:hcis:succeeded",
      "application_access:aset:succeeded",
    ]);
    expect(realm.users.get("staff-1")?.requiredActions).toContain("CONFIGURE_TOTP");
    expect(result.domainRoleReminders.map((item) => item.key)).toEqual(["hcis", "aset"]);
    const actions = await auditActions();
    expect(actions.filter((action) => action.startsWith("organ_membership."))).toEqual(["organ_membership.grant:succeeded"]);
    expect(actions.filter((action) => action === "application_access.grant:succeeded")).toHaveLength(2);
    expect(await store.getEffective({ issuer, subject: "staff-1" }, "2026-10-17")).not.toBeNull();
  });

  it("refuses self-grant and non-governance applications before any change", async () => {
    realm.add({ subject: admin.subject, username: "19870001", totp: true });
    realm.add({ subject: "staff-2", username: "19870022", totp: true });
    await expect(service.addExistingStaff({ subject: admin.subject, ...terms, reason: "x", applicationKeys: [] }, actor, admin))
      .rejects.toMatchObject({ code: "ORGAN_SELF_MUTATION_FORBIDDEN" });
    await expect(service.addExistingStaff({ subject: "staff-2", ...terms, reason: "x", applicationKeys: ["karir"] }, actor, admin))
      .rejects.toMatchObject({ code: "NOT_GOVERNANCE_APPLICATION" });
    await expect(service.addExistingStaff({ subject: "staff-2", ...terms, reason: " ", applicationKeys: [] }, actor, admin))
      .rejects.toBeTruthy();
    expect(await store.listActive()).toEqual([]);
    expect(await auditActions()).toEqual([]);
  });

  it("does not create the membership when the TOTP requirement cannot be set, and a retry is safe", async () => {
    realm.add({ subject: "staff-3", username: "19870023", totp: false });
    realm.failTotpRequirement = true;
    const failed = await service.addExistingStaff({ subject: "staff-3", ...terms, reason: "SK", applicationKeys: ["hcis"] }, actor, admin);
    expect(failed.outcome).toBe("failed");
    expect(await store.getActive({ issuer, subject: "staff-3" })).toBeNull();
    realm.failTotpRequirement = false;
    const retried = await service.addExistingStaff({ subject: "staff-3", ...terms, reason: "SK", applicationKeys: ["hcis"] }, actor, admin);
    expect(retried.outcome).toBe("succeeded");
    const again = await service.addExistingStaff({ subject: "staff-3", ...terms, reason: "SK", applicationKeys: ["hcis"] }, actor, admin);
    expect(again.steps.map((step) => step.status)).toEqual(["noop", "noop", "noop"]);
    expect((await auditActions()).filter((action) => action === "organ_membership.grant:succeeded")).toHaveLength(1);
  });

  it("changes terms with reason and audit, and ending never disables the identity (AC 3b)", async () => {
    realm.add({ subject: "staff-4", username: "19870024", totp: true });
    const added = await service.addExistingStaff({ subject: "staff-4", ...terms, reason: "SK", applicationKeys: ["hcis"] }, actor, admin);
    const id = added.membership!.id;
    const changed = await service.change(id, { ...terms, organ: "pembina", reason: "Perubahan SK" }, actor, admin);
    expect(changed.membership.organ).toBe("pembina");
    const preview = await service.endPreview(id);
    expect(preview.path).toBe("existing_staff");
    const ended = await service.end(id, { reason: "Masa jabatan selesai", confirm: true }, actor, admin);
    expect(ended.outcome).toBe("succeeded");
    expect(ended.domainRoleReminders.map((item) => item.key)).toEqual(["hcis"]);
    expect(realm.users.get("staff-4")?.enabled).toBe(true);
    expect((await access.getAccess({ issuer, subject: "staff-4" }, "hcis"))?.status).toBe("active");
    expect(realm.calls.filter((call) => call.startsWith("setEnabled"))).toEqual([]);
    const actions = (await auditActions()).filter((action) => action.startsWith("organ_membership."));
    expect(actions).toEqual(["organ_membership.grant:succeeded", "organ_membership.change:succeeded", "organ_membership.end:succeeded"]);
  });
});

describe("Path B — new organ identity", () => {
  const pathB = {
    firstName: "Pembina", lastName: "Sintetis", email: "Pembina.Sintetis@example.test",
    ...terms, organ: "pembina", reason: "SK Pembina 2026", applicationKeys: ["hcis"],
  };

  it("refuses an e-mail already used by a staff identity and points to Path A (AC 3a)", async () => {
    realm.add({ subject: "staff-5", username: "19870025", email: "pembina.sintetis@example.test" });
    await expect(service.addNewIdentity(pathB, actor)).rejects.toMatchObject({ code: "EMAIL_IN_USE_USE_EXISTING_STAFF" });
    expect(realm.calls).not.toContain("createOrganMember");
    expect(await store.listActive()).toEqual([]);
  });

  it("creates identity, sends activation, and creates the membership as one operation (AC 3a, 3c)", async () => {
    const result = await service.addNewIdentity(pathB, actor);
    expect(result.outcome).toBe("succeeded");
    expect(result.steps.map((step) => `${step.step}:${step.status}`)).toEqual([
      "identity:succeeded", "activation_email:succeeded", "organ_membership:succeeded", "application_access:succeeded",
    ]);
    const [created] = [...realm.users.values()];
    expect(created!.username).toBe("pembina.sintetis@example.test");
    expect(created!.requiredActions).toEqual(["VERIFY_EMAIL", "UPDATE_PASSWORD", "CONFIGURE_TOTP"]);
    expect(JSON.stringify(result)).not.toMatch(/password"?\s*:/i);
    const membership = await store.getActive({ issuer, subject: created!.subject });
    expect(membership?.provisioningPath).toBe("organ_identity");
  });

  it("reports a failed activation e-mail per step and a retry reuses the same identity", async () => {
    realm.failActivationEmail = true;
    const first = await service.addNewIdentity(pathB, actor);
    expect(first.outcome).toBe("partial_failure");
    expect(first.steps.find((step) => step.step === "activation_email")?.status).toBe("failed");
    realm.failActivationEmail = false;
    const second = await service.addNewIdentity(pathB, actor);
    expect(second.outcome).toBe("succeeded");
    expect(second.steps.map((step) => `${step.step}:${step.status}`)).toEqual([
      "identity:noop", "activation_email:succeeded", "organ_membership:noop", "application_access:noop",
    ]);
    expect(realm.calls.filter((call) => call === "createOrganMember")).toHaveLength(1);
    expect(realm.users.size).toBe(1);
  });

  it("ending revokes Application Access and disables the identity through offboarding (AC 3b)", async () => {
    const added = await service.addNewIdentity(pathB, actor);
    const id = added.membership!.id;
    const subject = [...realm.users.keys()][0]!;
    const preview = await service.endPreview(id);
    expect(preview.path).toBe("organ_identity");
    expect(preview.offboarding?.activeApplications.map((item) => item.key)).toEqual(["hcis"]);
    const ended = await service.end(id, { reason: "Masa jabatan selesai", confirm: true }, actor, admin);
    expect(ended.outcome).toBe("succeeded");
    expect(ended.steps.map((step) => step.step)).toContain("organ_membership");
    expect(realm.users.get(subject)?.enabled).toBe(false);
    expect((await access.getAccess({ issuer, subject }, "hcis"))?.status).toBe("revoked");
    expect(await store.getActive({ issuer, subject })).toBeNull();
  });

  it("a Path B member who becomes an Employee keeps the same identity and counts as Path A", async () => {
    const added = await service.addNewIdentity(pathB, actor);
    const subject = [...realm.users.keys()][0]!;
    const provisioned = await lifecycle.provision({
      staffType: "employee", employeeNumber: "19870099", username: "19870099", firstName: "Pembina", lastName: "Sintetis",
      email: "pembina.sintetis@example.test", enabled: true, reason: "Diangkat sebagai pegawai",
    }, actor);
    expect(provisioned.identity.subject).toBe(subject);
    expect(realm.users.size).toBe(1);
    expect((await store.getActive({ issuer, subject }))?.provisioningPath).toBe("existing_staff");
    const ended = await service.end(added.membership!.id, { reason: "Masa jabatan selesai", confirm: true }, actor, admin);
    expect(ended.path).toBe("existing_staff");
    expect(realm.users.get(subject)?.enabled).toBe(true);
  });
});

describe("HUB-IMPL-013 offboarding amendment", () => {
  it("offboarding ends any active organ membership as an additional verified step", async () => {
    realm.add({ subject: "staff-6", username: "19870026", totp: true, firstName: "Staf", lastName: "Sintetis" });
    await service.addExistingStaff({ subject: "staff-6", ...terms, reason: "SK", applicationKeys: [] }, actor, admin);
    const preview = await lifecycle.previewOffboarding("staff-6");
    expect(preview.organMembership).toBe(true);
    const result = await lifecycle.offboard({ subject: "staff-6", reason: "Resign", confirm: true }, actor);
    expect(result.outcome).toBe("succeeded");
    expect(result.steps.find((step) => step.step === "organ_membership")?.status).toBe("succeeded");
    expect(await store.getActive({ issuer, subject: "staff-6" })).toBeNull();
  });
});
