import type { Pool } from "pg";
import { z } from "zod";

import { atasNamaRef, atasNamaSchema, type AtasNama, type KirimConversations } from "./conversations.js";
import { columnAad, type KirimCrypto } from "./crypto.js";
import { KirimApiError } from "./errors.js";
import { jidFromCanonical } from "./message-refs.js";
import {
  changedByItem,
  messageById,
  nextReactions,
  recordDelete,
  recordEdit,
  saveReactions,
  type TargetMessage,
} from "./message-state.js";
import type { KirimLog } from "./providers/log.js";
import type { ActionChat, ActionResult, KirimProvider, ProviderName } from "./providers/types.js";
import { conversationContact, dbNow, findDevice, groupJid, usesNumberSql, withTransaction, writeAudit, type ConsumerRow, type DeviceRow, type Queryable } from "./repository.js";
import { canonicalJson, OUTBOUND_MEDIA_MIMES, type KirimService } from "./service.js";
import { recipientFromContact } from "./worker.js";

/**
 * KIRIM-IMPL-004 §5: forward, edit, delete for everyone, and react, for the module that owns the number.
 * Edits, deletes and reactions are synchronous engine calls (no outbox): the officer sees at once whether
 * WhatsApp took it. Kirim SQ checks only what WhatsApp and the number require; who may do what is the
 * module's rule (SPMB-IMPL-005 §4.1), and Kirim SQ records the officer it is told about.
 */

/** SPMB-IMPL-005 §4.1: the reactions the inbox offers. `""` removes this number's reaction. */
export const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

/** "❤" without the emoji variation selector is the same heart. */
function normalizeEmoji(value: string): string {
  return value === "❤" ? "❤️" : value;
}

export const forwardSchema = z
  .object({
    ke: z.union([z.object({ conversation_id: z.guid() }).strict(), z.object({ group_id: z.guid() }).strict()]),
    atas_nama: atasNamaSchema,
    ref: z.string().max(200).optional(),
  })
  .strict();
export const editSchema = z.object({ text: z.string().min(1).max(4096), atas_nama: atasNamaSchema }).strict();
export const deleteSchema = z.object({ atas_nama: atasNamaSchema }).strict();
export const reactionSchema = z
  .object({
    emoji: z.string().max(16).transform(normalizeEmoji).refine((value) => value === "" || (REACTION_EMOJIS as readonly string[]).includes(value), {
      message: "emoji must be one of the allowed reactions or empty",
    }),
    atas_nama: atasNamaSchema,
  })
  .strict();

/** Inbound media Kirim SQ can send again as it is: the outbound types (KIRIM-IMPL-002 §5.3). */
const FORWARD_TIPE_BY_MIME: Record<string, "dokumen" | "gambar" | "stiker"> = {
  "application/pdf": "dokumen", "image/jpeg": "gambar", "image/png": "gambar", "image/webp": "stiker",
};
const NOT_SENT = new Set(["antre", "gagal", "dibatalkan"]);

interface OwnedMessage extends TargetMessage {
  kode: string;
  mediaId: string | null;
}

export class KirimMessageActions {
  constructor(
    private readonly pool: Pool,
    private readonly crypto: KirimCrypto,
    private readonly service: KirimService,
    private readonly conversations: KirimConversations,
    private readonly providers: Record<ProviderName, KirimProvider | undefined>,
    private readonly options: { editWindowMinutes: number; deleteWindowHours: number; log?: KirimLog },
  ) {}

  // ------------------------------------------------------------------------------ forward

