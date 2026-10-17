import { z } from "zod";

import type { ApplicationAccessService } from "../application-access/service.js";
import type { ActorRef, ApplicationRecord, IdentityRef } from "../application-access/types.js";
import type { IdentityDirectory, StaffDirectoryEntry } from "../identity-directory/client.js";
import type { IdentityManagement, ManagedStaffIdentity } from "../identity-management/client.js";
import type { StaffLifecycleService } from "../staff-lifecycle/service.js";
import {
  OrganMembershipConflictError,
  OrganMembershipNotFoundError,
  type OrganMembershipRecord,
  type OrganMembershipStore,
  type OrganMembershipTerms,
} from "./repository.js";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "invalid date");
const reasonSchema = z.string().trim().min(1).max(1000);
const subjectSchema = z.string().trim().min(1).max(512);
const applicationKeysSchema = z.array(z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,62}$/)).max(50).default([]);

const termsShape = {
  organ: z.enum(["pembina", "pengurus", "pengawas"]),
  positionLabel: z.string().trim().max(120).optional().transform((value) => value || null),
  termStart: dateSchema,
  termEnd: dateSchema.nullable().optional().transform((value) => value ?? null),
};

function refineTerm(value: { termStart: string; termEnd: string | null }, ctx: z.RefinementCtx) {
  if (value.termEnd !== null && value.termEnd <= value.termStart) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["termEnd"], message: "term end must be after term start" });
  }
}

export const existingStaffMembershipSchema = z
  .object({ subject: subjectSchema, ...termsShape, reason: reasonSchema, applicationKeys: applicationKeysSchema })
  .strict()
  .superRefine(refineTerm);

export const newIdentityMembershipSchema = z
  .object({
    firstName: z.string().trim().min(1).max(255),
    lastName: z.string().trim().min(1).max(255),
    email: z.string().trim().toLowerCase().email().max(320),
    ...termsShape,
    reason: reasonSchema,
    applicationKeys: applicationKeysSchema,
  })
  .strict()
  .superRefine(refineTerm);

export const changeMembershipSchema = z
  .object({ ...termsShape, reason: reasonSchema })
  .strict()
  .superRefine(refineTerm);

export const endMembershipSchema = z.object({ reason: reasonSchema, confirm: z.literal(true) }).strict();
export const resendActivationSchema = z.object({ reason: reasonSchema, confirm: z.literal(true) }).strict();

export type OrganOperationStepStatus = "succeeded" | "noop" | "failed";

export interface OrganOperationStep {
  step: "totp_requirement" | "identity" | "activation_email" | "organ_membership" | "application_access";
  target: string;
  status: OrganOperationStepStatus;
  message: string;
}

export type OrganMembershipErrorCode =
  | "ORGAN_SELF_MUTATION_FORBIDDEN"
  | "ORGAN_MEMBERSHIP_EXISTS"
  | "ORGAN_MEMBERSHIP_NOT_FOUND"
  | "ORGAN_MEMBERSHIP_ENDED"
  | "STAFF_NOT_FOUND"
  | "EMAIL_IN_USE_USE_EXISTING_STAFF"
  | "ORGAN_IDENTITY_DISABLED"
  | "ORGAN_PROVISIONING_UNAVAILABLE"
  | "NOT_GOVERNANCE_APPLICATION"
  | "ORGAN_PATH_B_ONLY";

export class OrganMembershipError extends Error {
  constructor(public readonly code: OrganMembershipErrorCode, public readonly statusCode: number) {
    super(code);
    this.name = "OrganMembershipError";
  }
}

export interface GovernanceApplicationView {
  key: string;
  name: string;
}

type AccessPort = Pick<ApplicationAccessService, "listApplications" | "getAccess" | "grant">;

export class OrganMembershipService {
  constructor(
    private readonly store: OrganMembershipStore,
    private readonly applicationAccess: AccessPort,
    private readonly directory: Pick<IdentityDirectory, "inspect" | "issuer">,
    private readonly identityManagement?: IdentityManagement,
    private readonly staffLifecycle?: Pick<StaffLifecycleService, "previewOffboarding" | "offboard">,
  ) {}

