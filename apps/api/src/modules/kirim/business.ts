import type { Pool } from "pg";
import { z } from "zod";

import { atasNamaRef, atasNamaSchema, type AtasNama, type KirimConversations } from "./conversations.js";
import { KirimApiError } from "./errors.js";
import type { KirimIngest } from "./ingest.js";
import type { KirimLog } from "./providers/log.js";
import {
  ProviderOperationError,
  type KirimProvider,
  type ProviderBusinessHours,
  type ProviderBusinessProfile,
  type ProviderBusinessProfileUpdate,
  type ProviderCatalogProduct,
  type ProviderName,
  type ProviderProductInput,
} from "./providers/types.js";
import { writeAudit, type ConsumerRow, type DeviceRow } from "./repository.js";

/**
 * KIRIM-IMPL-004 §11 (owner 2026-11-06): WhatsApp Business of the module's own number.
 *
 * - Balasan cepat: the quick replies of WhatsApp Business, both ways. What the phone sets is read from the engine; a
 *   module may add, change or remove them. Kirim keeps nothing of its own: the engine is the copy.
 * - Katalog: read, and since §17.4 (owner 2026-11-09) also added to, changed and deleted by the module. A product is
 *   sent as its `wa.me/p/<id>/<number>` link, which WhatsApp shows as the product card.
 * - Profil bisnis (§17.3): read whole; description, address, e-mail, websites, profile photo and cover photo written.
 *   The business name is never written (a name change can send the number to WhatsApp's review).
 */

export const quickReplySchema = z
  .object({ shortcut: z.string().trim().min(1).max(26), pesan: z.string().trim().min(1).max(4096), atas_nama: atasNamaSchema })
  .strict();
export const quickReplyRemoveSchema = z.object({ atas_nama: atasNamaSchema }).strict();
/** `semua=1` also lists hidden products (for the module that manages the catalog). */
export const catalogQuerySchema = z.object({ setelah: z.string().max(500).optional(), semua: z.enum(["1"]).optional() }).strict();

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

/** Text without control characters; line breaks only where `multiline`. */
function noControl(multiline: boolean) {
  return (text: string) =>
    ![...text].some((char) => {
      const code = char.charCodeAt(0);
      return code === 0x7f || (code < 0x20 && !(multiline && (code === 0x0a || code === 0x0d)));
    });
}

function isHttpUrl(text: string): boolean {
  if (/\s/.test(text)) return false;
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

const httpUrl = (max: number) => z.string().trim().min(1).max(max).refine(isHttpUrl, "harus tautan http(s)");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Base64 length of `bytes` bytes, with room for padding. */
const base64Max = (bytes: number) => Math.ceil(bytes / 3) * 4 + 4;

const MAX_PROFILE_PICTURE_BYTES = 2 * 1024 * 1024;
const MAX_COVER_PHOTO_BYTES = 4 * 1024 * 1024;
const MAX_PRODUCT_IMAGES = 5;
const MAX_PRODUCT_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_PRODUCT_IMAGES_TOTAL_BYTES = 6 * 1024 * 1024;
const PRODUCT_ID = /^[0-9A-Za-z_-]{1,64}$/;

/** KIRIM-IMPL-004 §17.3: profile fields to change (at least one); a field left out stays. No business name. */
export const businessProfileSchema = z
  .object({
    atas_nama: atasNamaSchema,
    deskripsi: z.string().trim().max(512).refine(noControl(true), "tanpa karakter kendali").optional(),
    alamat: z.string().trim().max(256).refine(noControl(false), "tanpa karakter kendali").optional(),
    email: z.string().trim().max(128).refine((v) => v === "" || EMAIL.test(v), "e-mail tidak sah").optional(),
    situs: z.array(httpUrl(256)).max(2).refine((list) => new Set(list).size === list.length, "situs ganda").optional(),
  })
  .strict()
  .refine((input) => input.deskripsi !== undefined || input.alamat !== undefined || input.email !== undefined || input.situs !== undefined, "ubah minimal satu isian");

/** §17.3: the number's own profile photo, a JPEG of at most 2 MB as base64. */
export const profilePictureSchema = z.object({ gambar: z.string().min(8).max(base64Max(MAX_PROFILE_PICTURE_BYTES)), atas_nama: atasNamaSchema }).strict();
/** §17.3: the WhatsApp Business cover photo, a JPEG of at most 4 MB as base64. */
export const coverPhotoSchema = z.object({ gambar: z.string().min(8).max(base64Max(MAX_COVER_PHOTO_BYTES)), atas_nama: atasNamaSchema }).strict();
export const coverPhotoRemoveSchema = z.object({ atas_nama: atasNamaSchema, sampul_id: z.string().regex(/^\d{1,32}$/).optional() }).strict();

/**
 * KIRIM-IMPL-004 §17.4: a catalog product, written whole (a change replaces every field; `gambar` left out keeps the
 * images). `harga` in currency units (rupiah), `mata_uang` only with a price (default IDR).
 */
export const productSchema = z
  .object({
    atas_nama: atasNamaSchema,
    nama: z.string().trim().min(1).max(200).refine(noControl(false), "tanpa karakter kendali"),
    deskripsi: z.string().trim().max(2000).refine(noControl(true), "tanpa karakter kendali").optional(),
    harga: z.number().int().min(0).max(1_000_000_000_000).nullable().optional(),
    mata_uang: z.string().regex(/^[A-Z]{3}$/).optional(),
    url: httpUrl(500).nullable().optional(),
    sku: z.string().trim().min(1).max(100).refine(noControl(false), "tanpa karakter kendali").nullable().optional(),
    tersembunyi: z.boolean().optional(),
    gambar: z.array(z.string().min(8).max(base64Max(MAX_PRODUCT_IMAGE_BYTES))).max(MAX_PRODUCT_IMAGES).optional(),
  })
  .strict()
  .refine((input) => input.mata_uang === undefined || (input.harga !== undefined && input.harga !== null), {
    message: "mata_uang hanya bersama harga",
    path: ["mata_uang"],
  });

const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Base64 of a JPEG (or, where `png`, a PNG) of at most `max` bytes; null when it is not one. */
function decodeImage(value: string, max: number, png: boolean): Buffer | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const data = Buffer.from(value, "base64");
  if (data.length === 0 || data.length > max) return null;
  return data.subarray(0, 3).equals(JPEG) || (png && data.subarray(0, 8).equals(PNG)) ? data : null;
}

