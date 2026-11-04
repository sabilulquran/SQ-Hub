import { z } from "zod";

import type { ApplicationAccessService } from "../application-access/service.js";
import type { ActorRef, IdentityRef } from "../application-access/types.js";
import type { IdentityManagement, ManagedStaffIdentity } from "../identity-management/client.js";
import type { PlatformAdminService } from "../platform-admin/service.js";
import type { LifecycleAuditWriter } from "./audit.js";
import type { VerifiedEmployee, VerifyEmployee } from "./hcis-client.js";
import { EmployeeVerificationError } from "./hcis-client.js";
import type { LifecycleOperationStore } from "./operation-store.js";

const reasonSchema = z.string().trim().min(1).max(1000);
const subjectSchema = z.string().trim().min(1).max(512);
const actorSchema = z.object({
  kind: z.enum(["human", "service", "system"]),
  ref: z.string().trim().min(1).max(512),
}).strict();

export const provisionStaffSchema = z.object({
  staffType: z.literal("employee"),
  employeeNumber: z.string().trim().min(1).max(80).optional(),
  username: z.string().trim().min(1).max(255),
  firstName: z.string().trim().min(1).max(255),
  lastName: z.string().trim().min(1).max(255),
  email: z.string().trim().email().max(320),
  enabled: z.literal(true),
  reason: reasonSchema,
}).strict().superRefine((value, ctx) => {
  if (value.staffType === "employee") {
    if (!value.employeeNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["employeeNumber"],
        message: "employee number is required",
      });
    } else if (value.username !== value.employeeNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["username"],
        message: "employee username must equal employee number",
      });
    }
  }
});

/** HUB-IMPL-024: the only fields HCIS sends; name and contacts are read from HCIS itself. */
export const hcisInviteSchema = z.object({
  employeeNumber: z.string().trim().min(1).max(80),
  requestedBy: z.object({ accountId: z.string().uuid() }).strict(),
}).strict();

export const HCIS_APPLICATION_KEY = "hcis";
const HCIS_INVITE_REASON = "HCIS aktivasi akun (HUB-IMPL-024)";

export type CredentialInitialization = "sent" | "required_action_pending" | "already_complete";

/**
 * Stable operational split of an HCIS display name into the two Keycloak name fields
 * (staff-identity-provisioning.md): first word, then the rest. A one-word name fills both
 * fields with that word (HUB-IMPL-024, DRAFT) instead of inventing a family name.
 */
export function splitDisplayName(displayName: string): { firstName: string; lastName: string } {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  const firstName = (words[0] ?? displayName.trim()).slice(0, 255);
  const rest = words.slice(1).join(" ").slice(0, 255);
  return { firstName, lastName: rest || firstName };
}

export const statusMutationSchema = z.object({
  subject: subjectSchema,
  enabled: z.literal(true),
  reason: reasonSchema,
  confirm: z.literal(true),
}).strict();

export const credentialActionSchema = z.object({
  subject: subjectSchema,
  reason: reasonSchema,
  confirm: z.literal(true),
}).strict();

export const offboardingSchema = z.object({
  subject: subjectSchema,
  reason: reasonSchema,
  confirm: z.literal(true),
}).strict();

export type OffboardingStepStatus = "succeeded" | "noop" | "failed";

export interface OffboardingStep {
  step: "application_access" | "platform_administrator" | "organ_membership" | "global_identity" | "final_verification";
  target: string;
  status: OffboardingStepStatus;
  message: string;
}

/**
 * HUB-IMPL-021 amendment to HUB-IMPL-013: offboarding ends any Organ Yayasan membership, and
 * provisioning reuses a Path B organ identity instead of creating a second Akun SQ.
 */
export interface OrganMembershipLifecyclePort {
  endForOffboarding(identity: IdentityRef, actor: ActorRef, reason: string): Promise<"succeeded" | "noop">;
  hasActiveMembership(identity: IdentityRef): Promise<boolean>;
  markExistingStaff(identity: IdentityRef, actor: ActorRef, reason: string): Promise<"succeeded" | "noop">;
  /** Hub's own record says it created this non-staff identity for a Path B organ membership. */
  isOrganProvisionedIdentity(identity: IdentityRef & { employeeId?: string }): Promise<boolean>;
}

