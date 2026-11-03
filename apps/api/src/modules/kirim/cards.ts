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
  listWhatsAppApplications,
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
    for (const application of applications) cards.push(await this.card(this.pool, application));
    return { modules: cards, ...(await this.admin.listDevices()) };
  }

  /** "Sambungkan nomor baru": the number's code, label, provider and tenant are chosen here. */
  async connectNewNumber(actor: AdminActor, applicationKey: string) {
    return this.change(applicationKey, async (client, application, consumer) => {
      if (consumer.nomorDeviceId) throw new KirimApiError(409, "kartu_sudah_tersambung", "Modul ini sudah tersambung. Putuskan dulu sebelum memakai nomor lain.");
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
        metadata: { device: kode, provider },
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
    if (!isAllowedWebhookUrl(url)) {
      throw new KirimApiError(422, "webhook_url_invalid", "Alamat webhook harus http://127.0.0.1:<port>/… atau https://<host>.sabilulquran.or.id/….");
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

  private async card(db: Queryable, application: RegistryApplication): Promise<ModuleCard> {
    const consumer = await findLinkedConsumer(db, application);
    const device = consumer?.nomorDeviceId ? await findDeviceById(db, consumer.nomorDeviceId) : null;
    const empty: ModuleCard = {
      application_key: application.applicationKey, nama: application.name, peran: "kosong", nomor: null, jenis: [],
      antrean: { antre: 0, gagal_hari_ini: 0 }, dipakai_juga_oleh: [], pemilik_nomor: null,
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
         FROM kirim_consumers c LEFT JOIN applications a ON a.application_key = c.application_key
        WHERE c.aktif AND (c.id = $2 OR c.nomor_device_id = $1 OR EXISTS (SELECT 1 FROM kirim_routes r WHERE r.consumer_id = c.id AND r.device_id = $1))
        ORDER BY 2`,
      [device.id, device.pemilikConsumerId],
    );
    const owner = device.pemilikConsumerId === consumer.id;
    return {
      ...empty,
      peran: owner ? "pemilik" : "pemakai",
      nomor: toBrowserDevice(device),
      jenis: await allowedJenis(db, consumer.id, device),
      antrean: { antre: Number(counts.rows[0]?.antre ?? 0), gagal_hari_ini: Number(counts.rows[0]?.gagal ?? 0) },
      dipakai_juga_oleh: names.rows.filter((row) => row.id !== consumer.id && row.id !== device.pemilikConsumerId).map((row) => row.nama),
      pemilik_nomor: owner ? null : names.rows.find((row) => row.id === device.pemilikConsumerId)?.nama ?? device.pemilik,
    };
  }
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
