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
 * ADR-0011 amendment 2026-11-17: the "Aplikasi luar" gateway card, its numbers and API keys. An
 * outside application authenticates with `Bearer krm_…`, sends through the key's number only,
 * and receives events on the number's own webhook.
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

function admin(method: "GET" | "POST", url: string, payload?: unknown) {
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

/** A number on the card plus a key for one application; returns the plain key and the number's code. */
async function keyForNewNumber(namaAplikasi = "Toko online") {
  const number = await admin("POST", "/gerbang/nomor-baru", {});
  expect(number.statusCode).toBe(201);
  const kode = number.json().kode as string;
  const issued = await admin("POST", "/gerbang/kunci", { nama_aplikasi: namaAplikasi, device: kode });
  expect(issued.statusCode).toBe(201);
  return { kode, kunci: issued.json().kunci as string, id: issued.json().id as string, awalan: issued.json().awalan as string };
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
  it("lists one generic card with no application name, and adds numbers to it", async () => {
    const before = await admin("GET", "/modules");
    expect(before.statusCode).toBe(200);
    expect(before.json().gerbang).toEqual({ nama: "Aplikasi luar", keterangan: expect.stringContaining("Sabilul Qur'an Suite"), nomor: [], kunci_aktif: 0 });

    const first = await admin("POST", "/gerbang/nomor-baru", {});
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ kode: "luar", label: "Aplikasi luar", pemilik: "aplikasi-luar", provider: "log", status: "tersambung" });
    const second = await admin("POST", "/gerbang/nomor-baru", {});
    expect(second.json()).toMatchObject({ kode: "luar-2", label: "Aplikasi luar 2" });

    const after = await admin("GET", "/modules");
    expect(after.json().gerbang.nomor.map((nomor: { kode: string }) => nomor.kode)).toEqual(["luar", "luar-2"]);
    expect(after.json().modules).toEqual([]);
    // The verification-code route exists for every gateway number.
    const routes = await pool.query("SELECT count(*) AS count FROM kirim_routes r JOIN kirim_devices d ON d.id = r.device_id WHERE d.kode IN ('luar', 'luar-2') AND r.jenis = 'kode'");
    expect(Number(routes.rows[0].count)).toBe(2);
  });

  it("issues a key once in plain form, stores only its hash, and lists it with its application name", async () => {
    const { kunci, awalan, id } = await keyForNewNumber("Toko online");
    expect(kunci).toMatch(/^krm_[A-Za-z0-9_-]{32}$/);
    expect(awalan).toBe(kunci.slice(0, 12));
    const stored = await pool.query<{ hash: string; awalan: string }>("SELECT kunci_hash AS hash, awalan FROM kirim_api_keys WHERE id = $1", [id]);
    expect(stored.rows[0]?.hash).not.toContain(kunci);
    expect(stored.rows[0]?.hash).toHaveLength(64);

    const detail = await admin("GET", "/gerbang");
    expect(detail.statusCode).toBe(200);
    expect(detail.json().kunci).toEqual([expect.objectContaining({ id, nama_aplikasi: "Toko online", awalan, nomor: { kode: "luar", label: "Aplikasi luar" }, dicabut_at: null })]);
    expect(JSON.stringify(detail.json())).not.toContain(kunci);
    expect((await admin("GET", "/modules")).json().gerbang.kunci_aktif).toBe(1);
    // The card face itself carries no application name.
    expect(JSON.stringify((await admin("GET", "/modules")).json().gerbang)).not.toContain("Toko online");
  });

  it("refuses a key for a number that is not on the card", async () => {
    const other = randomUUID();
    await pool.query("INSERT INTO kirim_consumers (id, client_id, nama) VALUES ($1, 'spmb-api', 'spmb')", [other]);
    await pool.query("INSERT INTO kirim_devices (id, kode, label, pemilik_consumer_id, provider, status) VALUES ($1, 'spmb', 'SPMB', $2, 'log', 'tersambung')", [randomUUID(), other]);
    const refused = await admin("POST", "/gerbang/kunci", { nama_aplikasi: "Toko", device: "spmb" });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.code).toBe("nomor_bukan_gerbang");
  });
});

