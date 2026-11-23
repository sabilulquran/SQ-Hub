import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { PgApplicationAccessRepository } from "../src/modules/application-access/repository.js";
import { ApplicationAccessService } from "../src/modules/application-access/service.js";
import { HubAuthError, type HubAuthRuntime } from "../src/modules/hub-auth/service.js";
import type { KirimConfig } from "../src/modules/kirim/config.js";
import { createKirimModule, type KirimModule } from "../src/modules/kirim/module.js";
import { LogProvider } from "../src/modules/kirim/providers/log.js";
import { verifyKeyCanaries } from "../src/modules/kirim/service.js";
import { KirimSendWorker } from "../src/modules/kirim/worker.js";

/**
 * ADR-0011 amendment 2026-11-17: the "Aplikasi luar" gateway card. Each of its numbers has its
 * own API key (made with the number, readable from the card, rotated or revoked without touching
 * the WhatsApp session). An outside application authenticates with `Bearer krm_…`, sends through
 * the key's number only, and receives events on the number's own webhook. Kirim never learns the
 * application's name.
 */

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for integration tests");

const pool = new Pool({ connectionString: databaseUrl });
const ORIGIN = "https://kirim.sabilulquran.or.id";
const PHONE = "+6281234567890";
const accessService = new ApplicationAccessService(new PgApplicationAccessRepository(pool));
const sessions = new Map<string, { issuer: string; subject: string; displayName: string }>();
const webhookCalls: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
const kirimLogs: Array<Record<string, unknown>> = [];

let mediaRoot: string;
let kirim: KirimModule;
let app: ReturnType<typeof buildApp>;

const adminAuth: HubAuthRuntime = {
  async getSession(token) {
    const session = token ? sessions.get(token) : undefined;
    if (!session) throw new HubAuthError(401, "UNAUTHENTICATED", "no session");
    return { ...session, sessionId: randomUUID(), username: null, email: null, emailVerified: null, accountRefreshTokenCiphertext: null, createdAt: new Date(), expiresAt: new Date(Date.now() + 3600_000) };
  },
  beginLogin: () => Promise.reject(new Error("not used")),
  completeLogin: () => Promise.reject(new Error("not used")),
  getWorkspace: () => Promise.reject(new Error("not used")),
  getAccountAccess: () => Promise.reject(new Error("not used")),
  logout: () => Promise.reject(new Error("not used")),
  clearTransactionCookie: () => "",
};

type NumberDetail = { kode: string; status: string; kunci: { awalan: string; kunci: string | null; terakhir_dipakai_at: string | null } | null };

function admin(method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) {
  return app.inject({ method, url: `/admin/kirim${url}`, headers: { cookie: "sq_kirim_session=admin-session", origin: ORIGIN }, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });
}

function withKey(key: string, method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown, idempotencyKey?: string) {
  return app.inject({
    method,
    url: `/internal/kirim${url}`,
    headers: { authorization: `Bearer ${key}`, ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) },
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });
}

async function grantAdmin() {
  const identity = { issuer: "https://login.example.test/realms/sq-staff", subject: "kepala-hcm" };
  sessions.set("admin-session", { ...identity, displayName: "Kepala HCM" });
  await accessService.upsertApplication({ applicationKey: "kirim-sq", name: "Kirim SQ", canonicalUrl: ORIGIN, status: "active", actor: { kind: "system", ref: "test" } });
  await accessService.grant({ identity, applicationKey: "kirim-sq", actor: { kind: "system", ref: "test" } });
  await pool.query(
    "INSERT INTO kirim_admins (id, identity_issuer, identity_subject, granted_by, alasan) VALUES ($1, $2, $3, 'test', 'test') ON CONFLICT DO NOTHING",
    [randomUUID(), identity.issuer, identity.subject],
  );
}

