import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
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
import type { KirimConfig } from "../src/modules/kirim/config.js";
import { columnAad } from "../src/modules/kirim/crypto.js";
import { createKirimModule, pgEngineMediaRefs, type KirimModule } from "../src/modules/kirim/module.js";
import { JalurPesanProvider } from "../src/modules/kirim/providers/jalurpesan.js";
import { LogProvider } from "../src/modules/kirim/providers/log.js";
import type { KirimProvider, ProviderName } from "../src/modules/kirim/providers/types.js";
import { verifyKeyCanaries } from "../src/modules/kirim/service.js";
import { KirimSendWorker } from "../src/modules/kirim/worker.js";
import { JalurPesanStub, receiptPayload, receivedPayload, sentPayload } from "./kirim.fixture.js";

/** KIRIM-IMPL-002 §14: conversation API, officer replies, groups, J-1 messages, opt-outs, contacts. */

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for integration tests");

const pool = new Pool({ connectionString: databaseUrl });
const stub = new JalurPesanStub();
const AUDIENCE = "sq-hub-kirim";
const PHONE = "+6281234567890";
const GROUP_JID = "120363000000@g.us";
const OFFICER = { issuer: "https://akun.sabilulquran.or.id/realms/sq-staff", sub: "petugas-fatimah" };
const officerHeaders = { "x-kirim-atas-nama-issuer": OFFICER.issuer, "x-kirim-atas-nama-sub": OFFICER.sub };

let jwksServer: Server;
let issuer: string;
let privateKey: CryptoKey;
let mediaRoot: string;
let kirim: KirimModule;
let app: ReturnType<typeof buildApp>;
let providers: Record<ProviderName, KirimProvider>;
const logLines: string[] = [];
const kirimLogs: Array<Record<string, unknown>> = [];
const accessService = new ApplicationAccessService(new PgApplicationAccessRepository(pool));
let spmbDeviceId: string;

async function token(azp: string) {
  return new SignJWT({ azp })
    .setProtectedHeader({ alg: "RS256", kid: "kirim-test" })
    .setIssuer(issuer)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

async function call(method: "GET" | "POST" | "DELETE", url: string, options: { client?: string; payload?: unknown; key?: string; officer?: boolean } = {}) {
  return app.inject({
    method,
    url: `/internal/kirim${url}`,
    headers: {
      authorization: `Bearer ${await token(options.client ?? "spmb-api")}`,
      ...(options.officer === false ? {} : officerHeaders),
      ...(options.key ? { "idempotency-key": options.key } : {}),
    },
    ...(options.payload !== undefined ? { payload: options.payload as Record<string, unknown> } : {}),
  });
}

function worker() {
  return new KirimSendWorker(pool, kirim.crypto, kirim.service, providers, { random: () => 0, log: (entry) => kirimLogs.push(entry) });
}

async function pull() {
  await kirim.ingest!.runOnce();
}

async function webhookPayloads(type?: string) {
  const rows = await pool.query<{ id: string; payloadEnc: string; eventType: string; consumer: string }>(
    `SELECT d.id, d.payload_enc AS "payloadEnc", d.event_type AS "eventType", c.nama AS consumer
     FROM kirim_webhook_deliveries d JOIN kirim_consumers c ON c.id = d.consumer_id ORDER BY d.created_at, d.id`,
  );
  return rows.rows
    .filter((row) => !type || row.eventType === type)
    .map((row) => ({
      consumer: row.consumer,
      ...(JSON.parse(kirim.crypto.open(row.payloadEnc, columnAad("kirim_webhook_deliveries", "payload_enc", row.id))) as { type: string; data: Record<string, unknown> }),
    }));
}

/** A conversation with one inbound message, as the engine delivers it. */
async function inbound(body = "Assalamu'alaikum, mau tanya biaya SDIT", extra: Record<string, unknown> = {}) {
  stub.addEvent("spmb", "message.received", receivedPayload({ body, extra }));
  await pull();
  const row = await pool.query<{ id: string }>("SELECT id FROM kirim_conversations ORDER BY created_at DESC LIMIT 1");
  return row.rows[0]!.id;
}

async function allDay() {
  await pool.query("UPDATE kirim_devices SET jam_kirim_mulai = '00:00', jam_kirim_selesai = '23:59'");
}

/** A send window that is closed right now, to prove officer replies ignore it. */
async function closedWindow() {
  const hour = (new Date().getUTCHours() + 7) % 24;
  const start = (hour + 2) % 24;
  const window = start >= 22 ? ["00:00", "00:30"] : [`${String(start).padStart(2, "0")}:00`, `${String(start + 1).padStart(2, "0")}:00`];
  if (hour === 0) window.splice(0, 2, "02:00", "03:00");
  await pool.query("UPDATE kirim_devices SET jam_kirim_mulai = $1, jam_kirim_selesai = $2", window);
}

async function makeDue() {
  await pool.query("UPDATE kirim_outbox SET next_attempt_at = now() - interval '1 second' WHERE status = 'antre'");
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
  mediaRoot = await mkdtemp(join(tmpdir(), "kirim-r2-media-"));
  process.env.KIRIM_CONSUMER_SECRET_SPMB = "spmb-webhook-secret";
  process.env.KIRIM_CONSUMER_SECRET_KELUARGA = "keluarga-webhook-secret";
});