/** H-10: refused through the Hub; the message points the operator to the Keycloak console. */
export class PlatformAdminCredentialError extends Error {
  readonly statusCode = 409;
  readonly code = "PLATFORM_ADMIN_CREDENTIAL_FORBIDDEN";

  constructor() {
    super("Akun Admin Platform hanya dapat diurus kata sandinya lewat konsol Keycloak.");
    this.name = "PlatformAdminCredentialError";
  }
}

export class StaffLifecycleService {
  private organMemberships?: OrganMembershipLifecyclePort;

  constructor(
    private readonly identityManagement: IdentityManagement,
    private readonly applicationAccess: Pick<
      ApplicationAccessService,
      "listApplications" | "getAccess" | "revoke" | "grant"
    >,
    private readonly platformAdmin: Pick<PlatformAdminService, "show" | "revoke">,
    private readonly audit: LifecycleAuditWriter,
    private readonly verifyEmployee: VerifyEmployee,
    private readonly operations: LifecycleOperationStore,
  ) {}

  attachOrganMemberships(port: OrganMembershipLifecyclePort) {
    this.organMemberships = port;
  }

  async provision(input: unknown, actor: ActorRef) {
    const parsed = provisionStaffSchema.parse(input);
    actorSchema.parse(actor);
    const email = parsed.email.toLowerCase();
    await this.audit.write({
      actor,
      action: "staff_identity.provision.attempt",
      targetHint: parsed.username,
      outcome: "succeeded",
      payload: { staffType: parsed.staffType, enabled: parsed.enabled, reason: parsed.reason },
    });
    let employee: VerifiedEmployee;
    try {
      employee = await this.verifyEmployee(parsed.employeeNumber!);
      if (employee.email?.toLowerCase() !== email) throw new EmployeeVerificationError("INVALID_CONTACT");
    } catch (error) {
      await this.audit.write({
        actor, action: "staff_identity.provision", targetHint: parsed.username,
        outcome: "failed", payload: { reason: parsed.reason, stage: "hcis_verify" },
      });
      throw error;
    }

    const result = await this.provisionVerified(parsed, employee, actor, { refuseDisabled: false });
    return { identity: toSafeIdentity(result.identity), credentialInitialization: result.credentialInitialization };
  }

  /**
   * HUB-IMPL-024: HCIS asks for an employee's Akun SQ by NIP only. Name and e-mail come from the
   * HCIS verification answer, never from the caller. Grants `hcis` Application Access only when
   * there is no record; a revoked grant stays revoked.
   */
  async inviteFromHcis(input: unknown, clientId: string): Promise<{
    identity: IdentityRef;
    employeeId: string;
    credentialInitialization: CredentialInitialization;
    applicationAccess: "granted" | "already_active" | "revoked";
  }> {
    const parsed = hcisInviteSchema.parse(input);
    const actor: ActorRef = {
      kind: "service",
      ref: `${clientId}:hcis-account:${parsed.requestedBy.accountId}`,
    };
    actorSchema.parse(actor);

    let employee: VerifiedEmployee;
    let email: string;
    try {
      employee = await this.verifyEmployee(parsed.employeeNumber);
      if (!employee.email) throw new EmployeeVerificationError("INVALID_CONTACT");
      email = employee.email.toLowerCase();
    } catch (error) {
      await this.audit.write({
        actor, action: "staff_identity.hcis_invite", targetHint: parsed.employeeNumber,
        outcome: "failed", payload: { stage: "hcis_verify" },
      });
      throw error;
    }

    const names = splitDisplayName(employee.displayName);
    const provisionInput = provisionStaffSchema.parse({
      staffType: "employee",
      employeeNumber: parsed.employeeNumber,
      username: parsed.employeeNumber,
      firstName: names.firstName,
      lastName: names.lastName,
      email,
      enabled: true,
      reason: HCIS_INVITE_REASON,
    });
    await this.audit.write({
      actor,
      action: "staff_identity.provision.attempt",
      targetHint: provisionInput.username,
      outcome: "succeeded",
      payload: { staffType: provisionInput.staffType, enabled: provisionInput.enabled, reason: provisionInput.reason },
    });
    const result = await this.provisionVerified(provisionInput, employee, actor, { refuseDisabled: true });
    const identityRef = toRef(result.identity);

    let applicationAccess: "granted" | "already_active" | "revoked";
    try {
      const current = await this.applicationAccess.getAccess(identityRef, HCIS_APPLICATION_KEY);
      if (current?.status === "active") {
        applicationAccess = "already_active";
      } else if (current?.status === "revoked") {
        applicationAccess = "revoked";
      } else {
        await this.applicationAccess.grant({
          identity: identityRef,
          applicationKey: HCIS_APPLICATION_KEY,
          reason: HCIS_INVITE_REASON,
          actor,
        });
        applicationAccess = "granted";
      }
    } catch (error) {
      await this.audit.write({
        actor, action: "staff_identity.hcis_invite", identity: identityRef,
        outcome: "failed",
        payload: { stage: "application_access", credentialInitialization: result.credentialInitialization },
      });
      throw error;
    }

    await this.audit.write({
      actor,
      action: "staff_identity.hcis_invite",
      identity: identityRef,
      outcome: "succeeded",
      payload: { credentialInitialization: result.credentialInitialization, applicationAccess },
    });
    return {
      identity: identityRef,
      employeeId: employee.employeeId,
      credentialInitialization: result.credentialInitialization,
      applicationAccess,
    };
  }

