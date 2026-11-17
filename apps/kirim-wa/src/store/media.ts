import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Readable } from "node:stream";

import type { Pool } from "pg";

import { columnAad, type WaCrypto } from "../crypto.js";
import { isMimeAllowedForType, normalizeMimeType, safeOriginalFilename, type MediaType } from "../wa/media-types.js";

/**
 * KIRIM-IMPL-005 §4.3. Media the worker holds briefly: a file Kirim SQ uploaded and has not sent
 * yet, and a file WhatsApp delivered that Kirim SQ has not copied yet. Kirim SQ keeps the lasting
 * copy in `/srv/sq-hub/kirim-media`, so nothing here has to survive for long.
 *
 * Bytes on disk are sealed with the worker's own key, as the Hub does for its media (D-8): the
 * folder is on a phone, and a stolen disk should not read as a chat.
 */

export interface StoredMediaRecord {
  id: string;
  kode: string;
  source: "inbound" | "upload" | "history";
  mediaType: MediaType;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  originalFilename: string | null;
  createdAt: string;
}

export class MediaTypeError extends Error {
  constructor(readonly mediaType: MediaType) {
    super(`Unsupported mime type for ${mediaType}`);
    this.name = "MediaTypeError";
  }
}

export class MediaTooLargeError extends Error {
  constructor() {
    super("Media is larger than the configured limit");
    this.name = "MediaTooLargeError";
  }
}

export class MediaNotFoundError extends Error {
  constructor(readonly mediaId: string) {
    super(`Media not found: ${mediaId}`);
    this.name = "MediaNotFoundError";
  }
}

/** WhatsApp's own ceiling for a document; anything larger is refused before it is written. */
export const MEDIA_MAX_BYTES = 64 * 1024 * 1024;

export class MediaStore {
  constructor(
    private readonly pool: Pool,
    private readonly crypto: WaCrypto,
    private readonly root: string,
  ) {}

  async init(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
  }

  async store(input: {
    kode: string;
    source: StoredMediaRecord["source"];
    mediaType: MediaType;
    mimeType: string | null | undefined;
    originalFilename: string | null | undefined;
    data: Buffer;
  }): Promise<StoredMediaRecord> {
    const mimeType = normalizeMimeType(input.mimeType) ?? defaultMime(input.mediaType);
    if (!isMimeAllowedForType(input.mediaType, mimeType)) throw new MediaTypeError(input.mediaType);
    if (input.data.length > MEDIA_MAX_BYTES) throw new MediaTooLargeError();

    const id = randomUUID();
    const sha256 = createHash("sha256").update(input.data).digest("hex");
    const path = this.pathFor(id);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await writeFile(path, this.crypto.sealFileLike(input.data, columnAad("kirim_wa_media", "bytes", id)), { mode: 0o600 });

    const record: StoredMediaRecord = {
      id,
      kode: input.kode,
      source: input.source,
      mediaType: input.mediaType,
      mimeType,
      sizeBytes: input.data.length,
      sha256,
      originalFilename: safeOriginalFilename(input.originalFilename),
      createdAt: new Date().toISOString(),
    };
    await this.pool.query(
      `INSERT INTO kirim_wa_media (id, kode, source, media_type, mime, size_bytes, sha256, original_filename, path, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())`,
      [record.id, record.kode, record.source, record.mediaType, record.mimeType, record.sizeBytes, record.sha256, record.originalFilename, path],
    );
    return record;
  }

  /** Reads a stream to a buffer, refusing anything over the limit before it reaches the disk. */
  async storeStream(input: Omit<Parameters<MediaStore["store"]>[0], "data"> & { stream: Readable; maxBytes?: number }): Promise<StoredMediaRecord> {
    const limit = input.maxBytes ?? MEDIA_MAX_BYTES;
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of input.stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBufferLike);
      total += buffer.length;
      if (total > limit) throw new MediaTooLargeError();
      chunks.push(buffer);
    }
    const { stream: _stream, maxBytes: _maxBytes, ...rest } = input;
    return this.store({ ...rest, data: Buffer.concat(chunks) });
  }

  async find(kode: string, mediaId: string): Promise<StoredMediaRecord | null> {
    const result = await this.pool.query<MediaRow>(
      `SELECT id, kode, source, media_type, mime, size_bytes, sha256, original_filename, created_at
         FROM kirim_wa_media WHERE id = $1 AND kode = $2 AND expired_at IS NULL`,
      [mediaId, kode],
    );
    const row = result.rows[0];
    return row ? fromRow(row) : null;
  }

  async read(record: StoredMediaRecord): Promise<Buffer> {
    const sealed = await readFile(this.pathFor(record.id)).catch(() => null);
    if (!sealed) throw new MediaNotFoundError(record.id);
    return this.crypto.openFileLike(sealed, columnAad("kirim_wa_media", "bytes", record.id));
  }

  /**
   * Inbound media Kirim SQ has copied, and uploads that were never sent, are removed after the
   * configured time. Nothing that a pending send still refers to is touched, because an upload is
   * only removed once it is older than the window a send can live for.
   */
  async expire(olderThanHours: number): Promise<number> {
    const result = await this.pool.query<{ id: string }>(
      `UPDATE kirim_wa_media SET expired_at = now()
        WHERE expired_at IS NULL AND created_at < now() - make_interval(hours => $1)
        RETURNING id`,
      [olderThanHours],
    );
    for (const row of result.rows) await rm(this.pathFor(row.id), { force: true });
    return result.rowCount ?? 0;
  }

  private pathFor(id: string): string {
    // `id` is a uuid this worker made, so it can only be a single safe path segment; resolve()
    // and the check below keep that true if the id ever stops being a uuid.
    const path = resolve(join(this.root, `${id}.bin`));
    if (!path.startsWith(resolve(this.root))) throw new MediaNotFoundError(id);
    return path;
  }
}

interface MediaRow {
  id: string;
  kode: string;
  source: StoredMediaRecord["source"];
  media_type: MediaType;
  mime: string;
  size_bytes: string | number;
  sha256: string;
  original_filename: string | null;
  created_at: Date;
}

function fromRow(row: MediaRow): StoredMediaRecord {
  return {
    id: row.id,
    kode: row.kode,
    source: row.source,
    mediaType: row.media_type,
    mimeType: row.mime,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
    originalFilename: row.original_filename,
    createdAt: row.created_at.toISOString(),
  };
}

function defaultMime(mediaType: MediaType): string {
  if (mediaType === "image") return "image/jpeg";
  if (mediaType === "video") return "video/mp4";
  if (mediaType === "audio") return "audio/ogg";
  if (mediaType === "sticker") return "image/webp";
  return "application/octet-stream";
}
