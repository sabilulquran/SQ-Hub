import { createHash, randomUUID } from "node:crypto";

import type { Pool } from "pg";

import { columnAad, maskPhone, type KirimCrypto } from "./crypto.js";
import { advanceStatus, type OutboundStatus } from "./policy.js";
import type { KirimLog } from "./providers/log.js";
import {
  ProviderOperationError,
  type DeviceRef,
  type KirimProvider,
  type ProviderDeviceStatus,
  type ProviderEvent,
} from "./providers/types.js";
import {
  dbNow,
  enqueueWebhook,
  ensureConversation,
  setDeviceStatus,
  transitionOutbox,
  withTransaction,
} from "./repository.js";
import type { KirimService } from "./service.js";

/** KIRIM-IMPL-001 §6.3: engine events into stored conversations and consumer webhooks. */

const PAGE_LIMIT = 100;
const MAX_PAGES_PER_PULL = 10;

interface EngineDevice extends DeviceRef {
  pemilikConsumerId: string;
  status: string;
}

const TIPE_BY_ENGINE: Record<string, string> = {
  text: "teks",
  document: "dokumen",
  image: "gambar",
  audio: "audio",
  video: "video",
  sticker: "stiker",
};

export class KirimIngest {
  /** Engine device id → Kirim device id, learnt from status calls, to route engine webhooks. */
  private readonly engineDevices = new Map<string, string>();
  private readonly pulling = new Map<string, Promise<void>>();

  constructor(
    private readonly pool: Pool,
    private readonly crypto: KirimCrypto,
    private readonly service: KirimService,
    private readonly provider: KirimProvider,
    private readonly options: { inboundMediaMaxBytes: number; log?: KirimLog },
  ) {}

  /** Every 60 s and at start: refresh each `jalurpesan` number's status, then pull its events. */
  async runOnce(): Promise<void> {
    for (const device of await this.devices()) {
      try {
        await this.refreshStatus(device);
        await this.pullDevice(device.id);
      } catch (error) {
        this.options.log?.(
          { event: "kirim.ingest.failed", device: device.kode, code: error instanceof ProviderOperationError ? error.code : "error" },
          "kirim event pull failed; retrying next round",
        );
      }
    }
  }

  async refreshStatus(device: EngineDevice): Promise<ProviderDeviceStatus> {
    const state = await this.provider.deviceStatus(device);
    if (state.engineDeviceId) this.engineDevices.set(state.engineDeviceId, device.id);
    await withTransaction(this.pool, async (client) => {
      if (state.phoneDigits) {
        const masked = maskPhone(`+${state.phoneDigits}`);
        await client.query(
          `UPDATE kirim_devices SET nomor_tersamar = $2, nomor_enc = $3, updated_at = now()
           WHERE id = $1 AND nomor_tersamar IS DISTINCT FROM $2`,
          [device.id, masked, this.crypto.seal(`pn:+${state.phoneDigits}`, columnAad("kirim_devices", "nomor_enc", device.id))],
        );
      }
      await setDeviceStatus(client, this.crypto, device.id, state.status);
    });
    return state;
  }

  /**
   * An engine webhook only speeds things up: the event is ingested by pulling from the stored
   * cursor, so a webhook can never move the cursor past an event that was missed.
   */
  async handleEngineWebhook(input: { eventId: string; engineDeviceId: string }): Promise<"duplicate" | "queued" | "unknown_tenant"> {
    const known = await this.pool.query("SELECT 1 FROM kirim_events WHERE provider = 'jalurpesan' AND provider_event_id = $1", [input.eventId]);
    if ((known.rowCount ?? 0) > 0) return "duplicate";
    let deviceId = this.engineDevices.get(input.engineDeviceId);
    if (!deviceId) {
      for (const device of await this.devices()) {
        const state = await this.provider.deviceStatus(device).catch(() => null);
        if (state?.engineDeviceId) this.engineDevices.set(state.engineDeviceId, device.id);
      }
      deviceId = this.engineDevices.get(input.engineDeviceId);
    }
    if (!deviceId) {
      this.options.log?.({ event: "kirim.ingest.unknown_tenant" }, "engine event from an unknown tenant discarded");
      return "unknown_tenant";
    }
    void this.pullDevice(deviceId).catch(() => undefined);
    return "queued";
  }

  /** Pulls one number's events from its last stored cursor. Concurrent calls share one pull. */
  pullDevice(deviceId: string): Promise<void> {
    const running = this.pulling.get(deviceId);
    if (running) return running;
    const pull = this.pullPages(deviceId).finally(() => this.pulling.delete(deviceId));
    this.pulling.set(deviceId, pull);
    return pull;
  }

