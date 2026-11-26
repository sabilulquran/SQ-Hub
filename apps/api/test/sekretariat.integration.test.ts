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
import { PenyusunError, type MasukanAsisten, type Penyusun, type Pertanyaan } from "../src/modules/sekretariat/penyusun.js";

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

/**
 * SEK-IMPL-004 test seam: a drafter that never touches the network. It deliberately returns raw
 * text, so the server's own number filter (§6.5 nomor 3) is what the suite exercises.
 */
class FakePenyusun implements Penyusun {
  readonly mode = "claude" as const;
  pertanyaan: Pertanyaan[] = [{ kunci: "dasar", pertanyaan: "Apa dasarnya?", mengapa: "Unsur wajib." }];
  bagian: Record<string, string> = { dasar: "Perjanjian kerja sama katering.", fakta: "Terlambat tiga kali." };
  gagal: null | "tolak" | "galat" = null;
  panggilan = 0;
  terakhir: MasukanAsisten | null = null;

  private jalan(masukan: MasukanAsisten) {
    this.panggilan += 1;
    this.terakhir = masukan;
    if (this.gagal === "tolak") throw new PenyusunError("AI_DITOLAK", "ditolak");
    if (this.gagal === "galat") throw new PenyusunError("AI_GALAT", "galat");
  }

  async tanya(masukan: MasukanAsisten) {
    this.jalan(masukan);
    return { pertanyaan: this.pertanyaan, tokenMasuk: 11, tokenKeluar: 22 };
  }

  async susun(masukan: MasukanAsisten) {
    this.jalan(masukan);
    return { bagian: { ...this.bagian }, tokenMasuk: 33, tokenKeluar: 44 };
  }
}

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
/** SEK-IMPL-002: what the fake IMAP probe was handed, and whether it refuses. */
let probeCalls: Array<{ host: string; user: string; pass: string }> = [];
let probeRefusal: string | null = null;
/** SEK-IMPL-004: the assistant is on in the suite, with a generous monthly ceiling by default. */
let asistenAktif = true;
let maksPanggilanBulan = 100;
let penyusun: FakePenyusun;

function config(): SekretariatConfig {
  return {
    oidc: { clientId: "sekretariat-sq", clientSecret: "test-secret" },
    publicOrigin: ORIGIN,
    mediaRoot,
    maxUploadBytes: 64 * 1024,
    mail: { mode: "log" },
    mailIntervalMs: 300_000,
    dataKeys: [{ kid: "k1", key: Buffer.alloc(32, 7) }],
    allowedMachineClients: new Set(["hcis-sekretariat"]),
    minFreeDiskBytes: 0,
    asisten: {
      enabled: asistenAktif,
      mode: "claude",
      model: "model-uji",
      apiKey: "kunci-uji",
      maksPanggilanBulan: maksPanggilanBulan,
      timeoutMs: 1000,
    },
  };
}

