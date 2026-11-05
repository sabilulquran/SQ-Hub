import { randomBytes, randomUUID } from "node:crypto";
import { access, mkdtemp, rm } from "node:fs/promises";
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
import { JalurPesanStub, receivedPayload } from "./kirim.fixture.js";

/** KIRIM-IMPL-004 §14: quotes, forwards, edits, deletes, reactions, calls, photos, grup bersama and R3 groups. */

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for integration tests");

const pool = new Pool({ connectionString: databaseUrl });
const stub = new JalurPesanStub();
const AUDIENCE = "sq-hub-kirim";
const PHONE = "+6281234567890";
const CONTACT_JID = "6281234567890@s.whatsapp.net";
const CONTACT_LID = "123456789012345@lid";
const GROUP_JID = "120363000000@g.us";
const OFFICER = { issuer: "https://akun.sabilulquran.or.id/realms/sq-staff", sub: "petugas-fatimah" };
const officerHeaders = { "x-kirim-atas-nama-issuer": OFFICER.issuer, "x-kirim-atas-nama-sub": OFFICER.sub };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("foto profil kecil")]);

let jwksServer: Server;
let issuer: string;
let privateKey: CryptoKey;
let mediaRoot: string;
let kirim: KirimModule;
let app: ReturnType<typeof buildApp>;
let providers: Record<ProviderName, KirimProvider>;
const logLines: string[] = [];
const accessService = new ApplicationAccessService(new PgApplicationAccessRepository(pool));

