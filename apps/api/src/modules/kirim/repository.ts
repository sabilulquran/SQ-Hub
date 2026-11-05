import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import { columnAad, type KirimCrypto } from "./crypto.js";
import { KirimApiError } from "./errors.js";
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
  /** KIRIM-IMPL-003 §3: the registry application whose card this is. */
  applicationKey: string | null;
  /** The card's number: used when a send names no `device`. */
  nomorDeviceId: string | null;
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
  webhook_secret_ref AS "webhookSecretRef", kuota_harian AS "kuotaHarian", aktif,
  application_key AS "applicationKey", nomor_device_id AS "nomorDeviceId"
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

export async function findConsumerById(db: Queryable, id: string): Promise<ConsumerRow | null> {
  const result = await db.query<ConsumerRow>(`SELECT ${CONSUMER_COLUMNS} FROM kirim_consumers WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

export interface RegistryApplication {
  applicationKey: string;
  name: string;
  machineClientId: string;
  status: string;
}

/** KIRIM-IMPL-003 K-2: registry applications that get a card, i.e. may use WhatsApp. */
export async function listWhatsAppApplications(db: Queryable): Promise<RegistryApplication[]> {
  const result = await db.query<RegistryApplication>(
    `SELECT application_key AS "applicationKey", name, machine_client_id AS "machineClientId", status
       FROM applications WHERE whatsapp_capable ORDER BY name, application_key`,
  );
  return result.rows;
}

export async function findWhatsAppApplication(db: Queryable, key: { applicationKey: string } | { machineClientId: string }): Promise<RegistryApplication | null> {
  const byKey = "applicationKey" in key;
  const result = await db.query<RegistryApplication>(
    `SELECT application_key AS "applicationKey", name, machine_client_id AS "machineClientId", status
       FROM applications WHERE whatsapp_capable AND ${byKey ? "application_key" : "machine_client_id"} = $1`,
    [byKey ? key.applicationKey : key.machineClientId],
  );
  return result.rows[0] ?? null;
}

/**
 * A short identifier from an application key: `karir-sq` -> `karir`, made unique among existing
 * values with `-2`, `-3`, … Used for new consumer names and new number codes, so nobody types one.
 */
export async function freeIdentifier(db: Queryable, table: "kirim_consumers" | "kirim_devices", applicationKey: string): Promise<string> {
  const column = table === "kirim_consumers" ? "nama" : "kode";
  let base = applicationKey.replace(/-sq$/, "").replace(/[^a-z0-9-]/g, "-");
  if (!/^[a-z]/.test(base)) base = `m${base}`;
  base = base.slice(0, 27).replace(/-+$/, "");
  if (base.length < 2) base = `${base}x`;
  const taken = new Set(
    (await db.query<{ value: string }>(`SELECT ${column} AS value FROM ${table} WHERE ${column} = $1 OR ${column} LIKE $2`, [base, `${base}-%`])).rows.map((row) => row.value),
  );
  if (table === "kirim_devices") {
    // A new number's tenant is its code, so a code must not name a tenant another number already
    // holds (after 2026-11-05 `spmb` runs on tenant `spmb-2`).
    const tenants = await db.query<{ value: string }>("SELECT provider_ref AS value FROM kirim_devices WHERE provider_ref = $1 OR provider_ref LIKE $2", [base, `${base}-%`]);
    for (const row of tenants.rows) taken.add(row.value);
  }
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/**
 * The consumer behind a registry application, created on first use with the application's own
 * machine client (KIRIM-IMPL-003 §6). An R1 consumer with that client id is linked, not duplicated.
 */
export async function ensureApplicationConsumer(db: Queryable, application: RegistryApplication): Promise<ConsumerRow> {
  const linked = await db.query<ConsumerRow>(`SELECT ${CONSUMER_COLUMNS} FROM kirim_consumers WHERE application_key = $1`, [application.applicationKey]);
  if (linked.rows[0]) return linked.rows[0];
  const byClient = await findConsumerByClientId(db, application.machineClientId);
  if (byClient) {
    if (byClient.applicationKey) throw new KirimApiError(409, "client_dipakai_kartu_lain", "Client mesin ini sudah dipakai kartu modul lain.");
    await db.query("UPDATE kirim_consumers SET application_key = $2, updated_at = now() WHERE id = $1", [byClient.id, application.applicationKey]);
    return { ...byClient, applicationKey: application.applicationKey };
  }
  const id = randomUUID();
  await db.query(
    `INSERT INTO kirim_consumers (id, client_id, nama, application_key) VALUES ($1, $2, $3, $4)`,
    [id, application.machineClientId, await freeIdentifier(db, "kirim_consumers", application.applicationKey), application.applicationKey],
  );
  return (await findConsumerById(db, id))!;
}

/**
 * KIRIM-IMPL-003 §11. `d` is a newer number whose linked phone is already the phone of an older
 * number (any status, nonaktif included). Used inside `EXISTS (...)` with the device aliased `d`.
 */
export const HELD_DEVICE_SQL = `SELECT 1 FROM kirim_devices o
  WHERE o.id <> d.id AND d.nomor_hmac IS NOT NULL AND o.nomor_hmac = d.nomor_hmac AND (o.created_at, o.id) < (d.created_at, d.id)`;

export interface SamePhoneDevice {
  kode: string;
  label: string;
  status: DeviceStatus | "nonaktif";
  pemilikConsumerId: string;
  /** This number was linked to the phone first. */
  lebihDulu: boolean;
}

/** Other numbers linked to the same WhatsApp phone as `deviceId`, compared by the lookup HMAC. */
export async function samePhoneDevices(db: Queryable, deviceId: string): Promise<SamePhoneDevice[]> {
  const result = await db.query<SamePhoneDevice>(
    `SELECT o.kode, o.label, o.status, o.pemilik_consumer_id AS "pemilikConsumerId", (o.created_at, o.id) < (d.created_at, d.id) AS "lebihDulu"
       FROM kirim_devices d JOIN kirim_devices o ON o.id <> d.id AND o.nomor_hmac = d.nomor_hmac
      WHERE d.id = $1 AND d.nomor_hmac IS NOT NULL
      ORDER BY o.created_at, o.id`,
    [deviceId],
  );
  return result.rows;
}

/** Every held number (see HELD_DEVICE_SQL) → the oldest number with the same phone. */
export async function heldDevices(db: Queryable): Promise<Map<string, { kode: string; label: string }>> {
  const result = await db.query<{ id: string; kode: string; label: string }>(
    `SELECT DISTINCT ON (d.id) d.id, o.kode, o.label
       FROM kirim_devices d JOIN kirim_devices o ON o.id <> d.id AND o.nomor_hmac = d.nomor_hmac AND (o.created_at, o.id) < (d.created_at, d.id)
      WHERE d.nomor_hmac IS NOT NULL
      ORDER BY d.id, o.created_at, o.id`,
  );
  return new Map(result.rows.map((row) => [row.id, { kode: row.kode, label: row.label }]));
}

/**
 * Fills `nomor_hmac` from `nomor_enc` for numbers linked before the column existed (migration 0015),
 * nonaktif ones included, so a phone that comes back on a new number is still recognised.
 */
export async function backfillDeviceHmac(db: Queryable, crypto: KirimCrypto): Promise<number> {
  const rows = await db.query<{ id: string; enc: string }>("SELECT id, nomor_enc AS enc FROM kirim_devices WHERE nomor_enc IS NOT NULL AND nomor_hmac IS NULL");
  let filled = 0;
  for (const row of rows.rows) {
    let canonical: string;
    try {
      canonical = crypto.open(row.enc, columnAad("kirim_devices", "nomor_enc", row.id));
    } catch {
      continue;
    }
    if (!/^pn:\+\d{8,15}$/.test(canonical)) continue;
    const updated = await db.query("UPDATE kirim_devices SET nomor_hmac = $2 WHERE id = $1 AND nomor_hmac IS NULL", [row.id, crypto.lookup(canonical)]);
    filled += updated.rowCount ?? 0;
  }
  return filled;
}

/** Consumers other than the owner that use a number: by route or as their card's number. */
export async function deviceSharers(db: Queryable, device: Pick<DeviceRow, "id" | "pemilikConsumerId">): Promise<string[]> {
  const result = await db.query<{ nama: string }>(
    `SELECT DISTINCT coalesce(a.name, c.nama) AS nama
       FROM kirim_consumers c LEFT JOIN applications a ON a.application_key = c.application_key OR (c.application_key IS NULL AND a.machine_client_id = c.client_id)
      WHERE c.id <> $2 AND c.aktif
        AND (c.nomor_device_id = $1 OR EXISTS (SELECT 1 FROM kirim_routes r WHERE r.consumer_id = c.id AND r.device_id = $1))
      ORDER BY 1`,
    [device.id, device.pemilikConsumerId],
  );
  return result.rows.map((row) => row.nama);
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

export type WebhookEventType =
  | "message.status"
  | "message.received"
  | "message.sent"
  | "group.message.received"
  | "device.status"
  // KIRIM-IMPL-004 §7
  | "message.edited"
  | "message.deleted"
  | "message.reaction"
  | "call.logged";

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
