import type { Pool } from "pg";
import { z } from "zod";

import { loadPeran, requirePenerbit, requireSuratMasuk, type Peranku, type Viewer } from "./akses.js";
import { jakartaParts } from "./buku.js";
import { invalid, isUuid, notFound, SekretariatError, withTransaction, writeAudit } from "./db.js";
import { namaBerkasDocx, renderDocx } from "./docx.js";
import {
  bagianKosong, jenisDidukung, KUNCI_BAGIAN, memuatNomor, rakitNaskah,
  type Bagian, type JenisDidukung, type KunciBagian,
} from "./naskah.js";
import { PenyusunError, type MasukanAsisten, type Penyusun, type Pertanyaan } from "./penyusun.js";

/**
 * SEK-IMPL-004: the Asisten Surat service. It sits on top of the draft that SEK-IMPL-001 already
 * creates and never calls the letter-number book: a number is still allocated only by
 * `POST /surat/:id/terbit`.
 */

const MAKS_KUTIPAN = 3;
const MAKS_PANJANG_KUTIPAN = 2000;
const MAKS_TOTAL_KUTIPAN = 4000;
/** §6.5 nomor 5: four model calls per draft, then the staff member writes it by hand. */
export const MAKS_PUTARAN = 4;

export const kutipanSchema = z
  .object({
    surat_masuk_id: z.string().uuid(),
    awal: z.number().int().min(0).max(10_000_000),
    panjang: z.number().int().min(1).max(MAKS_PANJANG_KUTIPAN),
  })
  .strict();

const konteksDasar = {
  penjelasan: z.string().trim().min(10).max(4000),
  kutipan: z.array(kutipanSchema).max(MAKS_KUTIPAN).default([]),
};

export const tanyaSchema = z.object(konteksDasar).strict();

export const susunSchema = z
  .object({
    ...konteksDasar,
    jawaban: z
      .array(z.object({ kunci: z.string().trim().min(1).max(40), nilai: z.string().trim().max(2000) }).strict())
      .max(12)
      .default([]),
  })
  .strict();

export const isiSchema = z
  .object({
    bagian: z
      .object(Object.fromEntries(KUNCI_BAGIAN.map((kunci) => [kunci, z.string().trim().max(4000)])) as Record<KunciBagian, z.ZodString>)
      .partial()
      .strict(),
  })
  .strict();

interface DrafRow {
  id: string;
  penerbit_id: string;
  penerbit_kode: string;
  penerbit_nama: string;
  jenis_kode: string;
  perihal: string;
  tujuan: string;
  penandatangan: string;
  status: string;
}

interface IsiRow {
  bagian: Bagian;
  konteks: Konteks;
  sumber: "asisten" | "manual";
  disunting: boolean;
  putaran: number;
  jenis_kode: string;
}

interface Konteks {
  penjelasan?: string;
  jawaban?: Array<{ kunci: string; nilai: string }>;
  kutipan?: Array<{ surat_masuk_id: string; awal: number; panjang: number; teks: string }>;
}

export interface AsistenConfig {
  enabled: boolean;
  maksPanggilanBulan: number;
}

