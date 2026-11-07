import type { Pool } from "pg";
import { z } from "zod";

import { atasNamaRef, atasNamaSchema, type AtasNama, type KirimConversations } from "./conversations.js";
import { KirimApiError } from "./errors.js";
import type { KirimIngest } from "./ingest.js";
import type { KirimLog } from "./providers/log.js";
import { ProviderOperationError, type KirimProvider, type ProviderBusinessHours, type ProviderName } from "./providers/types.js";
import { writeAudit, type ConsumerRow, type DeviceRow } from "./repository.js";

/**
 * KIRIM-IMPL-004 §11 (owner 2026-11-06): WhatsApp Business of the module's own number.
 *
 * - Balasan cepat: the quick replies of WhatsApp Business, both ways. What the phone sets is read from the engine; a
 *   module may add, change or remove them. Kirim keeps nothing of its own: the engine is the copy.
 * - Katalog: read only. It is managed in WhatsApp Business; a product is sent as its `wa.me/p/<id>/<number>` link,
 *   which WhatsApp shows as the product card.
 */

export const quickReplySchema = z
  .object({ shortcut: z.string().trim().min(1).max(26), pesan: z.string().trim().min(1).max(4096), atas_nama: atasNamaSchema })
  .strict();
export const quickReplyRemoveSchema = z.object({ atas_nama: atasNamaSchema }).strict();
export const catalogQuerySchema = z.object({ setelah: z.string().max(500).optional() }).strict();

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Minutes from midnight; "24:00" is the midnight after. */
function minutes(value: string): number {
  return value === "24:00" ? 1440 : Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}

/**
 * A real IANA zone written as its canonical name: Intl also accepts "asia/jakarta" and aliases such as "EST", which
 * WhatsApp would then show or keep as written.
 */
function canonicalTimeZone(zone: string): boolean {
  try {
    return new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions().timeZone === zone;
  } catch {
    return false;
  }
}

/** Label names compare without case or repeated spaces, as the engine does. */
function labelKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** KIRIM-IMPL-004 §17.1: ISO days (1 = Senin … 7 = Minggu), each with its open ranges; a day left out is closed. */
export const businessHoursSchema = z
  .object({
    atas_nama: atasNamaSchema,
    zona: z.string().trim().min(3).max(64).regex(/^[A-Za-z][A-Za-z0-9_+\-/]+$/).refine(canonicalTimeZone, "zona tidak dikenal"),
    hari: z
      .array(
        z
          .object({
            hari: z.number().int().min(1).max(7),
            rentang: z
              .array(
                z
                  .object({ buka: z.string().regex(HHMM), tutup: z.string().refine((v) => v === "24:00" || HHMM.test(v), "jam HH:MM") })
                  .strict()
                  .refine((r) => minutes(r.buka) < minutes(r.tutup), { message: "buka harus sebelum tutup", path: ["tutup"] }),
              )
              .min(1)
              .max(6)
              .refine((ranges) => {
                const sorted = [...ranges].sort((a, b) => minutes(a.buka) - minutes(b.buka));
                return sorted.every((r, i) => i === 0 || minutes(sorted[i - 1]!.tutup) <= minutes(r.buka));
              }, "rentang tumpang tindih"),
          })
          .strict(),
      )
      .min(1)
      .max(7)
      .refine((days) => new Set(days.map((d) => d.hari)).size === days.length, "hari ganda"),
  })
  .strict();

const labelName = z
  .string()
  .trim()
  .min(1)
  .max(25)
  .refine((name) => ![...name].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f), "tanpa karakter kendali");
