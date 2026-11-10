import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";
import { z } from "zod";

import { requireCardWritable, requireRoom, requireVia, roomMembers, type Viewer } from "./access.js";
import { invalid, KerjaError, notFound, withTransaction, writeHistory, type Db } from "./db.js";
import type { KerjaDirectory } from "./directory.js";
import { sanitizeHtml } from "./html.js";
import { createDefaultBoard, personRef } from "./ruang.js";

const uuid = z.string().uuid();
const personId = z.string().regex(/^hcis:employee:[0-9a-f-]{36}$/);
const instant = z.string().datetime({ offset: true });
const warna = z.enum(["abu", "merah", "oranye", "kuning", "hijau", "teal", "biru", "ungu", "merah-muda"]);
const jenisSelesai = z.enum(["tuntas", "batal", "ditunda"]);

export const boardSchema = z.object({ nama: z.string().trim().min(1).max(80) }).strict();
export const columnSchema = z.object({ nama: z.string().trim().min(1).max(60), menandai_selesai: z.boolean().default(false) }).strict();
export const columnUpdateSchema = z.object({ nama: z.string().trim().min(1).max(60).optional(), menandai_selesai: z.boolean().optional(), urutan: z.number().int().min(0).max(1000).optional() }).strict();
export const labelSchema = z.object({ nama: z.string().trim().min(1).max(40), warna }).strict();
export const labelUpdateSchema = z.object({ nama: z.string().trim().min(1).max(40).optional(), warna: warna.optional() }).strict();
export const cardCreateSchema = z.object({
  judul: z.string().trim().min(1).max(200),
  uraian: z.string().max(40000).optional(),
  mulai_pada: instant.nullable().optional(),
  tenggat_pada: instant.nullable().optional(),
  orang: z.array(personId).max(20).optional(),
}).strict();
export const cardUpdateSchema = z.object({
  judul: z.string().trim().min(1).max(200).optional(),
  uraian: z.string().max(40000).optional(),
  mulai_pada: instant.nullable().optional(),
  tenggat_pada: instant.nullable().optional(),
}).strict();
export const moveSchema = z.object({ kolom_id: uuid, indeks: z.number().int().min(0).max(100000), selesai_jenis: jenisSelesai.optional() }).strict();
export const closeSchema = z.object({ jenis: jenisSelesai }).strict();
export const peopleSchema = z.object({ orang: z.array(personId).max(20) }).strict();
export const labelsSchema = z.object({ label: z.array(uuid).max(20) }).strict();
export const copySchema = z.object({
  kolom_id: uuid.optional(),
  judul: z.string().trim().min(1).max(200).optional(),
  label: z.boolean().default(false),
  orang: z.boolean().default(false),
  ceklis: z.boolean().default(false),
  ceklis_isi: z.boolean().default(false),
  lampiran: z.boolean().default(false),
}).strict();
export const tasksQuerySchema = z.object({
  ruang: uuid.optional(),
  label: uuid.optional(),
  status: z.enum(["terbuka", "selesai", "semua"]).default("terbuka"),
}).strict();

/** §6.1: a column is rebalanced when two neighbours are closer than this. */
export const REBALANCE_GAP = "0.000000001";
const STEP = 1024;

export interface CopyAttachments {
  /** Pushes every file it writes to `written`, so the caller can remove them if the transaction fails. */
  copyForCard(client: PoolClient, input: { fromKartuId: string; toKartuId: string; ruangId: string; actor: string; written: string[] }): Promise<void>;
  discard(paths: string[]): Promise<void>;
}

export class KerjaBoards {
  constructor(
    private readonly pool: Pool,
    private readonly directory: KerjaDirectory,
    private readonly attachments: CopyAttachments,
  ) {}

  // ---- boards, columns, labels (pj, §7.3) ----

  async createBoard(viewer: Viewer, ruangId: string, input: z.infer<typeof boardSchema>) {
    await requireRoom(this.pool, ruangId, viewer, "kelola");
    const id = await withTransaction(this.pool, (client) => createDefaultBoard(client, ruangId, input.nama));
    return this.board(viewer, id);
  }

  async renameBoard(viewer: Viewer, papanId: string, input: z.infer<typeof boardSchema>) {
    await requireVia(this.pool, "papan", papanId, viewer, "kelola");
    await this.pool.query("UPDATE kerja_papan SET nama = $2 WHERE id = $1", [papanId, input.nama]);
    return this.board(viewer, papanId);
  }

  async createColumn(viewer: Viewer, papanId: string, input: z.infer<typeof columnSchema>) {
    await requireVia(this.pool, "papan", papanId, viewer, "kelola");
    await this.pool.query(
      `INSERT INTO kerja_kolom (id, papan_id, nama, urutan, menandai_selesai)
       SELECT $1, $2, $3, COALESCE(max(urutan) + 1, 0), $4 FROM kerja_kolom WHERE papan_id = $2 AND NOT dihapus`,
      [randomUUID(), papanId, input.nama, input.menandai_selesai],
    );
    return this.board(viewer, papanId);
  }

  async updateColumn(viewer: Viewer, kolomId: string, input: z.infer<typeof columnUpdateSchema>) {
    await requireVia(this.pool, "kolom", kolomId, viewer, "kelola");
    const papanId = await withTransaction(this.pool, async (client) => {
      const column = (await client.query<{ papan_id: string; urutan: number }>("SELECT papan_id, urutan FROM kerja_kolom WHERE id = $1 FOR UPDATE", [kolomId])).rows[0]!;
      if (input.urutan !== undefined) {
        const ids = (await client.query<{ id: string }>("SELECT id FROM kerja_kolom WHERE papan_id = $1 AND NOT dihapus AND id <> $2 ORDER BY urutan, id", [column.papan_id, kolomId])).rows.map((r) => r.id);
        ids.splice(Math.min(input.urutan, ids.length), 0, kolomId);
        for (const [index, id] of ids.entries()) await client.query("UPDATE kerja_kolom SET urutan = $2 WHERE id = $1", [id, index]);
      }
      await client.query(
        "UPDATE kerja_kolom SET nama = COALESCE($2, nama), menandai_selesai = COALESCE($3, menandai_selesai) WHERE id = $1",
        [kolomId, input.nama ?? null, input.menandai_selesai ?? null],
      );
      return column.papan_id;
    });
    return this.board(viewer, papanId);
  }