afterAll(async () => {
  await app?.close();
  await stub.stop();
  await new Promise<void>((resolve) => jwksServer.close(() => resolve()));
  await rm(mediaRoot, { recursive: true, force: true });
  await pool.end();
});

beforeEach(async () => {
  await pool.query(`TRUNCATE kirim_audit, kirim_admins, kirim_webhook_deliveries, kirim_events, kirim_optouts, kirim_media_engine_refs, kirim_history_imports,
    kirim_outbox, kirim_messages, kirim_media, kirim_groups, kirim_conversations, kirim_routes, kirim_devices, kirim_consumers, kirim_key_canaries CASCADE`);
  stub.reset();
  stub.addTenant("spmb");
  logLines.length = 0;
  kirimLogs.length = 0;

  const config: KirimConfig = {
    tokenAudience: AUDIENCE,
    dataKeys: [{ kid: "k1", key: randomBytes(32) }],
    lookupKey: randomBytes(32),
    mediaRoot,
    inboundMediaMaxBytes: 64 * 1024,
    workerIntervalMs: 2000,
    eventPullIntervalMs: 60000,
    jalurpesan: { baseUrl: stub.baseUrl, platformKey: "platform-key", webhookSecret: "jp-webhook-secret" },
    admin: null,
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
    providers,
    webhookTransport: async () => ({ status: 200 }),
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

  const consumer = async (nama: string, clientId: string, ref: string | null, quota = 500) => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO kirim_consumers (id, client_id, nama, webhook_url, webhook_secret_ref, kuota_harian) VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, clientId, nama, ref ? "http://127.0.0.1:3303/kirim/webhook" : null, ref, quota],
    );
    return id;
  };
  const spmb = await consumer("spmb", "spmb-api", "KIRIM_CONSUMER_SECRET_SPMB", 1);
  const hcis = await consumer("hcis", "hcis-api", null);
  const keluarga = await consumer("keluarga", "keluarga-api", "KIRIM_CONSUMER_SECRET_KELUARGA");
  spmbDeviceId = randomUUID();
  await pool.query(
    `INSERT INTO kirim_devices (id, kode, label, pemilik_consumer_id, provider, provider_ref, status) VALUES
       ($1, 'spmb', 'SPMB resmi', $2, 'jalurpesan', 'spmb', 'tersambung'),
       ($3, 'hcis', 'HCIS', $4, 'log', NULL, 'tersambung')`,
    [spmbDeviceId, spmb, randomUUID(), hcis],
  );
  await pool.query("INSERT INTO kirim_routes (consumer_id, device_id, jenis) VALUES ($1, $2, 'kode'), ($1, $2, 'notifikasi')", [keluarga, spmbDeviceId]);
  // The engine tells Kirim SQ which number is linked; the group admin check needs it.
  await kirim.ingest!.refreshStatus({ id: spmbDeviceId, kode: "spmb", providerRef: "spmb", pemilikConsumerId: spmb, status: "tersambung" } as never);
});

