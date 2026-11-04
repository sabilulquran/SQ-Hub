import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import type { ApplicationAccessService } from "../src/modules/application-access/service.js";
import { MachineAuthError } from "../src/modules/application-access/machine-auth.js";
import {
  IdentityManagementError,
  type IdentityManagement,
  type ManagedStaffIdentity,
} from "../src/modules/identity-management/client.js";
import type { PlatformAdminService } from "../src/modules/platform-admin/service.js";
import type { LifecycleAuditWriter } from "../src/modules/staff-lifecycle/audit.js";
import { EmployeeVerificationError, type VerifiedEmployee } from "../src/modules/staff-lifecycle/hcis-client.js";
import { HCIS_INVITE_PATH, registerHcisInviteRoute } from "../src/modules/staff-lifecycle/hcis-invite-routes.js";
import { splitDisplayName, StaffLifecycleService } from "../src/modules/staff-lifecycle/service.js";

// HUB-IMPL-024: HCIS asks for an employee's Akun SQ by NIP; synthetic data only.
const issuer = "https://login.example.test/realms/staff";
const employeeId = "hcis:employee:00000000-0000-4000-8000-000000000001";
const accountId = "00000000-0000-4000-8000-0000000000aa";
const body = { employeeNumber: "19870001", requestedBy: { accountId } };

interface FixtureOptions {
  existing?: Partial<ManagedStaffIdentity> | null;
  access?: "active" | "revoked" | null;
  employee?: Partial<VerifiedEmployee> | Error;
  platformAdmin?: boolean;
  failEmail?: boolean;
  organIdentity?: boolean;
}

function fixture(options: FixtureOptions = {}) {
  const calls: string[] = [];
  const audits: Array<{ action: string; outcome: string; actor: string; payload: Record<string, unknown> }> = [];
  let identity: ManagedStaffIdentity | null = options.existing === null || options.existing === undefined
    ? null
    : {
        issuer,
        subject: "existing-subject",
        username: "19870001",
        email: "staff@example.test",
        emailVerified: false,
        firstName: "Synthetic",
        lastName: "Staff",
        enabled: true,
        requiredActions: ["VERIFY_EMAIL", "UPDATE_PASSWORD"],
        employeeId,
        ...options.existing,
      };
  let access: "active" | "revoked" | null = options.access ?? null;
  const identityManagement: IdentityManagement = {
    issuer,
    findByUsername: async (username) => (identity && identity.username === username ? identity : null),
    createStaff: async (input) => {
      calls.push(`create:${input.username}:${input.email}:${input.firstName}|${input.lastName}:${input.employeeId}`);
      identity = {
        issuer,
        subject: "created-subject",
        username: input.username,
        email: input.email,
        emailVerified: false,
        firstName: input.firstName,
        lastName: input.lastName,
        enabled: true,
        requiredActions: ["VERIFY_EMAIL", "UPDATE_PASSWORD"],
        employeeId: input.employeeId,
      };
      return identity;
    },
    inspect: async (subject) => (identity?.subject === subject ? identity : null),
    setEnabled: async () => { throw new Error("not used"); },
    sendPasswordInitialization: async () => {
      calls.push("send-email");
      if (options.failEmail) throw new IdentityManagementError("IDENTITY_MANAGEMENT_UNAVAILABLE", "synthetic");
    },
    findByUsernameOrEmail: async () => options.organIdentity ? [{
      issuer, subject: "organ-subject", username: "board@example.test", email: "staff@example.test",
      emailVerified: true, firstName: "Organ", lastName: "Member", enabled: true, requiredActions: [],
    }] : [],
    createOrganMember: async () => { throw new Error("not used"); },
    sendOrganActivation: async () => undefined,
    requireTotpSetup: async () => "already_required" as const,
    linkEmployee: async () => { calls.push("link-organ"); throw new Error("must not link"); },
  };
  const applicationAccess = {
    listApplications: async () => [],
    getAccess: async (_identity: unknown, key: string) => (key === "hcis" && access ? { status: access } : null),
    revoke: async () => { throw new Error("not used"); },
    grant: async (input: { applicationKey: string; actor: { kind: string; ref: string } }) => {
      calls.push(`grant:${input.applicationKey}:${input.actor.kind}`);
      access = "active";
      return { status: "active" };
    },
  } as unknown as Pick<ApplicationAccessService, "listApplications" | "getAccess" | "revoke" | "grant">;
  const platformAdmin = {
    show: async () => (options.platformAdmin ? { status: "active" as const } : null),
    revoke: async () => { throw new Error("not used"); },
  } as unknown as Pick<PlatformAdminService, "show" | "revoke">;
  const audit: LifecycleAuditWriter = {
    write: async (event) => {
      audits.push({ action: event.action, outcome: event.outcome, actor: event.actor.ref, payload: event.payload });
    },
  };
  const service = new StaffLifecycleService(
    identityManagement,
    applicationAccess,
    platformAdmin,
    audit,
    async (employeeNumber) => {
      calls.push(`verify:${employeeNumber}`);
      if (options.employee instanceof Error) throw options.employee;
      return {
        employeeId,
        employeeNumber,
        displayName: "Siti Nur Aisyah",
        email: "Staff@Example.test",
        status: "active" as const,
        verifiedAt: "2026-11-04T00:00:00.000Z",
        ...options.employee,
      };
    },
    { withIdentityLock: async () => { throw new Error("not used"); } },
  );
  if (options.organIdentity) {
    service.attachOrganMemberships({
      endForOffboarding: async () => "noop",
      hasActiveMembership: async () => true,
      markExistingStaff: async () => "noop",
      isOrganProvisionedIdentity: async () => true,
    });
  }
  return { service, calls, audits, access: () => access };
}

