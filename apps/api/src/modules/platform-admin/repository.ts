import { createHash, randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import type { ActorRef, IdentityRef } from "../application-access/types.js";

export type PlatformAdminStatus = "active" | "revoked";
export type PlatformAdminAuditOutcome = "succeeded" | "failed" | "noop";

export interface PlatformAdminMembership {
  id: string;
  identity: IdentityRef;
  status: PlatformAdminStatus;
  reason: string | null;
  actor: ActorRef;
  grantedAt: Date | null;
  revokedAt: Date | null;
  updatedAt: Date;
}

export interface PlatformAdminMutationResult {
  outcome: "succeeded" | "noop";
  membership: PlatformAdminMembership | null;
}

export interface PlatformAdminAuditRecord {
  id: string;
  actor: ActorRef;
  action: string;
  targetRef: string;
  outcome: PlatformAdminAuditOutcome;
  payload: Record<string, unknown>;
  occurredAt: Date;
}

export interface PlatformAdminRepository {
  getMembership(identity: IdentityRef): Promise<PlatformAdminMembership | null>;
  grant(input: {
    identity: IdentityRef;
    reason: string;
    actor: ActorRef;
  }): Promise<PlatformAdminMutationResult>;
  revoke(input: {
    identity: IdentityRef;
    reason: string;
    actor: ActorRef;
  }): Promise<PlatformAdminMutationResult>;
  listAudit(identity: IdentityRef, limit?: number): Promise<PlatformAdminAuditRecord[]>;
}

interface MembershipRow {
  id: string;
  identityIssuer: string;
  identitySubject: string;
  status: PlatformAdminStatus;
  reason: string | null;
  actorKind: ActorRef["kind"];
  actorRef: string;
  grantedAt: Date | null;
  revokedAt: Date | null;
  updatedAt: Date;
}

interface AuditRow {
  id: string;
  actorKind: ActorRef["kind"];
  actorRef: string;
  action: string;
  targetRef: string;
  outcome: PlatformAdminAuditOutcome;
  payload: Record<string, unknown>;
  occurredAt: Date;
}

export class PgPlatformAdminRepository implements PlatformAdminRepository {
  constructor(private readonly pool: Pool) {}

  async getMembership(identity: IdentityRef): Promise<PlatformAdminMembership | null> {
    const result = await this.pool.query<MembershipRow>(
      `
        SELECT
          id,
          identity_issuer AS "identityIssuer",
          identity_subject AS "identitySubject",
          status,
          reason,
          actor_kind AS "actorKind",
          actor_ref AS "actorRef",
          granted_at AS "grantedAt",
          revoked_at AS "revokedAt",
          updated_at AS "updatedAt"
        FROM platform_administrators
        WHERE identity_issuer = $1
          AND identity_subject = $2
        LIMIT 1
      `,
      [identity.issuer, identity.subject],
    );
    return result.rows[0] ? toMembership(result.rows[0]) : null;
  }

  async grant(input: {
    identity: IdentityRef;
    reason: string;
    actor: ActorRef;
  }): Promise<PlatformAdminMutationResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const grantedAt = new Date();
      const result = await client.query<MembershipRow>(
        `
          INSERT INTO platform_administrators (
            id,
            identity_issuer,
            identity_subject,
            status,
            reason,
            actor_kind,
            actor_ref,
            granted_at,
            revoked_at,
            updated_at
          ) VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, NULL, now())
          ON CONFLICT (identity_issuer, identity_subject) DO UPDATE SET
            status = 'active',
            reason = EXCLUDED.reason,
            actor_kind = EXCLUDED.actor_kind,
            actor_ref = EXCLUDED.actor_ref,
            granted_at = EXCLUDED.granted_at,
            revoked_at = NULL,
            updated_at = now()
          RETURNING
            id,
            identity_issuer AS "identityIssuer",
            identity_subject AS "identitySubject",
            status,
            reason,
            actor_kind AS "actorKind",
            actor_ref AS "actorRef",
            granted_at AS "grantedAt",
            revoked_at AS "revokedAt",
            updated_at AS "updatedAt"
        `,
        [
          randomUUID(),
          input.identity.issuer,
          input.identity.subject,
          input.reason,
          input.actor.kind,
          input.actor.ref,
          grantedAt,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error("platform admin grant returned no row");

      await insertAudit(client, {
        actor: input.actor,
        action: "platform_admin.grant",
        targetRef: makePlatformAdminTargetRef(input.identity),
        outcome: "succeeded",
        payload: { status: "active", reason: input.reason },
      });
      await client.query("COMMIT");
      return { outcome: "succeeded", membership: toMembership(row) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async revoke(input: {
    identity: IdentityRef;
    reason: string;
    actor: ActorRef;
  }): Promise<PlatformAdminMutationResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const revokedAt = new Date();
      const result = await client.query<MembershipRow>(
        `
          UPDATE platform_administrators
          SET
            status = 'revoked',
            reason = $3,
            actor_kind = $4,
            actor_ref = $5,
            revoked_at = $6,
            updated_at = now()
          WHERE identity_issuer = $1
            AND identity_subject = $2
            AND status = 'active'
          RETURNING
            id,
            identity_issuer AS "identityIssuer",
            identity_subject AS "identitySubject",
            status,
            reason,
            actor_kind AS "actorKind",
            actor_ref AS "actorRef",
            granted_at AS "grantedAt",
            revoked_at AS "revokedAt",
            updated_at AS "updatedAt"
        `,
        [
          input.identity.issuer,
          input.identity.subject,
          input.reason,
          input.actor.kind,
          input.actor.ref,
          revokedAt,
        ],
      );

      const changed = result.rows[0] ? toMembership(result.rows[0]) : null;
      let membership = changed;
      if (!membership) {
        const existing = await client.query<MembershipRow>(
          `
            SELECT
              id,
              identity_issuer AS "identityIssuer",
              identity_subject AS "identitySubject",
              status,
              reason,
              actor_kind AS "actorKind",
              actor_ref AS "actorRef",
              granted_at AS "grantedAt",
              revoked_at AS "revokedAt",
              updated_at AS "updatedAt"
            FROM platform_administrators
            WHERE identity_issuer = $1
              AND identity_subject = $2
            LIMIT 1
          `,
          [input.identity.issuer, input.identity.subject],
        );
        membership = existing.rows[0] ? toMembership(existing.rows[0]) : null;
      }

      const outcome = changed ? "succeeded" : "noop";
      await insertAudit(client, {
        actor: input.actor,
        action: "platform_admin.revoke",
        targetRef: makePlatformAdminTargetRef(input.identity),
        outcome,
        payload: { status: "revoked", reason: input.reason },
      });
      await client.query("COMMIT");
      return { outcome, membership };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listAudit(identity: IdentityRef, limit = 50): Promise<PlatformAdminAuditRecord[]> {
    const safeLimit = Math.max(1, Math.min(limit, 200));
    const result = await this.pool.query<AuditRow>(
      `
        SELECT
          id,
          actor_kind AS "actorKind",
          actor_ref AS "actorRef",
          action,
          target_ref AS "targetRef",
          outcome,
          payload,
          occurred_at AS "occurredAt"
        FROM platform_audit_events
        WHERE target_type = 'platform_administrator'
          AND target_ref = $1
        ORDER BY occurred_at DESC
        LIMIT $2
      `,
      [makePlatformAdminTargetRef(identity), safeLimit],
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
}

export function makePlatformAdminTargetRef(identity: IdentityRef): string {
  const digest = createHash("sha256")
    .update(`${identity.issuer}\n${identity.subject}`)
    .digest("hex");
  return `platform-admin:${digest}`;
}

async function insertAudit(
  client: PoolClient,
  input: {
    actor: ActorRef;
    action: string;
    targetRef: string;
    outcome: "succeeded" | "noop";
    payload: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `
      INSERT INTO platform_audit_events (
        id, actor_kind, actor_ref, action, target_type, target_ref, outcome, payload
      ) VALUES ($1, $2, $3, $4, 'platform_administrator', $5, $6, $7::jsonb)
    `,
    [
      randomUUID(),
      input.actor.kind,
      input.actor.ref,
      input.action,
      input.targetRef,
      input.outcome,
      JSON.stringify(input.payload),
    ],
  );
}

function toMembership(row: MembershipRow): PlatformAdminMembership {
  return {
    id: row.id,
    identity: {
      issuer: row.identityIssuer,
      subject: row.identitySubject,
    },
    status: row.status,
    reason: row.reason,
    actor: { kind: row.actorKind, ref: row.actorRef },
    grantedAt: row.grantedAt,
    revokedAt: row.revokedAt,
    updatedAt: row.updatedAt,
  };
}