  /** §5.2: a copy to another chat of the same number, labelled "Diteruskan"; queued like an officer reply. */
  async forward(consumer: ConsumerRow, messageId: string, idempotencyKey: string, input: z.infer<typeof forwardSchema>) {
    const requestHash = this.crypto.lookup(`forward:${messageId}:${canonicalJson(input)}`);
    const replay = await this.service.findIdempotent(this.pool, consumer.id, idempotencyKey, requestHash);
    if (replay) return replay;
    const source = await this.ownedMessage(consumer, messageId);
    if (source.deletedAt) throw new KirimApiError(409, "message_deleted", "Pesan yang dihapus tidak bisa diteruskan.");
    if (source.bodyDisamarkan) throw new KirimApiError(422, "not_forwardable", "Kode verifikasi tidak bisa diteruskan.");
    let tipe: string;
    if (source.mediaId) {
      const media = await this.pool.query<{ mime: string; path: string | null }>("SELECT mime, path FROM kirim_media WHERE id = $1", [source.mediaId]);
      const stored = media.rows[0];
      const mediaTipe = stored ? FORWARD_TIPE_BY_MIME[stored.mime] : undefined;
      if (!stored?.path || !mediaTipe || !OUTBOUND_MEDIA_MIMES.includes(stored.mime)) {
        throw new KirimApiError(422, "not_forwardable", "Media ini tidak tersimpan di Kirim SQ atau jenisnya belum bisa diteruskan (hanya PDF, JPEG, PNG).");
      }
      tipe = mediaTipe;
    } else {
      if (source.tipe !== "teks" || !source.bodyEnc) throw new KirimApiError(422, "not_forwardable", "Pesan ini tidak bisa diteruskan.");
      tipe = "teks";
    }
    const body = source.bodyEnc ? this.crypto.open(source.bodyEnc, columnAad("kirim_messages", "body_enc", source.id)) : null;

    let target: { conversationId: string | null; groupId: string | null; toHmac: string };
    let targetKode: string;
    if ("conversation_id" in input.ke) {
      const conversation = await this.conversations.ownedConversation(this.pool, consumer, input.ke.conversation_id);
      if (conversation.deviceId !== source.deviceId) throw new KirimApiError(422, "different_number", "Hanya bisa diteruskan ke chat di nomor yang sama.");
      const hmacs = [conversation.kontakHmac, ...(conversation.kontakAltHmac ? [conversation.kontakAltHmac] : [])];
      // SPMB-IMPL-005 §4.1: someone who asked not to be contacted cannot be chosen, with no 24-hour exception.
      if (await this.service.isOptedOut(this.pool, hmacs, consumer.id, conversation.deviceId)) {
        throw new KirimApiError(422, "optout", "Nomor tujuan minta tidak dihubungi.");
      }
      target = { conversationId: conversation.id, groupId: null, toHmac: conversation.kontakHmac };
      targetKode = conversation.kode;
    } else {
      const group = await this.conversations.ownedGroup(this.pool, consumer, input.ke.group_id);
      if (group.kode !== source.kode) throw new KirimApiError(422, "different_number", "Hanya bisa diteruskan ke grup di nomor yang sama.");
      target = { conversationId: null, groupId: group.id, toHmac: group.groupHmac };
      targetKode = group.kode;
    }
    const device = (await findDevice(this.pool, targetKode))!;
    if (device.status === "nonaktif") throw new KirimApiError(422, "device_inactive", "Nomor tidak aktif.");
    return this.conversations.queueReply(consumer, device, idempotencyKey, requestHash, {
      body,
      mediaId: source.mediaId,
      tipe,
      atasNama: input.atas_nama,
      ref: input.ref ?? null,
      kedaluwarsa: null,
      quotedMessageId: null,
      forwardedFrom: source.id,
    }, await dbNow(this.pool), target);
  }

  // --------------------------------------------------------------------------------- edit

