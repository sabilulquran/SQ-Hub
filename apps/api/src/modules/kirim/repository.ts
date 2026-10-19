import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import { columnAad, type KirimCrypto } from "./crypto.js";
import type { DeviceStatus, KirimErrorCode, ProviderName } from "./providers/types.js";

/** SQL for the kirim_* tables (KIRIM-IMPL-001 §4). Nothing here logs or returns plaintext to callers by accident. */

export type Queryable = Pick<PoolClient, "query">;

export interface ConsumerRow {
  id: string;
  clientId: string;
  nama: string;
  webhookUrl: string | null;
  webhookSecretRef: string | null;
  kuotaHarian: number;
  aktif: boolean;
}

export interface DeviceRow {
  id: string;
  kode: string;
  label: string;
  pemilikConsumerId: string;
  pemilik: string;
  provider: ProviderName;
  providerRef: string | null;
  nomorTersamar: string | null;
  status: DeviceStatus | "nonaktif";
  antreanDijeda: boolean;
  ratePerMenit: number;
  jamKirimMulai: string;
  jamKirimSelesai: string;
  statusBerubahAt: Date;
  updatedAt: Date;
}

const CONSUMER_COLUMNS = `
  id, client_id AS "clientId", nama, webhook_url AS "webhookUrl",
  webhook_secret_ref AS "webhookSecretRef", kuota_harian AS "kuotaHarian", aktif
`;

const DEVICE_COLUMNS = `
  d.id, d.kode, d.label, d.pemilik_consumer_id AS "pemilikConsumerId", c.nama AS pemilik,
  d.provider, d.provider_ref AS "providerRef", d.nomor_tersamar AS "nomorTersamar", d.status,
  d.antrean_dijeda AS "antreanDijeda", d.rate_per_menit AS "ratePerMenit",
  to_char(d.jam_kirim_mulai, 'HH24:MI') AS "jamKirimMulai",
  to_char(d.jam_kirim_selesai, 'HH24:MI') AS "jamKirimSelesai",
  d.status_berubah_at AS "statusBerubahAt", d.updated_at AS "updatedAt"
`;

export async function withTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function dbNow(db: Queryable): Promise<Date> {
  const result = await db.query<{ now: Date }>("SELECT now() AS now");
  return result.rows[0]!.now;
}

export async function findConsumerByClientId(db: Queryable, clientId: string): Promise<ConsumerRow | null> {
  const result = await db.query<ConsumerRow>(`SELECT ${CONSUMER_COLUMNS} FROM kirim_consumers WHERE client_id = $1`, [clientId]);
  return result.rows[0] ?? null;
}

export async function findConsumerByName(db: Queryable, nama: string): Promise<ConsumerRow | null> {
  const result = await db.query<ConsumerRow>(`SELECT ${CONSUMER_COLUMNS} FROM kirim_consumers WHERE nama = $1`, [nama]);
  return result.rows[0] ?? null;
}

export async function listConsumers(db: Queryable): Promise<ConsumerRow[]> {
  const result = await db.query<ConsumerRow>(`SELECT ${CONSUMER_COLUMNS} FROM kirim_consumers ORDER BY nama`);
  return result.rows;
}

export async function findDevice(db: Queryable, kode: string, lock = false): Promise<DeviceRow | null> {
  const result = await db.query<DeviceRow>(
    `SELECT ${DEVICE_COLUMNS} FROM kirim_devices d JOIN kirim_consumers c ON c.id = d.pemilik_consumer_id
     WHERE d.kode = $1 ${lock ? "FOR UPDATE OF d" : ""}`,
    [kode],
  );
  return result.rows[0] ?? null;
}

