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
/**
 * A photo asked for but never fetched (an old or imported chat outside the 30-day refresh) is fetched at once, at most
 * this many per minute over all numbers, so a long contact list never bursts the engine (owner 2026-11-06).
 */
const ON_DEMAND_PER_MINUTE = 60;
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

  private onDemand = { windowStart: 0, count: 0 };
  private readonly inFlight = new Map<string, Promise<void>>();

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

  /** One subject's photo now (see ON_DEMAND_PER_MINUTE); false when it was not tried (limit, engine down, no route). */
  private async fetchNow(kind: "conversation" | "group", id: string): Promise<boolean> {
    if (!this.provider) return false;
    const running = this.inFlight.get(id);
    if (running) {
      await running;
      return true;
    }
    const now = Date.now();
    if (now - this.onDemand.windowStart >= 60_000) this.onDemand = { windowStart: now, count: 0 };
    if (this.onDemand.count >= ON_DEMAND_PER_MINUTE) return false;
    this.onDemand.count += 1;
    const job = (async () => {
      const found = await this.subjectFor(kind, id);
      if (!found) return;
      let data: Buffer | null;
      try {
        data = await this.provider!.profilePicture(found.device, found.subject.jid);
      } catch (error) {
        const code = error instanceof ProviderOperationError ? error.code : "error";
        if (code !== "engine_rejected") return; // engine down: asked again next time
        data = null;
      }
      if (data && !data.subarray(0, 3).equals(JPEG_MAGIC)) data = null;
      await this.store(found.device.id, found.subject, data);
    })();
    this.inFlight.set(id, job);
    try {
      await job;
      return true;
    } catch {
      return false;
    } finally {
      this.inFlight.delete(id);
    }
  }

  /** The engine number and the JID to ask for one conversation or group, like the refresh builds them. */
  private async subjectFor(kind: "conversation" | "group", id: string): Promise<{ device: EngineDevice; subject: Subject } | null> {
    const table = kind === "conversation" ? "kirim_conversations" : "kirim_groups";
    const columns = kind === "conversation" ? `t.kontak_enc AS "a", t.kontak_alt_enc AS "b"` : `t.group_jid_enc AS "a", NULL AS "b"`;
    const result = await this.pool.query<{ a: string; b: string | null; deviceId: string; kode: string; providerRef: string | null; status: string; provider: string }>(
      `SELECT ${columns}, d.id AS "deviceId", d.kode, d.provider_ref AS "providerRef", d.status, d.provider
         FROM ${table} t JOIN kirim_devices d ON d.id = t.device_id WHERE t.id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row || row.provider !== "jalurpesan" || row.status !== "tersambung" || !row.providerRef) return null;
    const device = { id: row.deviceId, kode: row.kode, providerRef: row.providerRef, status: row.status } as EngineDevice;
    if (kind === "group") {
      return { device, subject: { kind: "group", id, jid: this.crypto.open(row.a, columnAad("kirim_groups", "group_jid_enc", id)) } };
    }
    const own = this.crypto.open(row.a, columnAad("kirim_conversations", "kontak_enc", id));
    const alt = row.b ? this.crypto.open(row.b, columnAad("kirim_conversations", "kontak_alt_enc", id)) : null;
    const jid = jidFromCanonical(own.startsWith("pn:") ? own : alt?.startsWith("pn:") ? alt : own);
    return jid ? { device, subject: { kind: "conversation", id, jid } } : null;
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
      ? await this.conversations.ownedConversation(this.pool, consumer, id, false, true)
      : await this.conversations.ownedGroup(this.pool, consumer, id);
    const column = kind === "conversation" ? "conversation_id" : "group_id";
    const select = () => this.pool.query<{ fileId: string | null; path: string | null; sha256: string | null; tersedia: boolean }>(
      `SELECT file_id AS "fileId", path, sha256, tersedia FROM kirim_profile_photos WHERE ${column} = $1`,
      [owned.id],
    );
    let row = await select();
    // Never fetched: an old chat the 30-day refresh does not reach. Fetched now, once; "none" is remembered for a week.
    if (!row.rows[0] && (await this.fetchNow(kind, owned.id))) row = await select();
    const photo = row.rows[0]?.tersedia ? row.rows[0] : undefined;
    if (!photo?.fileId || !photo.path || !photo.sha256) throw new KirimApiError(404, "foto_tidak_ada", "Foto profil tidak tersedia.");
    return { data: await this.service.readProfilePhoto(photo.fileId, photo.path), etag: `"${photo.sha256.slice(0, 32)}"` };
  }
}
