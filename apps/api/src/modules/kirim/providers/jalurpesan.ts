import {
  ProviderOperationError,
  type DeviceRef,
  type GroupContent,
  type KirimProvider,
  type MediaFile,
  type PairingResult,
  type ProviderContactPage,
  type ProviderDeviceStatus,
  type ProviderEventPage,
  type ProviderGroup,
  type ProviderHistoryMessage,
  type ProviderHistoryStatus,
  type ReadReceiptKey,
  type Recipient,
  type SendResult,
} from "./types.js";

/** Cache of engine `mediaId` per Kirim media and number, so a retry never uploads again (§3.2). */
export interface EngineMediaRefs {
  get(mediaId: string, deviceId: string): Promise<string | null>;
  put(mediaId: string, deviceId: string, providerMediaId: string): Promise<void>;
  remove(mediaId: string, deviceId: string): Promise<void>;
}

export const JALURPESAN_TIMEOUT_MS = 15_000;
const CAPACITY_ERROR = "Configured active device safety cap reached";

interface EngineResponse {
  status: number;
  body: Record<string, unknown>;
}

class EngineUnavailable extends Error {}

/**
 * JalurPesan platform adapter (§3.2), one tenant per Kirim SQ number under platform `sq-core`.
 * QR data-URLs and pairing codes are returned to the caller only; this adapter never logs.
 */
export class JalurPesanProvider implements KirimProvider {
  readonly name = "jalurpesan" as const;

  constructor(
    private readonly options: { baseUrl: string; platformKey: string; timeoutMs?: number },
    private readonly mediaRefs: EngineMediaRefs,
  ) {}

  async provision(device: DeviceRef, label: string): Promise<void> {
    const response = await this.lifecycle("PUT", device, "/device", { name: label.slice(0, 100) });
    if (response.status === 200 || response.status === 201) return;
    throw this.lifecycleError(response);
  }

  async deviceStatus(device: DeviceRef): Promise<ProviderDeviceStatus> {
    const response = await this.lifecycle("GET", device, "/device");
    if (response.status === 404) return { status: "belum_dipasang", qr: null, phoneDigits: null, engineDeviceId: null };
    if (response.status !== 200) throw this.lifecycleError(response);
    return mapDeviceState(response.body);
  }

  async startPairing(device: DeviceRef, mode: "qr" | { phone: string }): Promise<PairingResult> {
    if (mode === "qr") {
      const connected = await this.lifecycle("POST", device, "/device/connect");
      if (connected.status !== 200) throw this.lifecycleError(connected);
      const state = await this.deviceStatus(device);
      return { mode: "qr", qr: state.qr };
    }
    const phone = mode.phone.replace(/\D/g, "");
    if (!/^\d{8,15}$/.test(phone)) throw new ProviderOperationError("engine_rejected", "pairing phone must be 8-15 digits");
    const response = await this.lifecycle("POST", device, "/device/pairing-code", { phone });
    if (response.status !== 200 || typeof response.body.pairingCode !== "string") throw this.lifecycleError(response);
    return { mode: "kode", pairingCode: response.body.pairingCode };
  }

  async disconnect(device: DeviceRef): Promise<void> {
    const response = await this.lifecycle("POST", device, "/device/logout");
    if (response.status !== 200) throw this.lifecycleError(response);
  }

  async sendText(device: DeviceRef, to: Recipient, text: string, idempotencyKey: string): Promise<SendResult> {
    return this.sendMessage(device, { ...target(to), message: text }, idempotencyKey);
  }

  async sendDocument(
    device: DeviceRef,
    to: Recipient,
    file: MediaFile,
    caption: string | null,
    idempotencyKey: string,
  ): Promise<SendResult> {
    const engineMediaId = await this.engineMedia(device, file);
    if (typeof engineMediaId !== "string") return engineMediaId;
    return this.sendMessage(
      device,
      { ...target(to), mediaId: engineMediaId, ...(caption ? { caption } : {}) },
      idempotencyKey,
      () => this.forgetMedia(device, file),
    );
  }