describe("access (§3, §11)", () => {
  it("serves only the number's owner and always needs the officer", async () => {
    const id = await inbound();
    expect((await call("GET", "/devices/spmb/conversations", { client: "hcis-api" })).statusCode).toBe(403);
    // Keluarga SQ may send codes through `spmb` but may not read it.
    const routed = await call("GET", "/devices/spmb/conversations", { client: "keluarga-api" });
    expect(routed.statusCode).toBe(403);
    expect(routed.json().error.code).toBe("not_owner");
    expect((await call("GET", `/conversations/${id}/messages`, { client: "hcis-api" })).statusCode).toBe(404);
    const withoutOfficer = await call("GET", "/devices/spmb/conversations", { officer: false });
    expect(withoutOfficer.statusCode).toBe(400);
    expect(withoutOfficer.json().error.code).toBe("atas_nama_required");
    const replyWithoutOfficer = await call("POST", `/conversations/${id}/messages`, { key: "k", payload: { text: "x" } });
    expect(replyWithoutOfficer.json().error.code).toBe("atas_nama_required");
  });
});

describe("reading conversations (§6.1)", () => {
  it("lists conversations newest first with full number and body, and masks codes", async () => {
    const id = await inbound("Assalamu'alaikum, mau tanya biaya SDIT", { pushName: "Rina" });
    await allDay();
    await call("POST", "/messages", { client: "keluarga-api", key: "kode-1", payload: { device: "spmb", jenis: "kode", to: PHONE, text: "Kode Anda 481702" } });
    const list = await call("GET", "/devices/spmb/conversations");
    expect(list.statusCode).toBe(200);
    const [item] = list.json().items;
    expect(item).toMatchObject({ id, kontak: { nomor: PHONE, jenis: "pn" }, nama_profil: "Rina", belum_dibaca: 1, jangan_hubungi: false });
    expect(item.pesan_terakhir).toMatchObject({ arah: "keluar", asal: "otomatis", cuplikan: null, disamarkan: true });
    const messages = await call("GET", `/conversations/${id}/messages`);
    expect(messages.json().items.map((message: { isi: string | null }) => message.isi)).toEqual([null, "Assalamu'alaikum, mau tanya biaya SDIT"]);
    expect(messages.json().items[0]).toMatchObject({ dikirim_oleh: "keluarga", disamarkan: true });
    expect((await call("GET", `/devices/spmb/conversations?kontak=0812-3456-7890`)).json().items).toHaveLength(1);
    expect((await call("GET", `/devices/spmb/conversations?kontak=081299999999`)).json().items).toHaveLength(0);
  });

  it("pages with a stable cursor", async () => {
    for (let index = 0; index < 3; index += 1) {
      stub.addEvent("spmb", "message.received", receivedPayload({ from: `62812000000${index}@s.whatsapp.net`, body: `pesan ${index}` }));
    }
    await pull();
    const first = await call("GET", "/devices/spmb/conversations?batas=2");
    expect(first.json().items).toHaveLength(2);
    stub.addEvent("spmb", "message.received", receivedPayload({ from: "6281200000009@s.whatsapp.net", body: "baru" }));
    await pull();
    const second = await call("GET", `/devices/spmb/conversations?batas=2&setelah=${first.json().setelah}`);
    expect(second.json().items).toHaveLength(1);
    expect(second.json().setelah).toBeNull();
    expect((await call("GET", "/devices/spmb/conversations?setelah=rusak")).statusCode).toBe(400);
  });

  it("audits reading once per officer per conversation per 15 minutes", async () => {
    const id = await inbound();
    await call("GET", `/conversations/${id}/messages`);
    await call("GET", `/conversations/${id}/messages`);
    const rows = await pool.query<{ count: string }>("SELECT count(*) AS count FROM kirim_audit WHERE aksi = 'percakapan.baca'");
    expect(rows.rows[0]!.count).toBe("1");
    const audit = await pool.query<{ metadata: unknown; atasNama: string }>(`SELECT metadata, atas_nama AS "atasNama" FROM kirim_audit WHERE aksi = 'percakapan.baca'`);
    expect(audit.rows[0]!.atasNama).toBe(`${OFFICER.issuer} ${OFFICER.sub}`);
    expect(JSON.stringify(audit.rows[0]!.metadata)).not.toContain("biaya");
  });

  it("opens a conversation without sending, once per number", async () => {
    const first = await call("POST", "/devices/spmb/conversations", { payload: { to: "0812 3456 7890", atas_nama: OFFICER } });
    expect(first.statusCode).toBe(201);
    const second = await call("POST", "/devices/spmb/conversations", { payload: { to: PHONE, atas_nama: OFFICER } });
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);
    expect(stub.requests.filter((request) => request.path.endsWith("/messages"))).toHaveLength(0);
  });
});