  /** Only an empty column can go; archived cards in it move to the board's first column. */
  async deleteColumn(viewer: Viewer, kolomId: string) {
    await requireVia(this.pool, "kolom", kolomId, viewer, "kelola");
    const papanId = await withTransaction(this.pool, async (client) => {
      const column = (await client.query<{ papan_id: string }>("SELECT papan_id FROM kerja_kolom WHERE id = $1 FOR UPDATE", [kolomId])).rows[0]!;
      const open = await client.query("SELECT 1 FROM kerja_kartu WHERE kolom_id = $1 AND NOT arsip LIMIT 1", [kolomId]);
      if (open.rowCount) throw new KerjaError(409, "kolom_berisi", "Pindahkan atau arsipkan kartu di kolom ini dulu.");
      const others = await client.query<{ id: string }>("SELECT id FROM kerja_kolom WHERE papan_id = $1 AND NOT dihapus AND id <> $2 ORDER BY urutan LIMIT 1", [column.papan_id, kolomId]);
      if (!others.rows[0]) throw new KerjaError(409, "kolom_terakhir", "Papan harus punya setidaknya satu kolom.");
      await client.query("UPDATE kerja_kartu SET kolom_id = $2 WHERE kolom_id = $1", [kolomId, others.rows[0].id]);
      await client.query("UPDATE kerja_kolom SET dihapus = true WHERE id = $1", [kolomId]);
      return column.papan_id;
    });
    return this.board(viewer, papanId);
  }

  async createLabel(viewer: Viewer, papanId: string, input: z.infer<typeof labelSchema>) {
    await requireVia(this.pool, "papan", papanId, viewer, "kelola");
    await this.pool.query("INSERT INTO kerja_label (id, papan_id, nama, warna) VALUES ($1, $2, $3, $4)", [randomUUID(), papanId, input.nama, input.warna]);
    return this.board(viewer, papanId);
  }

  async updateLabel(viewer: Viewer, labelId: string, input: z.infer<typeof labelUpdateSchema>) {
    await requireVia(this.pool, "label", labelId, viewer, "kelola");
    const result = await this.pool.query<{ papan_id: string }>(
      "UPDATE kerja_label SET nama = COALESCE($2, nama), warna = COALESCE($3, warna) WHERE id = $1 RETURNING papan_id",
      [labelId, input.nama ?? null, input.warna ?? null],
    );
    return this.board(viewer, result.rows[0]!.papan_id);
  }

  async deleteLabel(viewer: Viewer, labelId: string) {
    await requireVia(this.pool, "label", labelId, viewer, "kelola");
    const papanId = await withTransaction(this.pool, async (client) => {
      await client.query("DELETE FROM kerja_kartu_label WHERE label_id = $1", [labelId]);
      const result = await client.query<{ papan_id: string }>("UPDATE kerja_label SET dihapus = true WHERE id = $1 RETURNING papan_id", [labelId]);
      return result.rows[0]!.papan_id;
    });
    return this.board(viewer, papanId);
  }

  // ---- board view ----

  async board(viewer: Viewer, papanId: string) {
    const akses = await requireVia(this.pool, "papan", papanId, viewer, "baca");
    const view = await this.directory.view();
    const papan = (await this.pool.query<{ id: string; nama: string; ruang_id: string; ruang_nama: string; ruang_status: string }>(
      `SELECT p.id, p.nama, p.ruang_id, r.nama AS ruang_nama, r.status AS ruang_status FROM kerja_papan p JOIN kerja_ruang r ON r.id = p.ruang_id WHERE p.id = $1`,
      [papanId],
    )).rows[0]!;
    const columns = await this.pool.query<{ id: string; nama: string; menandai_selesai: boolean }>(
      "SELECT id, nama, menandai_selesai FROM kerja_kolom WHERE papan_id = $1 AND NOT dihapus ORDER BY urutan, id",
      [papanId],
    );
    const labels = await this.pool.query<{ id: string; nama: string; warna: string }>(
      "SELECT id, nama, warna FROM kerja_label WHERE papan_id = $1 AND NOT dihapus ORDER BY nama",
      [papanId],
    );
    const cards = await cardSummaries(this.pool, "k.kolom_id IN (SELECT id FROM kerja_kolom WHERE papan_id = $1 AND NOT dihapus) AND NOT k.arsip", [papanId]);
    const otherBoards = await this.pool.query<{ id: string; nama: string }>("SELECT id, nama FROM kerja_papan WHERE ruang_id = $1 ORDER BY urutan, dibuat_pada", [papan.ruang_id]);
    const members = await this.pool.query<{ person_id: string; peran: string }>("SELECT person_id, peran FROM kerja_ruang_anggota WHERE ruang_id = $1", [papan.ruang_id]);
    return {
      id: papan.id,
      nama: papan.nama,
      ruang: { id: papan.ruang_id, nama: papan.ruang_nama, status: papan.ruang_status, peranSaya: akses.peran },
      papanRuang: otherBoards.rows,
      label: labels.rows,
      anggota: members.rows.map((member) => ({ ...personRef(view, member.person_id), peran: member.peran })),
      kolom: columns.rows.map((column) => ({
        id: column.id,
        nama: column.nama,
        menandaiSelesai: column.menandai_selesai,
        kartu: cards.filter((card) => card.kolomId === column.id).map((card) => withPeople(card, view)),
      })),
    };
  }

  /** The room's archive (§8): archived cards, newest first. */
  async archive(viewer: Viewer, ruangId: string) {
    await requireRoom(this.pool, ruangId, viewer, "baca");
    const view = await this.directory.view();
    const cards = await cardSummaries(this.pool, "k.ruang_id = $1 AND k.arsip", [ruangId], "k.diperbarui_pada DESC LIMIT 200");
    return { items: cards.map((card) => withPeople(card, view)) };
  }

