import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";

/**
 * Stub of the JalurPesan platform tenant contract used by KIRIM-IMPL-001 §3.2
 * (`server/src/routes/platform-tenants.ts`, `media.ts`, `events.ts`). It counts sends per
 * Idempotency-Key and, like the engine, answers a repeated key with the same message id.
 */
export interface StubTenant {
  engineDeviceId: string;
  live: "connected" | "qr" | "connecting" | "disconnected";
  phone: string | null;
  everConnected: boolean;
}

export interface StubEvent {
  eventId: string;
  cursor: number;
  type: string;
  deviceId: string;
  messageId: string | null;
  occurredAt: string;
  payload: unknown;
}

export class JalurPesanStub {
  readonly tenants = new Map<string, StubTenant>();
  readonly sendsByKey = new Map<string, number>();
  readonly messageIdByKey = new Map<string, string>();
  readonly requests: Array<{ method: string; path: string; idempotencyKey: string | null; body: string }> = [];
  readonly events: StubEvent[] = [];
  readonly media = new Map<string, Buffer>();
  uploads = 0;
  /** Next responses for POST …/messages, consumed in order; default is 200. */
  sendQueue: Array<{ status: number; body: Record<string, unknown> } | "hang"> = [];
  provisionResponse: { status: number; body: Record<string, unknown> } | null = null;
  private server: Server | null = null;
  baseUrl = "";

  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      void this.handle(request).then(
        (result) => {
          if (result === "hang") return;
          response.writeHead(result.status, result.headers ?? { "content-type": "application/json" });
          response.end(result.raw ?? JSON.stringify(result.body ?? {}));
        },
        () => {
          response.writeHead(500);
          response.end();
        },
      );
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("stub did not bind");
    this.baseUrl = `http://127.0.0.1:${address.port}`;
  }

  async stop(): Promise<void> {
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve());
  }

  reset(): void {
    this.tenants.clear();
    this.sendsByKey.clear();
    this.messageIdByKey.clear();
    this.requests.length = 0;
    this.events.length = 0;
    this.media.clear();
    this.uploads = 0;
    this.sendQueue = [];
    this.provisionResponse = null;
  }

  addTenant(tenant: string, state: Partial<StubTenant> = {}): StubTenant {
    const value: StubTenant = { engineDeviceId: randomUUID(), live: "connected", phone: "6281200001111", everConnected: true, ...state };
    this.tenants.set(tenant, value);
    return value;
  }

  addEvent(tenant: string, type: string, payload: unknown, messageId: string | null = null): StubEvent {
    const event: StubEvent = {
      eventId: randomUUID(),
      cursor: this.events.length + 1,
      type,
      deviceId: this.tenants.get(tenant)!.engineDeviceId,
      messageId,
      occurredAt: new Date().toISOString(),
      payload,
    };
    this.events.push(event);
    return event;
  }

  totalSends(): number {
    return [...this.sendsByKey.values()].reduce((sum, count) => sum + count, 0);
  }

  private async handle(request: IncomingMessage): Promise<{ status: number; body?: unknown; raw?: Buffer | string; headers?: Record<string, string> } | "hang"> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks);
    const url = new URL(request.url ?? "/", "http://stub");
    const idempotencyKey = typeof request.headers["idempotency-key"] === "string" ? request.headers["idempotency-key"] : null;
    this.requests.push({ method: request.method ?? "", path: url.pathname, idempotencyKey, body: raw.toString("utf8") });
    if (request.headers.authorization !== "Bearer platform-key") return { status: 401, body: { success: false } };
    const match = /^\/api\/v1\/platform\/tenants\/([^/]+)(\/.*)$/.exec(url.pathname);
    if (!match) return { status: 404, body: {} };
    const tenantId = decodeURIComponent(match[1]!);
    const path = match[2]!;
    const tenant = this.tenants.get(tenantId);

    if (request.method === "PUT" && path === "/device") {
      if (this.provisionResponse) return this.provisionResponse;
      const created = !tenant;
      const value = tenant ?? this.addTenant(tenantId, { live: "disconnected", phone: null, everConnected: false });
      return { status: created ? 201 : 200, body: { created, device: { id: value.engineDeviceId } } };
    }
    if (!tenant) return { status: 404, body: { success: false, error: "Tenant device not found" } };

    if (request.method === "GET" && path === "/device") {
      return {
        status: 200,
        body: {
          device: { id: tenant.engineDeviceId, whatsappPhone: tenant.phone, pairedAt: tenant.everConnected ? "2026-10-01T00:00:00Z" : null, lastConnectedAt: null },
          liveState: { status: tenant.live, qr: tenant.live === "qr" ? "data:image/png;base64,UVJDT0RF" : null, jid: null, connectedAt: null },
        },
      };
    }
    if (request.method === "POST" && path === "/device/connect") {
      tenant.live = "qr";
      return { status: 200, body: {} };
    }
    if (request.method === "POST" && path === "/device/pairing-code") {
      return { status: 200, body: { success: true, pairingCode: "ABCD-EFGH" } };
    }
    if (request.method === "POST" && path === "/device/logout") {
      tenant.live = "disconnected";
      return { status: 200, body: {} };
    }
    if (request.method === "POST" && path === "/media") {
      this.uploads += 1;
      const id = randomUUID();
      this.media.set(id, raw);
      return { status: 201, body: { success: true, mediaId: id } };
    }
    if (request.method === "GET" && path.startsWith("/media/")) {
      const data = this.media.get(decodeURIComponent(path.slice(7)));
      if (!data) return { status: 404, body: { success: false, error: "Media not found" } };
      return { status: 200, raw: data, headers: { "content-type": "application/octet-stream", "content-length": String(data.length) } };
    }
    if (request.method === "POST" && path === "/messages") {
      const next = this.sendQueue.shift();
      if (next === "hang") return "hang";
      if (next && next.status !== 200) return next;
      const key = idempotencyKey ?? "";
      this.sendsByKey.set(key, (this.sendsByKey.get(key) ?? 0) + 1);
      const messageId = this.messageIdByKey.get(key) ?? randomUUID();
      this.messageIdByKey.set(key, messageId);
      return { status: 200, body: { success: true, messageId } };
    }
    if (request.method === "GET" && path === "/events") {
      const after = Number(url.searchParams.get("after") ?? "0");
      const limit = Number(url.searchParams.get("limit") ?? "100");
      const own = this.events.filter((event) => event.deviceId === tenant.engineDeviceId && event.cursor > after);
      const page = own.slice(0, limit);
      return { status: 200, body: { events: page, nextCursor: page.at(-1)?.cursor ?? after, hasMore: own.length > limit } };
    }
    return { status: 404, body: {} };
  }
}

