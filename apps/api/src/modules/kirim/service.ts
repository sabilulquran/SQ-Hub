import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, statfs, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Pool } from "pg";
import { z } from "zod";

import { columnAad, InvalidNumberError, KirimCryptoError, maskPhone, normalizePhone, phoneCanonical, type KirimCrypto } from "./crypto.js";
import { wibDayStart } from "./policy.js";
import {
  dbNow,
  enqueueWebhook,
  ensureConversation,
  findConsumerByClientId,
  findDevice,
  routeAllows,
  withTransaction,
  writeAudit,
  type ConsumerRow,
  type Queryable,
} from "./repository.js";

/** KIRIM-IMPL-001 §5.1 and §6.1: accepting messages, media and opt-outs from consumer modules. */

export class KirimApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "KirimApiError";
  }
}

export const sendMessageSchema = z
  .object({
    device: z.string().trim().regex(/^[a-z][a-z0-9-]{1,30}$/),
    jenis: z.enum(["notifikasi", "kode"]),
    to: z.string().trim().min(1).max(40),
    text: z.string().min(1).max(4096).optional(),
    media_id: z.guid().optional(),
    caption: z.string().min(1).max(4096).optional(),
    prioritas: z.enum(["normal", "tinggi"]).default("normal"),
    kedaluwarsa: z.string().datetime({ offset: true }).optional(),
    ref: z.string().max(200).optional(),
  })
  .strict()
  .refine((body) => (body.text === undefined) !== (body.media_id === undefined), {
    message: "send exactly one of text or media_id",
  })
  .refine((body) => body.caption === undefined || body.media_id !== undefined, {
    message: "caption is only allowed with media_id",
  });

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

const deviceKodeSchema = z.string().trim().regex(/^[a-z][a-z0-9-]{1,30}$/);

/** D-5 and KIRIM-IMPL-002 §8: `consumer` for the caller's own messages, `device` for the number's owner. */
export const optoutSchema = z.discriminatedUnion("cakupan", [
  z.object({ nomor: z.string().trim().min(1).max(40), cakupan: z.literal("consumer"), alasan: z.string().trim().min(1).max(500) }).strict(),
  z.object({ nomor: z.string().trim().min(1).max(40), cakupan: z.literal("device"), device: deviceKodeSchema, alasan: z.string().trim().min(1).max(500) }).strict(),
]);

export type OptoutInput = z.infer<typeof optoutSchema>;