describe("officer replies (§5)", () => {
  it("queues ahead of automatic messages, ignores the send window and the daily quota, and is idempotent", async () => {
    const id = await inbound();
    await closedWindow();
    // spmb has a daily quota of 1: the automatic message uses it, the reply must not need it.
    await call("POST", "/messages", { key: "auto-1", payload: { device: "spmb", jenis: "notifikasi", to: "+6281200000001", text: "Pengingat" } });
    const reply = await call("POST", `/conversations/${id}/messages`, { key: "balas-1", payload: { text: "Wa'alaikumsalam, biaya SDIT …", atas_nama: OFFICER, ref: "spmb:lead-1" } });
    expect(reply.statusCode).toBe(202);
    const again = await call("POST", `/conversations/${id}/messages`, { key: "balas-1", payload: { text: "Wa'alaikumsalam, biaya SDIT …", atas_nama: OFFICER, ref: "spmb:lead-1" } });
    expect(again.json().id).toBe(reply.json().id);
    const conflict = await call("POST", `/conversations/${id}/messages`, { key: "balas-1", payload: { text: "lain", atas_nama: OFFICER } });
    expect(conflict.statusCode).toBe(409);
    const outbox = await pool.query<{ prioritas: string; expiresAt: Date; createdAt: Date }>(
      `SELECT prioritas, expires_at AS "expiresAt", created_at AS "createdAt" FROM kirim_outbox WHERE message_id = $1`,
      [reply.json().id],
    );
    expect(outbox.rows[0]!.prioritas).toBe("petugas");
    expect(Math.round((outbox.rows[0]!.expiresAt.getTime() - outbox.rows[0]!.createdAt.getTime()) / 3_600_000)).toBe(72);
    await worker().runOnce();
    const sent = stub.requests.filter((request) => request.path.endsWith("/messages") && request.method === "POST");
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!.body)).toEqual({ to: "6281234567890", message: "Wa'alaikumsalam, biaya SDIT …" });
    const messages = await call("GET", `/conversations/${id}/messages`);
    expect(messages.json().items[0]).toMatchObject({ asal: "petugas", petugas: OFFICER, dikirim_oleh: "spmb", status: "diserahkan" });
  });

  it("refuses an opted-out number unless the person wrote in the last 24 hours", async () => {
    const id = await inbound();
    await call("POST", "/optouts", { payload: { nomor: PHONE, cakupan: "device", device: "spmb", alasan: "Minta tidak dihubungi" } });
    expect((await call("POST", `/conversations/${id}/messages`, { key: "a", payload: { text: "x", atas_nama: OFFICER } })).statusCode).toBe(202);
    expect((await call("GET", `/conversations/${id}`)).json()).toMatchObject({ jangan_hubungi: true, bisa_dibalas_sampai: expect.any(String) });
    await pool.query("UPDATE kirim_conversations SET pesan_masuk_terakhir_at = now() - interval '24 hours 1 minute'");
    const refused = await call("POST", `/conversations/${id}/messages`, { key: "b", payload: { text: "x", atas_nama: OFFICER } });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.code).toBe("optout");
  });

  it("sends a JPEG as an image and lets the owner download media", async () => {
    const id = await inbound();
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("foto brosur")]);
    const boundary = "kirimboundary";
    const multipart = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="device"\r\n\r\nspmb\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="brosur.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      jpeg,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const uploaded = await app.inject({
      method: "POST",
      url: "/internal/kirim/media",
      headers: { authorization: `Bearer ${await token("spmb-api")}`, "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: multipart,
    });
    expect(uploaded.statusCode).toBe(201);
    const reply = await call("POST", `/conversations/${id}/messages`, { key: "img", payload: { media_id: uploaded.json().media_id, caption: "Brosur SDIT", atas_nama: OFFICER } });
    expect(reply.statusCode).toBe(202);
    await worker().runOnce();
    expect(stub.uploadTypes).toEqual(["image"]);
    const download = await call("GET", `/media/${uploaded.json().media_id}`);
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toBe("image/jpeg");
    expect(download.rawPayload.equals(jpeg)).toBe(true);
    expect((await call("GET", `/media/${uploaded.json().media_id}`, { client: "hcis-api" })).statusCode).toBe(404);
  });

  it("replies to a LID contact by its JID", async () => {
    stub.addEvent("spmb", "message.received", receivedPayload({ from: "99887766554433@lid", body: "dari lid" }));
    await pull();
    const id = (await pool.query<{ id: string }>("SELECT id FROM kirim_conversations WHERE kontak_jenis = 'lid'")).rows[0]!.id;
    await call("POST", `/conversations/${id}/messages`, { key: "lid", payload: { text: "Halo", atas_nama: OFFICER } });
    await worker().runOnce();
    const sent = stub.requests.find((request) => request.path.endsWith("/messages") && request.method === "POST");
    expect(JSON.parse(sent!.body)).toEqual({ toJid: "99887766554433@lid", message: "Halo" });
  });
});

