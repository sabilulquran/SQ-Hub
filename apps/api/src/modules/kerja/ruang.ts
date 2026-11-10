import { randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { z } from "zod";

import { isUuid, requireRoom, type Peran, type Viewer } from "./access.js";
import { invalid, KerjaError, notFound, withTransaction, writeAudit, type Db } from "./db.js";
import type { DirectoryView, KerjaDirectory } from "./directory.js";

const personId = z.string().regex(/^hcis:employee:[0-9a-f-]{36}$/);
const unitId = z.string().regex(/^hcis:org-node:[0-9a-f-]{36}$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const alasan = z.string().trim().min(1).max(500);
const peran = z.enum(["pj", "anggota", "peninjau"]);

export const createRoomSchema = z.discriminatedUnion("jenis", [
  z.object({ jenis: z.literal("tetap"), unit_id: unitId, nama: z.string().trim().min(1).max(120).optional(), pj: personId, alasan }).strict(),
  z.object({ jenis: z.literal("panitia"), nama: z.string().trim().min(1).max(120), berakhir_pada: isoDate, pj: personId, alasan }).strict(),
]);
export const updateRoomSchema = z.object({
  nama: z.string().trim().min(1).max(120).optional(),
  berakhir_pada: isoDate.optional(),
  status: z.enum(["aktif", "arsip"]).optional(),
  alasan: alasan.optional(),
}).strict();
export const adminRoomSchema = updateRoomSchema.extend({
  kuota_mb: z.number().int().min(1).max(102400).nullable().optional(),
  alasan,
}).strict();
export const memberSchema = z.object({ person_id: personId, peran, alasan }).strict();
export const memberUpdateSchema = z.object({ peran, alasan }).strict();
export const reasonSchema = z.object({ alasan }).strict();
export const candidateQuerySchema = z.object({ q: z.string().trim().max(100).default("") }).strict();

/** The first board of every new room (§5): three columns, the last one marks a card as done. */
const DEFAULT_COLUMNS: Array<{ nama: string; selesai: boolean }> = [
  { nama: "Akan dikerjakan", selesai: false },
  { nama: "Sedang dikerjakan", selesai: false },
  { nama: "Selesai", selesai: true },
];

export function jakartaDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function jakartaHour(now: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", hourCycle: "h23" }).format(now));
}

export interface PersonRef {
  id: string;
  nama: string;
  aktif: boolean;
}

export function personRef(view: DirectoryView | null, id: string): PersonRef {
  const person = view?.people.get(id);
  return { id, nama: person?.nama ?? "Tidak dikenal", aktif: person?.aktif ?? false };
}

export class KerjaRooms {
  constructor(
    private readonly pool: Pool,
    private readonly directory: KerjaDirectory,
    private readonly options: { roomQuotaBytes: number; now?: () => Date },
  ) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  async listMine(viewer: Viewer) {
    const today = jakartaDate(this.now());
    const result = await this.pool.query<{
      id: string; jenis: "tetap" | "panitia"; nama: string; status: string; berakhir_pada: string | null; peran: Peran; terbuka: string; lewat: string;
    }>(
      `SELECT r.id, r.jenis, r.nama, r.status, to_char(r.berakhir_pada, 'YYYY-MM-DD') AS berakhir_pada, a.peran,
              (SELECT count(*) FROM kerja_kartu k WHERE k.ruang_id = r.id AND NOT k.arsip AND k.selesai_jenis IS NULL) AS terbuka,
              (SELECT count(*) FROM kerja_kartu k WHERE k.ruang_id = r.id AND NOT k.arsip AND k.selesai_jenis IS NULL AND k.tenggat_pada < now()) AS lewat
       FROM kerja_ruang r JOIN kerja_ruang_anggota a ON a.ruang_id = r.id
       WHERE a.person_id = $1
       ORDER BY r.status, r.jenis DESC, r.nama`,
      [viewer.personId],
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        jenis: row.jenis,
        nama: row.nama,
        status: row.status,
        berakhirPada: row.berakhir_pada,
        akanBerakhir: row.status === "aktif" && row.berakhir_pada !== null && daysBetween(today, row.berakhir_pada) <= 30,
        peran: row.peran,
        kartuTerbuka: Number(row.terbuka),
        kartuLewatTenggat: Number(row.lewat),
      })),
    };
  }

  async get(viewer: Viewer, ruangId: string) {
    const akses = await requireRoom(this.pool, ruangId, viewer, "baca");
    const view = await this.directory.view();
    const room = await this.pool.query<{ id: string; jenis: string; nama: string; unit_id: string | null; status: string; berakhir_pada: string | null; kuota_bytes: string | null }>(
      `SELECT id, jenis, nama, unit_id, status, to_char(berakhir_pada, 'YYYY-MM-DD') AS berakhir_pada, kuota_bytes FROM kerja_ruang WHERE id = $1`,
      [ruangId],
    );
    const boards = await this.pool.query<{ id: string; nama: string }>("SELECT id, nama FROM kerja_papan WHERE ruang_id = $1 ORDER BY urutan, dibuat_pada", [ruangId]);
    const members = await this.pool.query<{ person_id: string; peran: Peran }>(
      "SELECT person_id, peran FROM kerja_ruang_anggota WHERE ruang_id = $1 ORDER BY CASE peran WHEN 'pj' THEN 0 WHEN 'anggota' THEN 1 ELSE 2 END, dicatat_pada",
      [ruangId],
    );
    const row = room.rows[0]!;
    const used = await usedBytes(this.pool, ruangId);
    return {
      id: row.id,
      jenis: row.jenis,
      nama: row.nama,
      unit: row.unit_id ? { id: row.unit_id, nama: view?.units.get(row.unit_id)?.nama ?? null } : null,
      status: row.status,
      berakhirPada: row.berakhir_pada,
      peranSaya: akses.peran,
      papan: boards.rows,
      anggota: members.rows.map((member) => ({ ...personRef(view, member.person_id), peran: member.peran })),
      kuota: { terpakai: used, batas: row.kuota_bytes ? Number(row.kuota_bytes) : this.options.roomQuotaBytes },
    };
  }

  /** §7.3: pj renames, extends a committee room, or closes and reopens the room. */
  async update(viewer: Viewer, ruangId: string, input: z.infer<typeof updateRoomSchema>) {
    const room = await this.loadRoom(ruangId);
    // A closed room can be reopened by its pj; every other write needs an active room.
    const akses = await requireRoom(this.pool, ruangId, viewer, room.status === "arsip" && input.status === "aktif" ? "baca" : "kelola");
    if (akses.peran !== "pj") throw new KerjaError(403, "peran_tidak_cukup", "Hanya penanggung jawab ruang yang bisa mengubah ruang.");
    await this.applyRoomChange(viewer.actor, room, input, false);
    return this.get(viewer, ruangId);
  }

  private async loadRoom(ruangId: string) {
    if (!isUuid(ruangId)) notFound();
    const result = await this.pool.query<{ id: string; jenis: "tetap" | "panitia"; status: "aktif" | "arsip"; unit_id: string | null; berakhir_pada: string | null }>(
      "SELECT id, jenis, status, unit_id, to_char(berakhir_pada, 'YYYY-MM-DD') AS berakhir_pada FROM kerja_ruang WHERE id = $1",
      [ruangId],
    );
    const room = result.rows[0];
    if (!room) notFound();
    return room;
  }

  private async applyRoomChange(
    actor: string,
    room: { id: string; jenis: "tetap" | "panitia"; status: "aktif" | "arsip"; unit_id: string | null; berakhir_pada: string | null },
    input: z.infer<typeof updateRoomSchema> & { kuota_mb?: number | null | undefined },
    admin: boolean,
  ) {
    const today = jakartaDate(this.now());
    const needsReason = input.berakhir_pada !== undefined || input.status !== undefined || input.kuota_mb !== undefined;
    if (needsReason && !input.alasan) invalid("Alasan wajib untuk mengubah tanggal berakhir, status, atau kuota ruang.", "alasan_wajib");
    if (input.berakhir_pada !== undefined) {
      if (room.jenis !== "panitia") invalid("Hanya ruang panitia yang punya tanggal berakhir.");
      if (input.berakhir_pada < today) invalid("Tanggal berakhir tidak boleh sebelum hari ini.");
    }
    const reopen = input.status === "aktif" && room.status === "arsip";
    if (reopen && room.jenis === "panitia" && (input.berakhir_pada ?? room.berakhir_pada ?? "") < today) {
      invalid("Perpanjang tanggal berakhir untuk membuka kembali ruang panitia ini.", "perlu_perpanjang");
    }
    await withTransaction(this.pool, async (client) => {
      try {
        await client.query(
          `UPDATE kerja_ruang SET nama = COALESCE($2, nama), berakhir_pada = COALESCE($3::date, berakhir_pada),
             status = COALESCE($4, status), kuota_bytes = CASE WHEN $5 THEN $6::bigint ELSE kuota_bytes END, diperbarui_pada = now()
           WHERE id = $1`,
          [room.id, input.nama ?? null, input.berakhir_pada ?? null, input.status ?? null, input.kuota_mb !== undefined, input.kuota_mb ? input.kuota_mb * 1024 * 1024 : null],
        );
      } catch (error) {
        if ((error as { code?: string }).code === "23505") throw new KerjaError(409, "unit_sudah_punya_ruang", "Unit ini sudah punya ruang tetap yang aktif.");
        throw error;
      }
      if (needsReason || admin) {
        await writeAudit(client, {
          aktor: actor,
          aksi: admin ? "admin.ruang.ubah" : "ruang.ubah",
          objekJenis: "ruang",
          objekRef: room.id,
          ruangId: room.id,
          alasan: input.alasan ?? "Ubah nama ruang",
          metadata: { nama: input.nama ?? null, berakhir_pada: input.berakhir_pada ?? null, status: input.status ?? null, kuota_mb: input.kuota_mb ?? null },
        });
      }
    });
  }

  async addMember(viewer: Viewer, ruangId: string, input: z.infer<typeof memberSchema>) {
    await requireRoom(this.pool, ruangId, viewer, "kelola");
    const view = await this.requireDirectory();
    const person = view.people.get(input.person_id);
    if (!person?.aktif) invalid("Orang ini tidak aktif di Organization Directory.", "orang_tidak_aktif");
    await withTransaction(this.pool, async (client) => {
      const inserted = await client.query(
        `INSERT INTO kerja_ruang_anggota (ruang_id, person_id, peran, dicatat_oleh) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [ruangId, input.person_id, input.peran, viewer.actor],
      );
      if (inserted.rowCount === 0) throw new KerjaError(409, "sudah_anggota", "Orang ini sudah anggota ruang.");
      await closeProposals(client, ruangId, input.person_id, "tambah", "diterima", viewer.actor);
      await writeAudit(client, { aktor: viewer.actor, aksi: "anggota.tambah", objekJenis: "anggota", objekRef: input.person_id, ruangId, alasan: input.alasan, metadata: { peran: input.peran } });
    });
    return this.get(viewer, ruangId);
  }

  async updateMember(viewer: Viewer, ruangId: string, person: string, input: z.infer<typeof memberUpdateSchema>) {
    await requireRoom(this.pool, ruangId, viewer, "kelola");
    await withTransaction(this.pool, async (client) => {
      await client.query("SELECT id FROM kerja_ruang WHERE id = $1 FOR UPDATE", [ruangId]);
      const current = await client.query<{ peran: Peran }>("SELECT peran FROM kerja_ruang_anggota WHERE ruang_id = $1 AND person_id = $2 FOR UPDATE", [ruangId, person]);
      if (!current.rows[0]) notFound();
      if (current.rows[0].peran === "pj" && input.peran !== "pj") await assertAnotherPj(client, ruangId, person);
      await client.query("UPDATE kerja_ruang_anggota SET peran = $3, dicatat_oleh = $4, dicatat_pada = now() WHERE ruang_id = $1 AND person_id = $2", [ruangId, person, input.peran, viewer.actor]);
      await writeAudit(client, { aktor: viewer.actor, aksi: "anggota.ubah_peran", objekJenis: "anggota", objekRef: person, ruangId, alasan: input.alasan, metadata: { lama: current.rows[0].peran, baru: input.peran } });
    });
    return this.get(viewer, ruangId);
  }

  /** Cards assigned to the person stay assigned and appear as orphans (§5.6), never disappear. */
  async removeMember(viewer: Viewer, ruangId: string, person: string, input: z.infer<typeof reasonSchema>) {
    await requireRoom(this.pool, ruangId, viewer, "kelola");
    await withTransaction(this.pool, async (client) => {
      await client.query("SELECT id FROM kerja_ruang WHERE id = $1 FOR UPDATE", [ruangId]);
      const current = await client.query<{ peran: Peran }>("SELECT peran FROM kerja_ruang_anggota WHERE ruang_id = $1 AND person_id = $2 FOR UPDATE", [ruangId, person]);
      if (!current.rows[0]) notFound();
      if (current.rows[0].peran === "pj") await assertAnotherPj(client, ruangId, person);
      await client.query("DELETE FROM kerja_ruang_anggota WHERE ruang_id = $1 AND person_id = $2", [ruangId, person]);
      await closeProposals(client, ruangId, person, "keluarkan", "diterima", viewer.actor);
      await writeAudit(client, { aktor: viewer.actor, aksi: "anggota.keluarkan", objekJenis: "anggota", objekRef: person, ruangId, alasan: input.alasan, metadata: { peran: current.rows[0].peran } });
    });
    return this.get(viewer, ruangId);
  }

  /**
   * §5.1 and §5.3: candidates are proposals, never members. A permanent room lists its unit's
   * people (suggested `anggota`) and the people of the units above it (suggested `peninjau`).
   */
  async candidates(viewer: Viewer, ruangId: string, query: z.infer<typeof candidateQuerySchema>) {
    await requireRoom(this.pool, ruangId, viewer, "kelola");
    const view = await this.requireDirectory();
    const room = await this.loadRoom(ruangId);
    const members = new Set((await this.pool.query<{ person_id: string }>("SELECT person_id FROM kerja_ruang_anggota WHERE ruang_id = $1", [ruangId])).rows.map((r) => r.person_id));
    const active = [...view.people.values()].filter((person) => person.aktif && !members.has(person.id));
    const shape = (person: { id: string; nama: string; nip: string; unitId: string | null }, saran: Peran) => ({
      id: person.id, nama: person.nama, unit: person.unitId ? view.units.get(person.unitId)?.nama ?? null : null, saran,
    });
    const unitPeople = room.unit_id ? active.filter((person) => person.unitId === room.unit_id).map((person) => shape(person, "anggota")) : [];
    const ancestorIds = room.unit_id ? new Set(view.ancestry(room.unit_id).slice(1).map((unit) => unit.id)) : new Set<string>();
    const above = active.filter((person) => person.unitId !== null && ancestorIds.has(person.unitId)).map((person) => shape(person, "peninjau"));
    const q = query.q.toLocaleLowerCase();
    const search = q.length >= 2
      ? active.filter((person) => person.nama.toLocaleLowerCase().includes(q) || person.nip.toLocaleLowerCase().includes(q)).slice(0, 25).map((person) => shape(person, "anggota"))
      : [];
    return { unit: unitPeople, atasan: above, cari: search, directory: { stale: view.stale } };
  }

  async proposals(viewer: Viewer, ruangId: string) {
    await requireRoom(this.pool, ruangId, viewer, "kelola");
    const view = await this.directory.view();
    const result = await this.pool.query<{ id: string; person_id: string; jenis: string; alasan: string; dibuat_pada: Date }>(
      "SELECT id, person_id, jenis, alasan, dibuat_pada FROM kerja_ruang_usulan WHERE ruang_id = $1 AND keputusan IS NULL ORDER BY dibuat_pada",
      [ruangId],
    );
    return { items: result.rows.map((row) => ({ id: row.id, orang: personRef(view, row.person_id), jenis: row.jenis, alasan: row.alasan, dibuatPada: row.dibuat_pada.toISOString() })) };
  }

  /**
   * Acting on a proposal is the human action §5.2 requires. Accepting "tambah" adds the person as
   * `anggota`; accepting "keluarkan" removes them. Rejecting records the decision and suppresses
   * the same proposal on later comparisons.
   */
  async actOnProposal(viewer: Viewer, usulanId: string, terima: boolean, input: z.infer<typeof reasonSchema>) {
    const found = await this.pool.query<{ ruang_id: string; person_id: string; jenis: "tambah" | "keluarkan" }>(
      "SELECT ruang_id, person_id, jenis FROM kerja_ruang_usulan WHERE id = $1 AND keputusan IS NULL",
      [usulanId],
    );
    const usulan = found.rows[0];
    if (!usulan) notFound();
    if (!terima) {
      await requireRoom(this.pool, usulan.ruang_id, viewer, "kelola");
      await withTransaction(this.pool, async (client) => {
        await client.query("UPDATE kerja_ruang_usulan SET keputusan = 'ditolak', ditindak_pada = now(), ditindak_oleh = $2 WHERE id = $1", [usulanId, viewer.actor]);
        await writeAudit(client, { aktor: viewer.actor, aksi: "usulan.tolak", objekJenis: "usulan", objekRef: usulanId, ruangId: usulan.ruang_id, alasan: input.alasan, metadata: { jenis: usulan.jenis, person_id: usulan.person_id } });
      });
      return this.get(viewer, usulan.ruang_id);
    }
    if (usulan.jenis === "tambah") return this.addMember(viewer, usulan.ruang_id, { person_id: usulan.person_id, peran: "anggota", alasan: input.alasan });
    return this.removeMember(viewer, usulan.ruang_id, usulan.person_id, input);
  }

  /** §5.6: open cards assigned to someone who left the room or is inactive in the Directory. */
  async orphans(viewer: Viewer, ruangId: string) {
    await requireRoom(this.pool, ruangId, viewer, "kelola");
    const view = await this.directory.view();
    const members = new Set((await this.pool.query<{ person_id: string }>("SELECT person_id FROM kerja_ruang_anggota WHERE ruang_id = $1", [ruangId])).rows.map((r) => r.person_id));
    const result = await this.pool.query<{ id: string; judul: string; person_id: string; tenggat_pada: Date | null }>(
      `SELECT k.id, k.judul, o.person_id, k.tenggat_pada FROM kerja_kartu k JOIN kerja_kartu_orang o ON o.kartu_id = k.id
       WHERE k.ruang_id = $1 AND NOT k.arsip AND k.selesai_jenis IS NULL ORDER BY k.tenggat_pada NULLS LAST, k.judul`,
      [ruangId],
    );
    return {
      items: result.rows
        .filter((row) => !members.has(row.person_id) || (view !== null && !view.people.get(row.person_id)?.aktif))
        .map((row) => ({ kartuId: row.id, judul: row.judul, orang: personRef(view, row.person_id), tenggatPada: row.tenggat_pada?.toISOString() ?? null })),
    };
  }

  // ---- kerja_admin (§7.2, D-2) ----

  async adminList() {
    const view = await this.directory.view();
    const result = await this.pool.query<{ id: string; jenis: string; nama: string; unit_id: string | null; status: string; berakhir_pada: string | null; kuota_bytes: string | null; anggota: string; pj: string[] }>(
      `SELECT r.id, r.jenis, r.nama, r.unit_id, r.status, to_char(r.berakhir_pada, 'YYYY-MM-DD') AS berakhir_pada, r.kuota_bytes,
              (SELECT count(*) FROM kerja_ruang_anggota a WHERE a.ruang_id = r.id) AS anggota,
              COALESCE((SELECT array_agg(a.person_id) FROM kerja_ruang_anggota a WHERE a.ruang_id = r.id AND a.peran = 'pj'), '{}') AS pj
       FROM kerja_ruang r ORDER BY r.status, r.jenis DESC, r.nama`,
    );
    const used = new Map((await this.pool.query<{ ruang_id: string; total: string }>(
      "SELECT ruang_id, sum(ukuran) AS total FROM kerja_lampiran WHERE berkas_dibuang_pada IS NULL AND NOT di_arsip GROUP BY ruang_id",
    )).rows.map((row) => [row.ruang_id, Number(row.total)]));
    const items = [];
    for (const row of result.rows) {
      items.push({
        id: row.id, jenis: row.jenis, nama: row.nama, status: row.status, berakhirPada: row.berakhir_pada,
        unit: row.unit_id ? { id: row.unit_id, nama: view?.units.get(row.unit_id)?.nama ?? null } : null,
        anggota: Number(row.anggota),
        pj: row.pj.map((id) => personRef(view, id)),
        kuota: { terpakai: used.get(row.id) ?? 0, batas: row.kuota_bytes ? Number(row.kuota_bytes) : this.options.roomQuotaBytes },
      });
    }
    return { items };
  }

  async adminUnits() {
    const view = await this.requireDirectory();
    const rooms = await this.pool.query<{ unit_id: string; id: string }>("SELECT unit_id, id FROM kerja_ruang WHERE jenis = 'tetap' AND status = 'aktif'");
    const byUnit = new Map(rooms.rows.map((row) => [row.unit_id, row.id]));
    return {
      items: [...view.units.values()].filter((unit) => unit.aktif).sort((a, b) => a.nama.localeCompare(b.nama, "id")).map((unit) => ({
        id: unit.id, nama: unit.nama, jenis: unit.jenis,
        induk: unit.indukId ? view.units.get(unit.indukId)?.nama ?? null : null,
        jumlahOrang: [...view.people.values()].filter((person) => person.aktif && person.unitId === unit.id).length,
        ruangId: byUnit.get(unit.id) ?? null,
      })),
      directory: { stale: view.stale },
    };
  }

  async adminPeople(q: string) {
    const view = await this.requireDirectory();
    const needle = q.trim().toLocaleLowerCase();
    if (needle.length < 2) return { items: [] };
    return {
      items: [...view.people.values()]
        .filter((person) => person.aktif && (person.nama.toLocaleLowerCase().includes(needle) || person.nip.toLocaleLowerCase().includes(needle)))
        .slice(0, 25)
        .map((person) => ({ id: person.id, nama: person.nama, unit: person.unitId ? view.units.get(person.unitId)?.nama ?? null : null })),
    };
  }

  /** D-2: only `kerja_admin` creates rooms in R1, each with its pj recorded at creation (§15 langkah 9). */
  async adminCreate(actor: string, input: z.infer<typeof createRoomSchema>) {
    const view = await this.requireDirectory();
    const pj = view.people.get(input.pj);
    if (!pj?.aktif) invalid("Penanggung jawab harus orang yang aktif di Organization Directory.", "orang_tidak_aktif");
    let nama: string;
    if (input.jenis === "tetap") {
      const unit = view.units.get(input.unit_id);
      if (!unit?.aktif) invalid("Unit tidak ditemukan atau tidak aktif di Organization Directory.", "unit_tidak_aktif");
      nama = input.nama ?? unit.nama;
    } else {
      if (input.berakhir_pada < jakartaDate(this.now())) invalid("Tanggal berakhir tidak boleh sebelum hari ini.");
      nama = input.nama;
    }
    const id = randomUUID();
    await withTransaction(this.pool, async (client) => {
      try {
        await client.query(
          `INSERT INTO kerja_ruang (id, jenis, nama, unit_id, berakhir_pada, dibuat_oleh) VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, input.jenis, nama, input.jenis === "tetap" ? input.unit_id : null, input.jenis === "panitia" ? input.berakhir_pada : null, actor],
        );
      } catch (error) {
        if ((error as { code?: string }).code === "23505") throw new KerjaError(409, "unit_sudah_punya_ruang", "Unit ini sudah punya ruang tetap yang aktif.");
        throw error;
      }
      await client.query(`INSERT INTO kerja_ruang_anggota (ruang_id, person_id, peran, dicatat_oleh) VALUES ($1, $2, 'pj', $3)`, [id, input.pj, actor]);
      await createDefaultBoard(client, id);
      await writeAudit(client, { aktor: actor, aksi: "admin.ruang.buat", objekJenis: "ruang", objekRef: id, ruangId: id, alasan: input.alasan, metadata: { jenis: input.jenis, pj: input.pj } });
    });
    return { id, nama };
  }

  async adminUpdate(actor: string, ruangId: string, input: z.infer<typeof adminRoomSchema>) {
    const room = await this.loadRoom(ruangId);
    await this.applyRoomChange(actor, room, input, true);
    return { id: ruangId };
  }

  /** §5.6 and D-2: kerja_admin can always name a pj, even in a room with none left. */
  async adminSetPj(actor: string, ruangId: string, input: { person_id: string; alasan: string }) {
    await this.loadRoom(ruangId);
    const view = await this.requireDirectory();
    if (!view.people.get(input.person_id)?.aktif) invalid("Penanggung jawab harus orang yang aktif di Organization Directory.", "orang_tidak_aktif");
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO kerja_ruang_anggota (ruang_id, person_id, peran, dicatat_oleh) VALUES ($1, $2, 'pj', $3)
         ON CONFLICT (ruang_id, person_id) DO UPDATE SET peran = 'pj', dicatat_oleh = EXCLUDED.dicatat_oleh, dicatat_pada = now()`,
        [ruangId, input.person_id, actor],
      );
      await writeAudit(client, { aktor: actor, aksi: "admin.ruang.tetapkan_pj", objekJenis: "anggota", objekRef: input.person_id, ruangId, alasan: input.alasan });
    });
    return { id: ruangId };
  }

  // ---- daily jobs (§5.2, §5.5) ----

  /**
   * §5.2: compares each active permanent room with its Directory unit and writes proposals.
   * Never changes membership. Skipped, and logged, while the Directory is stale.
   */
  async compareWithDirectory(): Promise<{ skipped: "stale" | "unavailable" | null; created: number }> {
    this.directory.invalidate();
    const view = await this.directory.view();
    if (!view) return { skipped: "unavailable", created: 0 };
    if (view.stale) return { skipped: "stale", created: 0 };
    const rooms = await this.pool.query<{ id: string; unit_id: string }>("SELECT id, unit_id FROM kerja_ruang WHERE jenis = 'tetap' AND status = 'aktif'");
    let created = 0;
    for (const room of rooms.rows) {
      const unitName = view.units.get(room.unit_id)?.nama ?? "unit ini";
      const members = await this.pool.query<{ person_id: string; peran: Peran }>("SELECT person_id, peran FROM kerja_ruang_anggota WHERE ruang_id = $1", [room.id]);
      const memberIds = new Set(members.rows.map((row) => row.person_id));
      const proposals: Array<{ person: string; jenis: "tambah" | "keluarkan"; alasan: string }> = [];
      for (const person of view.people.values()) {
        if (person.aktif && person.unitId === room.unit_id && !memberIds.has(person.id)) {
          proposals.push({ person: person.id, jenis: "tambah", alasan: `Tercatat di ${unitName} pada Organization Directory.` });
        }
      }
      for (const member of members.rows) {
        // Reviewers sit above the unit by design (§5.3), so they are never proposed for removal.
        if (member.peran === "peninjau") continue;
        const person = view.people.get(member.person_id);
        if (!person?.aktif) proposals.push({ person: member.person_id, jenis: "keluarkan", alasan: "Tidak lagi aktif di Organization Directory." });
        else if (person.unitId !== room.unit_id) proposals.push({ person: member.person_id, jenis: "keluarkan", alasan: `Tidak lagi tercatat di ${unitName} pada Organization Directory.` });
      }
      const wanted = new Set(proposals.map((p) => `${p.person}\n${p.jenis}`));
      // Open proposals that no longer match the Directory expire on their own.
      await this.pool.query(
        `UPDATE kerja_ruang_usulan SET keputusan = 'kedaluwarsa', ditindak_pada = now(), ditindak_oleh = 'system:directory'
         WHERE ruang_id = $1 AND keputusan IS NULL AND NOT ((person_id || E'\\n' || jenis) = ANY($2::text[]))`,
        [room.id, [...wanted]],
      );
      for (const proposal of proposals) {
        const inserted = await this.pool.query(
          `INSERT INTO kerja_ruang_usulan (id, ruang_id, person_id, jenis, alasan, directory_version)
           SELECT $1, $2, $3, $4, $5, $6
           WHERE NOT EXISTS (SELECT 1 FROM kerja_ruang_usulan WHERE ruang_id = $2 AND person_id = $3 AND jenis = $4 AND alasan = $5 AND keputusan = 'ditolak')
           ON CONFLICT DO NOTHING`,
          [randomUUID(), room.id, proposal.person, proposal.jenis, proposal.alasan, view.version],
        );
        created += inserted.rowCount ?? 0;
      }
    }
    return { skipped: null, created };
  }

  /** §5.5: committee rooms past their end date become read-only archives. */
  async expireCommittees(): Promise<number> {
    const today = jakartaDate(this.now());
    return withTransaction(this.pool, async (client) => {
      const expired = await client.query<{ id: string }>(
        `UPDATE kerja_ruang SET status = 'arsip', diperbarui_pada = now() WHERE jenis = 'panitia' AND status = 'aktif' AND berakhir_pada < $1::date RETURNING id`,
        [today],
      );
      for (const row of expired.rows) {
        await writeAudit(client, { aktor: "system:kerja", aksi: "ruang.berakhir", objekJenis: "ruang", objekRef: row.id, ruangId: row.id, alasan: "Tanggal berakhir ruang panitia sudah lewat." });
      }
      return expired.rowCount ?? 0;
    });
  }

  private async requireDirectory(): Promise<DirectoryView> {
    const view = await this.directory.view();
    if (!view) throw new KerjaError(503, "directory_belum_tersedia", "Organization Directory belum tersedia.");
    return view;
  }
}

export async function usedBytes(db: Db, ruangId: string): Promise<number> {
  const result = await db.query<{ total: string | null }>("SELECT sum(ukuran) AS total FROM kerja_lampiran WHERE ruang_id = $1 AND berkas_dibuang_pada IS NULL AND NOT di_arsip", [ruangId]);
  return Number(result.rows[0]?.total ?? 0);
}

export async function createDefaultBoard(db: Db, ruangId: string, nama = "Papan kerja"): Promise<string> {
  const papanId = randomUUID();
  const order = await db.query<{ next: number }>("SELECT COALESCE(max(urutan) + 1, 0) AS next FROM kerja_papan WHERE ruang_id = $1", [ruangId]);
  await db.query("INSERT INTO kerja_papan (id, ruang_id, nama, urutan) VALUES ($1, $2, $3, $4)", [papanId, ruangId, nama, order.rows[0]!.next]);
  for (const [index, column] of DEFAULT_COLUMNS.entries()) {
    await db.query("INSERT INTO kerja_kolom (id, papan_id, nama, urutan, menandai_selesai) VALUES ($1, $2, $3, $4, $5)", [randomUUID(), papanId, column.nama, index, column.selesai]);
  }
  return papanId;
}

async function assertAnotherPj(db: Db, ruangId: string, person: string) {
  const others = await db.query("SELECT 1 FROM kerja_ruang_anggota WHERE ruang_id = $1 AND peran = 'pj' AND person_id <> $2", [ruangId, person]);
  if (others.rowCount === 0) throw new KerjaError(409, "pj_terakhir", "Ruang harus punya setidaknya satu penanggung jawab.");
}

async function closeProposals(db: Db, ruangId: string, person: string, jenis: "tambah" | "keluarkan", keputusan: "diterima", actor: string) {
  await db.query(
    "UPDATE kerja_ruang_usulan SET keputusan = $4, ditindak_pada = now(), ditindak_oleh = $5 WHERE ruang_id = $1 AND person_id = $2 AND jenis = $3 AND keputusan IS NULL",
    [ruangId, person, jenis, keputusan, actor],
  );
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
