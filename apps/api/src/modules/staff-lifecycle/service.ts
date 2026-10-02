import { z } from "zod";

import type { ApplicationAccessService } from "../application-access/service.js";
import type { ActorRef, IdentityRef } from "../application-access/types.js";
import type { IdentityManagement, ManagedStaffIdentity } from "../identity-management/client.js";
import type { PlatformAdminService } from "../platform-admin/service.js";
import type { LifecycleAuditWriter } from "./audit.js";
import type { VerifyEmployee } from "./hcis-client.js";
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
  step: "application_access" | "platform_administrator" | "global_identity" | "final_verification";
  target: string;
  status: OffboardingStepStatus;
  message: string;
}

export class StaffLifecycleService {
  constructor(
    private readonly identityManagement: IdentityManagement,
    private readonly applicationAccess: Pick<
      ApplicationAccessService,
      "listApplications" | "getAccess" | "revoke"
    >,
    private readonly platformAdmin: Pick<PlatformAdminService, "show" | "revoke">,
    private readonly audit: LifecycleAuditWriter,
    private readonly verifyEmployee: VerifyEmployee,
    private readonly operations: LifecycleOperationStore,
  ) {}

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
    let employee;
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

    let identity: ManagedStaffIdentity;
    try {
      const existing = await this.identityManagement.findByUsername(parsed.username);
      if (existing) {
        if (existing.employeeId !== employee.employeeId || existing.email.toLowerCase() !== email) {
          throw new Error("EMPLOYEE_IDENTITY_CONFLICT");
        }
        identity = existing;
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

    let credentialInitialization: "sent" | "required_action_pending" | "already_complete" = "sent";
    try {
      if (identity.requiredActions && !identity.requiredActions.includes("UPDATE_PASSWORD")) {
        credentialInitialization = "already_complete";
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

    return { identity: toSafeIdentity(identity), credentialInitialization };
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