/** A new number on the card; its key comes with it. */
async function newNumber() {
  const number = await admin("POST", "/gerbang/nomor-baru", {});
  expect(number.statusCode).toBe(201);
  const kode = number.json().kode as string;
  const detail = (await admin("GET", "/gerbang")).json() as { nomor: NumberDetail[] };
  const row = detail.nomor.find((nomor) => nomor.kode === kode)!;
  return { kode, kunci: row.kunci!.kunci!, awalan: row.kunci!.awalan };
}

beforeAll(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), "kirim-gerbang-"));
});

afterAll(async () => {
  await app?.close();
  await rm(mediaRoot, { recursive: true, force: true });
  await pool.end();
});

beforeEach(async () => {
  await pool.query(`TRUNCATE kirim_audit, kirim_admins, kirim_webhook_deliveries, kirim_events, kirim_optouts, kirim_media_engine_refs,
    kirim_api_keys, kirim_outbox, kirim_messages, kirim_media, kirim_conversations, kirim_routes, kirim_devices, kirim_consumers, kirim_key_canaries CASCADE`);
  await pool.query("TRUNCATE platform_audit_events, application_access, applications CASCADE");
  // The gateway consumer that migration 0023 creates.
  await pool.query("INSERT INTO kirim_consumers (id, client_id, nama, gerbang) VALUES ('00000000-0000-4000-8000-00000000a1a1', 'gerbang:aplikasi-luar', 'aplikasi-luar', true)");
  sessions.clear();
  webhookCalls.length = 0;
  kirimLogs.length = 0;
  const config: KirimConfig = {
    tokenAudience: ["sq-hub-kirim"],
    dataKeys: [{ kid: "k1", key: randomBytes(32) }],
    lookupKey: randomBytes(32),
    mediaRoot,
    inboundMediaMaxBytes: 64 * 1024,
    workerIntervalMs: 2000,
    eventPullIntervalMs: 60000,
    admin: { clientId: "kirim-sq", clientSecret: "unused", publicOrigin: ORIGIN },
  };
  kirim = createKirimModule({
    pool,
    config,
    keycloakIssuer: "https://login.example.test/realms/sq-staff",
    access: accessService,
    adminAuth,
    providers: { log: new LogProvider((entry) => kirimLogs.push(entry)) },
    // A Keycloak token path that names the gateway's own client id: must still be refused.
    verifyMachineToken: async () => ({ clientId: "gerbang:aplikasi-luar" }),
    webhookTransport: async (request) => {
      webhookCalls.push({ url: request.url, body: request.body, headers: request.headers });
      return { status: 200 };
    },
    log: (entry) => kirimLogs.push(entry),
  });
  await app?.close();
  app = buildApp({ accessService, verifyMachineToken: async () => ({ clientId: "unused" }), kirim });
  await verifyKeyCanaries(pool, kirim.crypto);
  await grantAdmin();
});