describe("read receipts (§6.1)", () => {
  it("clears the unread count and sends receipts only for messages with a WhatsApp id", async () => {
    const id = await inbound();
    stub.addEvent("spmb", "message.received", receivedPayload({ body: "satu lagi", whatsappMessageId: "WA-2" }));
    await pull();
    const messages = (await call("GET", `/conversations/${id}/messages`)).json().items;
    const read = await call("POST", `/conversations/${id}/read`, { payload: { atas_nama: OFFICER, sampai_message_id: messages[0].id } });
    expect(read.json()).toEqual({ mesin: "berhasil" });
    expect(stub.reads).toHaveLength(2);
    expect(stub.reads[1]).toEqual({ remoteJid: "6281234567890@s.whatsapp.net", whatsappMessageId: "WA-2" });
    expect((await call("GET", `/conversations/${id}`)).json().belum_dibaca).toBe(0);
    // Marking again sends nothing new.
    expect((await call("POST", `/conversations/${id}/read`, { payload: { atas_nama: OFFICER, sampai_message_id: messages[0].id } })).json()).toEqual({ mesin: "tidak_ada" });
  });
});

describe("events to the number's owner (§7)", () => {
  it("tells the owner about another module's messages and their status, without that module's ref", async () => {
    await allDay();
    const created = await call("POST", "/messages", { client: "keluarga-api", key: "kode-2", payload: { device: "spmb", jenis: "kode", to: PHONE, text: "Kode 123456", ref: "keluarga:otp:1" } });
    await worker().runOnce();
    const sent = (await webhookPayloads("message.sent")).filter((event) => event.consumer === "spmb");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.data).toMatchObject({ asal: "otomatis", dikirim_oleh: "keluarga", cuplikan: null, disamarkan: true });
    const statuses = await webhookPayloads("message.status");
    expect(statuses.filter((event) => event.consumer === "keluarga").map((event) => event.data.ref)).toEqual(["keluarga:otp:1"]);
    const owner = statuses.filter((event) => event.consumer === "spmb");
    expect(owner).toHaveLength(1);
    expect(owner[0]!.data).toMatchObject({ id: created.json().id, status: "diserahkan", ref: null, conversation_id: expect.any(String) });
  });

  it("stores messages typed on the phone (J-1), clears unread, and never duplicates an API send", async () => {
    const id = await inbound();
    stub.addEvent("spmb", "message.sent", sentPayload({ body: "Dibalas dari HP", whatsappMessageId: "WA-HP-1" }));
    await pull();
    const conversation = (await call("GET", `/conversations/${id}`)).json();
    expect(conversation.belum_dibaca).toBe(0);
    expect(conversation.pesan_terakhir).toMatchObject({ asal: "hp", cuplikan: "Dibalas dari HP" });
    expect((await webhookPayloads("message.sent")).at(-1)!.data).toMatchObject({ asal: "hp", conversation_id: id });
    stub.addEvent("spmb", "message.read", receiptPayload("WA-HP-1", "read"));
    await pull();
    expect((await call("GET", `/conversations/${id}`)).json().pesan_terakhir.status).toBe("dibaca");

    await call("POST", `/conversations/${id}/messages`, { key: "api", payload: { text: "lewat API", atas_nama: OFFICER } });
    await worker().runOnce();
    const whatsappId = [...stub.messageIdByKey.values()].at(-1)!;
    stub.addEvent("spmb", "message.sent", sentPayload({ body: "lewat API", whatsappMessageId: whatsappId }));
    await pull();
    const outbound = await pool.query<{ count: string }>("SELECT count(*) AS count FROM kirim_messages WHERE arah = 'keluar'");
    expect(outbound.rows[0]!.count).toBe("2");
  });
});

