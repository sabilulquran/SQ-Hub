import { createHash, randomUUID } from "node:crypto";

import type { Pool } from "pg";

import { columnAad, maskPhone, phoneCanonical, type KirimCrypto } from "./crypto.js";
import { advanceStatus, type OutboundStatus } from "./policy.js";
import {
  BY_GROUP_ADMIN,
  BY_PHONE,
  BY_SENDER,
  messageByWaId,
  nextReactions,
  reactionAad,
  recordDelete,
  recordEdit,
  saveReactions,
  type TargetMessage,
} from "./message-state.js";
import type { KirimLog } from "./providers/log.js";
import {
  ProviderOperationError,
  type DeviceRef,
  type KirimProvider,
  type ProviderDeviceStatus,
  type ProviderEvent,
  type ProviderGroup,
} from "./providers/types.js";
import {
  dbNow,
  ensureConversation,
  HELD_DEVICE_SQL,
  setDeviceStatus,
  transitionOutbox,
  withTransaction,
  type Queryable,
  enqueueDeviceWebhook,
} from "./repository.js";
import type { KirimService } from "./service.js";

/**
 * KIRIM-IMPL-001 §6.3 and KIRIM-IMPL-002 §6.2, §7, §9: engine events into stored conversations
 * and groups, and the consumer webhooks that follow from them.
 */

const PAGE_LIMIT = 100;
/** How often a number's status is refreshed, however often its events are pulled. */
const STATUS_REFRESH_MS = 60_000;
const MAX_PAGES_PER_PULL = 10;

interface EngineDevice extends DeviceRef {
  pemilikConsumerId: string;
  status: string;
  /**
   * KIRIM-IMPL-003 §11: the phone linked here is already the phone of an older Kirim number. Its
   * events stay in the engine until an admin chooses "Pakai nomor yang ada", so the two numbers'
   * conversations never diverge.
   */
  held?: boolean;
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
  /** At most one queued follow-up pull per number; see `pullDevice`. */
  private readonly pullAgain = new Map<string, Promise<void>>();
  /** When each number's status was last asked after, so the pull loop does not ask every round. */
  private readonly statusCheckedAt = new Map<string, number>();
  /** Numbers that received a message from a group not yet named: refreshed right after the pull. */
  private readonly unnamedGroups = new Set<string>();

  constructor(
    private readonly pool: Pool,
    private readonly crypto: KirimCrypto,
    private readonly service: KirimService,
    private readonly provider: KirimProvider,
    private readonly options: { inboundMediaMaxBytes: number; log?: KirimLog },
  ) {}

