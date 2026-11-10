import type { Pool } from "pg";

import { withTransaction } from "./db.js";

type Marker = "mulai_h1hari" | "mulai_h1jam" | "tenggat_h1hari" | "tenggat_h1jam";

const RULES: Array<{ marker: Marker; field: "mulai_pada" | "tenggat_pada"; before: string; earlierMarker: Marker | null; laterLimit: string | null }> = [
  // H−1 jam first: a card already inside the last hour also closes its H−1 hari marker unsent.
  { marker: "tenggat_h1jam", field: "tenggat_pada", before: "1 hour", earlierMarker: "tenggat_h1hari", laterLimit: null },
  { marker: "tenggat_h1hari", field: "tenggat_pada", before: "1 day", earlierMarker: null, laterLimit: "1 hour" },
  { marker: "mulai_h1jam", field: "mulai_pada", before: "1 hour", earlierMarker: "mulai_h1hari", laterLimit: null },
  { marker: "mulai_h1hari", field: "mulai_pada", before: "1 day", earlierMarker: null, laterLimit: "1 hour" },
];

/**
 * KERJA-IMPL-001 §6.4: in-app reminders H−1 hari and H−1 jam for start and deadline. Each card
 * marker is set in the same transaction that writes the notifications, and rows are claimed with
 * `FOR UPDATE SKIP LOCKED`, so running the worker again — or twice at once — sends nothing twice.
 * Done and archived cards, and cards in archived rooms, get no reminder. A moment already past
 * sends nothing. Times are absolute instants; Asia/Jakarta only matters for display.
 */
export class KerjaReminders {
  constructor(private readonly pool: Pool) {}

  async runOnce(now: Date = new Date()): Promise<number> {
    let sent = 0;
    for (const rule of RULES) {
      sent += await withTransaction(this.pool, async (client) => {
        const due = await client.query<{ kartu_id: string }>(
          `SELECT p.kartu_id FROM kerja_pengingat p
           JOIN kerja_kartu k ON k.id = p.kartu_id JOIN kerja_ruang r ON r.id = k.ruang_id
           WHERE p.${rule.marker}_pada IS NULL AND k.selesai_jenis IS NULL AND NOT k.arsip AND r.status = 'aktif'
             AND k.${rule.field} IS NOT NULL AND k.${rule.field} > $1
             AND k.${rule.field} - interval '${rule.before}' <= $1
             ${rule.laterLimit ? `AND k.${rule.field} - interval '${rule.laterLimit}' > $1` : ""}
           ORDER BY k.${rule.field}
           LIMIT 200
           FOR UPDATE OF p SKIP LOCKED`,
          [now],
        );
        const ids = due.rows.map((row) => row.kartu_id);
        if (ids.length === 0) return 0;
        const inserted = await client.query(
          `INSERT INTO kerja_notifikasi (id, person_id, jenis, kartu_id)
           SELECT gen_random_uuid(), o.person_id, $2, o.kartu_id FROM kerja_kartu_orang o WHERE o.kartu_id = ANY($1::uuid[])`,
          [ids, rule.marker],
        );
        await client.query(
          `UPDATE kerja_pengingat SET ${rule.marker}_pada = $2
             ${rule.earlierMarker ? `, ${rule.earlierMarker}_pada = COALESCE(${rule.earlierMarker}_pada, $2)` : ""}
           WHERE kartu_id = ANY($1::uuid[])`,
          [ids, now],
        );
        return inserted.rowCount ?? 0;
      });
    }
    return sent;
  }
}
