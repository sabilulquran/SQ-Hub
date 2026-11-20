import { z } from "zod";

import type { ApplicationAccessRepository, ApplicationUpsertInput } from "./repository.js";
import type { AccessDecision, AccessRecord, ActorRef, ApplicationRecord, AuditRecord } from "./types.js";

/**
 * Stays `.strict()` on purpose: an unknown field in `identity` means the caller is sending
 * something Hub does not act on, and accepting it quietly would hide that misuse until the
 * caller believes Hub read a field it never read. The 400 now names the rejected paths
 * (see `invalid-request.ts`), which is what made the strictness hard to diagnose before.
 */
export const identityRefSchema = z
  .object({
    issuer: z.string().url().max(2048),
    subject: z.string().trim().min(1).max(512),
  })
  .strict();

export const applicationKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{0,62}$/);

export const actorSchema = z
  .object({
    kind: z.enum(["human", "service", "system"]),
    ref: z.string().trim().min(1).max(512),
  })
  .strict();

const reasonSchema = z.string().trim().max(1000).nullable().default(null);

// HUB-IMPL-021 §2: a path on the canonical_url origin. Absolute and protocol-relative
// URLs are rejected so the summary request can never leave the application's origin.
export const governanceSummaryPathSchema = z
  .string()
  .trim()
  .max(512)
  .regex(/^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/);
export const governanceAudienceSchema = z.string().trim().regex(/^[A-Za-z0-9._:-]{1,255}$/);
export const governanceOrderSchema = z.number().int().min(-10000).max(10000);

export const governanceRegistrationSchema = z
  .object({
    summaryPath: governanceSummaryPathSchema.nullable(),
    audience: governanceAudienceSchema.nullable(),
    order: governanceOrderSchema,
  })
  .strict()
  .refine((value) => (value.summaryPath === null) === (value.audience === null), {
    message: "governance audience is required exactly when a summary path is set",
    path: ["audience"],
  });

/**
 * ORGAN-IMPL-001 §4.2: where an application takes decisions, under an audience of its own.
 *
 * A group of its own, not a field of the governance registration, because that is the shape the
 * platform-admin route sends and the shape the repository writes. It travelled inside the
 * governance group once, and the two ends never met: the route's body was refused as an
 * unrecognized key, and anything that did get through was dropped before the UPDATE.
 * Omitting the group leaves whatever is stored alone; sending it with nulls clears it.
 */
export const decisionRegistrationSchema = z
  .object({
    path: governanceSummaryPathSchema.nullable(),
    audience: governanceAudienceSchema.nullable(),
  })
  .strict()
  .refine((value) => (value.path === null) === (value.audience === null), {
    message: "decision audience is required exactly when a decision path is set",
    path: ["audience"],
  });

/** KIRIM-IMPL-003 K-2 and migration 0013 `applications_machine_client_check`: WhatsApp needs a machine client. */
export const machineClientIdSchema = z.string().trim().regex(/^[A-Za-z0-9._:-]{1,255}$/);

export const whatsappRegistrationSchema = z
  .object({
    capable: z.boolean(),
    machineClientId: machineClientIdSchema.nullable(),
  })
  .strict()
  .refine((value) => !value.capable || value.machineClientId !== null, {
    message: "a machine client id is required when the application uses WhatsApp",
    path: ["machineClientId"],
  });

export function governanceSummaryUrl(canonicalUrl: string, summaryPath: string): URL {
  const base = new URL(canonicalUrl);
  const target = new URL(summaryPath, base.origin);
  if (target.origin !== base.origin) throw new Error("governance summary path leaves the application origin");
  return target;
}

export class ApplicationAccessService {
  constructor(private readonly repository: ApplicationAccessRepository) {}

  listApplications(): Promise<ApplicationRecord[]> {
    return this.repository.listApplications();
  }