  get provisioningAvailable(): boolean {
    return Boolean(this.identityManagement);
  }

  get pathBEndAvailable(): boolean {
    return Boolean(this.identityManagement && this.staffLifecycle);
  }

  getEffective(identity: IdentityRef): Promise<OrganMembershipRecord | null> {
    return this.store.getEffective(identity);
  }

  async governanceApplications(): Promise<GovernanceApplicationView[]> {
    return sortGovernance(await this.applicationAccess.listApplications())
      .map((application) => ({ key: application.applicationKey, name: application.name }));
  }

  async overview() {
    const [active, ended, ending] = await Promise.all([
      this.store.listActive(),
      this.store.listRecentlyEnded(20),
      this.store.listEndingWithin(30),
    ]);
    const people = new Map<string, Promise<StaffDirectoryEntry | null>>();
    const person = (record: OrganMembershipRecord) => {
      const key = record.identity.subject;
      if (!people.has(key)) people.set(key, this.safeInspect(record.identity));
      return people.get(key)!;
    };
    const view = async (record: OrganMembershipRecord) => toMembershipView(record, await person(record));
    return {
      active: await Promise.all(active.map(view)),
      endingSoon: await Promise.all(ending.map(view)),
      recentlyEnded: await Promise.all(ended.map(view)),
    };
  }

  async detail(id: string) {
    const membership = await this.requireMembership(id);
    const person = await this.safeInspect(membership.identity);
    const governance = await this.governanceApplicationRecords();
    const access = await Promise.all(
      governance.map(async (application) => ({
        key: application.applicationKey,
        name: application.name,
        access: (await this.applicationAccess.getAccess(membership.identity, application.applicationKey))?.status ?? "none",
      })),
    );
    return {
      membership: toMembershipView(membership, person),
      security: { totpConfigured: person?.security.totpConfigured ?? null },
      governanceApplications: access,
    };
  }

  /** Path A: the person already has a staff Akun SQ. */
  async addExistingStaff(input: unknown, actor: ActorRef, session: IdentityRef) {
    const parsed = existingStaffMembershipSchema.parse(input);
    const person = await this.directory.inspect(parsed.subject);
    if (!person || normalize(person.identity.issuer) !== normalize(this.directory.issuer)) {
      throw new OrganMembershipError("STAFF_NOT_FOUND", 404);
    }
    const identity = person.identity;
    assertNotSelf(identity, session);
    const applications = await this.selectedGovernanceApplications(parsed.applicationKeys);

    const steps: OrganOperationStep[] = [];
    // Two-step verification is mandatory for organ members (HUB-IMPL-021 §1, AC 3c). The
    // membership is created only once Keycloak will require TOTP at the next sign-in.
    if (person.security.totpConfigured === true) {
      steps.push({ step: "totp_requirement", target: "akun-sq", status: "noop", message: "Verifikasi dua langkah sudah aktif." });
    } else {
      if (!this.identityManagement) throw new OrganMembershipError("ORGAN_PROVISIONING_UNAVAILABLE", 503);
      try {
        const result = await this.identityManagement.requireTotpSetup(identity.subject);
        steps.push({
          step: "totp_requirement",
          target: "akun-sq",
          status: result === "set" ? "succeeded" : "noop",
          message: "Verifikasi dua langkah diwajibkan pada masuk berikutnya.",
        });
        await this.store.audit({
          actor, action: "organ_identity.require_totp", identity,
          outcome: result === "set" ? "succeeded" : "noop", payload: { reason: parsed.reason },
        });
      } catch {
        await this.store.audit({
          actor, action: "organ_identity.require_totp", identity, outcome: "failed", payload: { reason: parsed.reason },
        });
        steps.push({
          step: "totp_requirement", target: "akun-sq", status: "failed",
          message: "Kewajiban verifikasi dua langkah gagal dipasang; keanggotaan belum dibuat. Aman untuk dicoba ulang.",
        });
        return { outcome: "failed" as const, membership: null, steps, domainRoleReminders: [] };
      }
    }

    return this.completeMembership({
      identity, terms: termsOf(parsed), reason: parsed.reason, provisioningPath: "existing_staff",
      applications, actor, steps,
    });
  }

