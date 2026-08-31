import { z } from "zod";

import type { HubSessionRecord } from "../hub-auth/repository.js";
import type { PlatformAdminRepository } from "./repository.js";

const identitySchema = z
  .object({
    issuer: z.string().url().max(2048),
    subject: z.string().trim().min(1).max(512),
  })
  .strict();

const actorSchema = z
  .object({
    kind: z.enum(["human", "service", "system"]),
    ref: z.string().trim().min(1).max(512),
  })
  .strict();

const reasonSchema = z.string().trim().min(1).max(1000);

export type PlatformAdminAuthorizationCode =
  | "ADMIN_FORBIDDEN"
  | "ADMIN_REAUTH_REQUIRED";

export class PlatformAdminAuthorizationError extends Error {
  readonly statusCode = 403;

  constructor(public readonly code: PlatformAdminAuthorizationCode) {
    super(code === "ADMIN_REAUTH_REQUIRED" ? "Fresh privileged session required" : "Platform admin forbidden");
    this.name = "PlatformAdminAuthorizationError";
  }
}

export interface PlatformAdminMembershipView {
  status: "active" | "revoked";
  reason: string | null;
  actor: {
    kind: "human" | "service" | "system";
    ref: string;
  };
  grantedAt: string | null;
  revokedAt: string | null;
  updatedAt: string;
}

export class PlatformAdminService {
  constructor(private readonly repository: PlatformAdminRepository) {}

  async authorize(session: HubSessionRecord): Promise<void> {
    const membership = await this.repository.getMembership({
      issuer: session.issuer,
      subject: session.subject,
    });

    if (!membership || membership.status !== "active" || !membership.grantedAt) {
      throw new PlatformAdminAuthorizationError("ADMIN_FORBIDDEN");
    }

    if (session.createdAt.getTime() < membership.grantedAt.getTime()) {
      throw new PlatformAdminAuthorizationError("ADMIN_REAUTH_REQUIRED");
    }
  }

  async canUseAdmin(session: HubSessionRecord): Promise<boolean> {
    try {
      await this.authorize(session);
      return true;
    } catch {
      return false;
    }
  }

  async show(identity: { issuer: string; subject: string }): Promise<PlatformAdminMembershipView | null> {
    const parsed = identitySchema.parse(identity);
    const membership = await this.repository.getMembership(parsed);
    return membership ? toView(membership) : null;
  }

  async grant(input: {
    identity: { issuer: string; subject: string };
    reason: string;
    actor: { kind: "human" | "service" | "system"; ref: string };
  }) {
    const parsed = z
      .object({
        identity: identitySchema,
        reason: reasonSchema,
        actor: actorSchema,
      })
      .strict()
      .parse(input);
    const result = await this.repository.grant(parsed);
    return {
      outcome: result.outcome,
      membership: result.membership ? toView(result.membership) : null,
    };
  }

  async revoke(input: {
    identity: { issuer: string; subject: string };
    reason: string;
    actor: { kind: "human" | "service" | "system"; ref: string };
  }) {
    const parsed = z
      .object({
        identity: identitySchema,
        reason: reasonSchema,
        actor: actorSchema,
      })
      .strict()
      .parse(input);
    const result = await this.repository.revoke(parsed);
    return {
      outcome: result.outcome,
      membership: result.membership ? toView(result.membership) : null,
    };
  }

  async listAudit(identity: { issuer: string; subject: string }, limit?: number) {
    const parsed = identitySchema.parse(identity);
    const safeLimit = limit === undefined ? undefined : z.number().int().min(1).max(200).parse(limit);
    const records = await this.repository.listAudit(parsed, safeLimit);
    return records.map((record) => ({
      id: record.id,
      actor: record.actor,
      action: record.action,
      targetRef: record.targetRef,
      outcome: record.outcome,
      payload: record.payload,
      occurredAt: record.occurredAt.toISOString(),
    }));
  }
}

function toView(membership: {
  status: "active" | "revoked";
  reason: string | null;
  actor: { kind: "human" | "service" | "system"; ref: string };
  grantedAt: Date | null;
  revokedAt: Date | null;
  updatedAt: Date;
}): PlatformAdminMembershipView {
  return {
    status: membership.status,
    reason: membership.reason,
    actor: membership.actor,
    grantedAt: membership.grantedAt?.toISOString() ?? null,
    revokedAt: membership.revokedAt?.toISOString() ?? null,
    updatedAt: membership.updatedAt.toISOString(),
  };
}