  private async provisionVerified(
    parsed: z.infer<typeof provisionStaffSchema>,
    employee: VerifiedEmployee,
    actor: ActorRef,
    options: { refuseDisabled: boolean },
  ): Promise<{ identity: ManagedStaffIdentity; credentialInitialization: CredentialInitialization }> {
    const email = parsed.email.toLowerCase();
    let identity: ManagedStaffIdentity;
    try {
      const existing = await this.identityManagement.findByUsername(parsed.username);
      const organIdentity = existing ? null : await this.findOrganIdentity(email);
      if (existing && (existing.employeeId !== employee.employeeId || existing.email.toLowerCase() !== email)) {
        throw new Error("EMPLOYEE_IDENTITY_CONFLICT");
      }
      // HUB-IMPL-024: a disabled Akun SQ is re-enabled only by an explicit Admin Center action.
      if (options.refuseDisabled && ((existing && !existing.enabled) || (organIdentity && !organIdentity.enabled))) {
        throw new Error("STAFF_IDENTITY_DISABLED");
      }
      if (existing) {
        identity = existing;
      } else if (organIdentity) {
        // HUB-IMPL-021 §1: an organ member who becomes an Employee keeps the same Akun SQ.
        identity = await this.identityManagement.linkEmployee(organIdentity.subject, employee.employeeId);
        await this.organMemberships?.markExistingStaff(toRef(identity), actor, parsed.reason);
        await this.audit.write({
          actor,
          action: "staff_identity.link_organ_identity",
          identity: toRef(identity),
          outcome: "succeeded",
          payload: { reason: parsed.reason },
        });
      } else {
        identity = await this.identityManagement.createStaff({
        username: parsed.username,
        email,
        employeeId: employee.employeeId,
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        enabled: parsed.enabled,
        });
      }
    } catch (error) {
      await this.audit.write({
        actor,
        action: "staff_identity.provision",
        targetHint: parsed.username,
        outcome: "failed",
        payload: { staffType: parsed.staffType, reason: parsed.reason, stage: "identity_create" },
      });
      throw error;
    }

    let credentialInitialization: CredentialInitialization = "sent";
    try {
      if (identity.requiredActions && !identity.requiredActions.includes("UPDATE_PASSWORD")) {
        credentialInitialization = "already_complete";
      } else if ((await this.platformAdmin.show(toRef(identity)))?.status === "active") {
        // H-10 also on this path: an existing Platform Administrator account gets no password e-mail.
        credentialInitialization = "required_action_pending";
        await this.audit.write({
          actor,
          action: "staff_identity.password_initialization",
          identity: toRef(identity),
          outcome: "failed",
          payload: { reason: parsed.reason, state: "platform_administrator" },
        });
      } else {
        await this.identityManagement.sendPasswordInitialization(identity.subject);
      }
    } catch {
      credentialInitialization = "required_action_pending";
      await this.audit.write({
        actor,
        action: "staff_identity.password_initialization",
        identity: toRef(identity),
        outcome: "failed",
        payload: { reason: parsed.reason, state: "required_action_pending" },
      });
    }

    await this.audit.write({
      actor,
      action: "staff_identity.provision",
      identity: toRef(identity),
      outcome: "succeeded",
      payload: {
        staffType: parsed.staffType,
        enabled: identity.enabled,
        emailVerified: identity.emailVerified,
        credentialInitialization,
        reason: parsed.reason,
      },
    });

    return { identity, credentialInitialization };
  }

