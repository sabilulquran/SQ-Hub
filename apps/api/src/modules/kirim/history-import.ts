import { createHash, randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { z } from "zod";

import { columnAad, InvalidNumberError, normalizePhone, phoneCanonical, type KirimCrypto } from "./crypto.js";
import { contactFromJid } from "./ingest.js";
import type { KirimLog } from "./providers/log.js";
import { ProviderOperationError, recipientJid, type KirimProvider, type ProviderHistoryMessage, type ProviderName } from "./providers/types.js";
import { ensureConversation, findDevice, findDeviceById, withTransaction, writeAudit, type DeviceRow, type Queryable } from "./repository.js";
import { KirimApiError, type KirimService } from "./service.js";

/**
 * KIRIM-IMPL-002 §10: moving old chat history into Kirim SQ, run by `kirim_admin`. Imported
 * messages are marked `diimpor` and never raise events, auto replies, unread counts or the
 * 24-hour reply window.
 */

export const EXPORT_MAX_BYTES = 10 * 1024 * 1024;
const PREVIEW_LINES = 20;
/** §10.1: ask every 10 seconds, give up after 10 minutes. */
const POLL_INTERVAL_MS = 10_000;
const WAIT_LIMIT_MS = 10 * 60_000;

export const deviceImportSchema = z.object({ jumlah_per_percakapan: z.number().int().min(1).max(500).default(200) }).strict();
export const exportPreviewSchema = z.object({ nomor: z.string().trim().min(1).max(40), teks: z.string().min(1).max(EXPORT_MAX_BYTES) }).strict();
export const exportImportSchema = exportPreviewSchema.extend({ nama_yayasan: z.string().trim().min(1).max(200) }).strict();

// ----------------------------------------------------------------------------- export parser

export interface ExportedMessage {
  at: Date;
  nama: string;
  isi: string;
}

export interface ParsedExport {
  messages: ExportedMessage[];
  /** System lines, deleted messages and media placeholders, which are not imported. */
  dilewati: number;
}

/**
 * One line of a WhatsApp "Export chat" text file, Android or iPhone, Indonesian or English:
 *   19/10/26 09.12 - Nama: isi            (Android, id)
 *   10/19/26, 9:12 AM - Name: text        (Android, en)
 *   [19/10/26 09.12.33] Nama: isi         (iPhone)
 */
const LINE = /^\[?(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4}),?\s+(\d{1,2})[.:](\d{2})(?:[.:](\d{2}))?\s*([AaPp]\.?[Mm]\.?)?\]?\s*(?:-\s+)?(.*)$/;
const SKIPPED_BODIES = [
  /^<Media tidak disertakan>$/i,
  /^<Media omitted>$/i,
  /^Pesan ini telah dihapus\.?$/i,
  /^This message was deleted\.?$/i,
  /^Anda menghapus pesan ini\.?$/i,
  /^You deleted this message\.?$/i,
  /^(?:gambar|image|video|audio|stiker|sticker|GIF|dokumen|document) (?:tidak disertakan|omitted)$/i,
];

/** Export times are the phone's local time; the yayasan's phones are on WIB. */
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