  /** Path B: create a staff-realm Akun SQ for a person who is not staff, then the membership. */
  async addNewIdentity(input: unknown, actor: ActorRef) {
    const parsed = newIdentityMembershipSchema.parse(input);
    const management = this.identityManagement;
    if (!management) throw new OrganMembershipError("ORGAN_PROVISIONING_UNAVAILABLE", 503);
    const applications = await this.selectedGovernanceApplications(parsed.applicationKeys);
    const steps: OrganOperationStep[] = [];

    await this.store.audit({
      actor, action: "organ_identity.provision.attempt", identity: null, targetHint: parsed.email,
      outcome: "succeeded", payload: { organ: parsed.organ, reason: parsed.reason },
    });

    // Refuse any e-mail already used by a staff identity; offer Path A. The only identity that
    // may be reused is one this flow created earlier, so a retry after a partial failure is safe.
    const matches = await management.findByUsernameOrEmail(parsed.email);
    let identity: ManagedStaffIdentity;
    if (matches.length > 0) {
      const [match] = matches;
      const resumable =
        matches.length === 1 &&
        match!.organProvisioned === true &&
        !match!.employeeId &&
        match!.username.toLowerCase() === parsed.email &&
        match!.email.toLowerCase() === parsed.email;
      if (!resumable) throw new OrganMembershipError("EMAIL_IN_USE_USE_EXISTING_STAFF", 409);
      if (!match!.enabled) throw new OrganMembershipError("ORGAN_IDENTITY_DISABLED", 409);
      identity = match!;
      steps.push({ step: "identity", target: "akun-sq", status: "noop", message: "Akun SQ dari percobaan sebelumnya dipakai kembali." });
    } else {
      try {
        identity = await management.createOrganMember({
          email: parsed.email, firstName: parsed.firstName, lastName: parsed.lastName,
        });
      } catch (error) {
        await this.store.audit({
          actor, action: "organ_identity.provision", identity: null, targetHint: parsed.email,
          outcome: "failed", payload: { reason: parsed.reason, stage: "identity_create" },
        });
        throw error;
      }
      await this.store.audit({
        actor, action: "organ_identity.provision", identity: toRef(identity), outcome: "succeeded",
        payload: { organ: parsed.organ, reason: parsed.reason, requiredActions: "VERIFY_EMAIL+UPDATE_PASSWORD+CONFIGURE_TOTP" },
      });
      steps.push({ step: "identity", target: "akun-sq", status: "succeeded", message: "Akun SQ dibuat dengan e-mail sebagai nama pengguna." });
    }

    const ref = toRef(identity);
    steps.push(await this.sendActivation(identity, actor, parsed.reason));
    return this.completeMembership({
      identity: ref, terms: termsOf(parsed), reason: parsed.reason, provisioningPath: "organ_identity",
      applications, actor, steps,
    });
  }

  async change(id: string, input: unknown, actor: ActorRef, session: IdentityRef) {
    const parsed = changeMembershipSchema.parse(input);
    const membership = await this.requireMembership(id);
    assertNotSelf(membership.identity, session);
    if (membership.status !== "active") throw new OrganMembershipError("ORGAN_MEMBERSHIP_ENDED", 409);
    try {
      const updated = await this.store.change({ id, terms: termsOf(parsed), reason: parsed.reason, actor });
      return { membership: toMembershipView(updated, await this.safeInspect(updated.identity)) };
    } catch (error) {
      if (error instanceof OrganMembershipNotFoundError) throw new OrganMembershipError("ORGAN_MEMBERSHIP_ENDED", 409);
      throw error;
    }
  }

