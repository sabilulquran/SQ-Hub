import { describe, expect, it } from "vitest";

import type { ApplicationAccessService } from "../src/modules/application-access/service.js";
import type {
  IdentityManagement,
  ManagedStaffIdentity,
} from "../src/modules/identity-management/client.js";
import type { PlatformAdminService } from "../src/modules/platform-admin/service.js";
import type { LifecycleAuditWriter } from "../src/modules/staff-lifecycle/audit.js";
import { StaffLifecycleService } from "../src/modules/staff-lifecycle/service.js";
import type { LifecycleOperationStore, LifecycleOperation } from "../src/modules/staff-lifecycle/operation-store.js";

const actor = { kind: "human" as const, ref: "staff:safe-actor-hash" };
const issuer = "https://login.example.test/realms/staff";

function fixture(options: { failApplication?: string; failEmail?: boolean; order?: string[]; verifiedEmail?: string | null } = {}) {
  let failingApplication = options.failApplication;
  let failingEmail = options.failEmail ?? false;
  let identity: ManagedStaffIdentity = {
    issuer,
    subject: "subject-001",
    username: "19870001",
    email: "staff@example.test",
    emailVerified: true,
    firstName: "Synthetic",
    lastName: "Staff",
    enabled: true,
  };
  let platformAdminActive = true;
  let created = false;
  const access = new Map<string, "active" | "revoked">([
    ["hcis", "active"],
    ["sipaya", "active"],
  ]);
  const audits: string[] = [];
  const order = options.order ?? [];
  const identityManagement: IdentityManagement = {
    issuer,
    findByUsername: async (username) => created && username === identity.username ? identity : null,
    createStaff: async (input) => {
      order.push("identity:create");
      identity = { ...identity, ...input, subject: "created-subject" };
      created = true;
      return identity;
    },
    inspect: async (subject) => (subject === identity.subject ? identity : null),
    setEnabled: async (subject, enabled) => {
      if (subject !== identity.subject) throw new Error("not found");
      if (identity.enabled === enabled) return { changed: false, identity };
      identity = { ...identity, enabled };
      return { changed: true, identity };
    },
    sendPasswordInitialization: async () => {
      order.push("identity:send-email");
      if (failingEmail) throw new Error("synthetic mail failure");
    },
  };
  const applicationAccess = {
    listApplications: async () => [
      {
        id: "app-hcis",
        applicationKey: "hcis",
        name: "HCIS",
        canonicalUrl: "https://hcis.example.test",
        status: "active" as const,
      },
      {
        id: "app-sipaya",
        applicationKey: "sipaya",
        name: "SIPAYA",
        canonicalUrl: "https://sipaya.example.test",
        status: "active" as const,
      },
    ],
    getAccess: async (
      _identity: { issuer: string; subject: string },
      applicationKey: string,
    ) => {
      const state = access.get(applicationKey);
      return state ? { status: state } : null;
    },
    revoke: async (payload: { applicationKey: string }) => {
      if (payload.applicationKey === failingApplication) {
        throw new Error("synthetic failure");
      }
      const before = access.get(payload.applicationKey);
      access.set(payload.applicationKey, "revoked");
      return {
        status: "revoked",
        outcome: before === "active" ? "succeeded" : "noop",
      };
    },
  } as unknown as Pick<
    ApplicationAccessService,
    "listApplications" | "getAccess" | "revoke"
  >;
  const platformAdmin = {
    show: async () => platformAdminActive
      ? {
          status: "active" as const,
          reason: null,
          actor,
          grantedAt: "2026-09-01T00:00:00.000Z",
          revokedAt: null,
          updatedAt: "2026-09-01T00:00:00.000Z",
        }
      : {
          status: "revoked" as const,
          reason: "offboard",
          actor,
          grantedAt: null,
          revokedAt: "2026-09-04T00:00:00.000Z",
          updatedAt: "2026-09-04T00:00:00.000Z",
        },
    revoke: async () => {
      const outcome = platformAdminActive ? "succeeded" as const : "noop" as const;
      platformAdminActive = false;
      return { outcome, membership: null };
    },
  } as unknown as Pick<PlatformAdminService, "show" | "revoke">;
  const audit: LifecycleAuditWriter = {
    write: async (event) => {
      order.push(`audit:${event.action}:${event.outcome}`);
      audits.push(`${event.action}:${event.outcome}`);
    },
  };
  let operation: LifecycleOperation = { id: "00000000-0000-4000-8000-000000000999", status: "IN_PROGRESS", steps: [] };
  const operations: LifecycleOperationStore = {
    withIdentityLock: async (_identity, task) => task({
      begin: async () => operation,
      update: async (next) => { operation = { ...next, steps: [...next.steps] }; },
    }),
  };
  return {
    service: new StaffLifecycleService(
      identityManagement,
      applicationAccess,
      platformAdmin,
      audit,
      async (employeeNumber) => {
        order.push("hcis:verify");
        return {
          employeeId: "hcis:employee:00000000-0000-4000-8000-000000000001",
          employeeNumber,
          displayName: "Synthetic Staff",
          email: options.verifiedEmail === undefined ? "staff@example.test" : options.verifiedEmail,
          status: "active" as const,
          verifiedAt: "2026-10-02T00:00:00.000Z",
        };
      },
      operations,
    ),
    audits,
    access,
    currentIdentity: () => identity,
    operation: () => operation,
    clearFailure: () => { failingApplication = undefined; },
    clearEmailFailure: () => { failingEmail = false; },
  };
}

