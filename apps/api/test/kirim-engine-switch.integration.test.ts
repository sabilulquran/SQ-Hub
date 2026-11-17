import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { KirimAdminService } from "../src/modules/kirim/admin.js";
import { KirimCrypto, maskPhone, phoneCanonical } from "../src/modules/kirim/crypto.js";
import { KirimApiError } from "../src/modules/kirim/errors.js";
import { KirimIngest } from "../src/modules/kirim/ingest.js";
import { WaEngineProvider } from "../src/modules/kirim/providers/wa.js";
import { JalurPesanProvider } from "../src/modules/kirim/providers/jalurpesan.js";
import type { KirimProvider, ProviderEventPage, ProviderName } from "../src/modules/kirim/providers/types.js";
import { KirimService } from "../src/modules/kirim/service.js";

/**
 * KIRIM-IMPL-005 §8 and §9: moving one number from JalurPesan to Kirim SQ's own engine.
 *
 * The thing this test is really about is the duplicate that once made the SPMB inbox deaf. A
 * number must change engine **in place**: the same row, the same conversations, the same history.
 * Two numbers for one WhatsApp account, or one message stored twice, is the failure to prevent.
 */

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for integration tests");

const pool = new Pool({ connectionString: databaseUrl });
const crypto = new KirimCrypto([{ kid: "t1", key: randomBytes(32) }], randomBytes(32));
const actor = { ref: "kepala-hcm" };
const PHONE = "+6281234567890";

let mediaRoot: string;
let service: KirimService;
let admin: KirimAdminService;
let ingest: KirimIngest;
let deviceId: string;
let consumerId: string;

/** Events a stub engine will hand over; only what ingest reads is implemented. */
function stubEngine(name: ProviderName, pages: Map<number, ProviderEventPage>): KirimProvider {
  return {
    name,
    async deviceStatus() {
      return { status: "tersambung" as const, qr: null, phoneDigits: PHONE.replace("+", ""), engineDeviceId: `engine-${name}` };
    },
    async pullEvents(_device, cursor) {
      return pages.get(cursor) ?? { events: [], nextCursor: cursor, hasMore: false };
    },
    async listGroups() {
      return [];
    },
    async listContacts() {
      return { contacts: [], hasMore: false };
    },
    async downloadMedia() {
      return null;
    },
  } as unknown as KirimProvider;
}

const jalurpesanPages = new Map<number, ProviderEventPage>();
const waPages = new Map<number, ProviderEventPage>();
const providers: Record<ProviderName, KirimProvider | undefined> = {
  log: undefined,
  jalurpesan: stubEngine("jalurpesan", jalurpesanPages),
  wa: stubEngine("wa", waPages),
};

function inboundEvent(eventId: string, cursor: number, whatsappMessageId: string, body: string) {
  return {
    eventId,
    cursor,
    type: "message.received",
    engineDeviceId: "engine",
    messageId: whatsappMessageId,
    occurredAt: "2026-11-17T12:00:00.000Z",
    payload: {
      version: 1,
      message: {
        id: whatsappMessageId,
        whatsappMessageId,
        direction: "inbound",
        chatJid: "628111111111@s.whatsapp.net",
        senderJid: "628111111111@s.whatsapp.net",
        senderDisplayName: "Peminat",
        recipientType: "individual",
        messageType: "text",
        body,
        receivedAt: "2026-11-17T12:00:00.000Z",
        media: null,
      },
    },
  };
}

beforeAll(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), "kirim-engine-switch-"));
  service = new KirimService(pool, crypto, mediaRoot);
  ingest = new KirimIngest(pool, crypto, service, providers, { inboundMediaMaxBytes: 1_000_000 });
  admin = new KirimAdminService(pool, crypto, service, providers, ingest);
});

