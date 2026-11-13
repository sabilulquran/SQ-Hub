import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MachineAuthError } from "../src/modules/application-access/machine-auth.js";
import { HubAuthError, type HubAuthRuntime } from "../src/modules/hub-auth/service.js";
import type { Projection } from "../src/modules/organization-directory/repository.js";
import type { SekretariatConfig } from "../src/modules/sekretariat/config.js";
import { imporDoc003 } from "../src/modules/sekretariat/migrasi.js";
import { createSekretariatModule, type SekretariatModule } from "../src/modules/sekretariat/module.js";
import type { FetchedMail, MailFetcher, MailState } from "../src/modules/sekretariat/mail.js";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for integration tests");
const pool = new Pool({ connectionString: databaseUrl });

const ORIGIN = "https://sekretariat.sabilulquran.or.id";
const ISSUER = "https://sso.sabilulquran.or.id/realms/sq-staff";
const person = (n: number) => `hcis:employee:00000000-0000-4000-9100-${String(n).padStart(12, "0")}`;

const HCM = person(1); // sekretariat_admin
const DIREKTUR = person(2); // disposition holder
const TU_SDIT = person(3); // officer of SDITTSQ
const STAF_KEU = person(4); // officer of KEU.YSQ
const TANPA_PERAN = person(5); // signed in, no role

const NAMES: Record<string, string> = {
  [HCM]: "Kepala HCM",
  [DIREKTUR]: "Direktur",
  [TU_SDIT]: "TU SDIT",
  [STAF_KEU]: "Staf Keuangan",
  [TANPA_PERAN]: "Staf Biasa",
};
const session = (id: string) => `s-${id.slice(-4)}`;

function projection(): Projection {
  return {
    snapshot: {
      asOf: "2026-11-13",
      version: "v1",
      units: [],
      people: Object.entries(NAMES).map(([id, name]) => ({
        id, employeeNumber: `NIP${id.slice(-4)}`, displayName: name, active: true, employmentStatus: "tetap",
        startedOn: null, endedOn: null, currentPrimaryUnitId: null, structuralPositionIds: [], primaryStructuralPositionId: null,
        identityRefs: [{ issuer: ISSUER, subject: `sub-${id.slice(-4)}` }],
      })),
    },
    tombstones: { units: [], positions: [], people: [] },
    synchronizedAt: new Date().toISOString(),
  } as unknown as Projection;
}