  /**
   * §8 Tugas Saya: cards and checklist items assigned to me in every room I still belong to.
   * Overdue first, then nearest deadline, then no deadline (KERJA-001 §6.7).
   */
  async myTasks(viewer: Viewer, query: z.infer<typeof tasksQuerySchema>) {
    const view = await this.directory.view();
    const conditions = [
      "k.ruang_id IN (SELECT ruang_id FROM kerja_ruang_anggota WHERE person_id = $1)",
      "NOT k.arsip",
      "(k.id IN (SELECT kartu_id FROM kerja_kartu_orang WHERE person_id = $1) OR k.id IN (" +
        "SELECT c.kartu_id FROM kerja_ceklis c JOIN kerja_ceklis_item i ON i.ceklis_id = c.id JOIN kerja_ceklis_item_orang o ON o.item_id = i.id " +
        "WHERE o.person_id = $1 AND NOT c.dihapus AND NOT i.dihapus))",
    ];
    const params: unknown[] = [viewer.personId];
    if (query.ruang) {
      params.push(query.ruang);
      conditions.push(`k.ruang_id = $${params.length}`);
    }
    if (query.label) {
      params.push(query.label);
      conditions.push(`k.id IN (SELECT kartu_id FROM kerja_kartu_label WHERE label_id = $${params.length})`);
    }
    if (query.status === "terbuka") conditions.push("k.selesai_jenis IS NULL");
    if (query.status === "selesai") conditions.push("k.selesai_jenis IS NOT NULL");
    const cards = await cardSummaries(this.pool, conditions.join(" AND "), params, "k.tenggat_pada NULLS LAST, k.dibuat_pada LIMIT 300");
    const ids = cards.map((card) => card.id);
    const items = ids.length === 0 ? [] : (await this.pool.query<{ kartu_id: string; id: string; nama: string; tenggat_pada: Date | null; selesai: boolean }>(
      `SELECT c.kartu_id, i.id, i.nama, i.tenggat_pada, i.selesai FROM kerja_ceklis c JOIN kerja_ceklis_item i ON i.ceklis_id = c.id
       JOIN kerja_ceklis_item_orang o ON o.item_id = i.id
       WHERE o.person_id = $1 AND c.kartu_id = ANY($2::uuid[]) AND NOT c.dihapus AND NOT i.dihapus ORDER BY i.urutan`,
      [viewer.personId, ids],
    )).rows;
    const mine = new Set((await this.pool.query<{ kartu_id: string }>("SELECT kartu_id FROM kerja_kartu_orang WHERE person_id = $1 AND kartu_id = ANY($2::uuid[])", [viewer.personId, ids])).rows.map((r) => r.kartu_id));
    const now = Date.now();
    const shaped = cards.map((card) => {
      const myItems = items.filter((item) => item.kartu_id === card.id).map((item) => ({ id: item.id, nama: item.nama, tenggatPada: item.tenggat_pada?.toISOString() ?? null, selesai: item.selesai }));
      const nearestItem = myItems.filter((item) => !item.selesai && item.tenggatPada).map((item) => Date.parse(item.tenggatPada!)).sort((a, b) => a - b)[0];
      const deadline = mine.has(card.id) && card.tenggatPada ? Date.parse(card.tenggatPada) : nearestItem ?? (card.tenggatPada ? Date.parse(card.tenggatPada) : null);
      return {
        ...withPeople(card, view),
        ditugaskanKeSaya: mine.has(card.id),
        butirSaya: myItems,
        tenggatEfektif: deadline === null || deadline === undefined ? null : new Date(deadline).toISOString(),
        lewatTenggat: card.selesaiJenis === null && deadline !== null && deadline !== undefined && deadline < now,
      };
    });
    shaped.sort((a, b) => {
      if (a.lewatTenggat !== b.lewatTenggat) return a.lewatTenggat ? -1 : 1;
      if (a.tenggatEfektif === null || b.tenggatEfektif === null) return a.tenggatEfektif === null ? (b.tenggatEfektif === null ? 0 : 1) : -1;
      return Date.parse(a.tenggatEfektif) - Date.parse(b.tenggatEfektif);
    });
    const rooms = await this.pool.query<{ id: string; nama: string }>(
      "SELECT r.id, r.nama FROM kerja_ruang r JOIN kerja_ruang_anggota a ON a.ruang_id = r.id WHERE a.person_id = $1 ORDER BY r.nama",
      [viewer.personId],
    );
    return { items: shaped, ruang: rooms.rows };
  }

  // ---- cards ----