  /** KIRIM-IMPL-002 §6.2. The group answer carries the WhatsApp message id like a private send. */
  async sendGroup(device: DeviceRef, groupJid: string, content: GroupContent, idempotencyKey: string): Promise<SendResult> {
    let body: Record<string, unknown>;
    let onMediaMissing: (() => Promise<void>) | undefined;
    if ("text" in content) {
      body = { message: content.text };
    } else {
      const engineMediaId = await this.engineMedia(device, content.file);
      if (typeof engineMediaId !== "string") return engineMediaId;
      body = { mediaId: engineMediaId, ...(content.caption ? { caption: content.caption } : {}) };
      onMediaMissing = () => this.forgetMedia(device, content.file);
    }
    let response: EngineResponse;
    try {
      response = await this.request("POST", this.url(device, `/groups/${encodeURIComponent(groupJid)}/messages`), {
        json: body,
        headers: { "idempotency-key": idempotencyKey },
      });
    } catch {
      return { ok: false, kind: "retryable", code: "engine_unavailable" };
    }
    // The number left the group or the group is gone: retrying cannot help.
    if (response.status === 404 && typeof response.body.error === "string" && response.body.error.startsWith("WhatsApp group not found")) {
      return { ok: false, kind: "rejected", code: "engine_rejected" };
    }
    return mapSendResponse(response, onMediaMissing);
  }

  async markRead(device: DeviceRef, messages: ReadReceiptKey[]): Promise<void> {
    for (let index = 0; index < messages.length; index += 100) {
      const response = await this.lifecycle("POST", device, "/messages/read", { messages: messages.slice(index, index + 100) });
      if (response.status !== 200) throw this.lifecycleError(response);
    }
  }

  async listGroups(device: DeviceRef): Promise<ProviderGroup[]> {
    const response = await this.lifecycle("GET", device, "/groups");
    if (response.status !== 200 || !Array.isArray(response.body.groups)) throw this.lifecycleError(response);
    return (response.body.groups as Array<Record<string, unknown>>).flatMap((group) =>
      typeof group.id === "string"
        ? [{
            jid: group.id,
            name: typeof group.subject === "string" ? group.subject.slice(0, 200) : "",
            size: typeof group.size === "number" ? group.size : null,
            participants: Array.isArray(group.participants)
              ? (group.participants as Array<Record<string, unknown>>).flatMap((participant) =>
                  typeof participant.jid === "string" ? [{ jid: participant.jid, admin: participant.admin === "admin" || participant.admin === "superadmin" }] : [],
                )
              : [],
          }]
        : [],
    );
  }

  async listContacts(device: DeviceRef, page: number): Promise<ProviderContactPage> {
    const response = await this.lifecycle("GET", device, `/contacts?page=${page}&pageSize=200`);
    if (response.status !== 200 || !Array.isArray(response.body.contacts)) throw this.lifecycleError(response);
    const pagination = (response.body.pagination ?? {}) as Record<string, unknown>;
    return {
      contacts: (response.body.contacts as Array<Record<string, unknown>>).flatMap((contact) =>
        typeof contact.jid === "string"
          ? [{
              jid: contact.jid,
              canonicalJid: typeof contact.canonicalJid === "string" ? contact.canonicalJid : contact.jid,
              displayName: typeof contact.displayName === "string" && contact.displayName.trim() ? contact.displayName.trim().slice(0, 200) : null,
            }]
          : [],
      ),
      hasMore: typeof pagination.totalPages === "number" && page < pagination.totalPages,
    };
  }

  /** J-2 platform routes (KIRIM-IMPL-002 §2); a 404 on the route means the engine predates J-2. */
  async requestHistory(device: DeviceRef, chatJid: string, maxMessages: number): Promise<{ importId: string }> {
    const response = await this.lifecycle("POST", device, "/history-imports", { chatJid, maxMessages });
    const record = (response.body.historyImport ?? {}) as Record<string, unknown>;
    if (response.status === 202 && typeof record.id === "string") return { importId: record.id };
    throw this.lifecycleError(response);
  }

