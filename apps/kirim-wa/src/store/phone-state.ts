import type { Pool } from "pg";

import { columnAad, type WaCrypto } from "../crypto.js";
import type { WhatsAppLabel, WhatsAppLabelStore } from "../wa/service.js";

/**
 * KIRIM-IMPL-005 §3. What the phone tells us about itself through WhatsApp app-state: the
 * WhatsApp Business quick replies and the labels, including which labels sit on which chat.
 *
 * These lists are small (tens of entries) and the label writer reads them synchronously while a
 * change is in flight, so they are held in memory per number and written back as one sealed
 * document. That keeps the ported `applyChatLabels` unchanged, which is where the delicate part
 * is: it must put the module's own labels on a chat without ever touching the labels the
 * committee put there by hand.
 */

export interface QuickReplyRecord {
  waId: string;
  shortcut: string;
  message: string;
  deleted: boolean;
  updatedAt: string;
}

interface PhoneStateDocument {
  quickReplies: QuickReplyRecord[];
  labels: WhatsAppLabel[];
  chatLabels: Array<{ labelId: string; chatJid: string }>;
  /** When a whole app-state snapshot last landed; null means the lists may be incomplete. */
  labelsSyncedAt: string | null;
  quickRepliesResyncedAt: string | null;
}

const EMPTY: PhoneStateDocument = { quickReplies: [], labels: [], chatLabels: [], labelsSyncedAt: null, quickRepliesResyncedAt: null };

export class PhoneStateStore {
  private readonly documents = new Map<string, PhoneStateDocument>();
  private readonly dirty = new Set<string>();
  private flushing: Promise<void> | null = null;

  constructor(
    private readonly pool: Pool,
    private readonly crypto: WaCrypto,
    private readonly log: (entry: Record<string, unknown>, message: string) => void = () => undefined,
  ) {}

  async load(): Promise<void> {
    const result = await this.pool.query<{ kode: string; document_enc: string }>(`SELECT kode, document_enc FROM kirim_wa_phone_state`);
    this.documents.clear();
    for (const row of result.rows) {
      try {
        this.documents.set(row.kode, this.crypto.openJson<PhoneStateDocument>(row.document_enc, this.aad(row.kode)));
      } catch {
        // A document that cannot be opened is treated as absent: WhatsApp sends these lists again.
        this.log({ event: "kirim_wa.phone_state.unreadable", device: row.kode }, "phone state could not be opened; starting empty");
      }
    }
  }

  private read(kode: string): PhoneStateDocument {
    return this.documents.get(kode) ?? EMPTY;
  }

  quickReplies(kode: string): QuickReplyRecord[] {
    return this.read(kode).quickReplies;
  }

  upsertQuickReply(kode: string, entry: QuickReplyRecord): void {
    const document = this.read(kode);
    const quickReplies = document.quickReplies.filter((item) => item.waId !== entry.waId);
    quickReplies.push(entry);
    this.write(kode, { ...document, quickReplies });
  }

  markQuickRepliesResynced(kode: string, at: string): void {
    this.write(kode, { ...this.read(kode), quickRepliesResyncedAt: at });
  }

  /** The phone is asked for its quick replies at most once an hour; `false` means "skipped". */
  mayResyncQuickReplies(kode: string, minimumIntervalMs: number): boolean {
    const last = this.read(kode).quickRepliesResyncedAt;
    return !last || Date.now() - Date.parse(last) >= minimumIntervalMs;
  }

  upsertLabel(kode: string, label: WhatsAppLabel): void {
    const document = this.read(kode);
    const labels = document.labels.filter((item) => item.id !== label.id);
    labels.push(label);
    this.write(kode, { ...document, labels });
  }

  setChatLabel(kode: string, labelId: string, chatJid: string, labeled: boolean): void {
    const document = this.read(kode);
    const chatLabels = document.chatLabels.filter((item) => !(item.labelId === labelId && item.chatJid === chatJid));
    if (labeled) chatLabels.push({ labelId, chatJid });
    this.write(kode, { ...document, chatLabels });
  }

  markLabelsSnapshot(kode: string, startedAt: string): void {
    const document = this.read(kode);
    // A whole snapshot replaces what we thought: anything not heard since the snapshot started is
    // gone from the phone, so the lists are rebuilt from the events that followed it.
    this.write(kode, { ...document, labelsSyncedAt: startedAt });
  }

  /** Everything about this number is forgotten when its session is reset: it may be another phone next time. */
  forget(kode: string): void {
    this.write(kode, { ...EMPTY });
  }

  labelStore(kode: string): WhatsAppLabelStore {
    return {
      synced: () => this.read(kode).labelsSyncedAt !== null,
      labels: () => this.read(kode).labels,
      chatLabels: (chatJids) => this.read(kode).chatLabels.filter((item) => chatJids.includes(item.chatJid)),
    };
  }

  private write(kode: string, document: PhoneStateDocument): void {
    this.documents.set(kode, document);
    this.dirty.add(kode);
    void this.flush();
  }

  private flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    const run = (async () => {
      while (this.dirty.size > 0) {
        const codes = [...this.dirty];
        this.dirty.clear();
        for (const kode of codes) {
          const document = this.documents.get(kode);
          if (!document) continue;
          try {
            await this.pool.query(
              `INSERT INTO kirim_wa_phone_state (kode, document_enc, updated_at) VALUES ($1, $2, now())
               ON CONFLICT (kode) DO UPDATE SET document_enc = EXCLUDED.document_enc, updated_at = now()`,
              [kode, this.crypto.sealJson(document, this.aad(kode))],
            );
          } catch (error) {
            this.dirty.add(kode);
            this.log({ event: "kirim_wa.phone_state.write_failed", device: kode, errorType: error instanceof Error ? error.name : "unknown" }, "phone state not written; retrying");
          }
        }
        if (this.dirty.size > 0) await new Promise((done) => setTimeout(done, 1_000));
      }
    })().finally(() => {
      this.flushing = null;
    });
    this.flushing = run;
    return run;
  }

  private aad(kode: string): string {
    return columnAad("kirim_wa_phone_state", "document_enc", kode);
  }
}
