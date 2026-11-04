import { createHash, randomUUID } from "node:crypto";

import type { Pool } from "pg";

import type { KirimConversations } from "./conversations.js";
import { columnAad, type KirimCrypto } from "./crypto.js";
import { KirimApiError } from "./errors.js";
import { jidFromCanonical } from "./message-refs.js";
import type { KirimLog } from "./providers/log.js";
import { ProviderOperationError, type DeviceRef, type KirimProvider } from "./providers/types.js";
import { withTransaction, type ConsumerRow } from "./repository.js";
import type { KirimService } from "./service.js";

/**
 * KIRIM-IMPL-004 §8 / SPMB-IMPL-005 §17.2: the small WhatsApp profile photo of each conversation and group,
 * fetched at most once per 7 days, kept as an encrypted file, and removed when WhatsApp stops showing it.
 * Only chats with activity in the last 30 days are refreshed, a few per number per round, so the engine
 * and Mi8 see a trickle rather than a burst.
 */

export const PHOTO_MAX_AGE_DAYS = 7;
const ACTIVE_WITHIN_DAYS = 30;
const PER_DEVICE_PER_ROUND = 25;
/** The module may cache the photo this long; the refresh interval is a week anyway. */
export const PHOTO_CACHE_SECONDS = 86_400;
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

type Subject = { kind: "conversation"; id: string; jid: string } | { kind: "group"; id: string; jid: string };

interface EngineDevice extends DeviceRef {
  status: string;
}

export class KirimProfilePhotos {
  constructor(
    private readonly pool: Pool,
    private readonly crypto: KirimCrypto,
    private readonly service: KirimService,
    private readonly conversations: KirimConversations,
    private readonly provider: KirimProvider | undefined,
    private readonly options: { log?: KirimLog } = {},
  ) {}

  /** Timer in module.ts. Errors are logged without contact data and retried next round. */
  async runOnce(): Promise<{ fetched: number }> {
    if (!this.provider) return { fetched: 0 };
    const devices = await this.pool.query<EngineDevice>(
      `SELECT id, kode, provider_ref AS "providerRef", status FROM kirim_devices
        WHERE provider = 'jalurpesan' AND status = 'tersambung' AND provider_ref IS NOT NULL ORDER BY kode`,
    );
    let fetched = 0;
    for (const device of devices.rows) fetched += await this.refreshDevice(device);
    return { fetched };
  }

  async refreshDevice(device: EngineDevice): Promise<number> {
    let fetched = 0;
    for (const subject of await this.due(device.id)) {
      let data: Buffer | null;
      try {
        data = await this.provider!.profilePicture(device, subject.jid);
      } catch (error) {
        const code = error instanceof ProviderOperationError ? error.code : "error";
        // A JID the engine refuses is recorded as "no photo" so it is not asked again for a week; anything
        // else (engine down, number not connected, engine without the route) stops this number's round.
        if (code === "engine_rejected") {
          await this.store(device.id, subject, null);
          continue;
        }
        this.options.log?.({ event: "kirim.photos.refresh_failed", device: device.kode, code }, "kirim profile photo refresh stopped for this round");
        break;
      }
      if (data && !data.subarray(0, 3).equals(JPEG_MAGIC)) data = null;
      await this.store(device.id, subject, data);
      fetched += 1;
    }
    return fetched;
  }