describe("Kartu Aplikasi luar (admin)", () => {
  it("lists one generic card and makes each new number with a readable key, never naming an application", async () => {
    const before = await admin("GET", "/modules");
    expect(before.statusCode).toBe(200);
    expect(before.json().gerbang).toEqual({ nama: "Aplikasi luar", keterangan: expect.stringContaining("Sabilul Qur'an Suite"), nomor: [] });

    const first = await admin("POST", "/gerbang/nomor-baru", {});
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ kode: "luar", label: "Aplikasi luar", pemilik: "aplikasi-luar", provider: "log", status: "tersambung" });
    expect(JSON.stringify(first.json())).not.toContain("krm_");
    const second = await admin("POST", "/gerbang/nomor-baru", {});
    expect(second.json()).toMatchObject({ kode: "luar-2", label: "Aplikasi luar 2" });

    const card = (await admin("GET", "/modules")).json();
    // Owner 2026-11-17: each number is its own card, so the list carries that number's own key
    // summary -- its prefix and how it is doing, never the key itself.
    expect(card.gerbang.nomor.map((nomor: { kode: string; kunci: { awalan: string } | null }) => [nomor.kode, nomor.kunci?.awalan?.slice(0, 4)])).toEqual([
      ["luar", "krm_"],
      ["luar-2", "krm_"],
    ]);
    for (const nomor of card.gerbang.nomor as Array<{ kunci: Record<string, unknown> | null }>) {
      expect(Object.keys(nomor.kunci ?? {}).sort()).toEqual(["awalan", "dibuat_at", "terakhir_dipakai_at"]);
    }
    expect(card.modules).toEqual([]);
    // The card face carries the key's prefix but never the key itself; the pop-up carries that,
    // so the owner can copy it once. The home screen loads on every visit.
    expect(JSON.stringify(card.gerbang)).not.toMatch(/krm_[A-Za-z0-9_-]{32}/);
    const detail = (await admin("GET", "/gerbang")).json() as { nomor: NumberDetail[] };
    for (const nomor of detail.nomor) {
      expect(nomor.kunci?.kunci).toMatch(/^krm_[A-Za-z0-9_-]{32}$/);
      expect(nomor.kunci?.awalan).toBe(nomor.kunci?.kunci?.slice(0, 12));
      expect(nomor.kunci?.terakhir_dipakai_at).toBeNull();
    }
    expect(JSON.stringify(detail)).not.toContain("nama_aplikasi");
    // Stored: the lookup hash and the sealed value, never the plain key.
    const stored = await pool.query<{ hash: string; enc: string }>("SELECT kunci_hash AS hash, kunci_enc AS enc FROM kirim_api_keys");
    for (const row of stored.rows) {
      expect(row.hash).toHaveLength(64);
      expect(row.enc).not.toContain("krm_");
    }
    // The verification-code route exists for every gateway number.
    const routes = await pool.query("SELECT count(*) AS count FROM kirim_routes r JOIN kirim_devices d ON d.id = r.device_id WHERE d.kode IN ('luar', 'luar-2') AND r.jenis = 'kode'");
    expect(Number(routes.rows[0].count)).toBe(2);
  });

  it("rotates a key (old one stops, number untouched) and revokes it, with audit", async () => {
    const { kode, kunci: old, awalan } = await newNumber();
    expect((await withKey(old, "GET", "/sambungan")).statusCode).toBe(200);
    const rotated = await admin("POST", `/gerbang/nomor/${kode}/kunci`, {});
    expect(rotated.statusCode).toBe(200);
    const fresh = rotated.json().kunci as string;
    expect(fresh).toMatch(/^krm_/);
    expect(fresh).not.toBe(old);
    expect((await withKey(old, "GET", "/sambungan")).statusCode).toBe(401);
    expect((await withKey(fresh, "GET", "/sambungan")).json().nomor).toMatchObject({ kode, status: "tersambung" });
    const detail = (await admin("GET", "/gerbang")).json() as { nomor: NumberDetail[] };
    expect(detail.nomor.find((nomor) => nomor.kode === kode)?.kunci?.kunci).toBe(fresh);

    const revoked = await admin("POST", `/gerbang/nomor/${kode}/kunci/cabut`, { alasan: "aplikasi berhenti" });
    expect(revoked.statusCode).toBe(200);
    expect((await withKey(fresh, "GET", "/sambungan")).statusCode).toBe(401);
    const after = (await admin("GET", "/gerbang")).json() as { nomor: NumberDetail[] };
    expect(after.nomor.find((nomor) => nomor.kode === kode)).toMatchObject({ status: "tersambung", kunci: null });
    expect((await admin("POST", `/gerbang/nomor/${kode}/kunci/cabut`, { alasan: "lagi" })).statusCode).toBe(404);
    expect((await admin("GET", "/modules")).json().gerbang.nomor.find((nomor: { kode: string }) => nomor.kode === kode).kunci).toBeNull();

    const audit = await pool.query<{ aksi: string; metadata: Record<string, unknown> }>("SELECT aksi, metadata FROM kirim_audit WHERE aksi LIKE 'gerbang.%' ORDER BY occurred_at, aksi");
    expect(audit.rows.map((row) => row.aksi)).toEqual(["gerbang.kunci_buat", "gerbang.nomor_baru", "gerbang.kunci_putar", "gerbang.kunci_cabut"]);
    expect(audit.rows[2]?.metadata.menggantikan).toBe(awalan);
    expect(JSON.stringify(audit.rows)).not.toContain(fresh);
  });

  it("refuses key actions on a number that is not on the card", async () => {
    const other = randomUUID();
    await pool.query("INSERT INTO kirim_consumers (id, client_id, nama) VALUES ($1, 'spmb-api', 'spmb')", [other]);
    await pool.query("INSERT INTO kirim_devices (id, kode, label, pemilik_consumer_id, provider, status) VALUES ($1, 'spmb', 'SPMB', $2, 'log', 'tersambung')", [randomUUID(), other]);
    expect((await admin("POST", "/gerbang/nomor/spmb/kunci", {})).statusCode).toBe(404);
    expect((await admin("POST", "/gerbang/nomor/spmb/kunci/cabut", { alasan: "x" })).statusCode).toBe(404);
  });

  // Owner 2026-11-23: a number created by mistake, or never connected, can be removed from its card.
  it("deletes an outside number that has no data, with its key and routes, and audits it", async () => {
    const { kode, kunci } = await newNumber();
    expect((await withKey(kunci, "GET", "/sambungan")).statusCode).toBe(200);

    const removed = await admin("POST", `/gerbang/nomor/${kode}/hapus`, {});
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toMatchObject({ kode, dihapus: true });

    // Gone from the card, the key no longer authenticates, and no orphan rows are left behind.
    expect((await admin("GET", "/modules")).json().gerbang.nomor.find((nomor: { kode: string }) => nomor.kode === kode)).toBeUndefined();
    expect((await withKey(kunci, "GET", "/sambungan")).statusCode).toBe(401);
    expect(Number((await pool.query("SELECT count(*) AS c FROM kirim_devices WHERE kode = $1", [kode])).rows[0].c)).toBe(0);
    expect(Number((await pool.query("SELECT count(*) AS c FROM kirim_api_keys")).rows[0].c)).toBe(0);
    expect(Number((await pool.query("SELECT count(*) AS c FROM kirim_routes")).rows[0].c)).toBe(0);
    // Deleting again is a 404.
    expect((await admin("POST", `/gerbang/nomor/${kode}/hapus`, {})).statusCode).toBe(404);
    const audit = await pool.query("SELECT 1 FROM kirim_audit WHERE aksi = 'gerbang.nomor_hapus' AND objek_ref = $1", [kode]);
    expect(audit.rowCount).toBe(1);
  });

  it("refuses to delete a number that is not on the card, or one another application still uses", async () => {
    const other = randomUUID();
    await pool.query("INSERT INTO kirim_consumers (id, client_id, nama) VALUES ($1, 'spmb-api', 'spmb')", [other]);
    await pool.query("INSERT INTO kirim_devices (id, kode, label, pemilik_consumer_id, provider, status) VALUES ($1, 'spmb', 'SPMB', $2, 'log', 'tersambung')", [randomUUID(), other]);
    expect((await admin("POST", "/gerbang/nomor/spmb/hapus", {})).statusCode).toBe(404);

    const { kode } = await newNumber();
    const device = await pool.query<{ id: string }>("SELECT id FROM kirim_devices WHERE kode = $1", [kode]);
    await pool.query("INSERT INTO kirim_routes (consumer_id, device_id, jenis) VALUES ($1, $2, 'notifikasi')", [other, device.rows[0]!.id]);
    const refused = await admin("POST", `/gerbang/nomor/${kode}/hapus`, {});
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe("nomor_dipakai_modul_lain");
    // The number is still there.
    expect((await admin("GET", "/modules")).json().gerbang.nomor.find((nomor: { kode: string }) => nomor.kode === kode)).toBeTruthy();
  });

  // The number's key is bound to the number but authenticated against the gateway consumer, so a
  // number that leaves the card would keep sending while no screen could rotate or revoke its key.
  it("keeps an outside number with its own consumer, in both directions", async () => {
    const { kode, kunci } = await newNumber();
    const other = randomUUID();
    await pool.query("INSERT INTO kirim_consumers (id, client_id, nama) VALUES ($1, 'spmb-api', 'spmb')", [other]);
    await pool.query("INSERT INTO kirim_devices (id, kode, label, pemilik_consumer_id, provider, status) VALUES ($1, 'spmb', 'SPMB', $2, 'log', 'tersambung')", [randomUUID(), other]);

    const moveOut = await admin("PATCH", `/devices/${kode}`, { pemilik: "spmb" });
    expect(moveOut.statusCode).toBe(409);
    expect(moveOut.json().error.code).toBe("pemilik_terkunci");
    const moveIn = await admin("PATCH", "/devices/spmb", { pemilik: "aplikasi-luar" });
    expect(moveIn.statusCode).toBe(409);

    // Nothing moved, so the number is still on the card and its key is still revocable there.
    const card = (await admin("GET", "/modules")).json();
    expect(card.gerbang.nomor.map((nomor: { kode: string }) => nomor.kode)).toContain(kode);
    expect((await withKey(kunci, "GET", "/sambungan")).statusCode).toBe(200);
    expect((await admin("POST", `/gerbang/nomor/${kode}/kunci/cabut`, { alasan: "uji" })).statusCode).toBe(200);
    expect((await withKey(kunci, "GET", "/sambungan")).statusCode).toBe(401);

    // An ordinary edit of the same number still works; only the owner is locked.
    expect((await admin("PATCH", `/devices/${kode}`, { rate_per_menit: 7 })).statusCode).toBe(200);
  });
});

