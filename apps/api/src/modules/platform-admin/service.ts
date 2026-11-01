import { z } from "zod";

import type { HubSessionRecord } from "../hub-auth/repository.js";
import { createHash } from "node:crypto";

import type { PlatformAdminProposalRepository } from "./proposals.js";
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

/** `DRAFT` (HUB-IMPL-023 §8): an unconfirmed proposal lapses after seven days. */
export const PROPOSAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class PlatformAdminService {
  constructor(
    private readonly repository: PlatformAdminRepository,
    private readonly proposals?: PlatformAdminProposalRepository,
  ) {}

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

  /**
   * HUB-IMPL-023 H-9/H-11, used by the Admin Center. Every method starts by authorizing the
   * session; the four-eyes rules themselves are enforced in the activating transaction.
   */
  async overview(session: HubSessionRecord) {
    await this.authorize(session);
    const proposals = this.requireProposals();
    const [memberships, recent] = await Promise.all([proposals.listMemberships(), proposals.listProposals(100)]);
    return { memberships, proposals: recent };
  }

  async adminAudit(session: HubSessionRecord, limit: number) {
    await this.authorize(session);
    return this.requireProposals().listAdminAudit(z.number().int().min(1).max(200).parse(limit));
  }

  async propose(session: HubSessionRecord, input: { identity: { issuer: string; subject: string }; reason: string }) {
    await this.authorize(session);
    const identity = identitySchema.parse(input.identity);
    const reason = reasonSchema.parse(input.reason);
    return this.requireProposals().propose({
      identity,
      proposer: { issuer: session.issuer, subject: session.subject },
      reason,
      expiresAt: new Date(Date.now() + PROPOSAL_TTL_MS),
      actor: sessionActor(session),
    });
  }

  async confirm(session: HubSessionRecord, proposalId: string) {
    await this.authorize(session);
    return this.requireProposals().confirm({
      proposalId: z.string().uuid().parse(proposalId),
      confirmer: { issuer: session.issuer, subject: session.subject },
      actor: sessionActor(session),
    });
  }

  async cancel(session: HubSessionRecord, proposalId: string) {
    await this.authorize(session);
    return this.requireProposals().cancel({
      proposalId: z.string().uuid().parse(proposalId),
      canceller: { issuer: session.issuer, subject: session.subject },
      actor: sessionActor(session),
    });
  }

  /** Revocation needs one administrator: making removal of access harder is the dangerous direction. */
  async revokeBySession(session: HubSessionRecord, input: { identity: { issuer: string; subject: string }; reason: string }) {
    await this.authorize(session);
    return this.revoke({ identity: input.identity, reason: input.reason, actor: sessionActor(session) });
  }

  private requireProposals(): PlatformAdminProposalRepository {
    if (!this.proposals) throw new Error("Platform administrator proposals are unavailable");
    return this.proposals;
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

function sessionActor(session: { issuer: string; subject: string }) {
  const digest = createHash("sha256").update(`${session.issuer}
${session.subject}`).digest("hex");
  return { kind: "human" as const, ref: `staff:${digest}` };
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