const auth: HubAuthRuntime = {
  async getSession(token) {
    const id = Object.keys(NAMES).find((candidate) => session(candidate) === token);
    if (!id) throw new HubAuthError(401, "UNAUTHENTICATED", "no session");
    return {
      issuer: ISSUER, subject: `sub-${id.slice(-4)}`, displayName: NAMES[id]!, sessionId: randomUUID(), username: null, email: null,
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

/** Test seam fetcher: the suite pushes mails; UIDVALIDITY can be rotated to test the generation change. */
class FakeFetcher implements MailFetcher {
  readonly mailbox = "sekretariat@sabilulquran.or.id";
  uidValidity = "gen-1";
  mails: FetchedMail[] = [];
  fail = false;

  async fetchNew(state: MailState): Promise<{ uidValidity: string; mails: FetchedMail[] }> {
    if (this.fail) throw new Error("imap down");
    const since = state.uidValidity === this.uidValidity ? state.lastUid : 0;
    return { uidValidity: this.uidValidity, mails: this.mails.filter((mail) => mail.uid > since) };
  }
}

let mediaRoot: string;
let sekretariat: SekretariatModule;
let app: FastifyInstance;
let fetcher: FakeFetcher;
let now = new Date("2026-11-13T03:00:00Z");
let machineAllowed = true;

function config(): SekretariatConfig {
  return {
    oidc: { clientId: "sekretariat-sq", clientSecret: "test-secret" },
    publicOrigin: ORIGIN,
    mediaRoot,
    maxUploadBytes: 64 * 1024,
    mail: { mode: "log" },
    mailIntervalMs: 300_000,
    allowedMachineClients: new Set(["hcis-sekretariat"]),
    minFreeDiskBytes: 0,
  };
}

async function call(who: string | null, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown, options: { origin?: string | null } = {}) {
  const response = await app.inject({
    method,
    url,
    headers: {
      ...(who ? { cookie: `sq_sekretariat_session=${session(who)}` } : {}),
      ...(options.origin === null ? {} : { origin: options.origin ?? ORIGIN }),
    },
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });
  return { status: response.statusCode, body: response.headers["content-type"]?.toString().includes("json") ? response.json() : response.body, raw: response };
}

async function upload(who: string, path: string, filename: string, content: Buffer) {
  const boundary = `----sek${randomUUID()}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="berkas"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const response = await app.inject({
    method: "POST", url: `/sekretariat${path}`, payload: body,
    headers: { cookie: `sq_sekretariat_session=${session(who)}`, origin: ORIGIN, "content-type": `multipart/form-data; boundary=${boundary}` },
  });
  return { status: response.statusCode, body: response.json() };
}

const PDF = Buffer.from("%PDF-1.7\n%sekretariat test\n%%EOF\n");

async function penerbitId(kode: string): Promise<string> {
  return (await pool.query<{ id: string }>("SELECT id FROM sekretariat_penerbit WHERE kode = $1", [kode])).rows[0]!.id;
}

async function kotakYayasanId(): Promise<string> {
  return (await pool.query<{ id: string }>("SELECT id FROM sekretariat_kotak WHERE jenis = 'yayasan'")).rows[0]!.id;
}

async function kotakPenerbit(kode: string): Promise<string> {
  return (await pool.query<{ id: string }>(
    "SELECT k.id FROM sekretariat_kotak k JOIN sekretariat_penerbit p ON p.id = k.penerbit_id WHERE p.kode = $1", [kode],
  )).rows[0]!.id;
}

async function seedRoles() {
  await pool.query(
    "INSERT INTO sekretariat_admins (id, identity_issuer, identity_subject, granted_by, alasan) VALUES ($1, $2, $3, 'operator:test', 'uji')",
    [randomUUID(), ISSUER, `sub-${HCM.slice(-4)}`],
  );
  await pool.query(
    "INSERT INTO sekretariat_disposisi_pemegang (id, person_id, alasan, diberikan_oleh) VALUES ($1, $2, 'Direktur', 'operator:test')",
    [randomUUID(), DIREKTUR],
  );
  for (const [kode, orang] of [["SDITTSQ", TU_SDIT], ["KEU.YSQ", STAF_KEU]] as const) {
    await pool.query(
      "INSERT INTO sekretariat_petugas (id, penerbit_id, person_id, alasan, diberikan_oleh) VALUES ($1, $2, $3, 'uji', 'operator:test')",
      [randomUUID(), await penerbitId(kode), orang],
    );
  }
}

/** A published letter for an issuer: draft + PDF + terbit; returns surat id and nomor. */
async function terbitkanSurat(who: string, kode: string, jenis = "12"): Promise<{ id: string; nomor: string }> {
  const id = await penerbitId(kode);
  const draf = await call(who, "POST", `/sekretariat/penerbit/${id}/surat`, { jenis_kode: jenis, perihal: "Undangan rapat uji", tujuan: "Seluruh unit", penandatangan: "Kepala Satuan" });
  expect(draf.status).toBe(201);
  expect((await upload(who, `/surat/${draf.body.id}/berkas`, "surat.pdf", PDF)).status).toBe(201);
  const terbit = await call(who, "POST", `/sekretariat/surat/${draf.body.id}/terbit`, {});
  expect(terbit.status).toBe(200);
  return { id: draf.body.id as string, nomor: terbit.body.nomor as string };
}

beforeAll(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), "sekretariat-media-"));
});

afterAll(async () => {
  await app?.close();
  await pool.end();
  await rm(mediaRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await pool.query(`TRUNCATE sekretariat_petugas, sekretariat_disposisi_pemegang, sekretariat_penghitung, sekretariat_nomor,
    sekretariat_surat_keluar, sekretariat_berkas, sekretariat_surat_masuk, sekretariat_disposisi, sekretariat_mail_state,
    sekretariat_admins, sekretariat_audit CASCADE`);
  await pool.query("DELETE FROM sekretariat_kotak WHERE penerbit_id IN (SELECT id FROM sekretariat_penerbit WHERE kelompok IN ('panitia', 'lainnya'))");
  await pool.query("DELETE FROM sekretariat_penerbit WHERE kelompok IN ('panitia', 'lainnya')");
  await pool.query("DELETE FROM sekretariat_jenis WHERE urutan = 900");
  now = new Date("2026-11-13T03:00:00Z");
  machineAllowed = true;
  fetcher = new FakeFetcher();
  sekretariat = createSekretariatModule({
    pool,
    config: config(),
    keycloakIssuer: ISSUER,
    access: { checkAccess: async (_identity, key) => ({ allowed: key === "sekretariat-sq" }) as never },
    directorySource: { read: async () => projection() },
    verifyMachineToken: async (token) => {
      if (token !== "machine-token") throw new MachineAuthError("UNAUTHENTICATED", "bad token");
      if (!machineAllowed) throw new MachineAuthError("FORBIDDEN_CLIENT", "not allowed");
      return { clientId: "hcis-sekretariat" } as never;
    },
    auth,
    mailFetcher: fetcher,
    now: () => now,
    freeBytes: async () => 50 * 1024 * 1024 * 1024,
  });
  await app?.close();
  app = Fastify();
  sekretariat.register(app);
  await app.ready();
  await seedRoles();
});

describe("SEK-IMPL-001 buku nomor (§5)", () => {
  it("menerbitkan nomor berformat pedoman, berurutan per jenis per penerbit", async () => {
    const first = await terbitkanSurat(TU_SDIT, "SDITTSQ");
    const second = await terbitkanSurat(TU_SDIT, "SDITTSQ");
    expect(first.nomor).toBe("12.001/SDITTSQ/XI/2026");
    expect(second.nomor).toBe("12.002/SDITTSQ/XI/2026");
    const lain = await terbitkanSurat(STAF_KEU, "KEU.YSQ", "10");
    expect(lain.nomor).toBe("10.001/KEU.YSQ/XI/2026");
  });

  it("dua alokasi bersamaan tidak bercelah dan tidak ganda", async () => {
    const id = await penerbitId("KEU.YSQ");
    const draft = async () => {
      const draf = await call(STAF_KEU, "POST", `/sekretariat/penerbit/${id}/surat`, { jenis_kode: "10", perihal: "Permohonan uji", tujuan: "Bank", penandatangan: "Kepala Divisi" });
      await upload(STAF_KEU, `/surat/${draf.body.id}/berkas`, "surat.pdf", PDF);
      return draf.body.id as string;
    };
    const [a, b] = await Promise.all([draft(), draft()]);
    const results = await Promise.all([
      call(STAF_KEU, "POST", `/sekretariat/surat/${a}/terbit`, {}),
      call(STAF_KEU, "POST", `/sekretariat/surat/${b}/terbit`, {}),
    ]);
    const nomor = results.map((result) => result.body.nomor as string).sort();
    expect(nomor).toEqual(["10.001/KEU.YSQ/XI/2026", "10.002/KEU.YSQ/XI/2026"]);
  });

  it("reset pada 1 Januari WIB", async () => {
    await terbitkanSurat(TU_SDIT, "SDITTSQ");
    now = new Date("2026-12-31T17:30:00Z"); // 2027-01-01 00:30 WIB
    const tahunBaru = await terbitkanSurat(TU_SDIT, "SDITTSQ");
    expect(tahunBaru.nomor).toBe("12.001/SDITTSQ/I/2027");
  });

  it("pembatalan menahan nomor: urut berikutnya tidak memakai ulang", async () => {
    const surat = await terbitkanSurat(TU_SDIT, "SDITTSQ");
    const batal = await call(TU_SDIT, "POST", `/sekretariat/surat/${surat.id}/batal`, { alasan: "Salah tujuan, diganti surat baru." });
    expect(batal.status).toBe(200);
    const berikut = await terbitkanSurat(TU_SDIT, "SDITTSQ");
    expect(berikut.nomor).toBe("12.002/SDITTSQ/XI/2026");
    const register = await call(TU_SDIT, "GET", "/sekretariat/register?status=dibatalkan");
    expect(register.body.items.map((item: { nomor: string }) => item.nomor)).toContain(surat.nomor);
  });

  it("nomor awal hanya menaikkan", async () => {
    const id = await penerbitId("SDITTSQ");
    const naik = await call(HCM, "POST", "/admin/sekretariat/nomor-awal", { penerbit_id: id, jenis_kode: "12", tahun: 2026, nilai: 40, alasan: "Sisa buku manual" });
    expect(naik.status).toBe(200);
    const turun = await call(HCM, "POST", "/admin/sekretariat/nomor-awal", { penerbit_id: id, jenis_kode: "12", tahun: 2026, nilai: 10, alasan: "Coba turunkan" });
    expect(turun.status).toBe(409);
    const surat = await terbitkanSurat(TU_SDIT, "SDITTSQ");
    expect(surat.nomor).toBe("12.041/SDITTSQ/XI/2026");
  });

  it("surat tanpa PDF tidak terbit, dan PDF surat terbit terkunci", async () => {
    const id = await penerbitId("SDITTSQ");
    const draf = await call(TU_SDIT, "POST", `/sekretariat/penerbit/${id}/surat`, { jenis_kode: "12", perihal: "Tanpa berkas", tujuan: "Unit", penandatangan: "Kepala" });
    expect((await call(TU_SDIT, "POST", `/sekretariat/surat/${draf.body.id}/terbit`, {})).status).toBe(409);
    const surat = await terbitkanSurat(TU_SDIT, "SDITTSQ");
    const ulang = await upload(TU_SDIT, `/surat/${surat.id}/berkas`, "revisi.pdf", PDF);
    expect(ulang.status).toBe(409);
    expect(ulang.body.error).toBe("berkas_terkunci");
  });

  it("retroaktif menyimpan nomor asli tanpa menyentuh penghitung", async () => {
    const id = await penerbitId("SDITTSQ");
    const retro = await call(TU_SDIT, "POST", `/sekretariat/penerbit/${id}/retroaktif`, {
      nomor_asli: "UND.007/SDIT/XI/2025", tanggal_asli: "2025-11-01", jenis_kode: "12", perihal: "Arsip lama", tujuan: "Wali murid", penandatangan: "Kepala",
    });
    expect(retro.status).toBe(201);
    const surat = await terbitkanSurat(TU_SDIT, "SDITTSQ");
    expect(surat.nomor).toBe("12.001/SDITTSQ/XI/2026");
  });

  it("balasan surat masuk selalu kode 14 dan tertaut", async () => {
    const kotak = await kotakPenerbit("SDITTSQ");
    const masuk = await call(TU_SDIT, "POST", `/sekretariat/kotak/${kotak}/surat`, { dari: "Dinas Pendidikan", perihal: "Permintaan data" });
    expect(masuk.status).toBe(201);
    const id = await penerbitId("SDITTSQ");
    const draf = await call(TU_SDIT, "POST", `/sekretariat/penerbit/${id}/surat`, {
      jenis_kode: "10", perihal: "Jawaban data", tujuan: "Dinas Pendidikan", penandatangan: "Kepala", balasan_atas: masuk.body.id,
    });
    expect(draf.status).toBe(201);
    expect(draf.body.jenisKode).toBe("14");
    const detail = await call(TU_SDIT, "GET", `/sekretariat/surat-masuk/${masuk.body.id}`);
    expect(detail.body.balasan).toHaveLength(1);
  });
});

describe("SEK-IMPL-001 akses berlapis (§8)", () => {
  it("petugas penerbit lain mendapat 404, admin melihat semua", async () => {
    const keu = await penerbitId("KEU.YSQ");
    expect((await call(TU_SDIT, "GET", `/sekretariat/penerbit/${keu}/surat`)).status).toBe(404);
    expect((await call(TU_SDIT, "GET", `/sekretariat/kotak/${await kotakPenerbit("KEU.YSQ")}/surat`)).status).toBe(404);
    expect((await call(HCM, "GET", `/sekretariat/penerbit/${keu}/surat`)).status).toBe(200);
    const surat = await terbitkanSurat(STAF_KEU, "KEU.YSQ", "10");
    expect((await call(TU_SDIT, "GET", `/sekretariat/surat/${surat.id}`)).status).toBe(404);
  });

  it("register tersaring per penerbit; tanpa peran kosong; tanpa akses aplikasi 403", async () => {
    await terbitkanSurat(TU_SDIT, "SDITTSQ");
    await terbitkanSurat(STAF_KEU, "KEU.YSQ", "10");
    const milikTu = await call(TU_SDIT, "GET", "/sekretariat/register");
    expect(milikTu.body.items).toHaveLength(1);
    expect(milikTu.body.items[0].penerbit).toBe("SDITTSQ");
    const milikAdmin = await call(HCM, "GET", "/sekretariat/register");
    expect(milikAdmin.body.total).toBe(2);
    const kosong = await call(TANPA_PERAN, "GET", "/sekretariat/register");
    expect(kosong.body.items).toHaveLength(0);
    expect((await call(null, "GET", "/sekretariat/register")).status).toBe(401);
    expect((await call(TANPA_PERAN, "GET", "/admin/sekretariat/penerbit")).status).toBe(403);
  });

  it("kotak yayasan hanya untuk admin dan pemegang disposisi", async () => {
    const yayasan = await kotakYayasanId();
    expect((await call(TU_SDIT, "GET", `/sekretariat/kotak/${yayasan}/surat`)).status).toBe(404);
    expect((await call(DIREKTUR, "GET", `/sekretariat/kotak/${yayasan}/surat`)).status).toBe(200);
    expect((await call(HCM, "GET", `/sekretariat/kotak/${yayasan}/surat`)).status).toBe(200);
  });

  it("mutasi dari origin lain ditolak", async () => {
    const id = await penerbitId("SDITTSQ");
    const asing = await call(TU_SDIT, "POST", `/sekretariat/penerbit/${id}/surat`,
      { jenis_kode: "12", perihal: "Uji origin", tujuan: "Unit", penandatangan: "Kepala" }, { origin: "https://jahat.example" });
    expect(asing.status).toBe(403);
  });
});

describe("SEK-IMPL-001 kotak masuk dan disposisi (§7)", () => {
  it("disposisi memindahkan kerja ke kotak penerbit dan selesai menutup surat", async () => {
    const yayasan = await kotakYayasanId();
    const masuk = await call(DIREKTUR, "POST", `/sekretariat/kotak/${yayasan}/surat`, { dari: "Bank", perihal: "Konfirmasi rekening" });
    const sdit = await penerbitId("SDITTSQ");
    const disposisi = await call(DIREKTUR, "POST", `/sekretariat/surat-masuk/${masuk.body.id}/disposisi`, { ke_penerbit_id: sdit, catatan: "Tolong jawab", tenggat_pada: "2026-11-20" });
    expect(disposisi.status).toBe(201);
    // The SDIT officer now sees it in their inbox view and can open it.
    const isi = await call(TU_SDIT, "GET", `/sekretariat/kotak/${await kotakPenerbit("SDITTSQ")}/surat`);
    expect(isi.body.items.map((item: { id: string }) => item.id)).toContain(masuk.body.id);
    const detail = await call(TU_SDIT, "GET", `/sekretariat/surat-masuk/${masuk.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.status).toBe("didisposisi");
    const selesai = await call(TU_SDIT, "POST", `/sekretariat/disposisi/${detail.body.disposisi[0].id}/selesai`, { keterangan: "Sudah dijawab" });
    expect(selesai.status).toBe(200);
    expect((await call(DIREKTUR, "GET", `/sekretariat/surat-masuk/${masuk.body.id}`)).body.status).toBe("selesai");
    // The officer must not dispose foundation mail themselves.
    const masuk2 = await call(DIREKTUR, "POST", `/sekretariat/kotak/${yayasan}/surat`, { dari: "Bank", perihal: "Kedua" });
    expect((await call(TU_SDIT, "POST", `/sekretariat/surat-masuk/${masuk2.body.id}/disposisi`, { ke_penerbit_id: sdit, catatan: "Coba" })).status).toBe(404);
  });

  it("spam hanya di kotak yayasan, tercatat, dan tidak bisa didisposisi", async () => {
    const yayasan = await kotakYayasanId();
    const masuk = await call(DIREKTUR, "POST", `/sekretariat/kotak/${yayasan}/surat`, { dari: "Promo", perihal: "Iklan" });
    expect((await call(DIREKTUR, "POST", `/sekretariat/surat-masuk/${masuk.body.id}/spam`, {})).status).toBe(200);
    const sdit = await penerbitId("SDITTSQ");
    expect((await call(DIREKTUR, "POST", `/sekretariat/surat-masuk/${masuk.body.id}/disposisi`, { ke_penerbit_id: sdit, catatan: "Coba" })).status).toBe(409);
  });
});