describe("Kunci API (konsumen)", () => {
  it("reads its connection and sends a code through the key's number without naming a device", async () => {
    const { kunci, kode } = await newNumber();
    const connection = await withKey(kunci, "GET", "/sambungan");
    expect(connection.statusCode).toBe(200);
    expect(connection.json()).toEqual({ nomor: { kode, status: "tersambung", nomor_tersamar: null }, jenis: ["notifikasi", "kode"], webhook: null });

    const sent = await withKey(kunci, "POST", "/messages", { jenis: "kode", to: PHONE, text: "Kode: 123456", ref: "otp:1" }, "otp:1");
    expect(sent.statusCode).toBe(202);
    const status = await withKey(kunci, "GET", `/messages/${sent.json().id}`);
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ ref: "otp:1", status: "antre" });
    const outbox = await pool.query<{ kode: string }>("SELECT d.kode FROM kirim_outbox o JOIN kirim_devices d ON d.id = o.device_id");
    expect(outbox.rows[0]?.kode).toBe(kode);
    expect((await withKey(kunci, "POST", "/messages", { jenis: "notifikasi", to: PHONE, text: "Pesanan diproses" }, "n:1")).statusCode).toBe(202);
    // A 200-character client key still fits the stored (scoped, hashed) key, and replays the same message.
    const long = "k".repeat(200);
    const once = await withKey(kunci, "POST", "/messages", { jenis: "kode", to: PHONE, text: "Kode: 7" }, long);
    const again = await withKey(kunci, "POST", "/messages", { jenis: "kode", to: PHONE, text: "Kode: 7" }, long);
    expect(once.statusCode).toBe(202);
    expect(again.json().id).toBe(once.json().id);
    // The pop-up now says when the key was last used.
    const detail = (await admin("GET", "/gerbang")).json() as { nomor: NumberDetail[] };
    expect(detail.nomor[0]?.kunci?.terakhir_dipakai_at).not.toBeNull();
  });

  it("refuses an unknown key, a device field, and the conversation API", async () => {
    const { kunci } = await newNumber();
    const unknown = await withKey("krm_bukanKunciYangTerdaftar000000000", "GET", "/sambungan");
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json().error.code).toBe("unauthenticated");

    const withDevice = await withKey(kunci, "POST", "/messages", { device: "luar", jenis: "kode", to: PHONE, text: "x" }, "d:1");
    expect(withDevice.statusCode).toBe(400);
    expect(withDevice.json().error.fields).toEqual(["device"]);

    const conversations = await withKey(kunci, "GET", "/devices/luar/conversations");
    expect(conversations.statusCode).toBe(403);
    expect(conversations.json().error.code).toBe("api_key_not_allowed");
  });

  it("keeps idempotency per number: two numbers may reuse the same key value, and a rotated key keeps the replay", async () => {
    const a = await newNumber();
    const b = await newNumber();
    const fromA = await withKey(a.kunci, "POST", "/messages", { jenis: "kode", to: PHONE, text: "A" }, "same");
    const fromB = await withKey(b.kunci, "POST", "/messages", { jenis: "kode", to: PHONE, text: "B" }, "same");
    expect(fromA.statusCode).toBe(202);
    expect(fromB.statusCode).toBe(202);
    expect(fromA.json().id).not.toBe(fromB.json().id);
    const rotated = (await admin("POST", `/gerbang/nomor/${a.kode}/kunci`, {})).json().kunci as string;
    const replay = await withKey(rotated, "POST", "/messages", { jenis: "kode", to: PHONE, text: "A" }, "same");
    expect(replay.statusCode).toBe(202);
    expect(replay.json().id).toBe(fromA.json().id);
  });

  it("never lets a Keycloak token act as the gateway consumer", async () => {
    await newNumber();
    const viaToken = await app.inject({ method: "GET", url: "/internal/kirim/sambungan", headers: { authorization: "Bearer not-an-api-key" } });
    expect(viaToken.statusCode).toBe(403);
    expect(viaToken.json().error.code).toBe("consumer_unknown");
  });

  it("delivers message.status to the number's own webhook, signed with the secret from the registration", async () => {
    const { kunci } = await newNumber();
    const registered = await withKey(kunci, "PUT", "/sambungan/webhook", { url: "https://toko.example/api/kirim/webhook" });
    expect(registered.statusCode).toBe(200);
    const secret = registered.json().webhook.secret as string;
    expect(secret.length).toBeGreaterThan(30);
    expect((await withKey(kunci, "GET", "/sambungan")).json().webhook).toEqual({ url: "https://toko.example/api/kirim/webhook", secret });
    expect((await withKey(kunci, "PUT", "/sambungan/webhook", { url: "https://user:pw@toko.example/hook" })).statusCode).toBe(422);
    expect(((await admin("GET", "/gerbang")).json() as { nomor: Array<{ webhook_terdaftar: boolean }> }).nomor[0]?.webhook_terdaftar).toBe(true);

    const sent = await withKey(kunci, "POST", "/messages", { jenis: "kode", to: PHONE, text: "Kode: 1", ref: "otp:9" }, "w:1");
    expect(sent.statusCode).toBe(202);
    await pool.query("UPDATE kirim_outbox SET next_attempt_at = now() - interval '1 second'");
    await new KirimSendWorker(pool, kirim.crypto, kirim.service, { log: new LogProvider(() => undefined), jalurpesan: undefined }, { random: () => 0, log: () => undefined }).runOnce();
    await kirim.webhooks.runOnce();
    expect(webhookCalls).toHaveLength(1);
    const call = webhookCalls[0]!;
    expect(call.url).toBe("https://toko.example/api/kirim/webhook");
    const payload = JSON.parse(call.body) as { type: string; data: { ref: string; status: string; dry_run: boolean } };
    expect(payload.type).toBe("message.status");
    expect(payload.data).toMatchObject({ ref: "otp:9", status: "diserahkan", dry_run: true });
    const expected = createHmac("sha256", secret).update(`${call.headers["x-kirim-timestamp"]}.${call.body}`, "utf8").digest("hex");
    expect(call.headers["x-kirim-signature"]).toBe(expected);
  });
});
