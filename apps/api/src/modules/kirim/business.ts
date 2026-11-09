import { createHash, randomUUID } from "node:crypto";

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
import { canonicalJson } from "./service.js";

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
/**
 * An image as base64. Its size and type are checked when decoded (`422 gambar_invalid`), not by the schema, so an
 * oversize image gets the same answer whether or not it fits the route's body limit (over it, the same 422).
 */
const imageBase64 = z.string().min(1);

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
    email: z.string().trim().max(128).refine(noControl(false), "tanpa karakter kendali").refine((v) => v === "" || EMAIL.test(v), "e-mail tidak sah").optional(),
    situs: z.array(httpUrl(256)).max(2).refine((list) => new Set(list).size === list.length, "situs ganda").optional(),
  })
  .strict()
  .refine((input) => input.deskripsi !== undefined || input.alamat !== undefined || input.email !== undefined || input.situs !== undefined, "ubah minimal satu isian");

/** §17.3: the number's own profile photo, a JPEG of at most 2 MB as base64. */
export const profilePictureSchema = z.object({ gambar: imageBase64, atas_nama: atasNamaSchema }).strict();
/** §17.3: the WhatsApp Business cover photo, a JPEG of at most 4 MB as base64. */
export const coverPhotoSchema = z.object({ gambar: imageBase64, atas_nama: atasNamaSchema }).strict();
export const coverPhotoRemoveSchema = z.object({ atas_nama: atasNamaSchema, sampul_id: z.string().regex(/^\d{1,32}$/).optional() }).strict();

const productFields = {
  nama: z.string().trim().min(1).max(200).refine(noControl(false), "tanpa karakter kendali"),
  deskripsi: z.string().trim().max(2000).refine(noControl(true), "tanpa karakter kendali"),
  harga: z.number().int().min(0).max(1_000_000_000_000).nullable(),
  mata_uang: z.string().regex(/^[A-Z]{3}$/),
  url: httpUrl(500).nullable(),
  sku: z.string().trim().min(1).max(100).refine(noControl(false), "tanpa karakter kendali").nullable(),
  tersembunyi: z.boolean(),
  gambar: z.array(imageBase64),
};

/**
 * KIRIM-IMPL-004 §17.4: a new catalog product. `harga` in currency units (rupiah), `mata_uang` only with a price
 * (default IDR). At most 5 images, checked when decoded.
 */
export const productSchema = z
  .object({
    atas_nama: atasNamaSchema,
    nama: productFields.nama,
    deskripsi: productFields.deskripsi.optional(),
    harga: productFields.harga.optional(),
    mata_uang: productFields.mata_uang.optional(),
    url: productFields.url.optional(),
    sku: productFields.sku.optional(),
    tersembunyi: productFields.tersembunyi.optional(),
    gambar: productFields.gambar.optional(),
  })
  .strict()
  .refine((input) => input.mata_uang === undefined || (input.harga !== undefined && input.harga !== null), {
    message: "mata_uang hanya bersama harga",
    path: ["mata_uang"],
  });

/**
 * §17.4: a change to a product: only the fields given change, the others keep their value (`null` clears `harga`,
 * `url` or `sku`). `gambar` given replaces the images (at least one); left out, the images stay.
 */
export const productPatchSchema = z
  .object({
    atas_nama: atasNamaSchema,
    nama: productFields.nama.optional(),
    deskripsi: productFields.deskripsi.optional(),
    harga: productFields.harga.optional(),
    mata_uang: productFields.mata_uang.optional(),
    url: productFields.url.optional(),
    sku: productFields.sku.optional(),
    tersembunyi: productFields.tersembunyi.optional(),
    gambar: productFields.gambar.optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).some((key) => key !== "atas_nama"), "ubah minimal satu isian");

