import { randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { z } from "zod";

import { loadPeran, requirePenerbit, requireSuratMasuk, type Viewer } from "./akses.js";
import type { SekretariatBerkas } from "./berkas.js";
import { SekretariatBuku } from "./buku.js";
import { invalid, isUuid, notFound, SekretariatError, withTransaction, writeAudit } from "./db.js";

/**
 * SEK-IMPL-001 §6: outgoing letters. A draft carries its final PDF; publishing allocates the
 * number (§5) and locks the file — a correction is a void plus a new letter. A reply to an
 * incoming letter is always type 14 and linked both ways (pedoman Pasal 14 ayat 4). A
 * retroactive entry archives an old letter under its original number and never touches the
 * counter (§5 nomor 4).
 */

export const suratCreateSchema = z
  .object({
    jenis_kode: z.string().regex(/^[0-9A-Z][0-9A-Z-]{0,9}$/),
    perihal: z.string().trim().min(3).max(300),
    tujuan: z.string().trim().min(2).max(300),
    penandatangan: z.string().trim().min(2).max(200),
    balasan_atas: z.string().uuid().optional(),
  })
  .strict();

export const retroaktifSchema = z
  .object({
    nomor_asli: z.string().trim().min(3).max(120),
    tanggal_asli: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    jenis_kode: z.string().regex(/^[0-9A-Z][0-9A-Z-]{0,9}$/),
    perihal: z.string().trim().min(3).max(300),
    tujuan: z.string().trim().min(2).max(300),
    penandatangan: z.string().trim().min(2).max(200),
  })
  .strict();

export const suratBatalSchema = z.object({ alasan: z.string().trim().min(10).max(500) }).strict();

interface SuratRow {
  id: string;
  penerbit_id: string;
  jenis_kode: string;
  nomor_id: string | null;
  nomor_lengkap: string | null;
  perihal: string;
  tujuan: string;
  penandatangan: string;
  status: "draf" | "terbit" | "dibatalkan";
  retroaktif: boolean;
  nomor_asli: string | null;
  tanggal_asli: string | null;
  balasan_atas: string | null;
  dibuat_oleh: string;
  dibuat_pada: Date;
  terbit_pada: Date | null;
}

export class SekretariatSurat {
  constructor(
    private readonly pool: Pool,
    private readonly buku: SekretariatBuku,
    private readonly berkas: SekretariatBerkas,
  ) {}

  async create(viewer: Viewer, admin: boolean, penerbitId: string, input: z.infer<typeof suratCreateSchema>) {
    const peran = await loadPeran(this.pool, viewer, admin);
    requirePenerbit(peran, penerbitId);
    const jenis = (await this.pool.query<{ aktif: boolean }>("SELECT aktif FROM sekretariat_jenis WHERE kode = $1", [input.jenis_kode])).rows[0];
    if (!jenis?.aktif) invalid("Kode jenis tidak dikenal atau tidak aktif.", "jenis_tidak_dikenal");
    let jenisKode = input.jenis_kode;
    if (input.balasan_atas) {
      // The reader needs access to the incoming letter it answers; the reply is always code 14.
      await requireSuratMasuk(this.pool, peran, input.balasan_atas);
      if (jenisKode !== "14") jenisKode = "14";
    }
    const id = randomUUID();
    await this.pool.query(
      `INSERT INTO sekretariat_surat_keluar (id, penerbit_id, jenis_kode, perihal, tujuan, penandatangan, balasan_atas, dibuat_oleh)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, penerbitId, jenisKode, input.perihal, input.tujuan, input.penandatangan, input.balasan_atas ?? null, viewer.actor],
    );
    return { id, jenisKode };
  }

  /** The archive entry for an old letter: original number as-is, counter untouched. */
  async retroaktif(viewer: Viewer, admin: boolean, penerbitId: string, input: z.infer<typeof retroaktifSchema>) {
    const peran = await loadPeran(this.pool, viewer, admin);
    requirePenerbit(peran, penerbitId);
    const jenis = (await this.pool.query("SELECT 1 FROM sekretariat_jenis WHERE kode = $1", [input.jenis_kode])).rows[0];
    if (!jenis) invalid("Kode jenis tidak dikenal.", "jenis_tidak_dikenal");
    const id = randomUUID();
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO sekretariat_surat_keluar (id, penerbit_id, jenis_kode, perihal, tujuan, penandatangan, status, retroaktif, nomor_asli, tanggal_asli, dibuat_oleh, terbit_pada)
         VALUES ($1, $2, $3, $4, $5, $6, 'terbit', true, $7, $8, $9, now())`,
        [id, penerbitId, input.jenis_kode, input.perihal, input.tujuan, input.penandatangan, input.nomor_asli, input.tanggal_asli, viewer.actor],
      );
      await writeAudit(client, {
        aktor: viewer.actor, aksi: "surat.retroaktif", objekJenis: "sekretariat_surat_keluar", objekRef: input.nomor_asli,
        metadata: { penerbitId, jenis: input.jenis_kode },
      });
    });
    return { id };
  }

  /**
   * Publishing: the number is allocated only now (§5 nomor 1), and the PDF uploaded to the draft
   * is locked. Without a PDF the letter does not publish.
   */
  async terbitkan(viewer: Viewer, admin: boolean, suratId: string) {
    const peran = await loadPeran(this.pool, viewer, admin);
    const surat = await this.require(peran.admin ? null : [...peran.penerbitIds], suratId);
    if (surat.status !== "draf") throw new SekretariatError(409, "bukan_draf", "Surat ini sudah terbit atau dibatalkan.");
    const files = await this.berkas.listFor(this.pool, "surat_keluar", suratId);
    if (files.length === 0) throw new SekretariatError(409, "berkas_belum_ada", "Unggah PDF final surat sebelum menerbitkannya.");
    return withTransaction(this.pool, async (client) => {
      // Re-read under the transaction so two publishes cannot both allocate.
      const current = (await client.query<{ status: string }>("SELECT status FROM sekretariat_surat_keluar WHERE id = $1 FOR UPDATE", [suratId])).rows[0];
      if (!current || current.status !== "draf") throw new SekretariatError(409, "bukan_draf", "Surat ini sudah terbit atau dibatalkan.");
      const nomor = await this.buku.allocate(client, {
        penerbitId: surat.penerbit_id,
        jenisKode: surat.jenis_kode,
        perihal: surat.perihal,
        tujuan: surat.tujuan,
        aktor: viewer.actor,
        sumber: "sekretariat",
      });
      await client.query(
        "UPDATE sekretariat_surat_keluar SET status = 'terbit', nomor_id = $2, terbit_pada = now() WHERE id = $1",
        [suratId, nomor.id],
      );
      await client.query("UPDATE sekretariat_berkas SET terkunci = true WHERE pemilik_jenis = 'surat_keluar' AND pemilik_id = $1 AND NOT dihapus", [suratId]);
      return { id: suratId, nomor: nomor.nomor, tanggal: nomor.tanggal };
    });
  }

  /** A published letter is voided with its number; a draft is simply removed. */
  async batalkan(viewer: Viewer, admin: boolean, suratId: string, alasan: string) {
    const peran = await loadPeran(this.pool, viewer, admin);
    const surat = await this.require(peran.admin ? null : [...peran.penerbitIds], suratId);
    if (surat.status === "dibatalkan") throw new SekretariatError(409, "sudah_dibatalkan", "Surat ini sudah dibatalkan.");
    if (surat.status === "draf") {
      await withTransaction(this.pool, async (client) => {
        // Soft-delete keeps the rows so the retention job removes the files from disk (§2 "Berkas").
        await client.query(
          "UPDATE sekretariat_berkas SET dihapus = true, dihapus_pada = now() WHERE pemilik_jenis = 'surat_keluar' AND pemilik_id = $1 AND NOT dihapus",
          [suratId],
        );
        await client.query("DELETE FROM sekretariat_surat_keluar WHERE id = $1", [suratId]);
      });
      return { id: suratId, dihapus: true };
    }
    await withTransaction(this.pool, async (client) => {
      if (surat.nomor_id) {
        await client.query(
          `UPDATE sekretariat_nomor SET status = 'dibatalkan', dibatalkan_pada = now(), dibatalkan_oleh = $2, dibatalkan_alasan = $3
           WHERE id = $1 AND status = 'terpakai'`,
          [surat.nomor_id, viewer.actor, alasan],
        );
      }
      await client.query(
        "UPDATE sekretariat_surat_keluar SET status = 'dibatalkan', dibatalkan_pada = now(), dibatalkan_oleh = $2, dibatalkan_alasan = $3 WHERE id = $1",
        [suratId, viewer.actor, alasan],
      );
      await writeAudit(client, {
        aktor: viewer.actor, aksi: "surat.batal", objekJenis: "sekretariat_surat_keluar",
        objekRef: surat.nomor_lengkap ?? surat.nomor_asli ?? suratId, alasan,
      });
    });
    return { id: suratId, dihapus: false };
  }

  async list(viewer: Viewer, admin: boolean, penerbitId: string, page: number) {
    const peran = await loadPeran(this.pool, viewer, admin);
    requirePenerbit(peran, penerbitId);
    const total = Number((await this.pool.query<{ c: string }>(
      "SELECT count(*) AS c FROM sekretariat_surat_keluar WHERE penerbit_id = $1", [penerbitId],
    )).rows[0]!.c);
    const rows = await this.pool.query<SuratRow>(
      `SELECT s.id, s.penerbit_id, s.jenis_kode, s.nomor_id, n.nomor_lengkap, s.perihal, s.tujuan, s.penandatangan, s.status,
              s.retroaktif, s.nomor_asli, to_char(s.tanggal_asli, 'YYYY-MM-DD') AS tanggal_asli, s.balasan_atas, s.dibuat_oleh, s.dibuat_pada, s.terbit_pada
       FROM sekretariat_surat_keluar s LEFT JOIN sekretariat_nomor n ON n.id = s.nomor_id
       WHERE s.penerbit_id = $1 ORDER BY s.dibuat_pada DESC, s.id LIMIT 25 OFFSET $2`,
      [penerbitId, (page - 1) * 25],
    );
    return { items: rows.rows.map(view), total, page, pageSize: 25 };
  }

  async detail(viewer: Viewer, admin: boolean, suratId: string) {
    const peran = await loadPeran(this.pool, viewer, admin);
    const surat = await this.require(peran.admin ? null : [...peran.penerbitIds], suratId);
    return { ...view(surat), berkas: await this.berkas.listFor(this.pool, "surat_keluar", suratId) };
  }

  /** The letter's final PDF: only onto a draft; a published letter's file is locked. */
  async authorizeUpload(viewer: Viewer, admin: boolean, suratId: string): Promise<void> {
    const peran = await loadPeran(this.pool, viewer, admin);
    const surat = await this.require(peran.admin ? null : [...peran.penerbitIds], suratId);
    if (surat.status === "terbit" && !surat.retroaktif) {
      throw new SekretariatError(409, "berkas_terkunci", "Surat sudah terbit; arsipnya terkunci. Batalkan dan buat surat baru untuk koreksi.");
    }
    if (surat.status === "dibatalkan") throw new SekretariatError(409, "sudah_dibatalkan", "Surat ini sudah dibatalkan.");
  }

  async authorizeRead(viewer: Viewer, admin: boolean, suratId: string): Promise<void> {
    const peran = await loadPeran(this.pool, viewer, admin);
    await this.require(peran.admin ? null : [...peran.penerbitIds], suratId);
  }

  private async require(scope: string[] | null, suratId: string): Promise<SuratRow> {
    if (!isUuid(suratId)) notFound();
    const row = (await this.pool.query<SuratRow>(
      `SELECT s.id, s.penerbit_id, s.jenis_kode, s.nomor_id, n.nomor_lengkap, s.perihal, s.tujuan, s.penandatangan, s.status,
              s.retroaktif, s.nomor_asli, to_char(s.tanggal_asli, 'YYYY-MM-DD') AS tanggal_asli, s.balasan_atas, s.dibuat_oleh, s.dibuat_pada, s.terbit_pada
       FROM sekretariat_surat_keluar s LEFT JOIN sekretariat_nomor n ON n.id = s.nomor_id WHERE s.id = $1`,
      [suratId],
    )).rows[0];
    if (!row) notFound();
    if (scope !== null && !scope.includes(row.penerbit_id)) notFound();
    return row;
  }
}

function view(row: SuratRow & { nomor_lengkap?: string | null }) {
  return {
    id: row.id,
    penerbitId: row.penerbit_id,
    jenisKode: row.jenis_kode,
    nomor: row.retroaktif ? row.nomor_asli : (row.nomor_lengkap ?? null),
    perihal: row.perihal,
    tujuan: row.tujuan,
    penandatangan: row.penandatangan,
    status: row.status,
    retroaktif: row.retroaktif,
    tanggalAsli: row.tanggal_asli,
    balasanAtas: row.balasan_atas,
    dibuatPada: row.dibuat_pada instanceof Date ? row.dibuat_pada.toISOString() : row.dibuat_pada,
    terbitPada: row.terbit_pada instanceof Date ? row.terbit_pada.toISOString() : row.terbit_pada,
  };
}
