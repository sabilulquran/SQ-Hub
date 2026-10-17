import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";

import { exportJWK, generateKeyPair, SignJWT } from "jose";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { PgApplicationAccessRepository } from "../src/modules/application-access/repository.js";
import { ApplicationAccessService } from "../src/modules/application-access/service.js";
import { HubAuthError, type HubAuthRuntime } from "../src/modules/hub-auth/service.js";
import type { KirimConfig } from "../src/modules/kirim/config.js";
import { columnAad, KirimCrypto } from "../src/modules/kirim/crypto.js";
import { createKirimModule, pgEngineMediaRefs, type KirimModule } from "../src/modules/kirim/module.js";
import { JalurPesanProvider } from "../src/modules/kirim/providers/jalurpesan.js";
import { LogProvider } from "../src/modules/kirim/providers/log.js";
import type { KirimProvider, ProviderName } from "../src/modules/kirim/providers/types.js";
import { verifyKeyCanaries } from "../src/modules/kirim/service.js";
import { KirimWebhookSender } from "../src/modules/kirim/webhooks.js";
import { KirimSendWorker } from "../src/modules/kirim/worker.js";
import { JalurPesanStub, receiptPayload, receivedPayload } from "./kirim.fixture.js";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for integration tests");

const pool = new Pool({ connectionString: databaseUrl });
const stub = new JalurPesanStub();
const ORIGIN = "https://kirim.sabilulquran.or.id";
const AUDIENCE = "sq-hub-kirim";
const PHONE = "+6281234567890";
const BODY_TEXT = "Assalamu'alaikum, tautan pendaftaran Ananda: https://spmb.sabilulquran.or.id/d/abc";

let jwksServer: Server;
let issuer: string;
let privateKey: CryptoKey;
let mediaRoot: string;
let config: KirimConfig;
let kirim: KirimModule;
let app: ReturnType<typeof buildApp>;
let providers: Record<ProviderName, KirimProvider>;
const logLines: string[] = [];
const kirimLogs: Array<Record<string, unknown>> = [];
const webhookCalls: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
let webhookStatus = 200;
const sessions = new Map<string, { issuer: string; subject: string; displayName: string }>();
const accessService = new ApplicationAccessService(new PgApplicationAccessRepository(pool));

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

