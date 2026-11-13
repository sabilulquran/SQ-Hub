import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";
import { z } from "zod";

import { loadPeran, requirePenerbit, type Peranku, type Viewer } from "./akses.js";
import { invalid, isUuid, notFound, SekretariatError, withTransaction, writeAudit } from "./db.js";

/**
 * SEK-IMPL-001 §5: the foundation-wide letter-number book. The numbering rules are Pedoman Tata
 * Naskah Dinas YSQ v0.11 Pasal 8 and 13–14 and only those: pattern
 * `[kode jenis].[nomor urut]/[kode penerbit]/[bulan Romawi]/[tahun]`, three-digit sequence from
 * 001 (1000 unpadded past 999), one sequence per type per issuer resetting on 1 January
 * Asia/Jakarta, numbers given after review with no backdating, voided numbers kept forever.
 */

const ROMAWI = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"] as const;

export interface JakartaParts {
  tahun: number;
  bulan: number;
  tanggal: string;
}

/** Date parts in Asia/Jakarta; the counter year and the number's month come from these. */
export function jakartaParts(at: Date): JakartaParts {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(at)
    .reduce<Record<string, string>>((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return { tahun: Number(parts.year), bulan: Number(parts.month), tanggal: `${parts.year}-${parts.month}-${parts.day}` };
}

export function romawiBulan(bulan: number): string {
  const value = ROMAWI[bulan - 1];
  if (!value) throw new SekretariatError(500, "bulan_tidak_sah", "Bulan tidak sah.");
  return value;
}

/** Pasal 13 ayat (2) huruf b: three digits with leading zeros; past 999 the sequence continues unpadded. */
export function formatUrut(urut: number): string {
  return urut <= 999 ? String(urut).padStart(3, "0") : String(urut);
}

export function nomorLengkap(input: { jenisKode: string; urut: number; penerbitKode: string; bulan: number; tahun: number }): string {
  return `${input.jenisKode}.${formatUrut(input.urut)}/${input.penerbitKode}/${romawiBulan(input.bulan)}/${input.tahun}`;
}

export const alokasiSchema = z
  .object({
    jenis_kode: z.string().regex(/^[0-9A-Z][0-9A-Z-]{0,9}$/),
    perihal: z.string().trim().min(3).max(300),
    tujuan: z.string().trim().min(2).max(300),
  })
  .strict();

export const batalSchema = z.object({ alasan: z.string().trim().min(10).max(500) }).strict();

export const nomorAwalSchema = z
  .object({
    penerbit_id: z.string().uuid(),
    jenis_kode: z.string().regex(/^[0-9A-Z][0-9A-Z-]{0,9}$/),
    tahun: z.number().int().min(2000).max(2200),
    nilai: z.number().int().min(1).max(1_000_000),
    alasan: z.string().trim().min(5).max(500),
  })
  .strict();

export const registerQuerySchema = z
  .object({
    penerbit: z.string().uuid().optional(),
    jenis: z.string().regex(/^[0-9A-Z][0-9A-Z-]{0,9}$/).optional(),
    tahun: z.coerce.number().int().min(2000).max(2200).optional(),
    status: z.enum(["terpakai", "dibatalkan"]).optional(),
    page: z.coerce.number().int().min(1).default(1),
  })
  .strict();

export interface NomorBaru {
  id: string;
  nomor: string;
  tahun: number;
  urut: number;
  tanggal: string;
}

export class SekretariatBuku {
  constructor(
    private readonly pool: Pool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * DOC-003 D-05 kept: raising the counter and inserting the register row happen in one
   * transaction; concurrent calls queue on the counter row, so numbers are consecutive with no
   * gaps and no duplicates. A failed validation never consumes a number. No backdating: the
   * letter date is the allocation date in Asia/Jakarta (Pasal 13 ayat 5).
   */
  async allocate(
    client: PoolClient,
    input: {
      penerbitId: string;
      jenisKode: string;
      perihal: string;
      tujuan: string;
      aktor: string;
      sumber: "sekretariat" | "mesin";
      rujukan?: { modul: string; id: string };
    },
  ): Promise<NomorBaru> {
    const penerbit = (await client.query<{ kode: string; aktif: boolean; berakhir_pada: string | null }>(
      "SELECT kode, aktif, berakhir_pada FROM sekretariat_penerbit WHERE id = $1",
      [input.penerbitId],
    )).rows[0];
    if (!penerbit) notFound();
    if (!penerbit.aktif) throw new SekretariatError(409, "penerbit_nonaktif", "Penerbit ini sudah dinonaktifkan.");
    const jenis = (await client.query<{ aktif: boolean }>("SELECT aktif FROM sekretariat_jenis WHERE kode = $1", [input.jenisKode])).rows[0];
    if (!jenis) invalid("Kode jenis tidak dikenal.", "jenis_tidak_dikenal");
    if (!jenis.aktif) throw new SekretariatError(409, "jenis_nonaktif", "Jenis naskah ini tidak aktif.");
    const parts = jakartaParts(this.now());
    if (penerbit.berakhir_pada && penerbit.berakhir_pada < parts.tanggal) {
      throw new SekretariatError(409, "penerbit_berakhir", "Masa berlaku penerbit ini sudah berakhir.");
    }
    const counter = await client.query<{ urut_terakhir: number }>(
      `INSERT INTO sekretariat_penghitung (penerbit_id, jenis_kode, tahun, urut_terakhir) VALUES ($1, $2, $3, 1)
       ON CONFLICT (penerbit_id, jenis_kode, tahun) DO UPDATE SET urut_terakhir = sekretariat_penghitung.urut_terakhir + 1
       RETURNING urut_terakhir`,
      [input.penerbitId, input.jenisKode, parts.tahun],
    );
    const urut = counter.rows[0]!.urut_terakhir;
    const nomor = nomorLengkap({ jenisKode: input.jenisKode, urut, penerbitKode: penerbit.kode, bulan: parts.bulan, tahun: parts.tahun });
    const id = randomUUID();
    await client.query(
      `INSERT INTO sekretariat_nomor (id, penerbit_id, jenis_kode, tahun, urut, nomor_lengkap, tanggal, perihal, tujuan, sumber, rujukan_modul, rujukan_id, diambil_oleh)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [id, input.penerbitId, input.jenisKode, parts.tahun, urut, nomor, parts.tanggal, input.perihal, input.tujuan, input.sumber,
        input.rujukan?.modul ?? null, input.rujukan?.id ?? null, input.aktor],
    );
    await writeAudit(client, {
      aktor: input.aktor,
      aksi: "nomor.alokasi",
      objekJenis: "sekretariat_nomor",
      objekRef: nomor,
      metadata: { penerbit: penerbit.kode, jenis: input.jenisKode, sumber: input.sumber },
    });
    return { id, nomor, tahun: parts.tahun, urut, tanggal: parts.tanggal };
  }

  /**
   * D-3: one number per (rujukan_modul, rujukan_id). A repeated machine call returns the number
   * already allocated instead of a new one.
   */
  async allocateForMachine(input: {
    clientId: string;
    penerbitKode: string;
    jenisKode: string;
    perihal: string;
    tujuan: string;
    rujukanModul: string;
    rujukanId: string;
  }): Promise<NomorBaru & { sudahAda: boolean }> {
    const existing = await this.pool.query<{ id: string; nomor_lengkap: string; tahun: number; urut: number; tanggal: string }>(
      `SELECT id, nomor_lengkap, tahun, urut, to_char(tanggal, 'YYYY-MM-DD') AS tanggal FROM sekretariat_nomor
       WHERE rujukan_modul = $1 AND rujukan_id = $2`,
      [input.rujukanModul, input.rujukanId],
    );
    const found = existing.rows[0];
    if (found) return { id: found.id, nomor: found.nomor_lengkap, tahun: found.tahun, urut: found.urut, tanggal: found.tanggal, sudahAda: true };
    const penerbit = (await this.pool.query<{ id: string }>("SELECT id FROM sekretariat_penerbit WHERE kode = $1", [input.penerbitKode])).rows[0];
    if (!penerbit) invalid("Kode penerbit tidak dikenal.", "penerbit_tidak_dikenal");
    try {
      return {
        ...(await withTransaction(this.pool, (client) =>
          this.allocate(client, {
            penerbitId: penerbit.id,
            jenisKode: input.jenisKode,
            perihal: input.perihal,
            tujuan: input.tujuan,
            aktor: `modul:${input.clientId}`,
            sumber: "mesin",
            rujukan: { modul: input.rujukanModul, id: input.rujukanId },
          }),
        )),
        sudahAda: false,
      };
    } catch (error) {
      // Two identical calls racing: the second hits the unique reference index; return the winner's number.
      if ((error as { code?: string }).code === "23505") {
        const retry = await this.pool.query<{ id: string; nomor_lengkap: string; tahun: number; urut: number; tanggal: string }>(
          `SELECT id, nomor_lengkap, tahun, urut, to_char(tanggal, 'YYYY-MM-DD') AS tanggal FROM sekretariat_nomor
           WHERE rujukan_modul = $1 AND rujukan_id = $2`,
          [input.rujukanModul, input.rujukanId],
        );
        const row = retry.rows[0];
        if (row) return { id: row.id, nomor: row.nomor_lengkap, tahun: row.tahun, urut: row.urut, tanggal: row.tanggal, sudahAda: true };
      }
      throw error;
    }
  }

  /** DOC-003 D-08 kept: a voided number stays on the register; the sequence never rewinds. */
  async void(viewer: Viewer, peran: Peranku, nomorId: string, alasan: string): Promise<{ id: string }> {
    if (!isUuid(nomorId)) notFound();
    const row = (await this.pool.query<{ penerbit_id: string; status: string; diambil_oleh: string; nomor_lengkap: string }>(
      "SELECT penerbit_id, status, diambil_oleh, nomor_lengkap FROM sekretariat_nomor WHERE id = $1",
      [nomorId],
    )).rows[0];
    if (!row) notFound();
    requirePenerbit(peran, row.penerbit_id);
    if (!peran.admin && row.diambil_oleh !== viewer.actor) {
      throw new SekretariatError(403, "bukan_pengambil", "Hanya pengambil nomor atau pengelola yang dapat membatalkannya.");
    }
    if (row.status !== "terpakai") throw new SekretariatError(409, "nomor_sudah_batal", "Nomor ini sudah dibatalkan.");
    await withTransaction(this.pool, async (client) => {
      await client.query(
        "UPDATE sekretariat_nomor SET status = 'dibatalkan', dibatalkan_pada = now(), dibatalkan_oleh = $2, dibatalkan_alasan = $3 WHERE id = $1",
        [nomorId, viewer.actor, alasan],
      );
      await writeAudit(client, { aktor: viewer.actor, aksi: "nomor.batal", objekJenis: "sekretariat_nomor", objekRef: row.nomor_lengkap, alasan });
    });
    return { id: nomorId };
  }

  /** DOC-003 D-17 kept: a starting value may only raise the counter, never lower it. */
  async raiseCounter(aktor: string, input: z.infer<typeof nomorAwalSchema>): Promise<{ urutTerakhir: number }> {
    return withTransaction(this.pool, async (client) => {
      const penerbit = (await client.query<{ kode: string }>("SELECT kode FROM sekretariat_penerbit WHERE id = $1", [input.penerbit_id])).rows[0];
      if (!penerbit) notFound();
      const jenis = (await client.query("SELECT 1 FROM sekretariat_jenis WHERE kode = $1", [input.jenis_kode])).rows[0];
      if (!jenis) invalid("Kode jenis tidak dikenal.", "jenis_tidak_dikenal");
      const result = await client.query<{ urut_terakhir: number }>(
        `INSERT INTO sekretariat_penghitung (penerbit_id, jenis_kode, tahun, urut_terakhir) VALUES ($1, $2, $3, $4)
         ON CONFLICT (penerbit_id, jenis_kode, tahun) DO UPDATE SET urut_terakhir = GREATEST(sekretariat_penghitung.urut_terakhir, EXCLUDED.urut_terakhir)
         RETURNING urut_terakhir`,
        [input.penerbit_id, input.jenis_kode, input.tahun, input.nilai],
      );
      const urutTerakhir = result.rows[0]!.urut_terakhir;
      if (urutTerakhir !== input.nilai) {
        throw new SekretariatError(409, "penghitung_tidak_naik", `Penghitung sudah di ${urutTerakhir}; nomor awal hanya boleh menaikkan.`);
      }
      await writeAudit(client, {
        aktor,
        aksi: "penghitung.nomor_awal",
        objekJenis: "sekretariat_penghitung",
        objekRef: `${penerbit.kode}/${input.jenis_kode}/${input.tahun}`,
        alasan: input.alasan,
        metadata: { nilai: input.nilai },
      });
      return { urutTerakhir };
    });
  }

  /** The combined register, scoped to the issuers the viewer may see (§8). 25 per page with total. */
  async register(viewer: Viewer, admin: boolean, query: z.infer<typeof registerQuerySchema>) {
    const peran = await loadPeran(this.pool, viewer, admin);
    if (query.penerbit) requirePenerbit(peran, query.penerbit);
    const scope = query.penerbit ? [query.penerbit] : peran.admin ? null : [...peran.penerbitIds];
    if (scope !== null && scope.length === 0) return { items: [], total: 0, page: 1, pageSize: 25 };
    const where: string[] = [];
    const params: unknown[] = [];
    if (scope !== null) {
      params.push(scope);
      where.push(`n.penerbit_id = ANY($${params.length}::uuid[])`);
    }
    if (query.jenis) {
      params.push(query.jenis);
      where.push(`n.jenis_kode = $${params.length}`);
    }
    if (query.tahun) {
      params.push(query.tahun);
      where.push(`n.tahun = $${params.length}`);
    }
    if (query.status) {
      params.push(query.status);
      where.push(`n.status = $${params.length}`);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const total = Number((await this.pool.query<{ c: string }>(`SELECT count(*) AS c FROM sekretariat_nomor n ${clause}`, params)).rows[0]!.c);
    params.push((query.page - 1) * 25);
    const rows = await this.pool.query<{
      id: string; nomor_lengkap: string; jenis_kode: string; jenis_nama: string | null; penerbit_kode: string; tanggal: string;
      perihal: string; tujuan: string; status: string; sumber: string; dibatalkan_alasan: string | null; diambil_oleh: string;
    }>(
      `SELECT n.id, n.nomor_lengkap, n.jenis_kode, j.nama AS jenis_nama, p.kode AS penerbit_kode, to_char(n.tanggal, 'YYYY-MM-DD') AS tanggal,
              n.perihal, n.tujuan, n.status, n.sumber, n.dibatalkan_alasan, n.diambil_oleh
       FROM sekretariat_nomor n
       JOIN sekretariat_penerbit p ON p.id = n.penerbit_id
       LEFT JOIN sekretariat_jenis j ON j.kode = n.jenis_kode
       ${clause} ORDER BY n.tanggal DESC, n.diambil_pada DESC, n.id LIMIT 25 OFFSET $${params.length}`,
      params,
    );
    return {
      items: rows.rows.map((row) => ({
        id: row.id, nomor: row.nomor_lengkap, jenis: { kode: row.jenis_kode, nama: row.jenis_nama }, penerbit: row.penerbit_kode,
        tanggal: row.tanggal, perihal: row.perihal, tujuan: row.tujuan, status: row.status, sumber: row.sumber,
        dibatalkanAlasan: row.dibatalkan_alasan,
      })),
      total,
      page: query.page,
      pageSize: 25,
    };
  }

  /** CSV export of the same scope; cells are neutralized against spreadsheet formulas. */
  async exportCsv(viewer: Viewer, admin: boolean, query: z.infer<typeof registerQuerySchema>): Promise<string> {
    const lines: string[] = ["nomor;jenis;penerbit;tanggal;perihal;tujuan;status;sumber"];
    for (let page = 1; page <= 800; page += 1) {
      const result = await this.register(viewer, admin, { ...query, page });
      if (page === 1 && result.total > 20_000) {
        throw new SekretariatError(422, "ekspor_terlalu_besar", "Hasil melebihi 20.000 baris; persempit penyaringnya.");
      }
      for (const item of result.items) {
        lines.push([item.nomor, `${item.jenis.kode} ${item.jenis.nama ?? ""}`.trim(), item.penerbit, item.tanggal, item.perihal, item.tujuan, item.status, item.sumber]
          .map(csvCell).join(";"));
      }
      if (result.items.length < result.pageSize || page * result.pageSize >= result.total) break;
    }
    return `${lines.join("\r\n")}\r\n`;
  }

  async jenisList(onlyActive: boolean) {
    const rows = await this.pool.query<{ kode: string; nama: string; aktif: boolean }>(
      `SELECT kode, nama, aktif FROM sekretariat_jenis ${onlyActive ? "WHERE aktif" : ""} ORDER BY urutan, kode`,
    );
    return { items: rows.rows };
  }
}

export function csvCell(value: string): string {
  const neutralized = /^[=+\-@\t]/.test(value) ? `'${value}` : value;
  return /[";\r\n]/.test(neutralized) ? `"${neutralized.replace(/"/g, '""')}"` : neutralized;
}
