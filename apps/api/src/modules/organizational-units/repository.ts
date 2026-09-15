import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import type { ActorRef } from "../application-access/types.js";
import type {
  ApplyImportResult,
  ImportMapping,
  ImportSnapshotRow,
  OrganizationalUnit,
} from "./types.js";

export interface OrganizationalUnitRepository {
  list(): Promise<OrganizationalUnit[]>;
  findById(id: string): Promise<OrganizationalUnit | null>;
  findByKeys(keys: string[]): Promise<OrganizationalUnit[]>;
  create(input: {
    unitKey: string;
    name: string;
    parentId: string | null;
    active: boolean;
    actor: ActorRef;
    reason: string;
  }): Promise<OrganizationalUnit>;
  update(input: {
    id: string;
    name?: string;
    parentId?: string | null;
    actor: ActorRef;
    reason: string;
  }): Promise<OrganizationalUnit>;
  setActive(input: {
    id: string;
    active: boolean;
    actor: ActorRef;
    reason: string;
  }): Promise<{ outcome: "succeeded" | "noop"; unit: OrganizationalUnit }>;
  findMappings(sourceSystem: string, sourceRefs: string[]): Promise<Map<string, OrganizationalUnit>>;
  findMappingSourcesByKeys(sourceSystem: string, unitKeys: string[]): Promise<Map<string, string>>;
  applyImport(input: {
    sourceSystem: string;
    fingerprint: string;
    rows: ImportSnapshotRow[];
    mappings: ImportMapping[];
    actor: ActorRef;
    reason: string;
  }): Promise<ApplyImportResult>;
}

export class PgOrganizationalUnitRepository implements OrganizationalUnitRepository {
  constructor(private readonly pool: Pool) {}

  async list(): Promise<OrganizationalUnit[]> {
    const result = await this.pool.query(`SELECT * FROM organizational_units ORDER BY unit_key`);
    return result.rows.map(toUnit);
  }

  async findById(id: string): Promise<OrganizationalUnit | null> {
    const result = await this.pool.query(`SELECT * FROM organizational_units WHERE id = $1`, [id]);
    return result.rows[0] ? toUnit(result.rows[0]) : null;
  }

  async findByKeys(keys: string[]): Promise<OrganizationalUnit[]> {
    if (!keys.length) return [];
    const result = await this.pool.query(
      `SELECT * FROM organizational_units WHERE unit_key = ANY($1::text[])`,
      [keys],
    );
    return result.rows.map(toUnit);
  }

