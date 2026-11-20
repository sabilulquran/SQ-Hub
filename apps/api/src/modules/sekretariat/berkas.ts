import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, rename, rm, stat, statfs, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { Pool } from "pg";

import { isUuid, notFound, SekretariatError, withTransaction, type Db } from "./db.js";

export type PemilikJenis = "surat_keluar" | "surat_masuk";

/**
 * SEK-IMPL-001 §2 "Berkas": files live under SEKRETARIAT_MEDIA_ROOT keyed by UUID with a SHA-256
 * checksum; the original name is never part of the disk path. A published letter's PDF is locked
 * (terkunci) and can never be replaced (§6). The Karir/Kerja pattern: no at-rest encryption on
 * Mi8 (D-5); the encrypted copy is the off-host rclone backup.
 */

const INLINE = new Set(["application/pdf", "image/png", "image/jpeg"]);

export function detectKind(head: Buffer, filename: string): string | null {
  const ext = filename.toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1] ?? "";
  const starts = (bytes: number[], offset = 0) => bytes.every((byte, index) => head[offset + index] === byte);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x50, 0x4b, 0x03, 0x04])) {
    if (ext === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (ext === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    return "application/zip";
  }
  if (head.length > 0 && !head.includes(0)) return "text/plain";
  return null;
}

export function safeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex -- control characters are exactly what must be removed
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
  return cleaned.length > 0 ? cleaned : "berkas";
}

export interface BerkasOptions {
  mediaRoot: string;
  maxUploadBytes: number;
  minFreeDiskBytes: number;
  /** Test seam for the free-space check. */
  freeBytes?: (path: string) => Promise<number>;
}

export class SekretariatBerkas {
  constructor(
    private readonly pool: Pool,
    private readonly options: BerkasOptions,
  ) {}

  get maxUploadBytes(): number {
    return this.options.maxUploadBytes;
  }

  async assertDiskRoom(): Promise<void> {
    await mkdir(this.options.mediaRoot, { recursive: true, mode: 0o700 });
    const free = await (this.options.freeBytes ?? diskFree)(this.options.mediaRoot);
    if (free < this.options.minFreeDiskBytes) {
      throw new SekretariatError(507, "disk_hampir_penuh", "Ruang penyimpanan server hampir penuh. Unggahan ditolak sementara; hubungi pengelola Sekretariat.");
    }
  }

