import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";

import { maskPhone, type KirimCrypto } from "./crypto.js";
import type { KirimIngest } from "./ingest.js";
import { wibDayStart } from "./policy.js";
import { ProviderOperationError, type KirimProvider, type ProviderName } from "./providers/types.js";
import {
  conversationContact,
  dbNow,
  findConsumerByName,
  findDevice,
  listConsumers,
  listDevices,
  setDeviceStatus,
  transitionOutbox,
  withTransaction,
  writeAudit,
  type DeviceRow,
} from "./repository.js";
import { KirimApiError, type KirimService } from "./service.js";

/** KIRIM-IMPL-001 §6.4 admin operations. The admin never sees message bodies or full numbers in R1. */

const kodeSchema = z.string().trim().regex(/^[a-z][a-z0-9-]{1,30}$/);
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const reasonSchema = z.string().trim().min(1).max(500);
const providerRefSchema = z.string().trim().regex(/^[A-Za-z0-9._-]{1,64}$/);

export const createDeviceSchema = z
  .object({
    kode: kodeSchema,
    label: z.string().trim().min(1).max(100),
    pemilik: kodeSchema,
    provider: z.enum(["log", "jalurpesan"]).default("log"),
    provider_ref: providerRefSchema.nullable().optional(),
  })
  .strict();

export const updateDeviceSchema = z
  .object({
    label: z.string().trim().min(1).max(100).optional(),
    pemilik: kodeSchema.optional(),
    rate_per_menit: z.number().int().min(1).max(60).optional(),
    jam_kirim_mulai: timeSchema.optional(),
    jam_kirim_selesai: timeSchema.optional(),
    provider: z.enum(["log", "jalurpesan"]).optional(),
    provider_ref: providerRefSchema.nullable().optional(),
    alasan: reasonSchema.optional(),
  })
  .strict();

export const pairingSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("qr") }).strict(),
  z.object({ mode: z.literal("kode"), phone: z.string().trim().min(8).max(20) }).strict(),
]);

export const reasonBodySchema = z.object({ alasan: reasonSchema }).strict();
export const optionalReasonBodySchema = z.object({ alasan: reasonSchema.optional() }).strict();