  private async pullPages(deviceId: string): Promise<void> {
    const device = (await this.devices()).find((item) => item.id === deviceId);
    if (!device) return;
    for (let page = 0; page < MAX_PAGES_PER_PULL; page += 1) {
      const cursorRow = await this.pool.query<{ cursor: string | null }>(
        "SELECT max(provider_cursor)::text AS cursor FROM kirim_events WHERE device_id = $1 AND provider = 'jalurpesan'",
        [device.id],
      );
      const cursor = Number(cursorRow.rows[0]?.cursor ?? 0);
      const result = await this.provider.pullEvents(device, cursor, PAGE_LIMIT);
      for (const event of result.events) await this.processEvent(device, event);
      if (!result.hasMore || result.events.length === 0) return;
    }
  }

  async processEvent(device: EngineDevice, event: ProviderEvent): Promise<void> {
    const seen = await this.pool.query("SELECT 1 FROM kirim_events WHERE provider = 'jalurpesan' AND provider_event_id = $1", [event.eventId]);
    if ((seen.rowCount ?? 0) > 0) return;
    const message = readMessage(event.payload);

    // Media is copied before the transaction so no network call holds database locks.
    let media: MediaCopy | null = null;
    if (event.type === "message.received" && message && !message.group && message.media) {
      media = await this.copyMedia(device, message.media);
    }

    await withTransaction(this.pool, async (client) => {
      const recorded = await client.query(
        `INSERT INTO kirim_events (id, device_id, provider, provider_event_id, provider_cursor, jenis, payload_ringkas)
         VALUES ($1, $2, 'jalurpesan', $3, $4, $5, $6::jsonb)
         ON CONFLICT (provider, provider_event_id) DO NOTHING`,
        [
          randomUUID(),
          device.id,
          event.eventId,
          event.cursor,
          event.type.slice(0, 100),
          JSON.stringify({ provider_message_id: message?.id ?? null, tipe: message?.messageType ?? null, grup: message?.group ?? false }),
        ],
      );
      if ((recorded.rowCount ?? 0) === 0 || !message) return;

      if (event.type === "message.received") {
        if (message.group || message.direction !== "inbound") return;
        const contact = contactFromJid(message.senderJid ?? message.chatJid);
        if (!contact) return;
        const conversationId = await ensureConversation(client, this.crypto, { deviceId: device.id, canonical: contact.canonical, jenis: contact.jenis });
        const messageId = randomUUID();
        let mediaId: string | null = null;
        if (media) {
          mediaId = randomUUID();
          const path = media.data ? await this.service.writeMediaFile(mediaId, media.data, await dbNow(client)) : null;
          await client.query(
            `INSERT INTO kirim_media (id, device_id, arah, mime, ukuran, sha256, path, dienkripsi, tidak_disalin, provider_media_id)
             VALUES ($1, $2, 'masuk', $3, $4, $5, $6, $7, $8, $9)`,
            [mediaId, device.id, media.mime, media.size, media.sha256, path, path !== null, media.reason, media.providerMediaId],
          );
        }
        const inserted = await client.query(
          `INSERT INTO kirim_messages (id, conversation_id, device_id, arah, tipe, body_enc, media_id, provider, provider_message_id, status, provider_at)
           VALUES ($1, $2, $3, 'masuk', $4, $5, $6, 'jalurpesan', $7, 'diterima', $8)
           ON CONFLICT (provider, device_id, provider_message_id) WHERE provider_message_id IS NOT NULL DO NOTHING`,
          [
            messageId,
            conversationId,
            device.id,
            TIPE_BY_ENGINE[message.messageType] ?? "lainnya",
            message.body ? this.crypto.seal(message.body, columnAad("kirim_messages", "body_enc", messageId)) : null,
            mediaId,
            message.id,
            message.receivedAt,
          ],
        );
        if ((inserted.rowCount ?? 0) === 0) return;
        await client.query(
          "UPDATE kirim_conversations SET belum_dibaca = belum_dibaca + 1, pesan_terakhir_at = greatest(coalesce(pesan_terakhir_at, $2), $2) WHERE id = $1",
          [conversationId, message.receivedAt],
        );
        await enqueueWebhook(client, this.crypto, device.pemilikConsumerId, "message.received", {
          device: device.kode,
          conversation_id: conversationId,
          message_id: messageId,
          from: contact.jenis === "pn" ? contact.canonical.slice(3) : null,
          nama_profil: null,
          tipe: TIPE_BY_ENGINE[message.messageType] ?? "lainnya",
          cuplikan: message.body ? message.body.slice(0, 200) : null,
          received_at: message.receivedAt,
        });
        return;
      }

      if (event.type === "message.delivered" || event.type === "message.read") {
        // A JalurPesan send answers with the WhatsApp message id, which Kirim stores as provider_message_id;
        // receipts carry JalurPesan's own id plus that WhatsApp id, so match on both.
        const ids = [message.whatsappMessageId, message.id].filter((id): id is string => Boolean(id));
        const outbox = await client.query<{ id: string; status: OutboundStatus }>(
          `SELECT o.id, o.status FROM kirim_messages m JOIN kirim_outbox o ON o.message_id = m.id
           WHERE m.provider = 'jalurpesan' AND m.device_id = $1 AND m.provider_message_id = ANY($2::text[]) AND m.arah = 'keluar'
           FOR UPDATE OF o`,
          [device.id, ids],
        );
        const row = outbox.rows[0];
        if (!row) return;
        const next = advanceStatus(row.status, event.type === "message.read" ? "dibaca" : "terkirim");
        if (!next) return;
        await transitionOutbox(client, this.crypto, { outboxId: row.id, fromStatuses: [row.status], status: next, errorCode: null });
      }
    });
  }