afterAll(async () => {
  await pool.end();
  await rm(mediaRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  jalurpesanPages.clear();
  waPages.clear();
  await pool.query(
    `TRUNCATE kirim_events, kirim_outbox, kirim_messages, kirim_media_engine_refs, kirim_media,
              kirim_conversations, kirim_kartu_riwayat, kirim_routes, kirim_audit, kirim_devices, kirim_consumers CASCADE`,
  );
  consumerId = randomUUID();
  deviceId = randomUUID();
  await pool.query(`INSERT INTO kirim_consumers (id, client_id, nama) VALUES ($1, 'spmb-api', 'spmb')`, [consumerId]);
  await pool.query(
    `INSERT INTO kirim_devices (id, kode, label, pemilik_consumer_id, provider, provider_ref, status, nomor_hmac, nomor_tersamar, antrean_dijeda)
     VALUES ($1, 'spmb', 'Nomor SPMB', $2, 'jalurpesan', 'spmb', 'tersambung', $3, $4, true)`,
    [deviceId, consumerId, crypto.lookup(phoneCanonical(PHONE)), maskPhone(PHONE)],
  );
});

describe("moving one number to Kirim SQ's own engine", () => {
  it("changes the engine on the same number, without making a second one", async () => {
    await admin.updateDevice(actor, "spmb", { provider: "wa", alasan: "pindah ke mesin internal" });

    const rows = await pool.query<{ id: string; provider: string; provider_ref: string }>(
      "SELECT id, provider, provider_ref FROM kirim_devices ORDER BY kode",
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.id).toBe(deviceId);
    expect(rows.rows[0]!.provider).toBe("wa");
    // §4.1: the tenant on the new engine is the number code, filled in without the admin typing it.
    expect(rows.rows[0]!.provider_ref).toBe("spmb");

    const audit = await pool.query<{ aksi: string }>("SELECT aksi FROM kirim_audit ORDER BY occurred_at DESC LIMIT 1");
    expect(audit.rows[0]!.aksi).toBe("nomor.ganti_provider");
  });

  it("refuses to move a number while its queue is running", async () => {
    await pool.query("UPDATE kirim_devices SET antrean_dijeda = false WHERE id = $1", [deviceId]);
    await expect(admin.updateDevice(actor, "spmb", { provider: "wa", alasan: "x" })).rejects.toMatchObject({
      code: "queue_not_paused",
    });
  });

  it("refuses to move a number while a message is still waiting for its status", async () => {
    const messageId = randomUUID();
    const conversationId = randomUUID();
    await pool.query(
      `INSERT INTO kirim_conversations (id, device_id, kontak_hmac, kontak_enc, kontak_jenis)
       VALUES ($1, $2, $3, $4, 'pn')`,
      [conversationId, deviceId, crypto.lookup("pn:+628111111111"), crypto.seal("pn:+628111111111", `kirim:kirim_conversations:kontak_enc:${conversationId}`)],
    );
    await pool.query(
      `INSERT INTO kirim_messages (id, conversation_id, device_id, arah, asal, jenis, tipe, provider, provider_message_id, status, provider_at, dry_run)
       VALUES ($1, $2, $3, 'keluar', 'otomatis', 'notifikasi', 'teks', 'jalurpesan', 'WA-1', 'diserahkan', now(), false)`,
      [messageId, conversationId, deviceId],
    );
    await pool.query(
      `INSERT INTO kirim_outbox (id, message_id, device_id, consumer_id, status, jenis, prioritas,
                                 idempotency_key, request_hash, to_hmac, expires_at)
       VALUES ($1, $2, $3, $4, 'diserahkan', 'notifikasi', 'normal', $5, $6, $7, now() + interval '1 day')`,
      [randomUUID(), messageId, deviceId, consumerId, `idem-${messageId}`, crypto.lookup(`req:${messageId}`), crypto.lookup("pn:+628111111111")],
    );

    await expect(admin.updateDevice(actor, "spmb", { provider: "wa", alasan: "x" })).rejects.toMatchObject({
      code: "handover_pending",
    });
  });

  it("refuses to move a number when another active number is the same WhatsApp account", async () => {
    await pool.query(
      `INSERT INTO kirim_devices (id, kode, label, pemilik_consumer_id, provider, provider_ref, status, nomor_hmac)
       VALUES ($1, 'spmb-2', 'Nomor SPMB (lama)', $2, 'jalurpesan', 'spmb-2', 'tersambung', $3)`,
      [randomUUID(), consumerId, crypto.lookup(phoneCanonical(PHONE))],
    );

    // This is the `spmb-2` shape: two numbers, one WhatsApp account. Moving one of them to another
    // engine would leave two live sessions and one deaf inbox.
    await expect(admin.updateDevice(actor, "spmb", { provider: "wa", alasan: "x" })).rejects.toMatchObject({
      code: "nomor_ganda",
    });
  });

  it("keeps one message one row when the same WhatsApp id arrives on the new engine", async () => {
    // The old engine delivered the message before the move.
    jalurpesanPages.set(0, { events: [inboundEvent(randomUUID(), 11, "WA-SAME", "halo")], nextCursor: 11, hasMore: false });
    await ingest.runOnce();

    await admin.updateDevice(actor, "spmb", { provider: "wa", alasan: "pindah" });
    await pool.query("UPDATE kirim_devices SET status = 'tersambung' WHERE id = $1", [deviceId]);

    // The new engine replays the same WhatsApp message under an event id of its own, from cursor 0.
    waPages.set(0, { events: [inboundEvent(randomUUID(), 1, "WA-SAME", "halo")], nextCursor: 1, hasMore: false });
    await ingest.runOnce();

    const messages = await pool.query<{ provider: string }>(
      "SELECT provider FROM kirim_messages WHERE device_id = $1 AND provider_message_id = 'WA-SAME'",
      [deviceId],
    );
    expect(messages.rows).toHaveLength(1);
    // The row stays where it was written; the move does not rewrite history.
    expect(messages.rows[0]!.provider).toBe("jalurpesan");

    const conversations = await pool.query("SELECT 1 FROM kirim_conversations WHERE device_id = $1", [deviceId]);
    expect(conversations.rowCount).toBe(1);
  });

  it("gives the new engine a cursor of its own and keeps the old one as history", async () => {
    jalurpesanPages.set(0, { events: [inboundEvent(randomUUID(), 900, "WA-OLD", "lama")], nextCursor: 900, hasMore: false });
    await ingest.runOnce();

    await admin.updateDevice(actor, "spmb", { provider: "wa", alasan: "pindah" });
    await pool.query("UPDATE kirim_devices SET status = 'tersambung' WHERE id = $1", [deviceId]);

    // The new engine numbers from 1. If the cursor were shared, this event would be skipped as old.
    waPages.set(0, { events: [inboundEvent(randomUUID(), 1, "WA-NEW", "baru")], nextCursor: 1, hasMore: false });
    await ingest.runOnce();

    const events = await pool.query<{ provider: string; provider_cursor: string }>(
      "SELECT provider, provider_cursor::text FROM kirim_events WHERE device_id = $1 ORDER BY received_at",
      [deviceId],
    );
    expect(events.rows.map((row) => [row.provider, Number(row.provider_cursor)])).toEqual([
      ["jalurpesan", 900],
      ["wa", 1],
    ]);
    const stored = await pool.query("SELECT 1 FROM kirim_messages WHERE device_id = $1 AND provider_message_id = 'WA-NEW'", [deviceId]);
    expect(stored.rowCount).toBe(1);
  });

  it("names itself `wa` so every row says which engine wrote it", () => {
    const refs = { get: async () => null, put: async () => undefined, remove: async () => undefined };
    const wa = new WaEngineProvider({ baseUrl: "http://127.0.0.1:3307", platformKey: "worker-key" }, refs);
    const jalurpesan = new JalurPesanProvider({ baseUrl: "http://127.0.0.1:3401", platformKey: "engine-key" }, refs);
    expect(wa.name).toBe("wa");
    expect(jalurpesan.name).toBe("jalurpesan");
  });

  it("refuses a number code that does not match the new engine's tenant", async () => {
    await expect(
      admin.updateDevice(actor, "spmb", { provider: "wa", provider_ref: "something-else", alasan: "x" }),
    ).rejects.toBeInstanceOf(KirimApiError);
  });
});
