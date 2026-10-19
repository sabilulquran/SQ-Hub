import { randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { z } from "zod";

import { columnAad, InvalidNumberError, normalizePhone, phoneCanonical, type KirimCrypto } from "./crypto.js";
import type { KirimLog } from "./providers/log.js";
import { ProviderOperationError, type KirimProvider, type ProviderName, type ReadReceiptKey } from "./providers/types.js";
import {
  dbNow,
  ensureConversation,
  findDevice,
  withTransaction,
  writeAudit,
  type ConsumerRow,
  type DeviceRow,
  type Queryable,
} from "./repository.js";
import { canonicalJson, KirimApiError, OUTBOUND_MEDIA_MIMES, type KirimService } from "./service.js";

/**
 * KIRIM-IMPL-002 §5–§6: the conversation API for the module that owns a number. Answers carry
 * message bodies and full numbers because they are shown to staff; nothing here logs them.
 * Kirim SQ records the officer (`atas_nama`) but never checks staff permissions: the module does.
 */

export const atasNamaSchema = z
  .object({ issuer: z.string().trim().min(1).max(255).regex(/^\S+$/), sub: z.string().trim().min(1).max(255).regex(/^\S+$/) })
  .strict();
export type AtasNama = z.infer<typeof atasNamaSchema>;

const pageSize = z.coerce.number().int().min(1).max(100).default(30);

export const conversationListQuerySchema = z
  .object({ setelah: z.string().max(200).optional(), batas: pageSize, kontak: z.string().trim().min(1).max(40).optional(), belum_dibaca: z.enum(["1"]).optional() })
  .strict();
export const messageListQuerySchema = z.object({ sebelum: z.string().max(200).optional(), batas: pageSize }).strict();
export const groupListQuerySchema = z.object({ setelah: z.string().max(200).optional(), batas: pageSize }).strict();

export const openConversationSchema = z.object({ to: z.string().trim().min(1).max(40), atas_nama: atasNamaSchema }).strict();

export const replySchema = z
  .object({
    text: z.string().min(1).max(4096).optional(),
    media_id: z.string().uuid().optional(),
    caption: z.string().min(1).max(4096).optional(),
    atas_nama: atasNamaSchema,
    ref: z.string().max(200).optional(),
    kedaluwarsa: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .refine((body) => (body.text === undefined) !== (body.media_id === undefined), { message: "send exactly one of text or media_id" })
  .refine((body) => body.caption === undefined || body.media_id !== undefined, { message: "caption is only allowed with media_id" });
export type ReplyInput = z.infer<typeof replySchema>;

export const readSchema = z.object({ atas_nama: atasNamaSchema, sampai_message_id: z.string().uuid() }).strict();

/** T-2: an officer reply waits up to 72 hours by default, at most 7 days. */
export const REPLY_DEFAULT_TTL_HOURS = 72;
const REPLY_MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** KIRIM-001 §13 no. 3: an opted-out person may still get replies for 24 hours after writing in. */
const OPTOUT_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** §3: one `percakapan.baca` audit row per officer per conversation per 15 minutes. */
const READ_AUDIT_WINDOW = "15 minutes";

const TIPE_BY_MIME: Record<string, "dokumen" | "gambar"> = { "application/pdf": "dokumen", "image/jpeg": "gambar", "image/png": "gambar" };

export function atasNamaRef(value: AtasNama): string {
  return `${value.issuer} ${value.sub}`;
}

function atasNamaFromRef(value: string | null): AtasNama | null {
  if (!value) return null;
  const space = value.indexOf(" ");
  return space > 0 ? { issuer: value.slice(0, space), sub: value.slice(space + 1) } : null;
}

/** GET calls name the officer in two headers (§3). */
export function atasNamaFromHeaders(headers: Record<string, string | string[] | undefined>): AtasNama {
  const value = (name: string) => {
    const raw = headers[name];
    return Array.isArray(raw) ? raw[0] : raw;
  };
  const parsed = atasNamaSchema.safeParse({ issuer: value("x-kirim-atas-nama-issuer"), sub: value("x-kirim-atas-nama-sub") });
  if (!parsed.success) throw new KirimApiError(400, "atas_nama_required", "Sebutkan petugas yang sedang bekerja (atas_nama).");
  return parsed.data;
}

/** Opaque cursor: a time and an id, stable while new messages arrive. */
export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`, "utf8").toString("base64url");
}

export function decodeCursor(value: string | undefined): { at: Date; id: string } | null {
  if (!value) return null;
  const decoded = Buffer.from(value, "base64url").toString("utf8");
  const [at, id] = decoded.split("|");
  if (!at || !id || Number.isNaN(Date.parse(at)) || !z.string().uuid().safeParse(id).success) {
    throw new KirimApiError(400, "invalid_cursor", "Cursor tidak sah.");
  }
  return { at: new Date(at), id };
}

interface ConversationRow {
  id: string;
  deviceId: string;
  kode: string;
  kontakEnc: string;
  kontakJenis: "pn" | "lid";
  kontakHmac: string;
  kontakAltEnc: string | null;
  kontakAltHmac: string | null;
  namaProfilEnc: string | null;
  pesanTerakhirAt: Date | null;
  pesanMasukTerakhirAt: Date | null;
  belumDibaca: number;
  dibacaSampaiAt: Date | null;
  createdAt: Date;
}

interface MessageRow {
  id: string;
  conversationId: string | null;
  groupId: string | null;
  arah: "masuk" | "keluar";
  asal: string | null;
  diimpor: boolean;
  petugas: string | null;
  consumer: string | null;
  jenis: string | null;
  tipe: string;
  bodyEnc: string | null;
  bodyDisamarkan: boolean;
  mediaId: string | null;
  mediaMime: string | null;
  mediaUkuran: string | null;
  mediaPath: string | null;
  mediaTidakDisalin: string | null;
  pengirimEnc: string | null;
  status: string;
  errorCode: string | null;
  createdAt: Date;
  providerAt: Date | null;
}

const CONVERSATION_COLUMNS = `
  c.id, c.device_id AS "deviceId", d.kode, c.kontak_enc AS "kontakEnc", c.kontak_jenis AS "kontakJenis", c.kontak_hmac AS "kontakHmac",
  c.kontak_alt_enc AS "kontakAltEnc", c.kontak_alt_hmac AS "kontakAltHmac", c.nama_profil_enc AS "namaProfilEnc",
  c.pesan_terakhir_at AS "pesanTerakhirAt", c.pesan_masuk_terakhir_at AS "pesanMasukTerakhirAt", c.belum_dibaca AS "belumDibaca",
  c.dibaca_sampai_at AS "dibacaSampaiAt", c.created_at AS "createdAt"
`;

const MESSAGE_COLUMNS = `
  m.id, m.conversation_id AS "conversationId", m.group_id AS "groupId", m.arah, m.asal, m.diimpor, m.petugas, mc.nama AS consumer,
  m.jenis, m.tipe, m.body_enc AS "bodyEnc", m.body_disamarkan AS "bodyDisamarkan", m.media_id AS "mediaId",
  md.mime AS "mediaMime", md.ukuran::text AS "mediaUkuran", md.path AS "mediaPath", md.tidak_disalin AS "mediaTidakDisalin",
  m.pengirim_enc AS "pengirimEnc", m.status, o.error_code AS "errorCode", m.created_at AS "createdAt", m.provider_at AS "providerAt"
`;

const MESSAGE_JOINS = `
  LEFT JOIN kirim_consumers mc ON mc.id = m.consumer_id
  LEFT JOIN kirim_media md ON md.id = m.media_id
  LEFT JOIN kirim_outbox o ON o.message_id = m.id
`;

export class KirimConversations {
  constructor(
    private readonly pool: Pool,
    private readonly crypto: KirimCrypto,
    private readonly service: KirimService,
    private readonly providers: Record<ProviderName, KirimProvider | undefined>,
    private readonly options: { replyTtlHours?: number; log?: KirimLog } = {},
  ) {}

  // ---------------------------------------------------------------------------------- access

  /** Every §6 call: the number must belong to the calling consumer (KIRIM-001 §3.3). */
  async ownedDevice(consumer: ConsumerRow, kode: string): Promise<DeviceRow> {
    const device = await findDevice(this.pool, kode);
    if (!device || device.pemilikConsumerId !== consumer.id) throw new KirimApiError(403, "not_owner", "Hanya modul pemilik nomor yang boleh memakai ini.");
    return device;
  }

  /** A conversation on another consumer's number answers 404, like one that does not exist. */
  private async ownedConversation(db: Queryable, consumer: ConsumerRow, id: string, lock = false): Promise<ConversationRow> {
    if (!z.string().uuid().safeParse(id).success) throw new KirimApiError(404, "not_found", "Percakapan tidak ditemukan.");
    const result = await db.query<ConversationRow>(
      `SELECT ${CONVERSATION_COLUMNS} FROM kirim_conversations c JOIN kirim_devices d ON d.id = c.device_id
       WHERE c.id = $1 AND d.pemilik_consumer_id = $2 ${lock ? "FOR UPDATE OF c" : ""}`,
      [id, consumer.id],
    );
    const row = result.rows[0];
    if (!row) throw new KirimApiError(404, "not_found", "Percakapan tidak ditemukan.");
    return row;
  }

  private async ownedGroup(db: Queryable, consumer: ConsumerRow, id: string, lock = false) {
    if (!z.string().uuid().safeParse(id).success) throw new KirimApiError(404, "not_found", "Grup tidak ditemukan.");
    const result = await db.query<GroupRow>(
      `SELECT ${GROUP_COLUMNS} FROM kirim_groups g JOIN kirim_devices d ON d.id = g.device_id
       WHERE g.id = $1 AND d.pemilik_consumer_id = $2 AND g.keluar_at IS NULL ${lock ? "FOR UPDATE OF g" : ""}`,
      [id, consumer.id],
    );
    const row = result.rows[0];
    if (!row) throw new KirimApiError(404, "not_found", "Grup tidak ditemukan.");
    return row;
  }

  // ------------------------------------------------------------------------- conversations

  async listConversations(consumer: ConsumerRow, kode: string, query: z.infer<typeof conversationListQuerySchema>) {
    const device = await this.ownedDevice(consumer, kode);
    const cursor = decodeCursor(query.setelah);
    const params: unknown[] = [device.id, query.batas + 1];
    let filter = "";
    if (query.kontak) {
      const hmac = this.crypto.lookup(phoneCanonical(this.normalize(query.kontak)));
      params.push(hmac);
      filter += ` AND (c.kontak_hmac = $${params.length} OR c.kontak_alt_hmac = $${params.length})`;
    }
    if (query.belum_dibaca) filter += " AND c.belum_dibaca > 0";
    if (cursor) {
      params.push(cursor.at, cursor.id);
      filter += ` AND (coalesce(c.pesan_terakhir_at, c.created_at), c.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
    }
    const rows = await this.pool.query<ConversationRow>(
      `SELECT ${CONVERSATION_COLUMNS} FROM kirim_conversations c JOIN kirim_devices d ON d.id = c.device_id
       WHERE c.device_id = $1 ${filter}
       ORDER BY coalesce(c.pesan_terakhir_at, c.created_at) DESC, c.id DESC LIMIT $2`,
      params,
    );
    const page = rows.rows.slice(0, query.batas);
    const items = await this.conversationItems(consumer, device.id, page);
    const last = page.at(-1);
    return { items, setelah: rows.rows.length > query.batas && last ? encodeCursor(last.pesanTerakhirAt ?? last.createdAt, last.id) : null };
  }

  async getConversation(consumer: ConsumerRow, id: string) {
    const row = await this.ownedConversation(this.pool, consumer, id);
    return (await this.conversationItems(consumer, row.deviceId, [row]))[0]!;
  }

  async listMessages(consumer: ConsumerRow, id: string, query: z.infer<typeof messageListQuerySchema>, atasNama: AtasNama) {
    const conversation = await this.ownedConversation(this.pool, consumer, id);
    const page = await this.messagePage("m.conversation_id", conversation.id, query);
    await this.auditRead(consumer, conversation.id, atasNama);
    return page;
  }

  /** §6.1: open or create a conversation without sending anything. */
  async openConversation(consumer: ConsumerRow, kode: string, input: z.infer<typeof openConversationSchema>) {
    const device = await this.ownedDevice(consumer, kode);
    if (device.status === "nonaktif") throw new KirimApiError(422, "device_inactive", "Nomor tidak aktif.");
    const canonical = phoneCanonical(this.normalize(input.to));
    const hmac = this.crypto.lookup(canonical);
    return withTransaction(this.pool, async (client) => {
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM kirim_conversations WHERE device_id = $1 AND (kontak_hmac = $2 OR kontak_alt_hmac = $2)
         ORDER BY (kontak_hmac = $2) DESC, created_at LIMIT 1`,
        [device.id, hmac],
      );
      const created = !existing.rows[0];
      const id = existing.rows[0]?.id ?? (await ensureConversation(client, this.crypto, { deviceId: device.id, canonical, jenis: "pn" }));
      await writeAudit(client, {
        actorKind: "service",
        actorRef: consumer.clientId,
        aksi: "percakapan.buka",
        objekJenis: "percakapan",
        objekRef: id,
        metadata: { device: device.kode, baru: created },
        atasNama: atasNamaRef(input.atas_nama),
      });
      return { created, id };
    }).then(async ({ created, id }) => ({ created, conversation: await this.getConversation(consumer, id) }));
  }

  /** §5.1: officer reply, ahead of automatic messages, free of send hours. */
  async reply(consumer: ConsumerRow, conversationId: string, idempotencyKey: string, input: ReplyInput) {
    const requestHash = this.crypto.lookup(`reply:${conversationId}:${canonicalJson(input)}`);
    const replay = await this.service.findIdempotent(this.pool, consumer.id, idempotencyKey, requestHash);
    if (replay) return replay;
    const conversation = await this.ownedConversation(this.pool, consumer, conversationId);
    const device = (await findDevice(this.pool, conversation.kode))!;
    if (device.status === "nonaktif") throw new KirimApiError(422, "device_inactive", "Nomor tidak aktif.");
    const now = await dbNow(this.pool);
    const hmacs = [conversation.kontakHmac, ...(conversation.kontakAltHmac ? [conversation.kontakAltHmac] : [])];
    if (await this.service.isOptedOut(this.pool, hmacs, consumer.id, device.id)) {
      const wroteRecently = conversation.pesanMasukTerakhirAt && now.getTime() - conversation.pesanMasukTerakhirAt.getTime() < OPTOUT_REPLY_WINDOW_MS;
      if (!wroteRecently) throw new KirimApiError(422, "optout", "Nomor minta tidak dihubungi dan tidak menulis dalam 24 jam terakhir.");
    }
    const tipe = await this.replyMediaTipe(consumer, device.id, input.media_id);
    return this.queueReply(consumer, device, idempotencyKey, requestHash, input, tipe, now, {
      conversationId: conversation.id,
      groupId: null,
      toHmac: conversation.kontakHmac,
    });
  }

  /** §6.1: `belum_dibaca = 0`, then read receipts to WhatsApp for messages with a WhatsApp id. */
  async markRead(consumer: ConsumerRow, conversationId: string, input: z.infer<typeof readSchema>) {
    const outcome = await withTransaction(this.pool, async (client) => {
      const conversation = await this.ownedConversation(client, consumer, conversationId, true);
      const target = await client.query<{ at: Date }>(
        `SELECT coalesce(provider_at, created_at) AS at FROM kirim_messages WHERE id = $1 AND conversation_id = $2`,
        [input.sampai_message_id, conversation.id],
      );
      const until = target.rows[0]?.at;
      if (!until) throw new KirimApiError(404, "not_found", "Pesan tidak ditemukan di percakapan ini.");
      const unread = await client.query<{ waMessageId: string }>(
        `SELECT wa_message_id AS "waMessageId" FROM kirim_messages
         WHERE conversation_id = $1 AND arah = 'masuk' AND NOT diimpor AND wa_message_id IS NOT NULL
           AND coalesce(provider_at, created_at) <= $2 AND ($3::timestamptz IS NULL OR coalesce(provider_at, created_at) > $3)
         ORDER BY coalesce(provider_at, created_at) LIMIT 500`,
        [conversation.id, until, conversation.dibacaSampaiAt],
      );
      await client.query(
        `UPDATE kirim_conversations SET belum_dibaca = 0, dibaca_sampai_at = greatest(coalesce(dibaca_sampai_at, $2), $2) WHERE id = $1`,
        [conversation.id, until],
      );
      await writeAudit(client, {
        actorKind: "service",
        actorRef: consumer.clientId,
        aksi: "percakapan.tandai_dibaca",
        objekJenis: "percakapan",
        objekRef: conversation.id,
        metadata: { device: conversation.kode, pesan: unread.rows.length },
        atasNama: atasNamaRef(input.atas_nama),
      });
      const contact = this.crypto.open(conversation.kontakEnc, columnAad("kirim_conversations", "kontak_enc", conversation.id));
      const remoteJid = contact.startsWith("pn:+") ? `${contact.slice(4)}@s.whatsapp.net` : contact.slice(4);
      return { kode: conversation.kode, keys: unread.rows.map((row): ReadReceiptKey => ({ remoteJid, whatsappMessageId: row.waMessageId })) };
    });
    if (outcome.keys.length === 0) return { mesin: "tidak_ada" as const };
    const device = (await findDevice(this.pool, outcome.kode))!;
    const provider = this.providers[device.provider];
    try {
      await provider?.markRead(device, outcome.keys);
      return { mesin: "berhasil" as const };
    } catch (error) {
      // Read ticks on the sender's phone are not needed for staff work, so this is not retried.
      this.options.log?.({ event: "kirim.read.failed", device: device.kode, code: error instanceof ProviderOperationError ? error.code : "error" }, "kirim read receipt failed");
      return { mesin: "gagal" as const };
    }
  }

  /** §6.1: media of the caller's own number, decrypted for the loopback caller only. */
  async media(consumer: ConsumerRow, id: string, atasNama: AtasNama): Promise<{ mime: string; data: Buffer }> {
    if (!z.string().uuid().safeParse(id).success) throw new KirimApiError(404, "not_found", "Media tidak ditemukan.");
    const result = await this.pool.query<{ id: string; mime: string; path: string | null; tidakDisalin: string | null; kode: string }>(
      `SELECT md.id, md.mime, md.path, md.tidak_disalin AS "tidakDisalin", d.kode
       FROM kirim_media md JOIN kirim_devices d ON d.id = md.device_id WHERE md.id = $1 AND d.pemilik_consumer_id = $2`,
      [id, consumer.id],
    );
    const row = result.rows[0];
    if (!row) throw new KirimApiError(404, "not_found", "Media tidak ditemukan.");
    if (!row.path) throw new KirimApiError(410, "media_unavailable", mediaReason(row.tidakDisalin));
    const data = await this.service.readMediaFile(row.id, row.path);
    await writeAudit(this.pool, {
      actorKind: "service",
      actorRef: consumer.clientId,
      aksi: "media.unduh",
      objekJenis: "media",
      objekRef: row.id,
      metadata: { device: row.kode, ukuran: data.length },
      atasNama: atasNamaRef(atasNama),
    });
    return { mime: row.mime, data };
  }

  // -------------------------------------------------------------------------------- groups

  async listGroups(consumer: ConsumerRow, kode: string, query: z.infer<typeof groupListQuerySchema>) {
    const device = await this.ownedDevice(consumer, kode);
    const cursor = decodeCursor(query.setelah);
    const params: unknown[] = [device.id, query.batas + 1];
    let filter = "";
    if (cursor) {
      params.push(cursor.at, cursor.id);
      filter = ` AND (coalesce(g.pesan_terakhir_at, g.created_at), g.id) < ($3::timestamptz, $4::uuid)`;
    }
    const rows = await this.pool.query<GroupRow>(
      `SELECT ${GROUP_COLUMNS} FROM kirim_groups g JOIN kirim_devices d ON d.id = g.device_id
       WHERE g.device_id = $1 AND g.keluar_at IS NULL ${filter}
       ORDER BY coalesce(g.pesan_terakhir_at, g.created_at) DESC, g.id DESC LIMIT $2`,
      params,
    );
    const page = rows.rows.slice(0, query.batas);
    const last = page.at(-1);
    return {
      items: await Promise.all(page.map((row) => this.groupItem(row))),
      setelah: rows.rows.length > query.batas && last ? encodeCursor(last.pesanTerakhirAt ?? last.createdAt, last.id) : null,
    };
  }

  async getGroup(consumer: ConsumerRow, id: string) {
    return this.groupItem(await this.ownedGroup(this.pool, consumer, id));
  }

  async listGroupMessages(consumer: ConsumerRow, id: string, query: z.infer<typeof messageListQuerySchema>, atasNama: AtasNama) {
    const group = await this.ownedGroup(this.pool, consumer, id);
    const page = await this.messagePage("m.group_id", group.id, query);
    await this.auditRead(consumer, group.id, atasNama);
    return page;
  }

  /** §6.2: a reply to a group; opt-out does not apply because it is not a private message. */
  async replyGroup(consumer: ConsumerRow, groupId: string, idempotencyKey: string, input: ReplyInput) {
    const requestHash = this.crypto.lookup(`group-reply:${groupId}:${canonicalJson(input)}`);
    const replay = await this.service.findIdempotent(this.pool, consumer.id, idempotencyKey, requestHash);
    if (replay) return replay;
    const group = await this.ownedGroup(this.pool, consumer, groupId);
    const device = (await findDevice(this.pool, group.kode))!;
    if (device.status === "nonaktif") throw new KirimApiError(422, "device_inactive", "Nomor tidak aktif.");
    const tipe = await this.replyMediaTipe(consumer, device.id, input.media_id);
    return this.queueReply(consumer, device, idempotencyKey, requestHash, input, tipe, await dbNow(this.pool), {
      conversationId: null,
      groupId: group.id,
      toHmac: group.groupHmac,
    });
  }

  /** The engine has no group read receipts, so this only clears the counter in Kirim SQ. */
  async markGroupRead(consumer: ConsumerRow, groupId: string, input: z.infer<typeof readSchema>) {
    return withTransaction(this.pool, async (client) => {
      const group = await this.ownedGroup(client, consumer, groupId, true);
      const target = await client.query<{ at: Date }>(
        `SELECT coalesce(provider_at, created_at) AS at FROM kirim_messages WHERE id = $1 AND group_id = $2`,
        [input.sampai_message_id, group.id],
      );
      const until = target.rows[0]?.at;
      if (!until) throw new KirimApiError(404, "not_found", "Pesan tidak ditemukan di grup ini.");
      await client.query(
        `UPDATE kirim_groups SET belum_dibaca = 0, dibaca_sampai_at = greatest(coalesce(dibaca_sampai_at, $2), $2) WHERE id = $1`,
        [group.id, until],
      );
      await writeAudit(client, {
        actorKind: "service",
        actorRef: consumer.clientId,
        aksi: "grup.tandai_dibaca",
        objekJenis: "grup",
        objekRef: group.id,
        metadata: { device: group.kode },
        atasNama: atasNamaRef(input.atas_nama),
      });
      return { mesin: "tidak_ada" as const };
    });
  }

  // ------------------------------------------------------------------------------ internals

  private normalize(value: string): string {
    try {
      return normalizePhone(value);
    } catch (error) {
      if (error instanceof InvalidNumberError) throw new KirimApiError(422, "invalid_number", "Nomor tidak sah.");
      throw error;
    }
  }

  private async replyMediaTipe(consumer: ConsumerRow, deviceId: string, mediaId: string | undefined): Promise<"teks" | "dokumen" | "gambar"> {
    if (!mediaId) return "teks";
    const media = await this.pool.query<{ mime: string }>(
      `SELECT mime FROM kirim_media WHERE id = $1 AND device_id = $2 AND uploaded_by_consumer_id = $3 AND arah = 'keluar' AND path IS NOT NULL`,
      [mediaId, deviceId, consumer.id],
    );
    const mime = media.rows[0]?.mime;
    if (!mime || !OUTBOUND_MEDIA_MIMES.includes(mime)) throw new KirimApiError(422, "media_invalid", "Media tidak dikenal untuk nomor ini.");
    return TIPE_BY_MIME[mime] ?? "dokumen";
  }

  private async queueReply(
    consumer: ConsumerRow,
    device: DeviceRow,
    idempotencyKey: string,
    requestHash: string,
    input: ReplyInput,
    tipe: "teks" | "dokumen" | "gambar",
    now: Date,
    target: { conversationId: string | null; groupId: string | null; toHmac: string },
  ): Promise<{ id: string; status: string }> {
    const ttlMs = (this.options.replyTtlHours ?? REPLY_DEFAULT_TTL_HOURS) * 60 * 60 * 1000;
    const requested = input.kedaluwarsa ? new Date(input.kedaluwarsa).getTime() : null;
    const expiresAt = new Date(Math.min(requested ?? now.getTime() + ttlMs, now.getTime() + REPLY_MAX_TTL_MS));
    if (expiresAt.getTime() <= now.getTime()) throw new KirimApiError(400, "invalid_request", "kedaluwarsa harus di masa depan.");
    const officer = atasNamaRef(input.atas_nama);
    const body = input.text ?? input.caption ?? null;
    try {
      return await withTransaction(this.pool, async (client) => {
        const messageId = randomUUID();
        const outboxId = randomUUID();
        await client.query(
          `INSERT INTO kirim_messages (id, conversation_id, group_id, device_id, arah, asal, petugas, jenis, tipe, body_enc, media_id, provider, status, consumer_id)
           VALUES ($1, $2, $3, $4, 'keluar', 'petugas', $5, 'percakapan', $6, $7, $8, $9, 'antre', $10)`,
          [
            messageId,
            target.conversationId,
            target.groupId,
            device.id,
            officer,
            tipe,
            body ? this.crypto.seal(body, columnAad("kirim_messages", "body_enc", messageId)) : null,
            input.media_id ?? null,
            device.provider,
            consumer.id,
          ],
        );
        await client.query(
          `INSERT INTO kirim_outbox (id, consumer_id, device_id, idempotency_key, request_hash, jenis, prioritas, to_hmac, ref, message_id, expires_at, atas_nama, group_id)
           VALUES ($1, $2, $3, $4, $5, 'percakapan', 'petugas', $6, $7, $8, $9, $10, $11)`,
          [outboxId, consumer.id, device.id, idempotencyKey, requestHash, target.toHmac, input.ref ?? null, messageId, expiresAt, officer, target.groupId],
        );
        if (target.groupId) await client.query("UPDATE kirim_groups SET pesan_terakhir_at = now() WHERE id = $1", [target.groupId]);
        else await client.query("UPDATE kirim_conversations SET pesan_terakhir_at = now() WHERE id = $1", [target.conversationId]);
        await writeAudit(client, {
          actorKind: "service",
          actorRef: consumer.clientId,
          aksi: target.groupId ? "grup.balas" : "percakapan.balas",
          objekJenis: target.groupId ? "grup" : "percakapan",
          objekRef: target.groupId ?? target.conversationId!,
          metadata: { device: device.kode, tipe },
          atasNama: officer,
        });
        return { id: messageId, status: "antre" };
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        const raced = await this.service.findIdempotent(this.pool, consumer.id, idempotencyKey, requestHash);
        if (raced) return raced;
      }
      throw error;
    }
  }

  private async messagePage(column: "m.conversation_id" | "m.group_id", id: string, query: z.infer<typeof messageListQuerySchema>) {
    const cursor = decodeCursor(query.sebelum);
    const params: unknown[] = [id, query.batas + 1];
    const filter = cursor ? ` AND (m.created_at, m.id) < ($3::timestamptz, $4::uuid)` : "";
    if (cursor) params.push(cursor.at, cursor.id);
    const rows = await this.pool.query<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM kirim_messages m ${MESSAGE_JOINS}
       WHERE ${column} = $1 ${filter} ORDER BY m.created_at DESC, m.id DESC LIMIT $2`,
      params,
    );
    const page = rows.rows.slice(0, query.batas);
    const last = page.at(-1);
    return {
      items: page.map((row) => this.messageItem(row)),
      sebelum: rows.rows.length > query.batas && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  private async auditRead(consumer: ConsumerRow, objekRef: string, atasNama: AtasNama): Promise<void> {
    const officer = atasNamaRef(atasNama);
    const recent = await this.pool.query(
      `SELECT 1 FROM kirim_audit WHERE aksi = 'percakapan.baca' AND objek_ref = $1 AND atas_nama = $2
         AND occurred_at > now() - interval '${READ_AUDIT_WINDOW}' LIMIT 1`,
      [objekRef, officer],
    );
    if ((recent.rowCount ?? 0) > 0) return;
    await writeAudit(this.pool, {
      actorKind: "service",
      actorRef: consumer.clientId,
      aksi: "percakapan.baca",
      objekJenis: "percakapan",
      objekRef,
      atasNama: officer,
    });
  }

  private async conversationItems(consumer: ConsumerRow, deviceId: string, rows: ConversationRow[]) {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const last = await this.pool.query<MessageRow>(
      `SELECT DISTINCT ON (m.conversation_id) ${MESSAGE_COLUMNS} FROM kirim_messages m ${MESSAGE_JOINS}
       WHERE m.conversation_id = ANY($1::uuid[]) ORDER BY m.conversation_id, m.created_at DESC, m.id DESC`,
      [ids],
    );
    const lastBy = new Map(last.rows.map((row) => [row.conversationId!, row]));
    const hmacs = rows.flatMap((row) => [row.kontakHmac, ...(row.kontakAltHmac ? [row.kontakAltHmac] : [])]);
    const optouts = await this.pool.query<{ nomorHmac: string }>(
      `SELECT DISTINCT nomor_hmac AS "nomorHmac" FROM kirim_optouts WHERE nomor_hmac = ANY($1::text[])
         AND (cakupan = 'semua' OR (cakupan = 'consumer' AND consumer_id = $2) OR (cakupan = 'device' AND device_id = $3))`,
      [hmacs, consumer.id, deviceId],
    );
    const optedOut = new Set(optouts.rows.map((row) => row.nomorHmac));
    return rows.map((row) => {
      const contact = this.crypto.open(row.kontakEnc, columnAad("kirim_conversations", "kontak_enc", row.id));
      const alt = row.kontakAltEnc ? this.crypto.open(row.kontakAltEnc, columnAad("kirim_conversations", "kontak_alt_enc", row.id)) : null;
      const nomor = contact.startsWith("pn:+") ? contact.slice(3) : alt?.startsWith("pn:+") ? alt.slice(3) : null;
      const janganHubungi = optedOut.has(row.kontakHmac) || (row.kontakAltHmac !== null && optedOut.has(row.kontakAltHmac));
      const message = lastBy.get(row.id);
      return {
        id: row.id,
        device: row.kode,
        kontak: { nomor, jenis: row.kontakJenis },
        nama_profil: row.namaProfilEnc ? this.crypto.open(row.namaProfilEnc, columnAad("kirim_conversations", "nama_profil_enc", row.id)) : null,
        pesan_terakhir_at: row.pesanTerakhirAt?.toISOString() ?? null,
        belum_dibaca: row.belumDibaca,
        jangan_hubungi: janganHubungi,
        bisa_dibalas_sampai: janganHubungi && row.pesanMasukTerakhirAt
          ? new Date(row.pesanMasukTerakhirAt.getTime() + OPTOUT_REPLY_WINDOW_MS).toISOString()
          : null,
        pesan_terakhir: message ? this.lastMessageSummary(message) : null,
      };
    });
  }

  private lastMessageSummary(row: MessageRow) {
    const item = this.messageItem(row);
    return {
      id: item.id,
      arah: item.arah,
      asal: item.asal,
      tipe: item.tipe,
      cuplikan: item.isi ? item.isi.slice(0, 200) : null,
      disamarkan: item.disamarkan,
      status: item.status,
      waktu: item.waktu,
    };
  }

  private messageItem(row: MessageRow) {
    const isi = row.bodyEnc && !row.bodyDisamarkan ? this.crypto.open(row.bodyEnc, columnAad("kirim_messages", "body_enc", row.id)) : null;
    const pengirim = row.pengirimEnc ? this.crypto.open(row.pengirimEnc, columnAad("kirim_messages", "pengirim_enc", row.id)) : null;
    return {
      id: row.id,
      arah: row.arah,
      asal: row.asal,
      diimpor: row.diimpor,
      dikirim_oleh: row.asal === "otomatis" || row.asal === "petugas" ? row.consumer : null,
      petugas: row.asal === "petugas" ? atasNamaFromRef(row.petugas) : null,
      ...(row.groupId ? { pengirim: pengirim ? { nomor: pengirim.startsWith("pn:+") ? pengirim.slice(3) : null, nama_profil: null } : null } : {}),
      tipe: row.tipe,
      isi,
      disamarkan: row.bodyDisamarkan,
      media: row.mediaId
        ? { id: row.mediaId, mime: row.mediaMime, ukuran: row.mediaUkuran ? Number(row.mediaUkuran) : null, tersedia: row.mediaPath !== null, alasan: row.mediaTidakDisalin }
        : null,
      status: row.status,
      error_code: row.errorCode,
      waktu: row.createdAt.toISOString(),
      waktu_mesin: row.providerAt?.toISOString() ?? null,
    };
  }

  private async groupItem(row: GroupRow) {
    const last = await this.pool.query<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM kirim_messages m ${MESSAGE_JOINS} WHERE m.group_id = $1 ORDER BY m.created_at DESC, m.id DESC LIMIT 1`,
      [row.id],
    );
    return {
      id: row.id,
      device: row.kode,
      nama: row.namaEnc ? this.crypto.open(row.namaEnc, columnAad("kirim_groups", "nama_enc", row.id)) : null,
      jumlah_anggota: row.jumlahAnggota,
      nomor_ini_admin: row.nomorIniAdmin,
      pesan_terakhir_at: row.pesanTerakhirAt?.toISOString() ?? null,
      belum_dibaca: row.belumDibaca,
      pesan_terakhir: last.rows[0] ? this.lastMessageSummary(last.rows[0]) : null,
    };
  }
}

interface GroupRow {
  id: string;
  kode: string;
  groupHmac: string;
  namaEnc: string | null;
  jumlahAnggota: number | null;
  nomorIniAdmin: boolean;
  pesanTerakhirAt: Date | null;
  belumDibaca: number;
  createdAt: Date;
}

const GROUP_COLUMNS = `
  g.id, d.kode, g.group_hmac AS "groupHmac", g.nama_enc AS "namaEnc", g.jumlah_anggota AS "jumlahAnggota",
  g.nomor_ini_admin AS "nomorIniAdmin", g.pesan_terakhir_at AS "pesanTerakhirAt", g.belum_dibaca AS "belumDibaca", g.created_at AS "createdAt"
`;

function mediaReason(reason: string | null): string {
  if (reason === "terlalu_besar") return "Media terlalu besar untuk disalin ke Kirim SQ.";
  if (reason === "disk_rendah") return "Media tidak disalin karena ruang disk rendah.";
  return "Media gagal diunduh dari mesin.";
}
