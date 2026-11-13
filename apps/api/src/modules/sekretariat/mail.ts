import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import type { Pool } from "pg";

import type { SekretariatBerkas } from "./berkas.js";

/**
 * SEK-IMPL-001 §7 nomor 1: a replaceable fetcher (the Kirim SQ engine pattern) reads the
 * foundation mailbox over read-only IMAP: nothing in the mailbox is deleted, moved or flagged.
 * Progress is UIDVALIDITY plus the last ingested UID; a generation change re-reads with
 * Message-ID deduplication. Message content is third-party data and never reaches the logs.
 */

export interface FetchedMail {
  uid: number;
  messageId: string | null;
  dari: string;
  perihal: string;
  tanggal: Date | null;
  teks: string;
  lampiran: Array<{ nama: string; isi: Buffer }>;
}

export interface MailState {
  uidValidity: string | null;
  lastUid: number;
}

export interface MailFetcher {
  readonly mailbox: string;
  fetchNew(state: MailState, limit: number): Promise<{ uidValidity: string; mails: FetchedMail[] }>;
}

/** The development adapter: an empty mailbox. */
export class LogMailFetcher implements MailFetcher {
  readonly mailbox = "log";

  async fetchNew(state: MailState): Promise<{ uidValidity: string; mails: FetchedMail[] }> {
    return { uidValidity: state.uidValidity ?? "log", mails: [] };
  }
}

export interface IngestResult {
  baru: number;
  dilewati: number;
}

export class SekretariatMail {
  constructor(
    private readonly pool: Pool,
    private readonly fetcher: MailFetcher,
    private readonly berkas: SekretariatBerkas,
    private readonly maxAttachmentBytes: number,
    private readonly log: (entry: Record<string, unknown>, message: string) => void = () => undefined,
  ) {}

  /**
   * One round: read new messages, register each into the foundation inbox and advance the UID in
   * the same transaction per message, so a crash mid-batch never duplicates. IMAP errors land in
   * sekretariat_mail_state for the admin screen and never stop the module (§7 nomor 5).
   */
  async runOnce(): Promise<IngestResult> {
    const state = await this.readState();
    let fetched: { uidValidity: string; mails: FetchedMail[] };
    try {
      fetched = await this.fetcher.fetchNew(state, 50);
    } catch (error) {
      await this.pool.query(
        `INSERT INTO sekretariat_mail_state (mailbox, galat_terakhir, galat_pada) VALUES ($1, $2, now())
         ON CONFLICT (mailbox) DO UPDATE SET galat_terakhir = EXCLUDED.galat_terakhir, galat_pada = now()`,
        [this.fetcher.mailbox, error instanceof Error ? error.name : "unknown"],
      );
      this.log({ event: "sekretariat.mail.failed", errorType: error instanceof Error ? error.name : "unknown" }, "sekretariat mail round failed");
      return { baru: 0, dilewati: 0 };
    }
    const generationChanged = state.uidValidity !== null && state.uidValidity !== fetched.uidValidity;
    const kotakYayasan = (await this.pool.query<{ id: string }>("SELECT id FROM sekretariat_kotak WHERE jenis = 'yayasan'")).rows[0];
    if (!kotakYayasan) throw new Error("kotak yayasan belum ada; jalankan migration 0020");
    let baru = 0;
    let dilewati = 0;
    for (const mail of fetched.mails) {
      const inserted = await this.ingestOne(kotakYayasan.id, fetched.uidValidity, mail);
      if (inserted) baru += 1;
      else dilewati += 1;
    }
    await this.pool.query(
      `INSERT INTO sekretariat_mail_state (mailbox, uidvalidity, uid_terakhir, terakhir_tarik_pada, galat_terakhir, galat_pada)
       VALUES ($1, $2, $3, now(), NULL, NULL)
       ON CONFLICT (mailbox) DO UPDATE SET uidvalidity = EXCLUDED.uidvalidity,
         uid_terakhir = CASE WHEN sekretariat_mail_state.uidvalidity IS DISTINCT FROM EXCLUDED.uidvalidity
                             THEN EXCLUDED.uid_terakhir ELSE GREATEST(sekretariat_mail_state.uid_terakhir, EXCLUDED.uid_terakhir) END,
         terakhir_tarik_pada = now(), galat_terakhir = NULL, galat_pada = NULL`,
      [this.fetcher.mailbox, fetched.uidValidity, fetched.mails.reduce((max, mail) => Math.max(max, mail.uid), generationChanged ? 0 : state.lastUid)],
    );
    return { baru, dilewati };
  }