export async function findDeviceById(db: Queryable, id: string): Promise<DeviceRow | null> {
  const result = await db.query<DeviceRow>(
    `SELECT ${DEVICE_COLUMNS} FROM kirim_devices d JOIN kirim_consumers c ON c.id = d.pemilik_consumer_id WHERE d.id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function listDevices(db: Queryable): Promise<DeviceRow[]> {
  const result = await db.query<DeviceRow>(
    `SELECT ${DEVICE_COLUMNS} FROM kirim_devices d JOIN kirim_consumers c ON c.id = d.pemilik_consumer_id ORDER BY d.kode`,
  );
  return result.rows;
}

export async function routeAllows(db: Queryable, consumerId: string, device: DeviceRow, jenis: "notifikasi" | "kode"): Promise<boolean> {
  if (device.pemilikConsumerId === consumerId && jenis === "notifikasi") return true;
  const result = await db.query(
    "SELECT 1 FROM kirim_routes WHERE consumer_id = $1 AND device_id = $2 AND jenis = $3",
    [consumerId, device.id, jenis],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Consumers that receive `device.status`: the owner and every consumer with a route on the number. */
export async function deviceStatusRecipients(db: Queryable, device: Pick<DeviceRow, "id" | "pemilikConsumerId">): Promise<string[]> {
  const result = await db.query<{ id: string }>(
    `SELECT $2::uuid AS id UNION SELECT consumer_id FROM kirim_routes WHERE device_id = $1`,
    [device.id, device.pemilikConsumerId],
  );
  return result.rows.map((row) => row.id);
}

export interface AuditInput {
  actorKind: "human" | "service" | "system";
  actorRef: string;
  aksi: string;
  objekJenis: string;
  objekRef: string;
  hasil?: "berhasil" | "gagal";
  /** Never message bodies, full numbers, QR data or pairing codes. */
  metadata?: Record<string, unknown>;
  /** KIRIM-IMPL-002 §3: the officer a module named, as `issuer sub`. */
  atasNama?: string | null;
}

export async function writeAudit(db: Queryable, input: AuditInput): Promise<void> {
  await db.query(
    `INSERT INTO kirim_audit (id, actor_kind, actor_ref, aksi, objek_jenis, objek_ref, hasil, metadata, atas_nama)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
    [
      randomUUID(),
      input.actorKind,
      input.actorRef,
      input.aksi,
      input.objekJenis,
      input.objekRef,
      input.hasil ?? "berhasil",
      JSON.stringify(input.metadata ?? {}),
      input.atasNama ?? null,
    ],
  );
}

export type WebhookEventType = "message.status" | "message.received" | "message.sent" | "group.message.received" | "device.status";

/**
 * Queues one signed event for a consumer, in the caller's transaction. Consumers without a
 * webhook URL simply have nothing queued; they can still poll `GET /internal/kirim/messages/:id`.
 */
export async function enqueueWebhook(
  db: Queryable,
  crypto: KirimCrypto,
  consumerId: string,
  type: WebhookEventType,
  data: Record<string, unknown>,
): Promise<string | null> {
  const consumer = await db.query<{ webhookUrl: string | null }>(
    `SELECT webhook_url AS "webhookUrl" FROM kirim_consumers WHERE id = $1`,
    [consumerId],
  );
  if (!consumer.rows[0]?.webhookUrl) return null;
  const id = randomUUID();
  const occurredAt = (await dbNow(db)).toISOString();
  const body = JSON.stringify({ event_id: id, type, occurred_at: occurredAt, data });
  await db.query(
    `INSERT INTO kirim_webhook_deliveries (id, consumer_id, event_type, payload_enc) VALUES ($1, $2, $3, $4)`,
    [id, consumerId, type, crypto.seal(body, columnAad("kirim_webhook_deliveries", "payload_enc", id))],
  );
  return id;
}

export async function enqueueDeviceStatus(
  db: Queryable,
  crypto: KirimCrypto,
  device: Pick<DeviceRow, "id" | "kode" | "pemilikConsumerId">,
  status: string,
): Promise<void> {
  for (const consumerId of await deviceStatusRecipients(db, device)) {
    await enqueueWebhook(db, crypto, consumerId, "device.status", { device: device.kode, status });
  }
}

