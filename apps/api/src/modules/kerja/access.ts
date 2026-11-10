import { KerjaError, notFound, forbidden, type Db } from "./db.js";

/** The signed-in person inside Kerja. `actor` is what history and audit rows record. */
export interface Viewer {
  personId: string;
  actor: string;
  nama: string;
}

export type Peran = "pj" | "anggota" | "peninjau";
/** KERJA-IMPL-001 §7.3: read (all roles), work (pj, anggota), manage (pj). */
export type Tingkat = "baca" | "kerja" | "kelola";

export interface RuangAkses {
  ruangId: string;
  peran: Peran;
  status: "aktif" | "arsip";
  jenis: "tetap" | "panitia";
}

const ALLOWED: Record<Tingkat, Peran[]> = {
  baca: ["pj", "anggota", "peninjau"],
  kerja: ["pj", "anggota"],
  kelola: ["pj"],
};

/**
 * Not a member → 404, so a room's existence never leaks through a status code (§7.3, §10 nomor 1).
 * A member whose role is too low → 403. Writing into an archived room → 409.
 */
export async function requireRoom(db: Db, ruangId: string, viewer: Viewer, tingkat: Tingkat): Promise<RuangAkses> {
  if (!isUuid(ruangId)) notFound();
  const result = await db.query<{ peran: Peran; status: "aktif" | "arsip"; jenis: "tetap" | "panitia" }>(
    `SELECT a.peran, r.status, r.jenis FROM kerja_ruang r JOIN kerja_ruang_anggota a ON a.ruang_id = r.id
     WHERE r.id = $1 AND a.person_id = $2`,
    [ruangId, viewer.personId],
  );
  const row = result.rows[0];
  if (!row) notFound();
  if (!ALLOWED[tingkat].includes(row.peran)) forbidden();
  if (tingkat !== "baca" && row.status === "arsip") {
    throw new KerjaError(409, "ruang_diarsipkan", "Ruang ini sudah diarsipkan; isinya hanya bisa dibaca.");
  }
  return { ruangId, peran: row.peran, status: row.status, jenis: row.jenis };
}

/** Resolves any object to its room through its parents, then checks the role. */
export async function requireVia(
  db: Db,
  jenis: "papan" | "kolom" | "kartu" | "label" | "ceklis" | "item" | "komentar" | "lampiran",
  id: string,
  viewer: Viewer,
  tingkat: Tingkat,
): Promise<RuangAkses> {
  if (!isUuid(id)) notFound();
  const sql: Record<typeof jenis, string> = {
    papan: "SELECT ruang_id FROM kerja_papan WHERE id = $1",
    kolom: "SELECT p.ruang_id FROM kerja_kolom k JOIN kerja_papan p ON p.id = k.papan_id WHERE k.id = $1 AND NOT k.dihapus",
    kartu: "SELECT ruang_id FROM kerja_kartu WHERE id = $1",
    label: "SELECT p.ruang_id FROM kerja_label l JOIN kerja_papan p ON p.id = l.papan_id WHERE l.id = $1 AND NOT l.dihapus",
    ceklis: "SELECT k.ruang_id FROM kerja_ceklis c JOIN kerja_kartu k ON k.id = c.kartu_id WHERE c.id = $1 AND NOT c.dihapus",
    item: `SELECT k.ruang_id FROM kerja_ceklis_item i JOIN kerja_ceklis c ON c.id = i.ceklis_id JOIN kerja_kartu k ON k.id = c.kartu_id
           WHERE i.id = $1 AND NOT i.dihapus AND NOT c.dihapus`,
    komentar: "SELECT k.ruang_id FROM kerja_komentar c JOIN kerja_kartu k ON k.id = c.kartu_id WHERE c.id = $1",
    lampiran: "SELECT ruang_id FROM kerja_lampiran WHERE id = $1 AND NOT dihapus",
  };
  const result = await db.query<{ ruang_id: string }>(sql[jenis], [id]);
  const ruangId = result.rows[0]?.ruang_id;
  if (!ruangId) notFound();
  return requireRoom(db, ruangId, viewer, tingkat);
}

/** Card writes also stop on an archived card: it can only be restored. */
export async function requireCardWritable(db: Db, kartuId: string): Promise<void> {
  const result = await db.query<{ arsip: boolean }>("SELECT arsip FROM kerja_kartu WHERE id = $1", [kartuId]);
  if (result.rows[0]?.arsip) throw new KerjaError(409, "kartu_diarsipkan", "Kartu ini diarsipkan. Pulihkan dulu untuk mengubahnya.");
}

export async function roomMembers(db: Db, ruangId: string): Promise<Map<string, Peran>> {
  const result = await db.query<{ person_id: string; peran: Peran }>("SELECT person_id, peran FROM kerja_ruang_anggota WHERE ruang_id = $1", [ruangId]);
  return new Map(result.rows.map((row) => [row.person_id, row.peran]));
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