async function token(input: { azp: string; aud?: string }) {
  return new SignJWT({ azp: input.azp })
    .setProtectedHeader({ alg: "RS256", kid: "kirim-test" })
    .setIssuer(issuer)
    .setAudience(input.aud ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

async function send(clientId: string, body: Record<string, unknown>, key: string = randomUUID()) {
  return app.inject({
    method: "POST",
    url: "/internal/kirim/messages",
    headers: { authorization: `Bearer ${await token({ azp: clientId })}`, "idempotency-key": key },
    payload: body,
  });
}

function worker(options: { random?: () => number } = {}) {
  return new KirimSendWorker(pool, kirim.crypto, kirim.service, providers, { random: options.random ?? (() => 0), log: (entry) => kirimLogs.push(entry) });
}

async function outboxFor(messageId: string) {
  const result = await pool.query<{ id: string; status: string; attempts: number; errorCode: string | null; nextAttemptAt: Date; expiresAt: Date; createdAt: Date }>(
    `SELECT id, status, attempts, error_code AS "errorCode", next_attempt_at AS "nextAttemptAt", expires_at AS "expiresAt", created_at AS "createdAt"
     FROM kirim_outbox WHERE message_id = $1`,
    [messageId],
  );
  return result.rows[0]!;
}

async function makeDue() {
  await pool.query("UPDATE kirim_outbox SET next_attempt_at = now() - interval '1 second' WHERE status = 'antre'");
}

async function webhookPayloads(type?: string) {
  const rows = await pool.query<{ id: string; payloadEnc: string; eventType: string }>(
    `SELECT id, payload_enc AS "payloadEnc", event_type AS "eventType" FROM kirim_webhook_deliveries ORDER BY created_at, id`,
  );
  return rows.rows
    .filter((row) => !type || row.eventType === type)
    .map((row) => JSON.parse(kirim.crypto.open(row.payloadEnc, columnAad("kirim_webhook_deliveries", "payload_enc", row.id))) as { event_id: string; type: string; data: Record<string, unknown> });
}

async function auditCount() {
  return Number((await pool.query<{ count: string }>("SELECT count(*) AS count FROM kirim_audit")).rows[0]!.count);
}

function admin(method: "GET" | "POST" | "PATCH", url: string, options: { session?: string; origin?: string | null; payload?: unknown } = {}) {
  return app.inject({
    method,
    url: `/admin/kirim${url}`,
    headers: {
      cookie: `sq_kirim_session=${options.session ?? "admin-session"}`,
      ...(options.origin === null ? {} : { origin: options.origin ?? ORIGIN }),
    },
    ...(options.payload !== undefined ? { payload: options.payload as Record<string, unknown> } : {}),
  });
}

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  Object.assign(jwk, { kid: "kirim-test", alg: "RS256", use: "sig" });
  jwksServer = createServer((request, response) => {
    response.writeHead(request.url?.endsWith("/protocol/openid-connect/certs") ? 200 : 404, { "content-type": "application/json" });
    response.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((resolve) => jwksServer.listen(0, "127.0.0.1", resolve));
  const address = jwksServer.address();
  if (!address || typeof address === "string") throw new Error("jwks server did not bind");
  issuer = `http://127.0.0.1:${address.port}/realms/sq-staff`;
  await stub.start();
  mediaRoot = await mkdtemp(join(tmpdir(), "kirim-media-"));
  process.env.KIRIM_CONSUMER_SECRET_SPMB = "spmb-webhook-secret";
  process.env.KIRIM_CONSUMER_SECRET_HCIS = "hcis-webhook-secret";
});

afterAll(async () => {
  await app?.close();
  await stub.stop();
  await new Promise<void>((resolve) => jwksServer.close(() => resolve()));
  await rm(mediaRoot, { recursive: true, force: true });
  await pool.end();
});

beforeEach(async () => {
  await pool.query(`TRUNCATE kirim_audit, kirim_admins, kirim_webhook_deliveries, kirim_events, kirim_optouts, kirim_media_engine_refs,
    kirim_outbox, kirim_messages, kirim_media, kirim_conversations, kirim_routes, kirim_devices, kirim_consumers, kirim_key_canaries CASCADE`);
  await pool.query("TRUNCATE platform_audit_events, application_access, applications CASCADE");
  stub.reset();
  stub.addTenant("spmb");
  logLines.length = 0;
  kirimLogs.length = 0;
  webhookCalls.length = 0;
  webhookStatus = 200;
  sessions.clear();

  config = {
    tokenAudience: AUDIENCE,
    dataKeys: [{ kid: "k1", key: randomBytes(32) }],
    lookupKey: randomBytes(32),
    mediaRoot,
    inboundMediaMaxBytes: 64 * 1024,
    workerIntervalMs: 2000,
    eventPullIntervalMs: 60000,
    jalurpesan: { baseUrl: stub.baseUrl, platformKey: "platform-key", webhookSecret: "jp-webhook-secret" },
    admin: { clientId: "kirim-sq", clientSecret: "unused", publicOrigin: ORIGIN },
  };
  providers = {
    log: new LogProvider((entry) => kirimLogs.push(entry)),
    jalurpesan: new JalurPesanProvider({ baseUrl: stub.baseUrl, platformKey: "platform-key", timeoutMs: 500 }, pgEngineMediaRefs(pool)),
  };
  kirim = createKirimModule({
    pool,
    config,
    keycloakIssuer: issuer,
    access: accessService,
    adminAuth,
    providers,
    webhookTransport: async (request) => {
      webhookCalls.push({ url: request.url, body: request.body, headers: request.headers });
      return { status: webhookStatus };
    },
    log: (entry) => kirimLogs.push(entry),
  });
  await app?.close();
  app = buildApp({
    accessService,
    verifyMachineToken: async () => ({ clientId: "unused" }),
    kirim,
    logStream: new Writable({
      write(chunk, _encoding, callback) {
        logLines.push(String(chunk));
        callback();
      },
    }),
  });
  await verifyKeyCanaries(pool, kirim.crypto);

  const consumer = async (nama: string, clientId: string, webhook: string | null, ref: string | null, quota = 500) => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO kirim_consumers (id, client_id, nama, webhook_url, webhook_secret_ref, kuota_harian) VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, clientId, nama, webhook, ref, quota],
    );
    return id;
  };
  const spmb = await consumer("spmb", "spmb-api", "http://127.0.0.1:3303/kirim/webhook", "KIRIM_CONSUMER_SECRET_SPMB");
  const hcis = await consumer("hcis", "hcis-api", "https://hcis.sabilulquran.or.id/api/kirim/webhook", "KIRIM_CONSUMER_SECRET_HCIS");
  const keluarga = await consumer("keluarga", "keluarga-api", null, null);
  const spmbDevice = randomUUID();
  await pool.query(
    `INSERT INTO kirim_devices (id, kode, label, pemilik_consumer_id, provider, provider_ref, status) VALUES
       ($1, 'spmb', 'SPMB resmi', $2, 'jalurpesan', 'spmb', 'tersambung'),
       ($3, 'hcis', 'HCIS', $4, 'log', NULL, 'tersambung')`,
    [spmbDevice, spmb, randomUUID(), hcis],
  );
  await pool.query("INSERT INTO kirim_routes (consumer_id, device_id, jenis) VALUES ($1, $2, 'kode')", [keluarga, spmbDevice]);
});