export const queueQuerySchema = z.object({
  device: kodeSchema.optional(),
  status: z.enum(["antre", "diserahkan", "terkirim", "dibaca", "gagal", "dibatalkan"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

const QUEUE_PAGE_SIZE = 50;
/** Errors that a retry cannot fix (§6.4). */
const NOT_RETRYABLE = new Set(["optout", "route_denied", "expired"]);

export interface AdminActor {
  ref: string;
}

export class KirimAdminService {
  constructor(
    private readonly pool: Pool,
    private readonly crypto: KirimCrypto,
    private readonly service: KirimService,
    private readonly providers: Record<ProviderName, KirimProvider | undefined>,
    private readonly ingest?: KirimIngest,
  ) {}

  async isAdmin(identity: { issuer: string; subject: string }): Promise<boolean> {
    const result = await this.pool.query(
      "SELECT 1 FROM kirim_admins WHERE identity_issuer = $1 AND identity_subject = $2 AND revoked_at IS NULL",
      [identity.issuer, identity.subject],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async listDevices() {
    const now = await dbNow(this.pool);
    const devices = await listDevices(this.pool);
    const counts = await this.pool.query<{ deviceId: string; antre: string; gagal: string }>(
      `SELECT device_id AS "deviceId",
              count(*) FILTER (WHERE status = 'antre') AS antre,
              count(*) FILTER (WHERE status = 'gagal' AND updated_at >= $1) AS gagal
       FROM kirim_outbox GROUP BY device_id`,
      [wibDayStart(now)],
    );
    const byDevice = new Map(counts.rows.map((row) => [row.deviceId, row]));
    const habis = await this.pool.query<{ count: string }>("SELECT count(*) AS count FROM kirim_webhook_deliveries WHERE status = 'habis'");
    return {
      devices: devices.map((device) => ({
        ...toBrowserDevice(device),
        antrean: { antre: Number(byDevice.get(device.id)?.antre ?? 0), gagal_hari_ini: Number(byDevice.get(device.id)?.gagal ?? 0) },
      })),
      peringatan: {
        terputus: devices.filter((device) => device.status === "terputus").map((device) => device.kode),
        webhook_habis: Number(habis.rows[0]?.count ?? 0),
      },
    };
  }

  async createDevice(actor: AdminActor, input: z.infer<typeof createDeviceSchema>) {
    if (input.provider === "jalurpesan" && !input.provider_ref) {
      throw new KirimApiError(400, "invalid_request", "provider_ref wajib untuk provider jalurpesan.");
    }
    return withTransaction(this.pool, async (client) => {
      const owner = await findConsumerByName(client, input.pemilik);
      if (!owner) throw new KirimApiError(422, "pemilik_unknown", "Pemakai pemilik tidak dikenal.");
      const exists = await findDevice(client, input.kode);
      if (exists) throw new KirimApiError(409, "device_exists", "Kode nomor sudah dipakai.");
      await client.query(
        `INSERT INTO kirim_devices (id, kode, label, pemilik_consumer_id, provider, provider_ref, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [randomUUID(), input.kode, input.label, owner.id, input.provider, input.provider_ref ?? null, input.provider === "log" ? "tersambung" : "belum_dipasang"],
      );
      await writeAudit(client, {
        actorKind: "human",
        actorRef: actor.ref,
        aksi: "nomor.tambah",
        objekJenis: "device",
        objekRef: input.kode,
        metadata: { provider: input.provider, pemilik: input.pemilik },
      });
      return toBrowserDevice((await findDevice(client, input.kode))!);
    });
  }

  /**
   * Provider changes need a paused queue, a reason, and no real hand-overs still awaiting
   * receipts (KIRIM-001 §10). Moving to another engine always needs pairing again.
   */
  async updateDevice(actor: AdminActor, kode: string, input: z.infer<typeof updateDeviceSchema>) {
    return withTransaction(this.pool, async (client) => {
      const device = await findDevice(client, kode, true);
      if (!device) throw new KirimApiError(404, "not_found", "Nomor tidak ditemukan.");
      const provider = input.provider ?? device.provider;
      const providerRef = input.provider_ref === undefined ? device.providerRef : input.provider_ref;
      const providerChanged = provider !== device.provider || providerRef !== device.providerRef;
      if (providerChanged) {
        if (!input.alasan) throw new KirimApiError(400, "alasan_required", "Alasan wajib untuk mengganti provider.");
        if (provider === "jalurpesan" && !providerRef) throw new KirimApiError(400, "invalid_request", "provider_ref wajib untuk jalurpesan.");
        if (!device.antreanDijeda) throw new KirimApiError(409, "queue_not_paused", "Jeda antrean nomor ini dulu.");
        const waiting = await client.query<{ count: string }>(
          `SELECT count(*) AS count FROM kirim_outbox o JOIN kirim_messages m ON m.id = o.message_id
           WHERE o.device_id = $1 AND o.status = 'diserahkan' AND NOT m.dry_run AND m.provider_at > now() - interval '24 hours'`,
          [device.id],
        );
        if (Number(waiting.rows[0]?.count ?? 0) > 0) {
          throw new KirimApiError(409, "handover_pending", "Masih ada pesan diserahkan yang menunggu status.");
        }
      }
      let ownerId = device.pemilikConsumerId;
      if (input.pemilik && input.pemilik !== device.pemilik) {
        const owner = await findConsumerByName(client, input.pemilik);
        if (!owner) throw new KirimApiError(422, "pemilik_unknown", "Pemakai pemilik tidak dikenal.");
        ownerId = owner.id;
      }
      const mulai = input.jam_kirim_mulai ?? device.jamKirimMulai;
      const selesai = input.jam_kirim_selesai ?? device.jamKirimSelesai;
      if (mulai >= selesai) throw new KirimApiError(400, "invalid_request", "Jam mulai harus sebelum jam selesai.");
      await client.query(
        `UPDATE kirim_devices SET label = $2, pemilik_consumer_id = $3, rate_per_menit = $4, jam_kirim_mulai = $5,
           jam_kirim_selesai = $6, provider = $7, provider_ref = $8, updated_at = now()
         WHERE id = $1`,
        [device.id, input.label ?? device.label, ownerId, input.rate_per_menit ?? device.ratePerMenit, mulai, selesai, provider, providerRef],
      );
      if (providerChanged && device.status !== "nonaktif") {
        await setDeviceStatus(client, this.crypto, device.id, provider === "log" ? "tersambung" : "belum_dipasang");
      }
      const changed = Object.keys(input).filter((key) => key !== "alasan");
      await writeAudit(client, {
        actorKind: "human",
        actorRef: actor.ref,
        aksi: providerChanged ? "nomor.ganti_provider" : "nomor.ubah",
        objekJenis: "device",
        objekRef: kode,
        metadata: {
          kolom: changed,
          ...(providerChanged ? { dari: device.provider, ke: provider } : {}),
          ...(input.alasan ? { alasan: input.alasan } : {}),
        },
      });
      return toBrowserDevice((await findDevice(client, kode))!);
    });
  }

  async provision(actor: AdminActor, kode: string) {
    const device = await this.requireDevice(kode);
    const provider = this.provider(device);
    try {
      await provider.provision(device, device.label);
    } catch (error) {
      await writeAudit(this.pool, { actorKind: "human", actorRef: actor.ref, aksi: "nomor.provision", objekJenis: "device", objekRef: kode, hasil: "gagal", metadata: { code: providerCode(error) } });
      throw providerError(error);
    }
    await writeAudit(this.pool, { actorKind: "human", actorRef: actor.ref, aksi: "nomor.provision", objekJenis: "device", objekRef: kode });
    return this.liveStatus(kode);
  }

  /** The QR data-URL or pairing code is returned once and never stored, logged or audited. */
  async startPairing(actor: AdminActor, kode: string, input: z.infer<typeof pairingSchema>) {
    const device = await this.requireDevice(kode);
    if (device.status === "nonaktif") throw new KirimApiError(422, "device_inactive", "Nomor nonaktif.");
    if (device.provider === "log") throw new KirimApiError(409, "pairing_not_applicable", "Provider log tidak perlu dipasang.");
    const provider = this.provider(device);
    let result;
    try {
      result = await provider.startPairing(device, input.mode === "qr" ? "qr" : { phone: input.phone });
    } catch (error) {
      await writeAudit(this.pool, { actorKind: "human", actorRef: actor.ref, aksi: "nomor.pairing", objekJenis: "device", objekRef: kode, hasil: "gagal", metadata: { mode: input.mode, code: providerCode(error) } });
      throw providerError(error);
    }
    await withTransaction(this.pool, async (client) => {
      if (device.status !== "tersambung") await setDeviceStatus(client, this.crypto, device.id, "menunggu_pairing");
      await writeAudit(client, { actorKind: "human", actorRef: actor.ref, aksi: "nomor.pairing", objekJenis: "device", objekRef: kode, metadata: { mode: input.mode } });
    });
    return result.mode === "qr" ? { mode: "qr", qr: result.qr } : { mode: "kode", pairing_code: result.pairingCode };
  }

  async liveStatus(kode: string) {
    const device = await this.requireDevice(kode);
    if (device.provider === "jalurpesan" && device.status !== "nonaktif") {
      const provider = this.provider(device);
      let qr: string | null;
      try {
        const state = this.ingest ? await this.ingest.refreshStatus(device) : await provider.deviceStatus(device);
        qr = state.qr;
      } catch (error) {
        throw providerError(error);
      }
      const updated = (await findDevice(this.pool, kode))!;
      return { status: updated.status, nomor_tersamar: updated.nomorTersamar, qr };
    }
    return { status: device.status, nomor_tersamar: device.nomorTersamar, qr: null };
  }

  async disconnect(actor: AdminActor, kode: string, alasan: string) {
    const device = await this.requireDevice(kode);
    if (device.provider === "jalurpesan") {
      try {
        await this.provider(device).disconnect(device);
      } catch (error) {
        await writeAudit(this.pool, { actorKind: "human", actorRef: actor.ref, aksi: "nomor.putus", objekJenis: "device", objekRef: kode, hasil: "gagal", metadata: { alasan, code: providerCode(error) } });
        throw providerError(error);
      }
    }
    return withTransaction(this.pool, async (client) => {
      if (device.provider === "jalurpesan") await setDeviceStatus(client, this.crypto, device.id, "terputus");
      await writeAudit(client, { actorKind: "human", actorRef: actor.ref, aksi: "nomor.putus", objekJenis: "device", objekRef: kode, metadata: { alasan } });
      return toBrowserDevice((await findDevice(client, kode))!);
    });
  }

  async setPaused(actor: AdminActor, kode: string, paused: boolean, alasan?: string) {
    return withTransaction(this.pool, async (client) => {
      const device = await findDevice(client, kode, true);
      if (!device) throw new KirimApiError(404, "not_found", "Nomor tidak ditemukan.");
      await client.query("UPDATE kirim_devices SET antrean_dijeda = $2, updated_at = now() WHERE id = $1", [device.id, paused]);
      await writeAudit(client, {
        actorKind: "human",
        actorRef: actor.ref,
        aksi: paused ? "antrean.jeda" : "antrean.lanjut",
        objekJenis: "device",
        objekRef: kode,
        metadata: alasan ? { alasan } : {},
      });
      return toBrowserDevice((await findDevice(client, kode))!);
    });
  }

  /** New requests are refused with `device_inactive`; the existing queue is kept. */
  async deactivate(actor: AdminActor, kode: string, alasan: string) {
    return withTransaction(this.pool, async (client) => {
      const device = await findDevice(client, kode, true);
      if (!device) throw new KirimApiError(404, "not_found", "Nomor tidak ditemukan.");
      await setDeviceStatus(client, this.crypto, device.id, "nonaktif");
      await writeAudit(client, { actorKind: "human", actorRef: actor.ref, aksi: "nomor.nonaktif", objekJenis: "device", objekRef: kode, metadata: { alasan } });
      return toBrowserDevice((await findDevice(client, kode))!);
    });
  }

  async listConsumers() {
    return (await listConsumers(this.pool)).map((consumer) => ({
      nama: consumer.nama,
      client_id: consumer.clientId,
      webhook_url: consumer.webhookUrl,
      kuota_harian: consumer.kuotaHarian,
      aktif: consumer.aktif,
    }));
  }

  async listRoutes() {
    const result = await this.pool.query<{ consumer: string; device: string; jenis: string }>(
      `SELECT c.nama AS consumer, d.kode AS device, r.jenis FROM kirim_routes r
       JOIN kirim_consumers c ON c.id = r.consumer_id JOIN kirim_devices d ON d.id = r.device_id
       ORDER BY d.kode, c.nama, r.jenis`,
    );
    return result.rows;
  }

  /** Queue rows carry only the masked destination; bodies are never read here. */
  async listQueue(query: z.infer<typeof queueQuerySchema>) {
    const result = await this.pool.query<{
      id: string;
      consumer: string;
      ref: string | null;
      jenis: string;
      device: string;
      conversationId: string;
      status: string;
      attempts: number;
      errorCode: string | null;
      createdAt: Date;
      updatedAt: Date;
      dryRun: boolean;
    }>(
      `SELECT m.id, c.nama AS consumer, o.ref, o.jenis, d.kode AS device, m.conversation_id AS "conversationId", o.status,
              o.attempts, o.error_code AS "errorCode", o.created_at AS "createdAt", o.updated_at AS "updatedAt", m.dry_run AS "dryRun"
       FROM kirim_outbox o
       JOIN kirim_messages m ON m.id = o.message_id
       JOIN kirim_consumers c ON c.id = o.consumer_id
       JOIN kirim_devices d ON d.id = o.device_id
       WHERE ($1::text IS NULL OR d.kode = $1) AND ($2::text IS NULL OR o.status = $2)
       ORDER BY o.created_at DESC, o.id
       LIMIT ${QUEUE_PAGE_SIZE + 1} OFFSET $3`,
      [query.device ?? null, query.status ?? null, (query.page - 1) * QUEUE_PAGE_SIZE],
    );
    const rows = result.rows.slice(0, QUEUE_PAGE_SIZE);
    const items = [];
    for (const row of rows) {
      const contact = await conversationContact(this.pool, this.crypto, row.conversationId);
      items.push({
        id: row.id,
        pemakai: row.consumer,
        ref: row.ref,
        jenis: row.jenis,
        nomor: row.device,
        tujuan: contact.startsWith("pn:") ? maskPhone(contact.slice(3)) : "LID",
        status: row.status,
        percobaan: row.attempts,
        error_code: row.errorCode,
        dry_run: row.dryRun,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
      });
    }
    return { items, page: query.page, has_more: result.rows.length > QUEUE_PAGE_SIZE };
  }

  async retry(actor: AdminActor, messageId: string) {
    return withTransaction(this.pool, async (client) => {
      const row = await this.lockOutbox(client, messageId);
      if (row.status !== "gagal" || (row.errorCode && NOT_RETRYABLE.has(row.errorCode))) {
        throw new KirimApiError(409, "not_retryable", "Hanya pesan gagal yang bisa dicoba ulang.");
      }
      await transitionOutbox(client, this.crypto, {
        outboxId: row.id,
        fromStatuses: ["gagal"],
        status: "antre",
        errorCode: null,
        resetAttempts: true,
        nextAttemptAt: "now",
      });
      await writeAudit(client, { actorKind: "human", actorRef: actor.ref, aksi: "antrean.coba_ulang", objekJenis: "pesan", objekRef: messageId, metadata: { error_code: row.errorCode } });
      return { id: messageId, status: "antre" };
    });
  }

  async cancel(actor: AdminActor, messageId: string, alasan: string) {
    return withTransaction(this.pool, async (client) => {
      const row = await this.lockOutbox(client, messageId);
      if (row.status !== "antre") throw new KirimApiError(409, "not_cancellable", "Hanya pesan antre yang bisa dibatalkan.");
      await transitionOutbox(client, this.crypto, { outboxId: row.id, fromStatuses: ["antre"], status: "dibatalkan", errorCode: "cancelled" });
      await writeAudit(client, { actorKind: "human", actorRef: actor.ref, aksi: "antrean.batal", objekJenis: "pesan", objekRef: messageId, metadata: { alasan } });
      return { id: messageId, status: "dibatalkan" };
    });
  }

  async queueSummary() {
    const perDevice = await this.pool.query<{ device: string; status: string; count: string }>(
      `SELECT d.kode AS device, o.status, count(*) AS count FROM kirim_outbox o JOIN kirim_devices d ON d.id = o.device_id
       WHERE o.created_at > now() - interval '24 hours' GROUP BY d.kode, o.status ORDER BY d.kode, o.status`,
    );
    const summary = new Map<string, Record<string, number>>();
    for (const row of perDevice.rows) {
      const counts = summary.get(row.device) ?? { antre: 0, diserahkan: 0, terkirim: 0, dibaca: 0, gagal: 0, dibatalkan: 0 };
      counts[row.status] = Number(row.count);
      summary.set(row.device, counts);
    }
    const habis = await this.pool.query<{ count: string }>("SELECT count(*) AS count FROM kirim_webhook_deliveries WHERE status = 'habis'");
    const sizes = await this.pool.query<{ messages: string; media: string; mediaFiles: string }>(
      `SELECT pg_total_relation_size('kirim_messages')::text AS messages, pg_total_relation_size('kirim_media')::text AS media,
              coalesce((SELECT sum(ukuran) FROM kirim_media WHERE path IS NOT NULL), 0)::text AS "mediaFiles"`,
    );
    const free = await this.service.mediaFreeBytes();
    return {
      per_nomor: [...summary.entries()].map(([device, counts]) => ({ nomor: device, ...counts })),
      webhook_habis: Number(habis.rows[0]?.count ?? 0),
      ukuran: {
        tabel_kirim_messages: Number(sizes.rows[0]?.messages ?? 0),
        tabel_kirim_media: Number(sizes.rows[0]?.media ?? 0),
        folder_media: Number(sizes.rows[0]?.mediaFiles ?? 0),
        disk_bebas: free,
      },
    };
  }

  private async lockOutbox(client: Pick<Pool, "query">, messageId: string) {
    if (!z.string().uuid().safeParse(messageId).success) throw new KirimApiError(404, "not_found", "Pesan tidak ditemukan.");
    const result = await client.query<{ id: string; status: string; errorCode: string | null }>(
      `SELECT id, status, error_code AS "errorCode" FROM kirim_outbox WHERE message_id = $1 FOR UPDATE`,
      [messageId],
    );
    const row = result.rows[0];
    if (!row) throw new KirimApiError(404, "not_found", "Pesan tidak ditemukan.");
    return row;
  }

  private async requireDevice(kode: string): Promise<DeviceRow> {
    const device = kodeSchema.safeParse(kode).success ? await findDevice(this.pool, kode) : null;
    if (!device) throw new KirimApiError(404, "not_found", "Nomor tidak ditemukan.");
    return device;
  }

  private provider(device: DeviceRow): KirimProvider {
    const provider = this.providers[device.provider];
    if (!provider) throw new KirimApiError(503, "engine_unavailable", "Mesin untuk provider ini belum dikonfigurasi.");
    return provider;
  }
}

function providerCode(error: unknown): string {
  return error instanceof ProviderOperationError ? error.code : "error";
}

function providerError(error: unknown): KirimApiError {
  if (error instanceof KirimApiError) return error;
  if (error instanceof ProviderOperationError) {
    switch (error.code) {
      case "engine_capacity":
        return new KirimApiError(409, "engine_capacity", "Kapasitas mesin penuh.");
      case "device_not_found":
        return new KirimApiError(409, "engine_device_missing", "Nomor belum disiapkan di mesin. Jalankan Siapkan dulu.");
      case "session_reset_required":
        return new KirimApiError(409, "session_reset_required", "Sesi WhatsApp perlu diputus lalu dipasang ulang.");
      case "engine_rejected":
        return new KirimApiError(422, "engine_rejected", "Mesin menolak permintaan.");
      default:
        return new KirimApiError(503, "engine_unavailable", "Mesin sedang tidak tersedia.");
    }
  }
  return new KirimApiError(503, "engine_unavailable", "Mesin sedang tidak tersedia.");
}

function toBrowserDevice(device: DeviceRow) {
  return {
    kode: device.kode,
    label: device.label,
    pemilik: device.pemilik,
    provider: device.provider,
    provider_ref: device.providerRef,
    status: device.status,
    nomor_tersamar: device.nomorTersamar,
    antrean_dijeda: device.antreanDijeda,
    rate_per_menit: device.ratePerMenit,
    jam_kirim_mulai: device.jamKirimMulai,
    jam_kirim_selesai: device.jamKirimSelesai,
    status_berubah_at: device.statusBerubahAt.toISOString(),
  };
}