  async createCard(viewer: Viewer, kolomId: string, input: z.infer<typeof cardCreateSchema>) {
    const akses = await requireVia(this.pool, "kolom", kolomId, viewer, "kerja");
    const members = await roomMembers(this.pool, akses.ruangId);
    const uraian = sanitizeHtml(input.uraian ?? "", (id) => members.has(id));
    checkDates(input.mulai_pada ?? null, input.tenggat_pada ?? null);
    const orang = [...new Set(input.orang ?? [])];
    assertAssignable(orang, members);
    const id = randomUUID();
    await withTransaction(this.pool, async (client) => {
      const column = (await client.query<{ menandai_selesai: boolean }>("SELECT menandai_selesai FROM kerja_kolom WHERE id = $1", [kolomId])).rows[0]!;
      if (column.menandai_selesai) throw new KerjaError(400, "kolom_selesai", "Kartu baru dibuat di kolom yang belum selesai.");
      await lockColumn(client, kolomId);
      const position = await client.query<{ posisi: string }>("SELECT COALESCE(max(posisi), 0) + $2 AS posisi FROM kerja_kartu WHERE kolom_id = $1 AND NOT arsip", [kolomId, STEP]);
      await client.query(
        `INSERT INTO kerja_kartu (id, ruang_id, kolom_id, judul, uraian, uraian_teks, mulai_pada, tenggat_pada, posisi, dibuat_oleh)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [id, akses.ruangId, kolomId, input.judul, uraian.html, uraian.text.slice(0, 20000), input.mulai_pada ?? null, input.tenggat_pada ?? null, position.rows[0]!.posisi, viewer.actor],
      );
      await client.query("INSERT INTO kerja_pengingat (kartu_id) VALUES ($1)", [id]);
      await writeHistory(client, { kartuId: id, aksi: "dibuat", aktor: viewer.actor, baru: { kolom_id: kolomId } });
      for (const person of orang) {
        await client.query("INSERT INTO kerja_kartu_orang (kartu_id, person_id) VALUES ($1, $2)", [id, person]);
        await writeHistory(client, { kartuId: id, aksi: "tambah_orang", aktor: viewer.actor, baru: { person_id: person } });
      }
      await notify(client, orang.filter((person) => person !== viewer.personId), "penugasan", id);
      await notify(client, uraian.mentions.filter((person) => person !== viewer.personId && !orang.includes(person)), "sebutan", id);
    });
    return { id };
  }

  async updateCard(viewer: Viewer, kartuId: string, input: z.infer<typeof cardUpdateSchema>) {
    const akses = await requireVia(this.pool, "kartu", kartuId, viewer, "kerja");
    await requireCardWritable(this.pool, kartuId);
    const members = await roomMembers(this.pool, akses.ruangId);
    await withTransaction(this.pool, async (client) => {
      const current = (await client.query<{ judul: string; uraian: string; mulai_pada: Date | null; tenggat_pada: Date | null }>(
        "SELECT judul, uraian, mulai_pada, tenggat_pada FROM kerja_kartu WHERE id = $1 FOR UPDATE",
        [kartuId],
      )).rows[0]!;
      const mulai = input.mulai_pada === undefined ? current.mulai_pada : input.mulai_pada === null ? null : new Date(input.mulai_pada);
      const tenggat = input.tenggat_pada === undefined ? current.tenggat_pada : input.tenggat_pada === null ? null : new Date(input.tenggat_pada);
      checkDates(mulai?.toISOString() ?? null, tenggat?.toISOString() ?? null);
      if (input.judul !== undefined && input.judul !== current.judul) {
        await client.query("UPDATE kerja_kartu SET judul = $2 WHERE id = $1", [kartuId, input.judul]);
        await writeHistory(client, { kartuId, aksi: "ubah_judul", aktor: viewer.actor, lama: { judul: current.judul }, baru: { judul: input.judul } });
      }
      if (input.uraian !== undefined) {
        const before = new Set(sanitizeHtml(current.uraian, () => true).mentions);
        const uraian = sanitizeHtml(input.uraian, (id) => members.has(id));
        if (uraian.html !== current.uraian) {
          await client.query("UPDATE kerja_kartu SET uraian = $2, uraian_teks = $3 WHERE id = $1", [kartuId, uraian.html, uraian.text.slice(0, 20000)]);
          // KERJA-001 §6.9 nomor 1: only the fact that the description changed.
          await writeHistory(client, { kartuId, aksi: "ubah_uraian", aktor: viewer.actor });
          await notify(client, uraian.mentions.filter((person) => !before.has(person) && person !== viewer.personId), "sebutan", kartuId);
        }
      }
      if (!sameInstant(mulai, current.mulai_pada)) {
        await client.query("UPDATE kerja_kartu SET mulai_pada = $2 WHERE id = $1", [kartuId, mulai]);
        // §6.4: changing the start clears only the two start markers.
        await client.query("UPDATE kerja_pengingat SET mulai_h1hari_pada = NULL, mulai_h1jam_pada = NULL WHERE kartu_id = $1", [kartuId]);
        await writeHistory(client, { kartuId, aksi: "ubah_mulai", aktor: viewer.actor, lama: { mulai_pada: current.mulai_pada?.toISOString() ?? null }, baru: { mulai_pada: mulai?.toISOString() ?? null } });
      }
      if (!sameInstant(tenggat, current.tenggat_pada)) {
        await client.query("UPDATE kerja_kartu SET tenggat_pada = $2 WHERE id = $1", [kartuId, tenggat]);
        await client.query("UPDATE kerja_pengingat SET tenggat_h1hari_pada = NULL, tenggat_h1jam_pada = NULL WHERE kartu_id = $1", [kartuId]);
        await writeHistory(client, { kartuId, aksi: "ubah_tenggat", aktor: viewer.actor, lama: { tenggat_pada: current.tenggat_pada?.toISOString() ?? null }, baru: { tenggat_pada: tenggat?.toISOString() ?? null } });
      }
      await client.query("UPDATE kerja_kartu SET diperbarui_pada = now() WHERE id = $1", [kartuId]);
    });
    return { id: kartuId };
  }

  /**
   * §6.1 and §6.2: `indeks` is the card's place among the target column's other open cards. The
   * new position is the midpoint of its neighbours, computed in `numeric`; a column whose gap is
   * below REBALANCE_GAP is renumbered in the same transaction. Moving into a "done" column asks
   * for the closing kind instead of guessing it; moving out of one reopens the card.
   */
  async move(viewer: Viewer, kartuId: string, input: z.infer<typeof moveSchema>) {
    const akses = await requireVia(this.pool, "kartu", kartuId, viewer, "kerja");
    await requireCardWritable(this.pool, kartuId);
    await withTransaction(this.pool, async (client) => {
      const target = (await client.query<{ ruang_id: string; menandai_selesai: boolean }>(
        "SELECT p.ruang_id, k.menandai_selesai FROM kerja_kolom k JOIN kerja_papan p ON p.id = k.papan_id WHERE k.id = $1 AND NOT k.dihapus",
        [input.kolom_id],
      )).rows[0];
      // R1 does not move cards between rooms (§6.5); a column elsewhere is simply not found.
      if (!target || target.ruang_id !== akses.ruangId) notFound();
      const card = (await client.query<{ kolom_id: string; selesai_jenis: string | null }>("SELECT kolom_id, selesai_jenis FROM kerja_kartu WHERE id = $1 FOR UPDATE", [kartuId])).rows[0]!;
      if (target.menandai_selesai && card.selesai_jenis === null && !input.selesai_jenis) {
        throw new KerjaError(400, "jenis_selesai_wajib", "Pilih jenis selesai: tuntas, batal, atau ditunda.");
      }
      await lockColumn(client, input.kolom_id);
      const posisi = await positionAt(client, input.kolom_id, kartuId, input.indeks);
      await client.query("UPDATE kerja_kartu SET kolom_id = $2, posisi = $3, diperbarui_pada = now() WHERE id = $1", [kartuId, input.kolom_id, posisi]);
      if (card.kolom_id !== input.kolom_id) {
        await writeHistory(client, { kartuId, aksi: "pindah_kolom", aktor: viewer.actor, lama: { kolom_id: card.kolom_id }, baru: { kolom_id: input.kolom_id } });
      }
      if (target.menandai_selesai && card.selesai_jenis === null) {
        await closeCard(client, kartuId, input.selesai_jenis!, viewer.actor);
      } else if (!target.menandai_selesai && card.selesai_jenis !== null && card.kolom_id !== input.kolom_id) {
        const previous = (await client.query<{ menandai_selesai: boolean }>("SELECT menandai_selesai FROM kerja_kolom WHERE id = $1", [card.kolom_id])).rows[0];
        if (previous?.menandai_selesai) await reopenCard(client, kartuId, card.selesai_jenis, viewer.actor);
      }
    });
    return { id: kartuId };
  }

  async close(viewer: Viewer, kartuId: string, input: z.infer<typeof closeSchema>) {
    await requireVia(this.pool, "kartu", kartuId, viewer, "kerja");
    await requireCardWritable(this.pool, kartuId);
    await withTransaction(this.pool, async (client) => {
      const card = (await client.query<{ selesai_jenis: string | null }>("SELECT selesai_jenis FROM kerja_kartu WHERE id = $1 FOR UPDATE", [kartuId])).rows[0]!;
      if (card.selesai_jenis !== null) throw new KerjaError(409, "sudah_selesai", "Kartu ini sudah ditutup.");
      await closeCard(client, kartuId, input.jenis, viewer.actor);
    });
    return { id: kartuId };
  }

  async reopen(viewer: Viewer, kartuId: string) {
    await requireVia(this.pool, "kartu", kartuId, viewer, "kerja");
    await requireCardWritable(this.pool, kartuId);
    await withTransaction(this.pool, async (client) => {
      const card = (await client.query<{ selesai_jenis: string | null; kolom_id: string; papan_id: string; menandai_selesai: boolean }>(
        `SELECT k.selesai_jenis, k.kolom_id, c.papan_id, c.menandai_selesai FROM kerja_kartu k JOIN kerja_kolom c ON c.id = k.kolom_id WHERE k.id = $1 FOR UPDATE OF k`,
        [kartuId],
      )).rows[0]!;
      if (card.selesai_jenis === null) throw new KerjaError(409, "belum_selesai", "Kartu ini belum ditutup.");
      await reopenCard(client, kartuId, card.selesai_jenis, viewer.actor);
      if (card.menandai_selesai) {
        // A reopened card cannot stay in a "done" column: it goes to the end of the first open one.
        const first = (await client.query<{ id: string }>("SELECT id FROM kerja_kolom WHERE papan_id = $1 AND NOT dihapus AND NOT menandai_selesai ORDER BY urutan LIMIT 1", [card.papan_id])).rows[0];
        if (first) {
          await lockColumn(client, first.id);
          const posisi = await positionAt(client, first.id, kartuId, 100000);
          await client.query("UPDATE kerja_kartu SET kolom_id = $2, posisi = $3 WHERE id = $1", [kartuId, first.id, posisi]);
          await writeHistory(client, { kartuId, aksi: "pindah_kolom", aktor: viewer.actor, lama: { kolom_id: card.kolom_id }, baru: { kolom_id: first.id } });
        }
      }
    });
    return { id: kartuId };
  }

  async setArchived(viewer: Viewer, kartuId: string, arsip: boolean) {
    await requireVia(this.pool, "kartu", kartuId, viewer, "kerja");
    await withTransaction(this.pool, async (client) => {
      const card = (await client.query<{ arsip: boolean; kolom_id: string }>("SELECT arsip, kolom_id FROM kerja_kartu WHERE id = $1 FOR UPDATE", [kartuId])).rows[0]!;
      if (card.arsip === arsip) throw new KerjaError(409, arsip ? "sudah_diarsipkan" : "tidak_diarsipkan", arsip ? "Kartu ini sudah diarsipkan." : "Kartu ini tidak diarsipkan.");
      if (!arsip) {
        // Restored to the end of its column so it never collides with cards placed meanwhile.
        await lockColumn(client, card.kolom_id);
        const posisi = await positionAt(client, card.kolom_id, kartuId, 100000);
        await client.query("UPDATE kerja_kartu SET posisi = $2 WHERE id = $1", [kartuId, posisi]);
      }
      await client.query("UPDATE kerja_kartu SET arsip = $2, diperbarui_pada = now() WHERE id = $1", [kartuId, arsip]);
      await writeHistory(client, { kartuId, aksi: arsip ? "diarsipkan" : "dipulihkan", aktor: viewer.actor });
    });
    return { id: kartuId };
  }

  /** Assignees come from the room's pj and anggota; a reviewer only reads (§7.3). */
  async setPeople(viewer: Viewer, kartuId: string, input: z.infer<typeof peopleSchema>) {
    const akses = await requireVia(this.pool, "kartu", kartuId, viewer, "kerja");
    await requireCardWritable(this.pool, kartuId);
    const members = await roomMembers(this.pool, akses.ruangId);
    const wanted = [...new Set(input.orang)];
    await withTransaction(this.pool, async (client) => {
      const current = new Set((await client.query<{ person_id: string }>("SELECT person_id FROM kerja_kartu_orang WHERE kartu_id = $1", [kartuId])).rows.map((r) => r.person_id));
      // People already on the card may stay even if they left the room (orphans, §5.6).
      assertAssignable(wanted.filter((person) => !current.has(person)), members);
      const added = wanted.filter((person) => !current.has(person));
      const removed = [...current].filter((person) => !wanted.includes(person));
      for (const person of added) {
        await client.query("INSERT INTO kerja_kartu_orang (kartu_id, person_id) VALUES ($1, $2)", [kartuId, person]);
        await writeHistory(client, { kartuId, aksi: "tambah_orang", aktor: viewer.actor, baru: { person_id: person } });
      }
      for (const person of removed) {
        await client.query("DELETE FROM kerja_kartu_orang WHERE kartu_id = $1 AND person_id = $2", [kartuId, person]);
        await writeHistory(client, { kartuId, aksi: "lepas_orang", aktor: viewer.actor, lama: { person_id: person } });
      }
      await notify(client, added.filter((person) => person !== viewer.personId), "penugasan", kartuId);
    });
    return { id: kartuId };
  }

  async setLabels(viewer: Viewer, kartuId: string, input: z.infer<typeof labelsSchema>) {
    await requireVia(this.pool, "kartu", kartuId, viewer, "kerja");
    await requireCardWritable(this.pool, kartuId);
    const wanted = [...new Set(input.label)];
    await withTransaction(this.pool, async (client) => {
      if (wanted.length > 0) {
        const valid = await client.query<{ id: string }>(
          `SELECT l.id FROM kerja_label l JOIN kerja_kolom c ON c.papan_id = l.papan_id JOIN kerja_kartu k ON k.kolom_id = c.id
           WHERE k.id = $1 AND l.id = ANY($2::uuid[]) AND NOT l.dihapus`,
          [kartuId, wanted],
        );
        if (valid.rowCount !== wanted.length) invalid("Label harus milik papan kartu ini.", "label_tidak_sah");
      }
      await client.query("DELETE FROM kerja_kartu_label WHERE kartu_id = $1", [kartuId]);
      for (const label of wanted) await client.query("INSERT INTO kerja_kartu_label (kartu_id, label_id) VALUES ($1, $2)", [kartuId, label]);
    });
    return { id: kartuId };
  }

  /**
   * §6.3: copy with separate choices. Never copied: comments, history, the closed state, sent
   * reminders. Labels only come along inside the same board.
   */
  async copy(viewer: Viewer, kartuId: string, input: z.infer<typeof copySchema>) {
    const akses = await requireVia(this.pool, "kartu", kartuId, viewer, "kerja");
    const source = (await this.pool.query<{ kolom_id: string; judul: string; uraian: string; uraian_teks: string; mulai_pada: Date | null; tenggat_pada: Date | null; papan_id: string }>(
      `SELECT k.kolom_id, k.judul, k.uraian, k.uraian_teks, k.mulai_pada, k.tenggat_pada, c.papan_id
       FROM kerja_kartu k JOIN kerja_kolom c ON c.id = k.kolom_id WHERE k.id = $1`,
      [kartuId],
    )).rows[0]!;
    let kolomId = input.kolom_id ?? source.kolom_id;
    const target = (await this.pool.query<{ ruang_id: string; papan_id: string; menandai_selesai: boolean }>(
      "SELECT p.ruang_id, k.papan_id, k.menandai_selesai FROM kerja_kolom k JOIN kerja_papan p ON p.id = k.papan_id WHERE k.id = $1 AND NOT k.dihapus",
      [kolomId],
    )).rows[0];
    if (!target || target.ruang_id !== akses.ruangId) notFound();
    if (target.menandai_selesai) {
      const first = (await this.pool.query<{ id: string }>("SELECT id FROM kerja_kolom WHERE papan_id = $1 AND NOT dihapus AND NOT menandai_selesai ORDER BY urutan LIMIT 1", [target.papan_id])).rows[0];
      if (!first) throw new KerjaError(409, "kolom_selesai", "Papan ini tidak punya kolom terbuka untuk salinan.");
      kolomId = first.id;
    }
    const members = await roomMembers(this.pool, akses.ruangId);
    const id = randomUUID();
    const written: string[] = [];
    await withTransaction(this.pool, async (client) => {
      await lockColumn(client, kolomId);
      const position = await client.query<{ posisi: string }>("SELECT COALESCE(max(posisi), 0) + $2 AS posisi FROM kerja_kartu WHERE kolom_id = $1 AND NOT arsip", [kolomId, STEP]);
      await client.query(
        `INSERT INTO kerja_kartu (id, ruang_id, kolom_id, judul, uraian, uraian_teks, mulai_pada, tenggat_pada, posisi, dibuat_oleh)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [id, akses.ruangId, kolomId, input.judul ?? `${source.judul} (salinan)`.slice(0, 200), source.uraian, source.uraian_teks, source.mulai_pada, source.tenggat_pada, position.rows[0]!.posisi, viewer.actor],
      );
      await client.query("INSERT INTO kerja_pengingat (kartu_id) VALUES ($1)", [id]);
      await writeHistory(client, { kartuId: id, aksi: "disalin", aktor: viewer.actor, baru: { dari: kartuId } });
      if (input.label && target.papan_id === source.papan_id) {
        await client.query("INSERT INTO kerja_kartu_label (kartu_id, label_id) SELECT $2, label_id FROM kerja_kartu_label WHERE kartu_id = $1", [kartuId, id]);
      }
      if (input.orang) {
        const people = (await client.query<{ person_id: string }>("SELECT person_id FROM kerja_kartu_orang WHERE kartu_id = $1", [kartuId])).rows
          .map((r) => r.person_id).filter((person) => members.get(person) === "pj" || members.get(person) === "anggota");
        for (const person of people) await client.query("INSERT INTO kerja_kartu_orang (kartu_id, person_id) VALUES ($1, $2)", [id, person]);
        await notify(client, people.filter((person) => person !== viewer.personId), "penugasan", id);
      }
      if (input.ceklis || input.ceklis_isi) {
        const lists = await client.query<{ id: string; nama: string; urutan: number }>("SELECT id, nama, urutan FROM kerja_ceklis WHERE kartu_id = $1 AND NOT dihapus ORDER BY urutan", [kartuId]);
        for (const list of lists.rows) {
          const newList = randomUUID();
          await client.query("INSERT INTO kerja_ceklis (id, kartu_id, nama, urutan) VALUES ($1, $2, $3, $4)", [newList, id, list.nama, list.urutan]);
          if (!input.ceklis_isi) continue;
          const items = await client.query<{ id: string; nama: string; tenggat_pada: Date | null; urutan: string }>(
            "SELECT id, nama, tenggat_pada, urutan FROM kerja_ceklis_item WHERE ceklis_id = $1 AND NOT dihapus ORDER BY urutan",
            [list.id],
          );
          for (const item of items.rows) {
            const newItem = randomUUID();
            // Copied items start unfinished: the closed state never comes along.
            await client.query("INSERT INTO kerja_ceklis_item (id, ceklis_id, nama, tenggat_pada, urutan) VALUES ($1, $2, $3, $4, $5)", [newItem, newList, item.nama, item.tenggat_pada, item.urutan]);
            if (input.orang) {
              await client.query(
                `INSERT INTO kerja_ceklis_item_orang (item_id, person_id)
                 SELECT $2, person_id FROM kerja_ceklis_item_orang WHERE item_id = $1 AND person_id = ANY($3::text[])`,
                [item.id, newItem, [...members.entries()].filter(([, role]) => role !== "peninjau").map(([person]) => person)],
              );
            }
          }
        }
      }
      if (input.lampiran) await this.attachments.copyForCard(client, { fromKartuId: kartuId, toKartuId: id, ruangId: akses.ruangId, actor: viewer.actor, written });
    }).catch(async (error: unknown) => {
      await this.attachments.discard(written);
      throw error;
    });
    return { id };
  }