/**
 * Updates the stored connection status and queues `device.status` only when it changed.
 * A `nonaktif` number keeps its status until an admin changes it.
 */
export async function setDeviceStatus(
  db: Queryable,
  crypto: KirimCrypto,
  deviceId: string,
  status: DeviceStatus | "nonaktif",
  options: { allowFromNonaktif?: boolean } = {},
): Promise<boolean> {
  const updated = await db.query<{ id: string; kode: string; pemilikConsumerId: string }>(
    `UPDATE kirim_devices SET status = $2, status_berubah_at = now(), updated_at = now()
     WHERE id = $1 AND status <> $2 ${options.allowFromNonaktif ? "" : "AND status <> 'nonaktif'"}
     RETURNING id, kode, pemilik_consumer_id AS "pemilikConsumerId"`,
    [deviceId, status],
  );
  const device = updated.rows[0];
  if (!device) return false;
  await enqueueDeviceStatus(db, crypto, device, status);
  return true;
}

/** Finds or creates the conversation for a contact; the stored contact value is encrypted. */
export async function ensureConversation(
  db: Queryable,
  crypto: KirimCrypto,
  input: { deviceId: string; canonical: string; jenis: "pn" | "lid" },
): Promise<string> {
  const kontakHmac = crypto.lookup(input.canonical);
  const existing = await db.query<{ id: string }>(
    "SELECT id FROM kirim_conversations WHERE device_id = $1 AND kontak_hmac = $2",
    [input.deviceId, kontakHmac],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const id = randomUUID();
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO kirim_conversations (id, device_id, kontak_hmac, kontak_enc, kontak_jenis)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (device_id, kontak_hmac) DO NOTHING RETURNING id`,
    [id, input.deviceId, kontakHmac, crypto.seal(input.canonical, columnAad("kirim_conversations", "kontak_enc", id)), input.jenis],
  );
  if (inserted.rows[0]) return inserted.rows[0].id;
  const raced = await db.query<{ id: string }>(
    "SELECT id FROM kirim_conversations WHERE device_id = $1 AND kontak_hmac = $2",
    [input.deviceId, kontakHmac],
  );
  return raced.rows[0]!.id;
}

/** Decrypts a group JID (`…@g.us`). */
export async function groupJid(db: Queryable, crypto: KirimCrypto, groupId: string): Promise<string> {
  const result = await db.query<{ jidEnc: string }>(`SELECT group_jid_enc AS "jidEnc" FROM kirim_groups WHERE id = $1`, [groupId]);
  const row = result.rows[0];
  if (!row) throw new Error("group not found");
  return crypto.open(row.jidEnc, columnAad("kirim_groups", "group_jid_enc", groupId));
}

/** Decrypts a conversation contact; `pn:+62…` or `lid:<jid>`. */
export async function conversationContact(db: Queryable, crypto: KirimCrypto, conversationId: string): Promise<string> {
  const result = await db.query<{ kontakEnc: string }>(
    `SELECT kontak_enc AS "kontakEnc" FROM kirim_conversations WHERE id = $1`,
    [conversationId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("conversation not found");
  return crypto.open(row.kontakEnc, columnAad("kirim_conversations", "kontak_enc", conversationId));
}

export interface OutboxStatusChange {
  outboxId: string;
  messageId: string;
  consumerId: string;
  ref: string | null;
  status: string;
  errorCode: KirimErrorCode | null;
  dryRun: boolean;
  /** KIRIM-IMPL-002 §7: the number's owner also learns the status of every outbound message. */
  ownerConsumerId?: string;
  conversationId?: string | null;
  groupId?: string | null;
}

/**
 * `message.status` for the sending consumer and, when it is another module, for the number's
 * owner; written in the same transaction as the change (§5.2). `ref` belongs to the sender only.
 */
export async function enqueueMessageStatus(db: Queryable, crypto: KirimCrypto, change: OutboxStatusChange): Promise<void> {
  const where = change.groupId ? { group_id: change.groupId } : change.conversationId ? { conversation_id: change.conversationId } : {};
  const data = { id: change.messageId, status: change.status, error_code: change.errorCode, dry_run: change.dryRun, ...where };
  await enqueueWebhook(db, crypto, change.consumerId, "message.status", { ...data, ref: change.ref });
  if (change.ownerConsumerId && change.ownerConsumerId !== change.consumerId) {
    await enqueueWebhook(db, crypto, change.ownerConsumerId, "message.status", { ...data, ref: null });
  }
}

/**
 * Moves an outbox row and its message to a new status, then queues `message.status`.
 * `fromStatuses` guards against concurrent changes; returns null when nothing changed.
 */
export async function transitionOutbox(
  db: Queryable,
  crypto: KirimCrypto,
  input: {
    outboxId: string;
    fromStatuses: string[];
    status: string;
    errorCode?: KirimErrorCode | null;
    incrementAttempts?: boolean;
    resetAttempts?: boolean;
    nextAttemptAt?: Date | "now";
    provider?: { messageId: string; dryRun: boolean; provider: ProviderName };
  },
): Promise<OutboxStatusChange | null> {
  const updated = await db.query<{ id: string; messageId: string; consumerId: string; ref: string | null }>(
    `UPDATE kirim_outbox SET
       status = $2,
       error_code = $3,
       attempts = CASE WHEN $4 THEN 0 WHEN $5 THEN attempts + 1 ELSE attempts END,
       next_attempt_at = CASE WHEN $6::text = 'now' THEN now() WHEN $7::timestamptz IS NOT NULL THEN $7::timestamptz ELSE next_attempt_at END,
       updated_at = now()
     WHERE id = $1 AND status = ANY($8::text[])
     RETURNING id, message_id AS "messageId", consumer_id AS "consumerId", ref`,
    [
      input.outboxId,
      input.status,
      input.errorCode ?? null,
      input.resetAttempts ?? false,
      input.incrementAttempts ?? false,
      input.nextAttemptAt === "now" ? "now" : null,
      input.nextAttemptAt instanceof Date ? input.nextAttemptAt : null,
      input.fromStatuses,
    ],
  );
  const row = updated.rows[0];
  if (!row) return null;
  // A JalurPesan send answers with the WhatsApp id, which is also the read-receipt and import key.
  const message = await db.query<{ dryRun: boolean; conversationId: string | null; groupId: string | null; ownerConsumerId: string }>(
    `UPDATE kirim_messages m SET
       status = $2,
       provider_message_id = COALESCE($3, m.provider_message_id),
       wa_message_id = CASE WHEN $3::text IS NOT NULL AND COALESCE($5, m.provider) = 'jalurpesan' THEN $3 ELSE m.wa_message_id END,
       dry_run = COALESCE($4, m.dry_run),
       provider = COALESCE($5, m.provider),
       provider_at = CASE WHEN $3::text IS NOT NULL THEN now() ELSE m.provider_at END,
       updated_at = now()
     FROM kirim_devices d
     WHERE m.id = $1 AND d.id = m.device_id
     RETURNING m.dry_run AS "dryRun", m.conversation_id AS "conversationId", m.group_id AS "groupId", d.pemilik_consumer_id AS "ownerConsumerId"`,
    [row.messageId, input.status, input.provider?.messageId ?? null, input.provider?.dryRun ?? null, input.provider?.provider ?? null],
  );
  const change: OutboxStatusChange = {
    outboxId: row.id,
    messageId: row.messageId,
    consumerId: row.consumerId,
    ref: row.ref,
    status: input.status,
    errorCode: input.errorCode ?? null,
    dryRun: message.rows[0]?.dryRun ?? false,
    ...(message.rows[0]
      ? { ownerConsumerId: message.rows[0].ownerConsumerId, conversationId: message.rows[0].conversationId, groupId: message.rows[0].groupId }
      : {}),
  };
  await enqueueMessageStatus(db, crypto, change);
  return change;
}
