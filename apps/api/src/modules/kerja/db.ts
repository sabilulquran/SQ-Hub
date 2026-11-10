import type { Pool, PoolClient } from "pg";

export type Db = Pool | PoolClient;

/** KERJA-IMPL-001 §7.3: a stable error the routes turn into a status code and a sentence. */
export class KerjaError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Not a member of the room, or the object does not exist: the same 404 (§10 nomor 1). */
export function notFound(): never {
  throw new KerjaError(404, "tidak_ditemukan", "Tidak ditemukan.");
}

export function forbidden(message = "Peran Anda di ruang ini tidak mengizinkan tindakan ini."): never {
  throw new KerjaError(403, "peran_tidak_cukup", message);
}

export function invalid(message: string, code = "tidak_sah"): never {
  throw new KerjaError(400, code, message);
}

export async function withTransaction<T>(pool: Pool, run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** KERJA-IMPL-001 §10 nomor 6: every admin action and membership change, with a mandatory reason. */
export async function writeAudit(
  db: Db,
  entry: { aktor: string; aksi: string; objekJenis: string; objekRef: string; ruangId?: string | null; alasan: string; metadata?: Record<string, unknown> },
): Promise<void> {
  await db.query(
    `INSERT INTO kerja_audit (aktor, aksi, objek_jenis, objek_ref, ruang_id, alasan, metadata) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [entry.aktor, entry.aksi, entry.objekJenis, entry.objekRef, entry.ruangId ?? null, entry.alasan, JSON.stringify(entry.metadata ?? {})],
  );
}

/** §6.5: one row per card change. Description edits record that it changed, never the text. */
export async function writeHistory(
  db: Db,
  entry: { kartuId: string; aksi: string; aktor: string; lama?: unknown; baru?: unknown },
): Promise<void> {
  await db.query(
    `INSERT INTO kerja_riwayat (kartu_id, aksi, aktor, lama, baru) VALUES ($1, $2, $3, $4, $5)`,
    [entry.kartuId, entry.aksi, entry.aktor, entry.lama === undefined ? null : JSON.stringify(entry.lama), entry.baru === undefined ? null : JSON.stringify(entry.baru)],
  );
}