  // ---- notifications (§6.4) ----

  async notifications(viewer: Viewer) {
    const result = await this.pool.query<{ id: string; jenis: string; kartu_id: string; judul: string; ruang_nama: string; dibuat_pada: Date; dibaca_pada: Date | null; tenggat_pada: Date | null; mulai_pada: Date | null }>(
      `SELECT n.id, n.jenis, n.kartu_id, k.judul, r.nama AS ruang_nama, n.dibuat_pada, n.dibaca_pada, k.tenggat_pada, k.mulai_pada
       FROM kerja_notifikasi n JOIN kerja_kartu k ON k.id = n.kartu_id JOIN kerja_ruang r ON r.id = k.ruang_id
       WHERE n.person_id = $1 AND k.ruang_id IN (SELECT ruang_id FROM kerja_ruang_anggota WHERE person_id = $1)
       ORDER BY n.dibuat_pada DESC LIMIT 50`,
      [viewer.personId],
    );
    return {
      belumDibaca: result.rows.filter((row) => !row.dibaca_pada).length,
      items: result.rows.map((row) => ({
        id: row.id, jenis: row.jenis, kartuId: row.kartu_id, judul: row.judul, ruang: row.ruang_nama,
        dibuatPada: row.dibuat_pada.toISOString(), dibaca: row.dibaca_pada !== null,
        tenggatPada: row.tenggat_pada?.toISOString() ?? null, mulaiPada: row.mulai_pada?.toISOString() ?? null,
      })),
    };
  }