export function parseWhatsAppExport(text: string): ParsedExport {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.replace(/[\u200e\u200f\u202a-\u202e]/g, "").replace(/[\u202f\u00a0]/g, " "));
  const raw: Array<{ a: number; b: number; year: number; hour: number; minute: number; second: number; rest: string } | { continuation: string }> = [];
  let dayFirstVotes = 0;
  let monthFirstVotes = 0;
  for (const line of lines) {
    const match = LINE.exec(line);
    if (!match) {
      raw.push({ continuation: line });
      continue;
    }
    const a = Number(match[1]);
    const b = Number(match[2]);
    if (a > 12) dayFirstVotes += 1;
    if (b > 12) monthFirstVotes += 1;
    let hour = Number(match[4]);
    const meridiem = match[7]?.toLowerCase().replace(/\./g, "");
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    const yearRaw = Number(match[3]);
    raw.push({ a, b, year: yearRaw < 100 ? 2000 + yearRaw : yearRaw, hour, minute: Number(match[5]), second: Number(match[6] ?? 0), rest: match[8] ?? "" });
  }
  // Indonesian phones write day first; only a month-first export (e.g. an English phone) says otherwise.
  const dayFirst = dayFirstVotes > 0 || monthFirstVotes === 0;
  const messages: ExportedMessage[] = [];
  let dilewati = 0;
  let current: ExportedMessage | null = null;
  const flush = () => {
    if (!current) return;
    const isi = current.isi.trim();
    if (!isi || SKIPPED_BODIES.some((pattern) => pattern.test(isi))) dilewati += 1;
    else messages.push({ ...current, isi });
    current = null;
  };
  for (const entry of raw) {
    if ("continuation" in entry) {
      if (current) current.isi += `\n${entry.continuation}`;
      continue;
    }
    flush();
    const day = dayFirst ? entry.a : entry.b;
    const month = dayFirst ? entry.b : entry.a;
    const colon = entry.rest.indexOf(": ");
    const at = new Date(Date.UTC(entry.year, month - 1, day, entry.hour, entry.minute, entry.second) - WIB_OFFSET_MS);
    if (colon <= 0 || Number.isNaN(at.getTime()) || month < 1 || month > 12 || day < 1 || day > 31) {
      // "Pesan dan panggilan terenkripsi end-to-end …", "X bergabung …": no sender, not a message.
      dilewati += 1;
      continue;
    }
    current = { at, nama: entry.rest.slice(0, colon).trim().slice(0, 200), isi: entry.rest.slice(colon + 2) };
  }
  flush();
  return { messages, dilewati };
}

// -------------------------------------------------------------------------------- service

interface ImportActor {
  ref: string;
}

export class KirimHistoryImport {
  private running: Promise<void> | null = null;

  constructor(
    private readonly pool: Pool,
    private readonly crypto: KirimCrypto,
    private readonly service: KirimService,
    private readonly providers: Record<ProviderName, KirimProvider | undefined>,
    private readonly options: { enabled: boolean; inboundMediaMaxBytes: number; log?: KirimLog; now?: () => number },
  ) {}

  get deviceImportEnabled(): boolean {
    return this.options.enabled;
  }

  async list(kode: string) {
    const device = await this.requireDevice(kode);
    const rows = await this.pool.query<{
      id: string;
      jalur: string;
      status: string;
      jumlahDimasukkan: number;
      jumlahGanda: number;
      jumlahDilewati: number;
      galat: string | null;
      createdAt: Date;
      selesaiAt: Date | null;
    }>(
      `SELECT id, jalur, status, jumlah_dimasukkan AS "jumlahDimasukkan", jumlah_ganda AS "jumlahGanda", jumlah_dilewati AS "jumlahDilewati",
              galat, created_at AS "createdAt", selesai_at AS "selesaiAt"
       FROM kirim_history_imports WHERE device_id = $1 ORDER BY created_at DESC LIMIT 500`,
      [device.id],
    );
    const ringkasan = { antre: 0, berjalan: 0, selesai: 0, gagal: 0, dimasukkan: 0, ganda: 0, dilewati: 0 };
    for (const row of rows.rows) {
      if (row.status === "antre") ringkasan.antre += 1;
      else if (row.status === "selesai") ringkasan.selesai += 1;
      else if (row.status === "gagal") ringkasan.gagal += 1;
      else ringkasan.berjalan += 1;
      ringkasan.dimasukkan += row.jumlahDimasukkan;
      ringkasan.ganda += row.jumlahGanda;
      ringkasan.dilewati += row.jumlahDilewati;
    }
    return {
      impor_perangkat_tersedia: this.options.enabled && device.provider === "jalurpesan",
      ringkasan,
      impor: rows.rows.map((row) => ({
        id: row.id,
        jalur: row.jalur,
        status: row.status,
        dimasukkan: row.jumlahDimasukkan,
        ganda: row.jumlahGanda,
        dilewati: row.jumlahDilewati,
        galat: row.galat,
        dibuat: row.createdAt.toISOString(),
        selesai: row.selesaiAt?.toISOString() ?? null,
      })),
    };
  }

