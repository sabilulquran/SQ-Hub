import { createHash, randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import type { ActorRef, IdentityRef } from "../application-access/types.js";
import type {
  PlatformAdminAuthorization,
  PlatformAdminOverview,
  PlatformAdminRecord,
  PlatformAdminStatus,
} from "./types.js";

interface PlatformAdminRow {
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

export interface PlatformAdminMutationResult {
  outcome: "succeeded" | "noop";
  membership: PlatformAdminRecord | null;
}

export interface PlatformAdminRepository {
  getMembership(identity: IdentityRef): Promise<PlatformAdminRecord | null>;
  setMembership(input: {
    identity: IdentityRef;
    status: PlatformAdminStatus;
    reason: string;
    actor: ActorRef;
  }): Promise<PlatformAdminMutationResult>;
  authorizeSession(input: {
    identity: IdentityRef;
    sessionCreatedAt: Date;
  }): Promise<PlatformAdminAuthorization>;
  getOverview(): Promise<PlatformAdminOverview>;
}

export class PgPlatformAdminRepository implements PlatformAdminRepository {
  constructor(private readonly pool: Pool) {}

  async getMembership(identity: IdentityRef): Promise<PlatformAdminRecord | null> {
    const result = await this.pool.query<PlatformAdminRow>(
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
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async setMembership(input: {
    identity: IdentityRef;
    status: PlatformAdminStatus;
    reason: string;
    actor: ActorRef;
  }): Promise<PlatformAdminMutationResult> {
    const client = await this.pool.connect();
    const targetRef = makePlatformAdminTargetRef(input.identity);
    try {
      await client.query("BEGIN");
      const existingResult = await client.query<PlatformAdminRow>(
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
          FOR UPDATE
        `,
        [input.identity.issuer, input.identity.subject],
      );
      const existing = existingResult.rows[0] ?? null;

      if (existing?.status === input.status) {
        await insertAudit(client, {
          actor: input.actor,
          action: input.status === "active" ? "platform_admin.grant" : "platform_admin.revoke",
          targetRef,
          outcome: "noop",
          payload: { status: input.status, reason: input.reason },
        });
        await client.query("COMMIT");
        return { outcome: "noop", membership: toRecord(existing) };
      }

      if (!existing && input.status === "revoked") {
        await insertAudit(client, {
          actor: input.actor,
          action: "platform_admin.revoke",
          targetRef,
          outcome: "noop",
          payload: { status: "revoked", reason: input.reason },
        });
        await client.query("COMMIT");
        return { outcome: "noop", membership: null };
      }

      const now = new Date();
      const result = existing
        ? await client.query<PlatformAdminRow>(
            `
              UPDATE platform_administrators
              SET
                status = $2,
                reason = $3,
                actor_kind = $4,
                actor_ref = $5,
                granted_at = CASE WHEN $2 = 'active' THEN $6 ELSE granted_at END,
                revoked_at = CASE WHEN $2 = 'revoked' THEN $6 ELSE NULL END,
                updated_at = now()
              WHERE id = $1
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
            [existing.id, input.status, input.reason, input.actor.kind, input.actor.ref, now],
          )
        : await client.query<PlatformAdminRow>(
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
              now,
            ],
          );
      const row = result.rows[0];
      if (!row) throw new Error("platform administrator mutation returned no row");

      await insertAudit(client, {
        actor: input.actor,
        action: input.status === "active" ? "platform_admin.grant" : "platform_admin.revoke",
        targetRef,
        outcome: "succeeded",
        payload: { status: input.status, reason: input.reason },
      });
      await client.query("COMMIT");
      return { outcome: "succeeded", membership: toRecord(row) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async authorizeSession(input: {
    identity: IdentityRef;
    sessionCreatedAt: Date;
  }): Promise<PlatformAdminAuthorization> {
    const result = await this.pool.query<{ status: PlatformAdminStatus; grantedAt: Date | null }>(
      `
        SELECT status, granted_at AS "grantedAt"
        FROM platform_administrators
        WHERE identity_issuer = $1
          AND identity_subject = $2
        LIMIT 1
      `,
      [input.identity.issuer, input.identity.subject],
    );
    const row = result.rows[0];
    if (!row || row.status !== "active" || !row.grantedAt) return { status: "forbidden" };
    if (input.sessionCreatedAt.getTime() < row.grantedAt.getTime()) {
      return { status: "reauth_required" };
    }
    return { status: "authorized" };
  }

  async getOverview(): Promise<PlatformAdminOverview> {
    const [applications, access, audit] = await Promise.all([
      this.pool.query<{ total: number; active: number; inactive: number }>(`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE status = 'active')::int AS active,
          count(*) FILTER (WHERE status = 'inactive')::int AS inactive
        FROM applications
      `),
      this.pool.query<{ total: number; active: number; revoked: number }>(`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE status = 'active')::int AS active,
          count(*) FILTER (WHERE status = 'revoked')::int AS revoked
        FROM application_access
      `),
      this.pool.query<{ total: number }>(`
        SELECT count(*)::int AS total
        FROM platform_audit_events
        WHERE occurred_at >= now() - interval '24 hours'
      `),
    ]);

    return {
      applications: applications.rows[0] ?? { total: 0, active: 0, inactive: 0 },
      applicationAccess: access.rows[0] ?? { total: 0, active: 0, revoked: 0 },
      auditEventsLast24Hours: audit.rows[0]?.total ?? 0,
    };
  }
}

export function makePlatformAdminTargetRef(identity: IdentityRef): string {
  const digest = createHash("sha256")
    .update(`${identity.issuer}\u0000${identity.subject}`)
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

function toRecord(row: PlatformAdminRow): PlatformAdminRecord {
  return {
    id: row.id,
    identity: { issuer: row.identityIssuer, subject: row.identitySubject },
    status: row.status,
    reason: row.reason,
    actor: { kind: row.actorKind, ref: row.actorRef },
    grantedAt: row.grantedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}
