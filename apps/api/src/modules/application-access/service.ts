import { z } from "zod";

import type { ApplicationAccessRepository } from "./repository.js";
import type { AccessDecision, AccessRecord, ActorRef, ApplicationRecord, AuditRecord } from "./types.js";

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
    actor: ActorRef;
  }): Promise<ApplicationRecord> {
    const parsed = z
      .object({
        applicationKey: applicationKeySchema,
        name: z.string().trim().min(1).max(200),
        canonicalUrl: z.string().url().max(2048),
        status: z.enum(["active", "inactive"]),
        actor: actorSchema,
      })
      .strict()
      .parse(input);
    return this.repository.upsertApplication(parsed);
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