  async historyStatus(device: DeviceRef, importId: string): Promise<ProviderHistoryStatus> {
    const response = await this.lifecycle("GET", device, `/history-imports/${encodeURIComponent(importId)}`);
    if (response.status !== 200) throw this.lifecycleError(response);
    const record = (response.body.historyImport ?? {}) as Record<string, unknown>;
    if (record.status === "completed") return { status: "completed" };
    if (record.status === "failed") return { status: "failed", reason: typeof record.error === "string" ? record.error.slice(0, 200) : "failed" };
    return { status: "awaiting" };
  }

  async historyMessages(device: DeviceRef, importId: string, page: number): Promise<{ messages: ProviderHistoryMessage[]; hasMore: boolean }> {
    const response = await this.lifecycle("GET", device, `/history-imports/${encodeURIComponent(importId)}/messages?page=${page}&pageSize=100`);
    if (response.status !== 200 || !Array.isArray(response.body.messages)) throw this.lifecycleError(response);
    const pagination = (response.body.pagination ?? {}) as Record<string, unknown>;
    return {
      messages: (response.body.messages as unknown[]).flatMap((item) => {
        const message = readHistoryMessage(item);
        return message ? [message] : [];
      }),
      hasMore: typeof pagination.totalPages === "number" && page < pagination.totalPages,
    };
  }

  private async engineMedia(device: DeviceRef, file: MediaFile): Promise<string | SendResult> {
    const cached = await this.mediaRefs.get(file.mediaId, device.id);
    if (cached) return cached;
    const uploaded = await this.upload(device, file);
    if (!uploaded.ok) return uploaded.result;
    await this.mediaRefs.put(file.mediaId, device.id, uploaded.mediaId);
    return uploaded.mediaId;
  }

  /** The engine no longer holds the file: forget the reference and upload again on retry. */
  private async forgetMedia(device: DeviceRef, file: MediaFile): Promise<void> {
    await this.mediaRefs.remove(file.mediaId, device.id);
  }

  async pullEvents(device: DeviceRef, cursor: number, limit: number): Promise<ProviderEventPage> {
    const response = await this.lifecycle("GET", device, `/events?after=${cursor}&limit=${limit}`);
    if (response.status === 404) throw new ProviderOperationError("device_not_found", "tenant device not found");
    if (response.status !== 200 || !Array.isArray(response.body.events)) throw this.lifecycleError(response);
    const events = (response.body.events as Array<Record<string, unknown>>).flatMap((event) =>
      typeof event.eventId === "string" && typeof event.cursor === "number" && typeof event.type === "string"
        ? [{
            eventId: event.eventId,
            cursor: event.cursor,
            type: event.type,
            engineDeviceId: typeof event.deviceId === "string" ? event.deviceId : "",
            messageId: typeof event.messageId === "string" ? event.messageId : null,
            occurredAt: typeof event.occurredAt === "string" ? event.occurredAt : new Date().toISOString(),
            payload: event.payload,
          }]
        : [],
    );
    return {
      events,
      nextCursor: typeof response.body.nextCursor === "number" ? response.body.nextCursor : cursor,
      hasMore: response.body.hasMore === true,
    };
  }

