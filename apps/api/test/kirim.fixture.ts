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

/** K3.2 §E: members carry their other identity when the engine knows it. */
export interface StubGroup {
  id: string;
  subject: string;
  size: number;
  participants: Array<{ jid: string; admin: string | null; phoneJid?: string | null; lidJid?: string | null }>;
}

export class JalurPesanStub {
  readonly tenants = new Map<string, StubTenant>();
  readonly sendsByKey = new Map<string, number>();
  readonly messageIdByKey = new Map<string, string>();
  readonly requests: Array<{ method: string; path: string; idempotencyKey: string | null; body: string }> = [];
  readonly events: StubEvent[] = [];
  readonly media = new Map<string, Buffer>();
  /** KIRIM-IMPL-002: groups per tenant, contacts per tenant, read receipts and J-2 history. */
  readonly groups = new Map<string, StubGroup[]>();
  /** KIRIM-IMPL-004 / K3.2 §B: actions received (reaction, edit, delete) with their body. */
  readonly actions: Array<{ action: string; whatsappMessageId: string; idempotencyKey: string | null; body: Record<string, unknown> }> = [];
  /** Next responses for the K3.2 §B action routes, consumed in order; default is 200. */
  actionQueue: Array<{ status: number; body: Record<string, unknown> }> = [];
  /** Runs while an action is "at WhatsApp", before the engine answers: e.g. its own echo being ingested first. */
  beforeActionAnswer: (() => Promise<void>) | null = null;
  /** K3.2 §D: photo per JID; a JID without one answers `profile_picture_unavailable`. */
  readonly profilePictures = new Map<string, Buffer>();
  /** When false the profile-picture route answers a bare 404, like an engine without it. */
  profilePictureRoute = true;
  /** K3.2 §E: WhatsApp's status per participant digits on an addition; default "200". */
  readonly participantStatus = new Map<string, string>();
  readonly inviteCodes = new Map<string, string>();
  /** Group management calls received (participants, subject, description, invite). */
  readonly groupCalls: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
  readonly contacts = new Map<string, Array<{ jid: string; canonicalJid: string; displayName: string }>>();
  readonly reads: Array<{ remoteJid: string; whatsappMessageId: string }> = [];
  readonly uploadTypes: string[] = [];
  readonly history = new Map<string, { status: "awaiting" | "completed" | "failed"; chatJid: string; messages: unknown[] }>();
  /** History the engine will return for a chat once an import is requested. */
  readonly pendingHistory = new Map<string, unknown[]>();
  /** When false the J-2 routes answer 404, like an engine without them. */
  historyRoutes = true;
  /** POSTs to `/history-imports` answered `409 import_active` before the engine accepts again. */
  historyBusy = 0;
  /**
   * Holds a `/events` reply open after its page has been read, so a test can arrange what a real
   * engine does all the time: an event arriving while a pull is already past the point of seeing it.
   */
  onEventsRead: (() => Promise<void>) | null = null;
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
    this.groups.clear();
    this.contacts.clear();
    this.reads.length = 0;
    this.uploadTypes.length = 0;
    this.history.clear();
    this.pendingHistory.clear();
    this.historyRoutes = true;
    this.historyBusy = 0;
    this.actions.length = 0;
    this.actionQueue = [];
    this.beforeActionAnswer = null;
    this.profilePictures.clear();
    this.profilePictureRoute = true;
    this.participantStatus.clear();
    this.inviteCodes.clear();
    this.groupCalls.length = 0;
    this.onEventsRead = null;
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
      this.uploadTypes.push(url.searchParams.get("type") ?? "");
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
    if (request.method === "POST" && path === "/messages/read") {
      const body = JSON.parse(raw.toString("utf8")) as { messages: Array<{ remoteJid: string; whatsappMessageId: string }> };
      this.reads.push(...body.messages);
      return { status: 200, body: { success: true, count: body.messages.length } };
    }
    const action = /^\/messages\/([^/]+)\/(reaction|edit|delete)$/.exec(path);
    if (request.method === "POST" && action) {
      const body = JSON.parse(raw.toString("utf8") || "{}") as Record<string, unknown>;
      const next = this.actionQueue.shift();
      if (next) return next;
      const target = decodeURIComponent(action[1]!);
      this.actions.push({ action: action[2]!, whatsappMessageId: target, idempotencyKey, body });
      if (this.beforeActionAnswer) await this.beforeActionAnswer();
      return { status: 200, body: { success: true, action: action[2], messageId: randomUUID(), targetMessageId: target } };
    }
    if (request.method === "GET" && path === "/profile-picture") {
      if (!this.profilePictureRoute) return { status: 404, body: {} };
      const data = this.profilePictures.get(url.searchParams.get("jid") ?? "");
      if (!data) return { status: 404, body: { success: false, code: "profile_picture_unavailable" } };
      return { status: 200, raw: data, headers: { "content-type": "image/jpeg", "cache-control": "no-store" } };
    }
    if (request.method === "POST" && path === "/groups") {
      const body = JSON.parse(raw.toString("utf8")) as { subject: string; participants: string[] };
      this.groupCalls.push({ method: "POST", path: "create", body });
      const own = tenant.phone ? [{ jid: `${tenant.phone}@s.whatsapp.net`, admin: "superadmin" as string | null, phoneJid: null, lidJid: null }] : [];
      const joined = body.participants
        .filter((digits) => (this.participantStatus.get(digits) ?? "200") === "200")
        .map((digits) => ({ jid: `${digits}@s.whatsapp.net`, admin: null, phoneJid: null, lidJid: null }));
      const group: StubGroup = { id: `1203639${String(Date.now()).slice(-8)}@g.us`, subject: body.subject, size: own.length + joined.length, participants: [...own, ...joined] };
      this.groups.set(tenantId, [...(this.groups.get(tenantId) ?? []), group]);
      return { status: 201, body: { success: true, group } };
    }
    const manage = /^\/groups\/([^/]+)\/(participants|subject|description|invite|invite\/revoke)$/.exec(path);
    if (manage) {
      const jid = decodeURIComponent(manage[1]!);
      const group = (this.groups.get(tenantId) ?? []).find((item) => item.id === jid);
      if (!group) return { status: 404, body: { success: false, error: "WhatsApp group not found for this device" } };
      const body = raw.length ? (JSON.parse(raw.toString("utf8")) as Record<string, unknown>) : {};
      this.groupCalls.push({ method: request.method ?? "", path: manage[2]!, body });
      if (manage[2] === "participants" && request.method === "POST") {
        const updates = (body.participants as string[]).map((digits) => {
          const member = `${digits}@s.whatsapp.net`;
          if (body.action === "remove") {
            const index = group.participants.findIndex((item) => item.jid === member);
            if (index < 0) return { jid: member, status: "404" };
            group.participants.splice(index, 1);
            return { jid: member, status: "200" };
          }
          const status = this.participantStatus.get(digits) ?? "200";
          if (status === "200") group.participants.push({ jid: member, admin: null, phoneJid: null, lidJid: null });
          return { jid: member, status };
        });
        group.size = group.participants.length;
        return { status: 200, body: { success: true, updates, group } };
      }
      if (manage[2] === "subject" && request.method === "PATCH") {
        group.subject = String(body.subject);
        return { status: 200, body: { success: true } };
      }
      if (manage[2] === "description" && request.method === "PATCH") return { status: 200, body: { success: true } };
      if (manage[2] === "invite" && request.method === "GET") {
        const code = this.inviteCodes.get(jid) ?? "KODEAWAL";
        this.inviteCodes.set(jid, code);
        return { status: 200, body: { success: true, code } };
      }
      if (manage[2] === "invite/revoke" && request.method === "POST") {
        const code = `KODE${randomUUID().slice(0, 6)}`;
        this.inviteCodes.set(jid, code);
        return { status: 200, body: { success: true, code } };
      }
    }
    if (request.method === "GET" && path === "/groups") {
      return { status: 200, body: { groups: this.groups.get(tenantId) ?? [] } };
    }
    const groupSend = /^\/groups\/([^/]+)\/messages$/.exec(path);
    if (request.method === "POST" && groupSend) {
      const jid = decodeURIComponent(groupSend[1]!);
      if (!(this.groups.get(tenantId) ?? []).some((group) => group.id === jid)) {
        return { status: 404, body: { success: false, error: "WhatsApp group not found for this device" } };
      }
      const key = idempotencyKey ?? "";
      this.sendsByKey.set(key, (this.sendsByKey.get(key) ?? 0) + 1);
      const messageId = this.messageIdByKey.get(key) ?? randomUUID();
      this.messageIdByKey.set(key, messageId);
      return { status: 200, body: { success: true, messageId, to: jid } };
    }
    if (request.method === "GET" && path === "/contacts") {
      const all = this.contacts.get(tenantId) ?? [];
      const page = Number(url.searchParams.get("page") ?? "1");
      const size = Number(url.searchParams.get("pageSize") ?? "100");
      return {
        status: 200,
        body: { contacts: all.slice((page - 1) * size, page * size), pagination: { page, pageSize: size, total: all.length, totalPages: Math.max(1, Math.ceil(all.length / size)) } },
      };
    }
    if (path.startsWith("/history-imports")) {
      if (!this.historyRoutes) return { status: 404, body: {} };
      if (request.method === "POST" && path === "/history-imports") {
        if (this.historyBusy > 0) {
          this.historyBusy -= 1;
          return { status: 409, body: { success: false, code: "import_active", error: "A history import is already awaiting this device's provider sync" } };
        }
        const body = JSON.parse(raw.toString("utf8")) as { chatJid: string };
        const id = randomUUID();
        this.history.set(id, { status: "completed", chatJid: body.chatJid, messages: [] });
        return { status: 202, body: { success: true, historyImport: { id, status: "awaiting" } } };
      }
      const status = /^\/history-imports\/([^/]+)$/.exec(path);
      if (request.method === "GET" && status) {
        const record = this.history.get(decodeURIComponent(status[1]!));
        return record ? { status: 200, body: { historyImport: { id: status[1], status: record.status } } } : { status: 404, body: {} };
      }
      const list = /^\/history-imports\/([^/]+)\/messages$/.exec(path);
      if (request.method === "GET" && list) {
        const record = this.history.get(decodeURIComponent(list[1]!));
        if (!record) return { status: 404, body: {} };
        const page = Number(url.searchParams.get("page") ?? "1");
        const size = Number(url.searchParams.get("pageSize") ?? "100");
        const messages = record.messages.length ? record.messages : (this.pendingHistory.get(record.chatJid) ?? []);
        return {
          status: 200,
          body: { messages: messages.slice((page - 1) * size, page * size), pagination: { page, pageSize: size, totalPages: Math.max(1, Math.ceil(messages.length / size)) } },
        };
      }
    }
    if (request.method === "GET" && path === "/events") {
      const after = Number(url.searchParams.get("after") ?? "0");
      const limit = Number(url.searchParams.get("limit") ?? "100");
      const own = this.events.filter((event) => event.deviceId === tenant.engineDeviceId && event.cursor > after);
      const page = own.slice(0, limit);
      // The page is already decided; anything added from here on belongs to a later pull.
      if (this.onEventsRead) await this.onEventsRead();
      return { status: 200, body: { events: page, nextCursor: page.at(-1)?.cursor ?? after, hasMore: own.length > limit } };
    }
    return { status: 404, body: {} };
  }
}