describe("POST /internal/kirim/messages (§5.1)", () => {
  it("rejects a token without the sq-hub-kirim audience with 401", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/internal/kirim/messages",
      headers: { authorization: `Bearer ${await token({ azp: "spmb-api", aud: "sq-hub-api" })}`, "idempotency-key": "k" },
      payload: { device: "spmb", jenis: "notifikasi", to: PHONE, text: "x" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: { code: "unauthenticated", message: expect.any(String) } });
  });

  it("rejects a client that is not a registered consumer with 403 consumer_unknown", async () => {
    const response = await send("karir-api", { device: "spmb", jenis: "notifikasi", to: PHONE, text: "x" });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("consumer_unknown");
    await pool.query("UPDATE kirim_consumers SET aktif = false WHERE nama = 'spmb'");
    expect((await send("spmb-api", { device: "spmb", jenis: "notifikasi", to: PHONE, text: "x" })).statusCode).toBe(403);
  });

  it("requires an Idempotency-Key", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/internal/kirim/messages",
      headers: { authorization: `Bearer ${await token({ azp: "spmb-api" })}` },
      payload: { device: "spmb", jenis: "notifikasi", to: PHONE, text: "x" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("answers the same key and body with the same message, and a changed body with 409", async () => {
    const body = { device: "spmb", jenis: "notifikasi", to: PHONE, text: BODY_TEXT, ref: "spmb:lead-1:link:v1" };
    const first = await send("spmb-api", body, "lead-1");
    const second = await send("spmb-api", { ...body }, "lead-1");
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(second.json()).toEqual(first.json());
    expect(first.json()).toEqual({ id: expect.any(String), status: "antre" });
    const count = await pool.query<{ count: string }>("SELECT count(*) AS count FROM kirim_messages");
    expect(count.rows[0]!.count).toBe("1");
    const conflict = await send("spmb-api", { ...body, text: "lain" }, "lead-1");
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("idempotency_key_conflict");
  });

  it("returns each 422 code", async () => {
    const base = { device: "spmb", jenis: "notifikasi", to: PHONE, text: "x" };
    const optout = await app.inject({
      method: "POST",
      url: "/internal/kirim/optouts",
      headers: { authorization: `Bearer ${await token({ azp: "spmb-api" })}` },
      payload: { nomor: "0812-3456-7890", cakupan: "consumer", alasan: "Minta berhenti" },
    });
    expect(optout.json()).toEqual({ cakupan: "consumer", dibuat: true });
    const again = await app.inject({
      method: "POST",
      url: "/internal/kirim/optouts",
      headers: { authorization: `Bearer ${await token({ azp: "spmb-api" })}` },
      payload: { nomor: PHONE, cakupan: "consumer", alasan: "Minta berhenti" },
    });
    expect(again.json()).toEqual({ cakupan: "consumer", dibuat: false });
    const semua = await app.inject({
      method: "POST",
      url: "/internal/kirim/optouts",
      headers: { authorization: `Bearer ${await token({ azp: "spmb-api" })}` },
      payload: { nomor: PHONE, cakupan: "semua", alasan: "x" },
    });
    expect(semua.statusCode).toBe(400);

    const cases: Array<[string, () => Promise<{ statusCode: number; json: () => { error: { code: string } } }>]> = [
      ["optout", () => send("spmb-api", base)],
      ["route_denied", () => send("hcis-api", base)],
      ["route_denied", () => send("keluarga-api", base)],
      ["device_inactive", () => send("spmb-api", { ...base, device: "tidak-ada" })],
      ["invalid_number", () => send("spmb-api", { ...base, to: "12345" })],
      ["media_invalid", () => send("spmb-api", { device: "spmb", jenis: "notifikasi", to: "+6281111111111", media_id: randomUUID() })],
    ];
    for (const [code, run] of cases) {
      const response = await run();
      expect({ code, status: response.statusCode, body: response.json().error.code }).toEqual({ code, status: 422, body: code });
    }

    await pool.query("UPDATE kirim_devices SET status = 'nonaktif' WHERE kode = 'hcis'");
    expect((await send("hcis-api", { ...base, device: "hcis" })).json().error.code).toBe("device_inactive");

    await pool.query("UPDATE kirim_consumers SET kuota_harian = 1 WHERE nama = 'spmb'");
    expect((await send("spmb-api", { ...base, to: "+6281111111111" })).statusCode).toBe(202);
    expect((await send("spmb-api", { ...base, to: "+6282222222222" })).json().error.code).toBe("quota_exceeded");
  });

  it("lets kode ignore opt-out and send hours, caps expiry at 10 minutes and marks the body masked", async () => {
    await pool.query(
      `INSERT INTO kirim_optouts (id, nomor_hmac, cakupan, alasan, sumber) VALUES ($1, $2, 'semua', 'admin test', 'admin')`,
      [randomUUID(), kirim.crypto.lookup(`pn:${PHONE}`)],
    );
    // A send window that excludes now: kode must still go out.
    const hour = (new Date().getUTCHours() + 7) % 24;
    await pool.query("UPDATE kirim_devices SET jam_kirim_mulai = $1, jam_kirim_selesai = $2 WHERE kode = 'spmb'", hour < 12 ? ["13:00", "14:00"] : ["01:00", "02:00"]);
    const response = await send("keluarga-api", { device: "spmb", jenis: "kode", to: PHONE, text: "Kode Anda 482913", kedaluwarsa: new Date(Date.now() + 3600_000).toISOString() });
    expect(response.statusCode).toBe(202);
    const outbox = await outboxFor(response.json().id);
    expect(outbox.expiresAt.getTime() - outbox.createdAt.getTime()).toBeLessThanOrEqual(10 * 60_000 + 1000);
    const message = await pool.query<{ masked: boolean; jenis: string }>("SELECT body_disamarkan AS masked, jenis FROM kirim_messages WHERE id = $1", [response.json().id]);
    expect(message.rows[0]).toEqual({ masked: true, jenis: "kode" });
    expect((await pool.query("SELECT prioritas FROM kirim_outbox WHERE message_id = $1", [response.json().id])).rows[0]).toEqual({ prioritas: "kode" });
    expect((await send("spmb-api", { device: "spmb", jenis: "notifikasi", to: PHONE, text: "x" })).json().error.code).toBe("optout");

    await worker().runOnce();
    expect((await outboxFor(response.json().id)).status).toBe("diserahkan");
  });
});

describe("GET /internal/kirim/messages/:id (§6.1)", () => {
  it("shows status to the sender only, without body or full number", async () => {
    const created = await send("spmb-api", { device: "spmb", jenis: "notifikasi", to: PHONE, text: BODY_TEXT, ref: "spmb:lead-2" });
    const id = created.json().id;
    const own = await app.inject({ method: "GET", url: `/internal/kirim/messages/${id}`, headers: { authorization: `Bearer ${await token({ azp: "spmb-api" })}` } });
    expect(own.statusCode).toBe(200);
    expect(own.json()).toEqual({ id, ref: "spmb:lead-2", status: "antre", error_code: null, dry_run: false, updated_at: expect.any(String) });
    expect(own.body).not.toContain("81234567890");
    expect(own.body).not.toContain("tautan");
    const other = await app.inject({ method: "GET", url: `/internal/kirim/messages/${id}`, headers: { authorization: `Bearer ${await token({ azp: "hcis-api" })}` } });
    expect(other.statusCode).toBe(404);
  });
});