describe("HUB-IMPL-024 inviteFromHcis", () => {
  it("creates the Akun SQ from HCIS data only, e-mails the password action and grants hcis", async () => {
    const { service, calls, audits } = fixture();
    const result = await service.inviteFromHcis(body, "hcis-api");
    expect(result).toEqual({
      identity: { issuer, subject: "created-subject" },
      employeeId,
      credentialInitialization: "sent",
      applicationAccess: "granted",
    });
    expect(calls).toEqual([
      "verify:19870001",
      `create:19870001:staff@example.test:Siti|Nur Aisyah:${employeeId}`,
      "send-email",
      "grant:hcis:service",
    ]);
    const invite = audits.find((event) => event.action === "staff_identity.hcis_invite");
    expect(invite).toMatchObject({ outcome: "succeeded", actor: `hcis-api:hcis-account:${accountId}` });
    expect(JSON.stringify(audits)).not.toMatch(/staff@example|Siti/);
  });

  it("refuses any field besides the NIP and the asking account", async () => {
    const { service, calls } = fixture();
    await expect(service.inviteFromHcis({ ...body, email: "attacker@example.test" }, "hcis-api")).rejects.toBeTruthy();
    await expect(service.inviteFromHcis({ employeeNumber: "19870001", requestedBy: { accountId: "x" } }, "hcis-api")).rejects.toBeTruthy();
    expect(calls).toEqual([]);
  });

  it("re-sends to an existing identity of the same employee and leaves an active grant alone", async () => {
    const { service, calls } = fixture({ existing: {}, access: "active" });
    const result = await service.inviteFromHcis(body, "hcis-api");
    expect(result).toMatchObject({ credentialInitialization: "sent", applicationAccess: "already_active" });
    expect(calls).toEqual(["verify:19870001", "send-email"]);
  });

  it("sends no e-mail when the password already exists", async () => {
    const { service, calls } = fixture({ existing: { requiredActions: [] } });
    const result = await service.inviteFromHcis(body, "hcis-api");
    expect(result).toMatchObject({ credentialInitialization: "already_complete", applicationAccess: "granted" });
    expect(calls).not.toContain("send-email");
  });

  it("never re-grants a revoked HCIS access", async () => {
    const { service, calls, access } = fixture({ existing: {}, access: "revoked" });
    const result = await service.inviteFromHcis(body, "hcis-api");
    expect(result.applicationAccess).toBe("revoked");
    expect(calls.some((call) => call.startsWith("grant:"))).toBe(false);
    expect(access()).toBe("revoked");
  });

  it("refuses a disabled Akun SQ without e-mail or grant", async () => {
    const { service, calls } = fixture({ existing: { enabled: false } });
    await expect(service.inviteFromHcis(body, "hcis-api")).rejects.toThrow("STAFF_IDENTITY_DISABLED");
    expect(calls).toEqual(["verify:19870001"]);
  });

  it("refuses an identity that belongs to another employee or another e-mail", async () => {
    const other = fixture({ existing: { employeeId: "hcis:employee:00000000-0000-4000-8000-000000000002" } });
    await expect(other.service.inviteFromHcis(body, "hcis-api")).rejects.toThrow("EMPLOYEE_IDENTITY_CONFLICT");
    const unlinked = fixture({ existing: { employeeId: undefined } });
    await expect(unlinked.service.inviteFromHcis(body, "hcis-api")).rejects.toThrow("EMPLOYEE_IDENTITY_CONFLICT");
    const changed = fixture({ existing: { email: "old@example.test" } });
    await expect(changed.service.inviteFromHcis(body, "hcis-api")).rejects.toThrow("EMPLOYEE_IDENTITY_CONFLICT");
    expect([...other.calls, ...unlinked.calls, ...changed.calls].some((call) => call === "send-email" || call.startsWith("grant:"))).toBe(false);
  });

  it("leaves linking an Organ Yayasan identity to the Admin Center", async () => {
    const { service, calls } = fixture({ organIdentity: true });
    await expect(service.inviteFromHcis(body, "hcis-api")).rejects.toThrow("ORGAN_IDENTITY_LINK_REQUIRES_ADMIN");
    expect(calls).toEqual(["verify:19870001"]);
  });

  it("stops at HCIS verification failures", async () => {
    for (const code of ["NOT_FOUND", "NOT_ACTIVE", "INVALID_CONTACT", "UNAVAILABLE"] as const) {
      const { service, calls, audits } = fixture({ employee: new EmployeeVerificationError(code) });
      await expect(service.inviteFromHcis(body, "hcis-api")).rejects.toBeInstanceOf(EmployeeVerificationError);
      expect(calls).toEqual(["verify:19870001"]);
      expect(audits.at(-1)).toMatchObject({ action: "staff_identity.hcis_invite", outcome: "failed" });
    }
    const noEmail = fixture({ employee: { email: null } });
    await expect(noEmail.service.inviteFromHcis(body, "hcis-api")).rejects.toMatchObject({ code: "INVALID_CONTACT" });
  });

  it("keeps the Platform Administrator rule: no password e-mail", async () => {
    const { service, calls } = fixture({ existing: {}, platformAdmin: true });
    const result = await service.inviteFromHcis(body, "hcis-api");
    expect(result.credentialInitialization).toBe("required_action_pending");
    expect(calls).not.toContain("send-email");
  });

  it("reports an e-mail failure as a pending action", async () => {
    const { service } = fixture({ failEmail: true });
    const result = await service.inviteFromHcis(body, "hcis-api");
    expect(result.credentialInitialization).toBe("required_action_pending");
  });
});

