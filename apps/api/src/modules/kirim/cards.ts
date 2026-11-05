import { randomBytes, randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { z } from "zod";

import { toBrowserDevice, type AdminActor, type KirimAdminService } from "./admin.js";
import { columnAad, type KirimCrypto } from "./crypto.js";
import { wibDayStart } from "./policy.js";
import type { KirimProvider, ProviderName } from "./providers/types.js";
import {
  dbNow,
  ensureApplicationConsumer,
  findConsumerById,
  findDevice,
  findDeviceById,
  findWhatsAppApplication,
  freeIdentifier,
  heldDevices,
  listWhatsAppApplications,
  setDeviceStatus,
  withTransaction,
  writeAudit,
  type ConsumerRow,
  type DeviceRow,
  type Queryable,
  type RegistryApplication,
} from "./repository.js";
import { KirimApiError } from "./service.js";
import { isAllowedWebhookUrl, resolveWebhookSecret } from "./webhooks.js";

/**
 * KIRIM-IMPL-003: one card per WhatsApp-capable registry application. A card is empty, owns its
 * number, or sends through another module's number. Nothing here asks a person for a number
 * code, a client id or a secret.
 */

const kodeSchema = z.string().trim().regex(/^[a-z][a-z0-9-]{1,30}$/);

export const useNumberSchema = z.object({ device: kodeSchema, kode_verifikasi: z.boolean().default(false) }).strict();
/**
 * KIRIM-IMPL-003 §11.3. `nomor_berbeda`: the admin states the new WhatsApp is a different phone
 * from the module's earlier numbers. Without it a module that already owns a number is refused.
 */
export const newNumberSchema = z.object({ nomor_berbeda: z.boolean().default(false) }).strict();
export const ownNumberSchema = z.object({ device: kodeSchema }).strict();
export const cardReasonSchema = z.object({ alasan: z.string().trim().min(1).max(500) }).strict();
export const webhookRegistrationSchema = z.object({ url: z.string().trim().min(1).max(2048) }).strict();

type Jenis = "notifikasi" | "kode";

export interface ModuleCard {
  application_key: string;
  nama: string;
  peran: "kosong" | "pemilik" | "pemakai";
  nomor: ReturnType<typeof toBrowserDevice> | null;
  jenis: Jenis[];
  antrean: { antre: number; gagal_hari_ini: number };
  dipakai_juga_oleh: string[];
  pemilik_nomor: string | null;
  /** KIRIM-IMPL-003 §11.3: other numbers this module owns, nonaktif ones included, for "Pakai nomor lama". */
  nomor_lama: Array<{ kode: string; label: string; status: string; nomor_tersamar: string | null }>;
}

export class KirimModuleCards {
  constructor(
    private readonly pool: Pool,
    private readonly crypto: KirimCrypto,
    private readonly admin: KirimAdminService,
    private readonly providers: Record<ProviderName, KirimProvider | undefined>,
    private readonly options: { secrets?: NodeJS.ProcessEnv } = {},
  ) {}

  /** `GET /modules`: the cards plus the number list the Nomor screen already showed. */
  async list() {
    const applications = (await listWhatsAppApplications(this.pool)).filter((application) => application.status === "active");
    const cards = [];
    const held = await heldDevices(this.pool);
    for (const application of applications) cards.push(await this.card(this.pool, application, held));
    return { modules: cards, ...(await this.admin.listDevices()) };
  }

  /**
   * "Sambungkan nomor baru": the number's code, label, provider and tenant are chosen here. A module
   * that already owns a number (nonaktif included) is refused unless the admin states the new
   * WhatsApp is a different phone (§11.3): the same phone belongs on the old number via
   * "Pakai nomor lama" and "Sambungkan ulang", not on a second number.
   */
  async connectNewNumber(actor: AdminActor, applicationKey: string, input: z.infer<typeof newNumberSchema> = { nomor_berbeda: false }) {
    return this.change(applicationKey, async (client, application, consumer) => {
      if (consumer.nomorDeviceId) throw new KirimApiError(409, "kartu_sudah_tersambung", "Modul ini sudah tersambung. Putuskan dulu sebelum memakai nomor lain.");
      const own = await client.query<{ kode: string; label: string; status: string }>(
        "SELECT kode, label, status FROM kirim_devices WHERE pemilik_consumer_id = $1 ORDER BY created_at, kode",
        [consumer.id],
      );
      if (own.rows.length > 0 && !input.nomor_berbeda) {
        throw new KirimApiError(
          409,
          "nomor_modul_ada",
          `${application.name} sudah punya ${own.rows.map((row) => row.label).join(", ")}. Pakai nomor yang ada, lalu Sambungkan ulang bila WhatsApp-nya terlepas. Buat nomor baru hanya untuk WhatsApp yang berbeda.`,
          { nomor: own.rows },
        );
      }
      const kode = await freeIdentifier(client, "kirim_devices", application.applicationKey);
      const provider: ProviderName = this.providers.jalurpesan ? "jalurpesan" : "log";
      const deviceId = randomUUID();
      await client.query(
        `INSERT INTO kirim_devices (id, kode, label, pemilik_consumer_id, provider, provider_ref, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [deviceId, kode, `Nomor ${application.name}`.slice(0, 100), consumer.id, provider, provider === "jalurpesan" ? kode : null, provider === "log" ? "tersambung" : "belum_dipasang"],
      );
      await client.query("UPDATE kirim_consumers SET nomor_device_id = $2, updated_at = now() WHERE id = $1", [consumer.id, deviceId]);
      await writeAudit(client, {
        actorKind: "human", actorRef: actor.ref, aksi: "kartu.nomor_baru", objekJenis: "modul", objekRef: application.applicationKey,
        metadata: { device: kode, provider, ...(own.rows.length > 0 ? { nomor_berbeda_dari: own.rows.map((row) => row.kode) } : {}) },
      });
    });
  }

  /**
   * KIRIM-IMPL-003 §11.3 "Pakai nomor lama": the card takes back a number this module already owns.
   * A nonaktif number becomes `terputus` (a `log` number `tersambung`); its conversations, routes and
   * engine tenant are those it had. The screen then offers "Sambungkan ulang".
   */
  async useOwnNumber(actor: AdminActor, applicationKey: string, input: z.infer<typeof ownNumberSchema>) {
    return this.change(applicationKey, async (client, application, consumer) => {
      const device = await findDevice(client, input.device, true);
      if (!device || device.pemilikConsumerId !== consumer.id) throw new KirimApiError(422, "nomor_bukan_milik_modul", "Nomor ini bukan milik modul ini.");
      if (consumer.nomorDeviceId && consumer.nomorDeviceId !== device.id) {
        throw new KirimApiError(409, "kartu_sudah_tersambung", "Modul ini sudah tersambung. Putuskan dulu sebelum memakai nomor lain.");
      }
      const diaktifkan = device.status === "nonaktif";
      if (diaktifkan) {
        await setDeviceStatus(client, this.crypto, device.id, device.provider === "log" ? "tersambung" : "terputus", { allowFromNonaktif: true });
      }
      await client.query("UPDATE kirim_consumers SET nomor_device_id = $2, updated_at = now() WHERE id = $1", [consumer.id, device.id]);
      await writeAudit(client, {
        actorKind: "human", actorRef: actor.ref, aksi: "kartu.pakai_nomor_lama", objekJenis: "modul", objekRef: application.applicationKey,
        metadata: { device: device.kode, diaktifkan },
      });
    });
  }

  /** "Pakai nomor yang sudah aktif", and Ubah on a card that uses another module's number. */
  async useNumber(actor: AdminActor, applicationKey: string, input: z.infer<typeof useNumberSchema>) {
    return this.change(applicationKey, async (client, application, consumer) => {
      const device = await findDevice(client, input.device, true);
      if (!device || device.status === "nonaktif") throw new KirimApiError(422, "device_inactive", "Nomor tidak aktif.");
      if (device.pemilikConsumerId === consumer.id) throw new KirimApiError(409, "nomor_milik_sendiri", "Nomor ini sudah milik modul ini.");
      if (consumer.nomorDeviceId && consumer.nomorDeviceId !== device.id) {
        throw new KirimApiError(409, "kartu_sudah_tersambung", "Modul ini sudah tersambung. Putuskan dulu sebelum memakai nomor lain.");
      }
      await client.query(
        `INSERT INTO kirim_routes (consumer_id, device_id, jenis) VALUES ($1, $2, 'notifikasi') ON CONFLICT DO NOTHING`,
        [consumer.id, device.id],
      );
      if (input.kode_verifikasi) {
        await client.query(`INSERT INTO kirim_routes (consumer_id, device_id, jenis) VALUES ($1, $2, 'kode') ON CONFLICT DO NOTHING`, [consumer.id, device.id]);
      } else {
        await client.query(`DELETE FROM kirim_routes WHERE consumer_id = $1 AND device_id = $2 AND jenis = 'kode'`, [consumer.id, device.id]);
      }
      await client.query("UPDATE kirim_consumers SET nomor_device_id = $2, updated_at = now() WHERE id = $1", [consumer.id, device.id]);
      await writeAudit(client, {
        actorKind: "human", actorRef: actor.ref, aksi: "kartu.pakai_nomor", objekJenis: "modul", objekRef: application.applicationKey,
        metadata: { device: device.kode, kode_verifikasi: input.kode_verifikasi },
      });
    });
  }

  /**
   * K-3. A module using another module's number only lets go of it: its routes and card are
   * cleared and the number keeps working for everyone else. The owner logs the WhatsApp session
   * out, which is refused while other modules still use the number.
   */
  async disconnect(actor: AdminActor, applicationKey: string, alasan: string) {
    const application = await this.requireApplication(this.pool, applicationKey);
    const consumer = await findLinkedConsumer(this.pool, application);
    const device = consumer?.nomorDeviceId ? await findDeviceById(this.pool, consumer.nomorDeviceId) : null;
    if (!consumer || !device) throw new KirimApiError(409, "kartu_kosong", "Modul ini belum tersambung.");
    if (device.pemilikConsumerId === consumer.id) {
      await this.admin.disconnect(actor, device.kode, alasan);
      return this.card(this.pool, application);
    }
    return this.change(applicationKey, async (client) => {
      await client.query("DELETE FROM kirim_routes WHERE consumer_id = $1 AND device_id = $2", [consumer.id, device.id]);
      await client.query("UPDATE kirim_consumers SET nomor_device_id = NULL, updated_at = now() WHERE id = $1 AND nomor_device_id = $2", [consumer.id, device.id]);
      await writeAudit(client, {
        actorKind: "human", actorRef: actor.ref, aksi: "kartu.putuskan", objekJenis: "modul", objekRef: applicationKey,
        metadata: { device: device.kode, alasan },
      });
    });
  }

  /** `GET /internal/kirim/sambungan`: what a module needs, read with its own token (§6). */
  async connection(consumerRef: Pick<ConsumerRow, "id">) {
    const consumer = (await findConsumerById(this.pool, consumerRef.id))!;
    const device = consumer.nomorDeviceId ? await findDeviceById(this.pool, consumer.nomorDeviceId) : null;
    const secret = await this.webhookSecret(consumer.id);
    return {
      modul: consumer.applicationKey ?? consumer.nama,
      nomor: device
        ? { kode: device.kode, status: device.status, nomor_tersamar: device.nomorTersamar, peran: device.pemilikConsumerId === consumer.id ? "pemilik" : "pemakai" }
        : null,
      jenis: device ? await allowedJenis(this.pool, consumer.id, device) : [],
      webhook: consumer.webhookUrl && secret ? { url: consumer.webhookUrl, secret } : null,
    };
  }

  /** `PUT /internal/kirim/sambungan/webhook`: the module names its own URL; Kirim SQ keeps the secret. */
  async registerWebhook(consumerRef: Pick<ConsumerRow, "id" | "clientId">, url: string) {
    if (!isSelfRegisteredWebhookUrl(url)) {
      throw new KirimApiError(422, "webhook_url_invalid", "Alamat webhook harus http://127.0.0.1:<port>/internal/kirim/webhook atau https://<host>.sabilulquran.or.id/api/internal/kirim/webhook.");
    }
    await withTransaction(this.pool, async (client) => {
      const row = await client.query<{ webhookUrl: string | null; hasSecret: boolean }>(
        `SELECT webhook_url AS "webhookUrl", (webhook_secret_enc IS NOT NULL OR webhook_secret_ref IS NOT NULL) AS "hasSecret"
           FROM kirim_consumers WHERE id = $1 FOR UPDATE`,
        [consumerRef.id],
      );
      const current = row.rows[0]!;
      const secretEnc = current.hasSecret
        ? null
        : this.crypto.seal(randomBytes(32).toString("base64url"), columnAad("kirim_consumers", "webhook_secret_enc", consumerRef.id));
      await client.query(
        `UPDATE kirim_consumers SET webhook_url = $2, webhook_secret_enc = coalesce($3, webhook_secret_enc), updated_at = now() WHERE id = $1`,
        [consumerRef.id, url, secretEnc],
      );
      if (current.webhookUrl !== url || secretEnc) {
        await writeAudit(client, {
          actorKind: "service", actorRef: consumerRef.clientId, aksi: "pemakai.webhook", objekJenis: "consumer", objekRef: consumerRef.id,
          metadata: { url, rahasia_baru: Boolean(secretEnc) },
        });
      }
    });
    return this.connection(consumerRef);
  }

  /** The signing secret: the encrypted one Kirim SQ made, else the R1 env reference. */
  async webhookSecret(consumerId: string): Promise<string | null> {
    const result = await this.pool.query<{ enc: string | null; ref: string | null }>(
      "SELECT webhook_secret_enc AS enc, webhook_secret_ref AS ref FROM kirim_consumers WHERE id = $1",
      [consumerId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return resolveWebhookSecret(this.crypto, { id: consumerId, webhookSecretEnc: row.enc, webhookSecretRef: row.ref }, this.options.secrets);
  }

  private async change(
    applicationKey: string,
    work: (client: Queryable, application: RegistryApplication, consumer: ConsumerRow) => Promise<void>,
  ) {
    const application = await this.requireApplication(this.pool, applicationKey);
    await withTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('kirim_consumers'))");
      const consumer = await ensureApplicationConsumer(client, application);
      if (!consumer.aktif) throw new KirimApiError(409, "pemakai_nonaktif", "Pemakai modul ini dinonaktifkan operator.");
      await work(client, application, consumer);
    });
    return this.card(this.pool, application);
  }

  private async requireApplication(db: Queryable, applicationKey: string): Promise<RegistryApplication> {
    const application = await findWhatsAppApplication(db, { applicationKey });
    if (!application || application.status !== "active") throw new KirimApiError(404, "not_found", "Modul tidak ditemukan atau tidak memakai WhatsApp.");
    return application;
  }

  private async card(db: Queryable, application: RegistryApplication, held?: Map<string, { kode: string; label: string }>): Promise<ModuleCard> {
    const consumer = await findLinkedConsumer(db, application);
    const device = consumer?.nomorDeviceId ? await findDeviceById(db, consumer.nomorDeviceId) : null;
    const nomorLama = consumer
      ? (await db.query<{ kode: string; label: string; status: string; nomor_tersamar: string | null }>(
          `SELECT kode, label, status, nomor_tersamar FROM kirim_devices
            WHERE pemilik_consumer_id = $1 AND id IS DISTINCT FROM $2 ORDER BY created_at, kode`,
          [consumer.id, device?.id ?? null],
        )).rows
      : [];
    const empty: ModuleCard = {
      application_key: application.applicationKey, nama: application.name, peran: "kosong", nomor: null, jenis: [],
      antrean: { antre: 0, gagal_hari_ini: 0 }, dipakai_juga_oleh: [], pemilik_nomor: null, nomor_lama: nomorLama,
    };
    if (!consumer || !device) return empty;
    const now = await dbNow(db);
    const counts = await db.query<{ antre: string; gagal: string }>(
      `SELECT count(*) FILTER (WHERE status = 'antre') AS antre,
              count(*) FILTER (WHERE status = 'gagal' AND updated_at >= $3) AS gagal
         FROM kirim_outbox WHERE consumer_id = $1 AND device_id = $2`,
      [consumer.id, device.id, wibDayStart(now)],
    );
    const names = await db.query<{ id: string; nama: string }>(
      `SELECT c.id, coalesce(a.name, c.nama) AS nama
         FROM kirim_consumers c LEFT JOIN applications a ON a.application_key = c.application_key OR (c.application_key IS NULL AND a.machine_client_id = c.client_id)
        WHERE c.aktif AND (c.id = $2 OR c.nomor_device_id = $1 OR EXISTS (SELECT 1 FROM kirim_routes r WHERE r.consumer_id = c.id AND r.device_id = $1))
        ORDER BY 2`,
      [device.id, device.pemilikConsumerId],
    );
    const owner = device.pemilikConsumerId === consumer.id;
    return {
      ...empty,
      peran: owner ? "pemilik" : "pemakai",
      nomor: toBrowserDevice(device, (held ?? (await heldDevices(db))).get(device.id)),
      jenis: await allowedJenis(db, consumer.id, device),
      antrean: { antre: Number(counts.rows[0]?.antre ?? 0), gagal_hari_ini: Number(counts.rows[0]?.gagal ?? 0) },
      dipakai_juga_oleh: names.rows.filter((row) => row.id !== consumer.id && row.id !== device.pemilikConsumerId).map((row) => row.nama),
      pemilik_nomor: owner ? null : names.rows.find((row) => row.id === device.pemilikConsumerId)?.nama ?? device.pemilik,
    };
  }
}

/**
 * A module may name its own webhook (§5) only on the fixed Kirim webhook path, so a leaked machine
 * secret cannot point signed posts at another loopback service. Operators keep the wider D-4 rule.
 */
export function isSelfRegisteredWebhookUrl(url: string): boolean {
  return isAllowedWebhookUrl(url) && /^(\/api)?\/internal\/kirim\/webhook$/.test(new URL(url).pathname) && !new URL(url).search;
}

/** The consumer already linked to this application (by key, or by its machine client); never creates one. */
async function findLinkedConsumer(db: Queryable, application: RegistryApplication): Promise<ConsumerRow | null> {
  const result = await db.query<{ id: string }>(
    "SELECT id FROM kirim_consumers WHERE application_key = $1 OR (application_key IS NULL AND client_id = $2) ORDER BY application_key NULLS LAST LIMIT 1",
    [application.applicationKey, application.machineClientId],
  );
  return result.rows[0] ? findConsumerById(db, result.rows[0].id) : null;
}

async function allowedJenis(db: Queryable, consumerId: string, device: DeviceRow): Promise<Jenis[]> {
  const routes = await db.query<{ jenis: Jenis }>("SELECT jenis FROM kirim_routes WHERE consumer_id = $1 AND device_id = $2", [consumerId, device.id]);
  const jenis = new Set(routes.rows.map((row) => row.jenis));
  if (device.pemilikConsumerId === consumerId) jenis.add("notifikasi");
  return (["notifikasi", "kode"] as const).filter((item) => jenis.has(item));
}
