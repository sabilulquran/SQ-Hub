import { randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { z } from "zod";

import { requireCardWritable, requireVia, roomMembers, type Viewer } from "./access.js";
import { forbidden, invalid, KerjaError, withTransaction } from "./db.js";
import type { KerjaDirectory } from "./directory.js";
import { sanitizeForDisplay, sanitizeHtml } from "./html.js";
import { assertAssignable, notify } from "./papan.js";
import { personRef } from "./ruang.js";

const personId = z.string().regex(/^hcis:employee:[0-9a-f-]{36}$/);
const instant = z.string().datetime({ offset: true });

export const checklistSchema = z.object({ nama: z.string().trim().min(1).max(120) }).strict();
export const itemCreateSchema = z.object({
  nama: z.string().trim().min(1).max(300),
  tenggat_pada: instant.nullable().optional(),
  orang: z.array(personId).max(20).optional(),
}).strict();
export const itemUpdateSchema = z.object({
  nama: z.string().trim().min(1).max(300).optional(),
  tenggat_pada: instant.nullable().optional(),
  selesai: z.boolean().optional(),
  orang: z.array(personId).max(20).optional(),
}).strict();
export const commentSchema = z.object({ isi: z.string().min(1).max(20000), induk_id: z.string().uuid().optional() }).strict();
export const commentUpdateSchema = z.object({ isi: z.string().min(1).max(20000) }).strict();

const STEP = 1024;

export class KerjaCards {
  constructor(
    private readonly pool: Pool,
    private readonly directory: KerjaDirectory,
  ) {}

  /** §8 Kartu: everything one card shows, for every role that can read the room. */
  async detail(viewer: Viewer, kartuId: string) {
    const akses = await requireVia(this.pool, "kartu", kartuId, viewer, "baca");
    const view = await this.directory.view();
    const card = (await this.pool.query<{
      id: string; ruang_id: string; ruang_nama: string; papan_id: string; papan_nama: string; kolom_id: string; kolom_nama: string;
      judul: string; uraian: string; mulai_pada: Date | null; tenggat_pada: Date | null; selesai_jenis: string | null; selesai_pada: Date | null;
      selesai_oleh: string | null; arsip: boolean; dibuat_oleh: string; dibuat_pada: Date;
    }>(
      `SELECT k.id, k.ruang_id, r.nama AS ruang_nama, p.id AS papan_id, p.nama AS papan_nama, k.kolom_id, c.nama AS kolom_nama,
              k.judul, k.uraian, k.mulai_pada, k.tenggat_pada, k.selesai_jenis, k.selesai_pada, k.selesai_oleh, k.arsip, k.dibuat_oleh, k.dibuat_pada
       FROM kerja_kartu k JOIN kerja_kolom c ON c.id = k.kolom_id JOIN kerja_papan p ON p.id = c.papan_id JOIN kerja_ruang r ON r.id = k.ruang_id
       WHERE k.id = $1`,
      [kartuId],
    )).rows[0]!;
    const [labels, people, lists, items, itemPeople, comments, attachments, history, columns] = await Promise.all([
      this.pool.query<{ id: string; nama: string; warna: string }>(
        "SELECT l.id, l.nama, l.warna FROM kerja_kartu_label kl JOIN kerja_label l ON l.id = kl.label_id WHERE kl.kartu_id = $1 AND NOT l.dihapus ORDER BY l.nama",
        [kartuId],
      ),
      this.pool.query<{ person_id: string }>("SELECT person_id FROM kerja_kartu_orang WHERE kartu_id = $1 ORDER BY person_id", [kartuId]),
      this.pool.query<{ id: string; nama: string }>("SELECT id, nama FROM kerja_ceklis WHERE kartu_id = $1 AND NOT dihapus ORDER BY urutan, id", [kartuId]),
      this.pool.query<{ id: string; ceklis_id: string; nama: string; tenggat_pada: Date | null; selesai: boolean }>(
        `SELECT i.id, i.ceklis_id, i.nama, i.tenggat_pada, i.selesai FROM kerja_ceklis_item i JOIN kerja_ceklis c ON c.id = i.ceklis_id
         WHERE c.kartu_id = $1 AND NOT c.dihapus AND NOT i.dihapus ORDER BY i.urutan, i.id`,
        [kartuId],
      ),
      this.pool.query<{ item_id: string; person_id: string }>(
        `SELECT o.item_id, o.person_id FROM kerja_ceklis_item_orang o JOIN kerja_ceklis_item i ON i.id = o.item_id JOIN kerja_ceklis c ON c.id = i.ceklis_id
         WHERE c.kartu_id = $1`,
        [kartuId],
      ),
      this.pool.query<{ id: string; induk_id: string | null; penulis: string; isi: string; dibuat_pada: Date; disunting_pada: Date | null; dihapus: boolean }>(
        "SELECT id, induk_id, penulis, isi, dibuat_pada, disunting_pada, dihapus FROM kerja_komentar WHERE kartu_id = $1 ORDER BY dibuat_pada, id",
        [kartuId],
      ),
      this.pool.query<{ id: string; pemilik_jenis: string; pemilik_id: string; nama: string; mime: string; ukuran: string; diunggah_oleh: string; diunggah_pada: Date; di_arsip: boolean }>(
        `SELECT a.id, a.pemilik_jenis, a.pemilik_id, a.nama, a.mime, a.ukuran, a.diunggah_oleh, a.diunggah_pada, a.di_arsip FROM kerja_lampiran a
         WHERE NOT a.dihapus AND ((a.pemilik_jenis = 'kartu' AND a.pemilik_id = $1)
           OR (a.pemilik_jenis = 'ceklis_item' AND a.pemilik_id IN (
             SELECT i.id FROM kerja_ceklis_item i JOIN kerja_ceklis c ON c.id = i.ceklis_id WHERE c.kartu_id = $1)))
         ORDER BY a.diunggah_pada`,
        [kartuId],
      ),
      this.pool.query<{ aksi: string; aktor: string; pada: Date; lama: unknown; baru: unknown }>(
        "SELECT aksi, aktor, pada, lama, baru FROM kerja_riwayat WHERE kartu_id = $1 ORDER BY pada DESC, id DESC LIMIT 200",
        [kartuId],
      ),
      this.pool.query<{ id: string; nama: string }>(
        "SELECT c.id, c.nama FROM kerja_kolom c JOIN kerja_papan p ON p.id = c.papan_id WHERE p.ruang_id = $1 AND NOT c.dihapus",
        [card.ruang_id],
      ),
    ]);
    const columnName = new Map(columns.rows.map((row) => [row.id, row.nama]));
    const actorRef = (actor: string) => actor.startsWith("hcis:employee:") ? personRef(view, actor) : { id: actor, nama: "Sistem", aktif: true };
    const attachment = (row: (typeof attachments.rows)[number]) => ({
      id: row.id, nama: row.nama, mime: row.mime, ukuran: Number(row.ukuran), diunggahOleh: actorRef(row.diunggah_oleh),
      diunggahPada: row.diunggah_pada.toISOString(), diArsip: row.di_arsip,
    });
    const topLevel = comments.rows.filter((row) => row.induk_id === null);
    const comment = (row: (typeof comments.rows)[number]) => ({
      id: row.id,
      penulis: actorRef(row.penulis),
      isi: row.dihapus ? "" : sanitizeForDisplay(row.isi),
      dihapus: row.dihapus,
      dibuatPada: row.dibuat_pada.toISOString(),
      disuntingPada: row.disunting_pada?.toISOString() ?? null,
      milikSaya: row.penulis === viewer.personId,
    });
    return {
      id: card.id,
      ruang: { id: card.ruang_id, nama: card.ruang_nama, peranSaya: akses.peran, status: akses.status },
      papan: { id: card.papan_id, nama: card.papan_nama },
      kolom: { id: card.kolom_id, nama: card.kolom_nama },
      judul: card.judul,
      uraian: sanitizeForDisplay(card.uraian),
      mulaiPada: card.mulai_pada?.toISOString() ?? null,
      tenggatPada: card.tenggat_pada?.toISOString() ?? null,
      selesai: card.selesai_jenis ? { jenis: card.selesai_jenis, pada: card.selesai_pada!.toISOString(), oleh: actorRef(card.selesai_oleh!) } : null,
      arsip: card.arsip,
      dibuatOleh: actorRef(card.dibuat_oleh),
      dibuatPada: card.dibuat_pada.toISOString(),
      label: labels.rows,
      orang: people.rows.map((row) => personRef(view, row.person_id)),
      ceklis: lists.rows.map((list) => {
        const own = items.rows.filter((item) => item.ceklis_id === list.id);
        return {
          id: list.id,
          nama: list.nama,
          kemajuan: { selesai: own.filter((item) => item.selesai).length, total: own.length },
          butir: own.map((item) => ({
            id: item.id, nama: item.nama, tenggatPada: item.tenggat_pada?.toISOString() ?? null, selesai: item.selesai,
            orang: itemPeople.rows.filter((row) => row.item_id === item.id).map((row) => personRef(view, row.person_id)),
            lampiran: attachments.rows.filter((row) => row.pemilik_jenis === "ceklis_item" && row.pemilik_id === item.id).map(attachment),
          })),
        };
      }),
      komentar: topLevel.map((row) => ({ ...comment(row), balasan: comments.rows.filter((reply) => reply.induk_id === row.id).map(comment) })),
      lampiran: attachments.rows.filter((row) => row.pemilik_jenis === "kartu").map(attachment),
      riwayat: history.rows.map((row) => ({
        aksi: row.aksi, aktor: actorRef(row.aktor), pada: row.pada.toISOString(),
        lama: describe(row.lama, columnName, view), baru: describe(row.baru, columnName, view),
      })),
    };
  }

  // ---- checklists (§6.2): every item is a full subtask ----

  async createChecklist(viewer: Viewer, kartuId: string, input: z.infer<typeof checklistSchema>) {
    await requireVia(this.pool, "kartu", kartuId, viewer, "kerja");
    await requireCardWritable(this.pool, kartuId);
    const id = randomUUID();
    await this.pool.query(
      "INSERT INTO kerja_ceklis (id, kartu_id, nama, urutan) SELECT $1, $2, $3, COALESCE(max(urutan) + 1, 0) FROM kerja_ceklis WHERE kartu_id = $2",
      [id, kartuId, input.nama],
    );
    return { id };
  }

  async updateChecklist(viewer: Viewer, ceklisId: string, input: z.infer<typeof checklistSchema>) {
    await requireVia(this.pool, "ceklis", ceklisId, viewer, "kerja");
    await requireCardWritable(this.pool, await this.cardOf("ceklis", ceklisId));
    await this.pool.query("UPDATE kerja_ceklis SET nama = $2 WHERE id = $1", [ceklisId, input.nama]);
    return { id: ceklisId };
  }

  async deleteChecklist(viewer: Viewer, ceklisId: string) {
    await requireVia(this.pool, "ceklis", ceklisId, viewer, "kerja");
    await requireCardWritable(this.pool, await this.cardOf("ceklis", ceklisId));
    await this.pool.query("UPDATE kerja_ceklis SET dihapus = true WHERE id = $1", [ceklisId]);
    return { id: ceklisId };
  }

  async createItem(viewer: Viewer, ceklisId: string, input: z.infer<typeof itemCreateSchema>) {
    const akses = await requireVia(this.pool, "ceklis", ceklisId, viewer, "kerja");
    const kartuId = await this.cardOf("ceklis", ceklisId);
    await requireCardWritable(this.pool, kartuId);
    const members = await roomMembers(this.pool, akses.ruangId);
    const people = [...new Set(input.orang ?? [])];
    assertAssignable(people, members);
    const id = randomUUID();
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO kerja_ceklis_item (id, ceklis_id, nama, tenggat_pada, urutan)
         SELECT $1, $2, $3, $4, COALESCE(max(urutan), 0) + ${STEP} FROM kerja_ceklis_item WHERE ceklis_id = $2`,
        [id, ceklisId, input.nama, input.tenggat_pada ?? null],
      );
      for (const person of people) await client.query("INSERT INTO kerja_ceklis_item_orang (item_id, person_id) VALUES ($1, $2)", [id, person]);
      await notify(client, people.filter((person) => person !== viewer.personId), "penugasan", kartuId);
    });
    return { id };
  }

  async updateItem(viewer: Viewer, itemId: string, input: z.infer<typeof itemUpdateSchema>) {
    const akses = await requireVia(this.pool, "item", itemId, viewer, "kerja");
    const kartuId = await this.cardOf("item", itemId);
    await requireCardWritable(this.pool, kartuId);
    const members = await roomMembers(this.pool, akses.ruangId);
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `UPDATE kerja_ceklis_item SET nama = COALESCE($2, nama),
           tenggat_pada = CASE WHEN $3 THEN $4::timestamptz ELSE tenggat_pada END,
           selesai = COALESCE($5, selesai),
           selesai_pada = CASE WHEN $5 IS NULL THEN selesai_pada WHEN $5 THEN COALESCE(selesai_pada, now()) ELSE NULL END,
           selesai_oleh = CASE WHEN $5 IS NULL THEN selesai_oleh WHEN $5 THEN COALESCE(selesai_oleh, $6) ELSE NULL END
         WHERE id = $1`,
        [itemId, input.nama ?? null, input.tenggat_pada !== undefined, input.tenggat_pada ?? null, input.selesai ?? null, viewer.actor],
      );
      if (input.orang) {
        const wanted = [...new Set(input.orang)];
        const current = new Set((await client.query<{ person_id: string }>("SELECT person_id FROM kerja_ceklis_item_orang WHERE item_id = $1", [itemId])).rows.map((r) => r.person_id));
        const added = wanted.filter((person) => !current.has(person));
        assertAssignable(added, members);
        await client.query("DELETE FROM kerja_ceklis_item_orang WHERE item_id = $1 AND NOT (person_id = ANY($2::text[]))", [itemId, wanted]);
        for (const person of added) await client.query("INSERT INTO kerja_ceklis_item_orang (item_id, person_id) VALUES ($1, $2)", [itemId, person]);
        await notify(client, added.filter((person) => person !== viewer.personId), "penugasan", kartuId);
      }
    });
    return { id: itemId };
  }

  async deleteItem(viewer: Viewer, itemId: string) {
    await requireVia(this.pool, "item", itemId, viewer, "kerja");
    await requireCardWritable(this.pool, await this.cardOf("item", itemId));
    await this.pool.query("UPDATE kerja_ceklis_item SET dihapus = true WHERE id = $1", [itemId]);
    return { id: itemId };
  }

  // ---- comments (§6.3): two levels, then stop ----

  async comment(viewer: Viewer, kartuId: string, input: z.infer<typeof commentSchema>) {
    const akses = await requireVia(this.pool, "kartu", kartuId, viewer, "kerja");
    await requireCardWritable(this.pool, kartuId);
    if (input.induk_id) {
      const parent = (await this.pool.query<{ kartu_id: string; induk_id: string | null; dihapus: boolean }>(
        "SELECT kartu_id, induk_id, dihapus FROM kerja_komentar WHERE id = $1",
        [input.induk_id],
      )).rows[0];
      if (!parent || parent.kartu_id !== kartuId) invalid("Komentar induk tidak ditemukan pada kartu ini.", "induk_tidak_sah");
      if (parent.induk_id !== null) invalid("Balasan tidak bisa dibalas lagi; balas komentar induknya.", "balasan_bersarang");
    }
    const members = await roomMembers(this.pool, akses.ruangId);
    const body = sanitizeHtml(input.isi, (id) => members.has(id));
    if (body.text.length === 0) invalid("Komentar tidak boleh kosong.", "komentar_kosong");
    const id = randomUUID();
    await withTransaction(this.pool, async (client) => {
      await client.query(
        "INSERT INTO kerja_komentar (id, kartu_id, induk_id, penulis, isi, isi_teks) VALUES ($1, $2, $3, $4, $5, $6)",
        [id, kartuId, input.induk_id ?? null, viewer.actor, body.html, body.text.slice(0, 10000)],
      );
      await notify(client, body.mentions.filter((person) => person !== viewer.personId), "sebutan", kartuId);
    });
    return { id };
  }

  async editComment(viewer: Viewer, komentarId: string, input: z.infer<typeof commentUpdateSchema>) {
    const akses = await requireVia(this.pool, "komentar", komentarId, viewer, "kerja");
    const row = (await this.pool.query<{ penulis: string; kartu_id: string; dihapus: boolean; isi: string }>(
      "SELECT penulis, kartu_id, dihapus, isi FROM kerja_komentar WHERE id = $1",
      [komentarId],
    )).rows[0]!;
    if (row.penulis !== viewer.actor) forbidden("Hanya penulis yang bisa menyunting komentarnya.");
    if (row.dihapus) throw new KerjaError(409, "komentar_dihapus", "Komentar ini sudah dihapus.");
    await requireCardWritable(this.pool, row.kartu_id);
    const members = await roomMembers(this.pool, akses.ruangId);
    const before = new Set(sanitizeHtml(row.isi, () => true).mentions);
    const body = sanitizeHtml(input.isi, (id) => members.has(id));
    if (body.text.length === 0) invalid("Komentar tidak boleh kosong.", "komentar_kosong");
    await withTransaction(this.pool, async (client) => {
      await client.query("UPDATE kerja_komentar SET isi = $2, isi_teks = $3, disunting_pada = now() WHERE id = $1", [komentarId, body.html, body.text.slice(0, 10000)]);
      await notify(client, body.mentions.filter((person) => !before.has(person) && person !== viewer.personId), "sebutan", row.kartu_id);
    });
    return { id: komentarId };
  }

  /** KERJA-001 §7.3 nomor 3: the text is emptied, the row stays so replies keep their parent. */
  async deleteComment(viewer: Viewer, komentarId: string) {
    const akses = await requireVia(this.pool, "komentar", komentarId, viewer, "kerja");
    const row = (await this.pool.query<{ penulis: string; dihapus: boolean }>("SELECT penulis, dihapus FROM kerja_komentar WHERE id = $1", [komentarId])).rows[0]!;
    if (row.penulis !== viewer.actor && akses.peran !== "pj") forbidden("Hanya penulis atau penanggung jawab ruang yang bisa menghapus komentar.");
    if (row.dihapus) return { id: komentarId };
    await this.pool.query("UPDATE kerja_komentar SET dihapus = true, isi = '', isi_teks = '' WHERE id = $1", [komentarId]);
    return { id: komentarId };
  }

  private async cardOf(jenis: "ceklis" | "item", id: string): Promise<string> {
    const sql = jenis === "ceklis"
      ? "SELECT kartu_id FROM kerja_ceklis WHERE id = $1"
      : "SELECT c.kartu_id FROM kerja_ceklis_item i JOIN kerja_ceklis c ON c.id = i.ceklis_id WHERE i.id = $1";
    return (await this.pool.query<{ kartu_id: string }>(sql, [id])).rows[0]!.kartu_id;
  }
}

/** History values carry ids; the card view names the column and person they point to. */
function describe(value: unknown, columns: Map<string, string>, view: Awaited<ReturnType<KerjaDirectory["view"]>>): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  if (typeof out.kolom_id === "string") out.kolom = columns.get(out.kolom_id) ?? "kolom yang dihapus";
  if (typeof out.person_id === "string") out.orang = personRef(view, out.person_id).nama;
  return out;
}