describe("StaffLifecycleService", () => {
  it("enforces the verified employee number as username and rejects unsupported fields/types", async () => {
    const { service } = fixture();
    const common = {
      firstName: "Synthetic",
      lastName: "Staff",
      email: "staff@example.test",
      enabled: true,
      reason: "Approved provisioning",
    };
    await expect(service.provision({
      ...common,
      staffType: "employee",
      employeeNumber: "19870001",
      username: "wrong",
    }, actor)).rejects.toBeTruthy();
    await expect(service.provision({
      ...common,
      staffType: "staff_without_nip",
      username: "other@example.test",
    }, actor)).rejects.toBeTruthy();
    await expect(service.provision({
      ...common,
      staffType: "employee",
      employeeNumber: "19870001",
      username: "19870001",
      nik: "should-never-be-login",
    }, actor)).rejects.toBeTruthy();
  });

  it("audits before external creation and returns no credential material", async () => {
    const order: string[] = [];
    const { service, audits } = fixture({ order });
    const result = await service.provision({
      staffType: "employee",
      employeeNumber: "19870001",
      username: "19870001",
      firstName: "Synthetic",
      lastName: "Staff",
      email: "staff@example.test",
      enabled: true,
      reason: "Approved provisioning",
    }, actor);
    expect(order[0]).toBe("audit:staff_identity.provision.attempt:succeeded");
    expect(order[1]).toBe("hcis:verify");
    expect(order[2]).toBe("identity:create");
    expect(audits).toContain("staff_identity.provision:succeeded");
    expect(JSON.stringify(result)).not.toMatch(/password|token|secret|totp|recovery/i);
  });

  it("does not create an identity when the current HCIS contact does not match", async () => {
    const order: string[] = [];
    const { service, audits } = fixture({ order, verifiedEmail: "different@example.test" });
    await expect(service.provision({
      staffType: "employee", employeeNumber: "19870001", username: "19870001",
      firstName: "Synthetic", lastName: "Staff", email: "staff@example.test",
      enabled: true, reason: "Synthetic onboarding",
    }, actor)).rejects.toBeTruthy();
    expect(order).not.toContain("identity:create");
    expect(audits).toContain("staff_identity.provision:failed");
  });

  it("keeps provisioning recoverable after email failure and audits a later resend", async () => {
    const { service, currentIdentity, audits, clearEmailFailure } = fixture({ failEmail: true });
    const request = {
      staffType: "employee", employeeNumber: "19870001", username: "19870001",
      firstName: "Synthetic", lastName: "Staff", email: "staff@example.test",
      enabled: true, reason: "Synthetic onboarding",
    };
    const result = await service.provision(request, actor);
    expect(result.credentialInitialization).toBe("required_action_pending");
    expect(currentIdentity().subject).toBe("created-subject");
    expect(audits).toContain("staff_identity.password_initialization:failed");
    clearEmailFailure();
    const retry = await service.sendPasswordInitialization({
      subject: "created-subject", reason: "Retry delivery", confirm: true,
    }, actor);
    expect(retry.outcome).toBe("succeeded");
    expect(audits).toContain("staff_identity.password_initialization:succeeded");
  });

  it("offboards Application Access, Platform Administrator, and global identity idempotently", async () => {
    const { service, access, currentIdentity } = fixture();
    const request = {
      subject: "subject-001",
      reason: "Approved platform offboarding",
      confirm: true,
    };
    const first = await service.offboard(request, actor);
    expect(first.outcome).toBe("succeeded");
    expect(access.get("hcis")).toBe("revoked");
    expect(access.get("sipaya")).toBe("revoked");
    expect(currentIdentity().enabled).toBe(false);
    const second = await service.offboard(request, actor);
    expect(second.outcome).toBe("succeeded");
    expect(second.steps.filter((step) => step.step !== "final_verification").every((step) => step.status === "noop")).toBe(true);
    expect(second.steps.at(-1)).toMatchObject({ step: "final_verification", status: "succeeded" });
  });

  it("surfaces and audits partial failure instead of hiding failed revocation", async () => {
    const { service, access, audits, operation, clearFailure } = fixture({ failApplication: "sipaya" });
    const result = await service.offboard({
      subject: "subject-001",
      reason: "Approved platform offboarding",
      confirm: true,
    }, actor);
    expect(result.outcome).toBe("partial_failure");
    expect(result.steps).toContainEqual(expect.objectContaining({
      target: "sipaya",
      status: "failed",
    }));
    expect(access.get("hcis")).toBe("revoked");
    expect(access.get("sipaya")).toBe("active");
    expect(audits).toContain("staff_identity.offboard.application_access:failed");
    expect(audits).toContain("staff_identity.offboard:failed");
    expect(operation().status).toBe("PARTIAL_FAILURE");
    clearFailure();
    const retry = await service.offboard({
      subject: "subject-001", reason: "Retry after recovery", confirm: true,
    }, actor);
    expect(retry.operationId).toBe(result.operationId);
    expect(retry.outcome).toBe("succeeded");
    expect(operation().status).toBe("COMPLETED");
  });

  it("re-enables the global account without restoring Application Access or SQ Admin", async () => {
    const { service, access, currentIdentity } = fixture();
    await service.offboard({ subject: "subject-001", reason: "Synthetic departure", confirm: true }, actor);
    const result = await service.setEnabled({
      subject: "subject-001", enabled: true, reason: "Approved return", confirm: true,
    }, actor);
    const preview = await service.previewOffboarding("subject-001");
    expect(result.outcome).toBe("succeeded");
    expect(currentIdentity().enabled).toBe(true);
    expect(access.get("hcis")).toBe("revoked");
    expect(access.get("sipaya")).toBe("revoked");
    expect(preview.platformAdministrator).toBe(false);
  });

  it("requires reason and explicit confirmation", async () => {
    const { service } = fixture();
    await expect(service.setEnabled({
      subject: "subject-001",
      enabled: false,
      reason: "",
      confirm: true,
    }, actor)).rejects.toBeTruthy();
    await expect(service.offboard({
      subject: "subject-001",
      reason: "approved",
      confirm: false,
    }, actor)).rejects.toBeTruthy();
  });
});
