import type { Pool } from "pg";

import { isUuid, notFound, type Db } from "./db.js";

/** The signed-in person. `actor` is what the register and audit rows record. */
export interface Viewer {
  personId: string;
  actor: string;
  nama: string;
}

/**
 * SEK-IMPL-001 §8 layered access: the admin sees everything; an officer sees only the issuers
 * they hold; disposition holders see the foundation inbox. Every mismatch is a 404, never a 403,
 * so a letter's existence does not leak (Kerja §7.3 pattern). Two-step verification itself is
 * enforced by the `sq-staff` realm policy (staff-authentication-policy.md), not re-checked here.
 */
export interface Peranku {
  admin: boolean;
  /** Issuer ids the viewer holds an active hak-ambil-nomor on. */
  penerbitIds: Set<string>;
  disposisi: boolean;
}

export async function loadPeran(db: Db, viewer: Viewer, admin: boolean): Promise<Peranku> {
  const [petugas, disposisi] = await Promise.all([
    db.query<{ penerbit_id: string }>("SELECT penerbit_id FROM sekretariat_petugas WHERE person_id = $1 AND dicabut_pada IS NULL", [viewer.personId]),
    db.query("SELECT 1 FROM sekretariat_disposisi_pemegang WHERE person_id = $1 AND dicabut_pada IS NULL", [viewer.personId]),
  ]);
  return { admin, penerbitIds: new Set(petugas.rows.map((row) => row.penerbit_id)), disposisi: (disposisi.rowCount ?? 0) > 0 };
}

export async function isSekretariatAdmin(pool: Pool, identity: { issuer: string; subject: string }): Promise<boolean> {
  const result = await pool.query(
    "SELECT 1 FROM sekretariat_admins WHERE identity_issuer = $1 AND identity_subject = $2 AND revoked_at IS NULL",
    [identity.issuer.replace(/\/$/, ""), identity.subject],
  );
  return (result.rowCount ?? 0) > 0;
}

/** An officer of the issuer, or the admin — otherwise 404. */
export function requirePenerbit(peran: Peranku, penerbitId: string): void {
  if (!isUuid(penerbitId)) notFound();
  if (!peran.admin && !peran.penerbitIds.has(penerbitId)) notFound();
}

export interface KotakRow {
  id: string;
  jenis: "yayasan" | "penerbit";
  penerbit_id: string | null;
}

/** Foundation inbox: admin or a disposition holder. Issuer inbox: its officers or the admin. */
export async function requireKotak(db: Db, peran: Peranku, kotakId: string): Promise<KotakRow> {
  if (!isUuid(kotakId)) notFound();
  const row = (await db.query<KotakRow>("SELECT id, jenis, penerbit_id FROM sekretariat_kotak WHERE id = $1", [kotakId])).rows[0];
  if (!row) notFound();
  if (row.jenis === "yayasan") {
    if (!peran.admin && !peran.disposisi) notFound();
  } else if (!peran.admin && !peran.penerbitIds.has(row.penerbit_id!)) {
    notFound();
  }
  return row;
}

/**
 * Resolves an incoming letter to its inbox, then checks the inbox the same way. A disposed
 * foundation-inbox item is also readable by officers of any issuer inbox it was disposed to —
 * the disposition is what moves the work (§7.3).
 */
export async function requireSuratMasuk(db: Db, peran: Peranku, suratMasukId: string): Promise<{ id: string; kotak: KotakRow; status: string }> {
  if (!isUuid(suratMasukId)) notFound();
  const row = (await db.query<{ id: string; status: string; kotak_id: string; jenis: "yayasan" | "penerbit"; penerbit_id: string | null }>(
    `SELECT m.id, m.status, k.id AS kotak_id, k.jenis, k.penerbit_id
     FROM sekretariat_surat_masuk m JOIN sekretariat_kotak k ON k.id = m.kotak_id WHERE m.id = $1`,
    [suratMasukId],
  )).rows[0];
  if (!row) notFound();
  const kotak: KotakRow = { id: row.kotak_id, jenis: row.jenis, penerbit_id: row.penerbit_id };
  const allowedDirectly = peran.admin
    || (kotak.jenis === "yayasan" ? peran.disposisi : kotak.penerbit_id !== null && peran.penerbitIds.has(kotak.penerbit_id));
  if (!allowedDirectly) {
    if (peran.penerbitIds.size === 0) notFound();
    const disposed = await db.query(
      `SELECT 1 FROM sekretariat_disposisi d JOIN sekretariat_kotak k ON k.id = d.ke_kotak_id
       WHERE d.surat_masuk_id = $1 AND k.penerbit_id = ANY($2::uuid[]) LIMIT 1`,
      [suratMasukId, [...peran.penerbitIds]],
    );
    if ((disposed.rowCount ?? 0) === 0) notFound();
  }
  return { id: row.id, kotak, status: row.status };
}