async function call(who: string | null, method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, payload?: unknown, options: { origin?: string | null } = {}) {
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
    sekretariat_admins, sekretariat_audit, sekretariat_mailbox CASCADE`);
  await pool.query("DELETE FROM sekretariat_kotak WHERE penerbit_id IN (SELECT id FROM sekretariat_penerbit WHERE kelompok IN ('panitia', 'lainnya'))");
  await pool.query("DELETE FROM sekretariat_penerbit WHERE kelompok IN ('panitia', 'lainnya')");
  await pool.query("DELETE FROM sekretariat_jenis WHERE urutan = 900");
  await pool.query("TRUNCATE sekretariat_surat_isi, sekretariat_ai_pemakaian CASCADE");
  now = new Date("2026-11-13T03:00:00Z");
  machineAllowed = true;
  probeCalls = [];
  probeRefusal = null;
  asistenAktif = true;
  maksPanggilanBulan = 100;
  penyusun = new FakePenyusun();
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
    mailboxProbe: async (settings) => {
      probeCalls.push({ host: settings.host, user: settings.user, pass: settings.pass });
      const refuse = probeRefusal;
      if (refuse) throw new Error(refuse);
    },
    now: () => now,
    freeBytes: async () => 50 * 1024 * 1024 * 1024,
    penyusun,
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

  it("membatalkan nomor dari buku ikut membatalkan suratnya", async () => {
    const surat = await terbitkanSurat(TU_SDIT, "SDITTSQ");
    const nomorId = (await pool.query<{ nomor_id: string }>("SELECT nomor_id FROM sekretariat_surat_keluar WHERE id = $1", [surat.id])).rows[0]!.nomor_id;
    expect((await call(HCM, "POST", `/sekretariat/nomor/${nomorId}/batal`, { alasan: "Dibatalkan dari buku nomor." })).status).toBe(200);
    const detail = await call(TU_SDIT, "GET", `/sekretariat/surat/${surat.id}`);
    expect(detail.body.status).toBe("dibatalkan");
  });

  it("menghapus draf menandai berkasnya untuk dibuang, bukan meninggalkannya yatim", async () => {
    const id = await penerbitId("SDITTSQ");
    const draf = await call(TU_SDIT, "POST", `/sekretariat/penerbit/${id}/surat`, { jenis_kode: "12", perihal: "Draf dibuang", tujuan: "Unit", penandatangan: "Kepala" });
    await upload(TU_SDIT, `/surat/${draf.body.id}/berkas`, "surat.pdf", PDF);
    await call(TU_SDIT, "POST", `/sekretariat/surat/${draf.body.id}/batal`, { alasan: "Tidak jadi, dihapus." });
    const rows = await pool.query<{ dihapus: boolean }>("SELECT dihapus FROM sekretariat_berkas WHERE pemilik_id = $1", [draf.body.id]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.dihapus).toBe(true);
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
    expect(pertama).toEqual({ baru: 2, dilewati: 0, gagal: false });
    const ulang = await sekretariat.mail.runOnce();
    expect(ulang.baru).toBe(0);
    const yayasan = await kotakYayasanId();
    const isi = await call(DIREKTUR, "GET", `/sekretariat/kotak/${yayasan}/surat`);
    expect(isi.body.total).toBe(2);
    const berlampiran = isi.body.items.find((item: { perihal: string }) => item.perihal === "Surat elektronik 1");
    const detail = await call(DIREKTUR, "GET", `/sekretariat/surat-masuk/${berlampiran.id}`);
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

  it("email tanpa Message-ID tetap terdedup saat UIDVALIDITY berganti", async () => {
    fetcher.mails = [mail(3, { messageId: null, perihal: "Tanpa message-id" })];
    await sekretariat.mail.runOnce();
    fetcher.uidValidity = "gen-2";
    fetcher.mails = [mail(9, { messageId: null, perihal: "Tanpa message-id" })]; // same content, new generation and uid
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
    // SEK-IMPL-002: a failed round now also carries the fetcher's error so the caller can
    // classify it per mailbox, hence a shape check rather than an exact one.
    expect(hasil).toMatchObject({ baru: 0, dilewati: 0, gagal: true });
    expect(hasil.error).toBeInstanceOf(Error);
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

describe("SEK-IMPL-002 kotak masuk disambungkan dari layar", () => {
  const MAILBOX = { alamat: "sekretariat@sabilulquran.or.id", host: "mail.sabilulquran.or.id", port: 993, sandi: "rahasia-uji", kotak_id: "" };

  async function kotakYayasan(): Promise<string> {
    return (await pool.query<{ id: string }>("SELECT id FROM sekretariat_kotak WHERE jenis = 'yayasan'")).rows[0]!.id;
  }

  async function tambah(who = HCM, override: Record<string, unknown> = {}) {
    return call(who, "POST", "/admin/sekretariat/mailbox", { ...MAILBOX, kotak_id: await kotakYayasan(), ...override });
  }

  it("hanya sekretariat_admin yang melihat dan mengubahnya (M-9)", async () => {
    expect((await call(TU_SDIT, "GET", "/admin/sekretariat/mailbox")).status).toBe(403);
    expect((await tambah(TU_SDIT)).status).toBe(403);
    expect((await call(HCM, "GET", "/admin/sekretariat/mailbox")).status).toBe(200);
  });

  it("menguji login sungguhan sebelum menyimpan, dan menolak menyimpan bila ditolak (M-4)", async () => {
    probeRefusal = "Invalid credentials (Failure)";
    const gagal = await tambah();
    expect(gagal.status).toBe(400);
    expect(gagal.body.error).toBe("sambungan_sandi_ditolak");
    expect((await pool.query("SELECT 1 FROM sekretariat_mailbox")).rowCount).toBe(0);

    probeRefusal = null;
    const ok = await tambah();
    expect(ok.status).toBe(201);
    expect(probeCalls.at(-1)).toMatchObject({ host: MAILBOX.host, user: MAILBOX.alamat, pass: MAILBOX.sandi });
  });

  it("tidak pernah mengirim sandi kembali, dan menyimpannya terenkripsi (M-2, M-3)", async () => {
    const dibuat = await tambah();
    expect(JSON.stringify(dibuat.body)).not.toContain(MAILBOX.sandi);
    const daftar = await call(HCM, "GET", "/admin/sekretariat/mailbox");
    expect(JSON.stringify(daftar.body)).not.toContain(MAILBOX.sandi);
    const row = (await pool.query<{ sandi_terenkripsi: string }>("SELECT sandi_terenkripsi FROM sekretariat_mailbox")).rows[0]!;
    expect(row.sandi_terenkripsi).not.toContain(MAILBOX.sandi);
    expect(row.sandi_terenkripsi.startsWith("v1.k1.")).toBe(true);
    const audit = await pool.query<{ metadata: unknown }>("SELECT metadata FROM sekretariat_audit WHERE aksi = 'mailbox.tambah'");
    expect(audit.rowCount).toBe(1);
    expect(JSON.stringify(audit.rows[0]!.metadata)).not.toContain(MAILBOX.sandi);
  });

  it("mengubah tanpa mengisi sandi memakai sandi lama selama tujuannya sama (M-3)", async () => {
    const dibuat = await tambah();
    const id = dibuat.body.id as string;
    const diubah = await call(HCM, "PUT", `/admin/sekretariat/mailbox/${id}`, {
      alamat: MAILBOX.alamat, host: MAILBOX.host, port: 993, kotak_id: await kotakYayasan(),
    });
    expect(diubah.status).toBe(200);
    expect(probeCalls.at(-1)!.pass).toBe(MAILBOX.sandi);
  });

  it("menolak memakai sandi tersimpan ke host lain, supaya tidak bisa dibaca balik (M-3a)", async () => {
    const id = (await tambah()).body.id as string;
    const sebelum = probeCalls.length;
    const curi = await call(HCM, "PUT", `/admin/sekretariat/mailbox/${id}`, {
      alamat: MAILBOX.alamat, host: "mesin-penyerang.example", port: 993, kotak_id: await kotakYayasan(),
    });
    expect(curi.status).toBe(400);
    expect(curi.body.error).toBe("sandi_wajib_tujuan_berubah");
    // Yang penting: sandinya tidak pernah dikirim ke host itu.
    expect(probeCalls).toHaveLength(sebelum);
  });

  it("menolak pengguna lain dengan sandi tersimpan (M-3a)", async () => {
    const id = (await tambah()).body.id as string;
    const ganti = await call(HCM, "PUT", `/admin/sekretariat/mailbox/${id}`, {
      alamat: MAILBOX.alamat, host: MAILBOX.host, port: 993, pengguna: "orang-lain@sabilulquran.or.id", kotak_id: await kotakYayasan(),
    });
    expect(ganti.body.error).toBe("sandi_wajib_tujuan_berubah");
  });

  it("mencatat setiap percobaan sambungan, berhasil maupun gagal (§6)", async () => {
    await tambah();
    probeRefusal = "Command failed";
    await tambah(HCM, { alamat: "lain@sabilulquran.or.id" });
    const audit = await pool.query<{ metadata: { hasil: string; host: string } }>(
      "SELECT metadata FROM sekretariat_audit WHERE aksi = 'mailbox.uji' ORDER BY id",
    );
    expect(audit.rowCount).toBe(2);
    expect(audit.rows[0]!.metadata.hasil).toBe("berhasil");
    expect(audit.rows[1]!.metadata.hasil).not.toBe("berhasil");
    expect(JSON.stringify(audit.rows)).not.toContain(MAILBOX.sandi);
  });

  it("hanya menerima port IMAP 993 dan 143 (M-8a)", async () => {
    expect((await tambah(HCM, { port: 2525 })).status).toBe(400);
    expect((await tambah(HCM, { port: 143 })).status).toBe(201);
  });

  it("menolak alamat ganda dan kotak yang tidak dikenal", async () => {
    expect((await tambah()).status).toBe(201);
    expect((await tambah()).body.error).toBe("alamat_ganda");
    const salahKotak = await call(HCM, "POST", "/admin/sekretariat/mailbox", { ...MAILBOX, kotak_id: randomUUID() });
    expect(salahKotak.body.error).toBe("kotak_tidak_dikenal");
  });

  it("menambah tanpa sandi ditolak", async () => {
    const tanpa = await call(HCM, "POST", "/admin/sekretariat/mailbox", {
      alamat: MAILBOX.alamat, host: MAILBOX.host, port: 993, kotak_id: await kotakYayasan(),
    });
    expect(tanpa.body.error).toBe("sandi_wajib");
  });

  it("tidak memarkir karena empat waktu habis lalu satu sandi ditolak (M-8)", async () => {
    const id = (await tambah()).body.id as string;
    for (let attempt = 0; attempt < 4; attempt += 1) await sekretariat.mailbox.catatGagal(id, "waktu_habis");
    await sekretariat.mailbox.catatGagal(id, "sandi_ditolak");
    const row = (await pool.query<{ status: string; gagal_berturut: number }>(
      "SELECT status, gagal_berturut FROM sekretariat_mailbox WHERE id = $1", [id])).rows[0]!;
    expect(row.status).toBe("aktif");
    expect(row.gagal_berturut).toBe(1);
  });

  it("memarkir mailbox setelah lima penolakan sandi berturut-turut (M-8)", async () => {
    const id = (await tambah()).body.id as string;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await sekretariat.mailbox.catatGagal(id, "sandi_ditolak");
    }
    const row = (await pool.query<{ status: string; gagal_berturut: number }>("SELECT status, gagal_berturut FROM sekretariat_mailbox WHERE id = $1", [id])).rows[0]!;
    expect(row.status).toBe("auth_gagal");
    expect(await sekretariat.mailbox.aktif()).toHaveLength(0);

    // Menyimpan ulang menghidupkannya kembali.
    await call(HCM, "PUT", `/admin/sekretariat/mailbox/${id}`, { ...MAILBOX, kotak_id: await kotakYayasan() });
    expect((await pool.query<{ status: string }>("SELECT status FROM sekretariat_mailbox WHERE id = $1", [id])).rows[0]!.status).toBe("aktif");
  });

  it("kegagalan lain tidak memarkir mailbox", async () => {
    const id = (await tambah()).body.id as string;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await sekretariat.mailbox.catatGagal(id, "waktu_habis");
    }
    expect((await pool.query<{ status: string }>("SELECT status FROM sekretariat_mailbox WHERE id = $1", [id])).rows[0]!.status).toBe("aktif");
  });

  it("menonaktifkan menghentikan penarikan, mengaktifkan memulihkannya", async () => {
    const id = (await tambah()).body.id as string;
    expect(await sekretariat.mailbox.aktif()).toHaveLength(1);
    expect((await call(HCM, "POST", `/admin/sekretariat/mailbox/${id}/status`, { status: "nonaktif" })).status).toBe(200);
    expect(await sekretariat.mailbox.aktif()).toHaveLength(0);
    await call(HCM, "POST", `/admin/sekretariat/mailbox/${id}/status`, { status: "aktif" });
    expect(await sekretariat.mailbox.aktif()).toHaveLength(1);
  });

  it("menghapus mailbox tidak menghapus surat yang sudah masuk (M-11)", async () => {
    const id = (await tambah()).body.id as string;
    await pool.query(
      `INSERT INTO sekretariat_surat_masuk (id, kotak_id, kanal, dari, perihal, isi_teks, diterima_pada, email_message_id, email_uidvalidity, email_uid)
       VALUES ($1, $2, 'email', 'pengirim@luar.id', 'Surat uji', 'isi', now(), $3, '1', 1)`,
      [randomUUID(), await kotakYayasan(), `uji-${randomUUID()}@luar.id`],
    );
    expect((await call(HCM, "DELETE", `/admin/sekretariat/mailbox/${id}`)).status).toBe(204);
    expect((await pool.query("SELECT 1 FROM sekretariat_mailbox")).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM sekretariat_surat_masuk")).rowCount).toBe(1);
  });

  it("membuka sandi tersimpan untuk penarik, terikat pada barisnya (M-2)", async () => {
    await tambah();
    const runtimes = await sekretariat.mailbox.aktif();
    expect(runtimes).toHaveLength(1);
    expect(runtimes[0]).toMatchObject({ host: MAILBOX.host, pengguna: MAILBOX.alamat, sandi: MAILBOX.sandi });
  });

  it("env hanya dipakai saat tabelnya benar-benar kosong (M-5)", async () => {
    expect(await sekretariat.mailbox.jumlah()).toBe(0);
    const id = (await tambah()).body.id as string;
    await call(HCM, "POST", `/admin/sekretariat/mailbox/${id}/status`, { status: "nonaktif" });
    // Tidak ada baris aktif, tetapi tabelnya tidak kosong: penarik tidak boleh kembali ke env.
    expect(await sekretariat.mailbox.aktif()).toHaveLength(0);
    expect(await sekretariat.mailbox.jumlah()).toBe(1);
  });

  it("alamat ganda saat mengubah juga dijawab 400, bukan 503", async () => {
    const pertama = (await tambah()).body.id as string;
    await tambah(HCM, { alamat: "kedua@sabilulquran.or.id" });
    const bentrok = await call(HCM, "PUT", `/admin/sekretariat/mailbox/${pertama}`, {
      alamat: "kedua@sabilulquran.or.id", host: MAILBOX.host, port: 993, pengguna: MAILBOX.alamat, sandi: MAILBOX.sandi, kotak_id: await kotakYayasan(),
    });
    expect(bentrok.status).toBe(400);
    expect(bentrok.body.error).toBe("alamat_ganda");
  });

  it("kunci yang hilang memberi kalimat yang bisa ditindaklanjuti, bukan 503", async () => {
    const id = (await tambah()).body.id as string;
    await pool.query("UPDATE sekretariat_mailbox SET sandi_terenkripsi = $2 WHERE id = $1", [id, "v1.k9.AAAAAAAAAAAAAAAA.AAAA.AAAAAAAAAAAAAAAAAAAAAA"]);
    const ubah = await call(HCM, "PUT", `/admin/sekretariat/mailbox/${id}`, {
      alamat: MAILBOX.alamat, host: MAILBOX.host, port: 993, kotak_id: await kotakYayasan(),
    });
    expect(ubah.status).toBe(400);
    expect(ubah.body.error).toBe("sandi_wajib_kunci_hilang");
  });

  it("baris yang kuncinya hilang langsung diparkir, tidak dicoba berulang", async () => {
    const id = (await tambah()).body.id as string;
    await pool.query("UPDATE sekretariat_mailbox SET sandi_terenkripsi = $2 WHERE id = $1", [id, "v1.k9.AAAAAAAAAAAAAAAA.AAAA.AAAAAAAAAAAAAAAAAAAAAA"]);
    expect(await sekretariat.mailbox.aktif()).toHaveLength(0);
    expect((await pool.query<{ status: string }>("SELECT status FROM sekretariat_mailbox WHERE id = $1", [id])).rows[0]!.status).toBe("auth_gagal");
  });
});

describe("SEK-IMPL-003 kotak masuk yang mudah dibaca dan dicari", () => {
  async function suratEmail(perihal: string, isi: string, dari = "\"Dinas Pendidikan\" <disdik@example.go.id>") {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO sekretariat_surat_masuk (id, kotak_id, kanal, dari, perihal, isi_teks, diterima_pada, email_message_id, email_uidvalidity, email_uid)
       VALUES ($1, $2, 'email', $3, $4, $5, now(), $6, '1', (SELECT coalesce(max(email_uid), 0) + 1 FROM sekretariat_surat_masuk))`,
      [id, await kotakYayasanId(), dari, perihal, isi, `uji-${id}@example.go.id`],
    );
    return id;
  }

  it("setiap baris membawa cuplikan isi dengan spasi dilipat dan jumlah lampiran", async () => {
    const id = await suratEmail("Undangan sosialisasi", "Dengan hormat,\n\n   kami mengundang\tkepala sekolah.");
    const daftar = await call(HCM, "GET", `/sekretariat/kotak/${await kotakYayasanId()}/surat`);
    const baris = daftar.body.items.find((item: { id: string }) => item.id === id);
    expect(baris.cuplikan).toBe("Dengan hormat, kami mengundang kepala sekolah.");
    expect(baris.lampiran).toBe(0);
  });

  it("mencari lewat pengirim, perihal, dan isi, sebelum batas halaman", async () => {
    const lewatIsi = await suratEmail("Konfirmasi", "Perpanjangan kerja sama payroll berakhir bulan depan");
    const lewatPerihal = await suratEmail("Pendaftaran MTQ kabupaten", "Kepada pimpinan lembaga");
    await suratEmail("Hal lain", "Tidak relevan", "Bank <bank@example.co.id>");
    const yayasan = await kotakYayasanId();
    const cari = async (q: string) => (await call(HCM, "GET", `/sekretariat/kotak/${yayasan}/surat?q=${encodeURIComponent(q)}`)).body;
    expect((await cari("payroll")).items.map((item: { id: string }) => item.id)).toEqual([lewatIsi]);
    expect((await cari("mtq")).items.map((item: { id: string }) => item.id)).toEqual([lewatPerihal]);
    expect((await cari("disdik")).total).toBe(2);
  });

  it("memperlakukan % dan _ dalam pencarian sebagai huruf biasa", async () => {
    await suratEmail("Diskon 50% pendaftaran", "isi");
    await suratEmail("Diskon 50 persen", "isi");
    const yayasan = await kotakYayasanId();
    const hasil = (await call(HCM, "GET", `/sekretariat/kotak/${yayasan}/surat?q=${encodeURIComponent("50%")}`)).body;
    expect(hasil.total).toBe(1);
    expect(hasil.items[0].perihal).toBe("Diskon 50% pendaftaran");
  });

  it("pencarian tetap dibatasi hak akses kotak", async () => {
    await suratEmail("Rahasia yayasan", "isi");
    expect((await call(TU_SDIT, "GET", `/sekretariat/kotak/${await kotakYayasanId()}/surat?q=rahasia`)).status).toBe(404);
  });

  it("mencari orang hanya untuk admin, butuh dua huruf, dan mengembalikan nama, bukan hanya id", async () => {
    expect((await call(TU_SDIT, "GET", "/admin/sekretariat/orang?q=di")).status).toBe(403);
    expect((await call(HCM, "GET", "/admin/sekretariat/orang?q=d")).body.items).toEqual([]);
    const hasil = await call(HCM, "GET", "/admin/sekretariat/orang?q=direk");
    expect(hasil.status).toBe(200);
    expect(hasil.body.items).toEqual([expect.objectContaining({ id: DIREKTUR, nama: "Direktur" })]);
  });

  it("daftar petugas dan pemberi disposisi membawa nama dari direktori", async () => {
    const petugas = await call(HCM, "GET", "/admin/sekretariat/petugas");
    expect(petugas.body.items.find((item: { personId: string }) => item.personId === TU_SDIT).nama).toBe("TU SDIT");
    const pemegang = await call(HCM, "GET", "/admin/sekretariat/disposisi-pemegang");
    expect(pemegang.body.items[0].nama).toBe("Direktur");
  });
});

