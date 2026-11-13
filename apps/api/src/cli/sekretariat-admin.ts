import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { createPool } from "../db/pool.js";
import { withTransaction, writeAudit } from "../modules/sekretariat/db.js";
import { eksporDoc003Schema, imporDoc003 } from "../modules/sekretariat/migrasi.js";
import { cabutSchema, panitiaSchema, pemegangSchema, petugasSchema, SekretariatPengaturan } from "../modules/sekretariat/pengaturan.js";
import { nomorAwalSchema, SekretariatBuku } from "../modules/sekretariat/buku.js";

/**
 * SEK-IMPL-001 §8 and §14: operator CLI, run on request of the Kepala HCM. Every change writes
 * sekretariat_audit with the reason given.
 *
 *   npm run sekretariat:admin -- grant --issuer <url> --sub <sub> --reason <text>
 *   npm run sekretariat:admin -- revoke --issuer <url> --sub <sub> --reason <text>
 *   npm run sekretariat:admin -- admin list
 *   npm run sekretariat:admin -- penerbit list
 *   npm run sekretariat:admin -- penerbit buat-panitia --kode PAN.MILAD --nama <nama> --berakhir <YYYY-MM-DD> --reason <text>
 *   npm run sekretariat:admin -- petugas tambah --penerbit <uuid> --person <personId> --reason <text>
 *   npm run sekretariat:admin -- petugas cabut --id <uuid> --reason <text>
 *   npm run sekretariat:admin -- disposisi tambah --person <personId> --reason <text>
 *   npm run sekretariat:admin -- disposisi cabut --id <uuid> --reason <text>
 *   npm run sekretariat:admin -- nomor-awal --penerbit <uuid> --jenis <kode> --tahun <yyyy> --nilai <n> --reason <text>
 *   npm run sekretariat:admin -- impor-doc003 --file <ekspor.json> [--apply]   # dry-run by default
 */

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const pool = createPool(databaseUrl);
const args = process.argv.slice(2);

function value(name: string, required = true): string | undefined {
  const index = args.indexOf(name);
  const found = index >= 0 ? args[index + 1] : undefined;
  if (required && (!found || found.startsWith("--"))) throw new Error(`Missing ${name}`);
  return found;
}

function operator(): string {
  return value("--actor", false) ?? `operator:${process.env.USER ?? process.env.USERNAME ?? "cli"}`;
}

async function main() {
  const [area, action] = args;
  const pengaturan = new SekretariatPengaturan(pool);

  if (area === "grant" || area === "revoke") {
    const issuer = value("--issuer")!.replace(/\/$/, "");
    const subject = value("--sub")!;
    const reason = value("--reason")!;
    await withTransaction(pool, async (client) => {
      if (area === "grant") {
        await client.query(
          `INSERT INTO sekretariat_admins (id, identity_issuer, identity_subject, granted_by, alasan) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (identity_issuer, identity_subject) WHERE revoked_at IS NULL DO NOTHING`,
          [randomUUID(), issuer, subject, operator(), reason],
        );
      } else {
        await client.query("UPDATE sekretariat_admins SET revoked_at = now() WHERE identity_issuer = $1 AND identity_subject = $2 AND revoked_at IS NULL", [issuer, subject]);
      }
      await writeAudit(client, { aktor: operator(), aksi: area === "grant" ? "admin.tambah" : "admin.cabut", objekJenis: "sekretariat_admin", objekRef: `${issuer}#${subject}`, alasan: reason });
    });
    console.log(`${area === "grant" ? "granted" : "revoked"} sekretariat_admin`);
    return;
  }

  if (area === "admin" && action === "list") {
    const result = await pool.query("SELECT identity_issuer AS issuer, identity_subject AS sub, granted_by, granted_at, revoked_at FROM sekretariat_admins ORDER BY granted_at");
    console.log(JSON.stringify(result.rows, null, 2));
    return;
  }

  if (area === "penerbit" && action === "list") {
    console.log(JSON.stringify((await pengaturan.penerbitList()).items, null, 2));
    return;
  }

  if (area === "penerbit" && action === "buat-panitia") {
    const input = panitiaSchema.parse({ kode: value("--kode"), nama: value("--nama"), berakhir_pada: value("--berakhir"), alasan: value("--reason") });
    console.log(JSON.stringify(await pengaturan.buatPanitia(operator(), input)));
    return;
  }

  if (area === "petugas" && action === "tambah") {
    const input = petugasSchema.parse({ penerbit_id: value("--penerbit"), person_id: value("--person"), alasan: value("--reason") });
    console.log(JSON.stringify(await pengaturan.tambahPetugas(operator(), input)));
    return;
  }

  if (area === "petugas" && action === "cabut") {
    const input = cabutSchema.parse({ alasan: value("--reason") });
    console.log(JSON.stringify(await pengaturan.cabutPetugas(operator(), value("--id")!, input.alasan)));
    return;
  }

  if (area === "petugas" && action === "list") {
    console.log(JSON.stringify((await pengaturan.petugasList()).items, null, 2));
    return;
  }

  if (area === "disposisi" && action === "tambah") {
    const input = pemegangSchema.parse({ person_id: value("--person"), alasan: value("--reason") });
    console.log(JSON.stringify(await pengaturan.tambahPemegangDisposisi(operator(), input)));
    return;
  }

  if (area === "disposisi" && action === "cabut") {
    const input = cabutSchema.parse({ alasan: value("--reason") });
    console.log(JSON.stringify(await pengaturan.cabutPemegangDisposisi(operator(), value("--id")!, input.alasan)));
    return;
  }

  if (area === "disposisi" && action === "list") {
    console.log(JSON.stringify((await pengaturan.pemegangDisposisiList()).items, null, 2));
    return;
  }

  if (area === "nomor-awal") {
    const buku = new SekretariatBuku(pool);
    const input = nomorAwalSchema.parse({
      penerbit_id: value("--penerbit"),
      jenis_kode: value("--jenis"),
      tahun: Number(value("--tahun")),
      nilai: Number(value("--nilai")),
      alasan: value("--reason"),
    });
    console.log(JSON.stringify(await buku.raiseCounter(operator(), input)));
    return;
  }

  if (area === "impor-doc003") {
    const file = value("--file")!;
    const apply = args.includes("--apply");
    const ekspor = eksporDoc003Schema.parse(JSON.parse(await readFile(file, "utf-8")));
    console.log(JSON.stringify({
      file,
      jenis: ekspor.types.length,
      penerbit: ekspor.issuers.length,
      grants: ekspor.grants.length,
      penghitung: ekspor.counters.length,
      nomor: ekspor.numbers.length,
    }));
    if (!apply) {
      console.log("dry-run: tidak ada yang ditulis. Tambahkan --apply untuk mengimpor (SEK-IMPL-001 §14 langkah 8).");
      return;
    }
    const hasil = await imporDoc003(pool, operator(), ekspor);
    console.log(JSON.stringify(hasil, null, 2));
    return;
  }

  throw new Error("Unknown command; see the header of src/cli/sekretariat-admin.ts");
}

try {
  await main();
} finally {
  await pool.end();
}
