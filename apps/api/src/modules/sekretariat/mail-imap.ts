import type { FetchedMail, MailFetcher, MailState } from "./mail.js";

/**
 * SEK-IMPL-001 §2 "Email": the imapflow adapter. Strictly read-only — the mailbox is opened
 * read-only, nothing is deleted, moved or flagged, and webmail keeps working as before. One
 * connection per round: connect, read, logout. imapflow and mailparser are loaded lazily so the
 * `log` mode never requires them at runtime.
 */
export class ImapMailFetcher implements MailFetcher {
  readonly mailbox: string;

  constructor(
    private readonly options: { host: string; port: number; user: string; pass: string },
  ) {
    this.mailbox = options.user;
  }

  async fetchNew(state: MailState, limit: number): Promise<{ uidValidity: string; mails: FetchedMail[] }> {
    const { ImapFlow } = await import("imapflow");
    const { simpleParser } = await import("mailparser");
    const client = new ImapFlow({
      host: this.options.host,
      port: this.options.port,
      secure: this.options.port === 993,
      auth: { user: this.options.user, pass: this.options.pass },
      logger: false,
    });
    await client.connect();
    try {
      const box = await client.mailboxOpen("INBOX", { readOnly: true });
      const uidValidity = String(box.uidValidity);
      const sinceUid = state.uidValidity === uidValidity ? state.lastUid : 0;
      const mails: FetchedMail[] = [];
      for await (const message of client.fetch(`${sinceUid + 1}:*`, { uid: true, source: true }, { uid: true })) {
        // The `n:*` range returns the last message even when its UID is below n; skip it.
        if (message.uid <= sinceUid) continue;
        if (!message.source) continue;
        const parsed = await simpleParser(message.source);
        mails.push({
          uid: message.uid,
          messageId: parsed.messageId ?? null,
          dari: parsed.from?.text ?? "",
          perihal: parsed.subject ?? "",
          tanggal: parsed.date ?? null,
          teks: parsed.text ?? "",
          lampiran: (parsed.attachments ?? [])
            .filter((attachment) => attachment.content.length > 0)
            .map((attachment) => ({ nama: attachment.filename ?? "lampiran", isi: attachment.content })),
        });
        if (mails.length >= limit) break;
      }
      mails.sort((a, b) => a.uid - b.uid);
      return { uidValidity, mails };
    } finally {
      await client.logout().catch(() => undefined);
    }
  }
}
