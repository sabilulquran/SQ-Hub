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
  type Queryable,
} from "./repository.js";
import type { KirimService } from "./service.js";

/**
 * KIRIM-IMPL-001 §6.3 and KIRIM-IMPL-002 §6.2, §7, §9: engine events into stored conversations
 * and groups, and the consumer webhooks that follow from them.
 */

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

/** The conversation an inbound message belongs to, and whether that conversation is keyed by the number. */
interface ResolvedConversation {
  id: string;
  keyedByPhone: boolean;
}

export class KirimIngest {
  /** Engine device id → Kirim device id, learnt from status calls, to route engine webhooks. */
  private readonly engineDevices = new Map<string, string>();
  private readonly pulling = new Map<string, Promise<void>>();
  /** Numbers that received a message from a group not yet named: refreshed right after the pull. */
  private readonly unnamedGroups = new Set<string>();

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
      if (!result.hasMore || result.events.length === 0) break;
    }
    if (this.unnamedGroups.delete(device.id)) {
      await this.refreshGroups(device).catch((error: unknown) => {
        this.options.log?.(
          { event: "kirim.groups.refresh_failed", device: device.kode, code: error instanceof ProviderOperationError ? error.code : "error" },
          "kirim directory refresh failed; retrying next round",
        );
      });
    }
  }

  async processEvent(device: EngineDevice, event: ProviderEvent): Promise<void> {
    const seen = await this.pool.query("SELECT 1 FROM kirim_events WHERE provider = 'jalurpesan' AND provider_event_id = $1", [event.eventId]);
    if ((seen.rowCount ?? 0) > 0) return;
    const message = readMessage(event.payload);

    // Media is copied before the transaction so no network call holds database locks.
    let media: MediaCopy | null = null;
    if ((event.type === "message.received" || event.type === "message.sent") && message?.media) {
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
        if (message.direction !== "inbound") return;
        if (message.group) {
          await this.storeGroupMessage(client, device, message, media);
          return;
        }
        const contact = contactFromJid(message.senderJid ?? message.chatJid);
        if (!contact) return;
        const resolved = await this.conversationFor(client, device.id, contact, message);
        const conversationId = resolved.id;
        await this.learnContact(client, resolved, contact, message);
        const messageId = randomUUID();
        const mediaId = await this.storeMedia(client, device, media, "masuk");
        const inserted = await client.query(
          `INSERT INTO kirim_messages (id, conversation_id, device_id, arah, tipe, body_enc, media_id, provider, provider_message_id, wa_message_id, status, provider_at)
           VALUES ($1, $2, $3, 'masuk', $4, $5, $6, 'jalurpesan', $7, $8, 'diterima', $9)
           ON CONFLICT (provider, device_id, provider_message_id) WHERE provider_message_id IS NOT NULL DO NOTHING`,
          [
            messageId,
            conversationId,
            device.id,
            TIPE_BY_ENGINE[message.messageType] ?? "lainnya",
            message.body ? this.crypto.seal(message.body, columnAad("kirim_messages", "body_enc", messageId)) : null,
            mediaId,
            message.id,
            message.whatsappMessageId,
            message.receivedAt,
          ],
        );
        if ((inserted.rowCount ?? 0) === 0) return;
        await client.query(
          `UPDATE kirim_conversations SET belum_dibaca = belum_dibaca + 1,
             pesan_terakhir_at = greatest(coalesce(pesan_terakhir_at, $2), $2),
             pesan_masuk_terakhir_at = greatest(coalesce(pesan_masuk_terakhir_at, $2), $2)
           WHERE id = $1`,
          [conversationId, message.receivedAt],
        );
        const from = await this.phoneOf(client, conversationId, contact);
        await enqueueWebhook(client, this.crypto, device.pemilikConsumerId, "message.received", {
          device: device.kode,
          conversation_id: conversationId,
          message_id: messageId,
          from,
          nama_profil: message.pushName,
          tipe: TIPE_BY_ENGINE[message.messageType] ?? "lainnya",
          cuplikan: message.body ? message.body.slice(0, 200) : null,
          received_at: message.receivedAt,
        });
        return;
      }

      // J-1: a message typed on the number's phone or another linked device, not sent through the API.
      if (event.type === "message.sent") {
        await this.storeDeviceSent(client, device, message, media);
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
        const incoming = event.type === "message.read" ? "dibaca" : "terkirim";
        if (!row) {
          // A message typed on the phone (J-1) has no outbox row; its status lives on the message.
          await this.advanceDeviceSent(client, device, ids, incoming);
          return;
        }
        const next = advanceStatus(row.status, incoming);
        if (!next) return;
        await transitionOutbox(client, this.crypto, { outboxId: row.id, fromStatuses: [row.status], status: next, errorCode: null });
      }
    });
  }

  private async storeMedia(client: Queryable, device: EngineDevice, media: MediaCopy | null, arah: "masuk" | "keluar"): Promise<string | null> {
    if (!media) return null;
    const mediaId = randomUUID();
    const path = media.data ? await this.service.writeMediaFile(mediaId, media.data, await dbNow(client)) : null;
    await client.query(
      `INSERT INTO kirim_media (id, device_id, arah, mime, ukuran, sha256, path, dienkripsi, tidak_disalin, provider_media_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [mediaId, device.id, arah, media.mime, media.size, media.sha256, path, path !== null, media.reason, media.providerMediaId],
    );
    return mediaId;
  }

  /**
   * The person's conversation (D-6 revisi 2026-10-30). WhatsApp addresses inbound chats by LID while a chat the
   * committee starts is addressed by number, so keying a LID message on its LID alone gave one person two
   * conversations and their replies landed in the one nobody was reading. When the engine tells us the number
   * (`peerJidAlt`), that number's conversation is the person's conversation — `kontak_alt_hmac` is matched too, as
   * `openConversation` already does for the other direction.
   */
  private async conversationFor(
    client: Queryable,
    deviceId: string,
    contact: { canonical: string; jenis: "pn" | "lid" },
    message: EngineMessage,
  ): Promise<ResolvedConversation> {
    const ownHmac = this.crypto.lookup(contact.canonical);
    const alt = contact.jenis === "lid" && message.peerJidAlt ? contactFromJid(message.peerJidAlt) : null;
    const phoneHmac = alt?.jenis === "pn" ? this.crypto.lookup(alt.canonical) : null;
    // Both identities, in one look: the number first when the message carries one, then the address the message
    // was actually sent to. A LID-only message therefore still finds the number's conversation, which remembers
    // that LID in `kontak_alt_hmac`.
    const found = await client.query<{ id: string; jenis: "pn" | "lid" }>(
      `SELECT id, kontak_jenis AS jenis FROM kirim_conversations
        WHERE device_id = $1
          AND (($2::text IS NOT NULL AND $2 IN (kontak_hmac, kontak_alt_hmac)) OR $3 IN (kontak_hmac, kontak_alt_hmac))
        ORDER BY coalesce($2::text IS NOT NULL AND kontak_hmac = $2, false) DESC,
                 coalesce($2::text IS NOT NULL AND kontak_alt_hmac = $2, false) DESC,
                 (kontak_jenis = 'pn') DESC,
                 (kontak_hmac = $3) DESC, created_at, id LIMIT 1`,
      [deviceId, phoneHmac, ownHmac],
    );
    const row = found.rows[0];
    if (row) {
      if (row.jenis !== contact.jenis) {
        // Attached by the person's other identity. Logged with no number and no LID, so a wrong binding — a
        // recycled number, a stale contact refresh — can be traced without putting a contact in the log.
        this.options.log?.(
          { event: "kirim.ingest.conversation_matched", conversation_id: row.id, pesan: contact.jenis, percakapan: row.jenis },
          "inbound message attached to the contact's other identity",
        );
      }
      return { id: row.id, keyedByPhone: row.jenis === "pn" };
    }
    const id = await ensureConversation(client, this.crypto, { deviceId, canonical: contact.canonical, jenis: contact.jenis });
    return { id, keyedByPhone: contact.jenis === "pn" };
  }

  /** §9 / J-3: profile name, and the contact's other identity so the two never split into two conversations. */
  private async learnContact(
    client: Queryable,
    conversation: ResolvedConversation,
    contact: { canonical: string; jenis: "pn" | "lid" },
    message: EngineMessage,
  ) {
    if (message.pushName) {
      await client.query("UPDATE kirim_conversations SET nama_profil_enc = $2 WHERE id = $1", [
        conversation.id,
        this.crypto.seal(message.pushName, columnAad("kirim_conversations", "nama_profil_enc", conversation.id)),
      ]);
    }
    if (contact.jenis !== "lid" || !message.peerJidAlt) return;
    const alt = contactFromJid(message.peerJidAlt);
    if (alt?.jenis !== "pn") return;
    // On the number's own conversation it is the LID that is worth remembering, so a later LID-only message —
    // one the engine sends without `peerJidAlt` — still finds its way here instead of starting a second chat.
    await this.setContactAlt(client, conversation.id, conversation.keyedByPhone ? contact.canonical : alt.canonical);
  }

  async setContactAlt(client: Queryable, conversationId: string, canonical: string): Promise<void> {
    await client.query(
      "UPDATE kirim_conversations SET kontak_alt_hmac = $2, kontak_alt_enc = $3 WHERE id = $1 AND kontak_alt_hmac IS DISTINCT FROM $2",
      [conversationId, this.crypto.lookup(canonical), this.crypto.seal(canonical, columnAad("kirim_conversations", "kontak_alt_enc", conversationId))],
    );
  }

  /**
   * `from` in `message.received`: the number of the conversation this landed in, whichever of its two identities
   * carries it, else null (D-6). Read from the conversation rather than from the message, because a LID message
   * can land in a conversation that is keyed by number.
   */
  private async phoneOf(client: Queryable, conversationId: string, contact: { canonical: string; jenis: "pn" | "lid" }): Promise<string | null> {
    if (contact.jenis === "pn") return contact.canonical.slice(3);
    const row = await client.query<{ kontakEnc: string; altEnc: string | null }>(
      `SELECT kontak_enc AS "kontakEnc", kontak_alt_enc AS "altEnc" FROM kirim_conversations WHERE id = $1`,
      [conversationId],
    );
    const found = row.rows[0];
    if (!found) return null;
    const own = this.crypto.open(found.kontakEnc, columnAad("kirim_conversations", "kontak_enc", conversationId));
    if (own.startsWith("pn:+")) return own.slice(3);
    if (!found.altEnc) return null;
    const value = this.crypto.open(found.altEnc, columnAad("kirim_conversations", "kontak_alt_enc", conversationId));
    return value.startsWith("pn:+") ? value.slice(3) : null;
  }

  /** Finds or creates the group row; its name arrives with the next group refresh. */
  async ensureGroup(client: Queryable, deviceId: string, jid: string): Promise<{ id: string; created: boolean }> {
    const hmac = this.crypto.lookup(`group:${jid}`);
    const existing = await client.query<{ id: string }>("SELECT id FROM kirim_groups WHERE device_id = $1 AND group_hmac = $2", [deviceId, hmac]);
    if (existing.rows[0]) return { id: existing.rows[0].id, created: false };
    const id = randomUUID();
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO kirim_groups (id, device_id, group_hmac, group_jid_enc) VALUES ($1, $2, $3, $4)
       ON CONFLICT (device_id, group_hmac) DO NOTHING RETURNING id`,
      [id, deviceId, hmac, this.crypto.seal(jid, columnAad("kirim_groups", "group_jid_enc", id))],
    );
    if (inserted.rows[0]) {
      this.unnamedGroups.add(deviceId);
      return { id, created: true };
    }
    const raced = await client.query<{ id: string }>("SELECT id FROM kirim_groups WHERE device_id = $1 AND group_hmac = $2", [deviceId, hmac]);
    return { id: raced.rows[0]!.id, created: false };
  }

  private async storeGroupMessage(client: Queryable, device: EngineDevice, message: EngineMessage, media: MediaCopy | null): Promise<void> {
    const group = await this.ensureGroup(client, device.id, message.chatJid);
    const sender = message.senderJid ? contactFromJid(message.senderJid) : null;
    const messageId = randomUUID();
    const mediaId = await this.storeMedia(client, device, media, "masuk");
    const tipe = TIPE_BY_ENGINE[message.messageType] ?? "lainnya";
    const inserted = await client.query(
      `INSERT INTO kirim_messages (id, group_id, device_id, arah, tipe, body_enc, media_id, provider, provider_message_id, wa_message_id,
                                   pengirim_hmac, pengirim_enc, status, provider_at)
       VALUES ($1, $2, $3, 'masuk', $4, $5, $6, 'jalurpesan', $7, $8, $9, $10, 'diterima', $11)
       ON CONFLICT (provider, device_id, provider_message_id) WHERE provider_message_id IS NOT NULL DO NOTHING`,
      [
        messageId,
        group.id,
        device.id,
        tipe,
        message.body ? this.crypto.seal(message.body, columnAad("kirim_messages", "body_enc", messageId)) : null,
        mediaId,
        message.id,
        message.whatsappMessageId,
        sender ? this.crypto.lookup(sender.canonical) : null,
        sender ? this.crypto.seal(sender.canonical, columnAad("kirim_messages", "pengirim_enc", messageId)) : null,
        message.receivedAt,
      ],
    );
    if ((inserted.rowCount ?? 0) === 0) return;
    await client.query(
      "UPDATE kirim_groups SET belum_dibaca = belum_dibaca + 1, pesan_terakhir_at = greatest(coalesce(pesan_terakhir_at, $2), $2) WHERE id = $1",
      [group.id, message.receivedAt],
    );
    const ownPhone = await this.ownPhone(client, device.id);
    await enqueueWebhook(client, this.crypto, device.pemilikConsumerId, "group.message.received", {
      device: device.kode,
      group_id: group.id,
      message_id: messageId,
      pengirim: { nomor: sender?.jenis === "pn" ? sender.canonical.slice(3) : null, nama_profil: message.pushName },
      tipe,
      cuplikan: message.body ? message.body.slice(0, 200) : null,
      // J-3: null until the engine forwards mentions.
      menyebut_nomor_ini: message.mentionedJids === null ? null : ownPhone !== null && message.mentionedJids.some((jid) => jid.startsWith(`${ownPhone}@`) || jid.startsWith(`${ownPhone}:`)),
      received_at: message.receivedAt,
    });
  }

  /** Digits of the number itself, from the stored encrypted device number. */
  private async ownPhone(client: Queryable, deviceId: string): Promise<string | null> {
    const row = await client.query<{ nomorEnc: string | null }>(`SELECT nomor_enc AS "nomorEnc" FROM kirim_devices WHERE id = $1`, [deviceId]);
    const enc = row.rows[0]?.nomorEnc;
    if (!enc) return null;
    const value = this.crypto.open(enc, columnAad("kirim_devices", "nomor_enc", deviceId));
    return value.startsWith("pn:+") ? value.slice(4) : null;
  }

  private async storeDeviceSent(client: Queryable, device: EngineDevice, message: EngineMessage, media: MediaCopy | null): Promise<void> {
    if (!message.whatsappMessageId) return;
    // A message Kirim SQ itself handed over carries the same WhatsApp id: never store it twice.
    const known = await client.query("SELECT 1 FROM kirim_messages WHERE device_id = $1 AND wa_message_id = $2 LIMIT 1", [device.id, message.whatsappMessageId]);
    if ((known.rowCount ?? 0) > 0) return;
    let conversationId: string | null = null;
    let groupId: string | null = null;
    if (message.group) {
      groupId = (await this.ensureGroup(client, device.id, message.chatJid)).id;
    } else {
      const contact = contactFromJid(message.chatJid);
      if (!contact) return;
      const resolved = await this.conversationFor(client, device.id, contact, message);
      conversationId = resolved.id;
      // Only the other identity: on a message we sent, the display name is the yayasan's own, not the contact's (§9).
      await this.learnContact(client, resolved, contact, { ...message, pushName: null });
    }
    const messageId = randomUUID();
    const mediaId = await this.storeMedia(client, device, media, "keluar");
    const tipe = TIPE_BY_ENGINE[message.messageType] ?? "lainnya";
    const inserted = await client.query(
      `INSERT INTO kirim_messages (id, conversation_id, group_id, device_id, arah, asal, tipe, body_enc, media_id, provider, provider_message_id,
                                   wa_message_id, status, provider_at)
       VALUES ($1, $2, $3, $4, 'keluar', 'hp', $5, $6, $7, 'jalurpesan', $8, $8, 'diserahkan', $9)
       ON CONFLICT (provider, device_id, provider_message_id) WHERE provider_message_id IS NOT NULL DO NOTHING`,
      [
        messageId,
        conversationId,
        groupId,
        device.id,
        tipe,
        message.body ? this.crypto.seal(message.body, columnAad("kirim_messages", "body_enc", messageId)) : null,
        mediaId,
        message.whatsappMessageId,
        message.receivedAt,
      ],
    );
    if ((inserted.rowCount ?? 0) === 0) return;
    // Whoever answered on the phone has read the chat.
    if (conversationId) {
      await client.query(
        "UPDATE kirim_conversations SET belum_dibaca = 0, pesan_terakhir_at = greatest(coalesce(pesan_terakhir_at, $2), $2) WHERE id = $1",
        [conversationId, message.receivedAt],
      );
    } else {
      await client.query(
        "UPDATE kirim_groups SET belum_dibaca = 0, pesan_terakhir_at = greatest(coalesce(pesan_terakhir_at, $2), $2) WHERE id = $1",
        [groupId, message.receivedAt],
      );
    }
    await enqueueWebhook(client, this.crypto, device.pemilikConsumerId, "message.sent", {
      device: device.kode,
      ...(conversationId ? { conversation_id: conversationId } : { group_id: groupId }),
      message_id: messageId,
      asal: "hp",
      dikirim_oleh: null,
      tipe,
      cuplikan: message.body ? message.body.slice(0, 200) : null,
      disamarkan: false,
      status: "diserahkan",
      waktu: message.receivedAt,
    });
  }

  private async advanceDeviceSent(client: Queryable, device: EngineDevice, ids: string[], incoming: "terkirim" | "dibaca"): Promise<void> {
    const rows = await client.query<{ id: string; status: OutboundStatus }>(
      `SELECT id, status FROM kirim_messages WHERE provider = 'jalurpesan' AND device_id = $1 AND provider_message_id = ANY($2::text[])
         AND arah = 'keluar' AND asal = 'hp' FOR UPDATE`,
      [device.id, ids],
    );
    const row = rows.rows[0];
    if (!row) return;
    const next = advanceStatus(row.status, incoming);
    if (next) await client.query("UPDATE kirim_messages SET status = $2, updated_at = now() WHERE id = $1", [row.id, next]);
  }

  /**
   * §6.2: refresh the groups the number belongs to (name, size, admin), and mark the ones it
   * left. Every 15 minutes and when a message arrives from a group not yet named.
   */
  async refreshGroups(device: EngineDevice): Promise<void> {
    const groups = await this.provider.listGroups(device);
    const ownPhone = await this.ownPhone(this.pool, device.id);
    await withTransaction(this.pool, async (client) => {
      const seen: string[] = [];
      for (const group of groups) {
        const { id } = await this.ensureGroup(client, device.id, group.jid);
        seen.push(id);
        const admin = ownPhone !== null && group.participants.some((participant) => participant.admin && participant.jid.startsWith(ownPhone));
        await client.query(
          `UPDATE kirim_groups SET nama_enc = $2, jumlah_anggota = $3, nomor_ini_admin = $4, keluar_at = NULL, disegarkan_at = now() WHERE id = $1`,
          [id, group.name ? this.crypto.seal(group.name, columnAad("kirim_groups", "nama_enc", id)) : null, group.size ?? group.participants.length, admin],
        );
      }
      await client.query(
        "UPDATE kirim_groups SET keluar_at = now() WHERE device_id = $1 AND keluar_at IS NULL AND NOT (id = ANY($2::uuid[]))",
        [device.id, seen],
      );
    });
  }

  /** §9: profile names, and phone numbers for LID conversations, from the engine's contacts. */
  async refreshContacts(device: EngineDevice): Promise<void> {
    for (let page = 1; page <= 50; page += 1) {
      const result = await this.provider.listContacts(device, page);
      for (const contact of result.contacts) {
        const own = contactFromJid(contact.jid);
        if (!own) continue;
        const conversation = await this.pool.query<{ id: string; namaProfilEnc: string | null }>(
          `SELECT id, nama_profil_enc AS "namaProfilEnc" FROM kirim_conversations WHERE device_id = $1 AND kontak_hmac = $2`,
          [device.id, this.crypto.lookup(own.canonical)],
        );
        const row = conversation.rows[0];
        if (!row) continue;
        if (own.jenis === "lid") {
          const canonical = contactFromJid(contact.canonicalJid);
          if (canonical?.jenis === "pn") await this.setContactAlt(this.pool, row.id, canonical.canonical);
        }
        if (contact.displayName && !row.namaProfilEnc) {
          await this.pool.query("UPDATE kirim_conversations SET nama_profil_enc = $2 WHERE id = $1 AND nama_profil_enc IS NULL", [
            row.id,
            this.crypto.seal(contact.displayName, columnAad("kirim_conversations", "nama_profil_enc", row.id)),
          ]);
        }
      }
      if (!result.hasMore) return;
    }
  }

  /** Timers in module.ts: every `jalurpesan` number, errors logged without content. */
  async refreshDirectory(kind: "groups" | "contacts"): Promise<void> {
    for (const device of await this.devices()) {
      if (device.status !== "tersambung") continue;
      try {
        if (kind === "groups") await this.refreshGroups(device);
        else await this.refreshContacts(device);
      } catch (error) {
        this.options.log?.(
          { event: `kirim.${kind}.refresh_failed`, device: device.kode, code: error instanceof ProviderOperationError ? error.code : "error" },
          "kirim directory refresh failed; retrying next round",
        );
      }
    }
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
  /** J-3; null until the engine forwards them. */
  pushName: string | null;
  peerJidAlt: string | null;
  mentionedJids: string[] | null;
  direction: string;
  chatJid: string;
  senderJid: string | null;
  group: boolean;
  messageType: string;
  body: string | null;
  receivedAt: string;
  media: EngineMedia | null;
}

/** JalurPesan names the profile name `senderDisplayName`; `pushName` is the Baileys name. */
function displayName(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : null;
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
    pushName: displayName(value.senderDisplayName) ?? displayName(value.pushName),
    peerJidAlt: typeof value.peerJidAlt === "string" ? value.peerJidAlt : typeof value.remoteJidAlt === "string" ? value.remoteJidAlt : null,
    mentionedJids: Array.isArray(value.mentionedJids) ? value.mentionedJids.filter((jid): jid is string => typeof jid === "string").slice(0, 256) : null,
    direction: typeof value.direction === "string" ? value.direction : "",
    chatJid,
    senderJid: typeof value.senderJid === "string" ? value.senderJid : null,
    group: value.recipientType === "group" || chatJid.endsWith("@g.us"),
    messageType: typeof value.messageType === "string" ? value.messageType : "lainnya",
    body: typeof value.body === "string" && value.body.length > 0 ? value.body : null,
    receivedAt: [value.receivedAt, value.sentAt].find((at): at is string => typeof at === "string" && !Number.isNaN(Date.parse(at))) ?? new Date().toISOString(),
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
