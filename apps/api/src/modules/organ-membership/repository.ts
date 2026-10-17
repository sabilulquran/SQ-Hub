import { createHash, randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import type { ActorRef, IdentityRef } from "../application-access/types.js";

export type Organ = "pembina" | "pengurus" | "pengawas";
export type ProvisioningPath = "existing_staff" | "organ_identity";

export interface OrganMembershipRecord {
  id: string;
  identity: IdentityRef;
  organ: Organ;
  positionLabel: string | null;
  /** Calendar dates (YYYY-MM-DD) in the Yayasan's local calendar. */
  termStart: string;
  termEnd: string | null;
  status: "active" | "ended";
  reason: string;
  provisioningPath: ProvisioningPath;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
}

export interface OrganMembershipTerms {
  organ: Organ;
  positionLabel: string | null;
  termStart: string;
  termEnd: string | null;
}

export class OrganMembershipConflictError extends Error {
  constructor() {
    super("identity already has an active organ membership");
    this.name = "OrganMembershipConflictError";
  }
}

export class OrganMembershipNotFoundError extends Error {
  constructor() {
    super("organ membership not found");
    this.name = "OrganMembershipNotFoundError";
  }
}

export interface OrganMembershipStore {
  getById(id: string): Promise<OrganMembershipRecord | null>;
  getActive(identity: IdentityRef): Promise<OrganMembershipRecord | null>;
  /** Active and within its term today (HUB-IMPL-021 §1 "effective"). */
  getEffective(identity: IdentityRef, today?: string): Promise<OrganMembershipRecord | null>;
  listActive(): Promise<OrganMembershipRecord[]>;
  listRecentlyEnded(limit: number): Promise<OrganMembershipRecord[]>;
  /** Active memberships whose term ends within `days` days, or has already passed. */
  listEndingWithin(days: number, today?: string): Promise<OrganMembershipRecord[]>;
  create(input: {
    identity: IdentityRef;
    terms: OrganMembershipTerms;
    reason: string;
    provisioningPath: ProvisioningPath;
    actor: ActorRef;
  }): Promise<OrganMembershipRecord>;
  change(input: { id: string; terms: OrganMembershipTerms; reason: string; actor: ActorRef }): Promise<OrganMembershipRecord>;
  end(input: { id: string; reason: string; actor: ActorRef; source?: string }): Promise<{
    outcome: "succeeded" | "noop";
    membership: OrganMembershipRecord;
  }>;
  /** A Path B identity that later became an Employee counts as Path A from then on. */
  markExistingStaff(input: { identity: IdentityRef; reason: string; actor: ActorRef }): Promise<"succeeded" | "noop">;
  audit(input: {
    actor: ActorRef;
    action: string;
    identity: IdentityRef | null;
    targetHint?: string;
    outcome: "succeeded" | "failed" | "noop";
    payload: Record<string, unknown>;
  }): Promise<void>;
}

// The Yayasan works in Western Indonesia Time; a term date changes at local midnight.
const TODAY_SQL = "(now() AT TIME ZONE 'Asia/Jakarta')::date";

const COLUMNS = `
  id,
  identity_issuer AS "identityIssuer",
  identity_subject AS "identitySubject",
  organ,
  position_label AS "positionLabel",
  to_char(term_start, 'YYYY-MM-DD') AS "termStart",
  to_char(term_end, 'YYYY-MM-DD') AS "termEnd",
  status,
  reason,
  provisioning_path AS "provisioningPath",
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  ended_at AS "endedAt"
`;

interface Row {
  id: string;
  identityIssuer: string;
  identitySubject: string;
  organ: Organ;
  positionLabel: string | null;
  termStart: string;
  termEnd: string | null;
  status: "active" | "ended";
  reason: string;
  provisioningPath: ProvisioningPath;
  createdAt: Date;
  updatedAt: Date;
  endedAt: Date | null;
}

export function organMembershipTargetRef(identity: IdentityRef): string {
  return `organ-membership:${createHash("sha256").update(`${identity.issuer}\n${identity.subject}`).digest("hex")}`;
}

export class PgOrganMembershipRepository implements OrganMembershipStore {
  constructor(private readonly pool: Pool) {}

  async getById(id: string): Promise<OrganMembershipRecord | null> {
    const result = await this.pool.query<Row>(`SELECT ${COLUMNS} FROM organ_memberships WHERE id = $1`, [id]);
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async getActive(identity: IdentityRef): Promise<OrganMembershipRecord | null> {
    const result = await this.pool.query<Row>(
      `SELECT ${COLUMNS} FROM organ_memberships
       WHERE identity_issuer = $1 AND identity_subject = $2 AND status = 'active'`,
      [identity.issuer, identity.subject],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async getEffective(identity: IdentityRef, today?: string): Promise<OrganMembershipRecord | null> {
    const result = await this.pool.query<Row>(
      `SELECT ${COLUMNS} FROM organ_memberships
       WHERE identity_issuer = $1 AND identity_subject = $2 AND status = 'active'
         AND term_start <= COALESCE($3::date, ${TODAY_SQL})
         AND (term_end IS NULL OR term_end > COALESCE($3::date, ${TODAY_SQL}))`,
      [identity.issuer, identity.subject, today ?? null],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async listActive(): Promise<OrganMembershipRecord[]> {
    const result = await this.pool.query<Row>(
      `SELECT ${COLUMNS} FROM organ_memberships WHERE status = 'active'
       ORDER BY organ, term_start, created_at LIMIT 500`,
    );
    return result.rows.map(toRecord);
  }

  async listRecentlyEnded(limit: number): Promise<OrganMembershipRecord[]> {
    const result = await this.pool.query<Row>(
      `SELECT ${COLUMNS} FROM organ_memberships WHERE status = 'ended'
       ORDER BY ended_at DESC LIMIT $1`,
      [Math.max(1, Math.min(limit, 200))],
    );
    return result.rows.map(toRecord);
  }

  async listEndingWithin(days: number, today?: string): Promise<OrganMembershipRecord[]> {
    const result = await this.pool.query<Row>(
      `SELECT ${COLUMNS} FROM organ_memberships
       WHERE status = 'active' AND term_end IS NOT NULL
         AND term_end <= COALESCE($2::date, ${TODAY_SQL}) + $1::int
       ORDER BY term_end, created_at LIMIT 500`,
      [days, today ?? null],
    );
    return result.rows.map(toRecord);
  }

  async create(input: {
    identity: IdentityRef;
    terms: OrganMembershipTerms;
    reason: string;
    provisioningPath: ProvisioningPath;
    actor: ActorRef;
  }): Promise<OrganMembershipRecord> {
    return this.transaction(async (client) => {
      let row: Row | undefined;
      try {
        const result = await client.query<Row>(
          `INSERT INTO organ_memberships (
             id, identity_issuer, identity_subject, organ, position_label, term_start, term_end,
             status, reason, provisioning_path, actor_kind, actor_ref
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9, $10, $11)
           RETURNING ${COLUMNS}`,
          [
            randomUUID(),
            input.identity.issuer,
            input.identity.subject,
            input.terms.organ,
            input.terms.positionLabel,
            input.terms.termStart,
            input.terms.termEnd,
            input.reason,
            input.provisioningPath,
            input.actor.kind,
            input.actor.ref,
          ],
        );
        row = result.rows[0];
      } catch (error) {
        if (isUniqueViolation(error)) throw new OrganMembershipConflictError();
        throw error;
      }
      if (!row) throw new Error("organ membership insert returned no row");
      const record = toRecord(row);
      await insertAudit(client, {
        actor: input.actor,
        action: "organ_membership.grant",
        targetRef: organMembershipTargetRef(input.identity),
        outcome: "succeeded",
        payload: membershipPayload(record, input.reason),
      });
      return record;
    });
  }

  async change(input: { id: string; terms: OrganMembershipTerms; reason: string; actor: ActorRef }): Promise<OrganMembershipRecord> {
    return this.transaction(async (client) => {
      const result = await client.query<Row>(
        `UPDATE organ_memberships SET
           organ = $2, position_label = $3, term_start = $4, term_end = $5, reason = $6,
           actor_kind = $7, actor_ref = $8, updated_at = now()
         WHERE id = $1 AND status = 'active'
         RETURNING ${COLUMNS}`,
        [
          input.id,
          input.terms.organ,
          input.terms.positionLabel,
          input.terms.termStart,
          input.terms.termEnd,
          input.reason,
          input.actor.kind,
          input.actor.ref,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new OrganMembershipNotFoundError();
      const record = toRecord(row);
      await insertAudit(client, {
        actor: input.actor,
        action: "organ_membership.change",
        targetRef: organMembershipTargetRef(record.identity),
        outcome: "succeeded",
        payload: membershipPayload(record, input.reason),
      });
      return record;
    });
  }

  async end(input: { id: string; reason: string; actor: ActorRef; source?: string }) {
    return this.transaction(async (client) => {
      const current = await client.query<Row>(`SELECT ${COLUMNS} FROM organ_memberships WHERE id = $1 FOR UPDATE`, [input.id]);
      const existing = current.rows[0];
      if (!existing) throw new OrganMembershipNotFoundError();
      if (existing.status === "ended") {
        return { outcome: "noop" as const, membership: toRecord(existing) };
      }
      const result = await client.query<Row>(
        `UPDATE organ_memberships SET
           status = 'ended', ended_at = now(), reason = $2, actor_kind = $3, actor_ref = $4, updated_at = now()
         WHERE id = $1
         RETURNING ${COLUMNS}`,
        [input.id, input.reason, input.actor.kind, input.actor.ref],
      );
      const record = toRecord(result.rows[0]!);
      await insertAudit(client, {
        actor: input.actor,
        action: "organ_membership.end",
        targetRef: organMembershipTargetRef(record.identity),
        outcome: "succeeded",
        payload: { ...membershipPayload(record, input.reason), ...(input.source ? { source: input.source } : {}) },
      });
      return { outcome: "succeeded" as const, membership: record };
    });
  }

  async markExistingStaff(input: { identity: IdentityRef; reason: string; actor: ActorRef }): Promise<"succeeded" | "noop"> {
    return this.transaction(async (client) => {
      const result = await client.query<Row>(
        `UPDATE organ_memberships SET provisioning_path = 'existing_staff', updated_at = now()
         WHERE identity_issuer = $1 AND identity_subject = $2 AND provisioning_path = 'organ_identity'
         RETURNING ${COLUMNS}`,
        [input.identity.issuer, input.identity.subject],
      );
      if (result.rows.length === 0) return "noop";
      await insertAudit(client, {
        actor: input.actor,
        action: "organ_membership.provisioning_path_change",
        targetRef: organMembershipTargetRef(input.identity),
        outcome: "succeeded",
        payload: { provisioningPath: "existing_staff", reason: input.reason },
      });
      return "succeeded";
    });
  }

  async audit(input: {
    actor: ActorRef;
    action: string;
    identity: IdentityRef | null;
    targetHint?: string;
    outcome: "succeeded" | "failed" | "noop";
    payload: Record<string, unknown>;
  }): Promise<void> {
    const targetRef = input.identity
      ? organMembershipTargetRef(input.identity)
      : `organ-membership:${createHash("sha256").update(input.targetHint ?? "unknown").digest("hex")}`;
    await insertAudit(this.pool, {
      actor: input.actor,
      action: input.action,
      targetRef,
      outcome: input.outcome,
      payload: input.payload,
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

function membershipPayload(record: OrganMembershipRecord, reason: string) {
  return {
    membershipId: record.id,
    organ: record.organ,
    positionLabel: record.positionLabel,
    termStart: record.termStart,
    termEnd: record.termEnd,
    provisioningPath: record.provisioningPath,
    reason,
  };
}

async function insertAudit(
  client: Pick<Pool, "query"> | PoolClient,
  input: {
    actor: ActorRef;
    action: string;
    targetRef: string;
    outcome: "succeeded" | "failed" | "noop";
    payload: Record<string, unknown>;
  },
) {
  await client.query(
    `INSERT INTO platform_audit_events (
       id, actor_kind, actor_ref, action, target_type, target_ref, outcome, payload
     ) VALUES ($1, $2, $3, $4, 'organ_membership', $5, $6, $7::jsonb)`,
    [randomUUID(), input.actor.kind, input.actor.ref, input.action, input.targetRef, input.outcome, JSON.stringify(input.payload)],
  );
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

function toRecord(row: Row): OrganMembershipRecord {
  return {
    id: row.id,
    identity: { issuer: row.identityIssuer, subject: row.identitySubject },
    organ: row.organ,
    positionLabel: row.positionLabel,
    termStart: row.termStart,
    termEnd: row.termEnd,
    status: row.status,
    reason: row.reason,
    provisioningPath: row.provisioningPath,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
  };
}