  /**
   * Every pull interval and at start: pull each `jalurpesan` number's events, refreshing its status
   * on the slower beat below.
   *
   * The status call is a round trip to the engine and a write of its own, so at a pull interval
   * shorter than a minute it cost more than the pull it preceded while telling us the same thing.
   * The time is recorded before the call, not after, so an engine that is down is not asked again
   * every round; the delay in noticing costs at most one beat.
   */
  async runOnce(): Promise<void> {
    for (const device of await this.devices()) {
      try {
        if (Date.now() - (this.statusCheckedAt.get(device.id) ?? 0) >= STATUS_REFRESH_MS) {
          this.statusCheckedAt.set(device.id, Date.now());
          await this.refreshStatus(device);
        }
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
        const nomorHmac = this.crypto.lookup(phoneCanonical(`+${state.phoneDigits}`));
        await client.query(
          `UPDATE kirim_devices SET nomor_tersamar = $2, nomor_enc = $3, nomor_hmac = $4, updated_at = now()
           WHERE id = $1 AND (nomor_tersamar IS DISTINCT FROM $2 OR nomor_hmac IS DISTINCT FROM $4)`,
          [device.id, masked, this.crypto.seal(`pn:+${state.phoneDigits}`, columnAad("kirim_devices", "nomor_enc", device.id)), nomorHmac],
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

  /**
   * Pulls one number's events from its last stored cursor.
   *
   * A caller that arrives while a pull is in flight is not given that pull: it may already have read
   * its last cursor, in which case it would finish without the event this caller is waiting for, and
   * the message would sit until the next round. Such callers get exactly one follow-up round instead,
   * shared between them, so a burst of webhooks still costs one extra pull rather than one each.
   */
  pullDevice(deviceId: string): Promise<void> {
    const running = this.pulling.get(deviceId);
    if (!running) {
      const pull = this.pullPages(deviceId).finally(() => this.pulling.delete(deviceId));
      this.pulling.set(deviceId, pull);
      return pull;
    }
    const queued = this.pullAgain.get(deviceId);
    if (queued) return queued;
    const follow = running.catch(() => undefined).then(() => {
      // Cleared first, so a caller arriving during the follow-up queues the next one rather than
      // joining a round that is itself already under way.
      this.pullAgain.delete(deviceId);
      return this.pullDevice(deviceId);
    });
    this.pullAgain.set(deviceId, follow);
    return follow;
  }

  private async pullPages(deviceId: string): Promise<void> {
    const device = (await this.devices()).find((item) => item.id === deviceId);
    if (!device || device.held) return;
    for (let page = 0; page < MAX_PAGES_PER_PULL; page += 1) {
      // Engine cursors run across all tenants: the cursor is that of the tenant this number uses now
      // (KIRIM-IMPL-003 §11.3), so a number that moved to another tenant starts that tenant from 0.
      const cursorRow = await this.pool.query<{ cursor: string | null }>(
        "SELECT max(provider_cursor)::text AS cursor FROM kirim_events WHERE device_id = $1 AND provider = 'jalurpesan' AND provider_ref = $2",
        [device.id, device.providerRef],
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
    // KIRIM-IMPL-004 §6: actions on existing messages and calls carry their own payload shapes.
    const change = event.type === "message.edited" || event.type === "message.deleted" ? readChange(event.payload, "change") : null;
    const reaction = event.type === "message.reaction" ? readChange(event.payload, "reaction") : null;
    const call = event.type === "call.logged" ? readCall(event.payload) : null;
    // Only ids and kinds: never a JID, number or body.
    const summary = call
      ? { call: true, grup: call.isGroup, hasil: call.outcome }
      : change ?? reaction
        ? { target: (change ?? reaction)!.whatsappMessageId, grup: (change ?? reaction)!.group }
        : { provider_message_id: message?.id ?? null, tipe: message?.messageType ?? null, grup: message?.group ?? false };

    // Media is copied before the transaction so no network call holds database locks.
    let media: MediaCopy | null = null;
    if ((event.type === "message.received" || event.type === "message.sent") && message?.media) {
      media = await this.copyMedia(device, message.media);
    }

    await withTransaction(this.pool, async (client) => {
      const recorded = await client.query(
        `INSERT INTO kirim_events (id, device_id, provider, provider_event_id, provider_cursor, jenis, payload_ringkas, provider_ref)
         VALUES ($1, $2, 'jalurpesan', $3, $4, $5, $6::jsonb, $7)
         ON CONFLICT (provider, provider_event_id) DO NOTHING`,
        [randomUUID(), device.id, event.eventId, event.cursor, event.type.slice(0, 100), JSON.stringify(summary), device.providerRef],
      );
      if ((recorded.rowCount ?? 0) === 0) return;
      if (change && event.type === "message.edited") return this.applyEngineEdit(client, device, change);
      if (change && event.type === "message.deleted") return this.applyEngineDelete(client, device, change);
      if (reaction) return this.applyEngineReaction(client, device, reaction);
      if (call) return this.storeCall(client, device, call);
      if (!message) return;

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
        const quotedId = await this.quotedMessageId(client, device.id, message);
        const inserted = await client.query(
          `INSERT INTO kirim_messages (id, conversation_id, device_id, arah, tipe, body_enc, media_id, provider, provider_message_id, wa_message_id, status, provider_at,
                                       quoted_message_id, quoted_wa_message_id, forwarded)
           VALUES ($1, $2, $3, 'masuk', $4, $5, $6, 'jalurpesan', $7, $8, 'diterima', $9, $10, $11, $12)
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
            quotedId,
            message.quotedWaId,
            message.forwarded,
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
        await enqueueDeviceWebhook(client, this.crypto, device, "message.received", {
          device: device.kode,
          conversation_id: conversationId,
          message_id: messageId,
          from,
          nama_profil: message.pushName,
          tipe: TIPE_BY_ENGINE[message.messageType] ?? "lainnya",
          cuplikan: message.body ? message.body.slice(0, 200) : null,
          received_at: message.receivedAt,
          kutipan_message_id: quotedId,
          diteruskan: message.forwarded,
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
    message: Pick<EngineMessage, "peerJidAlt">,
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

  /**
   * KIRIM-IMPL-002 §10.3: the conversation for a chat of the engine's stored history copy, found or
   * created the way an inbound message would be (number and LID matched both ways). Null for a JID
   * that is not a private chat. Creates no event, webhook or unread count.
   */
  async conversationForChat(client: Queryable, deviceId: string, chatJid: string, phoneDigits: string | null): Promise<string | null> {
    const contact = contactFromJid(chatJid);
    if (!contact) return null;
    const identity = { pushName: null, peerJidAlt: contact.jenis === "lid" && phoneDigits ? `${phoneDigits}@s.whatsapp.net` : null };
    const resolved = await this.conversationFor(client, deviceId, contact, identity);
    await this.learnContact(client, resolved, contact, identity);
    return resolved.id;
  }

  /** §9 / J-3: profile name, and the contact's other identity so the two never split into two conversations. */
  private async learnContact(
    client: Queryable,
    conversation: ResolvedConversation,
    contact: { canonical: string; jenis: "pn" | "lid" },
    message: Pick<EngineMessage, "pushName" | "peerJidAlt">,
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
    const quotedId = await this.quotedMessageId(client, device.id, message);
    const inserted = await client.query(
      `INSERT INTO kirim_messages (id, group_id, device_id, arah, tipe, body_enc, media_id, provider, provider_message_id, wa_message_id,
                                   pengirim_hmac, pengirim_enc, status, provider_at, quoted_message_id, quoted_wa_message_id, forwarded)
       VALUES ($1, $2, $3, 'masuk', $4, $5, $6, 'jalurpesan', $7, $8, $9, $10, 'diterima', $11, $12, $13, $14)
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
        quotedId,
        message.quotedWaId,
        message.forwarded,
      ],
    );
    if ((inserted.rowCount ?? 0) === 0) return;
    await client.query(
      "UPDATE kirim_groups SET belum_dibaca = belum_dibaca + 1, pesan_terakhir_at = greatest(coalesce(pesan_terakhir_at, $2), $2) WHERE id = $1",
      [group.id, message.receivedAt],
    );
    const ownPhone = await this.ownPhone(client, device.id);
    await enqueueDeviceWebhook(client, this.crypto, device, "group.message.received", {
      device: device.kode,
      group_id: group.id,
      message_id: messageId,
      pengirim: { nomor: sender?.jenis === "pn" ? sender.canonical.slice(3) : null, nama_profil: message.pushName },
      tipe,
      cuplikan: message.body ? message.body.slice(0, 200) : null,
      // J-3: null until the engine forwards mentions.
      menyebut_nomor_ini: message.mentionedJids === null ? null : ownPhone !== null && message.mentionedJids.some((jid) => jid.startsWith(`${ownPhone}@`) || jid.startsWith(`${ownPhone}:`)),
      received_at: message.receivedAt,
      kutipan_message_id: quotedId,
      diteruskan: message.forwarded,
    });
  }

  /** Digits of the number itself, from the stored encrypted device number. */
  async ownPhone(client: Queryable, deviceId: string): Promise<string | null> {
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
    const quotedId = await this.quotedMessageId(client, device.id, message);
    const inserted = await client.query(
      `INSERT INTO kirim_messages (id, conversation_id, group_id, device_id, arah, asal, tipe, body_enc, media_id, provider, provider_message_id,
                                   wa_message_id, status, provider_at, quoted_message_id, quoted_wa_message_id, forwarded)
       VALUES ($1, $2, $3, $4, 'keluar', 'hp', $5, $6, $7, 'jalurpesan', $8, $8, 'diserahkan', $9, $10, $11, $12)
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
        quotedId,
        message.quotedWaId,
        message.forwarded,
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
    await enqueueDeviceWebhook(client, this.crypto, device, "message.sent", {
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
      kutipan_message_id: quotedId,
      diteruskan: message.forwarded,
    });
  }

  /** KIRIM-IMPL-004 §6.1: the stored message a new message quotes, when Kirim SQ has it. */
  private async quotedMessageId(client: Queryable, deviceId: string, message: EngineMessage): Promise<string | null> {
    if (!message.quotedWaId) return null;
    const found = await client.query<{ id: string }>(
      "SELECT id FROM kirim_messages WHERE device_id = $1 AND wa_message_id = $2 ORDER BY diimpor, created_at LIMIT 1",
      [deviceId, message.quotedWaId],
    );
    return found.rows[0]?.id ?? null;
  }

  // ------------------------------------------------- KIRIM-IMPL-004 §6.2: actions and calls

  /** `message.edited`: the new body replaces the old, which is kept. Our own API edits arrive here as no-ops. */
  private async applyEngineEdit(client: Queryable, device: EngineDevice, change: EngineChange): Promise<void> {
    const target = await messageByWaId(client, device.id, change.whatsappMessageId);
    if (!target) return;
    // WhatsApp does not authenticate who sent an edit: only the message's own author may change it.
    const author = await this.authorOf(client, device, target, change);
    if (author !== "author") return this.refuseChange(device, "edit");
    const by = change.fromMe ? BY_PHONE : BY_SENDER;
    if (!(await recordEdit(client, this.crypto, target, { body: change.body, at: change.at, by }))) return;
    await enqueueDeviceWebhook(client, this.crypto, device, "message.edited", {
      device: device.kode,
      ...where(target),
      message_id: target.id,
      arah: target.arah,
      cuplikan: change.body ? change.body.slice(0, 200) : null,
      diedit_at: change.at,
      diedit_oleh: by,
    });
  }

  /** `message.deleted`: marked deleted for everyone, body kept for the module's own rules. */
  private async applyEngineDelete(client: Queryable, device: EngineDevice, change: EngineChange): Promise<void> {
    const target = await messageByWaId(client, device.id, change.whatsappMessageId);
    if (!target) return;
    // WhatsApp does not authenticate a revoke: the author may delete, and in a group also an admin.
    const author = await this.authorOf(client, device, target, change);
    if (author === "other") return this.refuseChange(device, "delete");
    const by = change.fromMe ? BY_PHONE : author === "group_admin" ? BY_GROUP_ADMIN : BY_SENDER;
    if (!(await recordDelete(client, target, { at: change.at, by }))) return;
    await enqueueDeviceWebhook(client, this.crypto, device, "message.deleted", {
      device: device.kode,
      ...where(target),
      message_id: target.id,
      arah: target.arah,
      dihapus_at: change.at,
      dihapus_oleh: by,
    });
  }

  /**
   * Who an edit or delete came from, relative to the target message (KIRIM-IMPL-004 §6.2):
   * `author` — this number for its own message (`fromMe`), or the contact / group member who wrote it,
   * by either of their identities; `group_admin` — another admin of the group (deletes only, also this
   * number when it is admin); `other` — anyone else, whose change is ignored.
   */
  private async authorOf(client: Queryable, device: EngineDevice, target: TargetMessage, change: EngineChange): Promise<"author" | "group_admin" | "other"> {
    if (change.fromMe) {
      if (target.arah === "keluar") return "author";
      if (!target.groupId) return "other";
      const group = await client.query<{ admin: boolean }>("SELECT nomor_ini_admin AS admin FROM kirim_groups WHERE id = $1", [target.groupId]);
      return group.rows[0]?.admin ? "group_admin" : "other";
    }
    if (target.arah !== "masuk") return "other";
    const identities = [change.senderJid, change.peerJidAlt]
      .flatMap((jid) => (jid ? [contactFromJid(jid)] : []))
      .flatMap((contact) => (contact ? [this.crypto.lookup(contact.canonical)] : []));
    if (identities.length === 0) return "other";
    if (!target.groupId) {
      const own = await client.query(
        "SELECT 1 FROM kirim_conversations WHERE id = $1 AND (kontak_hmac = ANY($2::text[]) OR kontak_alt_hmac = ANY($2::text[]))",
        [target.conversationId, identities],
      );
      return (own.rowCount ?? 0) > 0 ? "author" : "other";
    }
    if (target.pengirimHmac && identities.includes(target.pengirimHmac)) return "author";
    // The member may write under one identity and act under the other; the group's member list knows both.
    const member = await client.query<{ admin: boolean; same: boolean }>(
      `SELECT admin, ($3::text IS NOT NULL AND $3 IN (member_hmac, member_alt_hmac)) AS same FROM kirim_group_members
        WHERE group_id = $1 AND (member_hmac = ANY($2::text[]) OR member_alt_hmac = ANY($2::text[]))`,
      [target.groupId, identities, target.pengirimHmac],
    );
    if (member.rows.some((row) => row.same)) return "author";
    return member.rows.some((row) => row.admin) ? "group_admin" : "other";
  }

  private refuseChange(device: EngineDevice, aksi: "edit" | "delete"): void {
    this.options.log?.({ event: "kirim.ingest.change_refused", device: device.kode, aksi }, "engine change not from the message's author; ignored");
  }

  /** `message.reaction`: one current reaction per reactor; `""` removes it. */
  private async applyEngineReaction(client: Queryable, device: EngineDevice, reaction: EngineChange & { emoji: string }): Promise<void> {
    const target = await messageByWaId(client, device.id, reaction.whatsappMessageId);
    if (!target) return;
    const reactor = reaction.senderJid ? contactFromJid(reaction.senderJid) : null;
    if (!reaction.fromMe && !reactor) return;
    const k = reaction.fromMe ? "nomor_ini" : this.crypto.lookup(reactor!.canonical);
    const dari = reaction.fromMe ? "nomor_ini" : target.groupId ? "anggota" : "kontak";
    const next = nextReactions(target.reactions, {
      k,
      dari,
      emoji: reaction.emoji,
      at: reaction.at,
      ...(dari === "anggota" ? { enc: this.crypto.seal(reactor!.canonical, reactionAad(target.id, k)) } : {}),
    });
    if (!next.changed) return;
    await saveReactions(client, target.id, next.reactions);
    await enqueueDeviceWebhook(client, this.crypto, device, "message.reaction", {
      device: device.kode,
      ...where(target),
      message_id: target.id,
      dari,
      // Group members are named like `group.message.received` names them; private chats need no number.
      ...(dari === "anggota" ? { pengirim: { nomor: reactor!.jenis === "pn" ? reactor!.canonical.slice(3) : null } } : {}),
      emoji: reaction.emoji,
      waktu: reaction.at,
    });
  }

  /**
   * `call.logged`: a private call becomes a `panggilan` message in that person's conversation. A missed or
   * rejected call counts as the person writing in (unread, `pesan_masuk_terakhir_at`). Group calls are not stored.
   */
  private async storeCall(client: Queryable, device: EngineDevice, call: EngineCall): Promise<void> {
    if (call.isGroup) return;
    // A call from this number's own phone is addressed to the callee; `callerPnJid` is then this number.
    const contact = call.fromMe
      ? contactFromJid(call.chatJid)
      : contactFromJid(call.chatJid) ?? contactFromJid(call.fromJid) ?? (call.callerPnJid ? contactFromJid(call.callerPnJid) : null);
    if (!contact) return;
    const identity = { pushName: null, peerJidAlt: contact.jenis === "lid" && !call.fromMe ? call.callerPnJid : null };
    const arah: "masuk" | "keluar" = call.fromMe ? "keluar" : "masuk";
    const hasil = HASIL_BY_OUTCOME[call.outcome];
    const panggilan = {
      hasil,
      video: call.isVideo,
      mulai: call.startedAt,
      diangkat_at: call.answeredAt,
      selesai: call.endedAt,
      durasi_detik: call.durationSeconds,
      revisi: call.revision,
    };
    // One message per call: a later revision (a `missed` corrected by a late accept/reject) replaces it.
    const existing = await client.query<{ id: string; conversationId: string; panggilan: { hasil?: string; revisi?: number }; at: Date }>(
      `SELECT id, conversation_id AS "conversationId", panggilan, provider_at AS at FROM kirim_messages
        WHERE device_id = $1 AND call_id = $2 FOR UPDATE`,
      [device.id, call.callId],
    );
    const previous = existing.rows[0];
    let messageId: string;
    let conversationId: string;
    if (previous) {
      if ((previous.panggilan.revisi ?? 1) >= call.revision) return;
      messageId = previous.id;
      conversationId = previous.conversationId;
      await client.query("UPDATE kirim_messages SET panggilan = $2::jsonb, updated_at = now() WHERE id = $1", [messageId, JSON.stringify(panggilan)]);
      // A missed call that was answered after all no longer waits for a reply, if nobody has read it yet.
      if (arah === "masuk" && previous.panggilan.hasil !== "diangkat" && hasil === "diangkat") {
        await client.query(
          `UPDATE kirim_conversations SET belum_dibaca = greatest(belum_dibaca - 1, 0)
            WHERE id = $1 AND (dibaca_sampai_at IS NULL OR dibaca_sampai_at < $2)`,
          [conversationId, previous.at],
        );
      }
    } else {
      const resolved = await this.conversationFor(client, device.id, contact, identity);
      await this.learnContact(client, resolved, contact, identity);
      messageId = randomUUID();
      conversationId = resolved.id;
      await client.query(
        `INSERT INTO kirim_messages (id, conversation_id, device_id, arah, asal, tipe, provider, status, provider_at, panggilan, call_id)
         VALUES ($1, $2, $3, $4, $5, 'panggilan', 'jalurpesan', $6, $7, $8::jsonb, $9)`,
        [messageId, conversationId, device.id, arah, arah === "keluar" ? "hp" : null, arah === "keluar" ? "diserahkan" : "diterima", call.startedAt, JSON.stringify(panggilan), call.callId],
      );
      const unanswered = arah === "masuk" && hasil !== "diangkat";
      await client.query(
        `UPDATE kirim_conversations SET
           pesan_terakhir_at = greatest(coalesce(pesan_terakhir_at, $2), $2),
           belum_dibaca = belum_dibaca + CASE WHEN $3 THEN 1 ELSE 0 END,
           pesan_masuk_terakhir_at = CASE WHEN $3 THEN greatest(coalesce(pesan_masuk_terakhir_at, $2), $2) ELSE pesan_masuk_terakhir_at END
         WHERE id = $1`,
        [conversationId, call.startedAt, unanswered],
      );
    }
    await enqueueDeviceWebhook(client, this.crypto, device, "call.logged", {
      device: device.kode,
      conversation_id: conversationId,
      message_id: messageId,
      arah,
      // The contact's number, whichever way the call went; null for a LID whose number is unknown.
      from: await this.phoneOf(client, conversationId, contact),
      ...panggilan,
      dikoreksi: previous !== undefined,
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
      for (const group of groups) seen.push(await this.storeGroupState(client, device.id, group, ownPhone));
      await client.query(
        "UPDATE kirim_groups SET keluar_at = now() WHERE device_id = $1 AND keluar_at IS NULL AND NOT (id = ANY($2::uuid[]))",
        [device.id, seen],
      );
    });
  }

  /**
   * One group as the engine reports it: name, size, whether this number is admin, and its members
   * (KIRIM-IMPL-004 §8, grup bersama). Members are keyed by the same canonical HMAC as conversations, with
   * the other identity (`phoneJid` / `lidJid`) as `member_alt_*`, so a contact is found by either one.
   */
  async storeGroupState(client: Queryable, deviceId: string, group: ProviderGroup, ownPhone: string | null): Promise<string> {
    const { id } = await this.ensureGroup(client, deviceId, group.jid);
    const isOwn = (jid: string | null | undefined) => ownPhone !== null && typeof jid === "string" && (jid.startsWith(`${ownPhone}@`) || jid.startsWith(`${ownPhone}:`));
    const admin = group.participants.some((participant) => participant.admin && (isOwn(participant.jid) || isOwn(participant.phoneJid)));
    await client.query(
      `UPDATE kirim_groups SET nama_enc = $2, jumlah_anggota = $3, nomor_ini_admin = $4, keluar_at = NULL, disegarkan_at = now() WHERE id = $1`,
      [id, group.name ? this.crypto.seal(group.name, columnAad("kirim_groups", "nama_enc", id)) : null, group.size ?? group.participants.length, admin],
    );
    const members = new Map<string, { enc: string; altHmac: string | null; altEnc: string | null; admin: boolean }>();
    for (const participant of group.participants) {
      const own = contactFromJid(participant.jid);
      if (!own) continue;
      const otherJid = own.jenis === "lid" ? participant.phoneJid : participant.lidJid;
      const other = otherJid ? contactFromJid(otherJid) : null;
      const alt = other && other.jenis !== own.jenis ? other : null;
      const hmac = this.crypto.lookup(own.canonical);
      members.set(hmac, {
        enc: this.crypto.seal(own.canonical, memberAad(id, hmac, "member_enc")),
        altHmac: alt ? this.crypto.lookup(alt.canonical) : null,
        altEnc: alt ? this.crypto.seal(alt.canonical, memberAad(id, hmac, "member_alt_enc")) : null,
        admin: participant.admin,
      });
    }
    const hmacs = [...members.keys()];
    await client.query("DELETE FROM kirim_group_members WHERE group_id = $1 AND NOT (member_hmac = ANY($2::text[]))", [id, hmacs]);
    if (hmacs.length > 0) {
      const values = [...members.values()];
      // Unchanged members are not rewritten, so a 15-minute refresh of a large group costs one statement.
      await client.query(
        `INSERT INTO kirim_group_members (group_id, member_hmac, member_enc, member_alt_hmac, member_alt_enc, admin)
         SELECT $1, * FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::boolean[])
         ON CONFLICT (group_id, member_hmac) DO UPDATE SET
           member_alt_hmac = coalesce(EXCLUDED.member_alt_hmac, kirim_group_members.member_alt_hmac),
           member_alt_enc = CASE WHEN EXCLUDED.member_alt_hmac IS NULL THEN kirim_group_members.member_alt_enc ELSE EXCLUDED.member_alt_enc END,
           admin = EXCLUDED.admin,
           refreshed_at = now()
         WHERE kirim_group_members.admin IS DISTINCT FROM EXCLUDED.admin
            OR (EXCLUDED.member_alt_hmac IS NOT NULL AND kirim_group_members.member_alt_hmac IS DISTINCT FROM EXCLUDED.member_alt_hmac)`,
        [id, hmacs, values.map((value) => value.enc), values.map((value) => value.altHmac), values.map((value) => value.altEnc), values.map((value) => value.admin)],
      );
    }
    return id;
  }

  /**
   * §9: profile names, and phone numbers for LID conversations, from the engine's contacts.
   *
   * The engine's address book holds every contact the number has ever seen, while we keep a
   * conversation only for the few that have written to us. Asking after each contact in turn meant
   * thousands of round trips for a handful of matches, which took minutes on the phone and slowed
   * everything sharing the database with it; the whole page is looked up at once instead, and only
   * the contacts that matched are written.
   */
  async refreshContacts(device: EngineDevice): Promise<void> {
    for (let page = 1; page <= 50; page += 1) {
      const result = await this.provider.listContacts(device, page);
      const byHmac = new Map<string, { jenis: "pn" | "lid"; canonicalJid: string; displayName: string | null }>();
      for (const contact of result.contacts) {
        const own = contactFromJid(contact.jid);
        if (own) {
          byHmac.set(this.crypto.lookup(own.canonical), {
            jenis: own.jenis,
            canonicalJid: contact.canonicalJid,
            displayName: contact.displayName,
          });
        }
      }
      if (byHmac.size > 0) {
        const known = await this.pool.query<{ id: string; kontakHmac: string; namaProfilEnc: string | null }>(
          `SELECT id, kontak_hmac AS "kontakHmac", nama_profil_enc AS "namaProfilEnc"
             FROM kirim_conversations WHERE device_id = $1 AND kontak_hmac = ANY($2::text[])`,
          [device.id, [...byHmac.keys()]],
        );
        for (const row of known.rows) {
          const contact = byHmac.get(row.kontakHmac);
          if (!contact) continue;
          if (contact.jenis === "lid") {
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
      }
      if (!result.hasMore) return;
    }
  }

  /** Timers in module.ts: every `jalurpesan` number, errors logged without content. */
  async refreshDirectory(kind: "groups" | "contacts"): Promise<void> {
    for (const device of await this.devices()) {
      if (device.status !== "tersambung" || device.held) continue;
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
      `SELECT d.id, d.kode, d.provider_ref AS "providerRef", d.pemilik_consumer_id AS "pemilikConsumerId", d.status,
              EXISTS (${HELD_DEVICE_SQL}) AS held
       FROM kirim_devices d WHERE d.provider = 'jalurpesan' AND d.status <> 'nonaktif' AND d.provider_ref IS NOT NULL ORDER BY d.kode`,
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
  /** KIRIM-IMPL-004 §6.1: WhatsApp id of the message this one quotes, and the "Diteruskan" label. */
  quotedWaId: string | null;
  forwarded: boolean;
}

/** `message.edited` / `message.deleted` (`change`) and `message.reaction` (`reaction`), JalurPesan K3.2 §C. */
interface EngineChange {
  whatsappMessageId: string;
  senderJid: string | null;
  /** The sender's other identity (phone JID for a LID sender) when the engine knows it. */
  peerJidAlt: string | null;
  fromMe: boolean;
  group: boolean;
  /** New text of an edit; null when the engine could not read it. */
  body: string | null;
  at: string;
}

interface EngineCall {
  callId: string;
  chatJid: string;
  fromJid: string;
  callerPnJid: string | null;
  isVideo: boolean;
  isGroup: boolean;
  /** Placed from this number's own phone. */
  fromMe: boolean;
  /** 1, or 2 when a call first logged missed is corrected by a late accept/reject/terminate. */
  revision: number;
  outcome: "answered_elsewhere" | "rejected" | "missed";
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  /** Null when the engine does not know it, e.g. a call answered on the phone (`answered_elsewhere`). */
  durationSeconds: number | null;
}

const HASIL_BY_OUTCOME: Record<EngineCall["outcome"], "diangkat" | "ditolak" | "tak_terjawab"> = {
  answered_elsewhere: "diangkat",
  rejected: "ditolak",
  missed: "tak_terjawab",
};

function isoOr(value: unknown, fallback: string): string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : fallback;
}

/** Reads `{ version, change | reaction: {...} }` defensively; unknown shapes are skipped, never guessed. */
export function readChange(payload: unknown, key: "change"): EngineChange | null;
export function readChange(payload: unknown, key: "reaction"): (EngineChange & { emoji: string }) | null;
export function readChange(payload: unknown, key: "change" | "reaction"): (EngineChange & { emoji?: string }) | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = (payload as Record<string, unknown>)[key];
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.whatsappMessageId !== "string" || !value.whatsappMessageId || value.whatsappMessageId.length > 200) return null;
  const chatJid = typeof value.chatJid === "string" ? value.chatJid : "";
  const now = new Date().toISOString();
  const base: EngineChange = {
    whatsappMessageId: value.whatsappMessageId,
    senderJid: typeof value.senderJid === "string" ? value.senderJid : null,
    peerJidAlt: typeof value.peerJidAlt === "string" && value.peerJidAlt ? value.peerJidAlt : null,
    fromMe: value.fromMe === true,
    group: value.recipientType === "group" || chatJid.endsWith("@g.us"),
    body: typeof value.body === "string" && value.body.length > 0 ? value.body : null,
    at: isoOr(key === "reaction" ? value.reactedAt : value.editedAt ?? value.deletedAt, now),
  };
  if (key === "change") return base;
  if (typeof value.emoji !== "string" || [...value.emoji].length > 16) return null;
  return { ...base, body: null, emoji: value.emoji };
}

/** Reads `{ version, call: {...} }`; only the three final outcomes are accepted. */
export function readCall(payload: unknown): EngineCall | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = (payload as Record<string, unknown>).call;
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.callId !== "string" || !value.callId || value.callId.length > 200) return null;
  if (value.outcome !== "answered_elsewhere" && value.outcome !== "rejected" && value.outcome !== "missed") return null;
  const startedAt = isoOr(value.startedAt, new Date().toISOString());
  const duration = typeof value.durationSeconds === "number" && Number.isFinite(value.durationSeconds) && value.durationSeconds >= 0
    ? Math.min(Math.round(value.durationSeconds), 86_400)
    : null;
  return {
    callId: value.callId,
    chatJid: typeof value.chatJid === "string" ? value.chatJid : "",
    fromJid: typeof value.fromJid === "string" ? value.fromJid : "",
    callerPnJid: typeof value.callerPnJid === "string" && value.callerPnJid ? value.callerPnJid : null,
    isVideo: value.isVideo === true,
    isGroup: value.isGroup === true || (typeof value.groupJid === "string" && value.groupJid.length > 0),
    fromMe: value.fromMe === true,
    revision: typeof value.revision === "number" && Number.isInteger(value.revision) && value.revision >= 1 && value.revision <= 100 ? value.revision : 1,
    outcome: value.outcome,
    startedAt,
    answeredAt: typeof value.answeredAt === "string" && !Number.isNaN(Date.parse(value.answeredAt)) ? value.answeredAt : null,
    endedAt: typeof value.endedAt === "string" && !Number.isNaN(Date.parse(value.endedAt)) ? value.endedAt : null,
    durationSeconds: duration,
  };
}

/** The conversation or group a message belongs to, as webhooks name it. */
function where(target: { conversationId: string | null; groupId: string | null }): Record<string, string> {
  return target.groupId ? { group_id: target.groupId } : { conversation_id: target.conversationId! };
}

export function memberAad(groupId: string, memberHmac: string, column: "member_enc" | "member_alt_enc"): string {
  return columnAad("kirim_group_members", column, `${groupId}:${memberHmac}`);
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
  const quoted = value.quoted && typeof value.quoted === "object" ? (value.quoted as Record<string, unknown>) : null;
  return {
    quotedWaId: quoted && typeof quoted.id === "string" && quoted.id && quoted.id.length <= 200 ? quoted.id : null,
    forwarded: value.forwarded === true,
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