describe("SEK-IMPL-001 penarik email (§7 nomor 1)", () => {
  const mail = (uid: number, extra: Partial<FetchedMail> = {}): FetchedMail => ({
    uid,
    messageId: `<m-${uid}@example.test>`,
    dari: "Dinas <dinas@example.test>",
    perihal: `Surat elektronik ${uid}`,
    tanggal: new Date("2026-11-13T02:00:00Z"),
    teks: "Isi email uji",
    lampiran: [],
    ...extra,
  });

  it("menarik email baru sekali saja, lampiran tersimpan, mailbox state maju", async () => {
    fetcher.mails = [mail(1, { lampiran: [{ nama: "berkas.pdf", isi: PDF }] }), mail(2)];
    const pertama = await sekretariat.mail.runOnce();
    expect(pertama).toEqual({ baru: 2, dilewati: 0 });
    const ulang = await sekretariat.mail.runOnce();
    expect(ulang.baru).toBe(0);
    const yayasan = await kotakYayasanId();
    const isi = await call(DIREKTUR, "GET", `/sekretariat/kotak/${yayasan}/surat`);
    expect(isi.body.total).toBe(2);
    const detail = await call(DIREKTUR, "GET", `/sekretariat/surat-masuk/${isi.body.items[1].id}`);
    expect(detail.body.berkas).toHaveLength(1);
    expect(detail.body.berkas[0].nama).toBe("berkas.pdf");
  });

  it("UIDVALIDITY berubah tidak menduplikasi lewat Message-ID", async () => {
    fetcher.mails = [mail(5)];
    await sekretariat.mail.runOnce();
    fetcher.uidValidity = "gen-2";
    fetcher.mails = [mail(1, { messageId: "<m-5@example.test>" })];
    const hasil = await sekretariat.mail.runOnce();
    expect(hasil.baru).toBe(0);
    expect(hasil.dilewati).toBe(1);
  });

  it("lampiran kebesaran dicatat sebagai keterangan, bukan berkas (D-2)", async () => {
    fetcher.mails = [mail(1, { lampiran: [{ nama: "video.pdf", isi: Buffer.alloc(80 * 1024, 1) }] })];
    await sekretariat.mail.runOnce();
    const yayasan = await kotakYayasanId();
    const isi = await call(DIREKTUR, "GET", `/sekretariat/kotak/${yayasan}/surat`);
    const detail = await call(DIREKTUR, "GET", `/sekretariat/surat-masuk/${isi.body.items[0].id}`);
    expect(detail.body.berkas).toHaveLength(0);
    expect(detail.body.isiTeks).toContain("terlalu besar");
  });

  it("kegagalan IMAP tercatat untuk layar admin dan tidak melempar", async () => {
    fetcher.fail = true;
    const hasil = await sekretariat.mail.runOnce();
    expect(hasil).toEqual({ baru: 0, dilewati: 0 });
    const status = await call(HCM, "GET", "/admin/sekretariat/mail");
    expect(status.body.items[0].galatTerakhir).toBe("Error");
  });
});

