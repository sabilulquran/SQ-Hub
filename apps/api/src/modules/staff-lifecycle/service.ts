import { z } from "zod";

import type { ApplicationAccessService } from "../application-access/service.js";
import type { ActorRef, IdentityRef } from "../application-access/types.js";
import type { IdentityManagement, ManagedStaffIdentity } from "../identity-management/client.js";
import type { PlatformAdminService } from "../platform-admin/service.js";
import type { LifecycleAuditWriter } from "./audit.js";

const reasonSchema = z.string().trim().min(1).max(1000);
const subjectSchema = z.string().trim().min(1).max(512);
const actorSchema = z.object({
  kind: z.enum(["human", "service", "system"]),
  ref: z.string().trim().min(1).max(512),
}).strict();

export const provisionStaffSchema = z.object({
  staffType: z.enum(["employee", "staff_without_nip"]),
  employeeNumber: z.string().trim().min(1).max(80).optional(),
  username: z.string().trim().min(1).max(255),
  firstName: z.string().trim().min(1).max(255),
  lastName: z.string().trim().min(1).max(255),
  email: z.string().trim().email().max(320),
  emailVerified: z.literal(true),
  enabled: z.boolean().default(true),
  reason: reasonSchema,
}).strict().superRefine((value, ctx) => {
  const email = value.email.toLowerCase();
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
  } else {
    if (value.employeeNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["employeeNumber"],
        message: "staff without NIP cannot claim an employee number",
      });
    }
    if (value.username.toLowerCase() !== email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["username"],
        message: "staff without NIP must use verified email as username",
      });
    }
  }
});

export const statusMutationSchema = z.object({
  subject: subjectSchema,
  enabled: z.boolean(),
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
  disableIdentity: z.boolean(),
  confirm: z.literal(true),
}).strict();

export type OffboardingStepStatus = "succeeded" | "noop" | "failed";

export interface OffboardingStep {
  step: "application_access" | "platform_administrator" | "global_identity";
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

    let identity: ManagedStaffIdentity;
    try {
      identity = await this.identityManagement.createStaff({
        username: parsed.username,
        email,
        emailVerified: true,
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        enabled: parsed.enabled,
      });
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

    let credentialInitialization: "sent" | "required_action_pending" = "sent";
    try {
      await this.identityManagement.sendPasswordInitialization(identity.subject);
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
    const action = parsed.enabled ? "staff_identity.enable" : "staff_identity.disable";
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
      payload: { requiredAction: "UPDATE_PASSWORD", reason: parsed.reason },
    });
    return { outcome: "succeeded" as const, requiredAction: "UPDATE_PASSWORD" as const };
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
    await this.audit.write({
      actor,
      action: "staff_identity.offboard.attempt",
      identity: identityRef,
      outcome: "succeeded",
      payload: { disableIdentity: parsed.disableIdentity, reason: parsed.reason },
    });

    const steps: OffboardingStep[] = [];
    const applications = await this.applicationAccess.listApplications();
    for (const application of applications) {
      try {
        const access = await this.applicationAccess.getAccess(identityRef, application.applicationKey);
        if (access?.status !== "active") {
          steps.push({
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
        steps.push({
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
          payload: { applicationKey: application.applicationKey, reason: parsed.reason },
        });
        steps.push({
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
        steps.push({
          step: "platform_administrator",
          target: "platform-administrator",
          status: result.outcome,
          message: result.outcome === "succeeded"
            ? "Keanggotaan Platform Administrator dicabut."
            : "Keanggotaan sudah tidak aktif.",
        });
      } else {
        steps.push({
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
        payload: { reason: parsed.reason },
      });
      steps.push({
        step: "platform_administrator",
        target: "platform-administrator",
        status: "failed",
        message: "Keanggotaan Platform Administrator gagal dicabut; aman untuk dicoba ulang.",
      });
    }

    if (parsed.disableIdentity) {
      try {
        await this.audit.write({
          actor,
          action: "staff_identity.disable.attempt",
          identity: identityRef,
          outcome: "succeeded",
          payload: { reason: parsed.reason, source: "platform_offboarding" },
        });
        const result = await this.identityManagement.setEnabled(parsed.subject, false);
        await this.audit.write({
          actor,
          action: "staff_identity.disable",
          identity: identityRef,
          outcome: result.changed ? "succeeded" : "noop",
          payload: { reason: parsed.reason, source: "platform_offboarding" },
        });
        steps.push({
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
          payload: { reason: parsed.reason, source: "platform_offboarding", stage: "identity_update" },
        });
        steps.push({
          step: "global_identity",
          target: "akun-sq",
          status: "failed",
          message: "Identitas global gagal dinonaktifkan; aman untuk dicoba ulang.",
        });
      }
    } else {
      steps.push({
        step: "global_identity",
        target: "akun-sq",
        status: "noop",
        message: "Identitas global sengaja tidak diubah.",
      });
    }

    const failed = steps.filter((step) => step.status === "failed").length;
    const succeeded = steps.filter((step) => step.status === "succeeded").length;
    const outcome = failed === 0
      ? "succeeded"
      : succeeded > 0
        ? "partial_failure"
        : "failed";
    await this.audit.write({
      actor,
      action: "staff_identity.offboard",
      identity: identityRef,
      outcome: outcome === "succeeded" ? "succeeded" : "failed",
      payload: {
        result: outcome,
        disableIdentity: parsed.disableIdentity,
        reason: parsed.reason,
        failedSteps: failed,
      },
    });
    return { outcome, steps };
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
