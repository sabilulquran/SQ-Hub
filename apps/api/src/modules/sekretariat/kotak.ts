import { randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { z } from "zod";

import { loadPeran, requireKotak, requireSuratMasuk, type Viewer } from "./akses.js";
import type { SekretariatBerkas } from "./berkas.js";
import { invalid, notFound, SekretariatError, withTransaction, writeAudit } from "./db.js";

/**
 * SEK-IMPL-001 §7: the inbox. E-mail arrives through the fetcher into the foundation inbox;
 * scanned physical letters are registered by officers. Disposition forwards foundation-inbox
 * items into an issuer's inbox with a note and a deadline; it never carries a letter number
 * (pedoman Pasal 13 ayat 6). Spam is a manual mark, never automatic (D-6: kept, reviewed in a year).
 */

export const fisikSchema = z
  .object({
    dari: z.string().trim().min(1).max(300),
    perihal: z.string().trim().min(1).max(500),
    isi_teks: z.string().max(10_000).default(""),
  })
  .strict();

export const disposisiSchema = z
  .object({
    ke_penerbit_id: z.string().uuid(),
    catatan: z.string().trim().min(1).max(1000),
    tenggat_pada: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .strict();

export const selesaiSchema = z.object({ keterangan: z.string().trim().min(1).max(1000) }).strict();

export class SekretariatKotak {
  constructor(
    private readonly pool: Pool,
    private readonly berkas: SekretariatBerkas,
  ) {}

  /** The inboxes the viewer may open, with open counts. */
  async list(viewer: Viewer, admin: boolean) {
    const peran = await loadPeran(this.pool, viewer, admin);
    const rows = await this.pool.query<{ id: string; jenis: string; penerbit_id: string | null; kode: string | null; nama: string | null; baru: string; disposisi_terbuka: string }>(
      `SELECT k.id, k.jenis, k.penerbit_id, p.kode, p.nama,
              (SELECT count(*) FROM sekretariat_surat_masuk m WHERE m.kotak_id = k.id AND m.status = 'baru') AS baru,
              (SELECT count(*) FROM sekretariat_disposisi d WHERE d.ke_kotak_id = k.id AND d.selesai_pada IS NULL) AS disposisi_terbuka
       FROM sekretariat_kotak k LEFT JOIN sekretariat_penerbit p ON p.id = k.penerbit_id
       WHERE (p.id IS NULL OR p.aktif) ORDER BY k.jenis DESC, p.kode`,
    );
    const items = rows.rows
      .filter((row) => (row.jenis === "yayasan" ? peran.admin || peran.disposisi : peran.admin || (row.penerbit_id !== null && peran.penerbitIds.has(row.penerbit_id))))
      .map((row) => ({
        id: row.id,
        jenis: row.jenis,
        penerbit: row.penerbit_id ? { id: row.penerbit_id, kode: row.kode, nama: row.nama } : null,
        baru: Number(row.baru),
        disposisiTerbuka: Number(row.disposisi_terbuka),
      }));
    return { items, peran: { admin: peran.admin, disposisi: peran.disposisi, penerbitIds: [...peran.penerbitIds] } };
  }

  /**
   * One inbox's contents: its own letters, and — for an issuer inbox — items disposed to it from
   * the foundation inbox.
   */
  async isi(viewer: Viewer, admin: boolean, kotakId: string, status: string | undefined, page: number) {
    const peran = await loadPeran(this.pool, viewer, admin);
    const kotak = await requireKotak(this.pool, peran, kotakId);
    const statusFilter = status && ["baru", "didisposisi", "selesai", "spam"].includes(status) ? status : null;
    const params: unknown[] = [kotakId];
    let where = "m.kotak_id = $1";
    if (kotak.jenis === "penerbit") {
      where = "(m.kotak_id = $1 OR EXISTS (SELECT 1 FROM sekretariat_disposisi d WHERE d.surat_masuk_id = m.id AND d.ke_kotak_id = $1))";
    }
    if (statusFilter) {
      params.push(statusFilter);
      where += ` AND m.status = $${params.length}`;
    } else if (kotak.jenis === "yayasan") {
      where += " AND m.status <> 'spam'";
    }
    const total = Number((await this.pool.query<{ c: string }>(`SELECT count(*) AS c FROM sekretariat_surat_masuk m WHERE ${where}`, params)).rows[0]!.c);
    params.push((page - 1) * 25);
    const rows = await this.pool.query<{ id: string; kanal: string; dari: string; perihal: string; diterima_pada: Date; status: string }>(
      `SELECT m.id, m.kanal, m.dari, m.perihal, m.diterima_pada, m.status FROM sekretariat_surat_masuk m
       WHERE ${where} ORDER BY m.diterima_pada DESC, m.id LIMIT 25 OFFSET $${params.length}`,
      params,
    );
    return {
      kotak: { id: kotak.id, jenis: kotak.jenis },
      items: rows.rows.map((row) => ({
        id: row.id, kanal: row.kanal, dari: row.dari, perihal: row.perihal, diterimaPada: row.diterima_pada.toISOString(), status: row.status,
      })),
      total,
      page,
      pageSize: 25,
    };
  }

  /** A scanned physical letter, straight into the inbox the registrar may write to (§7 nomor 2). */
  async catatFisik(viewer: Viewer, admin: boolean, kotakId: string, input: z.infer<typeof fisikSchema>) {
    const peran = await loadPeran(this.pool, viewer, admin);
    await requireKotak(this.pool, peran, kotakId);
    const id = randomUUID();
    await this.pool.query(
      `INSERT INTO sekretariat_surat_masuk (id, kotak_id, kanal, dari, perihal, isi_teks, dicatat_oleh)
       VALUES ($1, $2, 'fisik', $3, $4, $5, $6)`,
      [id, kotakId, input.dari, input.perihal, input.isi_teks, viewer.actor],
    );
    return { id };
  }

  async detail(viewer: Viewer, admin: boolean, suratMasukId: string) {
    const peran = await loadPeran(this.pool, viewer, admin);
    const akses = await requireSuratMasuk(this.pool, peran, suratMasukId);
    const row = (await this.pool.query<{
      id: string; kanal: string; dari: string; perihal: string; isi_teks: string; diterima_pada: Date; status: string; dicatat_oleh: string | null;
    }>(
      "SELECT id, kanal, dari, perihal, isi_teks, diterima_pada, status, dicatat_oleh FROM sekretariat_surat_masuk WHERE id = $1",
      [suratMasukId],
    )).rows[0]!;
    const disposisi = await this.pool.query<{
      id: string; catatan: string; tenggat_pada: string | null; oleh: string; pada: Date; selesai_pada: Date | null; selesai_keterangan: string | null;
      kode: string | null; nama: string | null;
    }>(
      `SELECT d.id, d.catatan, to_char(d.tenggat_pada, 'YYYY-MM-DD') AS tenggat_pada, d.oleh, d.pada, d.selesai_pada, d.selesai_keterangan, p.kode, p.nama
       FROM sekretariat_disposisi d JOIN sekretariat_kotak k ON k.id = d.ke_kotak_id LEFT JOIN sekretariat_penerbit p ON p.id = k.penerbit_id
       WHERE d.surat_masuk_id = $1 ORDER BY d.pada`,
      [suratMasukId],
    );
    const balasan = await this.pool.query<{ id: string; status: string; nomor_lengkap: string | null }>(
      `SELECT s.id, s.status, n.nomor_lengkap FROM sekretariat_surat_keluar s LEFT JOIN sekretariat_nomor n ON n.id = s.nomor_id
       WHERE s.balasan_atas = $1 ORDER BY s.dibuat_pada`,
      [suratMasukId],
    );
    return {
      id: row.id,
      kotak: akses.kotak,
      kanal: row.kanal,
      dari: row.dari,
      perihal: row.perihal,
      isiTeks: row.isi_teks,
      diterimaPada: row.diterima_pada.toISOString(),
      status: row.status,
      dicatatOleh: row.dicatat_oleh,
      berkas: await this.berkas.listFor(this.pool, "surat_masuk", suratMasukId),
      disposisi: disposisi.rows.map((item) => ({
        id: item.id, catatan: item.catatan, tenggatPada: item.tenggat_pada, oleh: item.oleh, pada: item.pada.toISOString(),
        selesaiPada: item.selesai_pada?.toISOString() ?? null, selesaiKeterangan: item.selesai_keterangan,
        kePenerbit: item.kode ? { kode: item.kode, nama: item.nama } : null,
      })),
      balasan: balasan.rows.map((item) => ({ id: item.id, status: item.status, nomor: item.nomor_lengkap })),
    };
  }

  /** Foundation-inbox items only; the holder forwards them into an issuer inbox (§7 nomor 3). */
  async disposisi(viewer: Viewer, admin: boolean, suratMasukId: string, input: z.infer<typeof disposisiSchema>) {
    const peran = await loadPeran(this.pool, viewer, admin);
    if (!peran.admin && !peran.disposisi) notFound();
    const akses = await requireSuratMasuk(this.pool, peran, suratMasukId);
    if (akses.kotak.jenis !== "yayasan") invalid("Disposisi hanya untuk isi kotak yayasan.", "bukan_kotak_yayasan");
    if (akses.status === "spam") throw new SekretariatError(409, "surat_spam", "Surat bertanda spam tidak didisposisi.");
    const target = (await this.pool.query<{ id: string }>(
      "SELECT k.id FROM sekretariat_kotak k JOIN sekretariat_penerbit p ON p.id = k.penerbit_id WHERE p.id = $1 AND p.aktif",
      [input.ke_penerbit_id],
    )).rows[0];
    if (!target) invalid("Penerbit tujuan tidak dikenal atau nonaktif.", "penerbit_tidak_dikenal");
    const id = randomUUID();
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO sekretariat_disposisi (id, surat_masuk_id, ke_kotak_id, catatan, tenggat_pada, oleh) VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, suratMasukId, target.id, input.catatan, input.tenggat_pada ?? null, viewer.actor],
      );
      await client.query("UPDATE sekretariat_surat_masuk SET status = 'didisposisi' WHERE id = $1 AND status = 'baru'", [suratMasukId]);
      await writeAudit(client, {
        aktor: viewer.actor, aksi: "surat_masuk.disposisi", objekJenis: "sekretariat_surat_masuk", objekRef: suratMasukId,
        metadata: { kePenerbit: input.ke_penerbit_id },
      });
    });
    return { id };
  }

  /** The receiving issuer closes its disposition with a note; the last one closes the letter. */
  async selesai(viewer: Viewer, admin: boolean, disposisiId: string, keterangan: string) {
    const peran = await loadPeran(this.pool, viewer, admin);
    const row = (await this.pool.query<{ id: string; surat_masuk_id: string; penerbit_id: string | null; selesai_pada: Date | null }>(
      `SELECT d.id, d.surat_masuk_id, k.penerbit_id, d.selesai_pada FROM sekretariat_disposisi d JOIN sekretariat_kotak k ON k.id = d.ke_kotak_id
       WHERE d.id = $1`,
      [disposisiId],
    )).rows[0];
    if (!row) notFound();
    if (!peran.admin && (row.penerbit_id === null || !peran.penerbitIds.has(row.penerbit_id))) notFound();
    if (row.selesai_pada) throw new SekretariatError(409, "sudah_selesai", "Disposisi ini sudah ditandai selesai.");
    await withTransaction(this.pool, async (client) => {
      await client.query(
        "UPDATE sekretariat_disposisi SET selesai_pada = now(), selesai_oleh = $2, selesai_keterangan = $3 WHERE id = $1",
        [disposisiId, viewer.actor, keterangan],
      );
      await client.query(
        `UPDATE sekretariat_surat_masuk SET status = 'selesai'
         WHERE id = $1 AND status = 'didisposisi'
           AND NOT EXISTS (SELECT 1 FROM sekretariat_disposisi d WHERE d.surat_masuk_id = $1 AND d.selesai_pada IS NULL)`,
        [row.surat_masuk_id],
      );
    });
    return { id: disposisiId };
  }

  /** A manual mark on a foundation-inbox item (§7 nomor 4); the row is kept (D-6). */
  async tandaiSpam(viewer: Viewer, admin: boolean, suratMasukId: string) {
    const peran = await loadPeran(this.pool, viewer, admin);
    if (!peran.admin && !peran.disposisi) notFound();
    const akses = await requireSuratMasuk(this.pool, peran, suratMasukId);
    if (akses.kotak.jenis !== "yayasan") invalid("Tanda spam hanya untuk kotak yayasan.", "bukan_kotak_yayasan");
    if (akses.status !== "baru") throw new SekretariatError(409, "sudah_ditindak", "Hanya surat berstatus baru yang bisa ditandai spam.");
    await this.pool.query("UPDATE sekretariat_surat_masuk SET status = 'spam' WHERE id = $1", [suratMasukId]);
    return { id: suratMasukId };
  }

  /** Upload authorization for a scan onto an incoming letter the viewer can already open. */
  async authorizeUpload(viewer: Viewer, admin: boolean, suratMasukId: string): Promise<void> {
    const peran = await loadPeran(this.pool, viewer, admin);
    await requireSuratMasuk(this.pool, peran, suratMasukId);
  }

  async authorizeRead(viewer: Viewer, admin: boolean, suratMasukId: string): Promise<void> {
    const peran = await loadPeran(this.pool, viewer, admin);
    await requireSuratMasuk(this.pool, peran, suratMasukId);
  }
}
