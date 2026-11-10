import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, open, rename, rm, stat, statfs, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { Pool, PoolClient } from "pg";

import { requireCardWritable, requireRoom, requireVia, type Viewer } from "./access.js";
import { forbidden, KerjaError, withTransaction, type Db } from "./db.js";
import type { KerjaDirectory } from "./directory.js";
import type { CopyAttachments } from "./papan.js";
import { personRef, usedBytes } from "./ruang.js";

export type OwnerKind = "kartu" | "ceklis_item" | "ruang";

export interface AttachmentOptions {
  mediaRoot: string;
  maxUploadBytes: number;
  roomQuotaBytes: number;
  minFreeDiskBytes: number;
  /** Test seam for the free-space check (§9 "Disk rendah"). */
  freeBytes?: (path: string) => Promise<number>;
}

/** KERJA-IMPL-001 §9: allowlisted kinds, decided from the file's first bytes, not its name. */
const OFFICE_ZIP: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  zip: "application/zip",
};
const OFFICE_OLE: Record<string, string> = { doc: "application/msword", xls: "application/vnd.ms-excel", ppt: "application/vnd.ms-powerpoint" };
const TEXT: Record<string, string> = { txt: "text/plain", csv: "text/csv", md: "text/markdown" };
/** Shown in the browser; everything else is always a download. */
const INLINE = new Set(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"]);

export function detectKind(head: Buffer, filename: string): string | null {
  const ext = filename.toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1] ?? "";
  const starts = (bytes: number[], offset = 0) => bytes.every((byte, index) => head[offset + index] === byte);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (starts([0x50, 0x4b, 0x03, 0x04])) return OFFICE_ZIP[ext] ?? "application/zip";
  if (starts([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return OFFICE_OLE[ext] ?? null;
  if (head.length > 0 && !head.includes(0) && isUtf8(head)) return TEXT[ext] ?? "text/plain";
  return null;
}

function isUtf8(buffer: Buffer): boolean {
  // A multi-byte character may be cut at the end of the sample; drop up to three trailing bytes.
  for (let cut = 0; cut <= 3 && cut < buffer.length; cut += 1) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, buffer.length - cut));
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

export function safeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex -- control characters are exactly what must be removed
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
  return cleaned.length > 0 ? cleaned : "berkas";
}

export class KerjaAttachments implements CopyAttachments {
  constructor(
    private readonly pool: Pool,
    private readonly directory: KerjaDirectory,
    private readonly options: AttachmentOptions,
  ) {}

  get maxUploadBytes(): number {
    return this.options.maxUploadBytes;
  }

  /** Who may upload to which owner: pj and anggota of the owner's room (§7.3). */
  async authorizeUpload(viewer: Viewer, kind: OwnerKind, ownerId: string): Promise<string> {
    if (kind === "ruang") return (await requireRoom(this.pool, ownerId, viewer, "kerja")).ruangId;
    if (kind === "kartu") {
      const akses = await requireVia(this.pool, "kartu", ownerId, viewer, "kerja");
      await requireCardWritable(this.pool, ownerId);
      return akses.ruangId;
    }
    const akses = await requireVia(this.pool, "item", ownerId, viewer, "kerja");
    const card = (await this.pool.query<{ kartu_id: string }>("SELECT c.kartu_id FROM kerja_ceklis_item i JOIN kerja_ceklis c ON c.id = i.ceklis_id WHERE i.id = $1", [ownerId])).rows[0]!;
    await requireCardWritable(this.pool, card.kartu_id);
    return akses.ruangId;
  }

  /** Checked before reading the upload, and again before it is kept. */
  async assertDiskRoom(): Promise<void> {
    await mkdir(this.options.mediaRoot, { recursive: true, mode: 0o700 });
    const free = await (this.options.freeBytes ?? diskFree)(this.options.mediaRoot);
    if (free < this.options.minFreeDiskBytes) {
      throw new KerjaError(507, "disk_hampir_penuh", "Ruang penyimpanan server hampir penuh. Unggahan ditolak sementara; hubungi pengelola Kerja.");
    }
  }

  /**
   * Streams the upload to a temporary file while hashing it, then checks size, kind, quota and
   * disk before it gets its storage key. Nothing stays on disk when any check fails.
   */
  async store(viewer: Viewer, kind: OwnerKind, ownerId: string, ruangId: string, file: { filename: string; stream: Readable; truncated: () => boolean }) {
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
        throw new KerjaError(413, "lampiran_terlalu_besar", `Lampiran melebihi batas ${Math.round(this.options.maxUploadBytes / 1024 / 1024)} MB.`);
      }
      if (size === 0) throw new KerjaError(400, "lampiran_kosong", "Berkas kosong.");
      const nama = safeFilename(file.filename);
      const mime = detectKind(head, nama);
      if (!mime) throw new KerjaError(415, "jenis_berkas_ditolak", "Jenis berkas ini tidak diterima. Kirim PDF, gambar, dokumen Office, teks, atau zip.");
      await this.assertDiskRoom();
      const kunci = randomUUID();
      const id = randomUUID();
      await withTransaction(this.pool, async (client) => {
        await this.assertQuota(client, ruangId, size);
        await mkdir(join(this.options.mediaRoot, ruangId), { recursive: true, mode: 0o700 });
        await rename(tmpPath, this.pathFor(ruangId, kunci));
        await client.query(
          `INSERT INTO kerja_lampiran (id, ruang_id, pemilik_jenis, pemilik_id, nama, kunci_penyimpanan, mime, ukuran, sha256, diunggah_oleh)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [id, ruangId, kind, ownerId, nama, kunci, mime, size, hash.digest("hex"), viewer.actor],
        );
      }).catch(async (error: unknown) => {
        await rm(this.pathFor(ruangId, kunci), { force: true });
        throw error;
      });
      return { id, nama, mime, ukuran: size };
    } finally {
      await rm(tmpPath, { force: true });
    }
  }

  /** §9 "Unduh": membership is checked first; the stored name is never part of the disk path. */
  async open(viewer: Viewer, lampiranId: string) {
    await requireVia(this.pool, "lampiran", lampiranId, viewer, "baca");
    const row = (await this.pool.query<{ ruang_id: string; nama: string; mime: string; ukuran: string; kunci_penyimpanan: string; di_arsip: boolean }>(
      "SELECT ruang_id, nama, mime, ukuran, kunci_penyimpanan, di_arsip FROM kerja_lampiran WHERE id = $1",
      [lampiranId],
    )).rows[0]!;
    if (row.di_arsip) throw new KerjaError(410, "lampiran_di_arsip", "Berkas ini sudah dipindah ke arsip. Minta pengelola Kerja mengambilkannya.");
    const path = this.pathFor(row.ruang_id, row.kunci_penyimpanan);
    try {
      await stat(path);
    } catch {
      throw new KerjaError(410, "berkas_tidak_ada", "Berkas tidak ada lagi di server.");
    }
    return { nama: row.nama, mime: row.mime, ukuran: Number(row.ukuran), inline: INLINE.has(row.mime), stream: createReadStream(path) };
  }

  /** Marked deleted now; the file itself goes with the retention job, not immediately (§9). */
  async remove(viewer: Viewer, lampiranId: string) {
    const akses = await requireVia(this.pool, "lampiran", lampiranId, viewer, "kerja");
    const row = (await this.pool.query<{ diunggah_oleh: string; pemilik_jenis: OwnerKind; pemilik_id: string }>(
      "SELECT diunggah_oleh, pemilik_jenis, pemilik_id FROM kerja_lampiran WHERE id = $1",
      [lampiranId],
    )).rows[0]!;
    if (row.diunggah_oleh !== viewer.actor && akses.peran !== "pj") forbidden("Hanya pengunggah atau penanggung jawab ruang yang bisa menghapus lampiran.");
    if (row.pemilik_jenis === "kartu") await requireCardWritable(this.pool, row.pemilik_id);
    await this.pool.query("UPDATE kerja_lampiran SET dihapus = true, dihapus_pada = now(), dihapus_oleh = $2 WHERE id = $1", [lampiranId, viewer.actor]);
    return { id: lampiranId };
  }

  /** §8 Berkas ruang: room-level files and the room's remaining quota. */
  async roomFiles(viewer: Viewer, ruangId: string) {
    await requireRoom(this.pool, ruangId, viewer, "baca");
    const view = await this.directory.view();
    const rows = await this.pool.query<{ id: string; nama: string; mime: string; ukuran: string; diunggah_oleh: string; diunggah_pada: Date; di_arsip: boolean }>(
      `SELECT id, nama, mime, ukuran, diunggah_oleh, diunggah_pada, di_arsip FROM kerja_lampiran
       WHERE ruang_id = $1 AND pemilik_jenis = 'ruang' AND NOT dihapus ORDER BY diunggah_pada DESC`,
      [ruangId],
    );
    return {
      items: rows.rows.map((row) => ({
        id: row.id, nama: row.nama, mime: row.mime, ukuran: Number(row.ukuran), diunggahOleh: personRef(view, row.diunggah_oleh),
        diunggahPada: row.diunggah_pada.toISOString(), diArsip: row.di_arsip,
      })),
      kuota: { terpakai: await usedBytes(this.pool, ruangId), batas: await this.quota(this.pool, ruangId) },
    };
  }

  /** §6.3 "lampiran": each copied file gets its own storage key and counts against the quota. */
  async discard(paths: string[]): Promise<void> {
    await Promise.all(paths.map((path) => rm(path, { force: true })));
  }

  async copyForCard(client: PoolClient, input: { fromKartuId: string; toKartuId: string; ruangId: string; actor: string; written: string[] }): Promise<void> {
    const rows = (await client.query<{ nama: string; mime: string; ukuran: string; sha256: string; kunci_penyimpanan: string }>(
      "SELECT nama, mime, ukuran, sha256, kunci_penyimpanan FROM kerja_lampiran WHERE pemilik_jenis = 'kartu' AND pemilik_id = $1 AND NOT dihapus AND NOT di_arsip",
      [input.fromKartuId],
    )).rows;
    if (rows.length === 0) return;
    const total = rows.reduce((sum, row) => sum + Number(row.ukuran), 0);
    await this.assertDiskRoom();
    await this.assertQuota(client, input.ruangId, total);
    const written = input.written;
    try {
      for (const row of rows) {
        const kunci = randomUUID();
        const target = this.pathFor(input.ruangId, kunci);
        await copyFile(this.pathFor(input.ruangId, row.kunci_penyimpanan), target);
        written.push(target);
        await client.query(
          `INSERT INTO kerja_lampiran (id, ruang_id, pemilik_jenis, pemilik_id, nama, kunci_penyimpanan, mime, ukuran, sha256, diunggah_oleh)
           VALUES ($1, $2, 'kartu', $3, $4, $5, $6, $7, $8, $9)`,
          [randomUUID(), input.ruangId, input.toKartuId, row.nama, kunci, row.mime, row.ukuran, row.sha256, input.actor],
        );
      }
    } catch (error) {
      await Promise.all(written.map((path) => rm(path, { force: true })));
      throw error;
    }
  }

  /** Daily: files of attachments deleted more than `afterDays` ago leave the disk. */
  async purgeDeleted(afterDays = 30): Promise<number> {
    const rows = await this.pool.query<{ id: string; ruang_id: string; kunci_penyimpanan: string }>(
      `SELECT id, ruang_id, kunci_penyimpanan FROM kerja_lampiran
       WHERE dihapus AND berkas_dibuang_pada IS NULL AND dihapus_pada < now() - make_interval(days => $1) LIMIT 500`,
      [afterDays],
    );
    for (const row of rows.rows) {
      await unlink(this.pathFor(row.ruang_id, row.kunci_penyimpanan)).catch(() => undefined);
      await this.pool.query("UPDATE kerja_lampiran SET berkas_dibuang_pada = now() WHERE id = $1", [row.id]);
    }
    return rows.rowCount ?? 0;
  }

  async quota(db: Db, ruangId: string): Promise<number> {
    const result = await db.query<{ kuota_bytes: string | null }>("SELECT kuota_bytes FROM kerja_ruang WHERE id = $1", [ruangId]);
    return result.rows[0]?.kuota_bytes ? Number(result.rows[0].kuota_bytes) : this.options.roomQuotaBytes;
  }

  private async assertQuota(client: PoolClient, ruangId: string, adding: number) {
    // Serializes uploads within one room so two at once cannot both slip under the quota.
    await client.query("SELECT id FROM kerja_ruang WHERE id = $1 FOR UPDATE", [ruangId]);
    const used = await usedBytes(client, ruangId);
    const limit = await this.quota(client, ruangId);
    if (used + adding > limit) {
      throw new KerjaError(413, "kuota_ruang_habis", `Kuota lampiran ruang ini (${Math.round(limit / 1024 / 1024)} MB) tidak cukup. Hapus lampiran lama atau minta pengelola Kerja menaikkan kuota.`);
    }
  }

  private pathFor(ruangId: string, kunci: string): string {
    if (!/^[0-9a-f-]{36}$/.test(ruangId) || !/^[0-9a-f-]{36}$/.test(kunci)) throw new KerjaError(500, "kunci_tidak_sah", "Kunci penyimpanan tidak sah.");
    return join(this.options.mediaRoot, ruangId, kunci);
  }
}

async function diskFree(path: string): Promise<number> {
  const stats = await statfs(path);
  return Number(stats.bavail) * Number(stats.bsize);
}

/** Exported for the media-root check at start-up: the directory must exist and be writable. */
export async function assertMediaRoot(mediaRoot: string): Promise<void> {
  await mkdir(mediaRoot, { recursive: true, mode: 0o700 });
  const probe = join(mediaRoot, `.probe-${randomUUID()}`);
  const handle = await open(probe, "w", 0o600);
  await handle.close();
  await unlink(probe);
}
