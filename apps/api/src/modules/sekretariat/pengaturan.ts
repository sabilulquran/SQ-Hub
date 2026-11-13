import { randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { z } from "zod";

import { invalid, isUuid, notFound, SekretariatError, withTransaction, writeAudit } from "./db.js";

/**
 * SEK-IMPL-001 §8–§9 Pengaturan: issuer catalog (fixed codes from the pedoman; committees created
 * here with a mandatory end date), officers (hak ambil nomor per person per issuer), and
 * disposition holders. Every change writes sekretariat_audit with a mandatory reason.
 */

export const panitiaSchema = z
  .object({
    kode: z.string().regex(/^(PAN|TIM|SATGAS)\.[A-Z0-9][A-Z0-9-]{1,20}$/),
    nama: z.string().trim().min(3).max(120),
    berakhir_pada: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    alasan: z.string().trim().min(1).max(500),
  })
  .strict();

export const penerbitPatchSchema = z
  .object({
    aktif: z.boolean().optional(),
    berakhir_pada: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    unit_id: z.string().regex(/^hcis:org-node:[0-9a-f-]{36}$/).nullable().optional(),
    alasan: z.string().trim().min(1).max(500),
  })
  .strict();

export const petugasSchema = z
  .object({
    penerbit_id: z.string().uuid(),
    person_id: z.string().regex(/^hcis:employee:[0-9a-f-]{36}$/),
    alasan: z.string().trim().min(1).max(500),
  })
  .strict();

export const pemegangSchema = z
  .object({
    person_id: z.string().regex(/^hcis:employee:[0-9a-f-]{36}$/),
    alasan: z.string().trim().min(1).max(500),
  })
  .strict();

export const cabutSchema = z.object({ alasan: z.string().trim().min(1).max(500) }).strict();

export class SekretariatPengaturan {
  constructor(private readonly pool: Pool) {}

  async penerbitList() {
    const rows = await this.pool.query<{
      id: string; kode: string; nama: string; kelompok: string; unit_id: string | null; berakhir_pada: string | null; aktif: boolean; petugas: string;
    }>(
      `SELECT p.id, p.kode, p.nama, p.kelompok, p.unit_id, to_char(p.berakhir_pada, 'YYYY-MM-DD') AS berakhir_pada, p.aktif,
              (SELECT count(*) FROM sekretariat_petugas t WHERE t.penerbit_id = p.id AND t.dicabut_pada IS NULL) AS petugas
       FROM sekretariat_penerbit p ORDER BY p.aktif DESC, p.kelompok, p.kode`,
    );
    return {
      items: rows.rows.map((row) => ({
        id: row.id, kode: row.kode, nama: row.nama, kelompok: row.kelompok, unitId: row.unit_id,
        berakhirPada: row.berakhir_pada, aktif: row.aktif, petugasAktif: Number(row.petugas),
      })),
    };
  }

  /** The active issuer catalog for every signed-in user: id, code and name only (§9 dropdowns). */
  async penerbitAktif() {
    const rows = await this.pool.query<{ id: string; kode: string; nama: string; kelompok: string }>(
      "SELECT id, kode, nama, kelompok FROM sekretariat_penerbit WHERE aktif ORDER BY kelompok, kode",
    );
    return { items: rows.rows.map((row) => ({ id: row.id, kode: row.kode, nama: row.nama, kelompok: row.kelompok })) };
  }

  /** Pedoman Pasal 13 ayat (7): committee issuers carry PAN./TIM./SATGAS. aliases and an end date. */
  async buatPanitia(aktor: string, input: z.infer<typeof panitiaSchema>) {
    const id = randomUUID();
    return withTransaction(this.pool, async (client) => {
      const existing = await client.query("SELECT 1 FROM sekretariat_penerbit WHERE kode = $1", [input.kode]);
      if ((existing.rowCount ?? 0) > 0) throw new SekretariatError(409, "kode_terpakai", "Kode penerbit itu sudah ada.");
      await client.query(
        `INSERT INTO sekretariat_penerbit (id, kode, nama, kelompok, berakhir_pada, dibuat_oleh) VALUES ($1, $2, $3, 'panitia', $4, $5)`,
        [id, input.kode, input.nama, input.berakhir_pada, aktor],
      );
      await client.query("INSERT INTO sekretariat_kotak (id, jenis, penerbit_id) VALUES ($1, 'penerbit', $2)", [randomUUID(), id]);
      await writeAudit(client, { aktor, aksi: "penerbit.buat", objekJenis: "sekretariat_penerbit", objekRef: input.kode, alasan: input.alasan });
      return { id, kode: input.kode };
    });
  }

  /** Codes never change (Keputusan Pengurus takes a new issuer); activity, end date and the Directory link do. */
  async ubahPenerbit(aktor: string, penerbitId: string, input: z.infer<typeof penerbitPatchSchema>) {
    if (!isUuid(penerbitId)) notFound();
    if (input.aktif === undefined && input.berakhir_pada === undefined && input.unit_id === undefined) invalid("Tidak ada yang diubah.");
    return withTransaction(this.pool, async (client) => {
      const row = (await client.query<{ kode: string; kelompok: string }>("SELECT kode, kelompok FROM sekretariat_penerbit WHERE id = $1 FOR UPDATE", [penerbitId])).rows[0];
      if (!row) notFound();
      if (input.berakhir_pada !== undefined && row.kelompok !== "panitia") {
        invalid("Masa berlaku hanya untuk penerbit panitia/tim/satgas.", "bukan_panitia");
      }
      await client.query(
        `UPDATE sekretariat_penerbit SET
           aktif = COALESCE($2, aktif),
           berakhir_pada = COALESCE($3, berakhir_pada),
           unit_id = CASE WHEN $4 THEN $5 ELSE unit_id END
         WHERE id = $1`,
        [penerbitId, input.aktif ?? null, input.berakhir_pada ?? null, input.unit_id !== undefined, input.unit_id ?? null],
      );
      await writeAudit(client, {
        aktor, aksi: "penerbit.ubah", objekJenis: "sekretariat_penerbit", objekRef: row.kode, alasan: input.alasan,
        metadata: { aktif: input.aktif, berakhirPada: input.berakhir_pada },
      });
      return { id: penerbitId };
    });
  }

  async petugasList() {
    const rows = await this.pool.query<{ id: string; penerbit_id: string; kode: string; person_id: string; alasan: string; diberikan_pada: Date }>(
      `SELECT t.id, t.penerbit_id, p.kode, t.person_id, t.alasan, t.diberikan_pada
       FROM sekretariat_petugas t JOIN sekretariat_penerbit p ON p.id = t.penerbit_id
       WHERE t.dicabut_pada IS NULL ORDER BY p.kode, t.diberikan_pada`,
    );
    return { items: rows.rows.map((row) => ({ id: row.id, penerbitId: row.penerbit_id, penerbitKode: row.kode, personId: row.person_id, alasan: row.alasan, diberikanPada: row.diberikan_pada.toISOString() })) };
  }

  async tambahPetugas(aktor: string, input: z.infer<typeof petugasSchema>) {
    return withTransaction(this.pool, async (client) => {
      const penerbit = (await client.query<{ kode: string }>("SELECT kode FROM sekretariat_penerbit WHERE id = $1 AND aktif", [input.penerbit_id])).rows[0];
      if (!penerbit) invalid("Penerbit tidak dikenal atau nonaktif.", "penerbit_tidak_dikenal");
      const existing = await client.query(
        "SELECT 1 FROM sekretariat_petugas WHERE penerbit_id = $1 AND person_id = $2 AND dicabut_pada IS NULL",
        [input.penerbit_id, input.person_id],
      );
      if ((existing.rowCount ?? 0) > 0) throw new SekretariatError(409, "petugas_sudah_ada", "Orang ini sudah menjadi petugas penerbit itu.");
      const id = randomUUID();
      await client.query(
        "INSERT INTO sekretariat_petugas (id, penerbit_id, person_id, alasan, diberikan_oleh) VALUES ($1, $2, $3, $4, $5)",
        [id, input.penerbit_id, input.person_id, input.alasan, aktor],
      );
      await writeAudit(client, {
        aktor, aksi: "petugas.tambah", objekJenis: "sekretariat_petugas", objekRef: `${penerbit.kode}#${input.person_id}`, alasan: input.alasan,
      });
      return { id };
    });
  }

  async cabutPetugas(aktor: string, petugasId: string, alasan: string) {
    if (!isUuid(petugasId)) notFound();
    return withTransaction(this.pool, async (client) => {
      const row = (await client.query<{ penerbit_id: string; person_id: string }>(
        "UPDATE sekretariat_petugas SET dicabut_pada = now(), dicabut_oleh = $2 WHERE id = $1 AND dicabut_pada IS NULL RETURNING penerbit_id, person_id",
        [petugasId, aktor],
      )).rows[0];
      if (!row) notFound();
      await writeAudit(client, { aktor, aksi: "petugas.cabut", objekJenis: "sekretariat_petugas", objekRef: `${row.penerbit_id}#${row.person_id}`, alasan });
      return { id: petugasId };
    });
  }

  async pemegangDisposisiList() {
    const rows = await this.pool.query<{ id: string; person_id: string; alasan: string; diberikan_pada: Date }>(
      "SELECT id, person_id, alasan, diberikan_pada FROM sekretariat_disposisi_pemegang WHERE dicabut_pada IS NULL ORDER BY diberikan_pada",
    );
    return { items: rows.rows.map((row) => ({ id: row.id, personId: row.person_id, alasan: row.alasan, diberikanPada: row.diberikan_pada.toISOString() })) };
  }

  /** D-4: the Direktur by default; delegation is an explicit, reasoned admin action. */
  async tambahPemegangDisposisi(aktor: string, input: z.infer<typeof pemegangSchema>) {
    return withTransaction(this.pool, async (client) => {
      const existing = await client.query("SELECT 1 FROM sekretariat_disposisi_pemegang WHERE person_id = $1 AND dicabut_pada IS NULL", [input.person_id]);
      if ((existing.rowCount ?? 0) > 0) throw new SekretariatError(409, "pemegang_sudah_ada", "Orang ini sudah memegang disposisi.");
      const id = randomUUID();
      await client.query(
        "INSERT INTO sekretariat_disposisi_pemegang (id, person_id, alasan, diberikan_oleh) VALUES ($1, $2, $3, $4)",
        [id, input.person_id, input.alasan, aktor],
      );
      await writeAudit(client, { aktor, aksi: "disposisi_pemegang.tambah", objekJenis: "sekretariat_disposisi_pemegang", objekRef: input.person_id, alasan: input.alasan });
      return { id };
    });
  }

  async cabutPemegangDisposisi(aktor: string, pemegangId: string, alasan: string) {
    if (!isUuid(pemegangId)) notFound();
    return withTransaction(this.pool, async (client) => {
      const row = (await client.query<{ person_id: string }>(
        "UPDATE sekretariat_disposisi_pemegang SET dicabut_pada = now(), dicabut_oleh = $2 WHERE id = $1 AND dicabut_pada IS NULL RETURNING person_id",
        [pemegangId, aktor],
      )).rows[0];
      if (!row) notFound();
      await writeAudit(client, { aktor, aksi: "disposisi_pemegang.cabut", objekJenis: "sekretariat_disposisi_pemegang", objekRef: row.person_id, alasan });
      return { id: pemegangId };
    });
  }
}