  async downloadMedia(device: DeviceRef, providerMediaId: string, maxBytes: number): Promise<Buffer | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.url(device, `/media/${encodeURIComponent(providerMediaId)}`), {
        headers: { authorization: `Bearer ${this.options.platformKey}` },
        signal: controller.signal,
        redirect: "manual",
      });
      if (response.status !== 200 || !response.body) {
        await response.body?.cancel();
        throw new ProviderOperationError(response.status >= 500 ? "engine_unavailable" : "engine_rejected", `media download returned ${response.status}`);
      }
      const declared = Number(response.headers.get("content-length") ?? "NaN");
      if (Number.isFinite(declared) && declared > maxBytes) {
        await response.body.cancel();
        return null;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of response.body) {
        total += chunk.length;
        if (total > maxBytes) {
          controller.abort();
          return null;
        }
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } catch (error) {
      if (error instanceof ProviderOperationError) throw error;
      throw new ProviderOperationError("engine_unavailable", "media download failed");
    } finally {
      clearTimeout(timer);
    }
  }

  private get timeoutMs(): number {
    return this.options.timeoutMs ?? JALURPESAN_TIMEOUT_MS;
  }

  private url(device: DeviceRef, path: string): string {
    if (!device.providerRef) throw new ProviderOperationError("engine_rejected", "number has no JalurPesan tenant");
    return `${this.options.baseUrl}/api/v1/platform/tenants/${encodeURIComponent(device.providerRef)}${path}`;
  }

  private async request(
    method: string,
    url: string,
    init: { json?: unknown; form?: FormData; headers?: Record<string, string> } = {},
  ): Promise<EngineResponse> {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${this.options.platformKey}`,
          ...(init.json !== undefined ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
        ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : init.form ? { body: init.form } : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: "manual",
      });
      const text = await response.text();
      let body: Record<string, unknown> = {};
      try {
        const parsed = text ? JSON.parse(text) : {};
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
      } catch {
        body = {};
      }
      return { status: response.status, body };
    } catch {
      throw new EngineUnavailable("engine request failed");
    }
  }

  private async lifecycle(method: string, device: DeviceRef, path: string, json?: unknown): Promise<EngineResponse> {
    try {
      return await this.request(method, this.url(device, path), json === undefined ? {} : { json });
    } catch (error) {
      if (error instanceof EngineUnavailable) throw new ProviderOperationError("engine_unavailable", "JalurPesan is unavailable");
      throw error;
    }
  }

  private lifecycleError(response: EngineResponse): ProviderOperationError {
    if (response.status === 404) return new ProviderOperationError("device_not_found", "tenant device not found");
    if (response.status === 409 && response.body.error === CAPACITY_ERROR) {
      return new ProviderOperationError("engine_capacity", "JalurPesan device capacity reached");
    }
    if (response.status === 409 && response.body.recoveryAction === "reset") {
      return new ProviderOperationError("session_reset_required", "WhatsApp session must be reset");
    }
    if (response.status >= 500) return new ProviderOperationError("engine_unavailable", `JalurPesan returned ${response.status}`);
    return new ProviderOperationError("engine_rejected", `JalurPesan returned ${response.status}`);
  }

  private async upload(device: DeviceRef, file: MediaFile): Promise<{ ok: true; mediaId: string } | { ok: false; result: SendResult }> {
    const form = new FormData();
    form.append("file", new Blob([await file.data()], { type: file.mime }), file.filename);
    let response: EngineResponse;
    try {
      response = await this.request("POST", this.url(device, `/media?type=${file.kind ?? "document"}`), { form });
    } catch {
      return { ok: false, result: { ok: false, kind: "retryable", code: "engine_unavailable" } };
    }
    if (response.status === 201 && typeof response.body.mediaId === "string") return { ok: true, mediaId: response.body.mediaId };
    if (response.status === 404) return { ok: false, result: { ok: false, kind: "device", code: "device_disconnected" } };
    if (response.status >= 500 || response.status === 429) {
      return { ok: false, result: { ok: false, kind: "retryable", code: "engine_unavailable" } };
    }
    return { ok: false, result: { ok: false, kind: "rejected", code: "engine_rejected" } };
  }

  private async sendMessage(
    device: DeviceRef,
    body: Record<string, unknown>,
    idempotencyKey: string,
    onMediaMissing?: () => Promise<void>,
  ): Promise<SendResult> {
    let response: EngineResponse;
    try {
      response = await this.request("POST", this.url(device, "/messages"), {
        json: body,
        headers: { "idempotency-key": idempotencyKey },
      });
    } catch {
      return { ok: false, kind: "retryable", code: "engine_unavailable" };
    }
    return mapSendResponse(response, onMediaMissing);
  }
}

/** §3.2 send mapping. 429 (engine send safety) is treated as temporary; see PR notes. */
async function mapSendResponse(response: EngineResponse, onMediaMissing?: () => Promise<void>): Promise<SendResult> {
  const { status, body } = response;
  if (status === 200 && typeof body.messageId === "string" && body.messageId) {
    return { ok: true, providerMessageId: body.messageId, dryRun: false };
  }
  if (status === 404 && body.error === "Media not found" && onMediaMissing) {
    await onMediaMissing();
    return { ok: false, kind: "retryable", code: "engine_unavailable" };
  }
  if (status === 404) return { ok: false, kind: "device", code: "device_disconnected" };
  if (status === 409 && body.code === "idempotency_key_conflict") return { ok: false, kind: "rejected", code: "engine_conflict" };
  if (status === 409) return { ok: false, kind: "device", code: "device_disconnected" };
  if (status === 400 && typeof body.error === "string" && body.error.startsWith("Invalid recipient")) {
    return { ok: false, kind: "rejected", code: "invalid_number" };
  }
  if (status >= 500 || status === 429) return { ok: false, kind: "retryable", code: "engine_unavailable" };
  return { ok: false, kind: "rejected", code: "engine_rejected" };
}

function target(to: Recipient): { to: string } | { toJid: string } {
  return "jid" in to ? { toJid: to.jid } : { to: to.phoneDigits };
}

/** Reads one J-2 history message defensively; unknown shapes are skipped, never guessed. */
export function readHistoryMessage(item: unknown): ProviderHistoryMessage | null {
  if (!item || typeof item !== "object") return null;
  const value = item as Record<string, unknown>;
  if (typeof value.whatsappMessageId !== "string" || !value.whatsappMessageId || typeof value.chatJid !== "string") return null;
  if (value.direction !== "inbound" && value.direction !== "outbound") return null;
  const occurredAt = [value.occurredAt, value.receivedAt, value.sentAt, value.createdAt].find(
    (candidate): candidate is string => typeof candidate === "string" && !Number.isNaN(Date.parse(candidate)),
  );
  if (!occurredAt) return null;
  const media = value.media && typeof value.media === "object" ? (value.media as Record<string, unknown>) : null;
  return {
    whatsappMessageId: value.whatsappMessageId.slice(0, 200),
    direction: value.direction,
    chatJid: value.chatJid,
    senderJid: typeof value.senderJid === "string" ? value.senderJid : null,
    messageType: typeof value.messageType === "string" ? value.messageType : "lainnya",
    body: typeof value.body === "string" && value.body.length > 0 ? value.body : null,
    occurredAt,
    media: media && typeof media.id === "string"
      ? {
          id: media.id,
          mimeType: typeof media.mimeType === "string" ? media.mimeType.slice(0, 255) : "application/octet-stream",
          sizeBytes: typeof media.sizeBytes === "number" && media.sizeBytes >= 0 ? media.sizeBytes : 0,
          sha256: typeof media.sha256 === "string" && /^[0-9a-f]{64}$/.test(media.sha256) ? media.sha256 : null,
        }
      : null,
  };
}

function mapDeviceState(body: Record<string, unknown>): ProviderDeviceStatus {
  const device = (body.device ?? {}) as Record<string, unknown>;
  const live = (body.liveState ?? {}) as Record<string, unknown>;
  const everConnected = Boolean(device.pairedAt || device.lastConnectedAt || live.connectedAt);
  const status = live.status === "connected"
    ? "tersambung"
    : live.status === "qr"
      ? "menunggu_pairing"
      : live.status === "connecting"
        ? (everConnected ? "terputus" : "menunggu_pairing")
        : "terputus";
  const phone = typeof device.whatsappPhone === "string" && /^\d{8,15}$/.test(device.whatsappPhone)
    ? device.whatsappPhone
    : typeof live.jid === "string" ? (/^(\d{8,15})[:@]/.exec(live.jid)?.[1] ?? null) : null;
  return {
    status,
    qr: status === "menunggu_pairing" && typeof live.qr === "string" ? live.qr : null,
    phoneDigits: phone,
    engineDeviceId: typeof device.id === "string" ? device.id : null,
  };
}