  /** §5.3: this number's own text message, within the edit window. The old body is kept. */
  async edit(consumer: ConsumerRow, messageId: string, idempotencyKey: string, input: z.infer<typeof editSchema>) {
    const message = await this.ownedMessage(consumer, messageId);
    this.requireOwn(consumer, message);
    if (message.deletedAt) throw new KirimApiError(409, "message_deleted", "Pesan sudah dihapus.");
    if (message.tipe !== "teks" || message.bodyDisamarkan || !message.bodyEnc) {
      throw new KirimApiError(422, "not_editable", "Hanya pesan teks yang bisa diedit.");
    }
    this.requireSent(message);
    await this.requireWithin(message, this.options.editWindowMinutes * 60_000, "edit_window_passed", `Batas edit ${this.options.editWindowMinutes} menit sudah lewat.`);
    const current = this.crypto.open(message.bodyEnc, columnAad("kirim_messages", "body_enc", message.id));
    // A repeat of the same edit changes nothing, at WhatsApp or here.
    if (current === input.text) return this.item(message.id);
    const { device, provider, chat } = await this.engineTarget(message);
    this.check(await provider.editMessage(device, { chat, whatsappMessageId: message.waMessageId! }, input.text, this.engineKey(consumer, "edit", idempotencyKey)));
    await withTransaction(this.pool, async (client) => {
      const locked = (await messageById(client, message.id, true))!;
      const by = atasNamaRef(input.atas_nama);
      const changed = await recordEdit(client, this.crypto, locked, { body: input.text, at: await dbNow(client), by });
      // The engine may echo our own edit back first (fromMe) and ingest records it as made on the phone; it was the
      // officer, so the history row is put right. The audit row is written whenever the engine accepted the edit.
      if (!changed) await reattributeEcho(client, message.id, "edit", by);
      await this.audit(client, consumer, "pesan.edit", message, input.atas_nama, { panjang: input.text.length });
    });
    return this.item(message.id);
  }

  /** §5.3: every earlier body of a message, oldest first. Reading them is audited like reading a chat. */
  async editHistory(consumer: ConsumerRow, messageId: string, atasNama: AtasNama) {
    const message = await this.ownedMessage(consumer, messageId);
    const rows = await this.pool.query<{ id: string; bodyEnc: string | null; oleh: string; digantiAt: Date }>(
      `SELECT id, body_enc AS "bodyEnc", oleh, diganti_at AS "digantiAt" FROM kirim_message_edits WHERE message_id = $1 ORDER BY diganti_at, created_at`,
      [message.id],
    );
    await this.audit(this.pool, consumer, "pesan.riwayat_edit", message, atasNama, { jumlah: rows.rows.length });
    return {
      items: rows.rows.map((row) => ({
        isi: row.bodyEnc ? this.crypto.open(row.bodyEnc, columnAad("kirim_message_edits", "body_enc", row.id)) : null,
        diganti_at: row.digantiAt.toISOString(),
        diganti_oleh: changedByItem(row.oleh),
      })),
    };
  }

  // ------------------------------------------------------------------------------- delete

  /** §5.4: delete for everyone, this number's own message, within the delete window. The body is kept. */
  async remove(consumer: ConsumerRow, messageId: string, idempotencyKey: string, input: z.infer<typeof deleteSchema>) {
    const message = await this.ownedMessage(consumer, messageId);
    this.requireOwn(consumer, message);
    if (message.tipe === "panggilan") throw new KirimApiError(422, "not_deletable", "Catatan panggilan tidak bisa dihapus.");
    // Idempotent: a message already deleted, from here or from the phone, answers as it is.
    if (message.deletedAt) return this.item(message.id);
    this.requireSent(message);
    await this.requireWithin(message, this.options.deleteWindowHours * 3_600_000, "delete_window_passed", `Batas hapus ${this.options.deleteWindowHours} jam sudah lewat.`);
    const { device, provider, chat } = await this.engineTarget(message);
    this.check(await provider.deleteMessage(device, { chat, whatsappMessageId: message.waMessageId! }, this.engineKey(consumer, "delete", idempotencyKey)));
    await withTransaction(this.pool, async (client) => {
      const locked = (await messageById(client, message.id, true))!;
      const by = atasNamaRef(input.atas_nama);
      if (!(await recordDelete(client, locked, { at: await dbNow(client), by }))) await reattributeEcho(client, message.id, "delete", by);
      // As for edits: the engine accepted it, so it is audited even when its echo was stored first.
      await this.audit(client, consumer, "pesan.hapus", message, input.atas_nama, {});
    });
    return this.item(message.id);
  }

  // ----------------------------------------------------------------------------- reaction