/** KIRIM-IMPL-004 §17.2: every label the module manages, and the subset this chat carries; names compare without case. */
export const chatLabelSchema = z
  .object({
    atas_nama: atasNamaSchema,
    dikelola: z.array(labelName).min(1).max(50),
    label: z.array(labelName).max(50),
  })
  .strict()
  .superRefine((input, ctx) => {
    const key = labelKey;
    const managed = input.dikelola.map(key);
    if (new Set(managed).size !== managed.length) ctx.addIssue({ code: "custom", path: ["dikelola"], message: "nama ganda" });
    const wanted = input.label.map(key);
    if (new Set(wanted).size !== wanted.length) ctx.addIssue({ code: "custom", path: ["label"], message: "nama ganda" });
    if (wanted.some((name) => !managed.includes(name))) ctx.addIssue({ code: "custom", path: ["label"], message: "label harus bagian dari dikelola" });
  });

const ISO_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/**
 * WhatsApp Business keeps one range per day: the day's ranges become first open → last close. A day from 00:00 to
 * 24:00 is "open 24 hours".
 */
export function engineBusinessHours(input: z.infer<typeof businessHoursSchema>): ProviderBusinessHours {
  return {
    timezone: input.zona,
    days: [...input.hari].sort((a, b) => a.hari - b.hari).map((day) => {
      const open = Math.min(...day.rentang.map((r) => minutes(r.buka)));
      const close = Math.max(...day.rentang.map((r) => minutes(r.tutup)));
      const name = ISO_DAYS[day.hari - 1]!;
      return open === 0 && close === 1440
        ? { day: name, mode: "open_24h" as const }
        : { day: name, mode: "specific_hours" as const, openMinutes: open, closeMinutes: close };
    }),
  };
}

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/** Product images come from WhatsApp's own CDN only. */
const IMAGE_HOSTS = /(^|\.)(whatsapp\.net|fbcdn\.net|fbsbx\.com)$/i;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export class KirimBusiness {
  /** Image URLs from the last catalog listing per product, so the image route never takes a URL from the caller. */
  private readonly imageUrls = new Map<string, { url: string; deviceId: string }>();

  constructor(
    private readonly pool: Pool,
    private readonly conversations: KirimConversations,
    private readonly providers: Record<ProviderName, KirimProvider | undefined>,
    private readonly ingest: KirimIngest | undefined,
    private readonly options: { log?: KirimLog; fetchImpl?: typeof fetch } = {},
  ) {}

  async quickReplies(consumer: ConsumerRow, kode: string) {
    const device = await this.engineDevice(consumer, kode);
    try {
      const items = await this.provider(device).listQuickReplies(device);
      return {
        items: items.map((q) => ({ wa_id: q.waId, shortcut: q.shortcut, pesan: q.message, dihapus: q.deleted, diubah_at: q.updatedAt })),
      };
    } catch (error) {
      throw engineError(error);
    }
  }

  /** `waId` "baru" makes a new one. */
  async saveQuickReply(consumer: ConsumerRow, kode: string, waId: string, input: z.infer<typeof quickReplySchema>) {
    const device = await this.engineDevice(consumer, kode);
    const shortcut = input.shortcut.replace(/^\//, "");
    if (!/^\S{1,25}$/.test(shortcut)) throw new KirimApiError(422, "shortcut_invalid", "Pintasan 1–25 karakter tanpa spasi.");
    if (waId !== "baru" && !/^[0-9A-Za-z._-]{1,64}$/.test(waId)) throw new KirimApiError(404, "not_found", "Balasan cepat tidak ditemukan.");
    let saved: string;
    try {
      saved = await this.provider(device).upsertQuickReply(device, waId === "baru" ? null : waId, shortcut, input.pesan);
    } catch (error) {
      throw engineError(error);
    }
    await this.audit(consumer, device, waId === "baru" ? "balasan_cepat.tambah" : "balasan_cepat.ubah", saved, input.atas_nama);
    return { wa_id: saved };
  }

  async removeQuickReply(consumer: ConsumerRow, kode: string, waId: string, atasNama: AtasNama) {
    const device = await this.engineDevice(consumer, kode);
    if (!/^[0-9A-Za-z._-]{1,64}$/.test(waId)) throw new KirimApiError(404, "not_found", "Balasan cepat tidak ditemukan.");
    try {
      await this.provider(device).removeQuickReply(device, waId);
    } catch (error) {
      throw engineError(error);
    }
    await this.audit(consumer, device, "balasan_cepat.hapus", waId, atasNama);
    return { ok: true };
  }

  /**
   * Has the engine read the phone's quick replies again: WhatsApp only sends changes, so those made before the engine
   * listened appear only after this. At most once per five minutes per number (`dibaca_ulang: false` when skipped).
   */
  async resyncQuickReplies(consumer: ConsumerRow, kode: string, atasNama: AtasNama) {
    const device = await this.engineDevice(consumer, kode);
    let done: boolean;
    try {
      done = await this.provider(device).resyncQuickReplies(device);
    } catch (error) {
      throw engineError(error);
    }
    if (done) await this.audit(consumer, device, "balasan_cepat.baca_ulang", "semua", atasNama);
    return { dibaca_ulang: done };
  }

  /**
   * KIRIM-IMPL-004 §17.1: the number's service hours on its WhatsApp Business profile, replaced whole. Audit `jam_kerja.ubah` with
   * the hours as sent to WhatsApp (no personal data in them).
   */
  async setBusinessHours(consumer: ConsumerRow, kode: string, input: z.infer<typeof businessHoursSchema>) {
    const device = await this.engineDevice(consumer, kode);
    const hours = engineBusinessHours(input);
    let verified: boolean | null;
    try {
      ({ verified } = await this.provider(device).setBusinessHours(device, hours));
    } catch (error) {
      throw engineError(error);
    }
    if (verified === false) this.options.log?.({ event: "kirim.jam_kerja.beda", device: device.kode }, "WhatsApp kept other business hours than sent");
    await writeAudit(this.pool, {
      actorKind: "service",
      actorRef: consumer.clientId,
      aksi: "jam_kerja.ubah",
      objekJenis: "jam_kerja",
      objekRef: device.kode,
      metadata: { device: device.kode, zona: hours.timezone, hari: hours.days, terbaca_ulang: verified },
      atasNama: atasNamaRef(input.atas_nama),
    });
    return { diterapkan: true as const };
  }

  /**
   * KIRIM-IMPL-004 §17.2: the module's WhatsApp Business labels on one private chat. Labels it does not manage are never touched.
   * Audit `percakapan.label` with the label names (status and program, no personal data).
   */
  async setConversationLabels(consumer: ConsumerRow, conversationId: string, input: z.infer<typeof chatLabelSchema>) {
    const conversation = await this.conversations.ownedConversation(this.pool, consumer, conversationId);
    const device = await this.engineDevice(consumer, conversation.kode);
    const chat = this.conversations.chatJids(conversation);
    if (!chat) throw new KirimApiError(422, "engine_rejected", "Percakapan ini tidak punya alamat WhatsApp yang bisa diberi label.");
    let now: string[];
    try {
      now = await this.provider(device).setChatLabels(device, chat, input.dikelola, input.label);
    } catch (error) {
      throw engineError(error);
    }
    // Only the module's own names ever leave here (the phone's other labels may carry personal names).
    const managed = new Map(input.dikelola.map((name) => [labelKey(name), name]));
    now = [...new Set(now.map(labelKey))].flatMap((key) => (managed.has(key) ? [managed.get(key)!] : []));
    await writeAudit(this.pool, {
      actorKind: "service",
      actorRef: consumer.clientId,
      aksi: "percakapan.label",
      objekJenis: "percakapan",
      objekRef: conversation.id,
      metadata: { device: device.kode, label: now },
      atasNama: atasNamaRef(input.atas_nama),
    });
    return { label: now };
  }

  /** One page of the catalog; hidden products are left out (WhatsApp Business hides them from customers too). */
  async catalog(consumer: ConsumerRow, kode: string, setelah: string | null) {
    const device = await this.engineDevice(consumer, kode);
    let page;
    try {
      page = await this.provider(device).listCatalog(device, setelah);
    } catch (error) {
      throw engineError(error);
    }
    const own = this.ingest ? await this.ingest.ownPhone(this.pool, device.id) : null;
    const items = page.products.filter((p) => !p.hidden).map((p) => {
      if (p.imageUrl) this.imageUrls.set(p.id, { url: p.imageUrl, deviceId: device.id });
      return {
        id: p.id,
        nama: p.name,
        deskripsi: p.description || null,
        // WhatsApp keeps prices in thousandths of the currency.
        harga: p.price === null ? null : Math.round(p.price / 1000),
        mata_uang: p.currency,
        url: p.url,
        ada_gambar: Boolean(p.imageUrl),
        tautan: own ? `https://wa.me/p/${encodeURIComponent(p.id)}/${own}` : null,
      };
    });
    if (this.imageUrls.size > 5000) this.imageUrls.clear();
    return { items, setelah: page.nextCursor };
  }

  /** The first image of a product listed before, fetched from WhatsApp's CDN; 404 when unknown or gone. */
  async catalogImage(consumer: ConsumerRow, kode: string, productId: string): Promise<{ data: Buffer; mime: string }> {
    const device = await this.conversations.ownedDevice(consumer, kode);
    const known = this.imageUrls.get(productId);
    if (!known || known.deviceId !== device.id) throw new KirimApiError(404, "not_found", "Gambar produk tidak tersedia.");
    let url: URL;
    try {
      url = new URL(known.url);
    } catch {
      throw new KirimApiError(404, "not_found", "Gambar produk tidak tersedia.");
    }
    if (url.protocol !== "https:" || !IMAGE_HOSTS.test(url.hostname)) throw new KirimApiError(404, "not_found", "Gambar produk tidak tersedia.");
    const response = await (this.options.fetchImpl ?? fetch)(url, { redirect: "error", signal: AbortSignal.timeout(10_000) }).catch(() => null);
    if (!response?.ok) throw new KirimApiError(404, "not_found", "Gambar produk tidak tersedia.");
    // Raster images only (never SVG), and a declared size over the cap is refused before reading it.
    const mime = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (!IMAGE_TYPES.has(mime) || declared > MAX_IMAGE_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      throw new KirimApiError(404, "not_found", "Gambar produk tidak tersedia.");
    }
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length === 0 || data.length > MAX_IMAGE_BYTES) throw new KirimApiError(404, "not_found", "Gambar produk tidak tersedia.");
    return { data, mime };
  }

  private async engineDevice(consumer: ConsumerRow, kode: string): Promise<DeviceRow> {
    const device = await this.conversations.ownedDevice(consumer, kode);
    if (device.status === "nonaktif") throw new KirimApiError(422, "device_inactive", "Nomor tidak aktif.");
    return device;
  }

  private provider(device: DeviceRow): KirimProvider {
    const provider = this.providers[device.provider];
    if (!provider) throw new KirimApiError(503, "engine_unavailable", "Mesin WhatsApp tidak tersedia.");
    return provider;
  }

  private async audit(consumer: ConsumerRow, device: DeviceRow, aksi: string, waId: string, atasNama: AtasNama) {
    await writeAudit(this.pool, {
      actorKind: "service",
      actorRef: consumer.clientId,
      aksi,
      objekJenis: "balasan_cepat",
      objekRef: `${device.kode}:${waId}`,
      metadata: { device: device.kode },
      atasNama: atasNamaRef(atasNama),
    });
  }
}

function engineError(error: unknown): Error {
  if (!(error instanceof ProviderOperationError)) return error as Error;
  if (error.code === "engine_rejected" || error.code === "device_not_found") {
    return new KirimApiError(422, "engine_rejected", "WhatsApp menolak permintaan ini (nomor ini bukan WhatsApp Business, atau mesinnya belum mendukung).");
  }
  return new KirimApiError(503, "engine_unavailable", "Mesin WhatsApp tidak tersedia atau nomor tidak tersambung.");
}
