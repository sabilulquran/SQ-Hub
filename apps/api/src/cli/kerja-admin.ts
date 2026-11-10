import { randomUUID } from "node:crypto";

import { createPool } from "../db/pool.js";
import { withTransaction, writeAudit } from "../modules/kerja/db.js";
import { KerjaDirectory } from "../modules/kerja/directory.js";
import { createRoomSchema, KerjaRooms } from "../modules/kerja/ruang.js";
import { PgOrganizationDirectory } from "../modules/organization-directory/repository.js";

/**
 * KERJA-IMPL-001 §7.2 and §15 langkah 6 and 9: operator CLI, run on request of the Kepala HCM.
 * Grants `kerja_admin` and creates the permanent rooms from Organization Directory units, each with
 * its pj. Every change writes kerja_audit with the reason given.
 *
 *   npm run kerja:admin -- grant --issuer <url> --sub <sub> --reason <text>
 *   npm run kerja:admin -- revoke --issuer <url> --sub <sub> --reason <text>
 *   npm run kerja:admin -- admin list
 *   npm run kerja:admin -- unit list
 *   npm run kerja:admin -- orang cari --q <nama>
 *   npm run kerja:admin -- ruang list
 *   npm run kerja:admin -- ruang buat-tetap --unit <unitId> --pj <personId> --reason <text> [--nama <nama>]
 *   npm run kerja:admin -- ruang buat-panitia --nama <nama> --berakhir <YYYY-MM-DD> --pj <personId> --reason <text>
 *   npm run kerja:admin -- harian           # runs the Directory comparison and committee expiry now
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

const rooms = () => new KerjaRooms(pool, new KerjaDirectory(new PgOrganizationDirectory(pool)), { roomQuotaBytes: Number(process.env.KERJA_ROOM_QUOTA_BYTES ?? 1024 * 1024 * 1024) });

async function main() {
  const [area, action] = args;

  if (area === "grant" || area === "revoke") {
    const issuer = value("--issuer")!.replace(/\/$/, "");
    const subject = value("--sub")!;
    const reason = value("--reason")!;
    await withTransaction(pool, async (client) => {
      if (area === "grant") {
        await client.query(
          `INSERT INTO kerja_admins (id, identity_issuer, identity_subject, granted_by, alasan) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (identity_issuer, identity_subject) WHERE revoked_at IS NULL DO NOTHING`,
          [randomUUID(), issuer, subject, operator(), reason],
        );
      } else {
        await client.query("UPDATE kerja_admins SET revoked_at = now() WHERE identity_issuer = $1 AND identity_subject = $2 AND revoked_at IS NULL", [issuer, subject]);
      }
      await writeAudit(client, { aktor: operator(), aksi: area === "grant" ? "admin.tambah" : "admin.cabut", objekJenis: "kerja_admin", objekRef: `${issuer}#${subject}`, alasan: reason });
    });
    console.log(`${area === "grant" ? "granted" : "revoked"} kerja_admin`);
    return;
  }

  if (area === "admin" && action === "list") {
    const result = await pool.query("SELECT identity_issuer AS issuer, identity_subject AS sub, granted_by, granted_at, revoked_at FROM kerja_admins ORDER BY granted_at");
    console.log(JSON.stringify(result.rows, null, 2));
    return;
  }

  if (area === "unit" && action === "list") {
    console.log(JSON.stringify((await rooms().adminUnits()).items, null, 2));
    return;
  }

  if (area === "orang" && action === "cari") {
    console.log(JSON.stringify((await rooms().adminPeople(value("--q")!)).items, null, 2));
    return;
  }

  if (area === "ruang" && action === "list") {
    console.log(JSON.stringify((await rooms().adminList()).items.map((room) => ({ id: room.id, jenis: room.jenis, nama: room.nama, status: room.status, pj: room.pj.map((p) => p.nama) })), null, 2));
    return;
  }

  if (area === "ruang" && (action === "buat-tetap" || action === "buat-panitia")) {
    const nama = value("--nama", false);
    const input = createRoomSchema.parse(action === "buat-tetap"
      ? { jenis: "tetap", unit_id: value("--unit"), pj: value("--pj"), alasan: value("--reason"), ...(nama ? { nama } : {}) }
      : { jenis: "panitia", nama: value("--nama"), berakhir_pada: value("--berakhir"), pj: value("--pj"), alasan: value("--reason") });
    console.log(JSON.stringify(await rooms().adminCreate(operator(), input)));
    return;
  }

  if (area === "harian") {
    const service = rooms();
    console.log(JSON.stringify({ usulan: await service.compareWithDirectory(), ruangBerakhir: await service.expireCommittees() }));
    return;
  }

  throw new Error("Unknown command; see the header of src/cli/kerja-admin.ts");
}

try {
  await main();
} finally {
  await pool.end();
}