describe("groups (§6.2)", () => {
  it("keeps group messages in groups, names them from the engine, and replies to the group", async () => {
    stub.groups.set("spmb", [{ id: GROUP_JID, subject: "Calon Wali SDIT 2027", size: 41, participants: [{ jid: "6281200001111@s.whatsapp.net", admin: "admin" }] }]);
    stub.addEvent("spmb", "message.received", receivedPayload({ group: true, body: "Kapan tes masuk?" }));
    await pull();
    expect((await pool.query("SELECT 1 FROM kirim_conversations")).rowCount).toBe(0);
    const groups = (await call("GET", "/devices/spmb/groups")).json().items;
    expect(groups).toEqual([expect.objectContaining({ nama: "Calon Wali SDIT 2027", jumlah_anggota: 41, nomor_ini_admin: true, belum_dibaca: 1 })]);
    const event = (await webhookPayloads("group.message.received"))[0]!;
    expect(event.data).toMatchObject({ group_id: groups[0].id, pengirim: { nomor: "+6289999999999" }, cuplikan: "Kapan tes masuk?", menyebut_nomor_ini: null });
    const messages = (await call("GET", `/groups/${groups[0].id}/messages`)).json().items;
    expect(messages[0]).toMatchObject({ isi: "Kapan tes masuk?", pengirim: { nomor: "+6289999999999" } });

    const reply = await call("POST", `/groups/${groups[0].id}/messages`, { key: "grup-1", payload: { text: "Tes masuk 12 Januari", atas_nama: OFFICER } });
    expect(reply.statusCode).toBe(202);
    await worker().runOnce();
    const sent = stub.requests.find((request) => request.path.includes("/groups/") && request.method === "POST");
    expect(JSON.parse(sent!.body)).toEqual({ message: "Tes masuk 12 Januari" });
    await call("POST", `/groups/${groups[0].id}/read`, { payload: { atas_nama: OFFICER, sampai_message_id: messages[0].id } });
    expect((await call("GET", `/groups/${groups[0].id}`)).json().belum_dibaca).toBe(0);

    stub.groups.set("spmb", []);
    await kirim.ingest!.refreshDirectory("groups");
    expect((await call("GET", "/devices/spmb/groups")).json().items).toHaveLength(0);
  });
});