  private async copyMedia(device: EngineDevice, media: EngineMedia): Promise<MediaCopy> {
    const base = { mime: media.mimeType, size: media.sizeBytes, sha256: media.sha256, providerMediaId: media.id };
    if (media.sizeBytes > this.options.inboundMediaMaxBytes) return { ...base, data: null, reason: "terlalu_besar" };
    if (await this.service.lowDisk()) return { ...base, data: null, reason: "disk_rendah" };
    try {
      const data = await this.provider.downloadMedia(device, media.id, this.options.inboundMediaMaxBytes);
      if (!data) return { ...base, data: null, reason: "terlalu_besar" };
      return { ...base, size: data.length, sha256: createHash("sha256").update(data).digest("hex"), data, reason: null };
    } catch {
      return { ...base, data: null, reason: "gagal_unduh" };
    }
  }

  private async devices(): Promise<EngineDevice[]> {
    const result = await this.pool.query<EngineDevice>(
      `SELECT id, kode, provider_ref AS "providerRef", pemilik_consumer_id AS "pemilikConsumerId", status
       FROM kirim_devices WHERE provider = 'jalurpesan' AND status <> 'nonaktif' AND provider_ref IS NOT NULL ORDER BY kode`,
    );
    return result.rows;
  }
}

interface EngineMedia {
  id: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string | null;
}

interface MediaCopy {
  mime: string;
  size: number;
  sha256: string | null;
  providerMediaId: string;
  data: Buffer | null;
  reason: "terlalu_besar" | "disk_rendah" | "gagal_unduh" | null;
}

interface EngineMessage {
  id: string;
  whatsappMessageId: string | null;
  direction: string;
  chatJid: string;
  senderJid: string | null;
  group: boolean;
  messageType: string;
  body: string | null;
  receivedAt: string;
  media: EngineMedia | null;
}

/** Reads the JalurPesan event payload (`{ version, message: {...} }`) defensively. */
function readMessage(payload: unknown): EngineMessage | null {
  if (!payload || typeof payload !== "object") return null;
  const message = (payload as { message?: unknown }).message;
  if (!message || typeof message !== "object") return null;
  const value = message as Record<string, unknown>;
  if (typeof value.id !== "string" || !value.id) return null;
  const chatJid = typeof value.chatJid === "string" ? value.chatJid : "";
  const media = value.media && typeof value.media === "object" ? (value.media as Record<string, unknown>) : null;
  return {
    id: value.id,
    whatsappMessageId: typeof value.whatsappMessageId === "string" && value.whatsappMessageId ? value.whatsappMessageId : null,
    direction: typeof value.direction === "string" ? value.direction : "",
    chatJid,
    senderJid: typeof value.senderJid === "string" ? value.senderJid : null,
    group: value.recipientType === "group" || chatJid.endsWith("@g.us"),
    messageType: typeof value.messageType === "string" ? value.messageType : "lainnya",
    body: typeof value.body === "string" && value.body.length > 0 ? value.body : null,
    receivedAt: typeof value.receivedAt === "string" && !Number.isNaN(Date.parse(value.receivedAt)) ? value.receivedAt : new Date().toISOString(),
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

/** D-6: phone JIDs become `pn:+<digits>`; LID-only contacts become `lid:<jid>`. */
export function contactFromJid(jid: string): { canonical: string; jenis: "pn" | "lid" } | null {
  const normalized = jid.trim().toLowerCase();
  const phone = /^(\d{8,15})(?::\d+)?@s\.whatsapp\.net$/.exec(normalized);
  if (phone) return { canonical: `pn:+${phone[1]}`, jenis: "pn" };
  if (/^[0-9a-z._:-]{1,100}@lid$/.test(normalized)) return { canonical: `lid:${normalized}`, jenis: "lid" };
  return null;
}