  /** §5.5: this number's reaction on any message of the chat; `""` takes it back. */
  async react(consumer: ConsumerRow, messageId: string, idempotencyKey: string, input: z.infer<typeof reactionSchema>) {
    const message = await this.ownedMessage(consumer, messageId);
    if (message.deletedAt) throw new KirimApiError(409, "message_deleted", "Pesan sudah dihapus.");
    if (message.tipe === "panggilan") throw new KirimApiError(422, "not_reactable", "Catatan panggilan tidak bisa diberi reaksi.");
    this.requireSent(message);
    const fromMe = message.arah === "keluar";
    let participant: string | undefined;
    if (message.groupId && !fromMe) {
      const sender = await this.pool.query<{ pengirimEnc: string | null }>(`SELECT pengirim_enc AS "pengirimEnc" FROM kirim_messages WHERE id = $1`, [message.id]);
      const enc = sender.rows[0]?.pengirimEnc;
      participant = enc ? jidFromCanonical(this.crypto.open(enc, columnAad("kirim_messages", "pengirim_enc", message.id))) ?? undefined : undefined;
      if (!participant) throw new KirimApiError(422, "not_reactable", "Pengirim pesan grup ini tidak dikenal, jadi reaksi tidak bisa dikirim.");
    }
    const { device, provider, chat } = await this.engineTarget(message);
    this.check(await provider.react(
      device,
      { chat, whatsappMessageId: message.waMessageId!, fromMe, ...(participant ? { participant } : {}) },
      input.emoji,
      this.engineKey(consumer, "reaction", idempotencyKey),
    ));
    const officer = atasNamaRef(input.atas_nama);
    await withTransaction(this.pool, async (client) => {
      const locked = (await messageById(client, message.id, true))!;
      const next = nextReactions(locked.reactions, { k: "nomor_ini", dari: "nomor_ini", emoji: input.emoji, at: (await dbNow(client)).toISOString(), petugas: officer });
      await saveReactions(client, message.id, next.reactions);
      // Audited whenever the engine accepted it; an echo stored first only lacked the officer, which nextReactions adds.
      await this.audit(client, consumer, "pesan.reaksi", message, input.atas_nama, { dicabut: input.emoji === "" });
    });
    return this.item(message.id);
  }

  // ---------------------------------------------------------------------------- internals

  /** A message on another consumer's number answers 404, like one that does not exist. */
  private async ownedMessage(consumer: ConsumerRow, id: string): Promise<OwnedMessage> {
    if (!z.guid().safeParse(id).success) throw new KirimApiError(404, "not_found", "Pesan tidak ditemukan.");
    const owner = await this.pool.query<{ kode: string; mediaId: string | null }>(
      `SELECT d.kode, m.media_id AS "mediaId" FROM kirim_messages m JOIN kirim_devices d ON d.id = m.device_id
        WHERE m.id = $1 AND ${usesNumberSql("$2")}`,
      [id, consumer.id],
    );
    const found = owner.rows[0];
    const message = found ? await messageById(this.pool, id) : null;
    if (!found || !message) throw new KirimApiError(404, "not_found", "Pesan tidak ditemukan.");
    return { ...message, kode: found.kode, mediaId: found.mediaId };
  }

  /** Only this number's own messages: typed on its phone, or sent by the calling module. */
  private requireOwn(consumer: ConsumerRow, message: OwnedMessage): void {
    if (message.arah !== "keluar" || (message.asal !== "hp" && message.consumerId !== consumer.id)) {
      throw new KirimApiError(422, "not_own_message", "Hanya pesan yang dikirim nomor ini lewat modul ini atau dari HP-nya.");
    }
  }

  private requireSent(message: OwnedMessage): void {
    if (!message.waMessageId || NOT_SENT.has(message.status)) {
      throw new KirimApiError(409, "message_not_sent", "Pesan belum sampai ke WhatsApp.");
    }
  }