describe("SEK-IMPL-001 API alokasi mesin (§5.5, D-3)", () => {
  const body = {
    penerbit_kode: "HCM.YSQ", jenis_kode: "08", perihal: "Surat keterangan kerja", tujuan: "Pegawai",
    rujukan_modul: "hcis-doc", rujukan_id: "doc-123",
  };
  const callMachine = (payload: unknown, token?: string) =>
    app.inject({
      method: "POST",
      url: "/internal/sekretariat/v1/alokasi-nomor",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      payload: payload as Record<string, unknown>,
    });

  it("idempoten per rujukan dan fail-closed tanpa token", async () => {
    expect((await callMachine(body)).statusCode).toBe(401);
    expect((await callMachine(body, "salah")).statusCode).toBe(401);
    machineAllowed = false;
    expect((await callMachine(body, "machine-token")).statusCode).toBe(403);
    machineAllowed = true;
    const first = await callMachine(body, "machine-token");
    expect(first.statusCode).toBe(201);
    const nomor = first.json().nomor as string;
    expect(nomor).toBe("08.001/HCM.YSQ/XI/2026");
    const repeat = await callMachine(body, "machine-token");
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json().nomor).toBe(nomor);
    expect(repeat.json().sudah_ada).toBe(true);
    const lain = await callMachine({ ...body, rujukan_id: "doc-124" }, "machine-token");
    expect(lain.json().nomor).toBe("08.002/HCM.YSQ/XI/2026");
  });

  it("penerbit tak dikenal ditolak tanpa memakan nomor", async () => {
    const salah = await callMachine({ ...body, penerbit_kode: "TIDAK.ADA" }, "machine-token");
    expect(salah.statusCode).toBe(400);
    const benar = await callMachine(body, "machine-token");
    expect(benar.json().nomor).toBe("08.001/HCM.YSQ/XI/2026");
  });
});