  async endPreview(id: string) {
    const membership = await this.requireMembership(id);
    const pathB = await this.isPathB(membership);
    const reminders = await this.domainRoleReminders(membership.identity);
    if (!pathB) {
      return { path: "existing_staff" as const, membership: toMembershipView(membership, await this.safeInspect(membership.identity)), domainRoleReminders: reminders, offboarding: null };
    }
    if (!this.staffLifecycle) throw new OrganMembershipError("ORGAN_PROVISIONING_UNAVAILABLE", 503);
    const preview = await this.staffLifecycle.previewOffboarding(membership.identity.subject);
    return {
      path: "organ_identity" as const,
      membership: toMembershipView(membership, await this.safeInspect(membership.identity)),
      domainRoleReminders: reminders,
      offboarding: {
        activeApplications: preview.activeApplications,
        platformAdministrator: preview.platformAdministrator,
        globalIdentityEnabled: preview.globalIdentityEnabled,
      },
    };
  }

  async end(id: string, input: unknown, actor: ActorRef, session: IdentityRef) {
    const parsed = endMembershipSchema.parse(input);
    const membership = await this.requireMembership(id);
    assertNotSelf(membership.identity, session);
    const reminders = await this.domainRoleReminders(membership.identity);

    if (!(await this.isPathB(membership))) {
      // Path A: the person stays staff; identity and Application Access are untouched.
      const result = await this.store.end({ id, reason: parsed.reason, actor });
      return {
        path: "existing_staff" as const,
        outcome: result.outcome,
        steps: [{
          step: "organ_membership" as const, target: "organ-membership", status: result.outcome,
          message: result.outcome === "succeeded" ? "Keanggotaan organ diakhiri." : "Keanggotaan organ sudah berakhir.",
        }],
        domainRoleReminders: reminders,
      };
    }

    // Path B: the same action revokes all Application Access and disables the identity, as one
    // durable HUB-IMPL-013 offboarding operation (which also ends the membership).
    if (!this.staffLifecycle) throw new OrganMembershipError("ORGAN_PROVISIONING_UNAVAILABLE", 503);
    const result = await this.staffLifecycle.offboard(
      { subject: membership.identity.subject, reason: parsed.reason, confirm: true },
      actor,
    );
    return {
      path: "organ_identity" as const,
      outcome: result.outcome,
      operationId: result.operationId,
      steps: result.steps,
      domainRoleReminders: reminders,
    };
  }

  async resendActivation(id: string, input: unknown, actor: ActorRef, session: IdentityRef) {
    const parsed = resendActivationSchema.parse(input);
    const membership = await this.requireMembership(id);
    assertNotSelf(membership.identity, session);
    const management = this.identityManagement;
    if (!management) throw new OrganMembershipError("ORGAN_PROVISIONING_UNAVAILABLE", 503);
    if (membership.provisioningPath !== "organ_identity") throw new OrganMembershipError("ORGAN_PATH_B_ONLY", 409);
    const identity = await management.inspect(membership.identity.subject);
    if (!identity) throw new OrganMembershipError("STAFF_NOT_FOUND", 404);
    return { step: await this.sendActivation(identity, actor, parsed.reason) };
  }

  /** HUB-IMPL-013 offboarding amendment: end any active membership of the identity. */
  async endForOffboarding(identity: IdentityRef, actor: ActorRef, reason: string): Promise<"succeeded" | "noop"> {
    const active = await this.store.getActive(identity);
    if (!active) return "noop";
    return (await this.store.end({ id: active.id, reason, actor, source: "staff_offboarding" })).outcome;
  }

  async hasActiveMembership(identity: IdentityRef): Promise<boolean> {
    return Boolean(await this.store.getActive(identity));
  }

  /** HUB-IMPL-021 §1: a Path B member who becomes an Employee counts as Path A from then on. */
  markExistingStaff(identity: IdentityRef, actor: ActorRef, reason: string) {
    return this.store.markExistingStaff({ identity, actor, reason });
  }