  /** Measured on database time from when WhatsApp took the message. */
  private async requireWithin(message: OwnedMessage, windowMs: number, code: string, text: string): Promise<void> {
    const now = await dbNow(this.pool);
    if (now.getTime() - message.sentAt.getTime() > windowMs) throw new KirimApiError(422, code, text);
  }

  private async engineTarget(message: OwnedMessage): Promise<{ device: DeviceRow; provider: KirimProvider; chat: ActionChat }> {
    const device = (await findDevice(this.pool, message.kode))!;
    if (device.status === "nonaktif") throw new KirimApiError(422, "device_inactive", "Nomor tidak aktif.");
    const provider = this.providers[device.provider];
    if (!provider) throw new KirimApiError(503, "engine_unavailable", "Mesin WhatsApp tidak tersedia.");
    if (message.groupId) return { device, provider, chat: { groupJid: await groupJid(this.pool, this.crypto, message.groupId) } };
    const to = recipientFromContact(await conversationContact(this.pool, this.crypto, message.conversationId!));
    if (!to) throw new KirimApiError(422, "invalid_number", "Nomor tidak sah.");
    return { device, provider, chat: to };
  }

  /** The engine key is per module and action, so two modules' keys, or an edit and a delete, never collide. */
  private engineKey(consumer: ConsumerRow, action: string, key: string): string {
    return `kirim-aksi:${this.crypto.lookup(`${consumer.id}:${action}:${key}`).slice(0, 48)}`;
  }

  private check(result: ActionResult): void {
    if (result.ok) return;
    this.options.log?.({ event: "kirim.action.failed", code: result.code }, "kirim message action refused by the engine");
    throw actionError(result);
  }

  private async audit(
    db: Queryable,
    consumer: ConsumerRow,
    aksi: string,
    message: OwnedMessage,
    atasNama: AtasNama,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await writeAudit(db, {
      actorKind: "service",
      actorRef: consumer.clientId,
      aksi,
      objekJenis: "pesan",
      objekRef: message.id,
      metadata: { device: message.kode, ...metadata },
      atasNama: atasNamaRef(atasNama),
    });
  }

  private async item(id: string) {
    return (await this.conversations.messageItemById(id))!;
  }
}

/** §9: engine refusals as stable API errors. The message in Kirim SQ is unchanged in every case. */
export function actionError(result: Exclude<ActionResult, { ok: true }>): KirimApiError {
  switch (result.code) {
    case "engine_conflict":
      return new KirimApiError(409, "idempotency_key_conflict", "Idempotency-Key sudah dipakai untuk permintaan lain.");
    case "rate_limited":
      return new KirimApiError(429, "engine_rate_limited", "Batas laju nomor ini tercapai; coba lagi sebentar.", { alasan: result.reason });
    case "device_disconnected":
      return new KirimApiError(503, "engine_unavailable", "Nomor WhatsApp tidak tersambung.");
    case "engine_unavailable":
      return new KirimApiError(503, "engine_unavailable", "Mesin WhatsApp tidak tersedia; coba lagi.");
    default:
      return new KirimApiError(422, "engine_rejected", "WhatsApp menolak aksi ini; pesan tidak berubah.");
  }
}

/**
 * An officer's edit or delete whose engine echo (`fromMe`) was ingested before the API's own transaction: ingest
 * stored it as done on the phone. Within a few minutes of the change, that phone attribution is the officer's.
 */
async function reattributeEcho(client: Queryable, messageId: string, aksi: "edit" | "delete", by: string): Promise<void> {
  if (aksi === "edit") {
    await client.query(
      `UPDATE kirim_message_edits SET oleh = $2
        WHERE id = (SELECT id FROM kirim_message_edits WHERE message_id = $1 ORDER BY diganti_at DESC, created_at DESC LIMIT 1)
          AND oleh = 'hp' AND diganti_at > now() - interval '5 minutes'`,
      [messageId, by],
    );
  } else {
    await client.query(
      `UPDATE kirim_messages SET deleted_by = $2, updated_at = now() WHERE id = $1 AND deleted_by = 'hp' AND deleted_at > now() - interval '5 minutes'`,
      [messageId, by],
    );
  }
}