const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Base64 of a JPEG (or, where `png`, a PNG) of at most `max` bytes; null when it is not one. */
function decodeImage(value: string, max: number, png: boolean): Buffer | null {
  if (value.length > Math.ceil(max / 3) * 4 + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const data = Buffer.from(value, "base64");
  if (data.length === 0 || data.length > max) return null;
  return data.subarray(0, 3).equals(JPEG) || (png && data.subarray(0, 8).equals(PNG)) ? data : null;
}

const DAY_NUMBER: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * The profile's hours in the shape `PUT …/jam-kerja` takes (§17.1), plus `janji_temu` for "by appointment" days. Each
 * day once, with every range WhatsApp keeps for it in order (the phone may keep several, e.g. 08:00–12:00 and
 * 13:00–16:00, as separate entries). A day WhatsApp does not list is closed and is left out.
 */
function hoursView(hours: ProviderBusinessProfile["hours"]) {
  if (!hours) return null;
  const byDay = new Map<number, { ranges: Array<[number, number]>; appointment: boolean }>();
  for (const d of hours.days) {
    const hari = DAY_NUMBER[d.day];
    if (!hari) continue;
    const day = byDay.get(hari) ?? { ranges: [], appointment: false };
    byDay.set(hari, day);
    if (d.mode === "open_24h") day.ranges.push([0, 1440]);
    else if (d.mode === "appointment_only") day.appointment = true;
    else if (d.mode === "specific_hours" && d.openMinutes !== null && d.closeMinutes !== null && d.openMinutes < d.closeMinutes) {
      day.ranges.push([d.openMinutes, d.closeMinutes]);
    }
  }
  const hari = [...byDay.entries()]
    .filter(([, day]) => day.ranges.length > 0 || day.appointment)
    .sort(([a], [b]) => a - b)
    .map(([number, day]) => {
      const seen = new Set<string>();
      const rentang = day.ranges
        .sort((a, b) => a[0] - b[0] || a[1] - b[1])
        .filter(([open, close]) => !seen.has(`${open}-${close}`) && Boolean(seen.add(`${open}-${close}`)))
        .map(([open, close]) => ({ buka: hhmm(open), tutup: hhmm(close) }));
      return { hari: number, rentang, janji_temu: day.appointment && rentang.length === 0 };
    });
  return { zona: hours.timezone, hari };
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
  /** §17.3–§17.4: one image write at a time per number (each one uploads to WhatsApp for up to two minutes). */
  private readonly imageWrites = new Map<string, Promise<unknown>>();
  /** Image writes per number that are queued or running; at most [MAX_IMAGE_QUEUE]. */
  private readonly imageQueueDepth = new Map<string, number>();
  /** §17.3: the own profile photo per number for five minutes, so a module polling it does not use the photo budget. */
  private readonly ownPhotos = new Map<string, { at: number; photo: Buffer | null }>();

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
    const items = page.products.filter((p) => semua || !p.hidden).map((p) => {
      this.rememberImage(device, p);
      return withLink(productItem(p), own);
    });
    if (this.imageUrls.size > 5000) this.imageUrls.clear();
    // `katalog_ada`: false when the number has no catalog yet (made once in the WhatsApp Business app), null: not known.
    return { items, setelah: page.nextCursor, katalog_ada: page.catalogExists ?? null };
  }

  /**
   * KIRIM-IMPL-004 §17.4: adds a catalog product, once per `Idempotency-Key`: a retry with the same key and body gets
   * the stored answer (`ulangan: true`), never a second product. A row is reserved before the engine is asked; when
   * the engine cannot say whether WhatsApp made the product, the row and the audit say `tidak_pasti` and a retry with
   * that key is `409 hasil_tidak_pasti` (check the catalog with `semua=1`). Audit `katalog.tambah` with the product's
   * id, name and price (catalog data, no personal data).
   */
  async createProduct(consumer: ConsumerRow, kode: string, idempotencyKey: string, input: z.infer<typeof productSchema>) {
    const device = await this.engineDevice(consumer, kode);
    const images = productImages(input.gambar ?? []);
    const requestHash = createHash("sha256").update(`katalog-tambah:${device.id}:${canonicalJson(input)}`).digest("hex");
    const known = await this.pool.query<{ requestHash: string; status: string; hasil: StoredProduct | null; basi: boolean }>(
      `SELECT request_hash AS "requestHash", status, hasil, updated_at < now() - interval '10 minutes' AS basi
         FROM kirim_catalog_writes WHERE consumer_id = $1 AND idempotency_key = $2`,
      [consumer.id, idempotencyKey],
    );
    const row = known.rows[0];
    if (row) {
      if (row.requestHash !== requestHash) throw new KirimApiError(409, "idempotency_key_conflict", "Idempotency-Key sudah dipakai untuk permintaan lain.");
      if (row.status === "selesai" && row.hasil) {
        const own = this.ingest ? await this.ingest.ownPhone(this.pool, device.id) : null;
        return { status: 200, body: { produk: withLink(row.hasil.produk, own), terbaca_ulang: row.hasil.terbaca_ulang, ulangan: true } };
      }
      if (row.status === "berjalan" && !row.basi) throw new KirimApiError(409, "idempotency_request_in_progress", "Penambahan produk dengan kunci ini masih berjalan.");
      throw new KirimApiError(409, "hasil_tidak_pasti", "Hasil penambahan dengan kunci ini tidak pasti; periksa katalog (semua=1), lalu pakai kunci baru bila produknya belum ada.");
    }
    const reservation = randomUUID();
    try {
      await this.pool.query(
        `INSERT INTO kirim_catalog_writes (id, device_id, consumer_id, idempotency_key, request_hash) VALUES ($1, $2, $3, $4, $5)`,
        [reservation, device.id, consumer.id, idempotencyKey, requestHash],
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new KirimApiError(409, "idempotency_request_in_progress", "Penambahan produk dengan kunci ini masih berjalan.");
      throw error;
    }
    const product: ProviderProductInput = {
      name: input.nama,
      description: input.deskripsi ?? "",
      price: input.harga === undefined || input.harga === null ? null : input.harga * 1000,
      currency: input.harga === undefined || input.harga === null ? null : (input.mata_uang ?? "IDR"),
      url: input.url ?? null,
      retailerId: input.sku ?? null,
      hidden: input.tersembunyi ?? false,
      images,
    };
    const audit = { device: device.kode, nama: product.name, harga: input.harga ?? null, tersembunyi: product.hidden, gambar: images.length };
    let saved: { product: ProviderCatalogProduct; verified: boolean };
    try {
      saved = await this.oneImageWrite(device, async () => {
        // The ten minutes before a `berjalan` row counts as stale start when the write leaves the queue.
        await this.pool.query("UPDATE kirim_catalog_writes SET updated_at = now() WHERE id = $1", [reservation]);
        return this.provider(device).createProduct(device, product);
      });
    } catch (error) {
      if (outcomeUnknown(error)) {
        await this.pool.query(`UPDATE kirim_catalog_writes SET status = 'tidak_pasti', updated_at = now() WHERE id = $1`, [reservation]);
        await this.catalogAudit(consumer, device, "katalog.tambah", null, { ...audit, hasil: "tidak_pasti" }, input.atas_nama);
      } else {
        // Not made: the key may be used again.
        await this.pool.query("DELETE FROM kirim_catalog_writes WHERE id = $1", [reservation]);
      }
      throw engineError(error);
    }
    const stored: StoredProduct = { produk: productItem(saved.product), terbaca_ulang: saved.verified };
    await this.pool.query(`UPDATE kirim_catalog_writes SET status = 'selesai', hasil = $2, updated_at = now() WHERE id = $1`, [reservation, JSON.stringify(stored)]);
    this.rememberImage(device, saved.product);
    await this.catalogAudit(consumer, device, "katalog.tambah", saved.product.id, {
      ...audit, status_tinjauan: saved.product.reviewStatus ?? null, terbaca_ulang: saved.verified,
    }, input.atas_nama);
    const own = this.ingest ? await this.ingest.ownPhone(this.pool, device.id) : null;
    return { status: 201, body: { produk: withLink(stored.produk, own), terbaca_ulang: saved.verified } };
  }

  /**
   * §17.4: changes the given fields of a product; the others keep the value WhatsApp has now. `404 produk_tidak_ada`
   * when the catalog has no such product. Audit `katalog.ubah` (with `hasil: "tidak_pasti"` when the engine could not
   * say whether WhatsApp applied it).
   */
  async updateProduct(consumer: ConsumerRow, kode: string, productId: string, input: z.infer<typeof productPatchSchema>) {
    const device = await this.engineDevice(consumer, kode);
    if (!PRODUCT_ID.test(productId)) throw new KirimApiError(404, "produk_tidak_ada", "Produk tidak ada di katalog.");
    if (input.gambar !== undefined && input.gambar.length === 0) {
      throw new KirimApiError(422, "gambar_invalid", "Gambar produk tidak bisa dikosongkan; kirim minimal satu gambar, atau jangan sebut gambar agar gambar tetap.");
    }
    const images = input.gambar === undefined ? null : productImages(input.gambar);
    const kolom = (["nama", "deskripsi", "harga", "mata_uang", "url", "sku", "tersembunyi", "gambar"] as const).filter((key) => input[key] !== undefined);
    let audit: Record<string, unknown> | null = null;
    let saved: { product: ProviderCatalogProduct; verified: boolean };
    try {
      // Read and merged inside the queued step, so a write queued before this one is already in what is read.
      saved = await this.oneImageWrite(device, async () => {
        const current = await this.findProduct(device, productId);
        const price = input.harga === undefined ? current.price : input.harga === null ? null : input.harga * 1000;
        if (input.mata_uang !== undefined && price === null) throw new KirimApiError(400, "invalid_request", "mata_uang hanya bersama harga.", { fields: ["mata_uang"] });
        const product: ProviderProductInput = {
          name: input.nama ?? current.name,
          // The engine's listing cuts descriptions at 2000 characters: a cut copy is never written back (null keeps it).
          description: input.deskripsi ?? (current.description.length >= LISTED_DESCRIPTION_MAX ? null : current.description),
          price,
          currency: price === null ? null : (input.mata_uang ?? current.currency ?? "IDR"),
          url: input.url === undefined ? current.url : input.url,
          retailerId: input.sku === undefined ? (current.retailerId ?? null) : input.sku,
          hidden: input.tersembunyi ?? current.hidden,
          images,
        };
        audit = { device: device.kode, kolom, nama: product.name, harga: price === null ? null : price / 1000, tersembunyi: product.hidden, gambar: images === null ? null : images.length };
        return this.provider(device).updateProduct(device, productId, product);
      });
    } catch (error) {
      if (outcomeUnknown(error) && audit) await this.catalogAudit(consumer, device, "katalog.ubah", productId, { ...(audit as Record<string, unknown>), hasil: "tidak_pasti" }, input.atas_nama);
      throw engineError(error);
    }
    this.rememberImage(device, saved.product);
    await this.catalogAudit(consumer, device, "katalog.ubah", saved.product.id, {
      ...(audit as Record<string, unknown> | null), status_tinjauan: saved.product.reviewStatus ?? null, terbaca_ulang: saved.verified,
    }, input.atas_nama);
    const own = this.ingest ? await this.ingest.ownPhone(this.pool, device.id) : null;
    return { produk: withLink(productItem(saved.product), own), terbaca_ulang: saved.verified };
  }

  /** §17.4: deletes a catalog product; `404 produk_tidak_ada` when the catalog has none by that id. Audit `katalog.hapus`. */
  async removeProduct(consumer: ConsumerRow, kode: string, productId: string, atasNama: AtasNama) {
    const device = await this.engineDevice(consumer, kode);
    if (!PRODUCT_ID.test(productId)) throw new KirimApiError(404, "produk_tidak_ada", "Produk tidak ada di katalog.");
    await this.findProduct(device, productId);
    let deleted: number;
    try {
      deleted = await this.provider(device).deleteProduct(device, productId);
    } catch (error) {
      if (outcomeUnknown(error)) await this.catalogAudit(consumer, device, "katalog.hapus", productId, { device: device.kode, hasil: "tidak_pasti" }, atasNama);
      throw engineError(error);
    }
    this.imageUrls.delete(productId);
    await this.catalogAudit(consumer, device, "katalog.hapus", productId, { device: device.kode, dihapus: deleted }, atasNama);
    return { dihapus: deleted };
  }

  /** The product as the catalog has it now (pages of 100, at most 20); `404 produk_tidak_ada` when it is not there. */
  private async findProduct(device: DeviceRow, productId: string): Promise<ProviderCatalogProduct> {
    let cursor: string | null = null;
    for (let page = 0; page < 20; page += 1) {
      let result: { products: ProviderCatalogProduct[]; nextCursor: string | null };
      try {
        result = await this.provider(device).listCatalog(device, cursor);
      } catch (error) {
        throw engineError(error);
      }
      const found = result.products.find((p) => p.id === productId);
      if (found) return found;
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    throw new KirimApiError(404, "produk_tidak_ada", "Produk tidak ada di katalog.");
  }

  private rememberImage(device: DeviceRow, product: ProviderCatalogProduct) {
    if (product.imageUrl) this.imageUrls.set(product.id, { url: product.imageUrl, deviceId: device.id });
  }

  private async catalogAudit(consumer: ConsumerRow, device: DeviceRow, aksi: string, productId: string | null, metadata: Record<string, unknown>, atasNama: AtasNama) {
    await writeAudit(this.pool, {
      actorKind: "service",
      actorRef: consumer.clientId,
      aksi,
      objekJenis: "katalog",
      objekRef: `${device.kode}:${productId ?? "baru"}`,
      metadata,
      atasNama: atasNamaRef(atasNama),
    });
  }

  /**
   * Image writes of one number run one after another (in this process). At most [MAX_IMAGE_QUEUE] queued or running;
   * one more is `429 antrean_penuh`, before anything is sent.
   */
  private async oneImageWrite<T>(device: DeviceRow, work: () => Promise<T>): Promise<T> {
    const depth = this.imageQueueDepth.get(device.id) ?? 0;
    if (depth >= MAX_IMAGE_QUEUE) {
      throw new KirimApiError(429, "antrean_penuh", "Masih ada beberapa perubahan bergambar untuk nomor ini; coba lagi sebentar lagi.", { retry_after_detik: 30 });
    }
    this.imageQueueDepth.set(device.id, depth + 1);
    const previous = this.imageWrites.get(device.id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    const tail = next.catch(() => undefined);
    this.imageWrites.set(device.id, tail);
    void tail.then(() => {
      const left = (this.imageQueueDepth.get(device.id) ?? 1) - 1;
      if (left > 0) this.imageQueueDepth.set(device.id, left);
      else this.imageQueueDepth.delete(device.id);
      if (this.imageWrites.get(device.id) === tail) this.imageWrites.delete(device.id);
    });
    return next;
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
    const kolom = (["deskripsi", "alamat", "email", "situs"] as const).filter((key) => input[key] !== undefined);
    let result: { verified: boolean | null; profile: ProviderBusinessProfile | null };
    try {
      result = await this.provider(device).updateBusinessProfile(device, update);
    } catch (error) {
      if (outcomeUnknown(error)) await this.profileAudit(consumer, device, "profil_bisnis.ubah", { kolom, hasil: "tidak_pasti" }, input.atas_nama);
      throw engineError(error);
    }
    if (result.verified === false) this.options.log?.({ event: "kirim.profil_bisnis.beda", device: device.kode }, "WhatsApp kept another business profile than sent");
    await this.profileAudit(consumer, device, "profil_bisnis.ubah", { kolom, terbaca_ulang: result.verified }, input.atas_nama);
    return { diterapkan: true as const, terbaca_ulang: result.verified, profil: result.profile ? profileView(result.profile) : null };
  }

  /** §17.3: the number's own profile photo (JPEG, at most 2 MB), or `null` to remove it. */
  async setProfilePicture(consumer: ConsumerRow, kode: string, input: { gambar: string | null; atas_nama: AtasNama }) {
    const device = await this.engineDevice(consumer, kode);
    const data = input.gambar === null ? null : decodeImage(input.gambar, MAX_PROFILE_PICTURE_BYTES, false);
    if (input.gambar !== null && !data) throw new KirimApiError(422, "gambar_invalid", "Foto profil harus JPEG, maksimal 2 MB.");
    const aksi = data ? "profil_bisnis.foto_ganti" : "profil_bisnis.foto_hapus";
    let verified: boolean | null;
    try {
      ({ verified } = await this.oneImageWrite(device, () => this.provider(device).setOwnProfilePicture(device, data)));
    } catch (error) {
      if (outcomeUnknown(error)) {
        this.ownPhotos.delete(device.id);
        await this.profileAudit(consumer, device, aksi, { hasil: "tidak_pasti" }, input.atas_nama);
      }
      throw engineError(error);
    }
    this.ownPhotos.delete(device.id);
    await this.profileAudit(consumer, device, aksi, { terbaca_ulang: verified }, input.atas_nama);
    return { diterapkan: true as const, terbaca_ulang: verified };
  }

  /** §17.3: the number's own profile photo (WhatsApp's preview size), kept five minutes; 404 when there is none. */
  async profilePicture(consumer: ConsumerRow, kode: string): Promise<Buffer> {
    const device = await this.engineDevice(consumer, kode);
    const cached = this.ownPhotos.get(device.id);
    let photo: Buffer | null;
    if (cached && Date.now() - cached.at < OWN_PHOTO_TTL_MS) {
      photo = cached.photo;
    } else {
      const own = this.ingest ? await this.ingest.ownPhone(this.pool, device.id) : null;
      if (!own) throw new KirimApiError(404, "not_found", "Foto profil tidak tersedia.");
      try {
        photo = await this.provider(device).profilePicture(device, `${own}@s.whatsapp.net`);
      } catch (error) {
        throw engineError(error);
      }
      if (this.ownPhotos.size > 500) this.ownPhotos.clear();
      this.ownPhotos.set(device.id, { at: Date.now(), photo });
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
      result = await this.oneImageWrite(device, () => this.provider(device).setCoverPhoto(device, data));
    } catch (error) {
      if (outcomeUnknown(error)) await this.profileAudit(consumer, device, "profil_bisnis.sampul_ganti", { hasil: "tidak_pasti" }, input.atas_nama);
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
      if (outcomeUnknown(error)) {
        await this.profileAudit(consumer, device, "profil_bisnis.sampul_hapus", { sampul_id: input.sampul_id ?? null, hasil: "tidak_pasti" }, input.atas_nama);
      }
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
  if (error.code === "catalog_missing") {
    return new KirimApiError(422, "katalog_belum_ada",
      "Nomor ini belum punya katalog WhatsApp Business. Buka WhatsApp Business di HP, pilih Alat bisnis lalu Katalog, buat katalognya sekali, lalu coba lagi.");
  }
  if (error.code === "outcome_unknown") {
    return new KirimApiError(503, "engine_outcome_unknown", "Mesin tidak memberi jawaban pasti; perubahan mungkin sudah terjadi di WhatsApp. Periksa dulu sebelum mencoba lagi.");
  }
  if (error.code === "engine_rejected" || error.code === "device_not_found") {
    return new KirimApiError(422, "engine_rejected", "WhatsApp menolak permintaan ini (nomor ini bukan WhatsApp Business, atau mesinnya belum mendukung).");
  }
  return new KirimApiError(503, "engine_unavailable", "Mesin WhatsApp tidak tersedia atau nomor tidak tersambung.");
}

/** The engine could not say whether WhatsApp applied the write. */
function outcomeUnknown(error: unknown): boolean {
  return error instanceof ProviderOperationError && error.code === "outcome_unknown";
}

const OWN_PHOTO_TTL_MS = 5 * 60 * 1000;

/** A stored answer of `POST …/katalog` (§17.4): the product without its link (rebuilt from the number on replay). */
interface StoredProduct {
  produk: ReturnType<typeof productItem>;
  terbaca_ulang: boolean;
}

function productItem(p: ProviderCatalogProduct) {
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
  };
}

function withLink(item: ReturnType<typeof productItem>, own: string | null) {
  return { ...item, tautan: own ? `https://wa.me/p/${encodeURIComponent(item.id)}/${own}` : null };
}

/** §17.4: product images, at most five JPEG/PNG of 2 MB each and 6 MB together; else `422 gambar_invalid`. */
function productImages(values: string[]): Buffer[] {
  const refused = () =>
    new KirimApiError(422, "gambar_invalid", "Gambar produk harus JPEG atau PNG, paling banyak 5, maksimal 2 MB per gambar dan 6 MB seluruhnya.");
  // Counted before any is decoded.
  if (values.length > MAX_PRODUCT_IMAGES) throw refused();
  const images = values.map((value) => decodeImage(value, MAX_PRODUCT_IMAGE_BYTES, true));
  const total = images.reduce((sum, image) => sum + (image?.length ?? 0), 0);
  if (images.some((image) => image === null) || total > MAX_PRODUCT_IMAGES_TOTAL_BYTES) throw refused();
  return images as Buffer[];
}

/** §17.3–§17.4: image writes per number that may be queued or running at once. */
const MAX_IMAGE_QUEUE = 3;
/** The engine's catalog listing cuts descriptions at this length (JalurPesan `listCatalog`). */
const LISTED_DESCRIPTION_MAX = 2000;
