import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import type {
  AccessDecision,
  AccessRecord,
  AccessStatus,
  ActorRef,
  ApplicationRecord,
  ApplicationStatus,
  AuditRecord,
  IdentityRef,
} from "./types.js";

interface ApplicationRow {
  id: string;
  applicationKey: string;
  name: string;
  canonicalUrl: string;
  status: ApplicationStatus;
}

interface AccessRow {
  id: string;
  identityIssuer: string;
  identitySubject: string;
  applicationKey: string;
  status: AccessStatus;
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
  targetType: string;
  targetRef: string;
  outcome: AuditRecord["outcome"];
  payload: Record<string, unknown>;
  occurredAt: Date;
}

export interface ApplicationAccessRepository {
  listApplications(): Promise<ApplicationRecord[]>;
  upsertApplication(input: {
    applicationKey: string;
    name: string;
    canonicalUrl: string;
    status: ApplicationStatus;
    actor: ActorRef;
  }): Promise<ApplicationRecord>;
  setAccess(input: {
    identity: IdentityRef;
    applicationKey: string;
    status: AccessStatus;
    reason: string | null;
    actor: ActorRef;
  }): Promise<AccessRecord>;
  getAccess(identity: IdentityRef, applicationKey: string): Promise<AccessRecord | null>;
  checkAccess(identity: IdentityRef, applicationKey: string): Promise<AccessDecision>;
  listAudit(targetRef?: string, limit?: number): Promise<AuditRecord[]>;
}

export class PgApplicationAccessRepository implements ApplicationAccessRepository {
  constructor(private readonly pool: Pool) {}

  async listApplications(): Promise<ApplicationRecord[]> {
    const result = await this.pool.query<ApplicationRow>(`
      SELECT
        id,
        application_key AS "applicationKey",
        name,
        canonical_url AS "canonicalUrl",
        status
      FROM applications
      ORDER BY application_key
    `);
    return result.rows;
  }

  async upsertApplication(input: {
    applicationKey: string;
    name: string;
    canonicalUrl: string;
    status: ApplicationStatus;
    actor: ActorRef;
  }): Promise<ApplicationRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<ApplicationRow>(
        `
          INSERT INTO applications (
            id, application_key, name, canonical_url, status
          ) VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (application_key) DO UPDATE SET
            name = EXCLUDED.name,
            canonical_url = EXCLUDED.canonical_url,
            status = EXCLUDED.status,
            updated_at = now()
          RETURNING
            id,
            application_key AS "applicationKey",
            name,
            canonical_url AS "canonicalUrl",
            status
        `,
        [randomUUID(), input.applicationKey, input.name, input.canonicalUrl, input.status],
      );
      const row = result.rows[0];
      if (!row) throw new Error("application upsert returned no row");

      await this.insertAudit(client, {
        actor: input.actor,
        action: "application.upsert",
        targetType: "application",
        targetRef: input.applicationKey,
        outcome: "succeeded",
        payload: { status: input.status, canonicalUrl: input.canonicalUrl },
      });
      await client.query("COMMIT");
      return row;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async setAccess(input: {
    identity: IdentityRef;
    applicationKey: string;
    status: AccessStatus;
    reason: string | null;
    actor: ActorRef;
  }): Promise<AccessRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const app = await client.query<{ id: string }>(
        "SELECT id FROM applications WHERE application_key = $1",
        [input.applicationKey],
      );
      const applicationId = app.rows[0]?.id;
      if (!applicationId) throw new UnknownApplicationError(input.applicationKey);