  async markRead(viewer: Viewer, id: string | "semua") {
    if (id === "semua") await this.pool.query("UPDATE kerja_notifikasi SET dibaca_pada = now() WHERE person_id = $1 AND dibaca_pada IS NULL", [viewer.personId]);
    else await this.pool.query("UPDATE kerja_notifikasi SET dibaca_pada = now() WHERE id = $1 AND person_id = $2 AND dibaca_pada IS NULL", [id, viewer.personId]);
    return this.notifications(viewer);
  }
}

// ---- helpers shared with the card detail and search ----

export interface CardSummary {
  id: string;
  ruangId: string;
  ruangNama: string;
  papanId: string;
  papanNama: string;
  kolomId: string;
  kolomNama: string;
  judul: string;
  mulaiPada: string | null;
  tenggatPada: string | null;
  selesaiJenis: string | null;
  arsip: boolean;
  posisi: string;
  label: Array<{ id: string; nama: string; warna: string }>;
  orangIds: string[];
  ceklis: { selesai: number; total: number };
  komentar: number;
  lampiran: number;
}

export async function cardSummaries(db: Db, where: string, params: unknown[], order = "k.posisi"): Promise<CardSummary[]> {
  const result = await db.query<{
    id: string; ruang_id: string; ruang_nama: string; papan_id: string; papan_nama: string; kolom_id: string; kolom_nama: string; judul: string;
    mulai_pada: Date | null; tenggat_pada: Date | null; selesai_jenis: string | null; arsip: boolean; posisi: string;
    label: Array<{ id: string; nama: string; warna: string }> | null; orang: string[] | null; ceklis_selesai: string; ceklis_total: string; komentar: string; lampiran: string;
  }>(
    `SELECT k.id, k.ruang_id, r.nama AS ruang_nama, p.id AS papan_id, p.nama AS papan_nama, k.kolom_id, c.nama AS kolom_nama, k.judul,
            k.mulai_pada, k.tenggat_pada, k.selesai_jenis, k.arsip, k.posisi::text AS posisi,
            (SELECT json_agg(json_build_object('id', l.id, 'nama', l.nama, 'warna', l.warna) ORDER BY l.nama)
               FROM kerja_kartu_label kl JOIN kerja_label l ON l.id = kl.label_id WHERE kl.kartu_id = k.id AND NOT l.dihapus) AS label,
            (SELECT array_agg(o.person_id ORDER BY o.person_id) FROM kerja_kartu_orang o WHERE o.kartu_id = k.id) AS orang,
            (SELECT count(*) FILTER (WHERE i.selesai) FROM kerja_ceklis cl JOIN kerja_ceklis_item i ON i.ceklis_id = cl.id WHERE cl.kartu_id = k.id AND NOT cl.dihapus AND NOT i.dihapus) AS ceklis_selesai,
            (SELECT count(*) FROM kerja_ceklis cl JOIN kerja_ceklis_item i ON i.ceklis_id = cl.id WHERE cl.kartu_id = k.id AND NOT cl.dihapus AND NOT i.dihapus) AS ceklis_total,
            (SELECT count(*) FROM kerja_komentar m WHERE m.kartu_id = k.id AND NOT m.dihapus) AS komentar,
            (SELECT count(*) FROM kerja_lampiran a WHERE a.pemilik_jenis = 'kartu' AND a.pemilik_id = k.id AND NOT a.dihapus) AS lampiran
     FROM kerja_kartu k JOIN kerja_kolom c ON c.id = k.kolom_id JOIN kerja_papan p ON p.id = c.papan_id JOIN kerja_ruang r ON r.id = k.ruang_id
     WHERE ${where}
     ORDER BY ${order}`,
    params,
  );
  return result.rows.map((row) => ({
    id: row.id, ruangId: row.ruang_id, ruangNama: row.ruang_nama, papanId: row.papan_id, papanNama: row.papan_nama,
    kolomId: row.kolom_id, kolomNama: row.kolom_nama, judul: row.judul,
    mulaiPada: row.mulai_pada?.toISOString() ?? null, tenggatPada: row.tenggat_pada?.toISOString() ?? null,
    selesaiJenis: row.selesai_jenis, arsip: row.arsip, posisi: row.posisi,
    label: row.label ?? [], orangIds: row.orang ?? [],
    ceklis: { selesai: Number(row.ceklis_selesai), total: Number(row.ceklis_total) },
    komentar: Number(row.komentar), lampiran: Number(row.lampiran),
  }));
}