  async create(input: {
    unitKey: string;
    name: string;
    parentId: string | null;
    active: boolean;
    actor: ActorRef;
    reason: string;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const id = randomUUID();
      const result = await client.query(
        `INSERT INTO organizational_units (id, unit_key, name, parent_id, active)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [id, input.unitKey, input.name, input.parentId, input.active],
      );
      await audit(client, input.actor, "organizational_unit.create", id, "succeeded", {
        reason: input.reason,
        unitKey: input.unitKey,
      });
      await client.query("COMMIT");
      return toUnit(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async update(input: {
    id: string;
    name?: string;
    parentId?: string | null;
    actor: ActorRef;
    reason: string;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(
        `SELECT * FROM organizational_units WHERE id=$1 FOR UPDATE`,
        [input.id],
      );
      if (!current.rows[0]) throw new OrganizationalUnitNotFoundError();
      const name = input.name ?? current.rows[0].name;
      const parentId = input.parentId === undefined ? current.rows[0].parent_id : input.parentId;
      const result = await client.query(
        `UPDATE organizational_units
         SET name=$2, parent_id=$3, updated_at=now()
         WHERE id=$1 RETURNING *`,
        [input.id, name, parentId],
      );
      await audit(client, input.actor, "organizational_unit.update", input.id, "succeeded", {
        reason: input.reason,
        changed: { name: input.name !== undefined, parentId: input.parentId !== undefined },
      });
      await client.query("COMMIT");
      return toUnit(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async setActive(input: {
    id: string;
    active: boolean;
    actor: ActorRef;
    reason: string;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(
        `SELECT * FROM organizational_units WHERE id=$1 FOR UPDATE`,
        [input.id],
      );
      if (!current.rows[0]) throw new OrganizationalUnitNotFoundError();
      if (current.rows[0].active === input.active) {
        await audit(
          client,
          input.actor,
          input.active ? "organizational_unit.activate" : "organizational_unit.deactivate",
          input.id,
          "noop",
          { reason: input.reason },
        );
        await client.query("COMMIT");
        return { outcome: "noop" as const, unit: toUnit(current.rows[0]) };
      }
      const result = await client.query(
        `UPDATE organizational_units SET active=$2, updated_at=now() WHERE id=$1 RETURNING *`,
        [input.id, input.active],
      );
      await audit(
        client,
        input.actor,
        input.active ? "organizational_unit.activate" : "organizational_unit.deactivate",
        input.id,
        "succeeded",
        { reason: input.reason },
      );
      await client.query("COMMIT");
      return { outcome: "succeeded" as const, unit: toUnit(result.rows[0]) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findMappings(
    sourceSystem: string,
    sourceRefs: string[],
  ): Promise<Map<string, OrganizationalUnit>> {
    if (!sourceRefs.length) return new Map();
    const result = await this.pool.query(
      `SELECT m.source_ref, u.*
       FROM organizational_unit_source_mappings m
       JOIN organizational_units u ON u.id=m.unit_id
       WHERE m.source_system=$1 AND m.source_ref=ANY($2::text[])`,
      [sourceSystem, sourceRefs],
    );
    return new Map(result.rows.map((row) => [row.source_ref as string, toUnit(row)]));
  }

  async findMappingSourcesByKeys(
    sourceSystem: string,
    unitKeys: string[],
  ): Promise<Map<string, string>> {
    if (!unitKeys.length) return new Map();
    const result = await this.pool.query(
      `SELECT u.unit_key, m.source_ref
       FROM organizational_unit_source_mappings m
       JOIN organizational_units u ON u.id=m.unit_id
       WHERE m.source_system=$1 AND u.unit_key=ANY($2::text[])`,
      [sourceSystem, unitKeys],
    );
    return new Map(
      result.rows.map((row) => [String(row.unit_key), String(row.source_ref)]),
    );
  }

  async applyImport(input: {
    sourceSystem: string;
    fingerprint: string;
    rows: ImportSnapshotRow[];
    mappings: ImportMapping[];
    actor: ActorRef;
    reason: string;
  }): Promise<ApplyImportResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const prior = await client.query(
        `SELECT result_summary
         FROM organizational_unit_import_runs
         WHERE source_system=$1 AND snapshot_fingerprint=$2`,
        [input.sourceSystem, input.fingerprint],
      );
      if (prior.rows[0]) {
        await client.query("ROLLBACK");
        return {
          outcome: "noop",
          ...(prior.rows[0].result_summary as Omit<ApplyImportResult, "outcome">),
        };
      }

      const mappingByRef = new Map(input.mappings.map((item) => [item.sourceRef, item.unitKey]));
      const existingMappings = await findMappingsWithClient(
        client,
        input.sourceSystem,
        input.rows.map((row) => row.sourceRef),
      );
      const unitIdBySourceRef = new Map<string, string>();
      const originalParentByUnitId = new Map<string, string | null>();
      const createdUnitIds = new Set<string>();
      const changedUnitIds = new Set<string>();

      for (const row of input.rows) {
        const unitKey = mappingByRef.get(row.sourceRef)!;
        const mapped = existingMappings.get(row.sourceRef);
        if (mapped && mapped.unitKey !== unitKey) {
          throw new Error("organizational unit source mapping conflict");
        }
        const byKey = await client.query(
          `SELECT * FROM organizational_units WHERE unit_key=$1 FOR UPDATE`,
          [unitKey],
        );
        const existing = mapped ?? (byKey.rows[0] ? toUnit(byKey.rows[0]) : null);

        if (!existing) {
          const id = randomUUID();
          await client.query(
            `INSERT INTO organizational_units (id, unit_key, name, active)
             VALUES ($1,$2,$3,$4)`,
            [id, unitKey, row.name, row.active],
          );
          unitIdBySourceRef.set(row.sourceRef, id);
          originalParentByUnitId.set(id, null);
          createdUnitIds.add(id);
        } else {
          unitIdBySourceRef.set(row.sourceRef, existing.id);
          originalParentByUnitId.set(existing.id, existing.parentId);
          if (existing.name !== row.name || existing.active !== row.active) {
            await client.query(
              `UPDATE organizational_units
               SET name=$2, active=$3, updated_at=now()
               WHERE id=$1`,
              [existing.id, row.name, row.active],
            );
            changedUnitIds.add(existing.id);
          }
        }
      }

      for (const row of input.rows) {
        const unitId = unitIdBySourceRef.get(row.sourceRef)!;
        const parentId = row.parentSourceRef
          ? unitIdBySourceRef.get(row.parentSourceRef)!
          : null;
        const originalParentId = originalParentByUnitId.get(unitId) ?? null;
        if (originalParentId === parentId) continue;

        await client.query(
          `UPDATE organizational_units SET parent_id=$2, updated_at=now() WHERE id=$1`,
          [unitId, parentId],
        );
        if (!createdUnitIds.has(unitId)) changedUnitIds.add(unitId);
      }

      const created = createdUnitIds.size;
      const updated = changedUnitIds.size;
      const unchanged = input.rows.length - created - updated;
      const runId = randomUUID();
      const summary = {
        fingerprint: input.fingerprint,
        created,
        updated,
        unchanged,
        deleted: 0 as const,
      };

      await client.query(
        `INSERT INTO organizational_unit_import_runs (
           id,source_system,snapshot_fingerprint,row_count,result_summary,
           actor_kind,actor_ref,reason
         ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,
        [
          runId,
          input.sourceSystem,
          input.fingerprint,
          input.rows.length,
          JSON.stringify(summary),
          input.actor.kind,
          input.actor.ref,
          input.reason,
        ],
      );

      for (const row of input.rows) {
        const unitId = unitIdBySourceRef.get(row.sourceRef)!;
        await client.query(
          `INSERT INTO organizational_unit_source_mappings (
             source_system,source_ref,unit_id,first_import_run_id
           ) VALUES ($1,$2,$3,$4)
           ON CONFLICT (source_system,source_ref) DO UPDATE
           SET unit_id=EXCLUDED.unit_id, updated_at=now()`,
          [input.sourceSystem, row.sourceRef, unitId, runId],
        );

        const unitKey = mappingByRef.get(row.sourceRef)!;
        if (createdUnitIds.has(unitId)) {
          await audit(
            client,
            input.actor,
            "organizational_unit.import.create",
            unitId,
            "succeeded",
            {
              reason: input.reason,
              sourceSystem: input.sourceSystem,
              sourceRef: row.sourceRef,
              unitKey,
            },
          );
        } else if (changedUnitIds.has(unitId)) {
          await audit(
            client,
            input.actor,
            "organizational_unit.import.update",
            unitId,
            "succeeded",
            {
              reason: input.reason,
              sourceSystem: input.sourceSystem,
              sourceRef: row.sourceRef,
              unitKey,
            },
          );
        }
      }

      await audit(
        client,
        input.actor,
        "organizational_unit.import.apply",
        runId,
        "succeeded",
        {
          reason: input.reason,
          sourceSystem: input.sourceSystem,
          fingerprint: input.fingerprint,
          rowCount: input.rows.length,
          created,
          updated,
          unchanged,
          deleted: 0,
        },
      );
      await client.query("COMMIT");
      return { outcome: "succeeded", ...summary };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export class OrganizationalUnitNotFoundError extends Error {}

async function findMappingsWithClient(
  client: PoolClient,
  sourceSystem: string,
  sourceRefs: string[],
): Promise<Map<string, OrganizationalUnit>> {
  if (!sourceRefs.length) return new Map();
  const result = await client.query(
    `SELECT m.source_ref, u.*
     FROM organizational_unit_source_mappings m
     JOIN organizational_units u ON u.id=m.unit_id
     WHERE m.source_system=$1 AND m.source_ref=ANY($2::text[])`,
    [sourceSystem, sourceRefs],
  );
  return new Map(result.rows.map((row) => [row.source_ref as string, toUnit(row)]));
}

async function audit(
  client: PoolClient,
  actor: ActorRef,
  action: string,
  targetRef: string,
  outcome: "succeeded" | "failed" | "noop",
  payload: Record<string, unknown>,
) {
  await client.query(
    `INSERT INTO platform_audit_events (
       id,actor_kind,actor_ref,action,target_type,target_ref,outcome,payload
     ) VALUES ($1,$2,$3,$4,'organizational_unit',$5,$6,$7::jsonb)`,
    [
      randomUUID(),
      actor.kind,
      actor.ref,
      action,
      targetRef,
      outcome,
      JSON.stringify(payload),
    ],
  );
}

function toUnit(row: Record<string, unknown>): OrganizationalUnit {
  return {
    id: String(row.id),
    unitKey: String(row.unit_key),
    name: String(row.name),
    parentId: row.parent_id ? String(row.parent_id) : null,
    active: row.active === true,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}
