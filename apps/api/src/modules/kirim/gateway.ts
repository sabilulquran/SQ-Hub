import { randomBytes, randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { z } from "zod";

import { toBrowserDevice, type AdminActor } from "./admin.js";
import { columnAad, type KirimCrypto } from "./crypto.js";
import { KirimApiError } from "./errors.js";
import { wibDayStart } from "./policy.js";
import type { KirimProvider, ProviderName } from "./providers/types.js";
import {
  dbNow,
  findDevice,
  findDeviceById,
  freeIdentifier,
  heldDevices,
  withTransaction,
  writeAudit,
  type ConsumerRow,
  type DeviceRow,
  type Queryable,
} from "./repository.js";
import { isAllowedWebhookUrl } from "./webhooks.js";

/**
 * ADR-0011 amendment 2026-11-17: the WhatsApp API gateway for portals and applications outside
 * SQ Suite. One generic card ("Aplikasi luar") owns their numbers; each application holds an API key
 * issued here, bound to one of those numbers. The card never names an application on its face.
 */

export const GATEWAY_CONSUMER_NAME = "aplikasi-luar";
export const API_KEY_PREFIX = "krm_";
/** DRAFT (owner may rename): what the card says. No application name, no "SQ" abbreviation. */
export const GATEWAY_CARD_NAME = "Aplikasi luar";
export const GATEWAY_CARD_DESCRIPTION = "Portal atau aplikasi di luar Sabilul Qur'an Suite yang memakai API";

const kodeSchema = z.string().trim().regex(/^[a-z][a-z0-9-]{1,30}$/);
export const createKeySchema = z.object({
  nama_aplikasi: z.string().trim().min(1).max(60),
  device: kodeSchema,
}).strict();
export const revokeKeySchema = z.object({ alasan: z.string().trim().min(1).max(500) }).strict();
export const gatewayWebhookSchema = z.object({ url: z.string().trim().min(1).max(2048) }).strict();

/** What a request authenticated with an API key acts as: the gateway consumer on the key's number. */
export interface ApiKeyPrincipal {
  id: string;
  namaAplikasi: string;
  awalan: string;
  device: DeviceRow;
}

export type GatewayConsumer = ConsumerRow & { apiKey: ApiKeyPrincipal };

export interface ApiKeyRow {
  id: string;
  deviceId: string;
  namaAplikasi: string;
  awalan: string;
  dibuatOleh: string;
  dibuatAt: Date;
  terakhirDipakaiAt: Date | null;
  dicabutAt: Date | null;
  dicabutOleh: string | null;
}

const keyColumns = (alias: string) => `
  ${alias}.id, ${alias}.device_id AS "deviceId", ${alias}.nama_aplikasi AS "namaAplikasi", ${alias}.awalan, ${alias}.dibuat_oleh AS "dibuatOleh",
  ${alias}.dibuat_at AS "dibuatAt", ${alias}.terakhir_dipakai_at AS "terakhirDipakaiAt", ${alias}.dicabut_at AS "dicabutAt", ${alias}.dicabut_oleh AS "dicabutOleh"
`;

/**
 * An outside application's webhook may be any https address or a loopback port on the same host
 * (DRAFT: wider than D-4, which binds modules to *.sabilulquran.or.id). Never credentials in the URL.
 */
export function isGatewayWebhookUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) return false;
  if (url.protocol === "http:") return url.hostname === "127.0.0.1" && url.port !== "";
  return url.protocol === "https:" && url.hostname.length > 0 && !/^(\d{1,3}\.){3}\d{1,3}$/.test(url.hostname);
}

export class KirimGateway {
  constructor(
    private readonly pool: Pool,
    private readonly crypto: KirimCrypto,
    private readonly providers: Record<ProviderName, KirimProvider | undefined>,
  ) {}

  /** The gateway consumer row (migration 0023), or null in a database that lacks it. */
  async consumerOrNull(db: Queryable = this.pool): Promise<ConsumerRow | null> {
    const result = await db.query<ConsumerRow>(
      `SELECT id, client_id AS "clientId", nama, webhook_url AS "webhookUrl", webhook_secret_ref AS "webhookSecretRef",
              kuota_harian AS "kuotaHarian", aktif, application_key AS "applicationKey", nomor_device_id AS "nomorDeviceId", gerbang
         FROM kirim_consumers WHERE gerbang AND nama = $1`,
      [GATEWAY_CONSUMER_NAME],
    );
    return result.rows[0] ?? null;
  }