      const now = new Date();
      const result = await client.query<AccessRow>(
        `
          INSERT INTO application_access (
            id,
            identity_issuer,
            identity_subject,
            application_id,
            status,
            reason,
            actor_kind,
            actor_ref,
            granted_at,
            revoked_at,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
          ON CONFLICT (identity_issuer, identity_subject, application_id) DO UPDATE SET
            status = EXCLUDED.status,
            reason = EXCLUDED.reason,
            actor_kind = EXCLUDED.actor_kind,
            actor_ref = EXCLUDED.actor_ref,
            granted_at = EXCLUDED.granted_at,
            revoked_at = EXCLUDED.revoked_at,
            updated_at = now()
          RETURNING
            id,
            identity_issuer AS "identityIssuer",
            identity_subject AS "identitySubject",
            $11::text AS "applicationKey",
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
          applicationId,
          input.status,
          input.reason,
          input.actor.kind,
          input.actor.ref,
          input.status === "active" ? now : null,
          input.status === "revoked" ? now : null,
          input.applicationKey,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error("application access upsert returned no row");

      const targetRef = makeAccessTargetRef(input.identity, input.applicationKey);
      await this.insertAudit(client, {
        actor: input.actor,
        action: input.status === "active" ? "application_access.grant" : "application_access.revoke",
        targetType: "application_access",
        targetRef,
        outcome: "succeeded",
        payload: { applicationKey: input.applicationKey, reason: input.reason },
      });

      await client.query("COMMIT");
      return toAccessRecord(row);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getAccess(identity: IdentityRef, applicationKey: string): Promise<AccessRecord | null> {
    const result = await this.pool.query<AccessRow>(
      `
        SELECT
          aa.id,
          aa.identity_issuer AS "identityIssuer",
          aa.identity_subject AS "identitySubject",
          a.application_key AS "applicationKey",
          aa.status,
          aa.reason,
          aa.actor_kind AS "actorKind",
          aa.actor_ref AS "actorRef",
          aa.granted_at AS "grantedAt",
          aa.revoked_at AS "revokedAt",
          aa.updated_at AS "updatedAt"
        FROM application_access aa
        JOIN applications a ON a.id = aa.application_id
        WHERE aa.identity_issuer = $1
          AND aa.identity_subject = $2
          AND a.application_key = $3
        LIMIT 1
      `,
      [identity.issuer, identity.subject, applicationKey],
    );
    const row = result.rows[0];
    return row ? toAccessRecord(row) : null;
  }

  async checkAccess(identity: IdentityRef, applicationKey: string): Promise<AccessDecision> {
    const result = await this.pool.query<{
      applicationStatus: ApplicationStatus;
      accessStatus: AccessStatus | null;
    }>(
      `
        SELECT
          a.status AS "applicationStatus",
          aa.status AS "accessStatus"
        FROM applications a
        LEFT JOIN application_access aa
          ON aa.application_id = a.id
         AND aa.identity_issuer = $1
         AND aa.identity_subject = $2
        WHERE a.application_key = $3
        LIMIT 1
      `,
      [identity.issuer, identity.subject, applicationKey],
    );

    const row = result.rows[0];
    if (!row) return { allowed: false, applicationKey, decision: "UNKNOWN_APPLICATION" };
    if (row.applicationStatus !== "active") {
      return { allowed: false, applicationKey, decision: "APPLICATION_INACTIVE" };
    }
    if (!row.accessStatus) return { allowed: false, applicationKey, decision: "NO_GRANT" };
    if (row.accessStatus !== "active") {
      return { allowed: false, applicationKey, decision: "GRANT_REVOKED" };
    }
    return { allowed: true, applicationKey, decision: "active_grant" };
  }

  async listAudit(targetRef?: string, limit = 50): Promise<AuditRecord[]> {
    const safeLimit = Math.max(1, Math.min(limit, 200));
    const result = targetRef
      ? await this.pool.query<AuditRow>(
          `
            SELECT
              id,
              actor_kind AS "actorKind",
              actor_ref AS "actorRef",
              action,
              target_type AS "targetType",
              target_ref AS "targetRef",
              outcome,
              payload,
              occurred_at AS "occurredAt"
            FROM platform_audit_events
            WHERE target_ref = $1
            ORDER BY occurred_at DESC
            LIMIT $2
          `,
          [targetRef, safeLimit],
        )
      : await this.pool.query<AuditRow>(
          `
            SELECT
              id,
              actor_kind AS "actorKind",
              actor_ref AS "actorRef",
              action,
              target_type AS "targetType",
              target_ref AS "targetRef",
              outcome,
              payload,
              occurred_at AS "occurredAt"
            FROM platform_audit_events
            ORDER BY occurred_at DESC
            LIMIT $1
          `,
          [safeLimit],
        );

    return result.rows.map((row) => ({
      id: row.id,
      actor: { kind: row.actorKind, ref: row.actorRef },
      action: row.action,
      targetType: row.targetType,
      targetRef: row.targetRef,
      outcome: row.outcome,
      payload: row.payload,
      occurredAt: row.occurredAt.toISOString(),
    }));
  }

  private async insertAudit(
    client: PoolClient,
    input: {
      actor: ActorRef;
      action: string;
      targetType: string;
      targetRef: string;
      outcome: AuditRecord["outcome"];
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    await client.query(
      `
        INSERT INTO platform_audit_events (
          id, actor_kind, actor_ref, action, target_type, target_ref, outcome, payload
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      `,
      [
        randomUUID(),
        input.actor.kind,
        input.actor.ref,
        input.action,
        input.targetType,
        input.targetRef,
        input.outcome,
        JSON.stringify(input.payload),
      ],
    );
  }
}

export class UnknownApplicationError extends Error {
  constructor(public readonly applicationKey: string) {
    super(`Unknown application: ${applicationKey}`);
    this.name = "UnknownApplicationError";
  }
}

export function makeAccessTargetRef(identity: IdentityRef, applicationKey: string): string {
  return `${identity.issuer}|${identity.subject}|${applicationKey}`;
}

function toAccessRecord(row: AccessRow): AccessRecord {
  return {
    id: row.id,
    identity: { issuer: row.identityIssuer, subject: row.identitySubject },
    applicationKey: row.applicationKey,
    status: row.status,
    reason: row.reason,
    actor: { kind: row.actorKind, ref: row.actorRef },
    grantedAt: row.grantedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}