describe("Kunci API (konsumen)", () => {
  it("reads its connection and sends a code through the key's number without naming a device", async () => {
    const { kunci, kode } = await keyForNewNumber("Toko online");
    const connection = await withKey(kunci, "GET", "/sambungan");
    expect(connection.statusCode).toBe(200);
    expect(connection.json()).toEqual({ aplikasi: "Toko online", nomor: { kode, status: "tersambung", nomor_tersamar: null }, jenis: ["notifikasi", "kode"], webhook: null });

    const sent = await withKey(kunci, "POST", "/messages", { jenis: "kode", to: PHONE, text: "Kode: 123456", ref: "otp:1" }, "otp:1");
    expect(sent.statusCode).toBe(202);
    const status = await withKey(kunci, "GET", `/messages/${sent.json().id}`);
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ ref: "otp:1", status: "antre" });
    const outbox = await pool.query<{ kode: string }>("SELECT d.kode FROM kirim_outbox o JOIN kirim_devices d ON d.id = o.device_id");
    expect(outbox.rows[0]?.kode).toBe(kode);

    // A notification is allowed too (the gateway owns the number).
    expect((await withKey(kunci, "POST", "/messages", { jenis: "notifikasi", to: PHONE, text: "Pesanan diproses" }, "n:1")).statusCode).toBe(202);
    // A 200-character client key still fits the stored (scoped, hashed) key, and replays the same message.
    const long = "k".repeat(200);
    const once = await withKey(kunci, "POST", "/messages", { jenis: "kode", to: PHONE, text: "Kode: 7" }, long);
    const again = await withKey(kunci, "POST", "/messages", { jenis: "kode", to: PHONE, text: "Kode: 7" }, long);
    expect(once.statusCode).toBe(202);
    expect(again.json().id).toBe(once.json().id);
  });

  it("refuses an unknown key, a device field, and the conversation API", async () => {
    const { kunci } = await keyForNewNumber();
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

  it("keeps idempotency and status per key, and a revoked key stops at once while the number keeps working", async () => {
    const { kunci: a, kode } = await keyForNewNumber("Toko online");
    const second = await admin("POST", "/gerbang/kunci", { nama_aplikasi: "Kasir", device: kode });
    const b = second.json().kunci as string;
    // The same Idempotency-Key with a different body is not a clash across applications.
    const fromA = await withKey(a, "POST", "/messages", { jenis: "kode", to: PHONE, text: "A" }, "same");
    const fromB = await withKey(b, "POST", "/messages", { jenis: "kode", to: PHONE, text: "B" }, "same");
    expect(fromA.statusCode).toBe(202);
    expect(fromB.statusCode).toBe(202);
    expect(fromA.json().id).not.toBe(fromB.json().id);

    const revoked = await admin("POST", `/gerbang/kunci/${(await admin("GET", "/gerbang")).json().kunci.find((k: { nama_aplikasi: string }) => k.nama_aplikasi === "Toko online").id}/cabut`, { alasan: "kunci bocor" });
    expect(revoked.statusCode).toBe(200);
    expect((await withKey(a, "GET", "/sambungan")).statusCode).toBe(401);
    expect((await withKey(b, "GET", "/sambungan")).statusCode).toBe(200);
    expect((await admin("GET", "/modules")).json().gerbang.kunci_aktif).toBe(1);
    const audit = await pool.query<{ aksi: string }>("SELECT aksi FROM kirim_audit WHERE aksi LIKE 'gerbang.%' ORDER BY occurred_at, aksi");
    expect(audit.rows.map((row) => row.aksi)).toEqual(["gerbang.nomor_baru", "gerbang.kunci_buat", "gerbang.kunci_buat", "gerbang.kunci_cabut"]);
  });

  it("never lets a Keycloak token act as the gateway consumer", async () => {
    await keyForNewNumber();
    const viaToken = await app.inject({ method: "GET", url: "/internal/kirim/sambungan", headers: { authorization: "Bearer not-an-api-key" } });
    expect(viaToken.statusCode).toBe(403);
    expect(viaToken.json().error.code).toBe("consumer_unknown");
  });

  it("delivers message.status to the number's own webhook, signed with the secret from the registration", async () => {
    const { kunci } = await keyForNewNumber("Toko online");
    const registered = await withKey(kunci, "PUT", "/sambungan/webhook", { url: "https://toko.example/api/kirim/webhook" });
    expect(registered.statusCode).toBe(200);
    const secret = registered.json().webhook.secret as string;
    expect(secret.length).toBeGreaterThan(30);
    expect((await withKey(kunci, "GET", "/sambungan")).json().webhook).toEqual({ url: "https://toko.example/api/kirim/webhook", secret });
    expect((await withKey(kunci, "PUT", "/sambungan/webhook", { url: "https://user:pw@toko.example/hook" })).statusCode).toBe(422);

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