  private async ingestOne(kotakId: string, uidValidity: string, mail: FetchedMail): Promise<boolean> {
    const id = randomUUID();
    const inserted = await this.pool.query(
      `INSERT INTO sekretariat_surat_masuk (id, kotak_id, kanal, dari, perihal, isi_teks, diterima_pada, email_message_id, email_uidvalidity, email_uid)
       VALUES ($1, $2, 'email', $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT DO NOTHING`,
      [
        id,
        kotakId,
        mail.dari.slice(0, 300) || "(tanpa pengirim)",
        mail.perihal.slice(0, 500),
        mail.teks.slice(0, 200_000),
        mail.tanggal ?? new Date(),
        mail.messageId,
        uidValidity,
        mail.uid,
      ],
    );
    if ((inserted.rowCount ?? 0) === 0) return false;
    for (const lampiran of mail.lampiran) {
      if (lampiran.isi.length === 0) continue;
      if (lampiran.isi.length > this.maxAttachmentBytes) {
        // D-2: too large — recorded as a note, the file stays in webmail.
        await this.pool.query(
          `UPDATE sekretariat_surat_masuk SET isi_teks = left(isi_teks || $2, 200000) WHERE id = $1`,
          [id, `\n[Lampiran "${lampiran.nama.slice(0, 120)}" terlalu besar — buka di webmail]`],
        );
        continue;
      }
      try {
        await this.berkas.store(
          "system:mail",
          { jenis: "surat_masuk", id },
          { filename: lampiran.nama || "lampiran", stream: Readable.from(lampiran.isi), truncated: () => false },
          "lampiran-email",
        );
      } catch (error) {
        // An unsupported kind is a note, not a failure of the whole message.
        await this.pool.query(
          `UPDATE sekretariat_surat_masuk SET isi_teks = left(isi_teks || $2, 200000) WHERE id = $1`,
          [id, `\n[Lampiran "${lampiran.nama.slice(0, 120)}" tidak tersimpan — buka di webmail]`],
        );
        this.log({ event: "sekretariat.mail.attachment_skipped", errorType: error instanceof Error ? error.name : "unknown" }, "sekretariat mail attachment skipped");
      }
    }
    return true;
  }

  async readState(): Promise<MailState> {
    const row = (await this.pool.query<{ uidvalidity: string | null; uid_terakhir: string }>(
      "SELECT uidvalidity, uid_terakhir FROM sekretariat_mail_state WHERE mailbox = $1",
      [this.fetcher.mailbox],
    )).rows[0];
    return { uidValidity: row?.uidvalidity ?? null, lastUid: row ? Number(row.uid_terakhir) : 0 };
  }

  /** For the admin screen (§9): state and last error, never message content. */
  async status() {
    const rows = await this.pool.query<{ mailbox: string; uidvalidity: string | null; uid_terakhir: string; terakhir_tarik_pada: Date | null; galat_terakhir: string | null; galat_pada: Date | null }>(
      "SELECT mailbox, uidvalidity, uid_terakhir, terakhir_tarik_pada, galat_terakhir, galat_pada FROM sekretariat_mail_state ORDER BY mailbox",
    );
    return {
      items: rows.rows.map((row) => ({
        mailbox: row.mailbox,
        uidTerakhir: Number(row.uid_terakhir),
        terakhirTarikPada: row.terakhir_tarik_pada?.toISOString() ?? null,
        galatTerakhir: row.galat_terakhir,
        galatPada: row.galat_pada?.toISOString() ?? null,
      })),
    };
  }
}
