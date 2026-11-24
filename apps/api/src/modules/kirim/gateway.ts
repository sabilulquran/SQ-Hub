import { randomBytes, randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { z } from "zod";

import { DEVICE_DATA_TABLES, toBrowserDevice, type AdminActor } from "./admin.js";
import { columnAad, type KirimCrypto } from "./crypto.js";
import { KirimApiError } from "./errors.js";
import { GATEWAY_CONSUMER_NAME, wibDayStart } from "./policy.js";
import { defaultEngine, type KirimProvider, type ProviderName } from "./providers/types.js";
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
 * SQ Suite. One generic card ("Aplikasi luar") owns their numbers; **each number has its own API
 * key**, like a JalurPesan device key. Kirim SQ never learns which application holds a key: the
 * owner copies a number's key from the card into whatever application they want. The card never
 * names an application.
 */

export { GATEWAY_CONSUMER_NAME };
export const API_KEY_PREFIX = "krm_";
/** DRAFT (owner may rename): what the card says. No application name, no "SQ" abbreviation. */
export const GATEWAY_CARD_NAME = "Aplikasi luar";
export const GATEWAY_CARD_DESCRIPTION = "Portal atau aplikasi di luar Sabilul Qur'an Suite yang memakai API";

export const revokeKeySchema = z.object({ alasan: z.string().trim().min(1).max(500) }).strict();
export const gatewayWebhookSchema = z.object({ url: z.string().trim().min(1).max(2048) }).strict();

/** What a request authenticated with an API key acts as: the gateway consumer on the key's number. */
export interface ApiKeyPrincipal {
  id: string;
  awalan: string;
  device: DeviceRow;
}

export type GatewayConsumer = ConsumerRow & { apiKey: ApiKeyPrincipal };

interface ApiKeyRow {
  id: string;
  deviceId: string;
  awalan: string;
  kunciEnc: string | null;
  namaAplikasi: string | null;
  dibuatAt: Date;
  terakhirDipakaiAt: Date | null;
  dicabutAt: Date | null;
}

const keyColumns = (alias: string) => `
  ${alias}.id, ${alias}.device_id AS "deviceId", ${alias}.awalan, ${alias}.kunci_enc AS "kunciEnc", ${alias}.nama_aplikasi AS "namaAplikasi",
  ${alias}.dibuat_at AS "dibuatAt", ${alias}.terakhir_dipakai_at AS "terakhirDipakaiAt", ${alias}.dicabut_at AS "dicabutAt"
`;

/**
 * KIRIM-IMPL-003 §17: how the "Aplikasi luar" card stands to a number. `pemilik` = one of its own
 * numbers. `pemakai` = another application's number that an outside application sends through with
 * its key after "Pakai nomor yang ada"; the WhatsApp session belongs to the owner's card.
 */
export type GatewayPeran = "pemilik" | "pemakai";

/** The number's key as the card shows it; `kunci` is null only for a key made before migration 0024. */
export interface GatewayNumberKey {
  awalan: string;
  kunci: string | null;
  dibuat_at: string;
  terakhir_dipakai_at: string | null;
}

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

  /**
   * The home screen's outside numbers. Owner decision 2026-11-17: each one is a card of its own,
   * beside the application cards, rather than a list inside a single combined card.
   *
   * The key's **value** is deliberately left out here. The home screen loads on every visit, and a
   * key is a credential; it is read once, in that number's own pop-up (`detail`). What the card
   * needs is only whether a key exists and how it is doing.
   */
  async card() {
    const consumer = await this.consumerOrNull();
    if (!consumer) return { nama: GATEWAY_CARD_NAME, keterangan: GATEWAY_CARD_DESCRIPTION, nomor: [] };
    const numbers = await this.numbers(consumer);
    return {
      nama: GATEWAY_CARD_NAME,
      keterangan: GATEWAY_CARD_DESCRIPTION,
      nomor: numbers.map(({ kunci, ...rest }) => ({
        ...rest,
        kunci: kunci ? { awalan: kunci.awalan, dibuat_at: kunci.dibuat_at, terakhir_dipakai_at: kunci.terakhir_dipakai_at } : null,
      })),
    };
  }

  /** The pop-up: every number with its connection, its key (readable, to copy) and when the key was last used. */
  async detail() {
    const consumer = await this.consumerOrNull();
    if (!consumer) return { nama: GATEWAY_CARD_NAME, keterangan: GATEWAY_CARD_DESCRIPTION, nomor: [] };
    return { nama: GATEWAY_CARD_NAME, keterangan: GATEWAY_CARD_DESCRIPTION, nomor: await this.numbers(consumer) };
  }

  /**
   * "Sambungkan nomor baru" on the card: a number owned by the gateway, with the `kode` route so the
   * application on it can send verification codes, and its API key made at once. Pairing then
   * opens from the pop-up.
   */
  async connectNewNumber(actor: AdminActor) {
    return withTransaction(this.pool, async (client) => {
      const consumer = await this.consumer(client);
      const kode = await freeIdentifier(client, "kirim_devices", "luar");
      const labels = new Set((await client.query<{ label: string }>("SELECT label FROM kirim_devices WHERE pemilik_consumer_id = $1", [consumer.id])).rows.map((row) => row.label));
      let n = 1;
      while (labels.has(n === 1 ? GATEWAY_CARD_NAME : `${GATEWAY_CARD_NAME} ${n}`)) n += 1;
      const provider: ProviderName = defaultEngine(this.providers);
      const deviceId = randomUUID();
      await client.query(
        `INSERT INTO kirim_devices (id, kode, label, pemilik_consumer_id, provider, provider_ref, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [deviceId, kode, n === 1 ? GATEWAY_CARD_NAME : `${GATEWAY_CARD_NAME} ${n}`, consumer.id, provider, provider === "log" ? null : kode, provider === "log" ? "tersambung" : "belum_dipasang"],
      );
      await client.query("INSERT INTO kirim_routes (consumer_id, device_id, jenis) VALUES ($1, $2, 'kode') ON CONFLICT DO NOTHING", [consumer.id, deviceId]);
      await writeAudit(client, {
        actorKind: "human", actorRef: actor.ref, aksi: "gerbang.nomor_baru", objekJenis: "device", objekRef: kode,
        metadata: { provider },
      });
      await this.issueKey(client, actor, consumer, deviceId, kode, "gerbang.kunci_buat");
      return toBrowserDevice((await findDevice(client, kode))!);
    });
  }

  /**
   * "Putar ulang" (or "Buat kunci" for a number without one): the number gets a new key and any
   * earlier key stops at once. The WhatsApp session is untouched.
   */
  async rotateKey(actor: AdminActor, kode: string): Promise<GatewayNumberKey> {
    return withTransaction(this.pool, async (client) => {
      const consumer = await this.consumer(client);
      const { device } = await this.requireGatewayDevice(client, consumer, kode);
      const revoked = await client.query<{ awalan: string; namaAplikasi: string | null }>(
        `UPDATE kirim_api_keys SET dicabut_at = now(), dicabut_oleh = $2, dicabut_alasan = 'diputar ulang'
          WHERE device_id = $1 AND dicabut_at IS NULL RETURNING awalan, nama_aplikasi AS "namaAplikasi"`,
        [device.id, actor.ref],
      );
      // §17: the application's name on a number it uses stays with the new key.
      const nama = revoked.rows[0]?.namaAplikasi ?? (await this.lastKeyName(client, consumer, device.id));
      return this.issueKey(client, actor, consumer, device.id, device.kode, revoked.rows[0] ? "gerbang.kunci_putar" : "gerbang.kunci_buat", revoked.rows[0]?.awalan, nama);
    });
  }

  /** "Cabut": the number keeps its WhatsApp session; the application that held the key is refused from now on. */
  async revokeKey(actor: AdminActor, kode: string, alasan: string) {
    return withTransaction(this.pool, async (client) => {
      const consumer = await this.consumer(client);
      const { device } = await this.requireGatewayDevice(client, consumer, kode);
      const updated = await client.query<{ awalan: string }>(
        "UPDATE kirim_api_keys SET dicabut_at = now(), dicabut_oleh = $2, dicabut_alasan = $3 WHERE device_id = $1 AND dicabut_at IS NULL RETURNING awalan",
        [device.id, actor.ref, alasan],
      );
      const row = updated.rows[0];
      if (!row) throw new KirimApiError(404, "not_found", "Nomor ini tidak punya kunci aktif.");
      await writeAudit(client, {
        actorKind: "human", actorRef: actor.ref, aksi: "gerbang.kunci_cabut", objekJenis: "device", objekRef: device.kode,
        metadata: { awalan: row.awalan, alasan },
      });
      return { nomor: device.kode, dicabut: true };
    });
  }

  /**
   * "Hapus" on an outside number's card: the card is removed for good, with its API key and routes.
   * Owner 2026-11-23: an outside number that was never connected (or came loose) can be cleaned up
   * from its own card, so a number created by mistake — or a duplicate that was scanned onto a
   * WhatsApp already in Kirim — does not sit on the home screen with nothing behind it.
   *
   * Only a number with **no live WhatsApp session** is deleted: an engineless (`log`) number, or
   * one that is `belum_dipasang`, `terputus` or `nonaktif`. A `tersambung` or `menunggu_pairing`
   * number is refused (`409 nomor_tersambung`) — Putuskan it first. A number that already holds
   * conversations, a queue or any other data of its own is refused (`409 nomor_sudah_berisi`); those
   * need an operator. The engine tenant is left in place (§K-9): Kirim SQ never drops it on its own.
   */
  async deleteNumber(actor: AdminActor, kode: string) {
    return withTransaction(this.pool, async (client) => {
      const consumer = await this.consumer(client);
      const device = await findDevice(client, kode, true);
      if (device && device.pemilikConsumerId !== consumer.id && (await this.usesNumber(client, consumer, device.id))) {
        return this.releaseNumber(client, actor, consumer, device);
      }
      if (!device || device.pemilikConsumerId !== consumer.id) {
        throw new KirimApiError(404, "not_found", "Nomor ini bukan nomor di kartu Aplikasi luar.");
      }
      if (device.provider !== "log" && (device.status === "tersambung" || device.status === "menunggu_pairing")) {
        throw new KirimApiError(409, "nomor_tersambung", "Nomor ini masih tersambung ke WhatsApp. Putuskan dulu sebelum menghapus.");
      }
      const counts = await client.query<{ n: string }>(
        `SELECT (${DEVICE_DATA_TABLES.map((table) => `(SELECT count(*) FROM ${table} WHERE device_id = $1)`).join(" + ")})::text AS n`,
        [device.id],
      );
      if (Number(counts.rows[0]?.n ?? 0) > 0) {
        throw new KirimApiError(409, "nomor_sudah_berisi", `${device.label} sudah menyimpan percakapan atau antrean sendiri, jadi tidak bisa dihapus dari layar. Hubungi operator.`);
      }
      // No other application may still point at this number (it should not, but a shared route would
      // leave that application sending through a number that no longer exists).
      const otherUse = await client.query(
        `SELECT 1 FROM kirim_consumers WHERE nomor_device_id = $1 AND id <> $2
         UNION ALL SELECT 1 FROM kirim_routes WHERE device_id = $1 AND consumer_id <> $2 LIMIT 1`,
        [device.id, consumer.id],
      );
      if ((otherUse.rowCount ?? 0) > 0) {
        throw new KirimApiError(409, "nomor_dipakai_modul_lain", "Nomor ini masih dipakai aplikasi lain. Putuskan dulu dari kartunya.");
      }
      await client.query("DELETE FROM kirim_api_keys WHERE device_id = $1", [device.id]);
      await client.query("DELETE FROM kirim_routes WHERE device_id = $1", [device.id]);
      await client.query("UPDATE kirim_consumers SET nomor_device_id = NULL, updated_at = now() WHERE nomor_device_id = $1", [device.id]);
      try {
        await client.query("DELETE FROM kirim_devices WHERE id = $1", [device.id]);
      } catch (error) {
        // A send or event landed on the number after the count above: its rows now reference it.
        if ((error as { code?: string }).code === "23503") {
          throw new KirimApiError(409, "nomor_sudah_berisi", `${device.label} baru saja dipakai, jadi tidak bisa dihapus dari layar. Hubungi operator.`);
        }
        throw error;
      }
      await writeAudit(client, {
        actorKind: "human", actorRef: actor.ref, aksi: "gerbang.nomor_hapus", objekJenis: "device", objekRef: kode,
        metadata: { status: device.status, provider: device.provider, ...(device.providerRef ? { tenant: device.providerRef } : {}) },
      });
      return { kode, dihapus: true };
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
    return { ...consumer, nomorDeviceId: device.id, apiKey: { id: key.id, awalan: key.awalan, device } };
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
          metadata: { url, rahasia_baru: Boolean(secretEnc) },
        });
      }
    });
    return this.connection(principal);
  }

  private hash(kunci: string): string {
    return this.crypto.lookup(`api_key:${kunci}`);
  }

  /** §17: the gateway sends through another application's number when it holds a route on it. */
  private async usesNumber(db: Queryable, consumer: ConsumerRow, deviceId: string): Promise<boolean> {
    const routed = await db.query("SELECT 1 FROM kirim_routes WHERE consumer_id = $1 AND device_id = $2 LIMIT 1", [consumer.id, deviceId]);
    return (routed.rowCount ?? 0) > 0;
  }

  private async lastKeyName(db: Queryable, consumer: ConsumerRow, deviceId: string): Promise<string | null> {
    const last = await db.query<{ nama: string | null }>(
      "SELECT nama_aplikasi AS nama FROM kirim_api_keys WHERE consumer_id = $1 AND device_id = $2 ORDER BY dibuat_at DESC, id LIMIT 1",
      [consumer.id, deviceId],
    );
    return last.rows[0]?.nama ?? null;
  }

  /**
   * §17 "Hapus" on the card of a number the gateway only uses: the outside application lets go of it.
   * Its key is revoked (kept for the record), its routes and the number's webhook go, and the number
   * itself, its session and its owner's card are untouched.
   */
  private async releaseNumber(db: Queryable, actor: AdminActor, consumer: ConsumerRow, device: DeviceRow) {
    const revoked = await db.query<{ awalan: string }>(
      `UPDATE kirim_api_keys SET dicabut_at = now(), dicabut_oleh = $3, dicabut_alasan = 'dilepas dari nomor'
        WHERE consumer_id = $1 AND device_id = $2 AND dicabut_at IS NULL RETURNING awalan`,
      [consumer.id, device.id, actor.ref],
    );
    await db.query("DELETE FROM kirim_routes WHERE consumer_id = $1 AND device_id = $2", [consumer.id, device.id]);
    await db.query("UPDATE kirim_devices SET webhook_url = NULL, webhook_secret_enc = NULL, updated_at = now() WHERE id = $1", [device.id]);
    await writeAudit(db, {
      actorKind: "human", actorRef: actor.ref, aksi: "gerbang.nomor_lepas", objekJenis: "device", objekRef: device.kode,
      metadata: { pemilik: device.pemilik, ...(revoked.rows[0] ? { kunci_dicabut: revoked.rows[0].awalan } : {}) },
    });
    return { kode: device.kode, dihapus: true, dilepas: true };
  }

  /** A number the card may manage keys on: one of its own, or (§17) one it uses. */
  private async requireGatewayDevice(db: Queryable, consumer: ConsumerRow, kode: string): Promise<{ device: DeviceRow; peran: GatewayPeran }> {
    const device = await findDevice(db, kode, true);
    const peran: GatewayPeran | null = !device ? null
      : device.pemilikConsumerId === consumer.id ? "pemilik"
        : (await this.usesNumber(db, consumer, device.id)) ? "pemakai" : null;
    if (!device || !peran) throw new KirimApiError(404, "not_found", "Nomor ini bukan nomor di kartu Aplikasi luar.");
    if (device.status === "nonaktif") throw new KirimApiError(422, "device_inactive", "Nomor tidak aktif.");
    return { device, peran };
  }

  /** Makes a key for a number: the hash for lookup, the sealed value so the card can show it again. */
  private async issueKey(db: Queryable, actor: AdminActor, consumer: ConsumerRow, deviceId: string, kode: string, aksi: string, replaced?: string, namaAplikasi: string | null = null): Promise<GatewayNumberKey> {
    const kunci = `${API_KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
    const awalan = kunci.slice(0, API_KEY_PREFIX.length + 8);
    const id = randomUUID();
    await db.query(
      `INSERT INTO kirim_api_keys (id, consumer_id, device_id, awalan, kunci_hash, kunci_enc, dibuat_oleh, nama_aplikasi)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, consumer.id, deviceId, awalan, this.hash(kunci), this.crypto.seal(kunci, columnAad("kirim_api_keys", "kunci_enc", id)), actor.ref, namaAplikasi],
    );
    await writeAudit(db, {
      actorKind: "human", actorRef: actor.ref, aksi, objekJenis: "device", objekRef: kode,
      metadata: { awalan, ...(replaced ? { menggantikan: replaced } : {}) },
    });
    const dibuat = await dbNow(db);
    return { awalan, kunci, dibuat_at: dibuat.toISOString(), terakhir_dipakai_at: null };
  }

  private async numbers(consumer: ConsumerRow) {
    const now = await dbNow(this.pool);
    const held = await heldDevices(this.pool);
    // §17: the card's own numbers, then the other applications' numbers it sends through with a key.
    const used = "EXISTS (SELECT 1 FROM kirim_routes r WHERE r.consumer_id = $1 AND r.device_id = d.id)";
    const devices = await this.pool.query<DeviceRow>(
      `SELECT d.id, d.kode, d.label, d.pemilik_consumer_id AS "pemilikConsumerId", c.nama AS pemilik,
              d.provider, d.provider_ref AS "providerRef", d.nomor_tersamar AS "nomorTersamar", d.status,
              d.antrean_dijeda AS "antreanDijeda", d.rate_per_menit AS "ratePerMenit",
              to_char(d.jam_kirim_mulai, 'HH24:MI') AS "jamKirimMulai", to_char(d.jam_kirim_selesai, 'HH24:MI') AS "jamKirimSelesai",
              d.status_berubah_at AS "statusBerubahAt", d.updated_at AS "updatedAt"
         FROM kirim_devices d JOIN kirim_consumers c ON c.id = d.pemilik_consumer_id
        WHERE d.pemilik_consumer_id = $1 OR ${used}
        ORDER BY (d.pemilik_consumer_id <> $1), d.created_at, d.kode`,
      [consumer.id],
    );
    // On a number it only uses, the card counts its own messages, not the owner's.
    const counts = await this.pool.query<{ deviceId: string; antre: string; gagal: string; webhook: boolean }>(
      `SELECT d.id AS "deviceId",
              (SELECT count(*) FROM kirim_outbox o WHERE o.device_id = d.id AND o.consumer_id = $1 AND o.status = 'antre') AS antre,
              (SELECT count(*) FROM kirim_outbox o WHERE o.device_id = d.id AND o.consumer_id = $1 AND o.status = 'gagal' AND o.updated_at >= $2) AS gagal,
              d.webhook_url IS NOT NULL AS webhook
         FROM kirim_devices d WHERE d.pemilik_consumer_id = $1 OR ${used}`,
      [consumer.id, wibDayStart(now)],
    );
    const keys = await this.pool.query<ApiKeyRow>(`SELECT ${keyColumns("k")} FROM kirim_api_keys k WHERE k.consumer_id = $1 AND k.dicabut_at IS NULL`, [consumer.id]);
    const names = await this.pool.query<{ deviceId: string; nama: string | null }>(
      `SELECT DISTINCT ON (device_id) device_id AS "deviceId", nama_aplikasi AS nama FROM kirim_api_keys WHERE consumer_id = $1 ORDER BY device_id, dibuat_at DESC, id`,
      [consumer.id],
    );
    const byDevice = new Map(counts.rows.map((row) => [row.deviceId, row]));
    const keyByDevice = new Map(keys.rows.map((row) => [row.deviceId, row]));
    const nameByDevice = new Map(names.rows.map((row) => [row.deviceId, row.nama]));
    return devices.rows.map((device) => {
      const key = keyByDevice.get(device.id);
      const peran: GatewayPeran = device.pemilikConsumerId === consumer.id ? "pemilik" : "pemakai";
      const kunci: GatewayNumberKey | null = key
        ? {
            awalan: key.awalan,
            kunci: key.kunciEnc ? this.crypto.open(key.kunciEnc, columnAad("kirim_api_keys", "kunci_enc", key.id)) : null,
            dibuat_at: key.dibuatAt.toISOString(),
            terakhir_dipakai_at: key.terakhirDipakaiAt?.toISOString() ?? null,
          }
        : null;
      return {
        ...toBrowserDevice(device, held.get(device.id)),
        antrean: { antre: Number(byDevice.get(device.id)?.antre ?? 0), gagal_hari_ini: Number(byDevice.get(device.id)?.gagal ?? 0) },
        webhook_terdaftar: byDevice.get(device.id)?.webhook ?? false,
        kunci,
        peran,
        // Only a number the card uses carries a name: the label of the outside number it came from (§17).
        // The card's own numbers stay nameless, as on 2026-11-17.
        ...(peran === "pemakai" ? { nama_aplikasi: key?.namaAplikasi ?? nameByDevice.get(device.id) ?? null } : {}),
      };
    });
  }
}
