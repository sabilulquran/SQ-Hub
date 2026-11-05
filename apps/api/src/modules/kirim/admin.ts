import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";

import { createHash } from "node:crypto";

import { InvalidNumberError, maskPhone, normalizePhone, phoneCanonical, type KirimCrypto } from "./crypto.js";
import type { KirimIngest } from "./ingest.js";
import { wibDayStart } from "./policy.js";
import { ProviderOperationError, type KirimProvider, type PairingResult, type ProviderName } from "./providers/types.js";
import {
  conversationContact,
  dbNow,
  deviceSharers,
  findConsumerByName,
  findDevice,
  listConsumers,
  heldDevices,
  listDevices,
  samePhoneDevices,
  setDeviceStatus,
  transitionOutbox,
  withTransaction,
  writeAudit,
  type DeviceRow,
  type Queryable,
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

/** KIRIM-IMPL-003 §11.1 "Sambungkan ulang". */
export const reconnectSchema = z
  .object({
    mode: z.enum(["qr", "kode"]),
    phone: z.string().trim().min(8).max(20).optional(),
    perangkat_baru: z.boolean().default(false),
    alasan: reasonSchema,
  })
  .strict()
  .refine((value) => value.mode === "qr" || Boolean(value.phone), { message: "phone wajib untuk mode kode", path: ["phone"] });

/** KIRIM-IMPL-003 §11.2: Nonaktifkan needs `konfirmasi` while a card or route still uses the number. */
export const deactivateSchema = z.object({ alasan: reasonSchema, konfirmasi: z.boolean().default(false) }).strict();

/** KIRIM-IMPL-003 §11.3: the duplicate number gives its engine session to the older number of the same phone. */
export const mergeDuplicateSchema = z.object({ ke: kodeSchema, alasan: reasonSchema }).strict();
export const optionalReasonBodySchema = z.object({ alasan: reasonSchema.optional() }).strict();

export const queueQuerySchema = z.object({
  device: kodeSchema.optional(),
  status: z.enum(["antre", "diserahkan", "terkirim", "dibaca", "gagal", "dibatalkan"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

/** KIRIM-IMPL-002 §12: Jangan hubungi and Aktivitas. */
export const optoutListQuerySchema = z.object({
  cakupan: z.enum(["semua", "device", "consumer"]).optional(),
  sumber: z.enum(["admin", "consumer"]).optional(),
  nomor: z.string().trim().min(1).max(40).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

export const adminOptoutSchema = z.discriminatedUnion("cakupan", [
  z.object({ nomor: z.string().trim().min(1).max(40), cakupan: z.literal("semua"), alasan: reasonSchema }).strict(),
  z.object({ nomor: z.string().trim().min(1).max(40), cakupan: z.literal("device"), device: kodeSchema, alasan: reasonSchema }).strict(),
]);

export const activityQuerySchema = z.object({
  aksi: z.string().trim().min(1).max(100).optional(),
  device: kodeSchema.optional(),
  pemakai: z.string().trim().min(1).max(255).optional(),
  dari: z.string().date().optional(),
  sampai: z.string().date().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

const QUEUE_PAGE_SIZE = 50;
/** Statuses where "Sambungkan ulang" applies; `belum_dipasang` uses Pasang. */
const RECONNECT_STATUSES = new Set(["terputus", "menunggu_pairing", "tersambung"]);
/** Waits between tries while the engine answers `engine_unavailable`, e.g. while it restarts. */
const ENGINE_RETRY_DELAYS_MS = [1_500, 3_000];
/** Tables whose rows tie a number to its own conversations; a number with any of them is not merged. */
const DEVICE_DATA_TABLES = [
  "kirim_conversations",
  "kirim_messages",
  "kirim_outbox",
  "kirim_media",
  "kirim_media_engine_refs",
  "kirim_groups",
  "kirim_group_additions",
  "kirim_history_imports",
  "kirim_optouts",
  "kirim_profile_photos",
] as const;
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
    private readonly options: { engineRetryDelaysMs?: number[] } = {},
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
    const held = await heldDevices(this.pool);
    return {
      devices: devices.map((device) => ({
        ...toBrowserDevice(device, held.get(device.id)),
        antrean: { antre: Number(byDevice.get(device.id)?.antre ?? 0), gagal_hari_ini: Number(byDevice.get(device.id)?.gagal ?? 0) },
      })),
      peringatan: {
        terputus: devices.filter((device) => device.status === "terputus").map((device) => device.kode),
        nomor_ganda: devices.filter((device) => held.has(device.id)).map((device) => device.kode),
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
      if (ownerId !== device.pemilikConsumerId) {
        // KIRIM-IMPL-003: the card follows the owner. The new owner's card shows this number;
        // the previous owner's card is emptied unless it keeps a route on it.
        await client.query("UPDATE kirim_consumers SET nomor_device_id = $2, updated_at = now() WHERE id = $1 AND nomor_device_id IS NULL", [ownerId, device.id]);
        await client.query(
          `UPDATE kirim_consumers c SET nomor_device_id = NULL, updated_at = now()
            WHERE c.id = $1 AND c.nomor_device_id = $2
              AND NOT EXISTS (SELECT 1 FROM kirim_routes r WHERE r.consumer_id = c.id AND r.device_id = $2)`,
          [device.pemilikConsumerId, device.id],
        );
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

  /**
   * KIRIM-IMPL-003 §11.1 "Sambungkan ulang": a new QR or pairing code for the same Kirim number.
   * Its code, conversations, cards and routes stay; only the engine session is reset (JalurPesan
   * `/device/reset`), or with `perangkat_baru` the number moves to a fresh engine tenant, as ops did
   * by hand on 2026-11-05. The QR or code is returned once and never stored, logged or audited.
   */
  async reconnect(actor: AdminActor, kode: string, input: z.infer<typeof reconnectSchema>) {
    const device = await this.requireDevice(kode);
    if (device.status === "nonaktif") throw new KirimApiError(422, "device_inactive", "Nomor nonaktif. Pakai lagi dari kartu modulnya dulu.");
    if (device.provider === "log") throw new KirimApiError(409, "pairing_not_applicable", "Provider log tidak perlu dipasang.");
    if (!RECONNECT_STATUSES.has(device.status)) throw new KirimApiError(409, "belum_dipasang", "Nomor ini belum pernah dipasang. Pakai Pasang.");
    const provider = this.provider(device);
    const mode = input.mode === "qr" ? ("qr" as const) : { phone: input.phone! };
    let tenantBaru: string | null = null;
    let result: PairingResult;
    try {
      let target: DeviceRow = device;
      if (input.perangkat_baru) {
        tenantBaru = await this.freeTenant(provider, device);
        target = { ...device, providerRef: tenantBaru };
        await this.engine(() => provider.provision(target, device.label));
      } else {
        try {
          await this.engine(() => provider.resetSession(device));
        } catch (error) {
          // The tenant has no engine device any more: prepare it again on the same tenant.
          if (!(error instanceof ProviderOperationError && error.code === "device_not_found")) throw error;
          await this.engine(() => provider.provision(device, device.label));
        }
      }
      result = await this.engine(() => provider.startPairing(target, mode));
    } catch (error) {
      await writeAudit(this.pool, {
        actorKind: "human", actorRef: actor.ref, aksi: "nomor.sambung_ulang", objekJenis: "device", objekRef: kode, hasil: "gagal",
        metadata: { mode: input.mode, perangkat_baru: input.perangkat_baru, alasan: input.alasan, code: providerCode(error) },
      });
      throw providerError(error);
    }
    const nomor = await withTransaction(this.pool, async (client) => {
      const locked = await findDevice(client, kode, true);
      if (!locked || locked.status === "nonaktif") throw new KirimApiError(409, "device_inactive", "Nomor dinonaktifkan bersamaan. Muat ulang halaman.");
      if (tenantBaru) {
        if (locked.providerRef !== device.providerRef || locked.provider !== "jalurpesan") {
          throw new KirimApiError(409, "conflict", "Nomor diubah bersamaan. Muat ulang halaman lalu coba lagi.");
        }
        await client.query("UPDATE kirim_devices SET provider_ref = $2, updated_at = now() WHERE id = $1", [device.id, tenantBaru]);
      }
      await setDeviceStatus(client, this.crypto, device.id, "menunggu_pairing");
      await writeAudit(client, {
        actorKind: "human", actorRef: actor.ref, aksi: "nomor.sambung_ulang", objekJenis: "device", objekRef: kode,
        metadata: {
          mode: input.mode,
          perangkat_baru: input.perangkat_baru,
          alasan: input.alasan,
          status_sebelumnya: device.status,
          ...(tenantBaru ? { tenant_lama: device.providerRef, tenant_baru: tenantBaru } : {}),
        },
      });
      return toBrowserDevice((await findDevice(client, kode))!);
    });
    return result.mode === "qr" ? { nomor, mode: "qr", qr: result.qr } : { nomor, mode: "kode", pairing_code: result.pairingCode };
  }

  /** `<kode>-2`, `-3`, …: a tenant no Kirim number names and the engine does not know yet. */
  private async freeTenant(provider: KirimProvider, device: DeviceRow): Promise<string> {
    const taken = new Set(
      (await this.pool.query<{ value: string }>("SELECT provider_ref AS value FROM kirim_devices WHERE provider_ref IS NOT NULL UNION SELECT kode FROM kirim_devices")).rows.map((row) => row.value),
    );
    for (let n = 2; n < 50; n += 1) {
      const candidate = `${device.kode}-${n}`;
      if (taken.has(candidate)) continue;
      const state = await this.engine(() => provider.deviceStatus({ ...device, providerRef: candidate }));
      if (state.status === "belum_dipasang" && !state.engineDeviceId) return candidate;
    }
    throw new KirimApiError(409, "tenant_habis", "Tidak ada perangkat mesin yang bebas untuk nomor ini. Hubungi operator.");
  }

  /** One engine call, tried again while the engine is restarting (`engine_unavailable`). */
  private async engine<T>(work: () => Promise<T>): Promise<T> {
    const delays = this.options.engineRetryDelaysMs ?? ENGINE_RETRY_DELAYS_MS;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await work();
      } catch (error) {
        const delay = delays[attempt];
        if (!(error instanceof ProviderOperationError && error.code === "engine_unavailable") || delay === undefined) throw error;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
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
      return { status: updated.status, nomor_tersamar: updated.nomorTersamar, qr, nomor_sama: await this.samePhone(updated) };
    }
    return { status: device.status, nomor_tersamar: device.nomorTersamar, qr: null, nomor_sama: await this.samePhone(device) };
  }

  /** KIRIM-IMPL-003 §11.3: other Kirim numbers linked to this WhatsApp phone, never the phone itself. */
  private async samePhone(device: DeviceRow) {
    return (await samePhoneDevices(this.pool, device.id)).map((other) => ({
      kode: other.kode, label: other.label, status: other.status, lebih_dulu: other.lebihDulu,
    }));
  }

  /** KIRIM-IMPL-003 §11.2: cards and routes that still use a number, shown before Nonaktifkan. */
  async usage(kode: string) {
    return this.deviceUsage(this.pool, await this.requireDevice(kode));
  }

  private async deviceUsage(db: Queryable, device: Pick<DeviceRow, "id">) {
    const appName = "LEFT JOIN applications a ON a.application_key = c.application_key OR (c.application_key IS NULL AND a.machine_client_id = c.client_id)";
    const cards = await db.query<{ nama: string }>(
      `SELECT DISTINCT coalesce(a.name, c.nama) AS nama FROM kirim_consumers c ${appName} WHERE c.nomor_device_id = $1 ORDER BY 1`,
      [device.id],
    );
    const routes = await db.query<{ nama: string; jenis: string }>(
      `SELECT DISTINCT coalesce(a.name, c.nama) AS nama, r.jenis FROM kirim_routes r JOIN kirim_consumers c ON c.id = r.consumer_id ${appName}
        WHERE r.device_id = $1 ORDER BY 1, 2`,
      [device.id],
    );
    return { kartu: cards.rows.map((row) => row.nama), rute: routes.rows.map((row) => ({ modul: row.nama, jenis: row.jenis })) };
  }

  /**
   * KIRIM-IMPL-003 §11.3 "Pakai nomor yang ada": `kode` is a newer number whose phone is already the
   * phone of the older number `ke`. The older number takes over the newer one's engine session,
   * cards and routes, and the newer row is removed, as ops did by hand on 2026-11-05. Refused once
   * the newer number holds conversations or a queue of its own; those need an operator.
   */
  async useExistingNumber(actor: AdminActor, kode: string, input: z.infer<typeof mergeDuplicateSchema>) {
    if (!kodeSchema.safeParse(kode).success || kode === input.ke) throw new KirimApiError(404, "not_found", "Nomor tidak ditemukan.");
    return withTransaction(this.pool, async (client) => {
      await client.query("SELECT id FROM kirim_devices WHERE kode = ANY($1::text[]) ORDER BY id FOR UPDATE", [[kode, input.ke]]);
      const source = await findDevice(client, kode);
      const target = await findDevice(client, input.ke);
      if (!source || !target) throw new KirimApiError(404, "not_found", "Nomor tidak ditemukan.");
      const match = (await samePhoneDevices(client, source.id)).find((other) => other.kode === target.kode);
      if (!match) throw new KirimApiError(409, "nomor_tidak_sama", "Kedua nomor tidak tertaut ke WhatsApp yang sama.");
      if (!match.lebihDulu) throw new KirimApiError(409, "nomor_lebih_baru", "Pilih nomor yang lebih dulu ada sebagai tujuan.");
      if (source.provider !== "jalurpesan" || target.provider !== "jalurpesan" || !source.providerRef) {
        throw new KirimApiError(409, "pairing_not_applicable", "Hanya nomor JalurPesan yang bisa digabung.");
      }
      if (source.pemilikConsumerId !== target.pemilikConsumerId) {
        throw new KirimApiError(409, "pemilik_berbeda", `${target.label} milik modul lain. Putuskan nomor baru ini, lalu pakai "Pakai nomor yang sudah aktif" di kartu modulnya.`);
      }
      const counts = await client.query<{ n: string }>(
        `SELECT (${DEVICE_DATA_TABLES.map((table) => `(SELECT count(*) FROM ${table} WHERE device_id = $1)`).join(" + ")})::text AS n`,
        [source.id],
      );
      if (Number(counts.rows[0]?.n ?? 0) > 0) {
        throw new KirimApiError(409, "nomor_sudah_berisi", `${source.label} sudah menyimpan percakapan atau antrean sendiri, jadi tidak bisa digabung dari layar. Hubungi operator.`);
      }
      // Engine event cursors are global, so the older number keeps pulling from its own cursor.
      await client.query("UPDATE kirim_events SET device_id = $2 WHERE device_id = $1", [source.id, target.id]);
      await client.query("UPDATE kirim_consumers SET nomor_device_id = $2, updated_at = now() WHERE nomor_device_id = $1", [source.id, target.id]);
      await client.query(
        "INSERT INTO kirim_routes (consumer_id, device_id, jenis) SELECT consumer_id, $2, jenis FROM kirim_routes WHERE device_id = $1 ON CONFLICT DO NOTHING",
        [source.id, target.id],
      );
      await client.query("DELETE FROM kirim_routes WHERE device_id = $1", [source.id]);
      await client.query("DELETE FROM kirim_devices WHERE id = $1", [source.id]);
      await client.query("UPDATE kirim_devices SET provider_ref = $2, updated_at = now() WHERE id = $1", [target.id, source.providerRef]);
      if (target.status !== source.status) {
        await setDeviceStatus(client, this.crypto, target.id, source.status === "nonaktif" ? "terputus" : source.status, { allowFromNonaktif: true });
      }
      await writeAudit(client, {
        actorKind: "human", actorRef: actor.ref, aksi: "nomor.gabung_duplikat", objekJenis: "device", objekRef: target.kode,
        metadata: { dari: source.kode, tenant_lama: target.providerRef, tenant_baru: source.providerRef, alasan: input.alasan },
      });
      await writeAudit(client, {
        actorKind: "human", actorRef: actor.ref, aksi: "nomor.hapus_duplikat", objekJenis: "device", objekRef: source.kode,
        metadata: { digabung_ke: target.kode, alasan: input.alasan },
      });
      return toBrowserDevice((await findDevice(client, target.kode))!);
    });
  }

  /**
   * KIRIM-IMPL-003 K-3: the owner cannot cut a number other modules still send through.
   * Pausing the queue stays available for emergencies.
   */
  async assertNotShared(device: DeviceRow, db: Queryable = this.pool) {
    const sharers = await deviceSharers(db, device);
    if (sharers.length > 0) {
      throw new KirimApiError(409, "nomor_dipakai_modul_lain", `Nomor ini masih dipakai ${sharers.join(", ")}. Putuskan modul itu dulu dari kartunya, atau pindahkan pemilik nomor lewat Ubah.`);
    }
  }

  async disconnect(actor: AdminActor, kode: string, alasan: string) {
    const device = await this.requireDevice(kode);
    // Checked again inside the status transaction below, under the device row lock.
    await this.assertNotShared(device);
    if (device.provider === "jalurpesan") {
      try {
        await this.provider(device).disconnect(device);
      } catch (error) {
        await writeAudit(this.pool, { actorKind: "human", actorRef: actor.ref, aksi: "nomor.putus", objekJenis: "device", objekRef: kode, hasil: "gagal", metadata: { alasan, code: providerCode(error) } });
        throw providerError(error);
      }
    }
    return withTransaction(this.pool, async (client) => {
      await this.assertNotShared((await findDevice(client, kode, true))!, client);
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

  /**
   * New requests are refused with `device_inactive`; the existing queue is kept. While a card or a
   * route still uses the number, `konfirmasi` is required (KIRIM-IMPL-003 §11.2): on 2026-11-05 a
   * Nonaktifkan meant as "pair again" emptied the SPMB card and a second number followed.
   */
  async deactivate(actor: AdminActor, kode: string, input: z.infer<typeof deactivateSchema>) {
    const alasan = input.alasan;
    return withTransaction(this.pool, async (client) => {
      const device = await findDevice(client, kode, true);
      if (!device) throw new KirimApiError(404, "not_found", "Nomor tidak ditemukan.");
      await this.assertNotShared(device, client);
      const dipakai = await this.deviceUsage(client, device);
      const users = [...new Set([...dipakai.kartu, ...dipakai.rute.map((route) => route.modul)])];
      if (users.length > 0 && !input.konfirmasi) {
        throw new KirimApiError(
          409,
          "konfirmasi_diperlukan",
          `Nomor ini masih dipakai ${users.join(", ")}. Menonaktifkan mengosongkan kartunya dan pengiriman berhenti. Bila WhatsApp-nya hanya terlepas, pakai Sambungkan ulang.`,
          { dipakai },
        );
      }
      await setDeviceStatus(client, this.crypto, device.id, "nonaktif");
      // KIRIM-IMPL-003: the owner's card is emptied, so "+ Tambah WhatsApp" is offered again.
      await client.query("UPDATE kirim_consumers SET nomor_device_id = NULL, updated_at = now() WHERE nomor_device_id = $1", [device.id]);
      await writeAudit(client, {
        actorKind: "human", actorRef: actor.ref, aksi: "nomor.nonaktif", objekJenis: "device", objekRef: kode,
        metadata: { alasan, ...(users.length > 0 ? { dipakai: users } : {}) },
      });
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

  // ------------------------------------------------------------------ Jangan hubungi (R2)

  async listOptouts(query: z.infer<typeof optoutListQuerySchema>) {
    const params: unknown[] = [];
    const where: string[] = [];
    if (query.cakupan) {
      params.push(query.cakupan);
      where.push(`o.cakupan = $${params.length}`);
    }
    if (query.sumber) {
      params.push(query.sumber);
      where.push(`o.sumber = $${params.length}`);
    }
    if (query.nomor) {
      params.push(this.crypto.lookup(phoneCanonical(adminNumber(query.nomor))));
      where.push(`o.nomor_hmac = $${params.length}`);
    }
    params.push(QUEUE_PAGE_SIZE, (query.page - 1) * QUEUE_PAGE_SIZE);
    const rows = await this.pool.query<{ id: string; nomorTersamar: string | null; cakupan: string; device: string | null; consumer: string | null; alasan: string; sumber: string; createdAt: Date }>(
      `SELECT o.id, o.nomor_tersamar AS "nomorTersamar", o.cakupan, d.kode AS device, c.nama AS consumer, o.alasan, o.sumber, o.created_at AS "createdAt"
       FROM kirim_optouts o LEFT JOIN kirim_devices d ON d.id = o.device_id LEFT JOIN kirim_consumers c ON c.id = o.consumer_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY o.created_at DESC, o.id LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return {
      page: query.page,
      optouts: rows.rows.map((row) => ({
        id: row.id,
        nomor_tersamar: row.nomorTersamar,
        cakupan: row.cakupan,
        nomor: row.cakupan === "device" ? row.device : null,
        modul: row.cakupan === "consumer" || (row.cakupan === "device" && row.sumber === "consumer") ? row.consumer : null,
        alasan: row.alasan,
        sumber: row.sumber,
        dibuat: row.createdAt.toISOString(),
        bisa_dihapus: row.sumber === "admin",
      })),
    };
  }

  async addOptout(actor: AdminActor, input: z.infer<typeof adminOptoutSchema>) {
    const nomor = adminNumber(input.nomor);
    const nomorHmac = this.crypto.lookup(phoneCanonical(nomor));
    const deviceId = input.cakupan === "device" ? (await this.requireDevice(input.device)).id : null;
    return withTransaction(this.pool, async (client) => {
      const inserted = input.cakupan === "semua"
        ? await client.query(
            `INSERT INTO kirim_optouts (id, nomor_hmac, cakupan, alasan, sumber, nomor_tersamar) VALUES ($1, $2, 'semua', $3, 'admin', $4)
             ON CONFLICT (nomor_hmac) WHERE cakupan = 'semua' DO NOTHING`,
            [randomUUID(), nomorHmac, input.alasan, maskPhone(nomor)],
          )
        : await client.query(
            `INSERT INTO kirim_optouts (id, nomor_hmac, cakupan, device_id, alasan, sumber, nomor_tersamar) VALUES ($1, $2, 'device', $3, $4, 'admin', $5)
             ON CONFLICT (nomor_hmac, device_id) WHERE cakupan = 'device' DO NOTHING`,
            [randomUUID(), nomorHmac, deviceId, input.alasan, maskPhone(nomor)],
          );
      const dibuat = (inserted.rowCount ?? 0) > 0;
      if (dibuat) {
        await writeAudit(client, {
          actorKind: "human",
          actorRef: actor.ref,
          aksi: "optout.tambah",
          objekJenis: "optout",
          objekRef: nomorHmac.slice(0, 16),
          metadata: { cakupan: input.cakupan, ...(input.cakupan === "device" ? { device: input.device } : {}), sumber: "admin" },
        });
      }
      return { dibuat };
    });
  }

  /** Only opt-outs an admin created can be removed here; a module withdraws its own (§8). */
  async removeOptout(actor: AdminActor, id: string, alasan: string) {
    if (!z.guid().safeParse(id).success) throw new KirimApiError(404, "not_found", "Opt-out tidak ditemukan.");
    return withTransaction(this.pool, async (client) => {
      const removed = await client.query<{ nomorHmac: string; cakupan: string }>(
        `DELETE FROM kirim_optouts WHERE id = $1 AND sumber = 'admin' RETURNING nomor_hmac AS "nomorHmac", cakupan`,
        [id],
      );
      const row = removed.rows[0];
      if (!row) throw new KirimApiError(404, "not_found", "Opt-out tidak ditemukan atau dibuat oleh modul.");
      await writeAudit(client, {
        actorKind: "human",
        actorRef: actor.ref,
        aksi: "optout.cabut",
        objekJenis: "optout",
        objekRef: row.nomorHmac.slice(0, 16),
        metadata: { cakupan: row.cakupan, alasan_panjang: alasan.length },
      });
      return { dicabut: true };
    });
  }

  // ------------------------------------------------------------------------ Aktivitas (R2)

  /** Audit rows without message bodies or full numbers; officers appear as a short pseudonym. */
  async listActivity(query: z.infer<typeof activityQuerySchema>) {
    const params: unknown[] = [];
    const where: string[] = [];
    /** Each `?` in `sql` is the same new parameter. */
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replaceAll("?", `$${params.length}`));
    };
    if (query.aksi) add("a.aksi = ?", query.aksi);
    if (query.device) add("(a.metadata->>'device' = ? OR (a.objek_jenis = 'device' AND a.objek_ref = ?))", query.device);
    if (query.pemakai) add("a.actor_ref = ?", query.pemakai);
    if (query.dari) add("a.occurred_at >= (?::date - interval '7 hours')", query.dari);
    if (query.sampai) add("a.occurred_at < (?::date + interval '1 day' - interval '7 hours')", query.sampai);
    params.push(QUEUE_PAGE_SIZE, (query.page - 1) * QUEUE_PAGE_SIZE);
    const rows = await this.pool.query<{ id: string; actorKind: string; actorRef: string; atasNama: string | null; aksi: string; objekJenis: string; objekRef: string; hasil: string; metadata: Record<string, unknown>; occurredAt: Date }>(
      `SELECT a.id, a.actor_kind AS "actorKind", a.actor_ref AS "actorRef", a.atas_nama AS "atasNama", a.aksi, a.objek_jenis AS "objekJenis",
              a.objek_ref AS "objekRef", a.hasil, a.metadata, a.occurred_at AS "occurredAt"
       FROM kirim_audit a ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY a.occurred_at DESC, a.id LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return {
      page: query.page,
      aktivitas: rows.rows.map((row) => ({
        id: row.id,
        aktor: { jenis: row.actorKind, ref: row.actorRef },
        petugas: row.atasNama ? `petugas:${createHash("sha256").update(row.atasNama).digest("hex").slice(0, 10)}` : null,
        aksi: row.aksi,
        objek: { jenis: row.objekJenis, ref: row.objekRef },
        hasil: row.hasil,
        metadata: row.metadata,
        waktu: row.occurredAt.toISOString(),
      })),
    };
  }

  /** Daily totals per module and number for the last 7 WIB days, plus LID/number duplicates (§9). */
  async activitySummary() {
    const messages = await this.pool.query<{ hari: string; device: string; modul: string | null; otomatis: string; petugas: string; hp: string; masuk: string }>(
      `SELECT to_char(m.created_at + interval '7 hours', 'YYYY-MM-DD') AS hari, d.kode AS device, c.nama AS modul,
              count(*) FILTER (WHERE m.arah = 'keluar' AND m.asal = 'otomatis') AS otomatis,
              count(*) FILTER (WHERE m.arah = 'keluar' AND m.asal = 'petugas') AS petugas,
              count(*) FILTER (WHERE m.arah = 'keluar' AND m.asal = 'hp') AS hp,
              count(*) FILTER (WHERE m.arah = 'masuk') AS masuk
       FROM kirim_messages m JOIN kirim_devices d ON d.id = m.device_id LEFT JOIN kirim_consumers c ON c.id = m.consumer_id
       WHERE m.created_at > now() - interval '7 days' AND NOT m.diimpor
       GROUP BY 1, 2, 3 ORDER BY 1 DESC, 2, 3`,
    );
    const failures = await this.pool.query<{ hari: string; device: string; modul: string; gagal: string }>(
      `SELECT to_char(o.updated_at + interval '7 hours', 'YYYY-MM-DD') AS hari, d.kode AS device, c.nama AS modul, count(*) AS gagal
       FROM kirim_outbox o JOIN kirim_devices d ON d.id = o.device_id JOIN kirim_consumers c ON c.id = o.consumer_id
       WHERE o.status = 'gagal' AND o.updated_at > now() - interval '7 days' GROUP BY 1, 2, 3`,
    );
    const reads = await this.pool.query<{ hari: string; aksi: string; count: string }>(
      `SELECT to_char(occurred_at + interval '7 hours', 'YYYY-MM-DD') AS hari, aksi, count(*) AS count FROM kirim_audit
       WHERE aksi IN ('percakapan.baca', 'percakapan.buka', 'media.unduh') AND occurred_at > now() - interval '7 days' GROUP BY 1, 2`,
    );
    const duplicates = await this.pool.query<{ device: string; count: string }>(
      // Either half may be the one that knows the other: a LID row remembering the number, or the number's row
      // remembering the LID (revisi 2026-10-30). Counting only the first shape hid the pairs this creates.
      `SELECT d.kode AS device, count(DISTINCT lid.id) AS count FROM kirim_conversations lid
       JOIN kirim_conversations pn ON pn.device_id = lid.device_id AND pn.id <> lid.id AND pn.kontak_jenis = 'pn'
         AND (pn.kontak_hmac = lid.kontak_alt_hmac OR pn.kontak_alt_hmac = lid.kontak_hmac)
       JOIN kirim_devices d ON d.id = lid.device_id
       WHERE lid.kontak_jenis = 'lid' GROUP BY d.kode`,
    );
    const failureKey = (row: { hari: string; device: string; modul: string | null }) => `${row.hari}|${row.device}|${row.modul ?? ""}`;
    const failed = new Map(failures.rows.map((row) => [failureKey(row), Number(row.gagal)]));
    return {
      harian: messages.rows.map((row) => ({
        hari: row.hari,
        nomor: row.device,
        modul: row.modul,
        otomatis: Number(row.otomatis),
        petugas: Number(row.petugas),
        dari_hp: Number(row.hp),
        masuk: Number(row.masuk),
        gagal: failed.get(failureKey(row)) ?? 0,
      })),
      akses_isi: reads.rows.map((row) => ({ hari: row.hari, aksi: row.aksi, jumlah: Number(row.count) })),
      percakapan_ganda: duplicates.rows.map((row) => ({ nomor: row.device, jumlah: Number(row.count) })),
    };
  }

  private async lockOutbox(client: Pick<Pool, "query">, messageId: string) {
    if (!z.guid().safeParse(messageId).success) throw new KirimApiError(404, "not_found", "Pesan tidak ditemukan.");
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

function adminNumber(value: string): string {
  try {
    return normalizePhone(value);
  } catch (error) {
    if (error instanceof InvalidNumberError) throw new KirimApiError(422, "invalid_number", "Nomor tidak sah.");
    throw error;
  }
}

const ENGINE_UNAVAILABLE = "Mesin WhatsApp sedang tidak tersedia, mungkin sedang dinyalakan ulang. Tunggu sekitar satu menit lalu coba lagi.";

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
        return new KirimApiError(409, "session_reset_required", "Sesi WhatsApp di mesin perlu diulang. Pakai Sambungkan ulang.");
      case "engine_rejected":
        return new KirimApiError(422, "engine_rejected", "Mesin menolak permintaan.");
      default:
        return new KirimApiError(503, "engine_unavailable", ENGINE_UNAVAILABLE);
    }
  }
  return new KirimApiError(503, "engine_unavailable", ENGINE_UNAVAILABLE);
}

/** `ganda`: the older number this one duplicates (KIRIM-IMPL-003 §11.3); its inbox is held until merged. */
export function toBrowserDevice(device: DeviceRow, ganda?: { kode: string; label: string }) {
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
    nomor_ganda: ganda ?? null,
  };
}