describe("opt-outs (§8)", () => {
  it("lets only the owner create a device opt-out, which stops other modules, and withdraw only its own", async () => {
    await allDay();
    expect((await call("POST", "/optouts", { client: "keluarga-api", payload: { nomor: PHONE, cakupan: "device", device: "spmb", alasan: "x" } })).statusCode).toBe(403);
    expect((await call("POST", "/optouts", { payload: { nomor: PHONE, cakupan: "device", device: "spmb", alasan: "Jangan hubungi" } })).json()).toEqual({ cakupan: "device", dibuat: true });
    const notice = await call("POST", "/messages", { client: "keluarga-api", key: "n1", payload: { device: "spmb", jenis: "notifikasi", to: PHONE, text: "Info" } });
    expect(notice.json().error.code).toBe("optout");
    const code = await call("POST", "/messages", { client: "keluarga-api", key: "n2", payload: { device: "spmb", jenis: "kode", to: PHONE, text: "Kode 1" } });
    expect(code.statusCode).toBe(202);
    expect((await call("DELETE", "/optouts", { client: "keluarga-api", payload: { nomor: PHONE, cakupan: "consumer", alasan: "x" } })).statusCode).toBe(404);
    expect((await call("DELETE", "/optouts", { payload: { nomor: PHONE, cakupan: "device", device: "spmb", alasan: "Minta dihubungi lagi" } })).json()).toEqual({ dicabut: true });
    expect((await call("POST", "/messages", { client: "keluarga-api", key: "n3", payload: { device: "spmb", jenis: "notifikasi", to: PHONE, text: "Info" } })).statusCode).toBe(202);
  });
});

describe("contacts (§9)", () => {
  it("learns a LID contact's number and profile name", async () => {
    stub.addEvent("spmb", "message.received", receivedPayload({ from: "99887766554433@lid", body: "dari lid" }));
    await pull();
    stub.contacts.set("spmb", [{ jid: "99887766554433@lid", canonicalJid: "6281277778888@s.whatsapp.net", displayName: "Pak Budi" }]);
    await kirim.ingest!.refreshDirectory("contacts");
    const [item] = (await call("GET", "/devices/spmb/conversations")).json().items;
    expect(item).toMatchObject({ kontak: { nomor: "+6281277778888", jenis: "lid" }, nama_profil: "Pak Budi" });
    const opened = await call("POST", "/devices/spmb/conversations", { payload: { to: "081277778888", atas_nama: OFFICER } });
    expect(opened.statusCode).toBe(200);
    expect(opened.json().id).toBe(item.id);
    stub.addEvent("spmb", "message.received", receivedPayload({ from: "99887766554433@lid", body: "lagi" }));
    await pull();
    expect((await webhookPayloads("message.received")).at(-1)!.data.from).toBe("+6281277778888");
  });
});

describe("privacy (§11)", () => {
  it("never logs bodies, full numbers, officer ids or profile names", async () => {
    const id = await inbound("Rahasia keluarga Rina", { pushName: "Rina Lestari" });
    await call("GET", `/conversations/${id}/messages`);
    await call("POST", `/conversations/${id}/messages`, { key: "p", payload: { text: "Balasan rahasia", atas_nama: OFFICER } });
    await makeDue();
    await worker().runOnce();
    const output = logLines.join("\n") + JSON.stringify(kirimLogs);
    expect(logLines.length).toBeGreaterThan(0);
    for (const secret of ["Rahasia keluarga", "Balasan rahasia", "6281234567890", "petugas-fatimah", "Rina Lestari"]) expect(output).not.toContain(secret);
  });
});