const DAY_NUMBER: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** The profile's hours in the shape `PUT …/jam-kerja` takes (§17.1), plus `janji_temu` for "by appointment" days. */
function hoursView(hours: ProviderBusinessProfile["hours"]) {
  if (!hours) return null;
  const days = hours.days.flatMap((d) => {
    const hari = DAY_NUMBER[d.day];
    if (!hari) return [];
    if (d.mode === "open_24h") return [{ hari, rentang: [{ buka: "00:00", tutup: "24:00" }], janji_temu: false }];
    if (d.mode === "appointment_only") return [{ hari, rentang: [], janji_temu: true }];
    if (d.mode === "specific_hours" && d.openMinutes !== null && d.closeMinutes !== null) {
      return [{ hari, rentang: [{ buka: hhmm(d.openMinutes), tutup: hhmm(d.closeMinutes) }], janji_temu: false }];
    }
    return [];
  });
  return { zona: hours.timezone, hari: days.sort((a, b) => a.hari - b.hari) };
}

function profileView(profile: ProviderBusinessProfile) {
  return {
    nama: profile.name,
    deskripsi: profile.description,
    alamat: profile.address,
    email: profile.email,
    situs: profile.websites,
    kategori: profile.categories.map((c) => ({ id: c.id, nama: c.name })),
    jam_kerja: hoursView(profile.hours),
    ada_foto: profile.hasPicture,
    sampul_id: profile.coverPhotoId,
  };
}

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

  /**
   * One page of the catalog; hidden products are left out (WhatsApp Business hides them from customers too) unless
   * `semua` asks for them (the module that manages the catalog).
   */
  async catalog(consumer: ConsumerRow, kode: string, setelah: string | null, semua = false) {
    const device = await this.engineDevice(consumer, kode);
    let page;
    try {
      page = await this.provider(device).listCatalog(device, setelah);
    } catch (error) {
      throw engineError(error);
    }
    const own = this.ingest ? await this.ingest.ownPhone(this.pool, device.id) : null;
    const items = page.products.filter((p) => semua || !p.hidden).map((p) => this.productItem(device, p, own));
    if (this.imageUrls.size > 5000) this.imageUrls.clear();
    return { items, setelah: page.nextCursor };
  }

  private productItem(device: DeviceRow, p: ProviderCatalogProduct, own: string | null) {
    if (p.imageUrl) this.imageUrls.set(p.id, { url: p.imageUrl, deviceId: device.id });
    return {
      id: p.id,
      nama: p.name,
      deskripsi: p.description || null,
      // WhatsApp keeps prices in thousandths of the currency.
      harga: p.price === null ? null : Math.round(p.price / 1000),
      mata_uang: p.currency,
      url: p.url,
      sku: p.retailerId ?? null,
      tersembunyi: p.hidden,
      status_tinjauan: p.reviewStatus ?? null,
      ada_gambar: Boolean(p.imageUrl),
      tautan: own ? `https://wa.me/p/${encodeURIComponent(p.id)}/${own}` : null,
    };
  }

  /**
   * KIRIM-IMPL-004 §17.4: adds (`productId` "baru") or changes a catalog product. WhatsApp may review a product before
   * customers see it (`status_tinjauan`). Audit `katalog.tambah`/`katalog.ubah` with the product's id, name and price
   * (catalog data, no personal data).
   */
  async saveProduct(consumer: ConsumerRow, kode: string, productId: string, input: z.infer<typeof productSchema>) {
    const device = await this.engineDevice(consumer, kode);
    const create = productId === "baru";
    if (!create && !PRODUCT_ID.test(productId)) throw new KirimApiError(404, "not_found", "Produk tidak ditemukan.");
    let images: Buffer[] | null = create ? [] : null;
    if (input.gambar) {
      images = input.gambar.map((value) => decodeImage(value, MAX_PRODUCT_IMAGE_BYTES, true)).filter((image): image is Buffer => image !== null);
      const total = images.reduce((sum, image) => sum + image.length, 0);
      if (images.length !== input.gambar.length || total > MAX_PRODUCT_IMAGES_TOTAL_BYTES) {
        throw new KirimApiError(422, "gambar_invalid", "Gambar produk harus JPEG atau PNG, maksimal 2 MB per gambar dan 6 MB seluruhnya.");
      }
    }
    const priced = input.harga !== undefined && input.harga !== null;
    const product: ProviderProductInput = {
      name: input.nama,
      description: input.deskripsi ?? "",
      price: priced ? input.harga! * 1000 : null,
      currency: priced ? (input.mata_uang ?? "IDR") : null,
      url: input.url ?? null,
      retailerId: input.sku ?? null,
      hidden: input.tersembunyi ?? false,
      images,
    };
    let saved: { product: ProviderCatalogProduct; verified: boolean };
    try {
      saved = create ? await this.provider(device).createProduct(device, product) : await this.provider(device).updateProduct(device, productId, product);
    } catch (error) {
      throw engineError(error);
    }
    await writeAudit(this.pool, {
      actorKind: "service",
      actorRef: consumer.clientId,
      aksi: create ? "katalog.tambah" : "katalog.ubah",
      objekJenis: "katalog",
      objekRef: `${device.kode}:${saved.product.id}`,
      metadata: {
        device: device.kode,
        nama: saved.product.name,
        harga: input.harga ?? null,
        tersembunyi: product.hidden,
        gambar: images === null ? null : images.length,
        status_tinjauan: saved.product.reviewStatus ?? null,
        terbaca_ulang: saved.verified,
      },
      atasNama: atasNamaRef(input.atas_nama),
    });
    const own = this.ingest ? await this.ingest.ownPhone(this.pool, device.id) : null;
    return { produk: this.productItem(device, saved.product, own), terbaca_ulang: saved.verified };
  }

  /** §17.4: deletes a catalog product. Audit `katalog.hapus`. */
  async removeProduct(consumer: ConsumerRow, kode: string, productId: string, atasNama: AtasNama) {
    const device = await this.engineDevice(consumer, kode);
    if (!PRODUCT_ID.test(productId)) throw new KirimApiError(404, "not_found", "Produk tidak ditemukan.");
    let deleted: number;
    try {
      deleted = await this.provider(device).deleteProduct(device, productId);
    } catch (error) {
      throw engineError(error);
    }
    this.imageUrls.delete(productId);
    await writeAudit(this.pool, {
      actorKind: "service",
      actorRef: consumer.clientId,
      aksi: "katalog.hapus",
      objekJenis: "katalog",
      objekRef: `${device.kode}:${productId}`,
      metadata: { device: device.kode, dihapus: deleted },
      atasNama: atasNamaRef(atasNama),
    });
    return { dihapus: deleted };
  }

  /** KIRIM-IMPL-004 §17.3: the number's own WhatsApp Business profile, read whole. */
  async businessProfile(consumer: ConsumerRow, kode: string) {
    const device = await this.engineDevice(consumer, kode);
    try {
      return profileView(await this.provider(device).businessProfile(device));
    } catch (error) {
      throw engineError(error);
    }
  }

  /**
   * §17.3: changes the given profile texts, then reads them back (`terbaca_ulang` false: WhatsApp keeps something else).
   * Audit `profil_bisnis.ubah` with the field names only (an e-mail may be a person's).
   */
  async updateBusinessProfile(consumer: ConsumerRow, kode: string, input: z.infer<typeof businessProfileSchema>) {
    const device = await this.engineDevice(consumer, kode);
    const update: ProviderBusinessProfileUpdate = {
      ...(input.deskripsi !== undefined ? { description: input.deskripsi } : {}),
      ...(input.alamat !== undefined ? { address: input.alamat } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.situs !== undefined ? { websites: input.situs } : {}),
    };
    let result: { verified: boolean | null; profile: ProviderBusinessProfile | null };
    try {
      result = await this.provider(device).updateBusinessProfile(device, update);
    } catch (error) {
      throw engineError(error);
    }
    if (result.verified === false) this.options.log?.({ event: "kirim.profil_bisnis.beda", device: device.kode }, "WhatsApp kept another business profile than sent");
    const kolom = (["deskripsi", "alamat", "email", "situs"] as const).filter((key) => input[key] !== undefined);
    await this.profileAudit(consumer, device, "profil_bisnis.ubah", { kolom, terbaca_ulang: result.verified }, input.atas_nama);
    return { diterapkan: true as const, terbaca_ulang: result.verified, profil: result.profile ? profileView(result.profile) : null };
  }

  /** §17.3: the number's own profile photo (JPEG, at most 2 MB), or `null` to remove it. */
  async setProfilePicture(consumer: ConsumerRow, kode: string, input: { gambar: string | null; atas_nama: AtasNama }) {
    const device = await this.engineDevice(consumer, kode);
    const data = input.gambar === null ? null : decodeImage(input.gambar, MAX_PROFILE_PICTURE_BYTES, false);
    if (input.gambar !== null && !data) throw new KirimApiError(422, "gambar_invalid", "Foto profil harus JPEG, maksimal 2 MB.");
    let verified: boolean | null;
    try {
      ({ verified } = await this.provider(device).setOwnProfilePicture(device, data));
    } catch (error) {
      throw engineError(error);
    }
    await this.profileAudit(consumer, device, data ? "profil_bisnis.foto_ganti" : "profil_bisnis.foto_hapus", { terbaca_ulang: verified }, input.atas_nama);
    return { diterapkan: true as const, terbaca_ulang: verified };
  }

  /** §17.3: the number's own profile photo (WhatsApp's preview size); 404 when there is none. */
  async profilePicture(consumer: ConsumerRow, kode: string): Promise<Buffer> {
    const device = await this.engineDevice(consumer, kode);
    const own = this.ingest ? await this.ingest.ownPhone(this.pool, device.id) : null;
    if (!own) throw new KirimApiError(404, "not_found", "Foto profil tidak tersedia.");
    let photo: Buffer | null;
    try {
      photo = await this.provider(device).profilePicture(device, `${own}@s.whatsapp.net`);
    } catch (error) {
      throw engineError(error);
    }
    if (!photo) throw new KirimApiError(404, "not_found", "Foto profil tidak tersedia.");
    return photo;
  }

  /** §17.3: the WhatsApp Business cover photo (JPEG, at most 4 MB). Audit `profil_bisnis.sampul_ganti`. */
  async setCoverPhoto(consumer: ConsumerRow, kode: string, input: z.infer<typeof coverPhotoSchema>) {
    const device = await this.engineDevice(consumer, kode);
    const data = decodeImage(input.gambar, MAX_COVER_PHOTO_BYTES, false);
    if (!data) throw new KirimApiError(422, "gambar_invalid", "Foto sampul harus JPEG, maksimal 4 MB.");
    let result: { id: string; verified: boolean | null };
    try {
      result = await this.provider(device).setCoverPhoto(device, data);
    } catch (error) {
      throw engineError(error);
    }
    await this.profileAudit(consumer, device, "profil_bisnis.sampul_ganti", { sampul_id: result.id, terbaca_ulang: result.verified }, input.atas_nama);
    return { diterapkan: true as const, sampul_id: result.id, terbaca_ulang: result.verified };
  }

  /**
   * §17.3: removes the cover photo: `sampul_id` as given, else the one the profile names (or the engine set last).
   * `409 sampul_tidak_dikenal` when none is known. Audit `profil_bisnis.sampul_hapus`.
   */
  async removeCoverPhoto(consumer: ConsumerRow, kode: string, input: z.infer<typeof coverPhotoRemoveSchema>) {
    const device = await this.engineDevice(consumer, kode);
    let removed: { id: string } | null;
    try {
      removed = await this.provider(device).removeCoverPhoto(device, input.sampul_id ?? null);
    } catch (error) {
      throw engineError(error);
    }
    if (!removed) throw new KirimApiError(409, "sampul_tidak_dikenal", "Foto sampul tidak diketahui; sebutkan sampul_id.");
    await this.profileAudit(consumer, device, "profil_bisnis.sampul_hapus", { sampul_id: removed.id }, input.atas_nama);
    return { dihapus: true as const, sampul_id: removed.id };
  }

  private async profileAudit(consumer: ConsumerRow, device: DeviceRow, aksi: string, metadata: Record<string, unknown>, atasNama: AtasNama) {
    await writeAudit(this.pool, {
      actorKind: "service",
      actorRef: consumer.clientId,
      aksi,
      objekJenis: "profil_bisnis",
      objekRef: device.kode,
      metadata: { device: device.kode, ...metadata },
      atasNama: atasNamaRef(atasNama),
    });
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