/** KIRIM-IMPL-002 §5.3: PDF, JPEG and PNG, checked by their magic bytes. */
const MEDIA_SIGNATURES: Array<{ mime: string; magic: Buffer }> = [
  { mime: "application/pdf", magic: Buffer.from("%PDF-", "ascii") },
  { mime: "image/jpeg", magic: Buffer.from([0xff, 0xd8, 0xff]) },
  { mime: "image/png", magic: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
];
export const OUTBOUND_MEDIA_MIMES = MEDIA_SIGNATURES.map((item) => item.mime);

const NOTIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 10 * 60 * 1000;
export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;
const LOW_DISK_BYTES = 5 * 1024 * 1024 * 1024;

export class KirimService {
  constructor(
    private readonly pool: Pool,
    private readonly crypto: KirimCrypto,
    private readonly mediaRoot: string,
  ) {}

  /** Step 2 of §5.1: the token's client must be a registered, active consumer. */
  async requireConsumer(clientId: string): Promise<ConsumerRow> {
    const consumer = await findConsumerByClientId(this.pool, clientId);
    if (!consumer || !consumer.aktif) throw new KirimApiError(403, "consumer_unknown", "Pemakai tidak terdaftar.");
    return consumer;
  }

  /**
   * Steps 5–11 of §5.1, in order, stopping at the first failure. On success the conversation,
   * message (`keluar`, `otomatis`, `antre`) and outbox row are written in one transaction.
   */
  async acceptMessage(
    consumer: ConsumerRow,
    idempotencyKey: string,
    input: SendMessageInput,
  ): Promise<{ id: string; status: string }> {
    const requestHash = this.crypto.lookup(`req:${canonicalJson(input)}`);
    const replay = await this.findIdempotent(this.pool, consumer.id, idempotencyKey, requestHash);
    if (replay) return replay;

    const device = await findDevice(this.pool, input.device);
    if (!device || device.status === "nonaktif") throw new KirimApiError(422, "device_inactive", "Nomor tidak aktif.");
    if (!(await routeAllows(this.pool, consumer.id, device, input.jenis))) {
      throw new KirimApiError(422, "route_denied", "Pemakai tidak boleh mengirim jenis ini lewat nomor ini.");
    }
    let to: string;
    try {
      to = normalizePhone(input.to);
    } catch (error) {
      if (error instanceof InvalidNumberError) throw new KirimApiError(422, "invalid_number", "Nomor tujuan tidak sah.");
      throw error;
    }
    const canonical = phoneCanonical(to);
    const toHmac = this.crypto.lookup(canonical);
    if (input.jenis !== "kode" && (await this.isOptedOut(this.pool, [toHmac], consumer.id, device.id))) {
      throw new KirimApiError(422, "optout", "Nomor minta tidak dihubungi.");
    }
    const now = await dbNow(this.pool);
    const used = await this.pool.query<{ count: string }>(
      "SELECT count(*) AS count FROM kirim_outbox WHERE consumer_id = $1 AND created_at >= $2",
      [consumer.id, wibDayStart(now)],
    );
    if (Number(used.rows[0]?.count ?? 0) >= consumer.kuotaHarian) {
      throw new KirimApiError(422, "quota_exceeded", "Kuota harian pemakai habis.");
    }
    if (input.media_id) {
      const media = await this.pool.query(
        `SELECT 1 FROM kirim_media WHERE id = $1 AND device_id = $2 AND uploaded_by_consumer_id = $3 AND arah = 'keluar' AND path IS NOT NULL`,
        [input.media_id, device.id, consumer.id],
      );
      if ((media.rowCount ?? 0) === 0) throw new KirimApiError(422, "media_invalid", "Media tidak dikenal untuk nomor ini.");
    }

    const requested = input.kedaluwarsa ? new Date(input.kedaluwarsa) : null;
    const expiresAt = input.jenis === "kode"
      ? new Date(Math.min(now.getTime() + CODE_TTL_MS, requested?.getTime() ?? Number.POSITIVE_INFINITY))
      : requested ?? new Date(now.getTime() + NOTIFICATION_TTL_MS);

    try {
      return await withTransaction(this.pool, async (client) => {
        const conversationId = await ensureConversation(client, this.crypto, { deviceId: device.id, canonical, jenis: "pn" });
        const messageId = randomUUID();
        const outboxId = randomUUID();
        const body = input.text ?? input.caption ?? null;
        await client.query(
          `INSERT INTO kirim_messages (id, conversation_id, device_id, arah, asal, jenis, tipe, body_enc, body_disamarkan, media_id, provider, status, consumer_id)
           VALUES ($1, $2, $3, 'keluar', 'otomatis', $4, $5, $6, $7, $8, $9, 'antre', $10)`,
          [
            messageId,
            conversationId,
            device.id,
            input.jenis,
            input.media_id ? "dokumen" : "teks",
            body ? this.crypto.seal(body, columnAad("kirim_messages", "body_enc", messageId)) : null,
            input.jenis === "kode",
            input.media_id ?? null,
            device.provider,
            consumer.id,
          ],
        );
        await client.query(
          `INSERT INTO kirim_outbox (id, consumer_id, device_id, idempotency_key, request_hash, jenis, prioritas, to_hmac, ref, message_id, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            outboxId,
            consumer.id,
            device.id,
            idempotencyKey,
            requestHash,
            input.jenis,
            input.jenis === "kode" ? "kode" : input.prioritas,
            toHmac,
            input.ref ?? null,
            messageId,
            expiresAt,
          ],
        );
        await client.query("UPDATE kirim_conversations SET pesan_terakhir_at = now() WHERE id = $1", [conversationId]);
        // KIRIM-IMPL-002 §7: the number's owner sees another module's message in its inbox.
        if (device.pemilikConsumerId !== consumer.id) {
          await enqueueWebhook(client, this.crypto, device.pemilikConsumerId, "message.sent", {
            device: device.kode,
            conversation_id: conversationId,
            message_id: messageId,
            asal: "otomatis",
            dikirim_oleh: consumer.nama,
            tipe: input.media_id ? "dokumen" : "teks",
            cuplikan: input.jenis === "kode" || !body ? null : body.slice(0, 200),
            disamarkan: input.jenis === "kode",
            status: "antre",
            waktu: (await dbNow(client)).toISOString(),
          });
        }
        return { id: messageId, status: "antre" };
      });
    } catch (error) {
      // A concurrent request with the same key won the insert: answer as a replay.
      if (isUniqueViolation(error)) {
        const raced = await this.findIdempotent(this.pool, consumer.id, idempotencyKey, requestHash);
        if (raced) return raced;
      }
      throw error;
    }
  }

  async getMessage(consumer: ConsumerRow, id: string) {
    if (!z.guid().safeParse(id).success) throw new KirimApiError(404, "not_found", "Pesan tidak ditemukan.");
    const result = await this.pool.query<{
      id: string;
      ref: string | null;
      status: string;
      errorCode: string | null;
      dryRun: boolean;
      updatedAt: Date;
    }>(
      `SELECT m.id, o.ref, o.status, o.error_code AS "errorCode", m.dry_run AS "dryRun", o.updated_at AS "updatedAt"
       FROM kirim_outbox o JOIN kirim_messages m ON m.id = o.message_id
       WHERE o.message_id = $1 AND o.consumer_id = $2`,
      [id, consumer.id],
    );
    const row = result.rows[0];
    if (!row) throw new KirimApiError(404, "not_found", "Pesan tidak ditemukan.");
    return { id: row.id, ref: row.ref, status: row.status, error_code: row.errorCode, dry_run: row.dryRun, updated_at: row.updatedAt.toISOString() };
  }

  /**
   * D-5 and KIRIM-IMPL-002 §8: `consumer` covers the caller's own messages; `device` covers every
   * automatic message on a number and only its owner may create it. Idempotent.
   */
  async addConsumerOptout(consumer: ConsumerRow, input: OptoutInput): Promise<{ cakupan: "consumer" | "device"; dibuat: boolean }> {
    const nomor = this.optoutNumber(input.nomor);
    const deviceId = input.cakupan === "device" ? await this.ownedDeviceId(consumer, input.device) : null;
    const nomorHmac = this.crypto.lookup(phoneCanonical(nomor));
    return withTransaction(this.pool, async (client) => {
      const inserted = input.cakupan === "device"
        ? await client.query(
            `INSERT INTO kirim_optouts (id, nomor_hmac, cakupan, consumer_id, device_id, alasan, sumber, nomor_tersamar)
             VALUES ($1, $2, 'device', $3, $4, $5, 'consumer', $6)
             ON CONFLICT (nomor_hmac, device_id) WHERE cakupan = 'device' DO NOTHING`,
            [randomUUID(), nomorHmac, consumer.id, deviceId, input.alasan, maskPhone(nomor)],
          )
        : await client.query(
            `INSERT INTO kirim_optouts (id, nomor_hmac, cakupan, consumer_id, alasan, sumber, nomor_tersamar)
             VALUES ($1, $2, 'consumer', $3, $4, 'consumer', $5)
             ON CONFLICT (nomor_hmac, consumer_id) WHERE cakupan = 'consumer' DO NOTHING`,
            [randomUUID(), nomorHmac, consumer.id, input.alasan, maskPhone(nomor)],
          );
      const dibuat = (inserted.rowCount ?? 0) > 0;
      if (dibuat) {
        await writeAudit(client, {
          actorKind: "service",
          actorRef: consumer.clientId,
          aksi: "optout.tambah",
          objekJenis: "optout",
          objekRef: nomorHmac.slice(0, 16),
          metadata: { cakupan: input.cakupan, consumer: consumer.nama, ...(input.cakupan === "device" ? { device: input.device } : {}) },
        });
      }
      return { cakupan: input.cakupan, dibuat };
    });
  }

  /** KIRIM-IMPL-002 §8: a consumer withdraws only an opt-out it created itself. */
  async removeConsumerOptout(consumer: ConsumerRow, input: OptoutInput): Promise<{ dicabut: true }> {
    const nomor = this.optoutNumber(input.nomor);
    const deviceId = input.cakupan === "device" ? await this.ownedDeviceId(consumer, input.device) : null;
    const nomorHmac = this.crypto.lookup(phoneCanonical(nomor));
    return withTransaction(this.pool, async (client) => {
      const removed = await client.query(
        `DELETE FROM kirim_optouts WHERE nomor_hmac = $1 AND cakupan = $2 AND consumer_id = $3 AND sumber = 'consumer'
           AND device_id IS NOT DISTINCT FROM $4`,
        [nomorHmac, input.cakupan, consumer.id, deviceId],
      );
      if ((removed.rowCount ?? 0) === 0) throw new KirimApiError(404, "not_found", "Tidak ada opt-out milik pemakai ini untuk nomor itu.");
      await writeAudit(client, {
        actorKind: "service",
        actorRef: consumer.clientId,
        aksi: "optout.cabut",
        objekJenis: "optout",
        objekRef: nomorHmac.slice(0, 16),
        metadata: { cakupan: input.cakupan, consumer: consumer.nama, alasan_panjang: input.alasan.length },
      });
      return { dicabut: true };
    });
  }

  private optoutNumber(value: string): string {
    try {
      return normalizePhone(value);
    } catch {
      throw new KirimApiError(422, "invalid_number", "Nomor tidak sah.");
    }
  }

  /** The number's owner only (KIRIM-001 §3.3); anyone else gets `403 not_owner`. */
  async ownedDeviceId(consumer: ConsumerRow, kode: string): Promise<string> {
    const device = await findDevice(this.pool, kode);
    if (!device || device.pemilikConsumerId !== consumer.id) throw new KirimApiError(403, "not_owner", "Hanya modul pemilik nomor yang boleh memakai ini.");
    return device.id;
  }

  /**
   * §5.4: one PDF up to 5 MiB, checked by its `%PDF-` magic bytes. Stored encrypted (D-8) under
   * `<KIRIM_MEDIA_ROOT>/<yyyy>/<mm>/<uuid>` with mode 0600. Kirim SQ never fetches external URLs.
   */
  async storeOutboundMedia(
    consumer: ConsumerRow,
    input: { deviceKode: string; mime: string; data: Buffer; truncated: boolean },
  ): Promise<{ media_id: string; sha256: string; ukuran: number }> {
    const device = await findDevice(this.pool, input.deviceKode);
    if (!device || device.status === "nonaktif") throw new KirimApiError(422, "device_inactive", "Nomor tidak aktif.");
    const owns = device.pemilikConsumerId === consumer.id;
    const routed = await this.pool.query("SELECT 1 FROM kirim_routes WHERE consumer_id = $1 AND device_id = $2", [consumer.id, device.id]);
    if (!owns && (routed.rowCount ?? 0) === 0) throw new KirimApiError(422, "route_denied", "Pemakai tidak boleh memakai nomor ini.");
    const signature = MEDIA_SIGNATURES.find((item) => item.mime === input.mime);
    if (
      input.truncated ||
      input.data.length === 0 ||
      input.data.length > MEDIA_MAX_BYTES ||
      !signature ||
      !input.data.subarray(0, signature.magic.length).equals(signature.magic)
    ) {
      throw new KirimApiError(422, "media_invalid", "Hanya PDF, JPEG, atau PNG sampai 5 MiB yang diterima.");
    }
    const id = randomUUID();
    const sha256 = createHash("sha256").update(input.data).digest("hex");
    const path = await this.writeMediaFile(id, input.data, await dbNow(this.pool));
    await this.pool.query(
      `INSERT INTO kirim_media (id, device_id, arah, mime, ukuran, sha256, path, dienkripsi, uploaded_by_consumer_id)
       VALUES ($1, $2, 'keluar', $3, $4, $5, $6, true, $7)`,
      [id, device.id, input.mime, input.data.length, sha256, path, consumer.id],
    );
    return { media_id: id, sha256, ukuran: input.data.length };
  }

  /** Writes an encrypted media file and returns its path relative to the media root. */
  async writeMediaFile(id: string, data: Buffer, now: Date): Promise<string> {
    const relative = join(String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, "0"), id);
    const absolute = join(this.mediaRoot, relative);
    await mkdir(join(absolute, ".."), { recursive: true, mode: 0o700 });
    await writeFile(absolute, this.crypto.sealFile(data, columnAad("kirim_media", "file", id)), { mode: 0o600, flag: "wx" });
    await chmod(absolute, 0o600);
    return relative;
  }

  async readMediaFile(id: string, relativePath: string): Promise<Buffer> {
    return this.crypto.openFile(await readFile(join(this.mediaRoot, relativePath)), columnAad("kirim_media", "file", id));
  }

  /** Free bytes on the media volume, or null when it cannot be measured. */
  async mediaFreeBytes(): Promise<number | null> {
    try {
      await mkdir(this.mediaRoot, { recursive: true, mode: 0o700 });
      const stats = await statfs(this.mediaRoot);
      return Number(stats.bavail) * Number(stats.bsize);
    } catch {
      return null;
    }
  }

  async lowDisk(): Promise<boolean> {
    const free = await this.mediaFreeBytes();
    return free !== null && free < LOW_DISK_BYTES;
  }

  /** Opt-outs that stop a consumer's messages to a number: `semua`, its own, and the number's (§8). */
  async isOptedOut(db: Queryable, nomorHmacs: string[], consumerId: string, deviceId: string): Promise<boolean> {
    const result = await db.query(
      `SELECT 1 FROM kirim_optouts WHERE nomor_hmac = ANY($1::text[])
         AND (cakupan = 'semua' OR (cakupan = 'consumer' AND consumer_id = $2) OR (cakupan = 'device' AND device_id = $3)) LIMIT 1`,
      [nomorHmacs, consumerId, deviceId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async findIdempotent(db: Queryable, consumerId: string, key: string, requestHash: string) {
    const existing = await db.query<{ messageId: string; status: string; requestHash: string }>(
      `SELECT message_id AS "messageId", status, request_hash AS "requestHash" FROM kirim_outbox WHERE consumer_id = $1 AND idempotency_key = $2`,
      [consumerId, key],
    );
    const row = existing.rows[0];
    if (!row) return null;
    if (row.requestHash !== requestHash) {
      throw new KirimApiError(409, "idempotency_key_conflict", "Idempotency-Key sudah dipakai untuk permintaan lain.");
    }
    return { id: row.messageId, status: row.status };
  }
}

/** Stable JSON with sorted keys, so the same body always produces the same request hash. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

const CANARY_VALUE = "kirim-sq-key-canary-v1";

/**
 * §9: on start, every configured data key must open its canary, every stored canary must have
 * its key, and the lookup key must reproduce its stored HMAC. Otherwise the start is refused.
 * There is no fallback to plaintext.
 */
export async function verifyKeyCanaries(pool: Pool, crypto: KirimCrypto): Promise<void> {
  const stored = await pool.query<{ purpose: string; value: string }>("SELECT purpose, value FROM kirim_key_canaries");
  const byPurpose = new Map(stored.rows.map((row) => [row.purpose, row.value]));
  for (const purpose of byPurpose.keys()) {
    if (purpose.startsWith("data:") && !crypto.keyIds.includes(purpose.slice(5))) {
      throw new Error(`Kirim SQ data key ${purpose.slice(5)} is missing from KIRIM_DATA_KEYS; refusing to start`);
    }
  }
  for (const kid of crypto.keyIds) {
    const purpose = `data:${kid}`;
    const aad = columnAad("kirim_key_canaries", "value", purpose);
    const value = byPurpose.get(purpose);
    if (value === undefined) {
      await pool.query("INSERT INTO kirim_key_canaries (purpose, value) VALUES ($1, $2) ON CONFLICT (purpose) DO NOTHING", [
        purpose,
        crypto.seal(CANARY_VALUE, aad, kid),
      ]);
      continue;
    }
    let opened: string;
    try {
      opened = crypto.open(value, aad);
    } catch (error) {
      if (error instanceof KirimCryptoError) throw new Error(`Kirim SQ data key ${kid} cannot open its canary; refusing to start`, { cause: error });
      throw error;
    }
    if (opened !== CANARY_VALUE) throw new Error(`Kirim SQ data key ${kid} canary mismatch; refusing to start`);
  }
  const lookup = crypto.lookup(CANARY_VALUE);
  const storedLookup = byPurpose.get("lookup");
  if (storedLookup === undefined) {
    await pool.query("INSERT INTO kirim_key_canaries (purpose, value) VALUES ('lookup', $1) ON CONFLICT (purpose) DO NOTHING", [lookup]);
  } else if (storedLookup !== lookup) {
    throw new Error("Kirim SQ lookup key does not match its canary; refusing to start");
  }
}
