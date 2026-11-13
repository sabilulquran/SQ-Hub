import type { Pool, PoolClient } from "pg";

export type Db = Pool | PoolClient;

/** SEK-IMPL-001: a stable error the routes turn into a status code and a sentence. */
export class SekretariatError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Outside the caller's issuers, or the object does not exist: the same 404 (§8). */
export function notFound(): never {
  throw new SekretariatError(404, "tidak_ditemukan", "Tidak ditemukan.");
}

export function forbidden(message = "Peran Anda tidak mengizinkan tindakan ini."): never {
  throw new SekretariatError(403, "peran_tidak_cukup", message);
}

export function invalid(message: string, code = "tidak_sah"): never {
  throw new SekretariatError(400, code, message);
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

/** Every allocation, void, retroactive entry and admin action; never letter or e-mail content. */
export async function writeAudit(
  db: Db,
  entry: { aktor: string; aksi: string; objekJenis: string; objekRef: string; alasan?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  await db.query(
    `INSERT INTO sekretariat_audit (aktor, aksi, objek_jenis, objek_ref, alasan, metadata) VALUES ($1, $2, $3, $4, $5, $6)`,
    [entry.aktor, entry.aksi, entry.objekJenis, entry.objekRef, entry.alasan ?? "", JSON.stringify(entry.metadata ?? {})],
  );
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
