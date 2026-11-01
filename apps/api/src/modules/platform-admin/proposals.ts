import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import type { ActorRef, IdentityRef } from "../application-access/types.js";
import {
  activate,
  insertAudit,
  makePlatformAdminTargetRef,
  MEMBERSHIP_COLUMNS,
  toMembership,
  type MembershipRow,
  type PlatformAdminAuditRecord,
  type PlatformAdminMembership,
} from "./repository.js";

export type ProposalStatus = "pending" | "confirmed" | "cancelled" | "expired";

export interface PlatformAdminProposal {
  id: string;
  identity: IdentityRef;
  proposer: IdentityRef;
  reason: string;
  status: ProposalStatus;
  createdAt: Date;
  expiresAt: Date;
  decidedBy: IdentityRef | null;
  decidedAt: Date | null;
}

export type ProposalErrorCode =
  | "SELF_PROPOSAL_FORBIDDEN"
  | "ALREADY_ACTIVE"
  | "PROPOSAL_PENDING"
  | "PROPOSAL_NOT_FOUND"
  | "PROPOSAL_NOT_PENDING"
  | "PROPOSAL_EXPIRED"
  | "SAME_ADMIN_FORBIDDEN"
  | "SELF_CONFIRM_FORBIDDEN"
  | "PROPOSER_NOT_ACTIVE"
  | "CONFIRMER_NOT_ACTIVE";

export class PlatformAdminProposalError extends Error {
  readonly statusCode: number;

  constructor(public readonly code: ProposalErrorCode) {
    super(code);
    this.name = "PlatformAdminProposalError";
    this.statusCode = code === "PROPOSAL_NOT_FOUND" ? 404 : code.endsWith("_FORBIDDEN") ? 403 : 409;
  }
}

export interface PlatformAdminProposalRepository {
  listMemberships(): Promise<PlatformAdminMembership[]>;
  listProposals(limit: number): Promise<PlatformAdminProposal[]>;
  listAdminAudit(limit: number): Promise<PlatformAdminAuditRecord[]>;
  propose(input: { identity: IdentityRef; proposer: IdentityRef; reason: string; expiresAt: Date; actor: ActorRef }): Promise<PlatformAdminProposal>;
  confirm(input: { proposalId: string; confirmer: IdentityRef; actor: ActorRef }): Promise<{ proposal: PlatformAdminProposal; membership: PlatformAdminMembership }>;
  cancel(input: { proposalId: string; canceller: IdentityRef; actor: ActorRef }): Promise<PlatformAdminProposal>;
}

interface ProposalRow {
  id: string;
  identityIssuer: string;
  identitySubject: string;
  proposerIssuer: string;
  proposerSubject: string;
  reason: string;
  status: ProposalStatus;
  createdAt: Date;
  expiresAt: Date;
  decidedIssuer: string | null;
  decidedSubject: string | null;
  decidedAt: Date | null;
}

const PROPOSAL_COLUMNS = `
  id,
  identity_issuer AS "identityIssuer",
  identity_subject AS "identitySubject",
  proposer_issuer AS "proposerIssuer",
  proposer_subject AS "proposerSubject",
  reason,
  status,
  created_at AS "createdAt",
  expires_at AS "expiresAt",
  decided_issuer AS "decidedIssuer",
  decided_subject AS "decidedSubject",
  decided_at AS "decidedAt"
`;

/**
 * HUB-IMPL-023 H-9. Through the Hub, an identity becomes an active Platform Administrator only
 * when a second, different administrator confirms a pending proposal. Every rule is checked
 * inside the transaction that activates, against rows locked for it.
 */
export class PgPlatformAdminProposalRepository implements PlatformAdminProposalRepository {
  constructor(private readonly pool: Pool) {}

  async listMemberships(): Promise<PlatformAdminMembership[]> {
    const result = await this.pool.query<MembershipRow>(
      `SELECT ${MEMBERSHIP_COLUMNS} FROM platform_administrators ORDER BY status, updated_at DESC`,
    );
    return result.rows.map(toMembership);
  }

