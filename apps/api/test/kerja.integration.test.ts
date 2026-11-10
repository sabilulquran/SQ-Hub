import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { HubAuthError, type HubAuthRuntime } from "../src/modules/hub-auth/service.js";
import type { KerjaConfig } from "../src/modules/kerja/config.js";
import { createKerjaModule, type KerjaModule } from "../src/modules/kerja/module.js";
import type { Projection } from "../src/modules/organization-directory/repository.js";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for integration tests");
const pool = new Pool({ connectionString: databaseUrl });

const ORIGIN = "https://kerja.sabilulquran.or.id";
const ISSUER = "https://sso.sabilulquran.or.id/realms/sq-staff";
const unit = (n: number) => `hcis:org-node:00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const person = (n: number) => `hcis:employee:00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;

// Directory: Bidang Pendidikan (1) above SMPIT (2) and PKBM (3); Keuangan (4) elsewhere.
const U_BIDANG = unit(1), U_SMPIT = unit(2), U_PKBM = unit(3), U_KEU = unit(4);
const KABID = person(1), KEPALA_SMP = person(2), WAKASEK = person(3), TU_SMP = person(4), KEPALA_PKBM = person(5), KEUANGAN = person(6), HCM = person(7), BARU = person(8);
const NAMES: Record<string, [string, string]> = {
  [KABID]: ["Kepala Bidang", U_BIDANG], [KEPALA_SMP]: ["Kepala SMPIT", U_SMPIT], [WAKASEK]: ["Wakasek Bersama", U_SMPIT],
  [TU_SMP]: ["TU SMPIT", U_SMPIT], [KEPALA_PKBM]: ["Kepala PKBM", U_PKBM], [KEUANGAN]: ["Staf Keuangan", U_KEU], [HCM]: ["Kepala HCM", U_KEU],
};
const session = (id: string) => `s-${id.slice(-4)}`;

let directoryState: { people: Record<string, [string, string]>; inactive: Set<string>; synchronizedAt: string; version: string };
function projection(): Projection {
  const units = [[U_BIDANG, "Bidang Pendidikan", null], [U_SMPIT, "SMPIT Tahfizh Sabilul Qur'an", U_BIDANG], [U_PKBM, "PKBM Sabilul Qur'an", U_BIDANG], [U_KEU, "Keuangan", null]] as const;
  return {
    snapshot: {
      asOf: "2026-11-10",
      version: directoryState.version,
      units: units.map(([id, name, parent]) => ({ id, name, nodeType: "unit", parentUnitId: parent, active: true, effectiveFrom: "2020-01-01", effectiveTo: null })),
      people: Object.entries(directoryState.people).map(([id, [name, unitId]]) => ({
        id, employeeNumber: `NIP${id.slice(-4)}`, displayName: name, active: !directoryState.inactive.has(id), employmentStatus: "tetap",
        startedOn: null, endedOn: null, currentPrimaryUnitId: unitId, structuralPositionIds: [], primaryStructuralPositionId: null,
        identityRefs: [{ issuer: ISSUER, subject: `sub-${id.slice(-4)}` }],
      })),
    },
    tombstones: { units: [], positions: [], people: [] },
    synchronizedAt: directoryState.synchronizedAt,
  } as unknown as Projection;
}

const allowed = new Set<string>();
let accessFails = false;
const auth: HubAuthRuntime = {
  async getSession(token) {
    const id = Object.keys(NAMES).concat(BARU).find((candidate) => session(candidate) === token);
    if (!id) throw new HubAuthError(401, "UNAUTHENTICATED", "no session");
    return {
      issuer: ISSUER, subject: `sub-${id.slice(-4)}`, displayName: NAMES[id]?.[0] ?? "Baru", sessionId: randomUUID(), username: null, email: null,
      emailVerified: null, accountRefreshTokenCiphertext: null, createdAt: new Date(), expiresAt: new Date(Date.now() + 3600_000),
    };
  },
  beginLogin: () => Promise.reject(new Error("not used")),
  completeLogin: () => Promise.reject(new Error("not used")),
  getWorkspace: () => Promise.reject(new Error("not used")),
  getAccountAccess: () => Promise.reject(new Error("not used")),
  logout: () => Promise.reject(new Error("not used")),
  clearTransactionCookie: () => "",
};

let mediaRoot: string;
let freeBytes = 50 * 1024 * 1024 * 1024;
let kerja: KerjaModule;
let app: FastifyInstance;
let now = new Date("2026-11-10T03:00:00Z");

function config(): KerjaConfig {
  return {
    oidc: { clientId: "kerja-sq", clientSecret: "test-secret" }, publicOrigin: ORIGIN, mediaRoot,
    maxUploadBytes: 64 * 1024, roomQuotaBytes: 100 * 1024, reminderIntervalMs: 60_000, directorySyncHour: 5, minFreeDiskBytes: 10 * 1024 * 1024 * 1024,
  };
}

async function call(who: string, method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, payload?: unknown, options: { origin?: string | null } = {}) {
  const response = await app.inject({
    method,
    url: url.startsWith("/admin/") ? url : `/kerja${url}`,
    headers: { cookie: `sq_kerja_session=${session(who)}`, ...(options.origin === null ? {} : { origin: options.origin ?? ORIGIN }) },
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });
  return { status: response.statusCode, body: response.headers["content-type"]?.toString().includes("json") ? response.json() : response.body, raw: response };
}