  async consumer(db: Queryable = this.pool): Promise<ConsumerRow> {
    const row = await this.consumerOrNull(db);
    if (!row) throw new KirimApiError(503, "gerbang_belum_siap", "Kartu Aplikasi luar belum tersedia di basis data ini.");
    return row;
  }

  /** The card on the Kirim home screen: its numbers and how many active keys, never an application name. */
  async card() {
    const consumer = await this.consumerOrNull();
    if (!consumer) return { nama: GATEWAY_CARD_NAME, keterangan: GATEWAY_CARD_DESCRIPTION, nomor: [], kunci_aktif: 0 };
    const numbers = await this.numbers(consumer);
    const keys = await this.pool.query<{ count: string }>(
      "SELECT count(*) AS count FROM kirim_api_keys WHERE consumer_id = $1 AND dicabut_at IS NULL",
      [consumer.id],
    );
    return { nama: GATEWAY_CARD_NAME, keterangan: GATEWAY_CARD_DESCRIPTION, nomor: numbers, kunci_aktif: Number(keys.rows[0]?.count ?? 0) };
  }

  /** The pop-up: every number with its keys, and every key with the application it was issued to. */
  async detail() {
    const consumer = await this.consumerOrNull();
    if (!consumer) return { nama: GATEWAY_CARD_NAME, keterangan: GATEWAY_CARD_DESCRIPTION, nomor: [], kunci: [] };
    const numbers = await this.numbers(consumer);
    const keys = await this.pool.query<ApiKeyRow & { kode: string; label: string }>(
      `SELECT ${keyColumns("k")}, d.kode, d.label FROM kirim_api_keys k JOIN kirim_devices d ON d.id = k.device_id
        WHERE k.consumer_id = $1 ORDER BY k.dicabut_at IS NOT NULL, k.dibuat_at DESC`,
      [consumer.id],
    );
    return {
      nama: GATEWAY_CARD_NAME,
      keterangan: GATEWAY_CARD_DESCRIPTION,
      nomor: numbers,
      kunci: keys.rows.map((row) => ({
        id: row.id,
        nama_aplikasi: row.namaAplikasi,
        awalan: row.awalan,
        nomor: { kode: row.kode, label: row.label },
        dibuat_at: row.dibuatAt.toISOString(),
        dibuat_oleh: row.dibuatOleh,
        terakhir_dipakai_at: row.terakhirDipakaiAt?.toISOString() ?? null,
        dicabut_at: row.dicabutAt?.toISOString() ?? null,
      })),
    };
  }

