import type { Pool } from "pg";
import { z } from "zod";

import { requireRoom, type Viewer } from "./access.js";
import type { KerjaDirectory } from "./directory.js";
import { cardSummaries, withPeople } from "./papan.js";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const searchQuerySchema = z.object({
  q: z.string().trim().max(200).default(""),
  papan: uuid.optional(),
  label: uuid.optional(),
  orang: z.string().regex(/^hcis:employee:[0-9a-f-]{36}$/).optional(),
  status: z.enum(["semua", "terbuka", "tuntas", "batal", "ditunda"]).default("semua"),
  tenggat_dari: isoDate.optional(),
  tenggat_sampai: isoDate.optional(),
  arsip: z.enum(["true", "false"]).default("false"),
}).strict();

/**
 * KERJA-IMPL-001 §2 Pencarian: PostgreSQL full text in one room only. The room filter is the
 * first condition and comes from the membership check, so a card from a room the viewer does
 * not follow cannot match (KERJA-001 §6.6). Searches title, description and comments.
 */
export class KerjaSearch {
  constructor(
    private readonly pool: Pool,
    private readonly directory: KerjaDirectory,
    private readonly config: () => Promise<string>,
  ) {}

  async search(viewer: Viewer, ruangId: string, query: z.infer<typeof searchQuerySchema>) {
    await requireRoom(this.pool, ruangId, viewer, "baca");
    const cfg = await this.config();
    const params: unknown[] = [ruangId];
    const where = ["k.ruang_id = $1"];
    if (query.q.length > 0) {
      params.push(query.q, `%${query.q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`, cfg);
      const q = params.length - 2;
      where.push(`(k.tsv @@ websearch_to_tsquery($${q + 2}::regconfig, $${q})
        OR k.judul ILIKE $${q + 1}
        OR k.id IN (SELECT m.kartu_id FROM kerja_komentar m JOIN kerja_kartu mk ON mk.id = m.kartu_id
                    WHERE mk.ruang_id = $1 AND NOT m.dihapus AND m.tsv @@ websearch_to_tsquery($${q + 2}::regconfig, $${q})))`);
    }
    if (query.papan) {
      params.push(query.papan);
      where.push(`c.papan_id = $${params.length}`);
    }
    if (query.label) {
      params.push(query.label);
      where.push(`k.id IN (SELECT kartu_id FROM kerja_kartu_label WHERE label_id = $${params.length})`);
    }
    if (query.orang) {
      params.push(query.orang);
      where.push(`k.id IN (SELECT kartu_id FROM kerja_kartu_orang WHERE person_id = $${params.length})`);
    }
    if (query.status === "terbuka") where.push("k.selesai_jenis IS NULL");
    else if (query.status !== "semua") {
      params.push(query.status);
      where.push(`k.selesai_jenis = $${params.length}`);
    }
    if (query.tenggat_dari) {
      params.push(query.tenggat_dari);
      where.push(`k.tenggat_pada >= ($${params.length}::date AT TIME ZONE 'Asia/Jakarta')`);
    }
    if (query.tenggat_sampai) {
      params.push(query.tenggat_sampai);
      where.push(`k.tenggat_pada < (($${params.length}::date + 1) AT TIME ZONE 'Asia/Jakarta')`);
    }
    if (query.arsip === "false") where.push("NOT k.arsip");
    const view = await this.directory.view();
    const cards = await cardSummaries(this.pool, where.join(" AND "), params, "k.diperbarui_pada DESC LIMIT 100");
    return { items: cards.map((card) => withPeople(card, view)) };
  }
}