  /** §10.1 step 2: one queued row per known private conversation of the number. */
  async startDeviceImport(actor: ImportActor, kode: string, input: z.infer<typeof deviceImportSchema>) {
    const device = await this.requireDevice(kode);
    if (!this.options.enabled || device.provider !== "jalurpesan") {
      throw new KirimApiError(409, "history_import_unavailable", "Impor dari WhatsApp belum tersedia di mesin nomor ini.");
    }
    return withTransaction(this.pool, async (client) => {
      const busy = await client.query(
        "SELECT 1 FROM kirim_history_imports WHERE device_id = $1 AND jalur = 'perangkat' AND status IN ('antre', 'menunggu_mesin', 'memasukkan') LIMIT 1",
        [device.id],
      );
      if ((busy.rowCount ?? 0) > 0) throw new KirimApiError(409, "history_import_running", "Impor untuk nomor ini masih berjalan.");
      const inserted = await client.query(
        `INSERT INTO kirim_history_imports (id, device_id, conversation_id, jalur, diminta_oleh, jumlah_diminta)
         SELECT gen_random_uuid(), $1, c.id, 'perangkat', $2, $3 FROM kirim_conversations c WHERE c.device_id = $1`,
        [device.id, actor.ref, input.jumlah_per_percakapan],
      );
      await writeAudit(client, {
        actorKind: "human",
        actorRef: actor.ref,
        aksi: "riwayat.impor_perangkat",
        objekJenis: "device",
        objekRef: device.kode,
        metadata: { percakapan: inserted.rowCount ?? 0, jumlah_per_percakapan: input.jumlah_per_percakapan },
      });
      return { percakapan: inserted.rowCount ?? 0 };
    });
  }