  private async completeMembership(input: {
    identity: IdentityRef;
    terms: OrganMembershipTerms;
    reason: string;
    provisioningPath: "existing_staff" | "organ_identity";
    applications: ApplicationRecord[];
    actor: ActorRef;
    steps: OrganOperationStep[];
  }) {
    const { steps } = input;
    let membership: OrganMembershipRecord | null = await this.store.getActive(input.identity);
    if (membership) {
      steps.push({ step: "organ_membership", target: "organ-membership", status: "noop", message: "Keanggotaan organ aktif sudah ada." });
    } else {
      try {
        membership = await this.store.create({
          identity: input.identity, terms: input.terms, reason: input.reason,
          provisioningPath: input.provisioningPath, actor: input.actor,
        });
        steps.push({ step: "organ_membership", target: "organ-membership", status: "succeeded", message: "Keanggotaan organ dibuat." });
      } catch (error) {
        if (error instanceof OrganMembershipConflictError) throw new OrganMembershipError("ORGAN_MEMBERSHIP_EXISTS", 409);
        steps.push({
          step: "organ_membership", target: "organ-membership", status: "failed",
          message: "Keanggotaan organ gagal dibuat; aman untuk dicoba ulang.",
        });
        return { outcome: "partial_failure" as const, membership: null, steps, domainRoleReminders: [] };
      }
    }

    for (const application of input.applications) {
      try {
        const current = await this.applicationAccess.getAccess(input.identity, application.applicationKey);
        if (current?.status === "active") {
          steps.push({ step: "application_access", target: application.applicationKey, status: "noop", message: "Akses aplikasi sudah aktif." });
          continue;
        }
        await this.applicationAccess.grant({
          identity: input.identity, applicationKey: application.applicationKey, reason: input.reason, actor: input.actor,
        });
        steps.push({ step: "application_access", target: application.applicationKey, status: "succeeded", message: "Akses aplikasi diberikan." });
      } catch {
        steps.push({
          step: "application_access", target: application.applicationKey, status: "failed",
          message: "Akses aplikasi gagal diberikan; aman untuk dicoba ulang.",
        });
      }
    }

    const failed = steps.filter((step) => step.status === "failed").length;
    return {
      outcome: failed === 0 ? "succeeded" as const : "partial_failure" as const,
      membership: toMembershipView(membership, null),
      steps,
      // Hub never creates domain roles; it only reminds the administrator (HUB-IMPL-021 §1).
      domainRoleReminders: input.applications.map((application) => ({ key: application.applicationKey, name: application.name })),
    };
  }

  private async sendActivation(identity: ManagedStaffIdentity, actor: ActorRef, reason: string): Promise<OrganOperationStep> {
    if (!identity.requiredActions?.includes("UPDATE_PASSWORD")) {
      return { step: "activation_email", target: "akun-sq", status: "noop", message: "Akun SQ sudah diaktifkan pemiliknya." };
    }
    try {
      await this.identityManagement!.sendOrganActivation(identity.subject);
      await this.store.audit({
        actor, action: "organ_identity.activation_email", identity: toRef(identity), outcome: "succeeded",
        payload: { requiredAction: "VERIFY_EMAIL+UPDATE_PASSWORD", reason },
      });
      return { step: "activation_email", target: "akun-sq", status: "succeeded", message: "E-mail verifikasi dan pembuatan kata sandi (berlaku 12 jam) dikirim." };
    } catch {
      await this.store.audit({
        actor, action: "organ_identity.activation_email", identity: toRef(identity), outcome: "failed",
        payload: { reason, state: "required_action_pending" },
      });
      return { step: "activation_email", target: "akun-sq", status: "failed", message: "E-mail aktivasi belum terkirim; tindakan tetap menunggu. Kirim ulang dari halaman keanggotaan." };
    }
  }