async function upload(who: string, path: string, filename: string, content: Buffer) {
  const boundary = `----kerja${randomUUID()}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="berkas"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const response = await app.inject({
    method: "POST", url: `/kerja${path}`, payload: body,
    headers: { cookie: `sq_kerja_session=${session(who)}`, origin: ORIGIN, "content-type": `multipart/form-data; boundary=${boundary}` },
  });
  return { status: response.statusCode, body: response.json() };
}

async function auditCount() {
  return Number((await pool.query<{ c: string }>("SELECT count(*) AS c FROM kerja_audit")).rows[0]!.c);
}

/** Two permanent rooms (SMPIT, PKBM) sharing the wakasek, and Keuangan; Kabid reviews SMPIT. */
async function seedRooms() {
  const smp = await kerja.rooms.adminCreate("operator:test", { jenis: "tetap", unit_id: U_SMPIT, pj: KEPALA_SMP, alasan: "Peluncuran" });
  const pkbm = await kerja.rooms.adminCreate("operator:test", { jenis: "tetap", unit_id: U_PKBM, pj: KEPALA_PKBM, alasan: "Peluncuran" });
  const keu = await kerja.rooms.adminCreate("operator:test", { jenis: "tetap", unit_id: U_KEU, pj: KEUANGAN, alasan: "Peluncuran" });
  expect((await call(KEPALA_SMP, "POST", `/ruang/${smp.id}/anggota`, { person_id: WAKASEK, peran: "anggota", alasan: "Wakasek" })).status).toBe(201);
  expect((await call(KEPALA_SMP, "POST", `/ruang/${smp.id}/anggota`, { person_id: TU_SMP, peran: "anggota", alasan: "TU" })).status).toBe(201);
  expect((await call(KEPALA_SMP, "POST", `/ruang/${smp.id}/anggota`, { person_id: KABID, peran: "peninjau", alasan: "Kabid" })).status).toBe(201);
  expect((await call(KEPALA_PKBM, "POST", `/ruang/${pkbm.id}/anggota`, { person_id: WAKASEK, peran: "anggota", alasan: "Wakasek bersama" })).status).toBe(201);
  const smpRoom = (await call(KEPALA_SMP, "GET", `/ruang/${smp.id}`)).body;
  const pkbmRoom = (await call(KEPALA_PKBM, "GET", `/ruang/${pkbm.id}`)).body;
  const smpBoard = (await call(KEPALA_SMP, "GET", `/papan/${smpRoom.papan[0].id}`)).body;
  const pkbmBoard = (await call(KEPALA_PKBM, "GET", `/papan/${pkbmRoom.papan[0].id}`)).body;
  const keuRoom = (await call(KEUANGAN, "GET", `/ruang/${keu.id}`)).body;
  return { smp: smp.id, pkbm: pkbm.id, keu: keu.id, smpBoard, pkbmBoard, keuBoard: keuRoom.papan[0].id as string };
}

async function card(who: string, kolomId: string, input: Record<string, unknown>) {
  const response = await call(who, "POST", `/kolom/${kolomId}/kartu`, input);
  expect(response.status).toBe(201);
  return response.body.id as string;
}

beforeAll(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), "kerja-media-"));
});

afterAll(async () => {
  await app?.close();
  await pool.end();
  await rm(mediaRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await pool.query(`TRUNCATE kerja_ruang, kerja_ruang_anggota, kerja_ruang_usulan, kerja_papan, kerja_kolom, kerja_kartu, kerja_kartu_orang,
    kerja_label, kerja_kartu_label, kerja_ceklis, kerja_ceklis_item, kerja_ceklis_item_orang, kerja_lampiran, kerja_komentar,
    kerja_pengingat, kerja_notifikasi, kerja_riwayat, kerja_admins, kerja_audit CASCADE`);
  await pool.query("DELETE FROM kerja_status WHERE kunci <> 'pencarian'");
  directoryState = { people: { ...NAMES }, inactive: new Set(), synchronizedAt: "2026-11-10T03:00:00Z", version: "sha256:" + "a".repeat(64) };
  allowed.clear();
  for (const id of [...Object.keys(NAMES), BARU]) allowed.add(`sub-${id.slice(-4)}`);
  accessFails = false;
  freeBytes = 50 * 1024 * 1024 * 1024;
  now = new Date("2026-11-10T03:00:00Z");
  await app?.close();
  kerja = createKerjaModule({
    pool, config: config(), keycloakIssuer: ISSUER, auth,
    access: { async checkAccess(identity) {
      if (accessFails) throw new Error("access store down");
      return { allowed: allowed.has(identity.subject) } as Awaited<ReturnType<import("../src/modules/application-access/service.js").ApplicationAccessService["checkAccess"]>>;
    } },
    directorySource: { read: async () => projection() },
    workspaceApplications: { listApplications: async () => [] } as never,
    now: () => now,
    freeBytes: async () => freeBytes,
  });
  app = Fastify();
  kerja.register(app);
  await app.ready();
});

describe("KERJA-IMPL-001 access (§7, §10, §12)", () => {
  it("answers 404 to a non-member for room, board, card, attachment and search", async () => {
    const seed = await seedRooms();
    const kartu = await card(KEPALA_SMP, seed.smpBoard.kolom[0].id, { judul: "Rekap nilai" });
    const file = await upload(KEPALA_SMP, `/kartu/${kartu}/lampiran`, "nilai.pdf", Buffer.from("%PDF-1.7\nisi"));
    expect(file.status).toBe(201);
    for (const path of [`/ruang/${seed.smp}`, `/papan/${seed.smpBoard.id}`, `/kartu/${kartu}`, `/lampiran/${file.body.id}`, `/ruang/${seed.smp}/cari?q=rekap`]) {
      const response = await call(KEUANGAN, "GET", path);
      expect(response.status, path).toBe(404);
    }
    expect((await call(KEUANGAN, "PATCH", `/kartu/${kartu}`, { judul: "x" })).status).toBe(404);
    expect((await call(KEUANGAN, "GET", "/ruang")).body.items.map((r: { id: string }) => r.id)).toEqual([seed.keu]);
  });

  it("lets a reviewer read but not write, and keeps board settings and members to the pj", async () => {
    const seed = await seedRooms();
    const kartu = await card(WAKASEK, seed.smpBoard.kolom[0].id, { judul: "Jadwal ujian" });
    expect((await call(KABID, "GET", `/kartu/${kartu}`)).status).toBe(200);
    for (const [method, path, payload] of [
      ["POST", `/kolom/${seed.smpBoard.kolom[0].id}/kartu`, { judul: "x" }],
      ["PATCH", `/kartu/${kartu}`, { judul: "x" }],
      ["POST", `/kartu/${kartu}/komentar`, { isi: "x" }],
      ["POST", `/kartu/${kartu}/tutup`, { jenis: "tuntas" }],
    ] as const) {
      expect((await call(KABID, method, path, payload)).status, path).toBe(403);
    }
    expect((await upload(KABID, `/kartu/${kartu}/lampiran`, "a.txt", Buffer.from("teks"))).status).toBe(403);
    expect((await call(WAKASEK, "POST", `/papan/${seed.smpBoard.id}/kolom`, { nama: "Tinjau" })).status).toBe(403);
    expect((await call(WAKASEK, "POST", `/papan/${seed.smpBoard.id}/label`, { nama: "Penting", warna: "merah" })).status).toBe(403);
    expect((await call(WAKASEK, "POST", `/ruang/${seed.smp}/anggota`, { person_id: KEPALA_PKBM, peran: "anggota", alasan: "x" })).status).toBe(403);
    expect((await call(KEPALA_SMP, "POST", `/papan/${seed.smpBoard.id}/kolom`, { nama: "Tinjau" })).status).toBe(201);
  });

  it("refuses people without Application Access, fails closed when the check fails, and needs kerja_admins for admin routes", async () => {
    await seedRooms();
    allowed.delete(`sub-${TU_SMP.slice(-4)}`);
    expect((await call(TU_SMP, "GET", "/ruang")).status).toBe(403);
    expect((await call(TU_SMP, "GET", "/context")).status).toBe(403);
    accessFails = true;
    const failed = await call(KEPALA_SMP, "GET", "/ruang");
    expect(failed.status).toBe(503);
    expect(JSON.stringify(failed.body)).not.toContain("access store down");
    accessFails = false;
    expect((await call(HCM, "GET", "/admin/kerja/ruang")).status).toBe(403);
    await pool.query("INSERT INTO kerja_admins (id, identity_issuer, identity_subject, granted_by, alasan) VALUES ($1, $2, $3, 'operator:test', 'Kepala HCM')", [randomUUID(), ISSUER, `sub-${HCM.slice(-4)}`]);
    expect((await call(HCM, "GET", "/admin/kerja/ruang")).body.items).toHaveLength(3);
    expect((await call(HCM, "GET", "/context")).body).toMatchObject({ pengelola: true, orang: { id: HCM } });
  });

  it("rejects writes from another origin and people missing from the Directory", async () => {
    const seed = await seedRooms();
    expect((await call(KEPALA_SMP, "POST", `/kolom/${seed.smpBoard.kolom[0].id}/kartu`, { judul: "x" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await call(KEPALA_SMP, "POST", `/kolom/${seed.smpBoard.kolom[0].id}/kartu`, { judul: "x" }, { origin: null })).status).toBe(403);
    directoryState.inactive.add(KEPALA_SMP);
    kerja.directory.invalidate();
    expect((await call(KEPALA_SMP, "GET", "/ruang")).body.error).toBe("orang_belum_tercatat");
  });
});

describe("KERJA-IMPL-001 rooms and membership (§5, §10 nomor 6)", () => {
  it("rejects a committee room without an end date and a permanent room without a unit", async () => {
    await expect(pool.query("INSERT INTO kerja_ruang (id, jenis, nama, dibuat_oleh) VALUES ($1, 'panitia', 'Panitia', 'x')", [randomUUID()])).rejects.toThrow(/check/i);
    await expect(pool.query("INSERT INTO kerja_ruang (id, jenis, nama, dibuat_oleh) VALUES ($1, 'tetap', 'Unit', 'x')", [randomUUID()])).rejects.toThrow(/check/i);
    await pool.query("INSERT INTO kerja_admins (id, identity_issuer, identity_subject, granted_by, alasan) VALUES ($1, $2, $3, 'operator:test', 'x')", [randomUUID(), ISSUER, `sub-${HCM.slice(-4)}`]);
    expect((await call(HCM, "POST", "/admin/kerja/ruang", { jenis: "panitia", nama: "Panitia SPMB 2027", pj: KEPALA_SMP, alasan: "x" })).status).toBe(400);
    const created = await call(HCM, "POST", "/admin/kerja/ruang", { jenis: "panitia", nama: "Panitia SPMB 2027", berakhir_pada: "2027-03-31", pj: KEPALA_SMP, alasan: "Permintaan kepala unit" });
    expect(created.status).toBe(201);
    expect((await call(HCM, "POST", "/admin/kerja/ruang", { jenis: "tetap", unit_id: U_KEU, pj: KEUANGAN, alasan: "x" })).status).toBe(201);
    expect((await call(HCM, "POST", "/admin/kerja/ruang", { jenis: "tetap", unit_id: U_KEU, pj: KEUANGAN, alasan: "x" })).body.error).toBe("unit_sudah_punya_ruang");
  });

  it("writes exactly one audit row per admin or membership action and requires a reason", async () => {
    const before = await auditCount();
    const seed = await seedRooms();
    // 3 rooms + 4 members.
    expect(await auditCount()).toBe(before + 7);
    expect((await call(KEPALA_SMP, "PATCH", `/ruang/${seed.smp}/anggota/${TU_SMP}`, { peran: "peninjau" })).status).toBe(400);
    expect((await call(KEPALA_SMP, "PATCH", `/ruang/${seed.smp}/anggota/${TU_SMP}`, { peran: "peninjau", alasan: "Pindah tugas" })).status).toBe(200);
    expect((await call(KEPALA_SMP, "DELETE", `/ruang/${seed.smp}/anggota/${TU_SMP}`, {})).status).toBe(400);
    expect((await call(KEPALA_SMP, "DELETE", `/ruang/${seed.smp}/anggota/${TU_SMP}`, { alasan: "Selesai" })).status).toBe(200);
    expect(await auditCount()).toBe(before + 9);
    const log = await pool.query<{ aksi: string; alasan: string }>("SELECT aksi, alasan FROM kerja_audit ORDER BY id DESC LIMIT 2");
    expect(log.rows.map((r) => r.aksi)).toEqual(["anggota.keluarkan", "anggota.ubah_peran"]);
    expect((await call(KEPALA_SMP, "DELETE", `/ruang/${seed.smp}/anggota/${KEPALA_SMP}`, { alasan: "x" })).body.error).toBe("pj_terakhir");
  });

  it("only proposes membership changes from the Directory, and not while it is stale", async () => {
    const seed = await seedRooms();
    directoryState.people[BARU] = ["Guru Baru", U_SMPIT];
    directoryState.synchronizedAt = new Date(now.getTime() - 3600_000).toISOString();
    expect(await kerja.rooms.compareWithDirectory()).toEqual({ skipped: "stale", created: 0 });
    expect((await call(KEPALA_SMP, "GET", `/ruang/${seed.smp}/usulan`)).body.items).toHaveLength(0);

    directoryState.synchronizedAt = now.toISOString();
    directoryState.people[TU_SMP] = ["TU SMPIT", U_PKBM];
    const result = await kerja.rooms.compareWithDirectory();
    expect(result.skipped).toBeNull();
    const proposals = (await call(KEPALA_SMP, "GET", `/ruang/${seed.smp}/usulan`)).body.items as Array<{ id: string; jenis: string; orang: { id: string } }>;
    expect(proposals.map((p) => [p.jenis, p.orang.id]).sort()).toEqual([["keluarkan", TU_SMP], ["tambah", BARU]].sort());
    // PKBM: the shared wakasek (primary unit SMPIT) is proposed for removal, the moved TU for addition.
    const pkbm = (await call(KEPALA_PKBM, "GET", `/ruang/${seed.pkbm}/usulan`)).body.items as Array<{ id: string; jenis: string; orang: { id: string } }>;
    expect(pkbm.map((p) => [p.jenis, p.orang.id]).sort()).toEqual([["keluarkan", WAKASEK], ["tambah", TU_SMP]].sort());
    // The reviewer above SMPIT is never proposed for removal.
    expect(proposals.some((p) => p.orang.id === KABID)).toBe(false);
    // Proposals change nothing on their own.
    const members = (await call(KEPALA_SMP, "GET", `/ruang/${seed.smp}`)).body.anggota.map((a: { id: string }) => a.id);
    expect(members).toContain(TU_SMP);
    expect(members).not.toContain(BARU);

    const keluarkan = pkbm.find((p) => p.jenis === "keluarkan")!;
    const reject = await call(KEPALA_PKBM, "POST", `/usulan/${keluarkan.id}/tolak`, { alasan: "Wakasek melayani dua sekolah" });
    expect(reject.status).toBe(200);
    await kerja.rooms.compareWithDirectory();
    // A rejected proposal is not raised again.
    expect((await call(KEPALA_PKBM, "GET", `/ruang/${seed.pkbm}/usulan`)).body.items.map((p: { orang: { id: string } }) => p.orang.id)).toEqual([TU_SMP]);
    const tambah = proposals.find((p) => p.jenis === "tambah")!;
    expect((await call(KEPALA_SMP, "POST", `/usulan/${tambah.id}/terima`, { alasan: "Guru baru" })).status).toBe(200);
    expect((await call(KEPALA_SMP, "GET", `/ruang/${seed.smp}`)).body.anggota.map((a: { id: string }) => a.id)).toContain(BARU);
  });

  it("archives committee rooms past their end date and keeps them readable", async () => {
    const created = await kerja.rooms.adminCreate("operator:test", { jenis: "panitia", nama: "Akreditasi", berakhir_pada: "2026-11-10", pj: KEPALA_SMP, alasan: "x" });
    const room = (await call(KEPALA_SMP, "GET", `/ruang/${created.id}`)).body;
    now = new Date("2026-11-11T00:00:00Z");
    expect(await kerja.rooms.expireCommittees()).toBe(1);
    expect((await call(KEPALA_SMP, "GET", `/ruang/${created.id}`)).body.status).toBe("arsip");
    const board = (await call(KEPALA_SMP, "GET", `/papan/${room.papan[0].id}`)).body;
    expect((await call(KEPALA_SMP, "POST", `/kolom/${board.kolom[0].id}/kartu`, { judul: "x" })).body.error).toBe("ruang_diarsipkan");
    expect((await call(KEPALA_SMP, "PATCH", `/ruang/${created.id}`, { status: "aktif", alasan: "Diperpanjang" })).body.error).toBe("perlu_perpanjang");
    expect((await call(KEPALA_SMP, "PATCH", `/ruang/${created.id}`, { status: "aktif", berakhir_pada: "2026-12-31", alasan: "Diperpanjang" })).status).toBe(200);
  });

  it("lists orphan cards of people who left the room", async () => {
    const seed = await seedRooms();
    const kartu = await card(KEPALA_SMP, seed.smpBoard.kolom[0].id, { judul: "Inventaris", orang: [TU_SMP] });
    await call(KEPALA_SMP, "DELETE", `/ruang/${seed.smp}/anggota/${TU_SMP}`, { alasan: "Pindah" });
    const orphans = (await call(KEPALA_SMP, "GET", `/ruang/${seed.smp}/yatim`)).body.items;
    expect(orphans).toEqual([expect.objectContaining({ kartuId: kartu, orang: expect.objectContaining({ id: TU_SMP }) })]);
  });
});

describe("KERJA-IMPL-001 cards (§6)", () => {
  it("creates, assigns, moves, asks for the closing kind, and records history with actor and time", async () => {
    const seed = await seedRooms();
    const [todo, doing, done] = seed.smpBoard.kolom.map((k: { id: string }) => k.id);
    const kartu = await card(KEPALA_SMP, todo, { judul: "Rapat wali", tenggat_pada: "2026-11-20T09:00:00+07:00", orang: [WAKASEK] });
    expect((await call(WAKASEK, "POST", `/kartu/${kartu}/pindah`, { kolom_id: doing, indeks: 0 })).status).toBe(200);
    expect((await call(WAKASEK, "POST", `/kartu/${kartu}/pindah`, { kolom_id: done, indeks: 0 })).body.error).toBe("jenis_selesai_wajib");
    expect((await call(WAKASEK, "POST", `/kartu/${kartu}/pindah`, { kolom_id: done, indeks: 0, selesai_jenis: "selesai" })).status).toBe(400);
    expect((await call(WAKASEK, "POST", `/kartu/${kartu}/pindah`, { kolom_id: done, indeks: 0, selesai_jenis: "tuntas" })).status).toBe(200);
    expect((await call(WAKASEK, "PATCH", `/kartu/${kartu}`, { tenggat_pada: "2026-11-21T09:00:00+07:00" })).status).toBe(200);
    const detail = (await call(KABID, "GET", `/kartu/${kartu}`)).body;
    expect(detail.selesai).toMatchObject({ jenis: "tuntas", oleh: { id: WAKASEK } });
    expect(detail.riwayat.map((r: { aksi: string }) => r.aksi).reverse()).toEqual(["dibuat", "tambah_orang", "pindah_kolom", "pindah_kolom", "ditutup", "ubah_tenggat"]);
    expect(detail.riwayat[0]).toMatchObject({ aktor: { id: WAKASEK, nama: "Wakasek Bersama" } });
    expect(detail.riwayat.find((r: { aksi: string }) => r.aksi === "pindah_kolom").baru.kolom).toBeDefined();
    // Reopening moves the card out of the done column.
    expect((await call(WAKASEK, "POST", `/kartu/${kartu}/buka`)).status).toBe(200);
    expect((await call(WAKASEK, "GET", `/kartu/${kartu}`)).body.kolom.id).toBe(todo);
  });

  it("only assigns people who are pj or anggota of the room", async () => {
    const seed = await seedRooms();
    const todo = seed.smpBoard.kolom[0].id;
    expect((await call(KEPALA_SMP, "POST", `/kolom/${todo}/kartu`, { judul: "x", orang: [KEUANGAN] })).body.error).toBe("orang_bukan_anggota");
    expect((await call(KEPALA_SMP, "POST", `/kolom/${todo}/kartu`, { judul: "x", orang: [KABID] })).body.error).toBe("orang_bukan_anggota");
  });

  it("keeps order with fractional positions and rebalances after repeated inserts at one spot", async () => {
    const seed = await seedRooms();
    const todo = seed.smpBoard.kolom[0].id;
    const first = await card(KEPALA_SMP, todo, { judul: "pertama" });
    const last = await card(KEPALA_SMP, todo, { judul: "terakhir" });
    const inserted: string[] = [];
    for (let index = 0; index < 60; index += 1) {
      const id = await card(KEPALA_SMP, todo, { judul: `sisip ${index}` });
      // Always just after "pertama": the gap halves each time until a rebalance.
      expect((await call(KEPALA_SMP, "POST", `/kartu/${id}/pindah`, { kolom_id: todo, indeks: 1 })).status).toBe(200);
      inserted.unshift(id);
    }
    const board = (await call(KEPALA_SMP, "GET", `/papan/${seed.smpBoard.id}`)).body;
    const order = board.kolom[0].kartu.map((k: { id: string }) => k.id);
    expect(order).toEqual([first, ...inserted, last]);
    const positions = board.kolom[0].kartu.map((k: { posisi: string }) => Number(k.posisi));
    expect(Math.max(...positions)).toBeLessThan(1024 * 100);
  });

  it("copies only what was chosen and never comments, history, closed state or reminders", async () => {
    const seed = await seedRooms();
    const todo = seed.smpBoard.kolom[0].id;
    await call(KEPALA_SMP, "POST", `/papan/${seed.smpBoard.id}/label`, { nama: "Penting", warna: "merah" });
    const label = (await call(KEPALA_SMP, "GET", `/papan/${seed.smpBoard.id}`)).body.label[0].id;
    const kartu = await card(KEPALA_SMP, todo, { judul: "Laporan bulanan", orang: [TU_SMP], tenggat_pada: "2026-11-11T02:00:00Z" });
    await call(KEPALA_SMP, "PUT", `/kartu/${kartu}/label`, { label: [label] });
    const list = (await call(KEPALA_SMP, "POST", `/kartu/${kartu}/ceklis`, { nama: "Langkah" })).body.id;
    const item = (await call(KEPALA_SMP, "POST", `/ceklis/${list}/butir`, { nama: "Kumpulkan data", orang: [TU_SMP] })).body.id;
    await call(KEPALA_SMP, "PATCH", `/butir/${item}`, { selesai: true });
    await call(KEPALA_SMP, "POST", `/kartu/${kartu}/komentar`, { isi: "Catatan" });
    await upload(KEPALA_SMP, `/kartu/${kartu}/lampiran`, "a.txt", Buffer.from("isi"));
    await call(KEPALA_SMP, "POST", `/kartu/${kartu}/tutup`, { jenis: "tuntas" });
    await kerja.reminders.runOnce(new Date("2026-11-10T03:00:00Z"));

    const plain = (await call(KEPALA_SMP, "POST", `/kartu/${kartu}/salin`, {})).body.id;
    const plainDetail = (await call(KEPALA_SMP, "GET", `/kartu/${plain}`)).body;
    expect(plainDetail).toMatchObject({ label: [], orang: [], ceklis: [], komentar: [], lampiran: [], selesai: null });
    expect(plainDetail.riwayat.map((r: { aksi: string }) => r.aksi)).toEqual(["disalin"]);

    const full = (await call(KEPALA_SMP, "POST", `/kartu/${kartu}/salin`, { label: true, orang: true, ceklis: true, ceklis_isi: true, lampiran: true })).body.id;
    const fullDetail = (await call(KEPALA_SMP, "GET", `/kartu/${full}`)).body;
    expect(fullDetail.label.map((l: { id: string }) => l.id)).toEqual([label]);
    expect(fullDetail.orang.map((o: { id: string }) => o.id)).toEqual([TU_SMP]);
    expect(fullDetail.ceklis[0].butir[0]).toMatchObject({ nama: "Kumpulkan data", selesai: false, orang: [expect.objectContaining({ id: TU_SMP })] });
    expect(fullDetail.lampiran).toHaveLength(1);
    expect(fullDetail.komentar).toEqual([]);
    expect(fullDetail.selesai).toBeNull();
    const reminder = await pool.query("SELECT * FROM kerja_pengingat WHERE kartu_id = $1", [full]);
    expect(reminder.rows[0]).toMatchObject({ tenggat_h1hari_pada: null, tenggat_h1jam_pada: null });
    const download = await call(KEPALA_SMP, "GET", `/lampiran/${fullDetail.lampiran[0].id}`);
    expect(download.raw.body).toBe("isi");
  });

  it("allows replies to comments but not replies to replies, and empties deleted comments", async () => {
    const seed = await seedRooms();
    const kartu = await card(KEPALA_SMP, seed.smpBoard.kolom[0].id, { judul: "Diskusi" });
    const top = (await call(KEPALA_SMP, "POST", `/kartu/${kartu}/komentar`, { isi: "<p>Usul <b>A</b><script>x</script></p>" })).body.id;
    const reply = (await call(WAKASEK, "POST", `/kartu/${kartu}/komentar`, { isi: "Setuju", induk_id: top })).body.id;
    expect((await call(TU_SMP, "POST", `/kartu/${kartu}/komentar`, { isi: "Saya juga", induk_id: reply })).body.error).toBe("balasan_bersarang");
    expect((await call(WAKASEK, "PATCH", `/komentar/${top}`, { isi: "ubah" })).status).toBe(403);
    expect((await call(KEPALA_SMP, "DELETE", `/komentar/${top}`)).status).toBe(200);
    const detail = (await call(TU_SMP, "GET", `/kartu/${kartu}`)).body;
    expect(detail.komentar).toEqual([expect.objectContaining({ id: top, dihapus: true, isi: "", balasan: [expect.objectContaining({ id: reply, isi: "Setuju" })] })]);
    const stored = await pool.query<{ isi: string }>("SELECT isi FROM kerja_komentar WHERE id = $1", [reply]);
    expect(stored.rows[0]!.isi).toBe("Setuju");
  });

  it("notifies mentioned members and new assignees, but never mentions from outside the room", async () => {
    const seed = await seedRooms();
    const kartu = await card(KEPALA_SMP, seed.smpBoard.kolom[0].id, {
      judul: "Persiapan", orang: [TU_SMP],
      uraian: `<p>Mohon <span data-sebut="${WAKASEK}">@Wakasek</span> dan <span data-sebut="${KEUANGAN}">@Keu</span></p>`,
    });
    const tu = (await call(TU_SMP, "GET", "/notifikasi")).body;
    expect(tu.items.map((n: { jenis: string }) => n.jenis)).toEqual(["penugasan"]);
    expect((await call(WAKASEK, "GET", "/notifikasi")).body.items.map((n: { jenis: string; kartuId: string }) => [n.jenis, n.kartuId])).toEqual([["sebutan", kartu]]);
    expect((await call(KEUANGAN, "GET", "/notifikasi")).body.items).toHaveLength(0);
    expect((await call(KEPALA_SMP, "GET", `/kartu/${kartu}`)).body.uraian).not.toContain(KEUANGAN);
    expect((await call(TU_SMP, "POST", "/notifikasi/dibaca")).body.belumDibaca).toBe(0);
  });
});

describe("KERJA-IMPL-001 Tugas Saya and search (§8, §12)", () => {
  it("merges cards and checklist items from both rooms of the shared wakasek, overdue first", async () => {
    const seed = await seedRooms();
    const late = await card(KEPALA_PKBM, seed.pkbmBoard.kolom[0].id, { judul: "PKBM terlambat", orang: [WAKASEK], tenggat_pada: "2026-11-01T02:00:00Z" });
    const soon = await card(KEPALA_SMP, seed.smpBoard.kolom[0].id, { judul: "SMPIT besok", orang: [WAKASEK], tenggat_pada: "2026-11-11T02:00:00Z" });
    const none = await card(KEPALA_SMP, seed.smpBoard.kolom[0].id, { judul: "SMPIT tanpa tenggat", orang: [WAKASEK] });
    const viaItem = await card(KEPALA_SMP, seed.smpBoard.kolom[0].id, { judul: "Lewat butir" });
    const list = (await call(KEPALA_SMP, "POST", `/kartu/${viaItem}/ceklis`, { nama: "Langkah" })).body.id;
    await call(KEPALA_SMP, "POST", `/ceklis/${list}/butir`, { nama: "Bagian wakasek", orang: [WAKASEK], tenggat_pada: "2026-11-15T02:00:00Z" });
    await card(KEPALA_SMP, seed.smpBoard.kolom[0].id, { judul: "Bukan milik wakasek", orang: [TU_SMP] });
    const tasks = (await call(WAKASEK, "GET", "/tugas-saya")).body;
    expect(tasks.items.map((t: { id: string }) => t.id)).toEqual([late, soon, viaItem, none]);
    expect(tasks.items[0].lewatTenggat).toBe(true);
    expect(tasks.items[2]).toMatchObject({ ditugaskanKeSaya: false, butirSaya: [expect.objectContaining({ nama: "Bagian wakasek" })] });
    expect(tasks.ruang).toHaveLength(2);
    expect((await call(WAKASEK, "GET", `/tugas-saya?ruang=${seed.pkbm}`)).body.items.map((t: { id: string }) => t.id)).toEqual([late]);
  });

  it("finds cards by title, description and comment, only inside the room", async () => {
    const seed = await seedRooms();
    const byTitle = await card(KEPALA_SMP, seed.smpBoard.kolom[0].id, { judul: "Akreditasi sekolah" });
    const byText = await card(KEPALA_SMP, seed.smpBoard.kolom[0].id, { judul: "Berkas", uraian: "<p>Siapkan dokumen akreditasi tahap dua</p>" });
    const byComment = await card(KEPALA_SMP, seed.smpBoard.kolom[0].id, { judul: "Rapat" });
    await call(WAKASEK, "POST", `/kartu/${byComment}/komentar`, { isi: "Bahas akreditasi juga" });
    await card(KEPALA_PKBM, seed.pkbmBoard.kolom[0].id, { judul: "Akreditasi PKBM" });
    await card(KEUANGAN, (await call(KEUANGAN, "GET", `/papan/${seed.keuBoard}`)).body.kolom[0].id, { judul: "Akreditasi anggaran" });
    const found = (await call(WAKASEK, "GET", `/ruang/${seed.smp}/cari?q=akreditasi`)).body.items.map((k: { id: string }) => k.id).sort();
    expect(found).toEqual([byTitle, byText, byComment].sort());
    expect((await call(KEUANGAN, "GET", `/ruang/${seed.smp}/cari?q=akreditasi`)).status).toBe(404);
    const archived = await card(KEPALA_SMP, seed.smpBoard.kolom[0].id, { judul: "Akreditasi lama" });
    await call(KEPALA_SMP, "POST", `/kartu/${archived}/arsip`);
    expect((await call(WAKASEK, "GET", `/ruang/${seed.smp}/cari?q=akreditasi`)).body.items).toHaveLength(3);
    expect((await call(WAKASEK, "GET", `/ruang/${seed.smp}/cari?q=akreditasi&arsip=true`)).body.items).toHaveLength(4);
    expect((await call(WAKASEK, "GET", `/ruang/${seed.smp}/arsip`)).body.items.map((k: { id: string }) => k.id)).toEqual([archived]);
  });
});

describe("KERJA-IMPL-001 reminders (§6.4)", () => {
  it("sends each marker exactly once, skips done and archived cards, and re-arms when the deadline moves", async () => {
    const seed = await seedRooms();
    const todo = seed.smpBoard.kolom[0].id;
    const kartu = await card(KEPALA_SMP, todo, { judul: "Kirim laporan", orang: [TU_SMP, WAKASEK], tenggat_pada: "2026-11-11T02:00:00Z" });
    const done = await card(KEPALA_SMP, todo, { judul: "Sudah", orang: [TU_SMP], tenggat_pada: "2026-11-11T02:00:00Z" });
    await call(KEPALA_SMP, "POST", `/kartu/${done}/tutup`, { jenis: "batal" });
    const archived = await card(KEPALA_SMP, todo, { judul: "Arsip", orang: [TU_SMP], tenggat_pada: "2026-11-11T02:00:00Z" });
    await call(KEPALA_SMP, "POST", `/kartu/${archived}/arsip`);
    const count = async () => Number((await pool.query<{ c: string }>("SELECT count(*) AS c FROM kerja_notifikasi WHERE jenis LIKE 'tenggat%'")).rows[0]!.c);

    expect(await kerja.reminders.runOnce(new Date("2026-11-10T01:00:00Z"))).toBe(0);
    // H−1 hari reached: two assignees, once.
    expect(await kerja.reminders.runOnce(new Date("2026-11-10T03:00:00Z"))).toBe(2);
    await Promise.all([kerja.reminders.runOnce(new Date("2026-11-10T03:01:00Z")), kerja.reminders.runOnce(new Date("2026-11-10T03:01:00Z"))]);
    expect(await count()).toBe(2);
    // H−1 jam reached.
    expect(await kerja.reminders.runOnce(new Date("2026-11-11T01:30:00Z"))).toBe(2);
    expect(await kerja.reminders.runOnce(new Date("2026-11-11T01:31:00Z"))).toBe(0);
    expect(await count()).toBe(4);
    // Moving the deadline clears only the deadline markers.
    await call(KEPALA_SMP, "PATCH", `/kartu/${kartu}`, { tenggat_pada: "2026-11-20T02:00:00Z" });
    expect((await pool.query("SELECT tenggat_h1hari_pada, tenggat_h1jam_pada FROM kerja_pengingat WHERE kartu_id = $1", [kartu])).rows[0]).toEqual({ tenggat_h1hari_pada: null, tenggat_h1jam_pada: null });
    // A card already inside its last hour gets only the H−1 jam reminder.
    expect(await kerja.reminders.runOnce(new Date("2026-11-20T01:30:00Z"))).toBe(2);
    expect(await kerja.reminders.runOnce(new Date("2026-11-20T01:40:00Z"))).toBe(0);
    const kinds = await pool.query<{ jenis: string }>("SELECT jenis FROM kerja_notifikasi WHERE kartu_id = $1 AND person_id = $2 ORDER BY dibuat_pada", [kartu, TU_SMP]);
    expect(kinds.rows.map((r) => r.jenis)).toEqual(["penugasan", "tenggat_h1hari", "tenggat_h1jam", "tenggat_h1jam"]);
  });
});

describe("KERJA-IMPL-001 attachments (§9)", () => {
  it("rejects oversize, disguised and over-quota uploads and low disk, and stores keys, not names", async () => {
    const seed = await seedRooms();
    const kartu = await card(KEPALA_SMP, seed.smpBoard.kolom[0].id, { judul: "Berkas" });
    expect((await upload(KEPALA_SMP, `/kartu/${kartu}/lampiran`, "besar.txt", Buffer.alloc(65 * 1024, "a"))).body.error).toBe("lampiran_terlalu_besar");
    expect((await upload(KEPALA_SMP, `/kartu/${kartu}/lampiran`, "surat.pdf", Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]))).body.error).toBe("jenis_berkas_ditolak");
    for (let index = 0; index < 3; index += 1) {
      expect((await upload(KEPALA_SMP, `/ruang/${seed.smp}/lampiran`, `bagian${index}.txt`, Buffer.alloc(30 * 1024, "b"))).status).toBe(201);
    }
    expect((await upload(KEPALA_SMP, `/kartu/${kartu}/lampiran`, "lebih.txt", Buffer.alloc(30 * 1024, "c"))).body.error).toBe("kuota_ruang_habis");
    freeBytes = 1024;
    expect((await upload(KEPALA_SMP, `/kartu/${kartu}/lampiran`, "kecil.txt", Buffer.from("x"))).body.error).toBe("disk_hampir_penuh");
    const files = await readdir(join(mediaRoot, seed.smp));
    expect(files.every((name) => /^[0-9a-f-]{36}$/.test(name))).toBe(true);
    expect(files).toHaveLength(3);
    const room = (await call(TU_SMP, "GET", `/ruang/${seed.smp}/berkas`)).body;
    expect(room.kuota).toEqual({ terpakai: 90 * 1024, batas: 100 * 1024 });
  });

  it("serves files only to members, deletes softly, and purges the file later", async () => {
    const seed = await seedRooms();
    const kartu = await card(KEPALA_SMP, seed.smpBoard.kolom[0].id, { judul: "Berkas" });
    const file = (await upload(TU_SMP, `/kartu/${kartu}/lampiran`, "Rapor Mei.pdf", Buffer.from("%PDF-1.7\nhalo"))).body;
    const ok = await call(KABID, "GET", `/lampiran/${file.id}`);
    expect(ok.status).toBe(200);
    expect(ok.raw.headers["content-disposition"]).toContain("inline");
    expect(ok.raw.headers["content-security-policy"]).toContain("sandbox");
    expect((await call(KEPALA_PKBM, "GET", `/lampiran/${file.id}`)).status).toBe(404);
    expect((await call(WAKASEK, "DELETE", `/lampiran/${file.id}`)).status).toBe(403);
    expect((await call(TU_SMP, "DELETE", `/lampiran/${file.id}`)).status).toBe(200);
    expect((await call(KEPALA_SMP, "GET", `/lampiran/${file.id}`)).status).toBe(404);
    expect(await readdir(join(mediaRoot, seed.smp))).toHaveLength(1);
    await pool.query("UPDATE kerja_lampiran SET dihapus_pada = now() - interval '31 days' WHERE id = $1", [file.id]);
    expect(await kerja.attachments.purgeDeleted()).toBe(1);
    expect(await readdir(join(mediaRoot, seed.smp))).toHaveLength(0);
  });
});

describe("KERJA-IMPL-001 daily jobs", () => {
  it("runs once per Jakarta day after the configured hour", async () => {
    await seedRooms();
    const result = await kerja.runDaily(new Date("2026-11-10T23:00:00Z"));
    expect(result).toMatchObject({ ruangBerakhir: 0, berkasDibuang: 0 });
    const stored = await pool.query<{ tanggal: string }>("SELECT nilai->>'tanggal' AS tanggal FROM kerja_status WHERE kunci = 'harian'");
    expect(stored.rows[0]!.tanggal).toBe("2026-11-11");
  });
});
