import { randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { z } from "zod";

import { mailboxAad, type SekretariatCrypto } from "./crypto.js";
import { invalid, isUuid, notFound, SekretariatError, withTransaction, writeAudit } from "./db.js";

/**
 * SEK-IMPL-002: mailboxes are connected from the admin screen, not from the Mi8 env. A row holds
 * the IMAP settings and the sealed password (M-2); the puller reads the active rows every round
 * (M-6). The password never leaves this file in clear text: it goes to the IMAP client and
 * nowhere else — not to the browser (M-3), not to the audit trail, not to a log line (M-12).
 */

export const mailboxSchema = z
  .object({
    alamat: z.string().trim().email().max(320),
    host: z.string().trim().min(1).max(255),
    port: z.number().int().min(1).max(65535).default(993),
    /** Most hosts use the address itself; cPanel allows a different login name. */
    pengguna: z.string().trim().min(1).max(320).optional(),
    /** Omitted on an edit = keep the stored password (M-3). Required when adding. */
    sandi: z.string().min(1).max(500).optional(),
    kotak_id: z.string().uuid(),
  })
  .strict();

export type MailboxInput = z.infer<typeof mailboxSchema>;

export const statusSchema = z.object({ status: z.enum(["aktif", "nonaktif"]) }).strict();

export type MailboxStatus = "aktif" | "nonaktif" | "auth_gagal";

/** What the admin screen may see. There is deliberately no password field of any shape. */
export interface MailboxRow {
  id: string;
  alamat: string;
  host: string;
  port: number;
  pengguna: string;
  kotak_id: string;
  kotak_nama: string;
  status: MailboxStatus;
  gagal_berturut: number;
  galat_terakhir: string | null;
  galat_pada: string | null;
  tarik_terakhir_pada: string | null;
  surat_masuk: number;
}

/** The decrypted settings the puller needs for one round. */
export interface MailboxRuntime {
  id: string;
  alamat: string;
  host: string;
  port: number;
  pengguna: string;
  sandi: string;
  kotakId: string;
}

/** Why a connection attempt failed, in terms the admin screen can act on. */
export type MailboxFailure = "sandi_ditolak" | "host_tidak_ditemukan" | "sertifikat" | "waktu_habis" | "lainnya";

export interface MailboxProbe {
  (settings: { host: string; port: number; user: string; pass: string }): Promise<void>;
}

const PESAN: Record<MailboxFailure, string> = {
  sandi_ditolak: "Server menolak pengguna atau sandinya. Periksa keduanya di cPanel, lalu coba lagi.",
  host_tidak_ditemukan: "Nama host tidak ditemukan. Periksa ejaannya.",
  sertifikat: "Sertifikat server tidak cocok dengan nama host itu.",
  waktu_habis: "Sambungan tidak terjawab. Server mungkin sedang tidak dapat dihubungi dari sini.",
  lainnya: "Sambungan gagal.",
};

/**
 * Classifies a failed connection without quoting the driver's message, which can carry the
 * server's own greeting. Only the shape of the failure reaches the screen and the database.
 */
export function classifyMailboxFailure(error: unknown): MailboxFailure {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  const lower = text.toLowerCase();
  // imapflow reports a refused login as AuthenticationFailedError, or an IMAP `NO ... LOGIN`.
  if (/authenticationfailed|\bauth\b.*(fail|reject|invalid)|invalid credentials|login failed|\bno\b.*\blogin\b/.test(lower)) {
    return "sandi_ditolak";
  }
  if (/enotfound|eai_again|getaddrinfo/.test(lower)) return "host_tidak_ditemukan";
  if (/cert|altname|self[- ]signed|unable to verify/.test(lower)) return "sertifikat";
  if (/etimedout|timeout|econnrefused|ehostunreach|enetunreach/.test(lower)) return "waktu_habis";
  return "lainnya";
}

export class SekretariatMailbox {
  constructor(
    private readonly pool: Pool,
    /** Absent when SEKRETARIAT_DATA_KEYS is not set: the screen then says so instead of failing oddly. */
    private readonly crypto: SekretariatCrypto | null,
    private readonly probe: MailboxProbe,
  ) {}

  get tersedia(): boolean {
    return this.crypto !== null;
  }

  private requireCrypto(): SekretariatCrypto {
    if (!this.crypto) {
      throw new SekretariatError(
        503,
        "kunci_belum_disiapkan",
        "SEKRETARIAT_DATA_KEYS belum diisi di server, jadi sandi mailbox belum dapat disimpan dengan aman.",
      );
    }
    return this.crypto;
  }

  async daftar(): Promise<MailboxRow[]> {
    const result = await this.pool.query<MailboxRow>(
      `SELECT m.id, m.alamat, m.host, m.port, m.pengguna, m.kotak_id,
              COALESCE(p.nama, 'Kotak yayasan') AS kotak_nama,
              m.status, m.gagal_berturut, m.galat_terakhir,
              to_char(m.galat_pada, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS galat_pada,
              to_char(m.tarik_terakhir_pada, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS tarik_terakhir_pada,
              (SELECT count(*) FROM sekretariat_surat_masuk sm WHERE sm.kotak_id = m.kotak_id AND sm.kanal = 'email')::int AS surat_masuk
         FROM sekretariat_mailbox m
         JOIN sekretariat_kotak k ON k.id = m.kotak_id
         LEFT JOIN sekretariat_penerbit p ON p.id = k.penerbit_id
        ORDER BY m.alamat`,
    );
    return result.rows;
  }

  /** The inboxes a mailbox may feed: the foundation one, and one per issuer (SEK-001 §13 nomor 8). */
  async kotakPilihan(): Promise<Array<{ id: string; nama: string }>> {
    const result = await this.pool.query<{ id: string; nama: string }>(
      `SELECT k.id, COALESCE(p.nama, 'Kotak yayasan') AS nama
         FROM sekretariat_kotak k
         LEFT JOIN sekretariat_penerbit p ON p.id = k.penerbit_id
        ORDER BY (k.jenis <> 'yayasan'), nama`,
    );
    return result.rows;
  }

  /**
   * M-4: the login is proven before the row is written, so a mailbox on the list is one that
   * answered. An edit that leaves the password out keeps the stored one and still re-tests it.
   */
  async simpan(input: MailboxInput, aktor: string, id?: string): Promise<MailboxRow> {
    const crypto = this.requireCrypto();
    if (id !== undefined && !isUuid(id)) notFound();
    const pengguna = input.pengguna?.trim() || input.alamat;

    const existing = id
      ? (await this.pool.query<{ id: string; sandi_terenkripsi: string }>(
          "SELECT id, sandi_terenkripsi FROM sekretariat_mailbox WHERE id = $1",
          [id],
        )).rows[0]
      : undefined;
    if (id && !existing) notFound();

    let sandi: string;
    if (input.sandi) {
      sandi = input.sandi;
    } else if (existing) {
      sandi = crypto.open(existing.sandi_terenkripsi, mailboxAad(existing.id));
    } else {
      invalid("Sandi mailbox wajib diisi saat menambah.", "sandi_wajib");
    }

    const kotak = (await this.pool.query<{ id: string }>("SELECT id FROM sekretariat_kotak WHERE id = $1", [input.kotak_id])).rows[0];
    if (!kotak) invalid("Kotak tujuan tidak dikenal.", "kotak_tidak_dikenal");

    try {
      await this.probe({ host: input.host, port: input.port, user: pengguna, pass: sandi });
    } catch (error) {
      const sebab = classifyMailboxFailure(error);
      throw new SekretariatError(400, `sambungan_${sebab}`, PESAN[sebab]);
    }

    const rowId = existing?.id ?? randomUUID();
    const sealed = crypto.seal(sandi, mailboxAad(rowId));

    await withTransaction(this.pool, async (client) => {
      if (existing) {
        await client.query(
          `UPDATE sekretariat_mailbox
              SET alamat = $2, host = $3, port = $4, pengguna = $5, sandi_terenkripsi = $6, kotak_id = $7,
                  status = 'aktif', gagal_berturut = 0, galat_terakhir = NULL, galat_pada = NULL,
                  diubah_oleh = $8, diubah_pada = now()
            WHERE id = $1`,
          [rowId, input.alamat, input.host, input.port, pengguna, sealed, input.kotak_id, aktor],
        );
      } else {
        const bentrok = await client.query("SELECT 1 FROM sekretariat_mailbox WHERE alamat = $1", [input.alamat]);
        if ((bentrok.rowCount ?? 0) > 0) invalid("Alamat itu sudah terdaftar.", "alamat_ganda");
        await client.query(
          `INSERT INTO sekretariat_mailbox (id, alamat, host, port, pengguna, sandi_terenkripsi, kotak_id, dibuat_oleh)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [rowId, input.alamat, input.host, input.port, pengguna, sealed, input.kotak_id, aktor],
        );
      }
      await writeAudit(client, {
        aktor,
        aksi: existing ? "mailbox.ubah" : "mailbox.tambah",
        objekJenis: "sekretariat_mailbox",
        objekRef: input.alamat,
        metadata: { host: input.host, port: input.port, kotak_id: input.kotak_id, sandi_diganti: Boolean(input.sandi) },
      });
    });

    const saved = (await this.daftar()).find((row) => row.id === rowId);
    if (!saved) notFound();
    return saved;
  }

  async ubahStatus(id: string, status: "aktif" | "nonaktif", aktor: string): Promise<MailboxRow> {
    if (!isUuid(id)) notFound();
    await withTransaction(this.pool, async (client) => {
      const updated = await client.query<{ alamat: string }>(
        `UPDATE sekretariat_mailbox
            SET status = $2, gagal_berturut = CASE WHEN $2 = 'aktif' THEN 0 ELSE gagal_berturut END,
                diubah_oleh = $3, diubah_pada = now()
          WHERE id = $1 RETURNING alamat`,
        [id, status, aktor],
      );
      const row = updated.rows[0];
      if (!row) notFound();
      await writeAudit(client, {
        aktor,
        aksi: status === "aktif" ? "mailbox.aktif" : "mailbox.nonaktif",
        objekJenis: "sekretariat_mailbox",
        objekRef: row.alamat,
      });
    });
    const saved = (await this.daftar()).find((row) => row.id === id);
    if (!saved) notFound();
    return saved;
  }

  /** M-11: the letters already registered stay; only the connection goes. */
  async hapus(id: string, aktor: string): Promise<void> {
    if (!isUuid(id)) notFound();
    await withTransaction(this.pool, async (client) => {
      const removed = await client.query<{ alamat: string }>("DELETE FROM sekretariat_mailbox WHERE id = $1 RETURNING alamat", [id]);
      const row = removed.rows[0];
      if (!row) notFound();
      await writeAudit(client, { aktor, aksi: "mailbox.hapus", objekJenis: "sekretariat_mailbox", objekRef: row.alamat });
    });
  }

  /** The puller's view: active rows with the password opened, newest configuration each round. */
  async aktif(): Promise<MailboxRuntime[]> {
    if (!this.crypto) return [];
    const result = await this.pool.query<{
      id: string;
      alamat: string;
      host: string;
      port: number;
      pengguna: string;
      sandi_terenkripsi: string;
      kotak_id: string;
    }>(
      `SELECT id, alamat, host, port, pengguna, sandi_terenkripsi, kotak_id
         FROM sekretariat_mailbox WHERE status = 'aktif' ORDER BY alamat`,
    );
    const runtimes: MailboxRuntime[] = [];
    for (const row of result.rows) {
      try {
        runtimes.push({
          id: row.id,
          alamat: row.alamat,
          host: row.host,
          port: row.port,
          pengguna: row.pengguna,
          sandi: this.crypto.open(row.sandi_terenkripsi, mailboxAad(row.id)),
          kotakId: row.kotak_id,
        });
      } catch {
        // A row sealed with a key that is no longer configured. Say so on the screen, do not crash
        // the round, and never retry blindly.
        await this.catatGagal(row.id, "lainnya", "kunci tidak cocok");
      }
    }
    return runtimes;
  }

  async catatSukses(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE sekretariat_mailbox
          SET tarik_terakhir_pada = now(), gagal_berturut = 0, galat_terakhir = NULL, galat_pada = NULL
        WHERE id = $1`,
      [id],
    );
  }

  /** M-8: five consecutive authentication refusals park the mailbox instead of hammering it. */
  async catatGagal(id: string, sebab: MailboxFailure, catatan?: string): Promise<void> {
    await this.pool.query(
      `UPDATE sekretariat_mailbox
          SET gagal_berturut = gagal_berturut + 1,
              galat_terakhir = $2,
              galat_pada = now(),
              status = CASE WHEN $3 AND gagal_berturut + 1 >= 5 THEN 'auth_gagal' ELSE status END
        WHERE id = $1`,
      [id, (catatan ?? PESAN[sebab]).slice(0, 200), sebab === "sandi_ditolak"],
    );
  }
}