describe("SEK-IMPL-004 Asisten Surat", () => {
  /** A type-07 draft for KEU.YSQ, which STAF_KEU is the officer of. */
  async function drafPeringatan(who = STAF_KEU, kode = "KEU.YSQ"): Promise<string> {
    const id = await penerbitId(kode);
    const draf = await call(who, "POST", `/sekretariat/penerbit/${id}/surat`, {
      jenis_kode: "07", perihal: "Peringatan keterlambatan katering", tujuan: "PT Boga Uji", penandatangan: "Direktur",
    });
    expect(draf.status).toBe(201);
    return draf.body.id as string;
  }

  async function suratMasukFisik(who: string, kotakId: string, isi: string): Promise<string> {
    const dibuat = await call(who, "POST", `/sekretariat/kotak/${kotakId}/surat`, {
      dari: "PT Boga Uji", perihal: "Penjelasan keterlambatan", isi_teks: isi,
    });
    expect(dibuat.status).toBe(201);
    return dibuat.body.id as string;
  }

  const penjelasan = "Vendor katering terlambat tiga kali bulan ini dan belum memberi penjelasan.";

  it("menyusun isi tanpa menyentuh buku nomor sama sekali", async () => {
    const surat = await drafPeringatan();
    const sebelum = await pool.query<{ c: string }>("SELECT count(*) AS c FROM sekretariat_nomor");
    const tanya = await call(STAF_KEU, "POST", `/sekretariat/surat/${surat}/asisten/tanya`, { penjelasan });
    expect(tanya.status).toBe(200);
    expect(tanya.body.pertanyaan[0].kunci).toBe("dasar");
    const susun = await call(STAF_KEU, "POST", `/sekretariat/surat/${surat}/asisten/susun`, {
      penjelasan, jawaban: [{ kunci: "dasar", nilai: "Perjanjian kerja sama katering." }],
    });
    expect(susun.status).toBe(200);
    expect(susun.body.bagian.dasar).toBe("Perjanjian kerja sama katering.");
    const sesudah = await pool.query<{ c: string }>("SELECT count(*) AS c FROM sekretariat_nomor");
    expect(sesudah.rows[0]!.c).toBe(sebelum.rows[0]!.c);
    expect((await pool.query<{ c: string }>("SELECT count(*) AS c FROM sekretariat_penghitung")).rows[0]!.c).toBe("0");
    const isi = await call(STAF_KEU, "GET", `/sekretariat/surat/${surat}/isi`);
    expect(isi.body.ada).toBe(true);
    expect(isi.body.naskah.meta[0].nilai).toBe("[nomor diisi saat terbit]");
  });

  it("petugas penerbit lain mendapat 404 dan modelnya tidak pernah dipanggil", async () => {
    const surat = await drafPeringatan();
    const jalur = [
      ["POST", "/asisten/tanya"], ["POST", "/asisten/susun"], ["GET", "/isi"],
      ["PUT", "/isi"], ["DELETE", "/isi"], ["GET", "/docx"],
    ] as const;
    for (const [method, path] of jalur) {
      const payload = method === "GET" ? undefined : { penjelasan, bagian: {} };
      const response = await call(TU_SDIT, method, `/sekretariat/surat/${surat}${path}`, payload);
      expect(response.status).toBe(404);
    }
    expect(penyusun.panggilan).toBe(0);
  });

  it("tanpa akses aplikasi ditolak 403 sebelum model dipanggil", async () => {
    const surat = await drafPeringatan();
    sekretariat = createSekretariatModule({
      pool, config: config(), keycloakIssuer: ISSUER,
      access: { checkAccess: async () => ({ allowed: false }) as never },
      directorySource: { read: async () => projection() }, auth, mailFetcher: fetcher, now: () => now,
      freeBytes: async () => 50 * 1024 * 1024 * 1024, penyusun,
    });
    await app.close();
    app = Fastify();
    sekretariat.register(app);
    await app.ready();
    expect((await call(STAF_KEU, "POST", `/sekretariat/surat/${surat}/asisten/tanya`, { penjelasan })).status).toBe(403);
    expect(penyusun.panggilan).toBe(0);
  });

  it("mutasi asisten dari origin lain ditolak", async () => {
    const surat = await drafPeringatan();
    const response = await call(STAF_KEU, "POST", `/sekretariat/surat/${surat}/asisten/tanya`, { penjelasan }, { origin: "https://lain.example" });
    expect(response.status).toBe(403);
    expect(penyusun.panggilan).toBe(0);
  });

  it("surat yang sudah terbit terkunci untuk asisten, tetapi isinya tetap terbaca", async () => {
    const surat = await drafPeringatan();
    await call(STAF_KEU, "POST", `/sekretariat/surat/${surat}/asisten/susun`, { penjelasan, jawaban: [] });
    expect((await upload(STAF_KEU, `/surat/${surat}/berkas`, "surat.pdf", PDF)).status).toBe(201);
    expect((await call(STAF_KEU, "POST", `/sekretariat/surat/${surat}/terbit`, {})).status).toBe(200);
    expect((await call(STAF_KEU, "POST", `/sekretariat/surat/${surat}/asisten/susun`, { penjelasan, jawaban: [] })).status).toBe(409);
    expect((await call(STAF_KEU, "PUT", `/sekretariat/surat/${surat}/isi`, { bagian: { fakta: "x" } })).status).toBe(409);
    expect((await call(STAF_KEU, "GET", `/sekretariat/surat/${surat}/isi`)).status).toBe(200);
    expect((await call(STAF_KEU, "GET", `/sekretariat/surat/${surat}/docx`)).status).toBe(200);
  });

  it("kutipan hanya dari surat yang boleh dibaca, dipotong server, dan offset nakal ditolak", async () => {
    const surat = await drafPeringatan();
    const isiSurat = "Baris pertama penjelasan vendor. Baris kedua yang akan dikutip staf.";
    const milikKeu = await suratMasukFisik(STAF_KEU, await kotakPenerbit("KEU.YSQ"), isiSurat);
    const milikYayasan = await suratMasukFisik(HCM, await kotakYayasanId(), isiSurat);

    const terlarang = await call(STAF_KEU, "POST", `/sekretariat/surat/${surat}/asisten/tanya`, {
      penjelasan, kutipan: [{ surat_masuk_id: milikYayasan, awal: 0, panjang: 10 }],
    });
    expect(terlarang.status).toBe(404);
    expect(penyusun.panggilan).toBe(0);

    const lewatBatas = await call(STAF_KEU, "POST", `/sekretariat/surat/${surat}/asisten/tanya`, {
      penjelasan, kutipan: [{ surat_masuk_id: milikKeu, awal: isiSurat.length - 2, panjang: 50 }],
    });
    expect(lewatBatas.status).toBe(400);
    expect(lewatBatas.body.error).toBe("kutipan_tidak_sah");
    expect(penyusun.panggilan).toBe(0);

    const sah = await call(STAF_KEU, "POST", `/sekretariat/surat/${surat}/asisten/tanya`, {
      penjelasan, kutipan: [{ surat_masuk_id: milikKeu, awal: 33, panjang: 11 }],
    });
    expect(sah.status).toBe(200);
    // The server cut the text itself; the browser only sent offsets.
    expect(penyusun.terakhir?.kutipan).toEqual([isiSurat.slice(33, 44)]);
  });

  it("nomor surat dari keluaran model ditolak, bukan ikut tersimpan", async () => {
    const surat = await drafPeringatan();
    penyusun.bagian = { dasar: "Menunjuk 07.003/KEU.YSQ/XI/2026.", fakta: "Terlambat tiga kali." };
    const susun = await call(STAF_KEU, "POST", `/sekretariat/surat/${surat}/asisten/susun`, { penjelasan, jawaban: [] });
    expect(susun.status).toBe(200);
    expect(susun.body.ditolak).toEqual(["dasar"]);
    expect(susun.body.bagian.dasar).toBeUndefined();
    expect(susun.body.bagian.fakta).toBe("Terlambat tiga kali.");
  });

  it("dua kali menyusun tetap satu baris isi", async () => {
    const surat = await drafPeringatan();
    await call(STAF_KEU, "POST", `/sekretariat/surat/${surat}/asisten/susun`, { penjelasan, jawaban: [] });
    await call(STAF_KEU, "POST", `/sekretariat/surat/${surat}/asisten/susun`, { penjelasan, jawaban: [] });
    expect((await pool.query<{ c: string }>("SELECT count(*) AS c FROM sekretariat_surat_isi")).rows[0]!.c).toBe("1");
    expect((await pool.query<{ putaran: number }>("SELECT putaran FROM sekretariat_surat_isi")).rows[0]!.putaran).toBe(2);
  });

  it("menghapus draf yang punya isi tetap berhasil (FK cascade)", async () => {
    const surat = await drafPeringatan();
    await call(STAF_KEU, "POST", `/sekretariat/surat/${surat}/asisten/susun`, { penjelasan, jawaban: [] });
    const hapus = await call(STAF_KEU, "POST", `/sekretariat/surat/${surat}/batal`, { alasan: "Draf dihapus oleh pembuatnya." });
    expect(hapus.status).toBe(200);
    expect(hapus.body.dihapus).toBe(true);
    expect((await pool.query<{ c: string }>("SELECT count(*) AS c FROM sekretariat_surat_isi")).rows[0]!.c).toBe("0");
  });

  it("penolakan dan kegagalan model tidak merusak isi yang sudah tersimpan", async () => {
    const surat = await drafPeringatan();
    await call(STAF_KEU, "POST", `/sekretariat/surat/${surat}/asisten/susun`, { penjelasan, jawaban: [] });
    penyusun.gagal = "tolak";
    expect((await call(STAF_KEU, "POST", `/sekretariat/surat/${surat}/asisten/susun`, { penjelasan, jawaban: [] })).status).toBe(422);
    penyusun.gagal = "galat";
    expect((await call(STAF_KEU, "POST", `/sekretariat/surat/${surat}/asisten/susun`, { penjelasan, jawaban: [] })).status).toBe(503);
    const isi = await call(STAF_KEU, "GET", `/sekretariat/surat/${surat}/isi`);
    expect(isi.body.bagian.fakta).toBe("Terlambat tiga kali.");
  });

  it("batas putaran per draf dan pagar pemakaian bulanan sama-sama menutup", async () => {
    const surat = await drafPeringatan();
    for (let putaran = 0; putaran < 4; putaran += 1) {
      expect((await call(STAF_KEU, "POST", `/sekretariat/surat/${surat}/asisten/susun`, { penjelasan, jawaban: [] })).status).toBe(200);
    }
    const kelima = await call(STAF_KEU, "POST", `/sekretariat/surat/${surat}/asisten/susun`, { penjelasan, jawaban: [] });
    expect(kelima.status).toBe(429);
    expect(kelima.body.error).toBe("putaran_habis");

    await pool.query("UPDATE sekretariat_ai_pemakaian SET panggilan = 1000");
    const lain = await drafPeringatan();
    const anggaran = await call(STAF_KEU, "POST", `/sekretariat/surat/${lain}/asisten/tanya`, { penjelasan });
    expect(anggaran.status).toBe(429);
    expect(anggaran.body.error).toBe("anggaran_habis");
  });

  it("mengunduh .docx yang memuat perihal dan tanpa nomor surat", async () => {
    const surat = await drafPeringatan();
    await call(STAF_KEU, "POST", `/sekretariat/surat/${surat}/asisten/susun`, { penjelasan, jawaban: [] });
    const response = await call(STAF_KEU, "GET", `/sekretariat/surat/${surat}/docx`);
    expect(response.status).toBe(200);
    expect(response.raw.headers["content-disposition"]).toContain("draf-07-KEU.YSQ-");
    const berkas = response.raw.rawPayload.toString("latin1");
    expect(berkas.slice(0, 2)).toBe("PK");
    expect(berkas).toContain("[nomor diisi saat terbit]");
    expect(/\d{2}\.\d{3,}\//.test(berkas)).toBe(false);
  });

  it("tiap panggilan menulis satu audit tanpa teks apa pun", async () => {
    const surat = await drafPeringatan();
    await call(STAF_KEU, "POST", `/sekretariat/surat/${surat}/asisten/tanya`, { penjelasan });
    await call(STAF_KEU, "POST", `/sekretariat/surat/${surat}/asisten/susun`, { penjelasan, jawaban: [] });
    const audit = await pool.query<{ aksi: string; metadata: Record<string, unknown> }>(
      "SELECT aksi, metadata FROM sekretariat_audit WHERE aksi LIKE 'surat.asisten%' ORDER BY aksi",
    );
    expect(audit.rows.map((row) => row.aksi)).toEqual(["surat.asisten.susun", "surat.asisten.tanya"]);
    const teks = JSON.stringify(audit.rows);
    expect(teks).not.toContain("Vendor katering");
    expect(teks).not.toContain("Terlambat tiga kali");
    expect(audit.rows[0]!.metadata.tokenMasuk).toBe(33);
    const pemakaian = await pool.query<{ panggilan: number }>("SELECT panggilan FROM sekretariat_ai_pemakaian WHERE bulan = '2026-11'");
    expect(pemakaian.rows[0]!.panggilan).toBe(2);
  });

  it("suntingan staf menulis nama bagian yang berubah, bukan isinya", async () => {
    const surat = await drafPeringatan();
    const simpan = await call(STAF_KEU, "PUT", `/sekretariat/surat/${surat}/isi`, {
      bagian: { fakta: "Rahasia yang tidak boleh masuk audit.", tenggat: "7 hari" },
    });
    expect(simpan.status).toBe(200);
    expect(simpan.body.kosong).toContain("dasar");
    const audit = await pool.query<{ metadata: { bagianBerubah: string[] } }>(
      "SELECT metadata FROM sekretariat_audit WHERE aksi = 'surat.isi.sunting'",
    );
    expect(audit.rows[0]!.metadata.bagianBerubah).toEqual(["fakta", "tenggat"]);
    expect(JSON.stringify(audit.rows)).not.toContain("Rahasia");
  });

  it("jenis di luar daftar dukungan ditolak sebelum model dipanggil", async () => {
    const id = await penerbitId("KEU.YSQ");
    const draf = await call(STAF_KEU, "POST", `/sekretariat/penerbit/${id}/surat`, {
      jenis_kode: "12", perihal: "Undangan rapat", tujuan: "Seluruh unit", penandatangan: "Kepala Divisi",
    });
    const response = await call(STAF_KEU, "POST", `/sekretariat/surat/${draf.body.id}/asisten/tanya`, { penjelasan });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("jenis_tidak_didukung");
    expect(penyusun.panggilan).toBe(0);
  });

  it("flag mati menyembunyikan asisten sepenuhnya", async () => {
    const surat = await drafPeringatan();
    asistenAktif = false;
    sekretariat = createSekretariatModule({
      pool, config: config(), keycloakIssuer: ISSUER,
      access: { checkAccess: async (_identity, key) => ({ allowed: key === "sekretariat-sq" }) as never },
      directorySource: { read: async () => projection() }, auth, mailFetcher: fetcher, now: () => now,
      freeBytes: async () => 50 * 1024 * 1024 * 1024, penyusun,
    });
    await app.close();
    app = Fastify();
    sekretariat.register(app);
    await app.ready();
    expect((await call(STAF_KEU, "POST", `/sekretariat/surat/${surat}/asisten/tanya`, { penjelasan })).status).toBe(404);
    const context = await call(STAF_KEU, "GET", "/sekretariat/context");
    expect(context.body.asisten.tersedia).toBe(false);
    expect(penyusun.panggilan).toBe(0);
  });

  it("satu putaran tanya saja belum membuat isi yang bisa diunduh", async () => {
    const surat = await drafPeringatan();
    expect((await call(STAF_KEU, "POST", `/sekretariat/surat/${surat}/asisten/tanya`, { penjelasan })).status).toBe(200);
    const isi = await call(STAF_KEU, "GET", `/sekretariat/surat/${surat}/isi`);
    expect(isi.body.ada).toBe(false);
    // The context is remembered, so coming back to the flow keeps what was typed.
    expect(isi.body.konteks.penjelasan).toBe(penjelasan);
    const unduh = await call(STAF_KEU, "GET", `/sekretariat/surat/${surat}/docx`);
    expect(unduh.status).toBe(409);
    expect(unduh.body.error).toBe("isi_belum_ada");
  });

  it("arsip surat tetap hanya menerima PDF", async () => {
    const surat = await drafPeringatan();
    const docx = await upload(STAF_KEU, `/surat/${surat}/berkas`, "draf.docx", Buffer.from("PK bukan pdf"));
    expect(docx.status).toBe(415);
  });
});
