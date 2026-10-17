import {
  ProviderOperationError,
  type DeviceRef,
  type KirimProvider,
  type MediaFile,
  type PairingResult,
  type ProviderDeviceStatus,
  type ProviderEventPage,
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
    return this.sendMessage(device, { to: to.phoneDigits, message: text }, idempotencyKey);
  }

  async sendDocument(
    device: DeviceRef,
    to: Recipient,
    file: MediaFile,
    caption: string | null,
    idempotencyKey: string,
  ): Promise<SendResult> {
    let engineMediaId = await this.mediaRefs.get(file.mediaId, device.id);
    if (!engineMediaId) {
      const uploaded = await this.upload(device, file);
      if (!uploaded.ok) return uploaded.result;
      engineMediaId = uploaded.mediaId;
      await this.mediaRefs.put(file.mediaId, device.id, engineMediaId);
    }
    const result = await this.sendMessage(
      device,
      { to: to.phoneDigits, mediaId: engineMediaId, ...(caption ? { caption } : {}) },
      idempotencyKey,
      async () => {
        // The engine no longer holds the file: forget the reference and upload again on retry.
        await this.mediaRefs.remove(file.mediaId, device.id);
      },
    );
    return result;
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
      response = await this.request("POST", this.url(device, "/media?type=document"), { form });
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