  async setEnabled(input: unknown, actor: ActorRef) {
    const parsed = statusMutationSchema.parse(input);
    actorSchema.parse(actor);
    const before = await this.requireIdentity(parsed.subject);
    const action = "staff_identity.enable";
    await this.audit.write({
      actor,
      action: `${action}.attempt`,
      identity: toRef(before),
      outcome: "succeeded",
      payload: { requestedEnabled: parsed.enabled, reason: parsed.reason },
    });

    try {
      const result = await this.identityManagement.setEnabled(parsed.subject, parsed.enabled);
      await this.audit.write({
        actor,
        action,
        identity: toRef(result.identity),
        outcome: result.changed ? "succeeded" : "noop",
        payload: { enabled: result.identity.enabled, reason: parsed.reason },
      });
      return {
        outcome: result.changed ? "succeeded" as const : "noop" as const,
        identity: toSafeIdentity(result.identity),
      };
    } catch (error) {
      await this.audit.write({
        actor,
        action,
        identity: toRef(before),
        outcome: "failed",
        payload: { requestedEnabled: parsed.enabled, reason: parsed.reason, stage: "identity_update" },
      });
      throw error;
    }
  }

  async sendPasswordInitialization(input: unknown, actor: ActorRef) {
    const parsed = credentialActionSchema.parse(input);
    actorSchema.parse(actor);
    const identity = await this.requireIdentity(parsed.subject);
    // HUB-IMPL-023 H-10: a credential action on a Platform Administrator's account is one step
    // from acting as that administrator, so it goes through the Keycloak console only.
    if ((await this.platformAdmin.show(toRef(identity)))?.status === "active") {
      await this.audit.write({
        actor,
        action: "staff_identity.password_initialization",
        identity: toRef(identity),
        outcome: "failed",
        payload: { reason: parsed.reason, state: "platform_administrator" },
      });
      throw new PlatformAdminCredentialError();
    }
    await this.audit.write({
      actor,
      action: "staff_identity.password_initialization.attempt",
      identity: toRef(identity),
      outcome: "succeeded",
      payload: { reason: parsed.reason },
    });

    try {
      await this.identityManagement.sendPasswordInitialization(parsed.subject);
    } catch (error) {
      await this.audit.write({
        actor,
        action: "staff_identity.password_initialization",
        identity: toRef(identity),
        outcome: "failed",
        payload: { reason: parsed.reason, state: "required_action_pending" },
      });
      throw error;
    }

    await this.audit.write({
      actor,
      action: "staff_identity.password_initialization",
      identity: toRef(identity),
      outcome: "succeeded",
      payload: { requiredAction: "VERIFY_EMAIL+UPDATE_PASSWORD", reason: parsed.reason },
    });
    return { outcome: "succeeded" as const, requiredAction: "VERIFY_EMAIL+UPDATE_PASSWORD" as const };
  }

  async previewOffboarding(subject: string) {
    const safeSubject = subjectSchema.parse(subject);
    const identity = await this.requireIdentity(safeSubject);
    const identityRef = toRef(identity);
    const applications = await this.applicationAccess.listApplications();
    const activeApplications: Array<{ key: string; name: string }> = [];
    for (const application of applications) {
      const access = await this.applicationAccess.getAccess(identityRef, application.applicationKey);
      if (access?.status === "active") {
        activeApplications.push({ key: application.applicationKey, name: application.name });
      }
    }
    const adminMembership = await this.platformAdmin.show(identityRef);
    return {
      identity: toSafeIdentity(identity),
      activeApplications,
      platformAdministrator: adminMembership?.status === "active",
      organMembership: this.organMemberships ? await this.organMemberships.hasActiveMembership(identityRef) : false,
      globalIdentityEnabled: identity.enabled,
      hcisEmployeeStatus: "not_read_or_inferred" as const,
    };
  }