/** JalurPesan `message.received` payload (version 1 text, version 2 media). */
export function receivedPayload(input: { id?: string; from?: string; body?: string | null; group?: boolean; media?: { id: string; sizeBytes: number; mimeType?: string } }) {
  const chatJid = input.group ? "120363000000@g.us" : input.from ?? "6281234567890@s.whatsapp.net";
  return {
    version: input.media ? 2 : 1,
    message: {
      id: input.id ?? randomUUID(),
      deviceId: "engine",
      direction: "inbound",
      chatJid,
      senderJid: input.group ? "6289999999999@s.whatsapp.net" : chatJid,
      recipient: null,
      recipientJid: null,
      recipientType: input.group ? "group" : "individual",
      messageType: input.media ? "document" : "text",
      body: input.body === undefined ? "Assalamu'alaikum, mau tanya pendaftaran" : input.body,
      whatsappMessageId: randomUUID(),
      status: "received",
      receivedAt: new Date().toISOString(),
      ...(input.media
        ? { media: { id: input.media.id, mediaType: "document", mimeType: input.media.mimeType ?? "application/pdf", sizeBytes: input.media.sizeBytes, sha256: null, originalFilename: "berkas.pdf" } }
        : {}),
    },
  };
}

export function receiptPayload(messageId: string, status: "delivered" | "read") {
  return { version: 1, message: { id: messageId, deviceId: "engine", direction: "outbound", whatsappMessageId: randomUUID(), status } };
}