  /** Timer in module.ts: one conversation at a time across all numbers (the engine allows one per number). */
  runOnce(): Promise<void> {
    if (!this.options.enabled) return Promise.resolve();
    if (this.running) return this.running;
    this.running = this.step().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async step(): Promise<void> {
    const next = await this.pool.query<{ id: string; deviceId: string; conversationId: string; status: string; providerImportId: string | null; jumlahDiminta: number; updatedAt: Date }>(
      `SELECT id, device_id AS "deviceId", conversation_id AS "conversationId", status, provider_import_id AS "providerImportId",
              jumlah_diminta AS "jumlahDiminta", updated_at AS "updatedAt"
       FROM kirim_history_imports WHERE jalur = 'perangkat' AND status IN ('antre', 'menunggu_mesin')
       ORDER BY (status = 'menunggu_mesin') DESC, created_at LIMIT 1`,
    );
    const row = next.rows[0];
    if (!row) return;
    const device = (await findDeviceById(this.pool, row.deviceId))!;
    const provider = this.providers[device.provider];
    if (!provider) return this.fail(row.id, "Mesin nomor ini tidak dikonfigurasi.");
    try {
      if (row.status === "antre") {
        const contact = await this.contactOf(row.conversationId);
        if (!contact) return this.fail(row.id, "Percakapan tanpa alamat WhatsApp.");
        const { importId } = await provider.requestHistory(device, recipientJid(contact), row.jumlahDiminta);
        await this.pool.query(
          "UPDATE kirim_history_imports SET status = 'menunggu_mesin', provider_import_id = $2, updated_at = now() WHERE id = $1",
          [row.id, importId],
        );
        return;
      }
      if (this.now() - row.updatedAt.getTime() < POLL_INTERVAL_MS) return;
      const status = await provider.historyStatus(device, row.providerImportId!);
      if (status.status === "awaiting") {
        const started = await this.pool.query<{ createdAt: Date }>(`SELECT created_at AS "createdAt" FROM kirim_history_imports WHERE id = $1`, [row.id]);
        if (this.now() - started.rows[0]!.createdAt.getTime() > WAIT_LIMIT_MS) return this.fail(row.id, "WhatsApp tidak mengirim riwayat.");
        await this.pool.query("UPDATE kirim_history_imports SET updated_at = now() WHERE id = $1", [row.id]);
        return;
      }
      if (status.status === "failed") return this.fail(row.id, status.reason);
      await this.pool.query("UPDATE kirim_history_imports SET status = 'memasukkan', updated_at = now() WHERE id = $1", [row.id]);
      const counts = { dimasukkan: 0, ganda: 0, dilewati: 0 };
      for (let page = 1; page <= 20; page += 1) {
        const result = await provider.historyMessages(device, row.providerImportId!, page);
        for (const message of result.messages) {
          const outcome = await this.insertEngineMessage(device, row.conversationId, message);
          counts[outcome] += 1;
        }
        if (!result.hasMore) break;
      }
      await this.pool.query(
        `UPDATE kirim_history_imports SET status = 'selesai', jumlah_dimasukkan = $2, jumlah_ganda = $3, jumlah_dilewati = $4,
           selesai_at = now(), updated_at = now() WHERE id = $1`,
        [row.id, counts.dimasukkan, counts.ganda, counts.dilewati],
      );
    } catch (error) {
      const code = error instanceof ProviderOperationError ? error.code : "error";
      this.options.log?.({ event: "kirim.history.failed", device: device.kode, code }, "kirim history import step failed");
      if (code === "engine_unavailable") return; // tried again next round
      await this.fail(row.id, code === "engine_rejected" ? "Mesin menolak permintaan riwayat." : "Impor gagal.");
    }
  }

  private async insertEngineMessage(device: DeviceRow, conversationId: string, message: ProviderHistoryMessage): Promise<"dimasukkan" | "ganda" | "dilewati"> {
    const known = await this.pool.query("SELECT 1 FROM kirim_messages WHERE conversation_id = $1 AND wa_message_id = $2 LIMIT 1", [conversationId, message.whatsappMessageId]);
    if ((known.rowCount ?? 0) > 0) return "ganda";
    if (!message.body && !message.media) return "dilewati";
    let mediaData: Buffer | null = null;
    let tidakDisalin: "terlalu_besar" | "disk_rendah" | "gagal_unduh" | null = null;
    if (message.media) {
      if (message.media.sizeBytes > this.options.inboundMediaMaxBytes) tidakDisalin = "terlalu_besar";
      else if (await this.service.lowDisk()) tidakDisalin = "disk_rendah";
      else {
        try {
          mediaData = await this.providers[device.provider]!.downloadMedia(device, message.media.id, this.options.inboundMediaMaxBytes);
          if (!mediaData) tidakDisalin = "terlalu_besar";
        } catch {
          tidakDisalin = "gagal_unduh";
        }
      }
    }
    await withTransaction(this.pool, async (client) => {
      let mediaId: string | null = null;
      if (message.media) {
        mediaId = randomUUID();
        const path = mediaData ? await this.service.writeMediaFile(mediaId, mediaData, new Date(message.occurredAt)) : null;
        await client.query(
          `INSERT INTO kirim_media (id, device_id, arah, mime, ukuran, sha256, path, dienkripsi, tidak_disalin, provider_media_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            mediaId,
            device.id,
            message.direction === "inbound" ? "masuk" : "keluar",
            message.media.mimeType,
            mediaData?.length ?? message.media.sizeBytes,
            mediaData ? createHash("sha256").update(mediaData).digest("hex") : message.media.sha256,
            path,
            path !== null,
            path ? null : tidakDisalin ?? "gagal_unduh",
            message.media.id,
          ],
        );
      }
      await this.insertImported(client, device, conversationId, {
        arah: message.direction === "inbound" ? "masuk" : "keluar",
        at: new Date(message.occurredAt),
        tipe: TIPE_BY_ENGINE[message.messageType] ?? "lainnya",
        isi: message.body,
        mediaId,
        waMessageId: message.whatsappMessageId,
      });
    });
    return "dimasukkan";
  }

  // -------------------------------------------------------------------------- export files

  /** §10.2 step 4: the names in the file and its first 20 messages, so the admin can pick the yayasan's name. */
  async previewExport(kode: string, input: z.infer<typeof exportPreviewSchema>) {
    await this.requireDevice(kode);
    this.normalize(input.nomor);
    const parsed = parseWhatsAppExport(input.teks);
    const names = new Map<string, number>();
    for (const message of parsed.messages) names.set(message.nama, (names.get(message.nama) ?? 0) + 1);
    return {
      pesan: parsed.messages.length,
      dilewati: parsed.dilewati,
      nama: [...names.entries()].map(([nama, jumlah]) => ({ nama, jumlah })).sort((a, b) => b.jumlah - a.jumlah),
      pratinjau: parsed.messages.slice(0, PREVIEW_LINES).map((message) => ({ waktu: message.at.toISOString(), nama: message.nama, isi: message.isi.slice(0, 500) })),
    };
  }

  /** §10.2: insert an export file's messages into the conversation with the typed number. */
  async importExport(actor: ImportActor, kode: string, input: z.infer<typeof exportImportSchema>) {
    const device = await this.requireDevice(kode);
    const canonical = phoneCanonical(this.normalize(input.nomor));
    const parsed = parseWhatsAppExport(input.teks);
    if (parsed.messages.length === 0) throw new KirimApiError(422, "export_empty", "Tidak ada pesan yang bisa dibaca dari berkas ini.");
    if (!parsed.messages.some((message) => message.nama === input.nama_yayasan)) {
      throw new KirimApiError(422, "export_name_unknown", "Nama nomor yayasan tidak ada di berkas ini.");
    }
    return withTransaction(this.pool, async (client) => {
      const hmac = this.crypto.lookup(canonical);
      const existing = await client.query<{ id: string }>(
        "SELECT id FROM kirim_conversations WHERE device_id = $1 AND (kontak_hmac = $2 OR kontak_alt_hmac = $2) ORDER BY (kontak_hmac = $2) DESC LIMIT 1",
        [device.id, hmac],
      );
      const conversationId = existing.rows[0]?.id ?? (await ensureConversation(client, this.crypto, { deviceId: device.id, canonical, jenis: "pn" }));
      const seen = await this.existingKeys(client, conversationId);
      let dimasukkan = 0;
      let ganda = 0;
      for (const message of parsed.messages) {
        const arah = message.nama === input.nama_yayasan ? "keluar" : "masuk";
        const key = exportKey(message.at, arah, message.isi);
        if (seen.has(key)) {
          ganda += 1;
          continue;
        }
        seen.add(key);
        await this.insertImported(client, device, conversationId, { arah, at: message.at, tipe: "teks", isi: message.isi, mediaId: null, waMessageId: null });
        dimasukkan += 1;
      }
      await client.query(
        `INSERT INTO kirim_history_imports (id, device_id, conversation_id, jalur, status, diminta_oleh, jumlah_dimasukkan, jumlah_ganda, jumlah_dilewati, selesai_at)
         VALUES ($1, $2, $3, 'ekspor', 'selesai', $4, $5, $6, $7, now())`,
        [randomUUID(), device.id, conversationId, actor.ref, dimasukkan, ganda, parsed.dilewati],
      );
      await writeAudit(client, {
        actorKind: "human",
        actorRef: actor.ref,
        aksi: "riwayat.impor_ekspor",
        objekJenis: "percakapan",
        objekRef: conversationId,
        metadata: { device: device.kode, dimasukkan, ganda, dilewati: parsed.dilewati },
      });
      return { conversation_id: conversationId, dimasukkan, ganda, dilewati: parsed.dilewati };
    });
  }

  // ---------------------------------------------------------------------------- internals

  /** Keys of messages already in the conversation, for the export duplicate check (§10.2 step 5). */
  private async existingKeys(client: Queryable, conversationId: string): Promise<Set<string>> {
    const rows = await client.query<{ id: string; arah: "masuk" | "keluar"; at: Date; bodyEnc: string | null }>(
      `SELECT id, arah, coalesce(provider_at, created_at) AS at, body_enc AS "bodyEnc" FROM kirim_messages WHERE conversation_id = $1 AND body_enc IS NOT NULL`,
      [conversationId],
    );
    return new Set(rows.rows.map((row) => exportKey(row.at, row.arah, this.crypto.open(row.bodyEnc!, columnAad("kirim_messages", "body_enc", row.id)))));
  }

  private async insertImported(
    client: Queryable,
    device: Pick<DeviceRow, "id" | "provider">,
    conversationId: string,
    message: { arah: "masuk" | "keluar"; at: Date; tipe: string; isi: string | null; mediaId: string | null; waMessageId: string | null },
  ): Promise<void> {
    const id = randomUUID();
    // Imported outbound messages were typed on the phone; inbound ones simply arrived.
    await client.query(
      `INSERT INTO kirim_messages (id, conversation_id, device_id, arah, asal, tipe, body_enc, media_id, provider, wa_message_id, status,
                                   diimpor, created_at, provider_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, $12, $12, now())`,
      [
        id,
        conversationId,
        device.id,
        message.arah,
        message.arah === "keluar" ? "hp" : null,
        message.tipe,
        message.isi ? this.crypto.seal(message.isi, columnAad("kirim_messages", "body_enc", id)) : null,
        message.mediaId,
        device.provider,
        message.waMessageId,
        message.arah === "keluar" ? "terkirim" : "diterima",
        message.at,
      ],
    );
    await client.query("UPDATE kirim_conversations SET pesan_terakhir_at = greatest(coalesce(pesan_terakhir_at, $2), $2) WHERE id = $1", [conversationId, message.at]);
  }

  private async contactOf(conversationId: string) {
    const row = await this.pool.query<{ kontakEnc: string }>(`SELECT kontak_enc AS "kontakEnc" FROM kirim_conversations WHERE id = $1`, [conversationId]);
    const enc = row.rows[0]?.kontakEnc;
    if (!enc) return null;
    const value = this.crypto.open(enc, columnAad("kirim_conversations", "kontak_enc", conversationId));
    if (value.startsWith("pn:+")) return { phoneDigits: value.slice(4) };
    if (value.startsWith("lid:") && contactFromJid(value.slice(4))) return { jid: value.slice(4) };
    return null;
  }

  private async fail(id: string, galat: string): Promise<void> {
    await this.pool.query(
      "UPDATE kirim_history_imports SET status = 'gagal', galat = $2, selesai_at = now(), updated_at = now() WHERE id = $1",
      [id, galat.slice(0, 200)],
    );
  }

  private normalize(value: string): string {
    try {
      return normalizePhone(value);
    } catch (error) {
      if (error instanceof InvalidNumberError) throw new KirimApiError(422, "invalid_number", "Nomor tidak sah.");
      throw error;
    }
  }

  private async requireDevice(kode: string): Promise<DeviceRow> {
    const device = await findDevice(this.pool, kode);
    if (!device) throw new KirimApiError(404, "device_unknown", "Nomor tidak dikenal.");
    return device;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}

const TIPE_BY_ENGINE: Record<string, string> = { text: "teks", document: "dokumen", image: "gambar", audio: "audio", video: "video", sticker: "stiker" };

/** Same minute, same direction, same text (§10.2 step 5). */
function exportKey(at: Date, arah: string, isi: string): string {
  const minute = Math.floor(at.getTime() / 60_000);
  return `${minute}|${arah}|${createHash("sha256").update(isi.trim()).digest("hex")}`;
}