export function withPeople(card: CardSummary, view: Awaited<ReturnType<KerjaDirectory["view"]>>) {
  const { orangIds, ...rest } = card;
  return { ...rest, orang: orangIds.map((id) => personRef(view, id)) };
}

/** Serializes position changes inside one column so two drags never compute the same midpoint. */
async function lockColumn(client: PoolClient, kolomId: string) {
  await client.query("SELECT id FROM kerja_kolom WHERE id = $1 FOR UPDATE", [kolomId]);
}

export async function positionAt(client: PoolClient, kolomId: string, kartuId: string, indeks: number): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    // Ordered by the numeric column, never by its text form ("10240" < "2048" as text).
    const others = (await client.query<{ p: string }>(
      "SELECT k.posisi::text AS p FROM kerja_kartu k WHERE k.kolom_id = $1 AND NOT k.arsip AND k.id <> $2 ORDER BY k.posisi, k.id",
      [kolomId, kartuId],
    )).rows.map((row) => row.p);
    const index = Math.min(indeks, others.length);
    const before = index > 0 ? others[index - 1]! : null;
    const after = index < others.length ? others[index]! : null;
    if (before === null && after === null) return String(STEP);
    if (after === null) return (await client.query<{ p: string }>("SELECT ($1::numeric + $2)::numeric(30,15)::text AS p", [before, STEP])).rows[0]!.p;
    if (before === null) {
      const result = await client.query<{ p: string; tight: boolean }>(
        "SELECT ($1::numeric / 2)::numeric(30,15)::text AS p, ($1::numeric < $2::numeric) AS tight",
        [after, REBALANCE_GAP],
      );
      if (!result.rows[0]!.tight) return result.rows[0]!.p;
    } else {
      const result = await client.query<{ p: string; tight: boolean }>(
        "SELECT (($1::numeric + $2::numeric) / 2)::numeric(30,15)::text AS p, ($2::numeric - $1::numeric < $3::numeric) AS tight",
        [before, after, REBALANCE_GAP],
      );
      if (!result.rows[0]!.tight) return result.rows[0]!.p;
    }
    await rebalance(client, kolomId, kartuId);
  }
  throw new KerjaError(500, "posisi_gagal", "Urutan kartu tidak bisa dihitung.");
}