/** JalurPesan `message.received` payload (version 1 text, version 2 media). */
export function receivedPayload(input: { id?: string; from?: string; body?: string | null; group?: boolean; media?: { id: string; sizeBytes: number; mimeType?: string }; whatsappMessageId?: string; extra?: Record<string, unknown> }) {
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
      whatsappMessageId: input.whatsappMessageId ?? randomUUID(),
      status: "received",
      receivedAt: new Date().toISOString(),
      ...input.extra,
      ...(input.media
        ? { media: { id: input.media.id, mediaType: "document", mimeType: input.media.mimeType ?? "application/pdf", sizeBytes: input.media.sizeBytes, sha256: null, originalFilename: "berkas.pdf" } }
        : {}),
    },
  };
}

/** Like JalurPesan: the send answer's messageId is the WhatsApp id; receipts carry the engine's own id plus that WhatsApp id. */
export function receiptPayload(whatsappMessageId: string, status: "delivered" | "read") {
  return { version: 1, message: { id: randomUUID(), deviceId: "engine", direction: "outbound", whatsappMessageId, status } };
}

/** J-1: a message typed on the number's phone, as the engine reports it (`message.sent`). */
export function sentPayload(input: { to?: string; body?: string; group?: boolean; whatsappMessageId?: string }) {
  const chatJid = input.group ? "120363000000@g.us" : input.to ?? "6281234567890@s.whatsapp.net";
  return {
    version: 1,
    message: {
      id: randomUUID(),
      deviceId: "engine",
      direction: "outbound",
      chatJid,
      recipientJid: chatJid,
      recipientType: input.group ? "group" : "individual",
      messageType: "text",
      body: input.body ?? "Wa'alaikumsalam, silakan daftar lewat tautan ini",
      whatsappMessageId: input.whatsappMessageId ?? randomUUID(),
      status: "sent",
      sentAt: new Date().toISOString(),
    },
  };
}