describe("splitDisplayName", () => {
  it("splits on the first word and fills both fields for a one-word name", () => {
    expect(splitDisplayName("  Siti   Nur Aisyah ")).toEqual({ firstName: "Siti", lastName: "Nur Aisyah" });
    expect(splitDisplayName("Sutrisno")).toEqual({ firstName: "Sutrisno", lastName: "Sutrisno" });
  });
});

describe("HUB-IMPL-024 route", () => {
  async function app(options: {
    verify?: (token: string) => Promise<{ clientId: string }>;
    invite?: (input: unknown, clientId: string) => Promise<unknown>;
  } = {}) {
    const seen: Array<{ input: unknown; clientId: string }> = [];
    const instance = Fastify();
    registerHcisInviteRoute(instance, {
      verifyMachineToken: options.verify ?? (async (token) => {
        if (token === "forbidden") throw new MachineAuthError("FORBIDDEN_CLIENT", "no");
        if (token !== "good") throw new MachineAuthError("INVALID_TOKEN", "no");
        return { clientId: "hcis-api" };
      }),
      service: {
        inviteFromHcis: (async (input: unknown, clientId: string) => {
          seen.push({ input, clientId });
          if (options.invite) return options.invite(input, clientId);
          return {
            identity: { issuer, subject: "created-subject" },
            employeeId,
            credentialInitialization: "sent",
            applicationAccess: "granted",
          };
        }) as StaffLifecycleService["inviteFromHcis"],
      },
    });
    await instance.ready();
    return { instance, seen };
  }

  it("requires a machine token from an allowed client", async () => {
    const { instance, seen } = await app();
    const none = await instance.inject({ method: "POST", url: HCIS_INVITE_PATH, payload: body });
    expect(none.statusCode).toBe(401);
    const bad = await instance.inject({ method: "POST", url: HCIS_INVITE_PATH, payload: body, headers: { authorization: "Bearer nope" } });
    expect(bad.statusCode).toBe(401);
    const forbidden = await instance.inject({ method: "POST", url: HCIS_INVITE_PATH, payload: body, headers: { authorization: "Bearer forbidden" } });
    expect(forbidden.statusCode).toBe(403);
    expect(seen).toEqual([]);
  });

  it("answers no-store with the invite result and passes the verified client id", async () => {
    const { instance, seen } = await app();
    const response = await instance.inject({ method: "POST", url: HCIS_INVITE_PATH, payload: body, headers: { authorization: "Bearer good" } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({ credentialInitialization: "sent", applicationAccess: "granted" });
    expect(seen).toEqual([{ input: body, clientId: "hcis-api" }]);
  });

  it("rejects extra fields by path without echoing values", async () => {
    const { instance, seen } = await app();
    const response = await instance.inject({
      method: "POST", url: HCIS_INVITE_PATH,
      payload: { ...body, email: "attacker@example.test" },
      headers: { authorization: "Bearer good" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain("attacker@example.test");
    expect(seen).toEqual([]);
  });

  it("maps service failures to stable codes", async () => {
    const cases: Array<[unknown, number, string]> = [
      [new EmployeeVerificationError("NOT_FOUND"), 404, "HCIS_EMPLOYEE_NOT_FOUND"],
      [new EmployeeVerificationError("NOT_ACTIVE"), 409, "HCIS_EMPLOYEE_NOT_ACTIVE"],
      [new EmployeeVerificationError("INVALID_CONTACT"), 409, "HCIS_EMPLOYEE_INVALID_CONTACT"],
      [new EmployeeVerificationError("UNAVAILABLE"), 503, "HCIS_VERIFY_UNAVAILABLE"],
      [new IdentityManagementError("DUPLICATE_EMAIL", "x"), 409, "DUPLICATE_EMAIL"],
      [new IdentityManagementError("IDENTITY_MANAGEMENT_UNAVAILABLE", "x"), 503, "IDENTITY_MANAGEMENT_UNAVAILABLE"],
      [new Error("EMPLOYEE_IDENTITY_CONFLICT"), 409, "EMPLOYEE_IDENTITY_CONFLICT"],
      [new Error("STAFF_IDENTITY_DISABLED"), 409, "STAFF_IDENTITY_DISABLED"],
      [new Error("ORGAN_IDENTITY_LINK_REQUIRES_ADMIN"), 409, "ORGAN_IDENTITY_LINK_REQUIRES_ADMIN"],
      [new Error("anything else"), 503, "STAFF_LIFECYCLE_UNAVAILABLE"],
    ];
    for (const [error, status, code] of cases) {
      const { instance } = await app({ invite: async () => { throw error; } });
      const response = await instance.inject({ method: "POST", url: HCIS_INVITE_PATH, payload: body, headers: { authorization: "Bearer good" } });
      expect([response.statusCode, response.json().error]).toEqual([status, code]);
    }
  });
});

describe("HUB-IMPL-024 configuration", () => {
  const baseEnv: NodeJS.ProcessEnv = {
    DATABASE_URL: "postgresql://example.invalid/sqhub",
    HCIS_CANONICAL_URL: "https://hcis.example.test",
    KEYCLOAK_ISSUER: issuer,
    MACHINE_TOKEN_AUDIENCE: "sq-hub-api",
    ALLOWED_MACHINE_CLIENTS: "hcis-api,spmb-api",
    SQ_HUB_OIDC_CLIENT_ID: "sq-hub",
    SQ_HUB_OIDC_CLIENT_SECRET: "oidc-secret",
    SQ_HUB_OIDC_REDIRECT_URI: "https://hub.example.test/auth/callback",
    SQ_HUB_OIDC_POST_LOGOUT_REDIRECT_URI: "https://hub.example.test/",
    KEYCLOAK_DIRECTORY_BASE_URL: "https://login.example.test",
    KEYCLOAK_DIRECTORY_REALM: "staff",
    KEYCLOAK_DIRECTORY_CLIENT_ID: "sq-hub-directory",
    KEYCLOAK_DIRECTORY_CLIENT_SECRET: "directory-secret",
  };
  const lifecycle = {
    KEYCLOAK_IDENTITY_MANAGEMENT_CLIENT_ID: "sq-hub-identity-management",
    KEYCLOAK_IDENTITY_MANAGEMENT_CLIENT_SECRET: "management-secret",
    HCIS_STAFF_VERIFY_BASE_URL: "https://hcis.example.test/api/",
    HCIS_STAFF_VERIFY_CLIENT_ID: "sq-hub-staff-lifecycle",
    HCIS_STAFF_VERIFY_CLIENT_SECRET: "verify-secret",
  };

  it("is off by default and parses its own allowlist", () => {
    expect(loadConfig(baseEnv).staffActivationAllowedClients.size).toBe(0);
    expect(loadConfig({ ...baseEnv, STAFF_ACTIVATION_ALLOWED_CLIENTS: "" }).staffActivationAllowedClients.size).toBe(0);
    const config = loadConfig({ ...baseEnv, ...lifecycle, STAFF_ACTIVATION_ALLOWED_CLIENTS: " hcis-api " });
    expect([...config.staffActivationAllowedClients]).toEqual(["hcis-api"]);
  });

  it("accepts exactly one client", () => {
    expect(() => loadConfig({ ...baseEnv, ...lifecycle, STAFF_ACTIVATION_ALLOWED_CLIENTS: "hcis-api,spmb-api" }))
      .toThrow(/exactly one client/);
  });

  it("needs the lifecycle configuration", () => {
    expect(() => loadConfig({ ...baseEnv, STAFF_ACTIVATION_ALLOWED_CLIENTS: "hcis-api" })).toThrow(/requires the identity management/);
  });

  it("refuses a client SQ Hub itself uses", () => {
    for (const client of ["sq-hub", "sq-hub-directory", "sq-hub-identity-management", "sq-hub-staff-lifecycle"]) {
      expect(() => loadConfig({ ...baseEnv, ...lifecycle, STAFF_ACTIVATION_ALLOWED_CLIENTS: client }))
        .toThrow(/must not name a client/);
    }
  });
});