async function token(azp: string) {
  return new SignJWT({ azp, client_id: azp })
    .setProtectedHeader({ alg: "RS256", kid: "kirim-test" })
    .setIssuer(issuer)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

async function call(
  method: "GET" | "POST" | "PATCH",
  url: string,
  options: { client?: string; payload?: unknown; key?: string; headers?: Record<string, string> } = {},
) {
  return app.inject({
    method,
    url: `/internal/kirim${url}`,
    headers: {
      authorization: `Bearer ${await token(options.client ?? "spmb-api")}`,
      ...officerHeaders,
      ...(options.key ? { "idempotency-key": options.key } : {}),
      ...options.headers,
    },
    ...(options.payload !== undefined ? { payload: options.payload as Record<string, unknown> } : {}),
  });
}

async function send() {
  await pool.query("UPDATE kirim_outbox SET next_attempt_at = now() - interval '1 second' WHERE status = 'antre'");
  await new KirimSendWorker(pool, kirim.crypto, kirim.service, providers, { random: () => 0 }).runOnce();
}

async function pull() {
  await kirim.ingest!.runOnce();
}

async function webhooks(type: string) {
  const rows = await pool.query<{ id: string; payloadEnc: string; eventType: string }>(
    `SELECT id, payload_enc AS "payloadEnc", event_type AS "eventType" FROM kirim_webhook_deliveries WHERE event_type = $1 ORDER BY created_at, id`,
    [type],
  );
  return rows.rows.map((row) => JSON.parse(kirim.crypto.open(row.payloadEnc, columnAad("kirim_webhook_deliveries", "payload_enc", row.id))) as { data: Record<string, unknown> });
}

/** An inbound private message; returns its conversation, message id and WhatsApp id. */
async function inbound(body = "Assalamu'alaikum, mau tanya biaya SDIT", extra: Record<string, unknown> = {}, from = CONTACT_JID) {
  const whatsappMessageId = `WA-${randomUUID()}`;
  stub.addEvent("spmb", "message.received", receivedPayload({ from, body, whatsappMessageId, extra }));
  await pull();
  const row = await pool.query<{ id: string; conversationId: string }>(
    `SELECT id, conversation_id AS "conversationId" FROM kirim_messages WHERE wa_message_id = $1`,
    [whatsappMessageId],
  );
  return { conversationId: row.rows[0]!.conversationId, messageId: row.rows[0]!.id, whatsappMessageId };
}

/** An officer reply that has been handed to WhatsApp; returns its id and WhatsApp id. */
async function sentReply(conversationId: string, text = "Wa'alaikumsalam, biayanya …") {
  const reply = await call("POST", `/conversations/${conversationId}/messages`, { key: `r-${randomUUID()}`, payload: { text, atas_nama: OFFICER } });
  expect(reply.statusCode).toBe(202);
  await send();
  const row = await pool.query<{ waMessageId: string }>(`SELECT wa_message_id AS "waMessageId" FROM kirim_messages WHERE id = $1`, [reply.json().id]);
  return { id: reply.json().id as string, whatsappMessageId: row.rows[0]!.waMessageId };
}

function lastSendBody() {
  const sends = stub.requests.filter((request) => request.method === "POST" && /\/(messages|groups\/[^/]+\/messages)$/.test(request.path) && !request.path.endsWith("/read"));
  return JSON.parse(sends.at(-1)!.body) as Record<string, unknown>;
}

async function messages(conversationId: string) {
  return (await call("GET", `/conversations/${conversationId}/messages`)).json().items as Array<Record<string, unknown>>;
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
  mediaRoot = await mkdtemp(join(tmpdir(), "kirim-k32-media-"));
  process.env.KIRIM_CONSUMER_SECRET_SPMB = "spmb-webhook-secret";
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
    kirim_message_edits, kirim_group_members, kirim_profile_photos, kirim_group_additions,
    kirim_outbox, kirim_messages, kirim_media, kirim_groups, kirim_conversations, kirim_routes, kirim_devices, kirim_consumers, kirim_key_canaries CASCADE`);
  stub.reset();
  stub.addTenant("spmb");
  logLines.length = 0;

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
    editWindowMinutes: 15,
    deleteWindowHours: 48,
    groupAddLimitPerHour: 20,
  };
  providers = {
    log: new LogProvider(),
    jalurpesan: new JalurPesanProvider({ baseUrl: stub.baseUrl, platformKey: "platform-key", timeoutMs: 500 }, pgEngineMediaRefs(pool)),
  };
  kirim = createKirimModule({ pool, config, keycloakIssuer: issuer, access: accessService, providers, webhookTransport: async () => ({ status: 200 }) });
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
  const spmb = randomUUID();
  const hcis = randomUUID();
  await pool.query(
    `INSERT INTO kirim_consumers (id, client_id, nama, webhook_url, webhook_secret_ref) VALUES
       ($1, 'spmb-api', 'spmb', 'http://127.0.0.1:3303/kirim/webhook', 'KIRIM_CONSUMER_SECRET_SPMB'),
       ($2, 'hcis-api', 'hcis', NULL, NULL)`,
    [spmb, hcis],
  );
  const deviceId = randomUUID();
  await pool.query(
    `INSERT INTO kirim_devices (id, kode, label, pemilik_consumer_id, provider, provider_ref, status, jam_kirim_mulai, jam_kirim_selesai) VALUES
       ($1, 'spmb', 'SPMB resmi', $2, 'jalurpesan', 'spmb', 'tersambung', '00:00', '23:59'),
       ($3, 'hcis', 'HCIS', $4, 'log', NULL, 'tersambung', '00:00', '23:59')`,
    [deviceId, spmb, randomUUID(), hcis],
  );
  await kirim.ingest!.refreshStatus({ id: deviceId, kode: "spmb", providerRef: "spmb", pemilikConsumerId: spmb, status: "tersambung" } as never);
  stub.groups.set("spmb", [{
    id: GROUP_JID,
    subject: "Wali murid kelas 1A",
    size: 3,
    participants: [
      { jid: "6281200001111@s.whatsapp.net", admin: "superadmin" },
      { jid: CONTACT_LID, admin: "admin", phoneJid: CONTACT_JID, lidJid: CONTACT_LID },
      { jid: "6289999999999@s.whatsapp.net", admin: null },
    ],
  }]);
});

describe("reply with a quote (§5.1)", () => {
  it("sends the quoted WhatsApp id, sender and text, and shows the quote in the list", async () => {
    const { conversationId, messageId, whatsappMessageId } = await inbound("Berapa biaya SDIT?");
    const reply = await call("POST", `/conversations/${conversationId}/messages`, {
      key: "kutip-1",
      payload: { text: "Biaya SDIT …", atas_nama: OFFICER, kutip_message_id: messageId },
    });
    expect(reply.statusCode).toBe(202);
    await send();
    expect(lastSendBody()).toEqual({
      to: "6281234567890",
      message: "Biaya SDIT …",
      quoted: { id: whatsappMessageId, fromMe: false, text: "Berapa biaya SDIT?", messageType: "text" },
    });
    const [item] = await messages(conversationId);
    expect(item).toMatchObject({ id: reply.json().id, kutipan: { id: messageId, arah: "masuk", tipe: "teks", cuplikan: "Berapa biaya SDIT?", dihapus: false }, diteruskan: false });
  });

  it("names the group member who wrote the quoted group message", async () => {
    stub.addEvent("spmb", "message.received", receivedPayload({ group: true, body: "Besok libur?", whatsappMessageId: "WA-GRUP-1" }));
    await pull();
    const row = await pool.query<{ id: string; groupId: string }>(`SELECT id, group_id AS "groupId" FROM kirim_messages WHERE wa_message_id = 'WA-GRUP-1'`);
    const { id, groupId } = row.rows[0]!;
    expect((await call("POST", `/groups/${groupId}/messages`, { key: "g-1", payload: { text: "Tidak", atas_nama: OFFICER, kutip_message_id: id } })).statusCode).toBe(202);
    await send();
    expect(lastSendBody().quoted).toEqual({ id: "WA-GRUP-1", fromMe: false, participant: "6289999999999@s.whatsapp.net", text: "Besok libur?", messageType: "text" });
  });

  it("refuses a quote from another conversation, of a message WhatsApp does not know, or of a deleted message", async () => {
    const first = await inbound("pesan A");
    const second = await inbound("pesan B", {}, "6281200000002@s.whatsapp.net");
    const other = await call("POST", `/conversations/${first.conversationId}/messages`, { key: "q1", payload: { text: "x", atas_nama: OFFICER, kutip_message_id: second.messageId } });
    expect(other.statusCode).toBe(422);
    expect(other.json().error.code).toBe("quote_invalid");
    const queued = await call("POST", `/conversations/${first.conversationId}/messages`, { key: "q2", payload: { text: "belum terkirim", atas_nama: OFFICER } });
    const unknown = await call("POST", `/conversations/${first.conversationId}/messages`, { key: "q3", payload: { text: "x", atas_nama: OFFICER, kutip_message_id: queued.json().id } });
    expect(unknown.json().error.code).toBe("quote_unavailable");
    await pool.query("UPDATE kirim_messages SET deleted_at = now(), deleted_by = 'pengirim' WHERE id = $1", [first.messageId]);
    const deleted = await call("POST", `/conversations/${first.conversationId}/messages`, { key: "q4", payload: { text: "x", atas_nama: OFFICER, kutip_message_id: first.messageId } });
    expect(deleted.statusCode).toBe(409);
    expect(deleted.json().error.code).toBe("message_deleted");
  });
});

describe("forward (§5.2)", () => {
  it("copies text to another chat of the number with the Diteruskan label, and refuses opted-out targets", async () => {
    const source = await inbound("Info pendaftaran gelombang 2");
    const target = (await call("POST", "/devices/spmb/conversations", { payload: { to: "081200000002", atas_nama: OFFICER } })).json().id as string;
    const forwarded = await call("POST", `/messages/${source.messageId}/teruskan`, { key: "fw-1", payload: { ke: { conversation_id: target }, atas_nama: OFFICER } });
    expect(forwarded.statusCode).toBe(202);
    const again = await call("POST", `/messages/${source.messageId}/teruskan`, { key: "fw-1", payload: { ke: { conversation_id: target }, atas_nama: OFFICER } });
    expect(again.json().id).toBe(forwarded.json().id);
    await send();
    expect(lastSendBody()).toEqual({ to: "6281200000002", message: "Info pendaftaran gelombang 2", forwarded: true });
    expect((await messages(target))[0]).toMatchObject({ diteruskan: true, asal: "petugas", petugas: OFFICER, isi: "Info pendaftaran gelombang 2" });
    const audit = await pool.query<{ objekRef: string }>(`SELECT objek_ref AS "objekRef" FROM kirim_audit WHERE aksi = 'pesan.teruskan'`);
    expect(audit.rows.map((row) => row.objekRef)).toEqual([source.messageId]);

    await call("POST", "/optouts", { payload: { nomor: "+6281200000002", cakupan: "device", device: "spmb", alasan: "Minta tidak dihubungi" } });
    const refused = await call("POST", `/messages/${source.messageId}/teruskan`, { key: "fw-2", payload: { ke: { conversation_id: target }, atas_nama: OFFICER } });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.code).toBe("optout");
  });

  it("re-sends a stored JPEG as an image to a group", async () => {
    const engineMedia = randomUUID();
    stub.media.set(engineMedia, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("brosur")]));
    const whatsappMessageId = "WA-FOTO-1";
    stub.addEvent("spmb", "message.received", receivedPayload({ body: "brosur", whatsappMessageId, media: { id: engineMedia, sizeBytes: 10, mimeType: "image/jpeg" }, extra: { messageType: "image" } }));
    await pull();
    await kirim.ingest!.refreshDirectory("groups");
    const source = (await pool.query<{ id: string }>("SELECT id FROM kirim_messages WHERE wa_message_id = $1", [whatsappMessageId])).rows[0]!.id;
    const groupId = (await pool.query<{ id: string }>("SELECT id FROM kirim_groups")).rows[0]!.id;
    expect((await call("POST", `/messages/${source}/teruskan`, { key: "fw-g", payload: { ke: { group_id: groupId }, atas_nama: OFFICER } })).statusCode).toBe(202);
    await send();
    expect(stub.uploadTypes).toEqual(["image"]);
    expect(lastSendBody()).toMatchObject({ caption: "brosur", forwarded: true, mediaId: expect.any(String) });
  });
});

describe("edit, delete for everyone, reaction (§5.3–§5.5)", () => {
  it("edits this number's own text within the window and keeps the old text", async () => {
    const { conversationId, messageId: inboundId } = await inbound();
    const mine = await sentReply(conversationId, "Biaya Rp 1.500.000");
    const edited = await call("POST", `/messages/${mine.id}/edit`, { key: "e-1", payload: { text: "Biaya Rp 1.250.000", atas_nama: OFFICER } });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({ isi: "Biaya Rp 1.250.000", diedit_at: expect.any(String) });
    expect(stub.actions.at(-1)).toMatchObject({ action: "edit", whatsappMessageId: mine.whatsappMessageId, body: { to: "6281234567890", message: "Biaya Rp 1.250.000" } });
    expect(stub.actions.at(-1)!.idempotencyKey).toMatch(/^kirim-aksi:[0-9a-f]{48}$/);
    // The same edit again changes nothing and does not call the engine.
    await call("POST", `/messages/${mine.id}/edit`, { key: "e-1", payload: { text: "Biaya Rp 1.250.000", atas_nama: OFFICER } });
    expect(stub.actions.filter((action) => action.action === "edit")).toHaveLength(1);
    const history = await call("GET", `/messages/${mine.id}/riwayat-edit`);
    expect(history.json().items).toEqual([{ isi: "Biaya Rp 1.500.000", diganti_at: expect.any(String), diganti_oleh: { jenis: "petugas", petugas: OFFICER } }]);
    const stored = await pool.query<{ bodyEnc: string }>(`SELECT body_enc AS "bodyEnc" FROM kirim_message_edits`);
    expect(stored.rows[0]!.bodyEnc).not.toContain("1.500.000");

    const notOwn = await call("POST", `/messages/${inboundId}/edit`, { key: "e-2", payload: { text: "x", atas_nama: OFFICER } });
    expect([notOwn.statusCode, notOwn.json().error.code]).toEqual([422, "not_own_message"]);
    await pool.query("UPDATE kirim_messages SET provider_at = now() - interval '16 minutes' WHERE id = $1", [mine.id]);
    const late = await call("POST", `/messages/${mine.id}/edit`, { key: "e-3", payload: { text: "terlambat", atas_nama: OFFICER } });
    expect([late.statusCode, late.json().error.code]).toEqual([422, "edit_window_passed"]);
  });

  it("maps engine refusals and refuses a message not yet sent", async () => {
    const { conversationId } = await inbound();
    const mine = await sentReply(conversationId);
    stub.actionQueue.push({ status: 429, body: { code: "minute_limit" } });
    const limited = await call("POST", `/messages/${mine.id}/edit`, { key: "e-4", payload: { text: "baru", atas_nama: OFFICER } });
    expect([limited.statusCode, limited.json().error.code, limited.json().error.alasan]).toEqual([429, "engine_rate_limited", "minute_limit"]);
    stub.actionQueue.push({ status: 503, body: { error: "WhatsApp is not connected" } });
    expect((await call("POST", `/messages/${mine.id}/edit`, { key: "e-5", payload: { text: "baru", atas_nama: OFFICER } })).json().error.code).toBe("engine_unavailable");
    stub.actionQueue.push({ status: 400, body: { error: "Invalid" } });
    expect((await call("POST", `/messages/${mine.id}/edit`, { key: "e-6", payload: { text: "baru", atas_nama: OFFICER } })).json().error.code).toBe("engine_rejected");
    expect((await messages(conversationId))[0]).toMatchObject({ id: mine.id, diedit_at: null });
    const queued = await call("POST", `/conversations/${conversationId}/messages`, { key: "antre", payload: { text: "antre", atas_nama: OFFICER } });
    const notSent = await call("POST", `/messages/${queued.json().id}/hapus`, { key: "h-0", payload: { atas_nama: OFFICER } });
    expect([notSent.statusCode, notSent.json().error.code]).toEqual([409, "message_not_sent"]);
    expect((await call("POST", `/messages/${mine.id}/edit`, { payload: { text: "baru", atas_nama: OFFICER } })).json().error.code).toBe("idempotency_key_required");
  });

  it("deletes for everyone within the window, keeps the body and answers a repeat as it is", async () => {
    const { conversationId } = await inbound();
    const mine = await sentReply(conversationId, "Salah kirim");
    const deleted = await call("POST", `/messages/${mine.id}/hapus`, { key: "h-1", payload: { atas_nama: OFFICER } });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({ isi: "Salah kirim", dihapus_at: expect.any(String), dihapus_oleh: { jenis: "petugas", petugas: OFFICER } });
    expect(stub.actions.at(-1)).toMatchObject({ action: "delete", body: { to: "6281234567890" } });
    expect((await call("POST", `/messages/${mine.id}/hapus`, { key: "h-1", payload: { atas_nama: OFFICER } })).statusCode).toBe(200);
    expect(stub.actions.filter((action) => action.action === "delete")).toHaveLength(1);
    const other = await sentReply(conversationId);
    await pool.query("UPDATE kirim_messages SET provider_at = now() - interval '49 hours' WHERE id = $1", [other.id]);
    expect((await call("POST", `/messages/${other.id}/hapus`, { key: "h-2", payload: { atas_nama: OFFICER } })).json().error.code).toBe("delete_window_passed");
  });

  it("reacts from the allow-list and takes the reaction back", async () => {
    const { conversationId, messageId, whatsappMessageId } = await inbound();
    const reacted = await call("POST", `/messages/${messageId}/reaksi`, { key: "rx-1", payload: { emoji: "🙏", atas_nama: OFFICER } });
    expect(reacted.statusCode).toBe(200);
    expect(reacted.json().reaksi).toEqual([{ emoji: "🙏", dari: "nomor_ini", petugas: OFFICER, waktu: expect.any(String) }]);
    expect(stub.actions.at(-1)).toMatchObject({ action: "reaction", whatsappMessageId, body: { to: "6281234567890", fromMe: false, emoji: "🙏" } });
    expect((await call("POST", `/messages/${messageId}/reaksi`, { key: "rx-2", payload: { emoji: "🔥", atas_nama: OFFICER } })).statusCode).toBe(400);
    const removed = await call("POST", `/messages/${messageId}/reaksi`, { key: "rx-3", payload: { emoji: "", atas_nama: OFFICER } });
    expect(removed.json().reaksi).toEqual([]);
    expect((await messages(conversationId))[0]!.reaksi).toEqual([]);
  });

  it("serves only the number's owner", async () => {
    const { messageId } = await inbound();
    const foreign = await call("POST", `/messages/${messageId}/reaksi`, { client: "hcis-api", key: "x", payload: { emoji: "👍", atas_nama: OFFICER } });
    expect(foreign.statusCode).toBe(404);
    const noOfficer = await call("POST", `/messages/${messageId}/reaksi`, { key: "y", payload: { emoji: "👍" } });
    expect(noOfficer.json().error.code).toBe("atas_nama_required");
  });
});

describe("engine events (§6)", () => {
  it("applies an edit by the contact once, keeping the old text", async () => {
    const { conversationId, messageId, whatsappMessageId } = await inbound("Anak saya umur 6");
    const change = { whatsappMessageId, chatJid: CONTACT_JID, peerJidAlt: null, senderJid: CONTACT_JID, fromMe: false, recipientType: "individual", body: "Anak saya umur 7", editedAt: new Date().toISOString() };
    stub.addEvent("spmb", "message.edited", { version: 1, change });
    stub.addEvent("spmb", "message.edited", { version: 1, change });
    await pull();
    expect((await messages(conversationId))[0]).toMatchObject({ id: messageId, isi: "Anak saya umur 7", diedit_at: expect.any(String) });
    expect((await call("GET", `/messages/${messageId}/riwayat-edit`)).json().items).toMatchObject([{ isi: "Anak saya umur 6", diganti_oleh: { jenis: "pengirim" } }]);
    const events = await webhooks("message.edited");
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toMatchObject({ device: "spmb", conversation_id: conversationId, message_id: messageId, arah: "masuk", cuplikan: "Anak saya umur 7", diedit_oleh: "pengirim" });
  });

  it("does not report this number's own API edit back as an event", async () => {
    const { conversationId } = await inbound();
    const mine = await sentReply(conversationId, "lama");
    await call("POST", `/messages/${mine.id}/edit`, { key: "e", payload: { text: "baru", atas_nama: OFFICER } });
    stub.addEvent("spmb", "message.edited", { version: 1, change: { whatsappMessageId: mine.whatsappMessageId, chatJid: CONTACT_JID, senderJid: "6281200001111@s.whatsapp.net", fromMe: true, recipientType: "individual", body: "baru", editedAt: new Date().toISOString() } });
    await pull();
    expect(await webhooks("message.edited")).toHaveLength(0);
    expect((await pool.query("SELECT 1 FROM kirim_message_edits")).rowCount).toBe(1);
  });

  it("keeps the officer and the audit when the engine's echo of an API edit, delete or reaction is ingested first", async () => {
    const { conversationId } = await inbound();
    const mine = await sentReply(conversationId, "lama");
    const echo = (type: string, change: Record<string, unknown>) => async () => {
      stub.addEvent("spmb", type, { version: 1, change: { whatsappMessageId: mine.whatsappMessageId, chatJid: CONTACT_JID, senderJid: "6281200001111@s.whatsapp.net", fromMe: true, recipientType: "individual", ...change } });
      await pull();
    };
    stub.beforeActionAnswer = echo("message.edited", { body: "baru", editedAt: new Date().toISOString() });
    expect((await call("POST", `/messages/${mine.id}/edit`, { key: "e1", payload: { text: "baru", atas_nama: OFFICER } })).statusCode).toBe(200);
    expect((await call("GET", `/messages/${mine.id}/riwayat-edit`)).json().items).toMatchObject([{ isi: "lama", diganti_oleh: { jenis: "petugas" } }]);
    stub.beforeActionAnswer = echo("message.deleted", { deletedAt: new Date().toISOString() });
    expect((await call("POST", `/messages/${mine.id}/hapus`, { key: "h1", payload: { atas_nama: OFFICER } })).json()).toMatchObject({ dihapus_oleh: { jenis: "petugas" } });
    stub.beforeActionAnswer = null;
    const audit = await pool.query<{ aksi: string }>(`SELECT aksi FROM kirim_audit WHERE aksi IN ('pesan.edit', 'pesan.hapus') ORDER BY created_at`);
    expect(audit.rows.map((row) => row.aksi)).toEqual(["pesan.edit", "pesan.hapus"]);
  });

  it("marks a message deleted by its sender and keeps the body", async () => {
    const { conversationId, messageId, whatsappMessageId } = await inbound("nomor KK saya 3201…");
    stub.addEvent("spmb", "message.deleted", { version: 1, change: { whatsappMessageId, chatJid: CONTACT_JID, senderJid: CONTACT_JID, fromMe: false, recipientType: "individual", deletedAt: new Date().toISOString() } });
    await pull();
    expect((await messages(conversationId))[0]).toMatchObject({ isi: "nomor KK saya 3201…", dihapus_at: expect.any(String), dihapus_oleh: { jenis: "pengirim", petugas: null } });
    expect((await webhooks("message.deleted"))[0]!.data).toMatchObject({ message_id: messageId, dihapus_oleh: "pengirim", arah: "masuk" });
  });

  it("records a group admin's deletion of a member's message as admin_grup, and ignores a non-admin", async () => {
    await kirim.ingest!.refreshDirectory("groups");
    stub.addEvent("spmb", "message.received", receivedPayload({ group: true, body: "promo", whatsappMessageId: "WA-G-DEL" }));
    await pull();
    const revoke = (senderJid: string) => ({ version: 1, change: { whatsappMessageId: "WA-G-DEL", chatJid: GROUP_JID, senderJid, fromMe: false, recipientType: "group", deletedAt: new Date().toISOString() } });
    // Not a member at all, then a member who is not admin: neither may delete someone else's message.
    stub.addEvent("spmb", "message.deleted", revoke("6281300000000@s.whatsapp.net"));
    await pull();
    const row = () => pool.query<{ deletedBy: string | null }>(`SELECT deleted_by AS "deletedBy" FROM kirim_messages WHERE wa_message_id = 'WA-G-DEL'`);
    expect((await row()).rows[0]!.deletedBy).toBeNull();
    // The admin is known by LID in the group and acts here by number.
    stub.addEvent("spmb", "message.deleted", revoke(CONTACT_JID));
    await pull();
    expect((await row()).rows[0]!.deletedBy).toBe("admin_grup");
  });

  it("ignores an edit or delete that does not come from the message's author", async () => {
    const { conversationId, whatsappMessageId } = await inbound("Pesan asli");
    const mine = await sentReply(conversationId, "Pesan kita");
    const spoof = (type: "message.edited" | "message.deleted", target: string, senderJid: string, fromMe = false) =>
      stub.addEvent("spmb", type, { version: 1, change: { whatsappMessageId: target, chatJid: CONTACT_JID, senderJid, fromMe, recipientType: "individual", body: "palsu", editedAt: new Date().toISOString(), deletedAt: new Date().toISOString() } });
    spoof("message.edited", whatsappMessageId, "6281399999999@s.whatsapp.net");
    spoof("message.deleted", whatsappMessageId, "6281399999999@s.whatsapp.net");
    // The contact cannot edit or delete this number's message, and this number cannot edit the contact's.
    spoof("message.edited", mine.whatsappMessageId, CONTACT_JID);
    spoof("message.deleted", mine.whatsappMessageId, CONTACT_JID);
    spoof("message.edited", whatsappMessageId, "6281200001111@s.whatsapp.net", true);
    await pull();
    const items = await messages(conversationId);
    expect(items.map((item) => [item.isi, item.diedit_at, item.dihapus_at])).toEqual([["Pesan kita", null, null], ["Pesan asli", null, null]]);
    expect(await webhooks("message.edited")).toHaveLength(0);
    expect(await webhooks("message.deleted")).toHaveLength(0);
    // This number deleting its own message from the phone is accepted.
    spoof("message.deleted", mine.whatsappMessageId, "6281200001111@s.whatsapp.net", true);
    await pull();
    expect((await messages(conversationId))[0]).toMatchObject({ dihapus_oleh: { jenis: "hp" } });
  });

  it("keeps one reaction per reactor and removes it on an empty emoji", async () => {
    const { conversationId } = await inbound();
    const mine = await sentReply(conversationId);
    const reaction = (emoji: string) => ({ version: 1, reaction: { whatsappMessageId: mine.whatsappMessageId, chatJid: CONTACT_JID, senderJid: CONTACT_JID, fromMe: false, recipientType: "individual", emoji, reactedAt: new Date().toISOString() } });
    stub.addEvent("spmb", "message.reaction", reaction("👍"));
    stub.addEvent("spmb", "message.reaction", reaction("❤️"));
    await pull();
    expect((await messages(conversationId))[0]!.reaksi).toEqual([{ emoji: "❤️", dari: "kontak", petugas: null, waktu: expect.any(String) }]);
    stub.addEvent("spmb", "message.reaction", reaction(""));
    await pull();
    expect((await messages(conversationId))[0]!.reaksi).toEqual([]);
    const events = await webhooks("message.reaction");
    expect(events.map((event) => event.data.emoji)).toEqual(["👍", "❤️", ""]);
    expect(JSON.stringify(events)).not.toContain("6281234567890");
  });

  it("stores a missed private call once as a panggilan message and ignores group calls", async () => {
    const { conversationId } = await inbound();
    await call("POST", `/conversations/${conversationId}/read`, { payload: { atas_nama: OFFICER, sampai_message_id: (await messages(conversationId))[0]!.id } });
    const callEvent = (callId: string, extra: Record<string, unknown> = {}) => ({
      version: 1,
      call: {
        callId, chatJid: CONTACT_LID, fromJid: CONTACT_LID, callerPnJid: CONTACT_JID, isVideo: true, isGroup: false, groupJid: null, offline: false,
        outcome: "missed", startedAt: new Date().toISOString(), answeredAt: null, endedAt: new Date().toISOString(), durationSeconds: 0, providerStatuses: ["offer"], ...extra,
      },
    });
    stub.addEvent("spmb", "call.logged", callEvent("CALL-1"));
    stub.addEvent("spmb", "call.logged", callEvent("CALL-1"));
    stub.addEvent("spmb", "call.logged", callEvent("CALL-G", { isGroup: true, groupJid: GROUP_JID, chatJid: GROUP_JID }));
    await pull();
    const items = await messages(conversationId);
    expect(items.filter((item) => item.tipe === "panggilan")).toHaveLength(1);
    expect(items[0]).toMatchObject({ tipe: "panggilan", arah: "masuk", isi: null, panggilan: { hasil: "tak_terjawab", video: true, durasi_detik: 0 } });
    const conversation = (await call("GET", `/conversations/${conversationId}`)).json();
    expect(conversation).toMatchObject({ belum_dibaca: 1, pesan_terakhir: { tipe: "panggilan", panggilan: { hasil: "tak_terjawab" } } });
    const events = await webhooks("call.logged");
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toMatchObject({ conversation_id: conversationId, from: PHONE, hasil: "tak_terjawab", video: true });
    expect((await pool.query("SELECT 1 FROM kirim_messages WHERE tipe = 'panggilan'")).rowCount).toBe(1);
  });

  it("replaces a missed call with its later revision and sends the corrected outcome again", async () => {
    const { conversationId } = await inbound();
    await call("POST", `/conversations/${conversationId}/read`, { payload: { atas_nama: OFFICER, sampai_message_id: (await messages(conversationId))[0]!.id } });
    const startedAt = new Date().toISOString();
    const logged = (revision: number, outcome: string, durationSeconds = 0) => ({
      version: 1,
      call: { callId: "CALL-R", chatJid: CONTACT_JID, fromJid: CONTACT_JID, callerPnJid: CONTACT_JID, isVideo: false, isGroup: false, groupJid: null, fromMe: false, revision,
        outcome, startedAt, answeredAt: outcome === "answered_elsewhere" ? startedAt : null, endedAt: startedAt, durationSeconds, providerStatuses: [] },
    });
    stub.addEvent("spmb", "call.logged", logged(1, "missed"));
    await pull();
    expect((await call("GET", `/conversations/${conversationId}`)).json().belum_dibaca).toBe(1);
    stub.addEvent("spmb", "call.logged", logged(2, "answered_elsewhere", 95));
    stub.addEvent("spmb", "call.logged", logged(1, "missed"));
    await pull();
    const calls = (await messages(conversationId)).filter((item) => item.tipe === "panggilan");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.panggilan).toMatchObject({ hasil: "diangkat", durasi_detik: 95, revisi: 2 });
    expect((await call("GET", `/conversations/${conversationId}`)).json().belum_dibaca).toBe(0);
    const events = await webhooks("call.logged");
    expect(events.map((event) => [event.data.hasil, event.data.revisi, event.data.dikoreksi])).toEqual([["tak_terjawab", 1, false], ["diangkat", 2, true]]);
    expect(events[1]!.data.message_id).toBe(events[0]!.data.message_id);
  });

  it("stores a call placed from the number's phone as outgoing, without counting it as unread", async () => {
    const { conversationId } = await inbound();
    await call("POST", `/conversations/${conversationId}/read`, { payload: { atas_nama: OFFICER, sampai_message_id: (await messages(conversationId))[0]!.id } });
    stub.addEvent("spmb", "call.logged", { version: 1, call: { callId: "CALL-OUT", chatJid: CONTACT_JID, fromJid: "6281200001111@s.whatsapp.net", callerPnJid: "6281200001111@s.whatsapp.net",
      isVideo: false, isGroup: false, fromMe: true, revision: 1, outcome: "missed", startedAt: new Date().toISOString(), answeredAt: null, endedAt: new Date().toISOString(), durationSeconds: 0 } });
    await pull();
    expect((await messages(conversationId))[0]).toMatchObject({ tipe: "panggilan", arah: "keluar", asal: "hp", panggilan: { hasil: "tak_terjawab" } });
    expect((await call("GET", `/conversations/${conversationId}`)).json().belum_dibaca).toBe(0);
    expect((await webhooks("call.logged"))[0]!.data).toMatchObject({ arah: "keluar", from: PHONE });
  });

  it("links a quoted incoming message and reads the forwarded flag", async () => {
    const mine = await sentReply((await inbound()).conversationId, "Jadwal tes Sabtu");
    const reply = await inbound("Jam berapa?", { quoted: { id: mine.whatsappMessageId, participant: null }, forwarded: true });
    const [item] = await messages(reply.conversationId);
    expect(item).toMatchObject({ id: reply.messageId, diteruskan: true, kutipan: { id: mine.id, arah: "keluar", cuplikan: "Jadwal tes Sabtu" } });
    const received = (await webhooks("message.received")).at(-1)!;
    expect(received.data).toMatchObject({ kutipan_message_id: mine.id, diteruskan: true });
  });
});

describe("profile photos (§8)", () => {
  it("fetches, serves with an ETag and removes the photo when WhatsApp stops showing it", async () => {
    const { conversationId } = await inbound();
    await kirim.ingest!.refreshDirectory("groups");
    await pool.query("UPDATE kirim_groups SET pesan_terakhir_at = now()");
    stub.profilePictures.set(CONTACT_JID, JPEG);
    stub.profilePictures.set(GROUP_JID, JPEG);
    expect((await kirim.photos.runOnce()).fetched).toBe(2);
    const photo = await call("GET", `/conversations/${conversationId}/foto`);
    expect(photo.statusCode).toBe(200);
    expect(photo.headers["content-type"]).toBe("image/jpeg");
    expect(photo.headers["cache-control"]).toBe("private, max-age=86400");
    expect(photo.rawPayload.equals(JPEG)).toBe(true);
    const cached = await call("GET", `/conversations/${conversationId}/foto`, { headers: { "if-none-match": String(photo.headers.etag) } });
    expect(cached.statusCode).toBe(304);
    const groupId = (await pool.query<{ id: string }>("SELECT id FROM kirim_groups")).rows[0]!.id;
    expect((await call("GET", `/groups/${groupId}/foto`)).statusCode).toBe(200);
    // Not asked again within 7 days.
    expect((await kirim.photos.runOnce()).fetched).toBe(0);

    const path = (await pool.query<{ path: string }>("SELECT path FROM kirim_profile_photos WHERE conversation_id = $1", [conversationId])).rows[0]!.path;
    stub.profilePictures.delete(CONTACT_JID);
    await pool.query("UPDATE kirim_profile_photos SET fetched_at = now() - interval '8 days'");
    await kirim.photos.runOnce();
    const gone = await call("GET", `/conversations/${conversationId}/foto`);
    expect([gone.statusCode, gone.json().error.code]).toEqual([404, "foto_tidak_ada"]);
    await expect(access(join(mediaRoot, path))).rejects.toThrow();
    expect((await call("GET", `/conversations/${conversationId}/foto`, { client: "hcis-api" })).statusCode).toBe(404);
  });

  it("stops the round without marking anything when the engine has no photo route", async () => {
    await inbound();
    stub.profilePictureRoute = false;
    expect((await kirim.photos.runOnce()).fetched).toBe(0);
    expect((await pool.query("SELECT 1 FROM kirim_profile_photos")).rowCount).toBe(0);
  });
});

describe("grup bersama (§10)", () => {
  it("finds the groups a contact shares with the number by number or by LID", async () => {
    const byNumber = await inbound();
    const byLid = await inbound("halo", {}, "998877665544@lid");
    stub.groups.get("spmb")![0]!.participants.push({ jid: "998877665544@lid", admin: null });
    await kirim.ingest!.refreshDirectory("groups");
    const shared = await call("GET", `/conversations/${byNumber.conversationId}/grup-bersama`);
    expect(shared.statusCode).toBe(200);
    expect(shared.json().items).toEqual([{ id: expect.any(String), nama: "Wali murid kelas 1A", jumlah_anggota: 3, kontak_admin: true, nomor_ini_admin: true, disegarkan_at: expect.any(String) }]);
    expect((await call("GET", `/conversations/${byLid.conversationId}/grup-bersama`)).json().items).toMatchObject([{ kontak_admin: false }]);
    const stranger = await inbound("hai", {}, "6281300000009@s.whatsapp.net");
    expect((await call("GET", `/conversations/${stranger.conversationId}/grup-bersama`)).json().items).toEqual([]);
    const stored = await pool.query<{ memberEnc: string }>(`SELECT member_enc AS "memberEnc" FROM kirim_group_members`);
    expect(JSON.stringify(stored.rows)).not.toContain("6281234567890");
  });
});

describe("R3 group API (§9)", () => {
  it("creates a group, reports members who need an invite link, and replays on the same key", async () => {
    stub.participantStatus.set("6281200000003", "403");
    const created = await call("POST", "/devices/spmb/groups", {
      key: "grup-1",
      payload: { nama: "Peminat SDIT 2026", deskripsi: "Info SPMB", anggota: [PHONE, "081200000003"], atas_nama: OFFICER },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      grup: { nama: "Peminat SDIT 2026", nomor_ini_admin: true, jumlah_anggota: 2 },
      anggota: [
        { nomor: PHONE, status: "ditambahkan", perlu_undangan: false },
        { nomor: "+6281200000003", status: "perlu_undangan", perlu_undangan: true },
      ],
      deskripsi: "berhasil",
    });
    const replay = await call("POST", "/devices/spmb/groups", {
      key: "grup-1",
      payload: { nama: "Peminat SDIT 2026", deskripsi: "Info SPMB", anggota: [PHONE, "081200000003"], atas_nama: OFFICER },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ grup: { id: created.json().grup.id }, ulangan: true });
    expect(stub.groupCalls.filter((item) => item.path === "create")).toHaveLength(1);
    expect((await call("GET", "/devices/spmb/groups")).json().items.map((item: { nama: string }) => item.nama)).toContain("Peminat SDIT 2026");
    const audit = await pool.query<{ metadata: unknown }>("SELECT metadata FROM kirim_audit WHERE aksi = 'grup.buat'");
    expect(audit.rows[0]!.metadata).toMatchObject({ device: "spmb", ditambahkan: 1, perlu_undangan: 1 });
    expect(JSON.stringify(audit.rows)).not.toContain("6281200000003");
  });

  it("limits additions to 20 per hour per number", async () => {
    await kirim.ingest!.refreshDirectory("groups");
    const groupId = (await pool.query<{ id: string }>("SELECT id FROM kirim_groups")).rows[0]!.id;
    const numbers = (from: number, count: number) => Array.from({ length: count }, (_, index) => `+62812100${String(from + index).padStart(5, "0")}`);
    const first = await call("POST", `/groups/${groupId}/participants`, { payload: { nomor: numbers(0, 19), atas_nama: OFFICER } });
    expect(first.statusCode).toBe(200);
    expect(first.json().anggota).toHaveLength(19);
    const over = await call("POST", `/groups/${groupId}/participants`, { payload: { nomor: numbers(100, 2), atas_nama: OFFICER } });
    expect(over.statusCode).toBe(429);
    expect(over.json().error).toMatchObject({ code: "group_add_limit", batas_per_jam: 20, sisa: 1, retry_after_detik: expect.any(Number) });
    expect(Number(over.headers["retry-after"])).toBeGreaterThan(3000);
    expect((await call("POST", `/groups/${groupId}/participants`, { payload: { nomor: numbers(200, 1), atas_nama: OFFICER } })).statusCode).toBe(200);
    expect((await call("POST", `/groups/${groupId}/participants`, { payload: { nomor: numbers(300, 21), atas_nama: OFFICER } })).json().error.code).toBe("group_add_too_many");
    // An engine failure gives the reservation back.
    await pool.query("UPDATE kirim_group_additions SET created_at = now() - interval '2 hours'");
    stub.groups.set("spmb", []);
    const gone = await call("POST", `/groups/${groupId}/participants`, { payload: { nomor: numbers(400, 1), atas_nama: OFFICER } });
    expect([gone.statusCode, gone.json().error.code]).toEqual([409, "group_unavailable"]);
    const recent = await pool.query("SELECT 1 FROM kirim_group_additions WHERE created_at > now() - interval '1 hour'");
    expect(recent.rowCount).toBe(0);
  });

  it("skips opted-out numbers, removes members, manages the invite link, renames and lists members", async () => {
    await kirim.ingest!.refreshDirectory("groups");
    const groupId = (await pool.query<{ id: string }>("SELECT id FROM kirim_groups")).rows[0]!.id;
    await call("POST", "/optouts", { payload: { nomor: "+6281200000005", cakupan: "device", device: "spmb", alasan: "Tidak mau" } });
    const added = await call("POST", `/groups/${groupId}/participants`, { payload: { nomor: ["+6281200000004", "+6281200000005"], atas_nama: OFFICER } });
    expect(added.json().anggota).toMatchObject([{ nomor: "+6281200000004", status: "ditambahkan" }, { nomor: "+6281200000005", status: "optout" }]);
    const removed = await call("POST", `/groups/${groupId}/participants/keluarkan`, { payload: { nomor: ["+6281200000004", "+6281200000006"], atas_nama: OFFICER } });
    expect(removed.json().anggota).toMatchObject([{ status: "dikeluarkan" }, { status: "bukan_anggota" }]);
    const link = await call("GET", `/groups/${groupId}/invite-link`);
    expect(link.json()).toEqual({ tautan: "https://chat.whatsapp.com/KODEAWAL", kode: "KODEAWAL" });
    const revoked = await call("POST", `/groups/${groupId}/invite-link/tarik`, { payload: { atas_nama: OFFICER } });
    expect(revoked.json().kode).not.toBe("KODEAWAL");
    const renamed = await call("PATCH", `/groups/${groupId}`, { payload: { nama: "Wali murid 1A (2026)", deskripsi: "", atas_nama: OFFICER } });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().nama).toBe("Wali murid 1A (2026)");
    expect(stub.groupCalls.filter((item) => item.path === "description").at(-1)!.body).toEqual({ description: "" });
    const members = await call("GET", `/groups/${groupId}/anggota`);
    expect(members.json().items).toEqual(expect.arrayContaining([
      { nomor: "+6281200001111", jenis: "pn", admin: true, nomor_ini: true },
      { nomor: PHONE, jenis: "lid", admin: true, nomor_ini: false },
    ]));
    const actions = (await pool.query<{ aksi: string }>("SELECT aksi FROM kirim_audit WHERE objek_jenis = 'grup' ORDER BY occurred_at")).rows.map((row) => row.aksi);
    expect(actions).toEqual(expect.arrayContaining(["grup.anggota_tambah", "grup.anggota_keluarkan", "grup.undangan_lihat", "grup.undangan_tarik", "grup.ubah"]));
    expect((await call("PATCH", `/groups/${groupId}`, { client: "hcis-api", payload: { nama: "x", atas_nama: OFFICER } })).statusCode).toBe(404);
  });
});

describe("privacy", () => {
  it("logs no message text or number from the new routes", async () => {
    const { messageId, conversationId } = await inbound("rahasia keluarga");
    await call("POST", `/messages/${messageId}/reaksi`, { key: "p1", payload: { emoji: "👍", atas_nama: OFFICER } });
    await call("GET", `/conversations/${conversationId}/grup-bersama`);
    const text = logLines.join("\n");
    expect(text).not.toContain("rahasia keluarga");
    expect(text).not.toContain("6281234567890");
  });
});
