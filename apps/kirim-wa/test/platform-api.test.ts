import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { startWorker, type RunningWorker } from "../src/server.js";
import type { ManagedWhatsAppService, WhatsAppServiceFactory } from "../src/wa/device-manager.js";
import {
  WhatsAppNotConnectedError,
  type DeviceState,
  type InboundMessageListener,
  type OutboundReceiptListener,
} from "../src/wa/service.js";

/**
 * KIRIM-IMPL-005 §13. The contract test that matters most: the worker answers exactly what
 * `apps/api/src/modules/kirim/providers/jalurpesan.ts` reads, because the Hub-side provider for
 * this engine is that class pointed at this worker. Every status code asserted here is one Kirim
 * SQ turns into a decision — retry, hold the number, or give up on the message.
 *
 * Needs a PostgreSQL in DATABASE_URL, like the Hub's own integration tests.
 */

const DATABASE_URL = process.env["DATABASE_URL"];
const PLATFORM_KEY = "test-platform-key-at-least-24-chars";

class FakeService implements ManagedWhatsAppService {
  connected = false;
  credentials = false;
  sent: Array<{ to: string; body: string }> = [];
  nextMessageId = "WAMSG-1";
  failWith: Error | null = null;

  constructor(
    readonly deviceId: string,
    readonly inbound: InboundMessageListener,
    readonly receipt: OutboundReceiptListener,
  ) {}

  getState(): DeviceState {
    return {
      status: this.connected ? "connected" : "disconnected",
      qr: null,
      jid: this.connected ? "628123456789@s.whatsapp.net" : null,
      name: null,
      connectedAt: this.connected ? "2026-11-17T12:00:00.000Z" : null,
      lastDisconnectReason: null,
      lastDisconnectCode: null,
      lastDisconnectedAt: null,
      loggedOut: false,
      requiresReset: false,
      reconnectAttempts: 0,
    };
  }
  hasActiveSocket(): boolean {
    return this.connected;
  }
  hasStoredCredentials(): boolean {
    return this.credentials;
  }
  async connect(): Promise<DeviceState> {
    this.connected = true;
    return this.getState();
  }
  async reconnect(): Promise<DeviceState> {
    return this.getState();
  }
  async logout(): Promise<DeviceState> {
    this.connected = false;
    return this.getState();
  }
  async stop(): Promise<DeviceState> {
    this.connected = false;
    return this.getState();
  }
  async sendText(phone: string, message: string) {
    if (this.failWith) throw this.failWith;
    this.sent.push({ to: phone, body: message });
    return { messageId: this.nextMessageId };
  }
  async sendTextToJid(jid: string, message: string) {
    return this.sendText(jid, message);
  }
  async sendMedia(phone: string) {
    if (this.failWith) throw this.failWith;
    this.sent.push({ to: phone, body: "<media>" });
    return { messageId: this.nextMessageId };
  }
  async sendMediaToIndividualJid(jid: string) {
    return this.sendMedia(jid);
  }
  async requestPairingCode(): Promise<string> {
    return "ABCD1234";
  }
  async listJoinedGroups() {
    return [];
  }
  async getGroupMetadata(): Promise<never> {
    throw new Error("not used here");
  }
  async sendGroupText() {
    return { messageId: this.nextMessageId };
  }
  async sendGroupMedia() {
    return { messageId: this.nextMessageId };
  }
  async requestMessageHistory(): Promise<string> {
    return "provider-request-1";
  }
  async markMessagesRead(): Promise<void> {}
}

