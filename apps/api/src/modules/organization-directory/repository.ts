import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { OrganizationDirectorySnapshot as Snapshot } from "./contract.js";
import { assertNoRegression, DirectorySyncError, validateSnapshot, businessDateSchema } from "./validation.js";

export interface Tombstones {
  units: Array<{ id: string; name: string; active: false; sourceAbsent: true }>;
  positions: Array<{ id: string; title: string; active: false; sourceAbsent: true }>;
  people: Array<{ id: string; displayName: string; active: false; sourceAbsent: true }>;
}
export interface Projection { snapshot: Snapshot; tombstones: Tombstones; synchronizedAt: string }
export interface SyncAttempt {
  attemptId: string; startedAt: string; finishedAt: string;
  result: "APPLIED" | "UNCHANGED" | "FAILED";
  sourceSnapshotId: string | null; sourceVersion: string | null;
  asOf: string; counts: Snapshot["counts"] | null;
  errorCategory: DirectorySyncError["category"] | null; synchronizedAt: string | null;
}

function tombstones(previous: Projection | null, next: Snapshot): Tombstones {
  const absent = <T extends { id: string }>(old: T[], current: { id: string }[]) => {
    const ids = new Set(current.map((r) => r.id));
    return old.filter((r) => !ids.has(r.id));
  };
  return {
    units: absent([...(previous?.snapshot.units ?? []), ...(previous?.tombstones.units ?? [])], next.units)
      .map((r) => ({ id: r.id, name: r.name, active: false, sourceAbsent: true })),
    positions: absent([...(previous?.snapshot.positions ?? []), ...(previous?.tombstones.positions ?? [])], next.positions)
      .map((r) => ({ id: r.id, title: r.title, active: false, sourceAbsent: true })),
    people: absent([...(previous?.snapshot.people ?? []), ...(previous?.tombstones.people ?? [])], next.people)
      .map((r) => ({ id: r.id, displayName: r.displayName, active: false, sourceAbsent: true })),
  };
}

async function read(client: Pick<Pool, "query"> | PoolClient): Promise<Projection | null> {
  const result = await client.query<{ snapshot: Snapshot; tombstones: Tombstones; synchronized_at: Date }>(
    "SELECT snapshot, tombstones, synchronized_at FROM organization_directory_projection WHERE source = 'hcis'",
  );
  const row = result.rows[0];
  return row ? { snapshot: row.snapshot, tombstones: row.tombstones, synchronizedAt: row.synchronized_at.toISOString() } : null;
}

async function record(client: PoolClient, a: SyncAttempt) {
  await client.query(`INSERT INTO organization_directory_sync_attempts
    (attempt_id, started_at, finished_at, result, source_snapshot_id, source_version, as_of, counts, error_category, synchronized_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
  [a.attemptId, a.startedAt, a.finishedAt, a.result, a.sourceSnapshotId, a.sourceVersion, a.asOf, a.counts, a.errorCategory, a.synchronizedAt]);
}

export class PgOrganizationDirectory {
  constructor(private readonly pool: Pool, private readonly now: () => Date = () => new Date()) {}
  read(): Promise<Projection | null> { return read(this.pool); }

  async synchronize(asOf: string, pull: (asOf: string, attemptId: string) => Promise<unknown>): Promise<SyncAttempt | null> {
    businessDateSchema.parse(asOf);
    const client = await this.pool.connect();
    const startedAt = this.now().toISOString();
    const attempt: SyncAttempt = {
      attemptId: randomUUID(), startedAt, finishedAt: startedAt, result: "FAILED",
      sourceSnapshotId: null, sourceVersion: null, asOf, counts: null, errorCategory: null, synchronizedAt: null,
    };
    let discard = false;
    try {
      await client.query("BEGIN");
      // Lock before fetch, not merely before write: old in-flight pulls cannot win later.
      const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_xact_lock(77241018) AS locked");
      if (!lock.rows[0]?.locked) { await client.query("ROLLBACK"); return null; }
      const previous = await read(client);
      attempt.synchronizedAt = previous?.synchronizedAt ?? null;
      const snapshot = validateSnapshot(await pull(asOf, attempt.attemptId), asOf);
      attempt.sourceSnapshotId = snapshot.source.snapshotId;
      attempt.sourceVersion = snapshot.version;
      attempt.counts = snapshot.counts;
      if (previous) assertNoRegression(snapshot, previous.snapshot);
      attempt.finishedAt = this.now().toISOString();
      const synchronizedAt = attempt.finishedAt;
      if (previous?.snapshot.version === snapshot.version) {
        await client.query("UPDATE organization_directory_projection SET synchronized_at = $1 WHERE source = 'hcis'", [synchronizedAt]);
        attempt.result = "UNCHANGED";
      } else {
        await client.query(`INSERT INTO organization_directory_projection (source, snapshot, tombstones, synchronized_at)
          VALUES ('hcis', $1, $2, $3) ON CONFLICT (source) DO UPDATE
          SET snapshot = EXCLUDED.snapshot, tombstones = EXCLUDED.tombstones, synchronized_at = EXCLUDED.synchronized_at`,
        [snapshot, tombstones(previous, snapshot), synchronizedAt]);
        attempt.result = "APPLIED";
      }
      attempt.synchronizedAt = synchronizedAt;
      await record(client, attempt);
      await client.query("COMMIT");
      return attempt;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { discard = true; }
      attempt.result = "FAILED";
      attempt.finishedAt = this.now().toISOString();
      attempt.errorCategory = error instanceof DirectorySyncError ? error.category : "storage";
      // Re-read committed LKG: rollback must not report an uncommitted success time.
      try {
        attempt.synchronizedAt = (await read(client))?.synchronizedAt ?? null;
        await record(client, attempt);
      } catch { discard = true; throw new DirectorySyncError("storage"); }
      return attempt;
    } finally { client.release(discard); }
  }
}