  async listProposals(limit: number): Promise<PlatformAdminProposal[]> {
    const result = await this.pool.query<ProposalRow>(
      `SELECT ${PROPOSAL_COLUMNS} FROM platform_admin_proposals
       ORDER BY (status = 'pending') DESC, created_at DESC
       LIMIT $1`,
      [Math.max(1, Math.min(limit, 500))],
    );
    return result.rows.map(toProposal);
  }

  async listAdminAudit(limit: number): Promise<PlatformAdminAuditRecord[]> {
    const result = await this.pool.query<{
      id: string; actorKind: ActorRef["kind"]; actorRef: string; action: string; targetRef: string;
      outcome: PlatformAdminAuditRecord["outcome"]; payload: Record<string, unknown>; occurredAt: Date;
    }>(
      `SELECT id, actor_kind AS "actorKind", actor_ref AS "actorRef", action, target_ref AS "targetRef",
              outcome, payload, occurred_at AS "occurredAt"
       FROM platform_audit_events
       WHERE target_type = 'platform_administrator'
       ORDER BY occurred_at DESC
       LIMIT $1`,
      [Math.max(1, Math.min(limit, 200))],
    );
    return result.rows.map((row) => ({
      id: row.id,
      actor: { kind: row.actorKind, ref: row.actorRef },
      action: row.action,
      targetRef: row.targetRef,
      outcome: row.outcome,
      payload: row.payload,
      occurredAt: row.occurredAt,
    }));
  }

  async propose(input: { identity: IdentityRef; proposer: IdentityRef; reason: string; expiresAt: Date; actor: ActorRef }) {
    if (sameIdentity(input.identity, input.proposer)) throw new PlatformAdminProposalError("SELF_PROPOSAL_FORBIDDEN");
    return this.transaction(async (client) => {
      if ((await membershipStatus(client, input.identity)) === "active") throw new PlatformAdminProposalError("ALREADY_ACTIVE");
      // A pending proposal past its date no longer blocks a new one.
      await client.query(
        `UPDATE platform_admin_proposals SET status = 'expired', decided_at = now()
         WHERE identity_issuer = $1 AND identity_subject = $2 AND status = 'pending' AND expires_at <= now()`,
        [input.identity.issuer, input.identity.subject],
      );
      let row: ProposalRow | undefined;
      try {
        const result = await client.query<ProposalRow>(
          `INSERT INTO platform_admin_proposals (
             id, identity_issuer, identity_subject, proposer_issuer, proposer_subject, reason, status, expires_at
           ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
           RETURNING ${PROPOSAL_COLUMNS}`,
          [randomUUID(), input.identity.issuer, input.identity.subject, input.proposer.issuer, input.proposer.subject, input.reason, input.expiresAt],
        );
        row = result.rows[0];
      } catch (error) {
        if ((error as { code?: string }).code === "23505") throw new PlatformAdminProposalError("PROPOSAL_PENDING");
        throw error;
      }
      if (!row) throw new Error("platform admin proposal returned no row");
      await insertAudit(client, {
        actor: input.actor,
        action: "platform_admin.propose",
        targetRef: makePlatformAdminTargetRef(input.identity),
        outcome: "succeeded",
        payload: { status: "pending", reason: input.reason, proposalId: row.id },
      });
      return toProposal(row);
    });
  }