describe.skipIf(!DATABASE_URL)("platform contract", () => {
  let worker: RunningWorker;
  let pool: pg.Pool;
  let root: string;
  const services = new Map<string, FakeService>();

  const factory: WhatsAppServiceFactory = (deviceId, _authDirectory, _onState, onInbound, onReceipt) => {
    const service = new FakeService(deviceId, onInbound, onReceipt);
    services.set(deviceId, service);
    return service;
  };

  /** Polls the event log the way Kirim SQ does, instead of guessing how long a write takes. */
  const untilEvent = async (type: string) => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const page = (await (await call("/luar/events?after=0&limit=50")).json()) as {
        events: Array<{ type: string; payload: { message: { id: string; whatsappMessageId: string } } }>;
      };
      const found = page.events.find((event) => event.type === type);
      if (found) return found;
      await new Promise((done) => setTimeout(done, 20));
    }
    return undefined;
  };

  const call = (path: string, init: RequestInit = {}) =>
    fetch(`${worker.url}/api/v1/platform/tenants${path}`, {
      ...init,
      headers: { authorization: `Bearer ${PLATFORM_KEY}`, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
    });

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "kirim-wa-contract-"));
    pool = new pg.Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    await pool?.end();
    await rm(root, { recursive: true, force: true });
  });

  // A worker of its own per test: the registry and the open sockets are in-process state, so a
  // shared worker would carry one test's number into the next.
  beforeEach(async () => {
    await pool.query(
      `TRUNCATE kirim_wa_events, kirim_wa_cursors, kirim_wa_idempotency, kirim_wa_media,
               kirim_wa_messages, kirim_wa_history_imports, kirim_wa_contacts, kirim_wa_phone_state, kirim_wa_devices`,
    );
    services.clear();
    worker = await startWorker(
      {
        DATABASE_URL,
        KIRIM_WA_PORT: "0",
        KIRIM_WA_PLATFORM_KEY: PLATFORM_KEY,
        KIRIM_WA_AUTH_ROOT: join(root, "auth"),
        KIRIM_WA_MEDIA_ROOT: join(root, "media"),
        KIRIM_WA_DATA_KEYS: `t1:${randomBytes(32).toString("base64")}`,
        KIRIM_WA_LOG_LEVEL: "silent",
      } as NodeJS.ProcessEnv,
      { serviceFactory: factory },
    );
  });

  afterEach(async () => {
    await worker?.stop();
  });

  it("refuses every platform call without the shared key", async () => {
    const response = await fetch(`${worker.url}/api/v1/platform/tenants/luar/device`, { headers: { authorization: "Bearer wrong" } });
    expect(response.status).toBe(401);
    // Health stays open on loopback so the watchdog can use it.
    expect((await fetch(`${worker.url}/health`)).status).toBe(200);
  });

  it("provisions a number, and reports an unknown one as a missing tenant", async () => {
    expect((await call("/luar/device")).status).toBe(404);

    const created = await call("/luar/device", { method: "PUT", body: JSON.stringify({ name: "Aplikasi luar" }) });
    expect(created.status).toBe(201);
    // Provisioning again is not an error; Kirim SQ calls it on every connect.
    expect((await call("/luar/device", { method: "PUT", body: JSON.stringify({ name: "Aplikasi luar" }) })).status).toBe(200);

    const state = (await (await call("/luar/device")).json()) as { device: { id: string }; liveState: { status: string } };
    // `device.id` is what Kirim SQ stores as the engine device id and routes pushes by.
    expect(state.device.id).toBe("luar");
    expect(state.liveState.status).toBe("disconnected");
  });

  it("sends once per Idempotency-Key, and names a reuse with other content as a conflict", async () => {
    await call("/luar/device", { method: "PUT", body: JSON.stringify({ name: "Aplikasi luar" }) });
    await call("/luar/device/connect", { method: "POST" });
    const key = randomUUID();
    const body = JSON.stringify({ to: "628111111111", message: "Kode Anda 123456" });

    const first = await call("/luar/messages", { method: "POST", body, headers: { "idempotency-key": key } });
    expect(first.status).toBe(200);
    const { messageId } = (await first.json()) as { messageId: string };
    expect(messageId).toBe("WAMSG-1");

    // The same key and the same content: the first answer again, and nothing sent twice.
    const replay = await call("/luar/messages", { method: "POST", body, headers: { "idempotency-key": key } });
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as { messageId: string }).messageId).toBe("WAMSG-1");
    expect(services.get("luar")!.sent).toHaveLength(1);

    // The same key with other content is a caller bug, and Kirim SQ must not retry it.
    const conflict = await call("/luar/messages", {
      method: "POST",
      body: JSON.stringify({ to: "628111111111", message: "Something else" }),
      headers: { "idempotency-key": key },
    });
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as { code: string }).code).toBe("idempotency_key_conflict");
  });

  it("answers a send from a disconnected number with 409, which Kirim SQ holds and retries", async () => {
    await call("/luar/device", { method: "PUT", body: JSON.stringify({ name: "Aplikasi luar" }) });
    await call("/luar/device/connect", { method: "POST" });
    services.get("luar")!.failWith = new WhatsAppNotConnectedError();

    const response = await call("/luar/messages", {
      method: "POST",
      body: JSON.stringify({ to: "628111111111", message: "Halo" }),
      headers: { "idempotency-key": randomUUID() },
    });
    expect(response.status).toBe(409);
  });

  it("refuses a recipient that is not a number in the way Kirim SQ reads as a bad recipient", async () => {
    await call("/luar/device", { method: "PUT", body: JSON.stringify({ name: "Aplikasi luar" }) });
    const response = await call("/luar/messages", {
      method: "POST",
      body: JSON.stringify({ to: "not-a-number", message: "Halo" }),
      headers: { "idempotency-key": randomUUID() },
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error.startsWith("Invalid recipient")).toBe(true);
  });

  it("gives events in cursor order, never repeats one, and moves the read watermark", async () => {
    await call("/luar/device", { method: "PUT", body: JSON.stringify({ name: "Aplikasi luar" }) });
    await call("/luar/device/connect", { method: "POST" });
    const service = services.get("luar")!;

    for (const text of ["satu", "dua", "tiga"]) {
      await service.inbound({
        whatsappMessageId: `WA-${text}`,
        chatJid: "628111111111@s.whatsapp.net",
        peerJidAlt: null,
        senderJid: "628111111111@s.whatsapp.net",
        senderDisplayName: "Peminat",
        recipientJid: null,
        recipientType: "individual",
        body: text,
        receivedAt: "2026-11-17T12:00:00.000Z",
      });
    }

    const page = (await (await call("/luar/events?after=0&limit=2")).json()) as {
      events: Array<{ cursor: number; type: string; deviceId: string; payload: { message: { body: string } } }>;
      nextCursor: number;
      hasMore: boolean;
    };
    expect(page.events.map((event) => event.type)).toEqual(["message.received", "message.received"]);
    expect(page.events[0]!.cursor).toBeLessThan(page.events[1]!.cursor);
    expect(page.events[0]!.deviceId).toBe("luar");
    expect(page.events.map((event) => event.payload.message.body)).toEqual(["satu", "dua"]);
    expect(page.hasMore).toBe(true);

    const rest = (await (await call(`/luar/events?after=${page.nextCursor}&limit=100`)).json()) as {
      events: Array<{ payload: { message: { body: string } } }>;
      hasMore: boolean;
    };
    expect(rest.events.map((event) => event.payload.message.body)).toEqual(["tiga"]);
    expect(rest.hasMore).toBe(false);

    // The pull is also the acknowledgement that makes pruning safe (§5).
    const watermark = await pool.query<{ read_cursor: string }>("SELECT read_cursor::text FROM kirim_wa_cursors WHERE kode = 'luar'");
    expect(Number(watermark.rows[0]!.read_cursor)).toBe(page.nextCursor);
  });

  it("stores an uploaded file, hands it back, and says `Media not found` for an id it never had", async () => {
    await call("/luar/device", { method: "PUT", body: JSON.stringify({ name: "Aplikasi luar" }) });
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("%PDF-1.4 test")], { type: "application/pdf" }), "surat.pdf");
    const uploaded = await fetch(`${worker.url}/api/v1/platform/tenants/luar/media?type=document`, {
      method: "POST",
      headers: { authorization: `Bearer ${PLATFORM_KEY}` },
      body: form,
    });
    expect(uploaded.status).toBe(201);
    const { mediaId } = (await uploaded.json()) as { mediaId: string };

    const fetched = await call(`/luar/media/${mediaId}`);
    expect(fetched.status).toBe(200);
    expect(Buffer.from(await fetched.arrayBuffer()).toString("utf8")).toBe("%PDF-1.4 test");

    const missing = await call(`/luar/media/${randomUUID()}`);
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: string }).error).toBe("Media not found");
  });

  it("turns a delivery receipt into the event Kirim SQ matches on the WhatsApp id", async () => {
    await call("/luar/device", { method: "PUT", body: JSON.stringify({ name: "Aplikasi luar" }) });
    await call("/luar/device/connect", { method: "POST" });
    // A receipt listener is synchronous in Baileys, so the event is written just after it returns;
    // Kirim SQ sees it on its next pull, and so does this test.
    services.get("luar")!.receipt({ whatsappMessageId: "WAMSG-1", status: "read", occurredAt: "2026-11-17T12:05:00.000Z" });
    const receipt = await untilEvent("message.read");
    expect(receipt).toBeDefined();
    // Kirim SQ matches on either id, so both carry the WhatsApp id.
    expect(receipt!.payload.message.id).toBe("WAMSG-1");
    expect(receipt!.payload.message.whatsappMessageId).toBe("WAMSG-1");
  });

  it("parks a number so the other engine may hold the same session, and lets it back", async () => {
    await call("/luar/device", { method: "PUT", body: JSON.stringify({ name: "Aplikasi luar" }) });
    await call("/luar/device/connect", { method: "POST" });
    expect(services.get("luar")!.connected).toBe(true);

    expect((await call("/luar/device/park", { method: "POST" })).status).toBe(200);
    expect(services.get("luar")!.connected).toBe(false);
    const parked = await pool.query<{ parked: boolean }>("SELECT parked FROM kirim_wa_devices WHERE kode = 'luar'");
    expect(parked.rows[0]!.parked).toBe(true);
    // While parked, connecting is refused in the shape Kirim SQ reads as "not now".
    expect((await call("/luar/device/connect", { method: "POST" })).status).toBe(409);

    expect((await call("/luar/device/unpark", { method: "POST" })).status).toBe(200);
    expect((await call("/luar/device/connect", { method: "POST" })).status).toBe(200);
  });

  it("refuses a history request for a chat it has never seen a message in", async () => {
    await call("/luar/device", { method: "PUT", body: JSON.stringify({ name: "Aplikasi luar" }) });
    const response = await call("/luar/history-imports", {
      method: "POST",
      body: JSON.stringify({ chatJid: "628999999999@s.whatsapp.net", maxMessages: 50 }),
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe("no_anchor");
  });
});