  async upsertApplication(input: {
    applicationKey: string;
    name: string;
    canonicalUrl: string;
    status: "active" | "inactive";
    governance?: { summaryPath: string | null; audience: string | null; order: number };
    decision?: { path: string | null; audience: string | null };
    kind?: "modul" | "luar";
    whatsapp?: { capable: boolean; machineClientId: string | null };
    actor: ActorRef;
  }): Promise<ApplicationRecord> {
    const parsed = z
      .object({
        applicationKey: applicationKeySchema,
        name: z.string().trim().min(1).max(200),
        canonicalUrl: z.string().url().max(2048),
        status: z.enum(["active", "inactive"]),
        governance: governanceRegistrationSchema.optional(),
        decision: decisionRegistrationSchema.optional(),
        kind: z.enum(["modul", "luar"]).optional(),
        whatsapp: whatsappRegistrationSchema.optional(),
        actor: actorSchema,
      })
      .strict()
      .superRefine((value, ctx) => {
        // A decision token that also opens the summary would defeat the separation ADR-0012 D4
        // is built on, so the registry refuses to name one audience for both.
        if (
          value.decision?.audience &&
          value.governance?.audience &&
          value.decision.audience === value.governance.audience
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["decision", "audience"],
            message: "the decision audience must differ from the governance summary audience",
          });
        }
        if (!value.governance?.summaryPath) return;
        try {
          const canonical = new URL(value.canonicalUrl);
          if (canonical.protocol !== "https:" && canonical.protocol !== "http:") throw new Error("scheme");
          governanceSummaryUrl(value.canonicalUrl, value.governance.summaryPath);
        } catch {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["governance", "summaryPath"],
            message: "governance summary path must stay on the canonical_url origin",
          });
        }
      })
      .parse(input);
    const upsert: ApplicationUpsertInput = {
      applicationKey: parsed.applicationKey,
      name: parsed.name,
      canonicalUrl: parsed.canonicalUrl,
      status: parsed.status,
      actor: parsed.actor,
      ...(parsed.governance ? { governance: parsed.governance } : {}),
      ...(parsed.decision ? { decision: parsed.decision } : {}),
      ...(parsed.kind ? { kind: parsed.kind } : {}),
      ...(parsed.whatsapp ? { whatsapp: parsed.whatsapp } : {}),
    };
    return this.repository.upsertApplication(upsert);
  }

  async grant(input: {
    identity: { issuer: string; subject: string };
    applicationKey: string;
    reason?: string | null;
    actor: ActorRef;
  }): Promise<AccessRecord> {
    const parsed = z
      .object({
        identity: identityRefSchema,
        applicationKey: applicationKeySchema,
        reason: reasonSchema,
        actor: actorSchema,
      })
      .strict()
      .parse(input);
    return this.repository.setAccess({ ...parsed, status: "active" });
  }

  async revoke(input: {
    identity: { issuer: string; subject: string };
    applicationKey: string;
    reason?: string | null;
    actor: ActorRef;
  }): Promise<AccessRecord> {
    const parsed = z
      .object({
        identity: identityRefSchema,
        applicationKey: applicationKeySchema,
        reason: reasonSchema,
        actor: actorSchema,
      })
      .strict()
      .parse(input);
    return this.repository.setAccess({ ...parsed, status: "revoked" });
  }

  async getAccess(identity: { issuer: string; subject: string }, applicationKey: string): Promise<AccessRecord | null> {
    return this.repository.getAccess(identityRefSchema.parse(identity), applicationKeySchema.parse(applicationKey));
  }

  async checkAccess(identity: { issuer: string; subject: string }, applicationKey: string): Promise<AccessDecision> {
    return this.repository.checkAccess(identityRefSchema.parse(identity), applicationKeySchema.parse(applicationKey));
  }

  listAudit(targetRef?: string, limit?: number): Promise<AuditRecord[]> {
    const safeTarget = targetRef === undefined ? undefined : z.string().trim().min(1).max(4096).parse(targetRef);
    const safeLimit = limit === undefined ? undefined : z.number().int().min(1).max(200).parse(limit);
    return this.repository.listAudit(safeTarget, safeLimit);
  }
}