export class SekretariatAsisten {
  constructor(
    private readonly pool: Pool,
    private readonly penyusun: Penyusun,
    private readonly config: AsistenConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get tersedia(): boolean {
    return this.config.enabled;
  }

  /** The types the screen may offer; the button stays hidden for anything else (§9). */
  jenisDidukung(kode: string): JenisDidukung | null {
    return jenisDidukung(kode);
  }

  async tanya(viewer: Viewer, admin: boolean, suratId: string, input: z.infer<typeof tanyaSchema>) {
    const { draf, jenis, peran } = await this.siapkan(viewer, admin, suratId);
    const kutipan = await this.ambilKutipan(peran, input.kutipan);
    const tersimpan = await this.bacaIsi(suratId);
    await this.jagaPutaran(tersimpan?.putaran ?? 0);
    const masukan = this.masukan(draf, jenis, input.penjelasan, tersimpan?.konteks.jawaban ?? [], kutipan.map((item) => item.teks));
    const hasil = await this.jalankan(viewer, draf, jenis, "tanya", () => this.penyusun.tanya(masukan));
    await this.simpanKonteks(viewer, suratId, draf.jenis_kode, { penjelasan: input.penjelasan, kutipan }, hasil.tokenMasuk, hasil.tokenKeluar);
    return { pertanyaan: hasil.pertanyaan satisfies Pertanyaan[] };
  }

  async susun(viewer: Viewer, admin: boolean, suratId: string, input: z.infer<typeof susunSchema>) {
    const { draf, jenis, peran } = await this.siapkan(viewer, admin, suratId);
    const kutipan = await this.ambilKutipan(peran, input.kutipan);
    const tersimpan = await this.bacaIsi(suratId);
    await this.jagaPutaran(tersimpan?.putaran ?? 0);
    // Answers for keys this type does not have are dropped before the model ever sees them.
    const dikenal = new Set(jenis.unsur.map((unsur) => unsur.kunci));
    const jawaban = input.jawaban.filter((item) => dikenal.has(item.kunci) && item.nilai.length > 0);
    const masukan = this.masukan(draf, jenis, input.penjelasan, jawaban, kutipan.map((item) => item.teks));
    const mentah = await this.jalankan(viewer, draf, jenis, "susun", () => this.penyusun.susun(masukan));
    // Belt and braces over the adapter's own filter: whatever the drafter returns, a letter number
    // never reaches a draft from the model (§6.5 nomor 3). The guard lives here too so it holds for
    // every adapter, including one written later.
    const bagian: Bagian = {};
    const ditolak: string[] = [];
    for (const [kunci, nilai] of Object.entries(mentah.bagian)) {
      const teks = (nilai ?? "").trim().slice(0, 4000);
      if (teks.length === 0) continue;
      if (memuatNomor(teks)) ditolak.push(kunci);
      else bagian[kunci as KunciBagian] = teks;
    }
    const hasil = { ...mentah, bagian };
    const konteks: Konteks = { penjelasan: input.penjelasan, jawaban, kutipan };
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO sekretariat_surat_isi (surat_id, jenis_kode, bagian, konteks, sumber, putaran, token_masuk, token_keluar, dibuat_oleh, diubah_oleh)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, 'asisten', 1, $5, $6, $7, $7)
         ON CONFLICT (surat_id) DO UPDATE SET
           jenis_kode = EXCLUDED.jenis_kode,
           bagian = EXCLUDED.bagian,
           konteks = EXCLUDED.konteks,
           sumber = 'asisten',
           putaran = sekretariat_surat_isi.putaran + 1,
           token_masuk = sekretariat_surat_isi.token_masuk + EXCLUDED.token_masuk,
           token_keluar = sekretariat_surat_isi.token_keluar + EXCLUDED.token_keluar,
           diubah_oleh = EXCLUDED.diubah_oleh,
           diubah_pada = now()`,
        [suratId, draf.jenis_kode, JSON.stringify(hasil.bagian), JSON.stringify(konteks), hasil.tokenMasuk, hasil.tokenKeluar, viewer.actor],
      );
    });
    return { bagian: hasil.bagian, kosong: bagianKosong(jenis, hasil.bagian), ditolak };
  }

  /** The saved body plus everything the preview needs; 404 when the viewer may not see the letter. */
  async baca(viewer: Viewer, admin: boolean, suratId: string) {
    const { draf, jenis } = await this.siapkan(viewer, admin, suratId, { izinkanTerbit: true });
    const isi = await this.bacaIsi(suratId);
    return {
      suratId,
      jenisKode: draf.jenis_kode,
      jenisNama: jenis?.nama ?? null,
      didukung: jenis !== null,
      ada: isi !== null,
      bagian: isi?.bagian ?? {},
      sumber: isi?.sumber ?? null,
      disunting: isi?.disunting ?? false,
      putaran: isi?.putaran ?? 0,
      sisaPutaran: Math.max(0, MAKS_PUTARAN - (isi?.putaran ?? 0)),
      // §5.5: the body was written for another type; the preview says so instead of rewriting it.
      jenisBerubah: isi !== null && isi.jenis_kode !== draf.jenis_kode,
      kosong: jenis && isi ? bagianKosong(jenis, isi.bagian) : [],
      konteks: {
        penjelasan: isi?.konteks.penjelasan ?? "",
        jawaban: isi?.konteks.jawaban ?? [],
        kutipan: (isi?.konteks.kutipan ?? []).map((item) => ({ suratMasukId: item.surat_masuk_id, teks: item.teks })),
      },
      naskah: jenis ? rakitNaskah(this.sumberNaskah(draf, jenis, isi?.bagian ?? {})) : null,
    };
  }

  /** The staff member's own edit. It never calls the model, so it costs nothing and never fails closed. */
  async simpan(viewer: Viewer, admin: boolean, suratId: string, input: z.infer<typeof isiSchema>) {
    const { draf, jenis } = await this.siapkan(viewer, admin, suratId);
    const bagian: Bagian = {};
    for (const unsur of jenis.unsur) {
      const nilai = input.bagian[unsur.kunci as KunciBagian];
      if (typeof nilai === "string" && nilai.length > 0) bagian[unsur.kunci as KunciBagian] = nilai;
    }
    const sebelum = await this.bacaIsi(suratId);
    const berubah = KUNCI_BAGIAN.filter((kunci) => (sebelum?.bagian[kunci] ?? "") !== (bagian[kunci] ?? ""));
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO sekretariat_surat_isi (surat_id, jenis_kode, bagian, konteks, sumber, disunting, dibuat_oleh, diubah_oleh)
         VALUES ($1, $2, $3::jsonb, '{}'::jsonb, 'manual', true, $4, $4)
         ON CONFLICT (surat_id) DO UPDATE SET
           bagian = EXCLUDED.bagian, disunting = true, diubah_oleh = EXCLUDED.diubah_oleh, diubah_pada = now()`,
        [suratId, draf.jenis_kode, JSON.stringify(bagian), viewer.actor],
      );
      // The names of the sections that changed, never their contents (§8).
      await writeAudit(client, {
        aktor: viewer.actor, aksi: "surat.isi.sunting", objekJenis: "sekretariat_surat_keluar", objekRef: suratId,
        metadata: { bagianBerubah: berubah },
      });
    });
    return { bagian, kosong: bagianKosong(jenis, bagian) };
  }

  async hapus(viewer: Viewer, admin: boolean, suratId: string) {
    const { draf } = await this.siapkan(viewer, admin, suratId);
    await withTransaction(this.pool, async (client) => {
      await client.query("DELETE FROM sekretariat_surat_isi WHERE surat_id = $1", [draf.id]);
      await writeAudit(client, {
        aktor: viewer.actor, aksi: "surat.isi.hapus", objekJenis: "sekretariat_surat_keluar", objekRef: suratId, metadata: {},
      });
    });
  }

  /** Rendered on demand and never stored (A-8). */
  async docx(viewer: Viewer, admin: boolean, suratId: string): Promise<{ nama: string; data: Buffer }> {
    const { draf, jenis } = await this.siapkan(viewer, admin, suratId, { izinkanTerbit: true });
    if (!jenis) invalid("Jenis naskah ini belum punya kerangka di Asisten Surat.", "jenis_tidak_didukung");
    const isi = await this.bacaIsi(suratId);
    if (!isi) throw new SekretariatError(409, "isi_belum_ada", "Draf ini belum punya isi untuk diunduh.");
    const tanggal = jakartaParts(this.now()).tanggal;
    const naskah = rakitNaskah(this.sumberNaskah(draf, jenis, isi.bagian));
    return { nama: namaBerkasDocx(draf.jenis_kode, draf.penerbit_kode, tanggal), data: renderDocx(naskah) };
  }

  // ---- internals ----

  private sumberNaskah(draf: DrafRow, jenis: JenisDidukung, bagian: Bagian) {
    return {
      jenis,
      perihal: draf.perihal,
      tujuan: draf.tujuan,
      penandatangan: draf.penandatangan,
      penerbitNama: draf.penerbit_nama,
      tanggal: jakartaParts(this.now()).tanggal,
      bagian,
    };
  }

  private masukan(
    draf: DrafRow,
    jenis: JenisDidukung,
    penjelasan: string,
    jawaban: Array<{ kunci: string; nilai: string }>,
    kutipan: string[],
  ): MasukanAsisten {
    return {
      jenis,
      penerbitKode: draf.penerbit_kode,
      penerbitNama: draf.penerbit_nama,
      perihal: draf.perihal,
      tujuan: draf.tujuan,
      penandatangan: draf.penandatangan,
      penjelasan,
      jawaban,
      kutipan,
    };
  }

  /**
   * Access, state and type in one place. `izinkanTerbit` is for the read-only paths: a published
   * letter's body may still be read and downloaded, it just cannot be changed.
   */
  private async siapkan(
    viewer: Viewer,
    admin: boolean,
    suratId: string,
    options?: { izinkanTerbit?: false },
  ): Promise<{ draf: DrafRow; jenis: JenisDidukung; peran: Peranku }>;
  private async siapkan(
    viewer: Viewer,
    admin: boolean,
    suratId: string,
    options: { izinkanTerbit: true },
  ): Promise<{ draf: DrafRow; jenis: JenisDidukung | null; peran: Peranku }>;
  private async siapkan(viewer: Viewer, admin: boolean, suratId: string, options: { izinkanTerbit?: boolean } = {}) {
    if (!this.config.enabled) throw new SekretariatError(404, "tidak_ditemukan", "Tidak ditemukan.");
    if (!isUuid(suratId)) notFound();
    const peran = await loadPeran(this.pool, viewer, admin);
    const row = (await this.pool.query<DrafRow>(
      `SELECT s.id, s.penerbit_id, p.kode AS penerbit_kode, p.nama AS penerbit_nama, s.jenis_kode,
              s.perihal, s.tujuan, s.penandatangan, s.status
       FROM sekretariat_surat_keluar s JOIN sekretariat_penerbit p ON p.id = s.penerbit_id
       WHERE s.id = $1`,
      [suratId],
    )).rows[0];
    if (!row) notFound();
    // Same rule as the rest of the module: another issuer's letter does not exist (§8).
    requirePenerbit(peran, row.penerbit_id);
    if (!options.izinkanTerbit && row.status !== "draf") {
      throw new SekretariatError(409, "bukan_draf", "Surat ini sudah terbit atau dibatalkan; naskahnya terkunci.");
    }
    const jenis = jenisDidukung(row.jenis_kode);
    if (!options.izinkanTerbit && !jenis) {
      invalid("Jenis naskah ini belum punya kerangka di Asisten Surat.", "jenis_tidak_didukung");
    }
    return { draf: row, jenis, peran };
  }

  private async bacaIsi(suratId: string): Promise<IsiRow | null> {
    const row = (await this.pool.query<IsiRow>(
      "SELECT bagian, konteks, sumber, disunting, putaran, jenis_kode FROM sekretariat_surat_isi WHERE surat_id = $1",
      [suratId],
    )).rows[0];
    return row ?? null;
  }

  /**
   * §5.2: the browser sends pointers, the server cuts the text itself. A quote from a letter the
   * caller may not read is a 404, and no model call happens.
   */
  private async ambilKutipan(
    peran: Peranku,
    diminta: Array<z.infer<typeof kutipanSchema>>,
  ): Promise<Array<{ surat_masuk_id: string; awal: number; panjang: number; teks: string }>> {
    const hasil: Array<{ surat_masuk_id: string; awal: number; panjang: number; teks: string }> = [];
    let total = 0;
    for (const minta of diminta) {
      await requireSuratMasuk(this.pool, peran, minta.surat_masuk_id);
      const row = (await this.pool.query<{ isi_teks: string }>(
        "SELECT isi_teks FROM sekretariat_surat_masuk WHERE id = $1",
        [minta.surat_masuk_id],
      )).rows[0];
      if (!row) notFound();
      if (minta.awal + minta.panjang > row.isi_teks.length) {
        invalid("Kutipan melewati panjang isi surat.", "kutipan_tidak_sah");
      }
      const teks = row.isi_teks.slice(minta.awal, minta.awal + minta.panjang);
      total += teks.length;
      if (total > MAKS_TOTAL_KUTIPAN) invalid("Kutipan melebihi batas 4.000 karakter.", "kutipan_tidak_sah");
      hasil.push({ surat_masuk_id: minta.surat_masuk_id, awal: minta.awal, panjang: minta.panjang, teks });
    }
    return hasil;
  }

  private async jagaPutaran(putaran: number): Promise<void> {
    if (putaran >= MAKS_PUTARAN) {
      throw new SekretariatError(429, "putaran_habis", "Batas bantuan AI untuk draf ini sudah habis. Sunting isinya langsung.");
    }
    const bulan = jakartaParts(this.now()).tanggal.slice(0, 7);
    const row = (await this.pool.query<{ panggilan: number }>(
      "SELECT panggilan FROM sekretariat_ai_pemakaian WHERE bulan = $1",
      [bulan],
    )).rows[0];
    if ((row?.panggilan ?? 0) >= this.config.maksPanggilanBulan) {
      throw new SekretariatError(429, "anggaran_habis", "Pemakaian AI bulan ini sudah mencapai batas. Hubungi pengelola Sekretariat.");
    }
  }

  /**
   * Runs one model call, meters it and audits it. The audit row carries counts only: never the
   * prompt, the answer, or the quoted letter (§8).
   */
  private async jalankan<T extends { tokenMasuk: number; tokenKeluar: number }>(
    viewer: Viewer,
    draf: DrafRow,
    jenis: JenisDidukung,
    aksi: "tanya" | "susun",
    run: () => Promise<T>,
  ): Promise<T> {
    const mulai = Date.now();
    let hasil: T | null = null;
    let status = "berhasil";
    try {
      hasil = await run();
      return hasil;
    } catch (error) {
      if (error instanceof PenyusunError) {
        status = error.code;
        throw new SekretariatError(
          error.code === "AI_DITOLAK" ? 422 : 503,
          error.code === "AI_DITOLAK" ? "ai_ditolak" : "ai_tidak_tersedia",
          error.code === "AI_DITOLAK"
            ? "Asisten menolak menyusun naskah ini. Tulis isinya sendiri atau ubah penjelasannya."
            : "Asisten sedang tidak dapat dihubungi. Draf Anda tetap tersimpan.",
        );
      }
      status = "galat";
      throw error;
    } finally {
      await this.catat(viewer, draf, jenis, aksi, status, hasil, Date.now() - mulai);
    }
  }

  private async catat(
    viewer: Viewer,
    draf: DrafRow,
    jenis: JenisDidukung,
    aksi: "tanya" | "susun",
    status: string,
    hasil: { tokenMasuk: number; tokenKeluar: number } | null,
    latensiMs: number,
  ): Promise<void> {
    const bulan = jakartaParts(this.now()).tanggal.slice(0, 7);
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO sekretariat_ai_pemakaian (bulan, panggilan, token_masuk, token_keluar) VALUES ($1, 1, $2, $3)
         ON CONFLICT (bulan) DO UPDATE SET
           panggilan = sekretariat_ai_pemakaian.panggilan + 1,
           token_masuk = sekretariat_ai_pemakaian.token_masuk + EXCLUDED.token_masuk,
           token_keluar = sekretariat_ai_pemakaian.token_keluar + EXCLUDED.token_keluar,
           diubah_pada = now()`,
        [bulan, hasil?.tokenMasuk ?? 0, hasil?.tokenKeluar ?? 0],
      );
      await writeAudit(client, {
        aktor: viewer.actor,
        aksi: `surat.asisten.${aksi}`,
        objekJenis: "sekretariat_surat_keluar",
        objekRef: draf.id,
        metadata: {
          jenis: jenis.kode,
          penerbit: draf.penerbit_kode,
          mode: this.penyusun.mode,
          status,
          latensiMs,
          tokenMasuk: hasil?.tokenMasuk ?? 0,
          tokenKeluar: hasil?.tokenKeluar ?? 0,
        },
      });
    });
  }

  /** Context saved after a question round, so coming back to the flow keeps what was typed. */
  private async simpanKonteks(
    viewer: Viewer,
    suratId: string,
    jenisKode: string,
    konteks: Konteks,
    tokenMasuk: number,
    tokenKeluar: number,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO sekretariat_surat_isi (surat_id, jenis_kode, bagian, konteks, sumber, putaran, token_masuk, token_keluar, dibuat_oleh, diubah_oleh)
       VALUES ($1, $2, '{}'::jsonb, $3::jsonb, 'asisten', 1, $4, $5, $6, $6)
       ON CONFLICT (surat_id) DO UPDATE SET
         konteks = sekretariat_surat_isi.konteks || EXCLUDED.konteks,
         putaran = sekretariat_surat_isi.putaran + 1,
         token_masuk = sekretariat_surat_isi.token_masuk + EXCLUDED.token_masuk,
         token_keluar = sekretariat_surat_isi.token_keluar + EXCLUDED.token_keluar,
         diubah_oleh = EXCLUDED.diubah_oleh,
         diubah_pada = now()`,
      [suratId, jenisKode, JSON.stringify(konteks), tokenMasuk, tokenKeluar, viewer.actor],
    );
  }
}