describe("POST /internal/kirim/media (§5.4)", () => {
  async function upload(file: Buffer, mime: string, device = "spmb") {
    const boundary = "----kirimtest";
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="device"\r\n\r\n${device}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="slip.pdf"\r\nContent-Type: ${mime}\r\n\r\n`),
      file,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return app.inject({
      method: "POST",
      url: "/internal/kirim/media",
      headers: { authorization: `Bearer ${await token({ azp: "spmb-api" })}`, "content-type": `multipart/form-data; boundary=${boundary}` },
      payload,
    });
  }

  it("accepts a PDF, stores it encrypted with mode 0600 and lets a message use it", async () => {
    const pdf = Buffer.from("%PDF-1.7\nSlip gaji rahasia\n%%EOF");
    const response = await upload(pdf, "application/pdf");
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ media_id: expect.any(String), sha256: expect.stringMatching(/^[0-9a-f]{64}$/), ukuran: pdf.length });
    const row = await pool.query<{ path: string }>("SELECT path FROM kirim_media WHERE id = $1", [response.json().media_id]);
    const stored = await readFile(join(mediaRoot, row.rows[0]!.path));
    expect(stored.includes(Buffer.from("Slip gaji rahasia"))).toBe(false);
    const sent = await send("spmb-api", { device: "spmb", jenis: "notifikasi", to: PHONE, media_id: response.json().media_id, caption: "Slip Oktober" });
    expect(sent.statusCode).toBe(202);
  });

  it("rejects a non-PDF, a file over 5 MiB and fake magic bytes", async () => {
    expect((await upload(Buffer.from("%PDF-1.7"), "image/png")).json().error.code).toBe("media_invalid");
    expect((await upload(Buffer.from("MZ not a pdf"), "application/pdf")).json().error.code).toBe("media_invalid");
    const big = Buffer.concat([Buffer.from("%PDF-1.7"), Buffer.alloc(5 * 1024 * 1024)]);
    const response = await upload(big, "application/pdf");
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("media_invalid");
    expect(Number((await pool.query<{ count: string }>("SELECT count(*) AS count FROM kirim_media")).rows[0]!.count)).toBe(0);
  });
});

describe("Send worker (§5.2)", () => {
  it("hands log messages over as dry_run without any engine call", async () => {
    const created = await send("hcis-api", { device: "hcis", jenis: "notifikasi", to: PHONE, text: "Slip gaji Oktober sudah tersedia" });
    const hour = (new Date().getUTCHours() + 7) % 24;
    if (hour < 6 || hour >= 21) await pool.query("UPDATE kirim_devices SET jam_kirim_mulai = '00:00', jam_kirim_selesai = '23:59' WHERE kode = 'hcis'");
    await worker().runOnce();
    expect(stub.requests).toHaveLength(0);
    const status = await pool.query<{ status: string; dryRun: boolean; providerMessageId: string }>(
      `SELECT status, dry_run AS "dryRun", provider_message_id AS "providerMessageId" FROM kirim_messages WHERE id = $1`,
      [created.json().id],
    );
    expect(status.rows[0]).toMatchObject({ status: "diserahkan", dryRun: true, providerMessageId: expect.stringMatching(/^log:kirim:/) });
    const events = await webhookPayloads("message.status");
    expect(events.at(-1)?.data).toEqual({ id: created.json().id, ref: null, status: "diserahkan", error_code: null, dry_run: true });
  });

  it("retries after 1, 5 and 30 minutes with the same engine key, then fails with message.status", async () => {
    await allDay();
    const created = await send("spmb-api", { device: "spmb", jenis: "notifikasi", to: PHONE, text: "x" });
    const delays: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      stub.sendQueue.push({ status: 503, body: { success: false, error: "WhatsApp is not connected" } });
      const before = Date.now();
      await worker().runOnce();
      const outbox = await outboxFor(created.json().id);
      if (outbox.status === "antre") delays.push(Math.round((outbox.nextAttemptAt.getTime() - before) / 60_000));
      await makeDue();
    }
    expect(delays).toEqual([1, 5, 30]);
    const final = await outboxFor(created.json().id);
    expect(final).toMatchObject({ status: "gagal", attempts: 4, errorCode: "engine_unavailable" });
    const keys = stub.requests.filter((request) => request.path.endsWith("/messages")).map((request) => request.idempotencyKey);
    expect(keys).toEqual(Array(4).fill(`kirim:${final.id}`));
    const statuses = (await webhookPayloads("message.status")).map((event) => event.data.status);
    expect(statuses).toEqual(["gagal"]);
  });

  it("does not send twice after a restart in the middle of a lease", async () => {
    await allDay();
    const created = await send("spmb-api", { device: "spmb", jenis: "notifikasi", to: PHONE, text: "x" });
    const crashing: KirimProvider = {
      ...providers.jalurpesan,
      name: "jalurpesan",
      sendText: async (...args) => {
        await providers.jalurpesan.sendText(...args);
        throw new Error("process died after the engine accepted the message");
      },
    } as KirimProvider;
    await expect(new KirimSendWorker(pool, kirim.crypto, kirim.service, { log: providers.log, jalurpesan: crashing }).runOnce()).rejects.toThrow();
    // Still leased: a second process must not pick it up yet.
    await worker().runOnce();
    expect(stub.requests.filter((request) => request.path.endsWith("/messages"))).toHaveLength(1);
    // Lease expires; the retry reuses kirim:<outbox_id>, so the engine answers with the same message.
    await makeDue();
    await worker().runOnce();
    const outbox = await outboxFor(created.json().id);
    expect(outbox.status).toBe("diserahkan");
    expect([...stub.sendsByKey.keys()]).toEqual([`kirim:${outbox.id}`]);
    expect(stub.messageIdByKey.size).toBe(1);
  });

  it("pauses only the disconnected number and notifies its consumers", async () => {
    await allDay();
    const spmb = await send("spmb-api", { device: "spmb", jenis: "notifikasi", to: PHONE, text: "x" });
    const hcis = await send("hcis-api", { device: "hcis", jenis: "notifikasi", to: PHONE, text: "y" });
    stub.sendQueue.push({ status: 404, body: { success: false, error: "Tenant device not found" } });
    await worker().runOnce();
    expect((await outboxFor(spmb.json().id))).toMatchObject({ status: "antre", attempts: 0 });
    expect((await outboxFor(hcis.json().id)).status).toBe("diserahkan");
    expect((await pool.query("SELECT status FROM kirim_devices WHERE kode = 'spmb'")).rows[0]).toEqual({ status: "terputus" });
    const deviceEvents = await webhookPayloads("device.status");
    expect(deviceEvents.map((event) => event.data)).toEqual([{ device: "spmb", status: "terputus" }]);
    await makeDue();
    await worker().runOnce();
    expect(stub.requests.filter((request) => request.path.endsWith("/messages"))).toHaveLength(1);
    await adminAs("admin-session");
    const devices = await admin("GET", "/devices");
    expect(devices.json().peringatan.terputus).toEqual(["spmb"]);
  });

  it("holds notifikasi outside send hours, respects the rate limit and uploads a document once", async () => {
    const hour = (new Date().getUTCHours() + 7) % 24;
    await pool.query("UPDATE kirim_devices SET jam_kirim_mulai = $1, jam_kirim_selesai = $2 WHERE kode = 'spmb'", hour < 12 ? ["13:00", "14:00"] : ["01:00", "02:00"]);
    const held = await send("spmb-api", { device: "spmb", jenis: "notifikasi", to: PHONE, text: "x" });
    await worker().runOnce();
    const outbox = await outboxFor(held.json().id);
    expect(outbox.status).toBe("antre");
    const local = new Date(outbox.nextAttemptAt.getTime() + 7 * 3600_000);
    expect(`${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`).toBe(hour < 12 ? "13:00" : "01:00");
    expect(stub.requests).toHaveLength(0);

    await allDay();
    await pool.query("UPDATE kirim_devices SET rate_per_menit = 1 WHERE kode = 'spmb'");
    await makeDue();
    const pdf = Buffer.from("%PDF-1.7 dokumen");
    const media = await kirim.service.storeOutboundMedia((await kirim.service.requireConsumer("spmb-api")), { deviceKode: "spmb", mime: "application/pdf", data: pdf, truncated: false });
    await send("spmb-api", { device: "spmb", jenis: "notifikasi", to: "+6281111111111", media_id: media.media_id });
    await send("spmb-api", { device: "spmb", jenis: "notifikasi", to: "+6282222222222", media_id: media.media_id });
    await worker().runOnce();
    await worker().runOnce();
    expect(stub.totalSends()).toBe(1);
    await pool.query("UPDATE kirim_messages SET provider_at = provider_at - interval '61 seconds' WHERE provider_at IS NOT NULL");
    await pool.query("UPDATE kirim_devices SET rate_per_menit = 10 WHERE kode = 'spmb'");
    await worker().runOnce();
    await worker().runOnce();
    expect(stub.totalSends()).toBe(3);
    expect(stub.uploads).toBe(1);
  });
});

describe("Ingest (§6.3)", () => {
  async function pull() {
    await kirim.ingest!.runOnce();
  }

  it("stores inbound text and media encrypted, ignores groups, and forwards message.received", async () => {
    stub.media.set("engine-media-1", Buffer.from("%PDF-1.7 bukti transfer"));
    stub.addEvent("spmb", "message.received", receivedPayload({ body: "Mau tanya biaya" }));
    stub.addEvent("spmb", "message.received", receivedPayload({ body: null, media: { id: "engine-media-1", sizeBytes: 23 } }));
    stub.addEvent("spmb", "message.received", receivedPayload({ body: "di grup", group: true }));
    stub.addEvent("spmb", "message.received", receivedPayload({ from: "99887766554433@lid", body: "dari lid" }));
    await pull();
    const messages = await pool.query<{ tipe: string; mediaId: string | null }>(`SELECT tipe, media_id AS "mediaId" FROM kirim_messages WHERE arah = 'masuk' ORDER BY provider_at, tipe`);
    expect(messages.rows.map((row) => row.tipe).sort()).toEqual(["dokumen", "teks", "teks"]);
    const media = await pool.query<{ path: string; id: string }>("SELECT id, path FROM kirim_media WHERE arah = 'masuk'");
    const file = await readFile(join(mediaRoot, media.rows[0]!.path));
    expect(file.includes(Buffer.from("bukti transfer"))).toBe(false);
    expect(kirim.crypto.openFile(file, columnAad("kirim_media", "file", media.rows[0]!.id)).toString()).toContain("bukti transfer");
    const received = await webhookPayloads("message.received");
    expect(received).toHaveLength(3);
    expect(received[0]).toMatchObject({ event_id: expect.any(String), data: { device: "spmb", message_id: expect.any(String), conversation_id: expect.any(String), from: PHONE, tipe: "teks", cuplikan: "Mau tanya biaya" } });
    expect(received.find((event) => event.data.cuplikan === "dari lid")?.data.from).toBeNull();
    const cursor = await pool.query("SELECT max(provider_cursor)::int AS cursor FROM kirim_events");
    expect(cursor.rows[0]).toEqual({ cursor: 4 });
  });

  it("stores a duplicate event from webhook and pull only once and drops unknown tenants", async () => {
    const event = stub.addEvent("spmb", "message.received", receivedPayload({ body: "sekali saja" }));
    const raw = JSON.stringify(event);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = `v1=${createHmac("sha256", "jp-webhook-secret").update(`${timestamp}.${raw}`).digest("hex")}`;
    const post = (body: string, sig = signature) =>
      app.inject({
        method: "POST",
        url: "/internal/kirim/engine/jalurpesan/webhook",
        headers: { "content-type": "application/json", "x-jalurpesan-signature": sig, "x-jalurpesan-timestamp": String(timestamp) },
        payload: body,
      });
    expect((await post(raw, `v1=${"0".repeat(64)}`)).statusCode).toBe(401);
    expect((await post(`${raw} `)).statusCode).toBe(401);
    const first = await post(raw);
    expect(first.statusCode).toBe(200);
    expect(first.json().outcome).toBe("queued");
    await kirim.ingest!.pullDevice((await pool.query<{ id: string }>("SELECT id FROM kirim_devices WHERE kode = 'spmb'")).rows[0]!.id);
    await pull();
    expect((await post(raw)).json().outcome).toBe("duplicate");
    const count = await pool.query<{ count: string }>("SELECT count(*) AS count FROM kirim_messages WHERE arah = 'masuk'");
    expect(count.rows[0]!.count).toBe("1");
    expect(await webhookPayloads("message.received")).toHaveLength(1);

    const stranger = JSON.stringify({ ...event, eventId: randomUUID(), deviceId: randomUUID() });
    const strangerSig = `v1=${createHmac("sha256", "jp-webhook-secret").update(`${timestamp}.${stranger}`).digest("hex")}`;
    expect((await post(stranger, strangerSig)).json().outcome).toBe("unknown_tenant");
  });

  it("advances outbound status from delivery and read receipts, never backwards", async () => {
    await allDay();
    const created = await send("spmb-api", { device: "spmb", jenis: "notifikasi", to: PHONE, text: "x", ref: "spmb:lead-9" });
    await worker().runOnce();
    const engineId = [...stub.messageIdByKey.values()][0]!;
    stub.addEvent("spmb", "message.read", receiptPayload(engineId, "read"));
    stub.addEvent("spmb", "message.delivered", receiptPayload(engineId, "delivered"));
    await pull();
    expect((await outboxFor(created.json().id)).status).toBe("dibaca");
    const statuses = (await webhookPayloads("message.status")).map((event) => event.data.status);
    expect(statuses).toEqual(["diserahkan", "dibaca"]);
  });
});

describe("Outgoing webhooks (§6.2)", () => {
  it("signs, retries with the same event id and body, then marks habis after 8 attempts", async () => {
    await send("spmb-api", { device: "spmb", jenis: "notifikasi", to: PHONE, text: "x" });
    await pool.query("UPDATE kirim_devices SET status = 'terputus' WHERE kode = 'spmb'");
    await pool.query(
      `INSERT INTO kirim_webhook_deliveries (id, consumer_id, event_type, payload_enc)
       SELECT $1, id, 'device.status', $2 FROM kirim_consumers WHERE nama = 'spmb'`,
      [
        "0b6c4f2e-6f37-4c0b-9a59-8a3c4f9f0001",
        kirim.crypto.seal(JSON.stringify({ event_id: "0b6c4f2e-6f37-4c0b-9a59-8a3c4f9f0001", type: "device.status", occurred_at: new Date().toISOString(), data: { device: "spmb", status: "terputus" } }), columnAad("kirim_webhook_deliveries", "payload_enc", "0b6c4f2e-6f37-4c0b-9a59-8a3c4f9f0001")),
      ],
    );
    webhookStatus = 500;
    const sender = new KirimWebhookSender(pool, kirim.crypto, {
      transport: async (request) => {
        webhookCalls.push({ url: request.url, body: request.body, headers: request.headers });
        return { status: webhookStatus };
      },
    });
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await sender.runOnce();
      await pool.query("UPDATE kirim_webhook_deliveries SET next_attempt_at = now() WHERE status = 'retry'");
    }
    const row = await pool.query<{ status: string; attempts: number }>("SELECT status, attempts FROM kirim_webhook_deliveries WHERE id = '0b6c4f2e-6f37-4c0b-9a59-8a3c4f9f0001'");
    expect(row.rows[0]).toEqual({ status: "habis", attempts: 8 });
    const calls = webhookCalls.filter((call) => call.headers["x-kirim-event-id"] === "0b6c4f2e-6f37-4c0b-9a59-8a3c4f9f0001");
    expect(calls).toHaveLength(8);
    expect(new Set(calls.map((call) => call.body)).size).toBe(1);
    const call = calls[0]!;
    expect(call.url).toBe("http://127.0.0.1:3303/kirim/webhook");
    expect(call.headers["x-kirim-signature"]).toBe(
      createHmac("sha256", "spmb-webhook-secret").update(`${call.headers["x-kirim-timestamp"]}.${call.body}`).digest("hex"),
    );
    await pool.query("UPDATE kirim_webhook_deliveries SET status = 'pending', attempts = 0 WHERE status = 'retry'");
    webhookStatus = 204;
    await sender.runOnce();
    expect((await pool.query("SELECT count(*)::int AS count FROM kirim_webhook_deliveries WHERE status = 'habis'")).rows[0]).toEqual({ count: 1 });
  });
});

async function allDay() {
  await pool.query("UPDATE kirim_devices SET jam_kirim_mulai = '00:00', jam_kirim_selesai = '23:59'");
}

async function adminAs(session: string, options: { access?: boolean; admin?: boolean } = {}) {
  const identity = { issuer, subject: `subject-${session}` };
  sessions.set(session, { ...identity, displayName: "Kepala HCM" });
  await accessService.upsertApplication({ applicationKey: "kirim-sq", name: "Kirim SQ", canonicalUrl: ORIGIN, status: "active", actor: { kind: "system", ref: "test" } });
  if (options.access !== false) await accessService.grant({ identity, applicationKey: "kirim-sq", actor: { kind: "system", ref: "test" } });
  if (options.admin !== false) {
    await pool.query(
      "INSERT INTO kirim_admins (id, identity_issuer, identity_subject, granted_by, alasan) VALUES ($1, $2, $3, 'test', 'test') ON CONFLICT DO NOTHING",
      [randomUUID(), identity.issuer, identity.subject],
    );
  }
  return identity;
}

describe("Admin API (§6.4, §7.2)", () => {
  it("requires Application Access and a kirim_admins row", async () => {
    expect((await admin("GET", "/devices", { session: "nobody" })).statusCode).toBe(401);
    await adminAs("no-access", { access: false });
    const noAccess = await admin("GET", "/devices", { session: "no-access" });
    expect(noAccess.statusCode).toBe(403);
    expect(noAccess.json().error.code).toBe("kirim_access_denied");
    await adminAs("no-role", { admin: false });
    const noRole = await admin("GET", "/devices", { session: "no-role" });
    expect(noRole.statusCode).toBe(403);
    expect(noRole.json().error.code).toBe("kirim_admin_required");
    await adminAs("admin-session");
    const ok = await admin("GET", "/devices");
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["cache-control"]).toBe("no-store");
  });

  it("requires a reason, the kirim origin, and writes exactly one audit row per action", async () => {
    await adminAs("admin-session");
    expect((await admin("POST", "/devices/hcis/deactivate", { payload: {} })).statusCode).toBe(400);
    expect((await admin("POST", "/devices/hcis/deactivate", { payload: { alasan: "x" }, origin: "https://hub.sabilulquran.or.id" })).statusCode).toBe(403);
    expect((await admin("POST", "/devices/hcis/pause", { payload: {}, origin: null })).statusCode).toBe(403);
    expect(await auditCount()).toBe(0);

    const actions: Array<[string, "POST" | "PATCH", string, unknown]> = [
      ["tambah", "POST", "/devices", { kode: "keuangan", label: "Keuangan", pemilik: "hcis" }],
      ["ubah", "PATCH", "/devices/keuangan", { label: "Keuangan SQ", rate_per_menit: 5 }],
      ["jeda", "POST", "/devices/keuangan/pause", { alasan: "persiapan" }],
      ["ganti provider", "PATCH", "/devices/keuangan", { provider: "jalurpesan", provider_ref: "keuangan", alasan: "uji mesin" }],
      ["lanjut", "POST", "/devices/keuangan/resume", {}],
      ["nonaktif", "POST", "/devices/keuangan/deactivate", { alasan: "tidak dipakai" }],
    ];
    for (const [label, method, url, payload] of actions) {
      const before = await auditCount();
      const response = await admin(method, url, { payload });
      expect({ label, status: response.statusCode }).toEqual({ label, status: method === "POST" && url === "/devices" ? 201 : 200 });
      expect({ label, added: (await auditCount()) - before }).toEqual({ label, added: 1 });
    }
    const audit = await pool.query<{ metadata: unknown }>("SELECT metadata FROM kirim_audit");
    expect(JSON.stringify(audit.rows)).not.toMatch(/\+62|628\d{6}/);
  });

  it("blocks a provider change while the queue runs or real hand-overs await receipts", async () => {
    await adminAs("admin-session");
    const unpaused = await admin("PATCH", "/devices/spmb", { payload: { provider: "log", alasan: "uji" } });
    expect(unpaused.json().error.code).toBe("queue_not_paused");
    await allDay();
    await send("spmb-api", { device: "spmb", jenis: "notifikasi", to: PHONE, text: "x" });
    await worker().runOnce();
    await admin("POST", "/devices/spmb/pause", { payload: {} });
    expect((await admin("PATCH", "/devices/spmb", { payload: { provider: "log", alasan: "uji" } })).json().error.code).toBe("handover_pending");
    await pool.query("UPDATE kirim_messages SET provider_at = now() - interval '25 hours'");
    const changed = await admin("PATCH", "/devices/spmb", { payload: { provider: "log", alasan: "uji" } });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({ provider: "log", status: "tersambung" });
  });

  it("returns QR and pairing codes once with no-store and never stores or audits them", async () => {
    await adminAs("admin-session");
    stub.tenants.get("spmb")!.live = "disconnected";
    const qr = await admin("POST", "/devices/spmb/pairing", { payload: { mode: "qr" } });
    expect(qr.statusCode).toBe(200);
    expect(qr.headers["cache-control"]).toBe("no-store");
    expect(qr.json()).toEqual({ mode: "qr", qr: "data:image/png;base64,UVJDT0RF" });
    const code = await admin("POST", "/devices/spmb/pairing", { payload: { mode: "kode", phone: "081200001111" } });
    expect(code.json()).toEqual({ mode: "kode", pairing_code: "ABCD-EFGH" });
    const status = await admin("GET", "/devices/spmb/status");
    expect(status.json()).toMatchObject({ status: "menunggu_pairing", qr: expect.stringMatching(/^data:image/) });
    const dump = JSON.stringify((await pool.query("SELECT * FROM kirim_audit")).rows) + JSON.stringify((await pool.query("SELECT * FROM kirim_devices")).rows);
    expect(dump).not.toContain("UVJDT0RF");
    expect(dump).not.toContain("ABCD-EFGH");
    expect(dump).not.toContain("81200001111");
    expect((await admin("POST", "/devices/hcis/pairing", { payload: { mode: "qr" } })).json().error.code).toBe("pairing_not_applicable");
  });

  it("lists the queue without bodies or full numbers, and retries and cancels", async () => {
    await adminAs("admin-session");
    const first = await send("spmb-api", { device: "spmb", jenis: "notifikasi", to: PHONE, text: BODY_TEXT, ref: "spmb:a" });
    const second = await send("spmb-api", { device: "spmb", jenis: "notifikasi", to: "+6281111111111", text: BODY_TEXT, ref: "spmb:b" });
    const queue = await admin("GET", "/queue?device=spmb");
    expect(queue.statusCode).toBe(200);
    expect(queue.body).not.toContain("tautan");
    expect(queue.body).not.toContain("81234567890");
    expect(queue.json().items[0]).toMatchObject({ pemakai: "spmb", tujuan: expect.stringMatching(/^\+62 8\d\d-••••-\d{4}$/), status: "antre" });

    expect((await admin("POST", `/queue/${first.json().id}/cancel`, { payload: {} })).statusCode).toBe(400);
    expect((await admin("POST", `/queue/${first.json().id}/cancel`, { payload: { alasan: "salah kirim" } })).json()).toEqual({ id: first.json().id, status: "dibatalkan" });
    expect((await admin("POST", `/queue/${first.json().id}/retry`, { payload: {} })).json().error.code).toBe("not_retryable");
    await pool.query("UPDATE kirim_outbox SET status = 'gagal', error_code = 'engine_unavailable', attempts = 4 WHERE message_id = $1", [second.json().id]);
    expect((await admin("POST", `/queue/${second.json().id}/retry`, { payload: {} })).json()).toEqual({ id: second.json().id, status: "antre" });
    expect(await outboxFor(second.json().id)).toMatchObject({ status: "antre", attempts: 0 });

    const summary = await admin("GET", "/queue/summary");
    expect(summary.json().per_nomor).toEqual([expect.objectContaining({ nomor: "spmb", antre: 1, dibatalkan: 1 })]);
  });
});

describe("Privacy (§10, §14 no. 6 and 9)", () => {
  it("keeps numbers, bodies, QR, pairing codes and tokens out of logs while sending and receiving", async () => {
    await adminAs("admin-session");
    await allDay();
    const bearer = await token({ azp: "spmb-api" });
    await app.inject({ method: "POST", url: "/internal/kirim/messages?debug=1", headers: { authorization: `Bearer ${bearer}`, "idempotency-key": "p1" }, payload: { device: "spmb", jenis: "notifikasi", to: PHONE, text: BODY_TEXT } });
    await app.inject({ method: "POST", url: "/internal/kirim/messages", headers: { authorization: `Bearer ${await token({ azp: "hcis-api" })}`, "idempotency-key": "p2" }, payload: { device: "hcis", jenis: "notifikasi", to: PHONE, text: BODY_TEXT } });
    await worker().runOnce();
    stub.addEvent("spmb", "message.received", receivedPayload({ body: "Balasan rahasia orang tua" }));
    await kirim.ingest!.runOnce();
    await admin("POST", "/devices/spmb/pairing", { payload: { mode: "kode", phone: "081200001111" } });
    await admin("POST", "/devices/spmb/pairing", { payload: { mode: "qr" } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const output = logLines.join("\n") + JSON.stringify(kirimLogs);
    expect(logLines.length).toBeGreaterThan(0);
    for (const secret of ["81234567890", "tautan pendaftaran", "Balasan rahasia", "UVJDT0RF", "ABCD-EFGH", "81200001111", bearer, "debug=1"]) {
      expect({ secret, found: output.includes(secret) }).toEqual({ secret, found: false });
    }
  });

  it("leaves no plaintext body or number in a database dump without the keys", async () => {
    await allDay();
    await send("spmb-api", { device: "spmb", jenis: "notifikasi", to: PHONE, text: BODY_TEXT });
    await worker().runOnce();
    stub.addEvent("spmb", "message.received", receivedPayload({ body: "Balasan rahasia orang tua" }));
    await kirim.ingest!.runOnce();
    let dump = "";
    for (const table of ["kirim_conversations", "kirim_messages", "kirim_outbox", "kirim_webhook_deliveries", "kirim_events", "kirim_devices", "kirim_audit"]) {
      dump += JSON.stringify((await pool.query(`SELECT * FROM ${table}`)).rows);
    }
    expect(dump).not.toContain("81234567890");
    expect(dump).not.toContain("tautan pendaftaran");
    expect(dump).not.toContain("Balasan rahasia");
    // With the key from the key backup, a stored message opens (§4.2 step 5).
    const message = await pool.query<{ id: string; bodyEnc: string }>(`SELECT id, body_enc AS "bodyEnc" FROM kirim_messages WHERE arah = 'masuk'`);
    const restored = new KirimCrypto(config.dataKeys, config.lookupKey);
    expect(restored.open(message.rows[0]!.bodyEnc, columnAad("kirim_messages", "body_enc", message.rows[0]!.id))).toBe("Balasan rahasia orang tua");
  });
});

describe("Key canaries (§9)", () => {
  it("refuses to start with a wrong or missing data key, or a wrong lookup key", async () => {
    await expect(verifyKeyCanaries(pool, kirim.crypto)).resolves.toBeUndefined();
    await expect(verifyKeyCanaries(pool, new KirimCrypto([{ kid: "k1", key: randomBytes(32) }], config.lookupKey))).rejects.toThrow(/cannot open/);
    await expect(verifyKeyCanaries(pool, new KirimCrypto([{ kid: "k9", key: randomBytes(32) }], config.lookupKey))).rejects.toThrow(/missing/);
    await expect(verifyKeyCanaries(pool, new KirimCrypto(config.dataKeys, randomBytes(32)))).rejects.toThrow(/lookup key/);
    const rotated = new KirimCrypto([{ kid: "k2", key: randomBytes(32) }, ...config.dataKeys], config.lookupKey);
    await expect(verifyKeyCanaries(pool, rotated)).resolves.toBeUndefined();
  });
});

describe("Media files", () => {
  it("writes media files with mode 0600 where the platform supports it", async () => {
    const media = await kirim.service.storeOutboundMedia(await kirim.service.requireConsumer("spmb-api"), { deviceKode: "spmb", mime: "application/pdf", data: Buffer.from("%PDF-1.7"), truncated: false });
    const row = await pool.query<{ path: string }>("SELECT path FROM kirim_media WHERE id = $1", [media.media_id]);
    expect(row.rows[0]!.path).toMatch(/^\d{4}[\\/]\d{2}[\\/][0-9a-f-]{36}$/);
    expect(await readdir(mediaRoot)).toContain(String(new Date().getUTCFullYear()));
  });
});