  async confirm(input: { proposalId: string; confirmer: IdentityRef; actor: ActorRef }) {
    return this.transaction(async (client) => {
      const proposal = await lockProposal(client, input.proposalId);
      if (proposal.status !== "pending") throw new PlatformAdminProposalError("PROPOSAL_NOT_PENDING");
      if (proposal.expiresAt.getTime() <= Date.now()) throw new PlatformAdminProposalError("PROPOSAL_EXPIRED");
      if (sameIdentity(input.confirmer, proposal.proposer)) throw new PlatformAdminProposalError("SAME_ADMIN_FORBIDDEN");
      if (sameIdentity(input.confirmer, proposal.identity)) throw new PlatformAdminProposalError("SELF_CONFIRM_FORBIDDEN");
      // Both people must still hold the role at the moment of activation, not only when they acted.
      if ((await membershipStatus(client, input.confirmer, true)) !== "active") throw new PlatformAdminProposalError("CONFIRMER_NOT_ACTIVE");
      if ((await membershipStatus(client, proposal.proposer, true)) !== "active") throw new PlatformAdminProposalError("PROPOSER_NOT_ACTIVE");
      if ((await membershipStatus(client, proposal.identity, true)) === "active") throw new PlatformAdminProposalError("ALREADY_ACTIVE");

      const membership = await activate(client, { identity: proposal.identity, reason: proposal.reason, actor: input.actor });
      const decided = await client.query<ProposalRow>(
        `UPDATE platform_admin_proposals
         SET status = 'confirmed', decided_issuer = $2, decided_subject = $3, decided_at = now()
         WHERE id = $1
         RETURNING ${PROPOSAL_COLUMNS}`,
        [proposal.id, input.confirmer.issuer, input.confirmer.subject],
      );
      await insertAudit(client, {
        actor: input.actor,
        action: "platform_admin.grant",
        targetRef: makePlatformAdminTargetRef(proposal.identity),
        outcome: "succeeded",
        payload: {
          status: "active",
          reason: proposal.reason,
          proposalId: proposal.id,
          proposedBy: makePlatformAdminTargetRef(proposal.proposer),
        },
      });
      return { proposal: toProposal(decided.rows[0]!), membership: toMembership(membership) };
    });
  }

  async cancel(input: { proposalId: string; canceller: IdentityRef; actor: ActorRef }) {
    return this.transaction(async (client) => {
      const proposal = await lockProposal(client, input.proposalId);
      if (proposal.status !== "pending") throw new PlatformAdminProposalError("PROPOSAL_NOT_PENDING");
      const decided = await client.query<ProposalRow>(
        `UPDATE platform_admin_proposals
         SET status = 'cancelled', decided_issuer = $2, decided_subject = $3, decided_at = now()
         WHERE id = $1
         RETURNING ${PROPOSAL_COLUMNS}`,
        [proposal.id, input.canceller.issuer, input.canceller.subject],
      );
      await insertAudit(client, {
        actor: input.actor,
        action: "platform_admin.proposal_cancel",
        targetRef: makePlatformAdminTargetRef(proposal.identity),
        outcome: "succeeded",
        payload: { status: "cancelled", reason: proposal.reason, proposalId: proposal.id },
      });
      return toProposal(decided.rows[0]!);
    });
  }

  private async transaction<T>(task: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await task(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

async function lockProposal(client: PoolClient, id: string): Promise<PlatformAdminProposal> {
  const result = await client.query<ProposalRow>(
    `SELECT ${PROPOSAL_COLUMNS} FROM platform_admin_proposals WHERE id = $1 FOR UPDATE`,
    [id],
  );
  if (!result.rows[0]) throw new PlatformAdminProposalError("PROPOSAL_NOT_FOUND");
  return toProposal(result.rows[0]);
}

async function membershipStatus(client: PoolClient, identity: IdentityRef, lock = false): Promise<string | null> {
  const result = await client.query<{ status: string }>(
    `SELECT status FROM platform_administrators
     WHERE identity_issuer = $1 AND identity_subject = $2
     ${lock ? "FOR UPDATE" : ""}`,
    [identity.issuer, identity.subject],
  );
  return result.rows[0]?.status ?? null;
}

function sameIdentity(a: IdentityRef, b: IdentityRef): boolean {
  return a.issuer === b.issuer && a.subject === b.subject;
}

function toProposal(row: ProposalRow): PlatformAdminProposal {
  return {
    id: row.id,
    identity: { issuer: row.identityIssuer, subject: row.identitySubject },
    proposer: { issuer: row.proposerIssuer, subject: row.proposerSubject },
    reason: row.reason,
    status: row.status,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    decidedBy: row.decidedIssuer && row.decidedSubject ? { issuer: row.decidedIssuer, subject: row.decidedSubject } : null,
    decidedAt: row.decidedAt,
  };
}