  /** Conversations and groups with recent activity whose photo is missing or older than 7 days. */
  private async due(deviceId: string): Promise<Subject[]> {
    const conversations = await this.pool.query<{ id: string; kontakEnc: string; kontakAltEnc: string | null }>(
      `SELECT c.id, c.kontak_enc AS "kontakEnc", c.kontak_alt_enc AS "kontakAltEnc"
         FROM kirim_conversations c LEFT JOIN kirim_profile_photos p ON p.conversation_id = c.id
        WHERE c.device_id = $1 AND coalesce(c.pesan_terakhir_at, c.created_at) > now() - interval '${ACTIVE_WITHIN_DAYS} days'
          AND (p.id IS NULL OR p.fetched_at < now() - interval '${PHOTO_MAX_AGE_DAYS} days')
        ORDER BY p.fetched_at NULLS FIRST, c.pesan_terakhir_at DESC NULLS LAST LIMIT ${PER_DEVICE_PER_ROUND}`,
      [deviceId],
    );
    const groups = await this.pool.query<{ id: string; jidEnc: string }>(
      `SELECT g.id, g.group_jid_enc AS "jidEnc"
         FROM kirim_groups g LEFT JOIN kirim_profile_photos p ON p.group_id = g.id
        WHERE g.device_id = $1 AND g.keluar_at IS NULL AND coalesce(g.pesan_terakhir_at, g.created_at) > now() - interval '${ACTIVE_WITHIN_DAYS} days'
          AND (p.id IS NULL OR p.fetched_at < now() - interval '${PHOTO_MAX_AGE_DAYS} days')
        ORDER BY p.fetched_at NULLS FIRST, g.pesan_terakhir_at DESC NULLS LAST LIMIT ${PER_DEVICE_PER_ROUND}`,
      [deviceId],
    );
    const subjects: Subject[] = [];
    for (const row of conversations.rows) {
      const own = this.crypto.open(row.kontakEnc, columnAad("kirim_conversations", "kontak_enc", row.id));
      const alt = row.kontakAltEnc ? this.crypto.open(row.kontakAltEnc, columnAad("kirim_conversations", "kontak_alt_enc", row.id)) : null;
      // The phone-number JID when known: it is what the photo privacy setting is checked against.
      const canonical = own.startsWith("pn:") ? own : alt?.startsWith("pn:") ? alt : own;
      const jid = jidFromCanonical(canonical);
      if (jid) subjects.push({ kind: "conversation", id: row.id, jid });
    }
    for (const row of groups.rows) {
      subjects.push({ kind: "group", id: row.id, jid: this.crypto.open(row.jidEnc, columnAad("kirim_groups", "group_jid_enc", row.id)) });
    }
    return subjects;
  }

  /** Keeps the new photo (or the absence of one), and removes the file it replaces after the commit. */
  async store(deviceId: string, subject: Subject, data: Buffer | null): Promise<void> {
    const column = subject.kind === "conversation" ? "conversation_id" : "group_id";
    const sha256 = data ? createHash("sha256").update(data).digest("hex") : null;
    const existing = await this.pool.query<{ sha256: string | null }>(`SELECT sha256 FROM kirim_profile_photos WHERE ${column} = $1`, [subject.id]);
    if (existing.rows[0] && existing.rows[0].sha256 === sha256) {
      await this.pool.query(`UPDATE kirim_profile_photos SET fetched_at = now() WHERE ${column} = $1`, [subject.id]);
      return;
    }
    const fileId = data ? randomUUID() : null;
    const path = data && fileId ? await this.service.writeProfilePhoto(fileId, data) : null;
    const replaced = await withTransaction(this.pool, async (client) => {
      const old = await client.query<{ path: string | null }>(`SELECT path FROM kirim_profile_photos WHERE ${column} = $1 FOR UPDATE`, [subject.id]);
      await client.query(
        `INSERT INTO kirim_profile_photos (id, device_id, ${column}, tersedia, file_id, path, sha256, ukuran, fetched_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
         ON CONFLICT (${column}) DO UPDATE SET tersedia = EXCLUDED.tersedia, file_id = EXCLUDED.file_id, path = EXCLUDED.path,
           sha256 = EXCLUDED.sha256, ukuran = EXCLUDED.ukuran, fetched_at = now()`,
        [randomUUID(), deviceId, subject.id, data !== null, fileId, path, sha256, data?.length ?? null],
      );
      return old.rows[0]?.path ?? null;
    });
    if (replaced) await this.service.removeProfilePhoto(replaced).catch(() => undefined);
  }

  /** §8: the photo for the module's own conversation or group, or 404 `foto_tidak_ada`. */
  async read(consumer: ConsumerRow, kind: "conversation" | "group", id: string): Promise<{ data: Buffer; etag: string }> {
    const owned = kind === "conversation"
      ? await this.conversations.ownedConversation(this.pool, consumer, id)
      : await this.conversations.ownedGroup(this.pool, consumer, id);
    const column = kind === "conversation" ? "conversation_id" : "group_id";
    const row = await this.pool.query<{ fileId: string | null; path: string | null; sha256: string | null }>(
      `SELECT file_id AS "fileId", path, sha256 FROM kirim_profile_photos WHERE ${column} = $1 AND tersedia`,
      [owned.id],
    );
    const photo = row.rows[0];
    if (!photo?.fileId || !photo.path || !photo.sha256) throw new KirimApiError(404, "foto_tidak_ada", "Foto profil tidak tersedia.");
    return { data: await this.service.readProfilePhoto(photo.fileId, photo.path), etag: `"${photo.sha256.slice(0, 32)}"` };
  }
}