/** Renumbers a column to multiples of 1024; logged by the caller, not written to history (§6.1). */
export async function rebalance(client: PoolClient, kolomId: string, exceptKartuId: string | null = null): Promise<void> {
  await client.query(
    `UPDATE kerja_kartu k SET posisi = s.n * ${STEP}
     FROM (SELECT id, row_number() OVER (ORDER BY posisi, id) AS n FROM kerja_kartu WHERE kolom_id = $1 AND NOT arsip AND id IS DISTINCT FROM $2) s
     WHERE k.id = s.id`,
    [kolomId, exceptKartuId],
  );
}

async function closeCard(client: PoolClient, kartuId: string, jenis: string, actor: string) {
  await client.query("UPDATE kerja_kartu SET selesai_jenis = $2, selesai_pada = now(), selesai_oleh = $3, diperbarui_pada = now() WHERE id = $1", [kartuId, jenis, actor]);
  await writeHistory(client, { kartuId, aksi: "ditutup", aktor: actor, baru: { jenis } });
}

async function reopenCard(client: PoolClient, kartuId: string, previous: string, actor: string) {
  await client.query("UPDATE kerja_kartu SET selesai_jenis = NULL, selesai_pada = NULL, selesai_oleh = NULL, diperbarui_pada = now() WHERE id = $1", [kartuId]);
  await writeHistory(client, { kartuId, aksi: "dibuka", aktor: actor, lama: { jenis: previous } });
}

export async function notify(db: Db, people: string[], jenis: "penugasan" | "sebutan", kartuId: string) {
  for (const person of new Set(people)) {
    await db.query("INSERT INTO kerja_notifikasi (id, person_id, jenis, kartu_id) VALUES ($1, $2, $3, $4)", [randomUUID(), person, jenis, kartuId]);
  }
}

export function assertAssignable(people: string[], members: Map<string, string>) {
  for (const person of people) {
    const role = members.get(person);
    if (role !== "pj" && role !== "anggota") invalid("Penanggung jawab kartu harus anggota ruang yang bukan peninjau.", "orang_bukan_anggota");
  }
}

function checkDates(mulai: string | null, tenggat: string | null) {
  if (mulai && tenggat && Date.parse(mulai) > Date.parse(tenggat)) invalid("Tanggal mulai tidak boleh sesudah tenggat.", "tanggal_tidak_sah");
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}