describe("SEK-IMPL-001 migrasi DOC-003 (§14 langkah 8)", () => {
  const ekspor = {
    types: [{ code: "UND", label: "Undangan" }],
    issuers: [{ code: "YSQ", name: "Yayasan Sabilul Qur'an", kind: "ORGANIZATION" }],
    grants: [{ issuerCode: "YSQ", personId: TU_SDIT, reason: "petugas lama" }],
    counters: [
      { issuerCode: "YSQ", typeCode: "UND", periodKey: "2026", lastSequence: 7 },
      { issuerCode: "SDITTSQ", typeCode: "12", periodKey: "2026-10", lastSequence: 3 },
    ],
    numbers: [
      { sourceId: "n1", issuerCode: "YSQ", typeCode: "UND", periodKey: "2026", sequence: 7, letterNumber: "UND.007/YSQ/XI/2026", letterDate: "2026-11-01", subject: "Undangan", recipient: "Unit", status: "ALLOCATED" as const, voidedReason: null, requestedBy: "migrasi:doc003" },
      { sourceId: "n2", issuerCode: "YSQ", typeCode: "UND", periodKey: "2026", sequence: 6, letterNumber: "UND.006/YSQ/XI/2026", letterDate: "2026-11-01", subject: "Batal", recipient: "Unit", status: "VOIDED" as const, voidedReason: "salah ketik di DOC-003", requestedBy: "migrasi:doc003" },
    ],
  };

  it("idempoten, penghitung tidak pernah turun, nomor lama utuh", async () => {
    const first = await imporDoc003(pool, "operator:test", ekspor);
    expect(first.nomorBaru).toBe(2);
    expect(first.verifikasi.penghitungKurang).toHaveLength(0);
    const second = await imporDoc003(pool, "operator:test", ekspor);
    expect(second.nomorBaru).toBe(0);
    expect(second.nomorDilewati).toBe(2);
    // The migrated monthly counter folds into the year and the next SDIT publication continues past it.
    const surat = await terbitkanSurat(TU_SDIT, "SDITTSQ");
    expect(surat.nomor).toBe("12.004/SDITTSQ/XI/2026");
    // The legacy number stays exactly as formatted and shows up for the admin.
    const register = await call(HCM, "GET", "/sekretariat/register?status=dibatalkan");
    expect(register.body.items.map((item: { nomor: string }) => item.nomor)).toContain("UND.006/YSQ/XI/2026");
  });
});

describe("SEK-IMPL-001 audit (§9)", () => {
  it("alokasi, batal, dan tindakan admin menulis audit", async () => {
    const before = Number((await pool.query<{ c: string }>("SELECT count(*) AS c FROM sekretariat_audit")).rows[0]!.c);
    const surat = await terbitkanSurat(TU_SDIT, "SDITTSQ");
    await call(TU_SDIT, "POST", `/sekretariat/surat/${surat.id}/batal`, { alasan: "Salah lampiran, ganti baru." });
    await call(HCM, "POST", "/admin/sekretariat/penerbit", { kode: "PAN.MILAD", nama: "Panitia Milad", berakhir_pada: "2027-01-31", alasan: "Milad 2027" });
    const after = Number((await pool.query<{ c: string }>("SELECT count(*) AS c FROM sekretariat_audit")).rows[0]!.c);
    expect(after - before).toBeGreaterThanOrEqual(3);
    const tanpaAlasan = await call(HCM, "POST", "/admin/sekretariat/penerbit", { kode: "PAN.LAIN", nama: "Panitia", berakhir_pada: "2027-01-31", alasan: "" });
    expect(tanpaAlasan.status).toBe(400);
  });
});