  /**
   * "Sambungkan nomor baru" on the card: a number owned by the gateway, with the `kode` route so
   * the applications on it can send verification codes. Pairing then opens from the pop-up.
   */
  async connectNewNumber(actor: AdminActor) {
    return withTransaction(this.pool, async (client) => {
      const consumer = await this.consumer(client);
      const kode = await freeIdentifier(client, "kirim_devices", "luar");
      const count = await client.query<{ count: string }>("SELECT count(*) AS count FROM kirim_devices WHERE pemilik_consumer_id = $1", [consumer.id]);
      const n = Number(count.rows[0]?.count ?? 0) + 1;
      const provider: ProviderName = this.providers.jalurpesan ? "jalurpesan" : "log";
      const deviceId = randomUUID();
      await client.query(
        `INSERT INTO kirim_devices (id, kode, label, pemilik_consumer_id, provider, provider_ref, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [deviceId, kode, n === 1 ? GATEWAY_CARD_NAME : `${GATEWAY_CARD_NAME} ${n}`, consumer.id, provider, provider === "jalurpesan" ? kode : null, provider === "log" ? "tersambung" : "belum_dipasang"],
      );
      await client.query("INSERT INTO kirim_routes (consumer_id, device_id, jenis) VALUES ($1, $2, 'kode') ON CONFLICT DO NOTHING", [consumer.id, deviceId]);
      await writeAudit(client, {
        actorKind: "human", actorRef: actor.ref, aksi: "gerbang.nomor_baru", objekJenis: "device", objekRef: kode,
        metadata: { provider },
      });
      return toBrowserDevice((await findDevice(client, kode))!);
    });
  }

  /** Issues a key for one application on one of the card's numbers. The plain key is returned once. */
  async createKey(actor: AdminActor, input: z.infer<typeof createKeySchema>) {
    return withTransaction(this.pool, async (client) => {
      const consumer = await this.consumer(client);
      const device = await findDevice(client, input.device);
      if (!device || device.pemilikConsumerId !== consumer.id) throw new KirimApiError(422, "nomor_bukan_gerbang", "Nomor ini bukan nomor di kartu Aplikasi luar.");
      if (device.status === "nonaktif") throw new KirimApiError(422, "device_inactive", "Nomor tidak aktif.");
      const kunci = `${API_KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
      const awalan = kunci.slice(0, API_KEY_PREFIX.length + 8);
      const id = randomUUID();
      await client.query(
        `INSERT INTO kirim_api_keys (id, consumer_id, device_id, nama_aplikasi, awalan, kunci_hash, dibuat_oleh)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, consumer.id, device.id, input.nama_aplikasi, awalan, this.hash(kunci), actor.ref],
      );
      await writeAudit(client, {
        actorKind: "human", actorRef: actor.ref, aksi: "gerbang.kunci_buat", objekJenis: "api_key", objekRef: id,
        metadata: { nama_aplikasi: input.nama_aplikasi, device: device.kode, awalan },
      });
      return { id, kunci, awalan, nama_aplikasi: input.nama_aplikasi, nomor: { kode: device.kode, label: device.label } };
    });
  }

  /** Revoking a key stops that application at once; the number and its other keys keep working. */
  async revokeKey(actor: AdminActor, id: string, alasan: string) {
    if (!z.guid().safeParse(id).success) throw new KirimApiError(404, "not_found", "Kunci tidak ditemukan.");
    return withTransaction(this.pool, async (client) => {
      const consumer = await this.consumer(client);
      const updated = await client.query<{ namaAplikasi: string; awalan: string }>(
        `UPDATE kirim_api_keys SET dicabut_at = now(), dicabut_oleh = $3, dicabut_alasan = $4
          WHERE id = $1 AND consumer_id = $2 AND dicabut_at IS NULL RETURNING nama_aplikasi AS "namaAplikasi", awalan`,
        [id, consumer.id, actor.ref, alasan],
      );
      const row = updated.rows[0];
      if (!row) throw new KirimApiError(404, "not_found", "Kunci tidak ditemukan atau sudah dicabut.");
      await writeAudit(client, {
        actorKind: "human", actorRef: actor.ref, aksi: "gerbang.kunci_cabut", objekJenis: "api_key", objekRef: id,
        metadata: { nama_aplikasi: row.namaAplikasi, awalan: row.awalan, alasan },
      });
      return { id, dicabut: true };
    });
  }

  /**
   * A bearer value starting with `krm_` is an API key. Returns the gateway consumer acting on the
   * key's number, or null when the value is not an API key at all. Unknown or revoked keys are refused.
   */
  async authenticate(bearer: string): Promise<GatewayConsumer | null> {
    if (!bearer.startsWith(API_KEY_PREFIX)) return null;
    const result = await this.pool.query<ApiKeyRow & { consumerId: string }>(
      `SELECT ${keyColumns("k")}, k.consumer_id AS "consumerId" FROM kirim_api_keys k WHERE k.kunci_hash = $1`,
      [this.hash(bearer)],
    );
    const key = result.rows[0];
    if (!key || key.dicabutAt) throw new KirimApiError(401, "unauthenticated", "Kunci API tidak dikenal atau sudah dicabut.");
    const consumer = await this.consumer();
    if (consumer.id !== key.consumerId || !consumer.aktif) throw new KirimApiError(403, "consumer_unknown", "Pemakai tidak terdaftar.");
    const device = await findDeviceById(this.pool, key.deviceId);
    if (!device) throw new KirimApiError(422, "device_inactive", "Nomor tidak aktif.");
    await this.pool.query(
      "UPDATE kirim_api_keys SET terakhir_dipakai_at = now() WHERE id = $1 AND (terakhir_dipakai_at IS NULL OR terakhir_dipakai_at < now() - interval '1 minute')",
      [key.id],
    );
    return { ...consumer, nomorDeviceId: device.id, apiKey: { id: key.id, namaAplikasi: key.namaAplikasi, awalan: key.awalan, device } };
  }

  /** `GET /internal/kirim/sambungan` with a key: the key's number and the number's webhook. */
  async connection(principal: GatewayConsumer) {
    const device = (await findDeviceById(this.pool, principal.apiKey.device.id)) ?? principal.apiKey.device;
    const webhook = await this.pool.query<{ url: string | null; enc: string | null }>(
      "SELECT webhook_url AS url, webhook_secret_enc AS enc FROM kirim_devices WHERE id = $1",
      [device.id],
    );
    const row = webhook.rows[0];
    return {
      aplikasi: principal.apiKey.namaAplikasi,
      nomor: { kode: device.kode, status: device.status, nomor_tersamar: device.nomorTersamar },
      jenis: ["notifikasi", "kode"] as const,
      webhook: row?.url && row.enc ? { url: row.url, secret: this.crypto.open(row.enc, columnAad("kirim_devices", "webhook_secret_enc", device.id)) } : null,
    };
  }

  /** `PUT /internal/kirim/sambungan/webhook` with a key: the number's webhook; Kirim keeps the secret. */
  async registerWebhook(principal: GatewayConsumer, url: string) {
    if (!isGatewayWebhookUrl(url) && !isAllowedWebhookUrl(url)) {
      throw new KirimApiError(422, "webhook_url_invalid", "Alamat webhook harus https://<host>/… atau http://127.0.0.1:<port>/… tanpa kredensial.");
    }
    const deviceId = principal.apiKey.device.id;
    await withTransaction(this.pool, async (client) => {
      const current = await client.query<{ url: string | null; hasSecret: boolean }>(
        "SELECT webhook_url AS url, webhook_secret_enc IS NOT NULL AS \"hasSecret\" FROM kirim_devices WHERE id = $1 FOR UPDATE",
        [deviceId],
      );
      const row = current.rows[0]!;
      const secretEnc = row.hasSecret ? null : this.crypto.seal(randomBytes(32).toString("base64url"), columnAad("kirim_devices", "webhook_secret_enc", deviceId));
      await client.query(
        "UPDATE kirim_devices SET webhook_url = $2, webhook_secret_enc = coalesce($3, webhook_secret_enc), updated_at = now() WHERE id = $1",
        [deviceId, url, secretEnc],
      );
      if (row.url !== url || secretEnc) {
        await writeAudit(client, {
          actorKind: "service", actorRef: `api_key:${principal.apiKey.awalan}`, aksi: "gerbang.webhook", objekJenis: "device", objekRef: principal.apiKey.device.kode,
          metadata: { url, rahasia_baru: Boolean(secretEnc), nama_aplikasi: principal.apiKey.namaAplikasi },
        });
      }
    });
    return this.connection(principal);
  }

  private hash(kunci: string): string {
    return this.crypto.lookup(`api_key:${kunci}`);
  }

  private async numbers(consumer: ConsumerRow) {
    const now = await dbNow(this.pool);
    const held = await heldDevices(this.pool);
    const devices = await this.pool.query<DeviceRow>(
      `SELECT d.id, d.kode, d.label, d.pemilik_consumer_id AS "pemilikConsumerId", c.nama AS pemilik,
              d.provider, d.provider_ref AS "providerRef", d.nomor_tersamar AS "nomorTersamar", d.status,
              d.antrean_dijeda AS "antreanDijeda", d.rate_per_menit AS "ratePerMenit",
              to_char(d.jam_kirim_mulai, 'HH24:MI') AS "jamKirimMulai", to_char(d.jam_kirim_selesai, 'HH24:MI') AS "jamKirimSelesai",
              d.status_berubah_at AS "statusBerubahAt", d.updated_at AS "updatedAt"
         FROM kirim_devices d JOIN kirim_consumers c ON c.id = d.pemilik_consumer_id
        WHERE d.pemilik_consumer_id = $1 ORDER BY d.created_at, d.kode`,
      [consumer.id],
    );
    const counts = await this.pool.query<{ deviceId: string; antre: string; gagal: string; kunci: string }>(
      `SELECT d.id AS "deviceId",
              (SELECT count(*) FROM kirim_outbox o WHERE o.device_id = d.id AND o.status = 'antre') AS antre,
              (SELECT count(*) FROM kirim_outbox o WHERE o.device_id = d.id AND o.status = 'gagal' AND o.updated_at >= $2) AS gagal,
              (SELECT count(*) FROM kirim_api_keys k WHERE k.device_id = d.id AND k.dicabut_at IS NULL) AS kunci
         FROM kirim_devices d WHERE d.pemilik_consumer_id = $1`,
      [consumer.id, wibDayStart(now)],
    );
    const byDevice = new Map(counts.rows.map((row) => [row.deviceId, row]));
    return devices.rows.map((device) => ({
      ...toBrowserDevice(device, held.get(device.id)),
      antrean: { antre: Number(byDevice.get(device.id)?.antre ?? 0), gagal_hari_ini: Number(byDevice.get(device.id)?.gagal ?? 0) },
      kunci_aktif: Number(byDevice.get(device.id)?.kunci ?? 0),
      webhook_terdaftar: false,
    }));
  }
}