  private async isPathB(membership: OrganMembershipRecord): Promise<boolean> {
    if (membership.provisioningPath !== "organ_identity") return false;
    if (!this.identityManagement) throw new OrganMembershipError("ORGAN_PROVISIONING_UNAVAILABLE", 503);
    const identity = await this.identityManagement.inspect(membership.identity.subject);
    if (!identity) throw new OrganMembershipError("STAFF_NOT_FOUND", 404);
    // A Path B member who later became an Employee is staff now and must not be disabled here.
    return !identity.employeeId;
  }

  private async domainRoleReminders(identity: IdentityRef) {
    const applications = await this.governanceApplicationRecords();
    const reminders: GovernanceApplicationView[] = [];
    for (const application of applications) {
      const access = await this.applicationAccess.getAccess(identity, application.applicationKey);
      if (access?.status === "active") reminders.push({ key: application.applicationKey, name: application.name });
    }
    return reminders;
  }

  private async governanceApplicationRecords(): Promise<ApplicationRecord[]> {
    return sortGovernance(await this.applicationAccess.listApplications());
  }

  private async selectedGovernanceApplications(keys: string[]): Promise<ApplicationRecord[]> {
    const governance = await this.governanceApplicationRecords();
    const byKey = new Map(governance.map((application) => [application.applicationKey, application]));
    const unique = [...new Set(keys)];
    const selected = unique.map((key) => byKey.get(key));
    if (selected.some((application) => !application)) {
      throw new OrganMembershipError("NOT_GOVERNANCE_APPLICATION", 400);
    }
    return selected as ApplicationRecord[];
  }

  private async requireMembership(id: string): Promise<OrganMembershipRecord> {
    const safeId = z.string().uuid().safeParse(id);
    if (!safeId.success) throw new OrganMembershipError("ORGAN_MEMBERSHIP_NOT_FOUND", 404);
    const membership = await this.store.getById(safeId.data);
    if (!membership) throw new OrganMembershipError("ORGAN_MEMBERSHIP_NOT_FOUND", 404);
    return membership;
  }

  private async safeInspect(identity: IdentityRef): Promise<StaffDirectoryEntry | null> {
    try {
      const entry = await this.directory.inspect(identity.subject);
      return entry && normalize(entry.identity.issuer) === normalize(identity.issuer) ? entry : null;
    } catch {
      return null;
    }
  }
}

function sortGovernance(applications: ApplicationRecord[]): ApplicationRecord[] {
  return applications
    .filter((application) => application.status === "active" && application.governanceSummaryPath && application.governanceAudience)
    .sort((a, b) => a.governanceOrder - b.governanceOrder || a.name.localeCompare(b.name));
}

function assertNotSelf(identity: IdentityRef, session: IdentityRef) {
  if (normalize(identity.issuer) === normalize(session.issuer) && identity.subject === session.subject) {
    throw new OrganMembershipError("ORGAN_SELF_MUTATION_FORBIDDEN", 409);
  }
}

function termsOf(value: OrganMembershipTerms): OrganMembershipTerms {
  return { organ: value.organ, positionLabel: value.positionLabel, termStart: value.termStart, termEnd: value.termEnd };
}

function toRef(identity: { issuer: string; subject: string }): IdentityRef {
  return { issuer: identity.issuer, subject: identity.subject };
}

function normalize(issuer: string): string {
  return issuer.replace(/\/+$/, "");
}

function toMembershipView(record: OrganMembershipRecord, person: StaffDirectoryEntry | null) {
  return {
    id: record.id,
    // The opaque subject is returned only as a mutation handle; the UI never displays it.
    subject: record.identity.subject,
    displayName: person?.displayName ?? null,
    username: person?.username ?? null,
    email: person?.email ?? null,
    enabled: person?.enabled ?? null,
    organ: record.organ,
    positionLabel: record.positionLabel,
    termStart: record.termStart,
    termEnd: record.termEnd,
    status: record.status,
    reason: record.reason,
    provisioningPath: record.provisioningPath,
    updatedAt: record.updatedAt,
    endedAt: record.endedAt,
  };
}