  /**
   * Streams the upload to a temporary file while hashing it; size and kind are checked before the
   * row exists. `allow` narrows the accepted kinds: a letter PDF is PDF only, a scan is PDF or an
   * image. Nothing stays on disk when any check fails.
   */
  async store(
    aktor: string,
    pemilik: { jenis: PemilikJenis; id: string },
    file: { filename: string; stream: Readable; truncated: () => boolean },
    allow: "pdf" | "pindaian" | "lampiran-email",
  ): Promise<{ id: string; nama: string; mime: string; ukuran: number; sha256: string }> {
    await this.assertDiskRoom();
    const tmpDir = join(this.options.mediaRoot, ".tmp");
    await mkdir(tmpDir, { recursive: true, mode: 0o700 });
    const tmpPath = join(tmpDir, randomUUID());
    const hash = createHash("sha256");
    let size = 0;
    let head = Buffer.alloc(0);
    try {
      await pipeline(
        file.stream,
        new Transform({
          transform(chunk: Buffer, _encoding, done) {
            size += chunk.length;
            hash.update(chunk);
            if (head.length < 8192) head = Buffer.concat([head, chunk.subarray(0, 8192 - head.length)]);
            done(null, chunk);
          },
        }),
        createWriteStream(tmpPath, { mode: 0o600 }),
      ).catch((error: unknown) => {
        if ((error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") file.truncated = () => true;
        else throw error;
      });
      if (file.truncated() || size > this.options.maxUploadBytes) {
        throw new SekretariatError(413, "berkas_terlalu_besar", `Berkas melebihi batas ${Math.round(this.options.maxUploadBytes / 1024 / 1024)} MiB.`);
      }
      if (size === 0) throw new SekretariatError(400, "berkas_kosong", "Berkas kosong.");
      const nama = safeFilename(file.filename);
      const mime = detectKind(head, nama);
      const allowed = allow === "pdf"
        ? mime === "application/pdf"
        : allow === "pindaian"
          ? mime === "application/pdf" || mime === "image/png" || mime === "image/jpeg"
          : mime !== null;
      if (!mime || !allowed) {
        throw new SekretariatError(415, "jenis_berkas_ditolak", allow === "pdf" ? "Arsip surat harus PDF." : "Kirim PDF, JPEG, atau PNG.");
      }
      const kunci = randomUUID();
      const id = randomUUID();
      const sha256 = hash.digest("hex");
      await withTransaction(this.pool, async (client) => {
        await mkdir(join(this.options.mediaRoot, pemilik.jenis), { recursive: true, mode: 0o700 });
        await rename(tmpPath, this.pathFor(pemilik.jenis, kunci));
        await client.query(
          `INSERT INTO sekretariat_berkas (id, pemilik_jenis, pemilik_id, nama, kunci, mime, ukuran, sha256, diunggah_oleh)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [id, pemilik.jenis, pemilik.id, nama, kunci, mime, size, sha256, aktor],
        );
      }).catch(async (error: unknown) => {
        await rm(this.pathFor(pemilik.jenis, kunci), { force: true });
        throw error;
      });
      return { id, nama, mime, ukuran: size, sha256 };
    } finally {
      await rm(tmpPath, { force: true });
    }
  }

  /** The caller has already authorized the owner; this only resolves and streams the file. */
  async open(berkasId: string): Promise<{
    nama: string; mime: string; ukuran: number; inline: boolean; pemilikJenis: PemilikJenis; pemilikId: string; stream: NodeJS.ReadableStream;
  }> {
    if (!isUuid(berkasId)) notFound();
    const row = (await this.pool.query<{ pemilik_jenis: PemilikJenis; pemilik_id: string; nama: string; kunci: string; mime: string; ukuran: string; dihapus: boolean }>(
      "SELECT pemilik_jenis, pemilik_id, nama, kunci, mime, ukuran, dihapus FROM sekretariat_berkas WHERE id = $1",
      [berkasId],
    )).rows[0];
    if (!row || row.dihapus) notFound();
    const path = this.pathFor(row.pemilik_jenis, row.kunci);
    try {
      await stat(path);
    } catch {
      throw new SekretariatError(410, "berkas_tidak_ada", "Berkas tidak ada lagi di server.");
    }
    return {
      nama: row.nama, mime: row.mime, ukuran: Number(row.ukuran), inline: INLINE.has(row.mime),
      pemilikJenis: row.pemilik_jenis, pemilikId: row.pemilik_id, stream: createReadStream(path),
    };
  }

  async listFor(db: Db, pemilikJenis: PemilikJenis, pemilikId: string) {
    const rows = await db.query<{ id: string; nama: string; mime: string; ukuran: string; sha256: string; terkunci: boolean }>(
      "SELECT id, nama, mime, ukuran, sha256, terkunci FROM sekretariat_berkas WHERE pemilik_jenis = $1 AND pemilik_id = $2 AND NOT dihapus ORDER BY diunggah_pada",
      [pemilikJenis, pemilikId],
    );
    return rows.rows.map((row) => ({ id: row.id, nama: row.nama, mime: row.mime, ukuran: Number(row.ukuran), sha256: row.sha256, terkunci: row.terkunci }));
  }

  /** Daily: files of rows deleted more than a day ago leave the disk (Kerja pattern). */
  async purgeDeleted(afterDays = 1): Promise<number> {
    const rows = await this.pool.query<{ id: string; pemilik_jenis: PemilikJenis; kunci: string }>(
      `SELECT id, pemilik_jenis, kunci FROM sekretariat_berkas
       WHERE dihapus AND berkas_dibuang_pada IS NULL AND dihapus_pada < now() - make_interval(days => $1) LIMIT 500`,
      [afterDays],
    );
    for (const row of rows.rows) {
      await unlink(this.pathFor(row.pemilik_jenis, row.kunci)).catch(() => undefined);
      await this.pool.query("UPDATE sekretariat_berkas SET berkas_dibuang_pada = now() WHERE id = $1", [row.id]);
    }
    return rows.rowCount ?? 0;
  }

  private pathFor(jenis: PemilikJenis, kunci: string): string {
    if (!/^[0-9a-f-]{36}$/.test(kunci)) throw new SekretariatError(500, "kunci_tidak_sah", "Kunci penyimpanan tidak sah.");
    return join(this.options.mediaRoot, jenis, kunci);
  }
}

async function diskFree(path: string): Promise<number> {
  const stats = await statfs(path);
  return Number(stats.bavail) * Number(stats.bsize);
}

/** Start-up check: the media root must exist and be writable (Kerja pattern). */
export async function assertMediaRoot(mediaRoot: string): Promise<void> {
  await mkdir(mediaRoot, { recursive: true, mode: 0o700 });
  const probe = join(mediaRoot, `.probe-${randomUUID()}`);
  const handle = await open(probe, "w", 0o600);
  await handle.close();
  await unlink(probe);
}
