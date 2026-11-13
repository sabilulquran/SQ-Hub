import { randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { z } from "zod";

import { withTransaction, writeAudit } from "./db.js";

/**
 * SEK-IMPL-001 §14 langkah 8: the one-way DOC-003 migration. The HCIS side exports its book as
 * JSON; this import is idempotent per source row id, never lowers a counter (DOC-003 D-17), and
 * keeps every already-allocated number exactly as it was formatted. Legacy types and issuers that
 * are not in the pedoman catalog arrive as inactive rows so old numbers stay readable.
 */

export const eksporDoc003Schema = z
  .object({
    types: z.array(z.object({
      code: z.string().regex(/^[0-9A-Z][0-9A-Z-]{0,9}$/),
      label: z.string().min(1).max(80),
    })),
    issuers: z.array(z.object({
      code: z.string().regex(/^[A-Z0-9][A-Z0-9.-]{1,29}$/),
      name: z.string().min(1).max(120),
      kind: z.string().min(1).max(40),
    })),
    grants: z.array(z.object({
      issuerCode: z.string(),
      personId: z.string().regex(/^hcis:employee:[0-9a-f-]{36}$/),
      reason: z.string().min(1).max(500),
    })).default([]),
    counters: z.array(z.object({
      issuerCode: z.string(),
      typeCode: z.string(),
      periodKey: z.string().regex(/^\d{4}(-\d{2})?$/),
      lastSequence: z.number().int().min(0),
    })),
    numbers: z.array(z.object({
      sourceId: z.string().min(1).max(100),
      issuerCode: z.string(),
      typeCode: z.string(),
      periodKey: z.string().regex(/^\d{4}(-\d{2})?$/),
      sequence: z.number().int().min(1),
      letterNumber: z.string().min(5).max(120),
      letterDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      subject: z.string().max(300).default(""),
      recipient: z.string().max(300).default(""),
      status: z.enum(["ALLOCATED", "VOIDED"]),
      voidedReason: z.string().max(500).nullable().default(null),
      requestedBy: z.string().max(300).default("migrasi:doc003"),
    })),
  })
  .strict();

export type EksporDoc003 = z.infer<typeof eksporDoc003Schema>;

export interface HasilImpor {
  jenisBaru: number;
  penerbitBaru: number;
  petugasBaru: number;
  penghitungDinaikkan: number;
  nomorBaru: number;
  nomorDilewati: number;
  verifikasi: { nomorSumber: number; nomorTujuan: number; penghitungKurang: Array<{ penerbit: string; jenis: string; tahun: number }> };
}

export async function imporDoc003(pool: Pool, aktor: string, ekspor: EksporDoc003): Promise<HasilImpor> {
  return withTransaction(pool, async (client) => {
    let jenisBaru = 0;
    for (const type of ekspor.types) {
      const result = await client.query(
        "INSERT INTO sekretariat_jenis (kode, nama, aktif, urutan) VALUES ($1, $2, false, 900) ON CONFLICT (kode) DO NOTHING",
        [type.code, type.label],
      );
      jenisBaru += result.rowCount ?? 0;
    }
    let penerbitBaru = 0;
    for (const issuer of ekspor.issuers) {
      const id = randomUUID();
      const result = await client.query(
        `INSERT INTO sekretariat_penerbit (id, kode, nama, kelompok, aktif, dibuat_oleh)
         VALUES ($1, $2, $3, 'lainnya', false, $4) ON CONFLICT (kode) DO NOTHING`,
        [id, issuer.code, issuer.name, aktor],
      );
      if ((result.rowCount ?? 0) > 0) {
        penerbitBaru += 1;
        await client.query("INSERT INTO sekretariat_kotak (id, jenis, penerbit_id) VALUES ($1, 'penerbit', $2) ON CONFLICT DO NOTHING", [randomUUID(), id]);
      }
    }
    const penerbitByKode = new Map<string, string>(
      (await client.query<{ id: string; kode: string }>("SELECT id, kode FROM sekretariat_penerbit")).rows.map((row) => [row.kode, row.id]),
    );
    const resolve = (kode: string): string => {
      const id = penerbitByKode.get(kode);
      if (!id) throw new Error(`penerbit ${kode} tidak ada di ekspor maupun katalog`);
      return id;
    };
    let petugasBaru = 0;
    for (const grant of ekspor.grants) {
      const result = await client.query(
        `INSERT INTO sekretariat_petugas (id, penerbit_id, person_id, alasan, diberikan_oleh)
         SELECT $1, $2, $3, $4, $5
         WHERE NOT EXISTS (SELECT 1 FROM sekretariat_petugas WHERE penerbit_id = $2 AND person_id = $3 AND dicabut_pada IS NULL)`,
        [randomUUID(), resolve(grant.issuerCode), grant.personId, `Migrasi DOC-003: ${grant.reason}`.slice(0, 500), aktor],
      );
      petugasBaru += result.rowCount ?? 0;
    }
    // Counters: per year. A legacy monthly type folds into its year; GREATEST keeps D-17.
    const perTahun = new Map<string, { penerbitId: string; jenis: string; tahun: number; nilai: number }>();
    for (const counter of ekspor.counters) {
      const tahun = Number(counter.periodKey.slice(0, 4));
      const key = `${counter.issuerCode}\n${counter.typeCode}\n${tahun}`;
      const existing = perTahun.get(key);
      const nilai = Math.max(existing?.nilai ?? 0, counter.lastSequence);
      perTahun.set(key, { penerbitId: resolve(counter.issuerCode), jenis: counter.typeCode, tahun, nilai });
    }
    let penghitungDinaikkan = 0;
    for (const entry of perTahun.values()) {
      const result = await client.query<{ urut_terakhir: number }>(
        `INSERT INTO sekretariat_penghitung (penerbit_id, jenis_kode, tahun, urut_terakhir) VALUES ($1, $2, $3, $4)
         ON CONFLICT (penerbit_id, jenis_kode, tahun) DO UPDATE SET urut_terakhir = GREATEST(sekretariat_penghitung.urut_terakhir, EXCLUDED.urut_terakhir)
         RETURNING urut_terakhir`,
        [entry.penerbitId, entry.jenis, entry.tahun, entry.nilai],
      );
      if (result.rows[0]!.urut_terakhir === entry.nilai) penghitungDinaikkan += 1;
    }
    let nomorBaru = 0;
    let nomorDilewati = 0;
    for (const number of ekspor.numbers) {
      const result = await client.query(
        `INSERT INTO sekretariat_nomor (id, penerbit_id, jenis_kode, tahun, urut, nomor_lengkap, tanggal, perihal, tujuan, status,
                                        dibatalkan_pada, dibatalkan_oleh, dibatalkan_alasan, sumber, migrasi_sumber_id, diambil_oleh)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'migrasi-doc003', $14, $15)
         ON CONFLICT (migrasi_sumber_id) WHERE migrasi_sumber_id IS NOT NULL DO NOTHING`,
        [
          randomUUID(),
          resolve(number.issuerCode),
          number.typeCode,
          Number(number.periodKey.slice(0, 4)),
          number.sequence,
          number.letterNumber,
          number.letterDate,
          number.subject,
          number.recipient,
          number.status === "VOIDED" ? "dibatalkan" : "terpakai",
          number.status === "VOIDED" ? new Date() : null,
          number.status === "VOIDED" ? aktor : null,
          number.status === "VOIDED" ? (number.voidedReason ?? "Dibatalkan di DOC-003 (migrasi)").slice(0, 500).padEnd(10, ".") : null,
          number.sourceId,
          number.requestedBy || "migrasi:doc003",
        ],
      );
      if ((result.rowCount ?? 0) > 0) nomorBaru += 1;
      else nomorDilewati += 1;
    }
    // Verification (§14 langkah 8): row counts, and no target counter below the source maximum.
    const nomorTujuan = Number((await client.query<{ c: string }>("SELECT count(*) AS c FROM sekretariat_nomor WHERE sumber = 'migrasi-doc003'")).rows[0]!.c);
    const penghitungKurang: HasilImpor["verifikasi"]["penghitungKurang"] = [];
    for (const entry of perTahun.values()) {
      const row = (await client.query<{ urut_terakhir: number }>(
        "SELECT urut_terakhir FROM sekretariat_penghitung WHERE penerbit_id = $1 AND jenis_kode = $2 AND tahun = $3",
        [entry.penerbitId, entry.jenis, entry.tahun],
      )).rows[0];
      if (!row || row.urut_terakhir < entry.nilai) penghitungKurang.push({ penerbit: entry.penerbitId, jenis: entry.jenis, tahun: entry.tahun });
    }
    if (nomorTujuan < ekspor.numbers.length || penghitungKurang.length > 0) {
      throw new Error(`verifikasi migrasi gagal: ${nomorTujuan}/${ekspor.numbers.length} nomor, ${penghitungKurang.length} penghitung kurang`);
    }
    await writeAudit(client, {
      aktor,
      aksi: "migrasi.doc003",
      objekJenis: "sekretariat_nomor",
      objekRef: "doc003",
      metadata: { jenisBaru, penerbitBaru, petugasBaru, nomorBaru, nomorDilewati },
    });
    return {
      jenisBaru,
      penerbitBaru,
      petugasBaru,
      penghitungDinaikkan,
      nomorBaru,
      nomorDilewati,
      verifikasi: { nomorSumber: ekspor.numbers.length, nomorTujuan, penghitungKurang },
    };
  });
}