  async offboard(input: unknown, actor: ActorRef) {
    const parsed = offboardingSchema.parse(input);
    actorSchema.parse(actor);
    const identity = await this.requireIdentity(parsed.subject);
    const identityRef = toRef(identity);
    return this.operations.withIdentityLock(identityRef, async (locked) => {
    const operation = await locked.begin(actor, parsed.reason);
    await this.audit.write({
      actor,
      action: "staff_identity.offboard.attempt",
      identity: identityRef,
      outcome: "succeeded",
      payload: { reason: parsed.reason, operationId: operation.id },
    });

    const steps: OffboardingStep[] = [];
    const recordStep = async (step: OffboardingStep) => {
      steps.push(step);
      operation.steps = steps;
      await locked.update(operation);
    };
    let applications: Awaited<ReturnType<typeof this.applicationAccess.listApplications>> = [];
    try {
      applications = await this.applicationAccess.listApplications();
    } catch {
      await recordStep({
        step: "application_access", target: "all", status: "failed",
        message: "Daftar akses aplikasi tidak tersedia; ulangi setelah pemulihan.",
      });
    }
    for (const application of applications) {
      try {
        const access = await this.applicationAccess.getAccess(identityRef, application.applicationKey);
        if (access?.status !== "active") {
          await recordStep({
            step: "application_access",
            target: application.applicationKey,
            status: "noop",
            message: "Akses sudah tidak aktif.",
          });
          continue;
        }
        await this.applicationAccess.revoke({
          identity: identityRef,
          applicationKey: application.applicationKey,
          reason: parsed.reason,
          actor,
        });
        if ((await this.applicationAccess.getAccess(identityRef, application.applicationKey))?.status === "active") {
          throw new Error("ACCESS_NOT_VERIFIED");
        }
        await recordStep({
          step: "application_access",
          target: application.applicationKey,
          status: "succeeded",
          message: "Akses aplikasi dicabut.",
        });
      } catch {
        await this.audit.write({
          actor,
          action: "staff_identity.offboard.application_access",
          identity: identityRef,
          outcome: "failed",
          payload: { applicationKey: application.applicationKey, reason: parsed.reason, operationId: operation.id },
        });
        await recordStep({
          step: "application_access",
          target: application.applicationKey,
          status: "failed",
          message: "Akses aplikasi gagal dicabut; aman untuk dicoba ulang.",
        });
      }
    }

    try {
      const membership = await this.platformAdmin.show(identityRef);
      if (membership?.status === "active") {
        const result = await this.platformAdmin.revoke({
          identity: identityRef,
          reason: parsed.reason,
          actor,
        });
        if ((await this.platformAdmin.show(identityRef))?.status === "active") {
          throw new Error("ADMIN_REVOCATION_NOT_VERIFIED");
        }
        await recordStep({
          step: "platform_administrator",
          target: "platform-administrator",
          status: result.outcome,
          message: result.outcome === "succeeded"
            ? "Keanggotaan Platform Administrator dicabut."
            : "Keanggotaan sudah tidak aktif.",
        });
      } else {
        await recordStep({
          step: "platform_administrator",
          target: "platform-administrator",
          status: "noop",
          message: "Keanggotaan Platform Administrator sudah tidak aktif.",
        });
      }
    } catch {
      await this.audit.write({
        actor,
        action: "staff_identity.offboard.platform_administrator",
        identity: identityRef,
        outcome: "failed",
        payload: { reason: parsed.reason, operationId: operation.id },
      });
      await recordStep({
        step: "platform_administrator",
        target: "platform-administrator",
        status: "failed",
        message: "Keanggotaan Platform Administrator gagal dicabut; aman untuk dicoba ulang.",
      });
    }

    if (this.organMemberships) {
      try {
        const result = await this.organMemberships.endForOffboarding(identityRef, actor, parsed.reason);
        if (await this.organMemberships.hasActiveMembership(identityRef)) throw new Error("ORGAN_MEMBERSHIP_NOT_VERIFIED");
        await recordStep({
          step: "organ_membership",
          target: "organ-membership",
          status: result,
          message: result === "succeeded" ? "Keanggotaan Organ Yayasan diakhiri." : "Tidak ada keanggotaan Organ Yayasan aktif.",
        });
      } catch {
        await this.audit.write({
          actor,
          action: "staff_identity.offboard.organ_membership",
          identity: identityRef,
          outcome: "failed",
          payload: { reason: parsed.reason, operationId: operation.id },
        });
        await recordStep({
          step: "organ_membership",
          target: "organ-membership",
          status: "failed",
          message: "Keanggotaan Organ Yayasan gagal diakhiri; aman untuk dicoba ulang.",
        });
      }
    }

    {
      try {
        await this.audit.write({
          actor,
          action: "staff_identity.disable.attempt",
          identity: identityRef,
          outcome: "succeeded",
          payload: { reason: parsed.reason, source: "platform_offboarding", operationId: operation.id },
        });
        const result = await this.identityManagement.setEnabled(parsed.subject, false);
        if ((await this.requireIdentity(parsed.subject)).enabled) {
          throw new Error("IDENTITY_DISABLE_NOT_VERIFIED");
        }
        await this.audit.write({
          actor,
          action: "staff_identity.disable",
          identity: identityRef,
          outcome: result.changed ? "succeeded" : "noop",
          payload: { reason: parsed.reason, source: "platform_offboarding", operationId: operation.id },
        });
        await recordStep({
          step: "global_identity",
          target: "akun-sq",
          status: result.changed ? "succeeded" : "noop",
          message: result.changed
            ? "Identitas global dinonaktifkan."
            : "Identitas global sudah nonaktif.",
        });
      } catch {
        await this.audit.write({
          actor,
          action: "staff_identity.disable",
          identity: identityRef,
          outcome: "failed",
          payload: { reason: parsed.reason, source: "platform_offboarding", stage: "identity_update", operationId: operation.id },
        });
        await recordStep({
          step: "global_identity",
          target: "akun-sq",
          status: "failed",
          message: "Identitas global gagal dinonaktifkan; aman untuk dicoba ulang.",
        });
      }
    }

    try {
      const finalApplications = await this.applicationAccess.listApplications();
      for (const application of finalApplications) {
        if ((await this.applicationAccess.getAccess(identityRef, application.applicationKey))?.status === "active") {
          throw new Error("ACTIVE_APPLICATION_ACCESS");
        }
      }
      if ((await this.platformAdmin.show(identityRef))?.status === "active") throw new Error("ACTIVE_PLATFORM_ADMIN");
      if (await this.organMemberships?.hasActiveMembership(identityRef)) throw new Error("ACTIVE_ORGAN_MEMBERSHIP");
      if ((await this.requireIdentity(parsed.subject)).enabled) throw new Error("ACTIVE_GLOBAL_IDENTITY");
      await recordStep({ step: "final_verification", target: "all", status: "succeeded", message: "Seluruh status akhir terverifikasi." });
    } catch {
      await recordStep({ step: "final_verification", target: "all", status: "failed", message: "Status akhir belum dapat diverifikasi; ulangi operasi." });
    }

    const failed = steps.filter((step) => step.status === "failed").length;
    const succeeded = steps.filter((step) => step.status === "succeeded").length;
    const outcome = failed === 0
      ? "succeeded"
      : succeeded > 0
        ? "partial_failure"
        : "failed";
    operation.status = failed === 0 ? "COMPLETED" : "PARTIAL_FAILURE";
    await this.audit.write({
      actor,
      action: "staff_identity.offboard",
      identity: identityRef,
      outcome: outcome === "succeeded" ? "succeeded" : "failed",
      payload: {
        result: outcome,
        reason: parsed.reason,
        failedSteps: failed,
        operationId: operation.id,
      },
    });
    await locked.update(operation);
    return { operationId: operation.id, outcome, steps };
    });
  }

  private async findOrganIdentity(email: string): Promise<ManagedStaffIdentity | null> {
    const matches = await this.identityManagement.findByUsernameOrEmail(email);
    if (matches.length !== 1) return null;
    const [match] = matches;
    if (match!.employeeId || match!.email.toLowerCase() !== email || !this.organMemberships) return null;
    return (await this.organMemberships.isOrganProvisionedIdentity(match!)) ? match! : null;
  }

  private async requireIdentity(subject: string): Promise<ManagedStaffIdentity> {
    const identity = await this.identityManagement.inspect(subject);
    if (!identity) {
      const error = new Error("STAFF_NOT_FOUND");
      error.name = "StaffLifecycleNotFoundError";
      throw error;
    }
    return identity;
  }
}

function toRef(identity: ManagedStaffIdentity): IdentityRef {
  return { issuer: identity.issuer, subject: identity.subject };
}

function toSafeIdentity(identity: ManagedStaffIdentity) {
  return {
    subject: identity.subject,
    username: identity.username,
    email: identity.email,
    emailVerified: identity.emailVerified,
    firstName: identity.firstName,
    lastName: identity.lastName,
    enabled: identity.enabled,
  };
}
