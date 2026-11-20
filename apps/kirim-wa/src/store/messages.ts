import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

import { columnAad, type WaCrypto } from "../crypto.js";

/**
 * KIRIM-IMPL-005 §7. The worker's message index.
 *
 * Kirim SQ owns the lasting conversation history; this table exists for the two things only the
 * engine can answer:
 *
 * 1. **An anchor for "fetch older messages".** Baileys asks WhatsApp for history relative to a
 *    message it already has — its key and its timestamp — so the engine has to remember the
 *    oldest message it knows per chat.
 * 2. **The copy WhatsApp pushes at link time.** When a number is linked, WhatsApp sends a chunk
 *    of its recent history unasked. That chunk is the only copy of those messages anywhere, so
 *    Kirim SQ can import from it later (`source: "stored"`).
 *
 * Bodies are sealed with the worker's own key (§12), and rows age out (§7) because the Hub has
 * the copy that is meant to last.
 */

export interface IndexedMessage {
  whatsappMessageId: string;
  direction: "inbound" | "outbound";
  chatJid: string;
  senderJid: string | null;
  messageType: string;
  body: string | null;
  occurredAt: string;
  fromMe: boolean;
  media: { id: string; mimeType: string; sizeBytes: number; sha256: string | null } | null;
}

export interface HistoryChatSummary {
  chatJid: string;
  phoneDigits: string | null;
  messageCount: number;
}

export type HistoryImportState = "awaiting" | "completed" | "failed";

export interface HistoryImportRecord {
  id: string;
  kode: string;
  chatJid: string;
  source: "whatsapp" | "stored";
  state: HistoryImportState;
  reason: string | null;
  /** The request id Baileys gave for a `fetchMessageHistory` call, to match its answer. */
  providerRequestId: string | null;
}

export class MessageIndex {
  constructor(
    private readonly pool: Pool,
    private readonly crypto: WaCrypto,
  ) {}

  /**
   * Writes one message, keyed by the WhatsApp message id so the same message heard twice (live
   * and again in a history chunk) stays one row.
   */
  async record(kode: string, message: IndexedMessage, bootstrap = false): Promise<void> {
    const id = randomUUID();
    await this.pool.query(
      `INSERT INTO kirim_wa_messages (
         id, kode, wa_message_id, chat_jid, sender_jid, from_me, direction, message_type,
         occurred_at, body_enc, media_id, bootstrap, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
       ON CONFLICT (kode, wa_message_id) DO UPDATE
         SET bootstrap = kirim_wa_messages.bootstrap OR EXCLUDED.bootstrap,
             media_id = coalesce(EXCLUDED.media_id, kirim_wa_messages.media_id)`,
      [
        id,
        kode,
        message.whatsappMessageId,
        message.chatJid,
        message.senderJid,
        message.fromMe,
        message.direction,
        message.messageType,
        message.occurredAt,
        message.body ? this.crypto.seal(message.body, columnAad("kirim_wa_messages", "body_enc", message.whatsappMessageId)) : null,
        message.media ? JSON.stringify(message.media) : null,
        bootstrap,
      ],
    );
  }

  async recordMany(kode: string, messages: IndexedMessage[], bootstrap = false): Promise<void> {
    for (const message of messages) await this.record(kode, message, bootstrap);
  }

  /** The oldest message this worker knows in a chat: the anchor a history request needs. */
  async oldestAnchor(kode: string, chatJid: string): Promise<{ whatsappMessageId: string; fromMe: boolean; timestampMs: number } | null> {
    const result = await this.pool.query<{ wa_message_id: string; from_me: boolean; occurred_at: Date }>(
      `SELECT wa_message_id, from_me, occurred_at FROM kirim_wa_messages
        WHERE kode = $1 AND chat_jid = $2 ORDER BY occurred_at ASC, wa_message_id ASC LIMIT 1`,
      [kode, chatJid],
    );
    const row = result.rows[0];
    return row ? { whatsappMessageId: row.wa_message_id, fromMe: row.from_me, timestampMs: row.occurred_at.getTime() } : null;
  }

  /** KIRIM-IMPL-002 §10.3: the private chats in the copy WhatsApp pushed, newest first. */
  async historyChats(kode: string, page: number, pageSize: number): Promise<{ chats: HistoryChatSummary[]; hasMore: boolean }> {
    const result = await this.pool.query<{ chat_jid: string; count: string; newest: Date }>(
      `SELECT chat_jid, count(*)::text AS count, max(occurred_at) AS newest
         FROM kirim_wa_messages
        WHERE kode = $1 AND bootstrap AND chat_jid NOT LIKE '%@g.us'
        GROUP BY chat_jid ORDER BY newest DESC
        LIMIT $2 OFFSET $3`,
      [kode, pageSize + 1, page * pageSize],
    );
    const hasMore = result.rows.length > pageSize;
    return {
      chats: result.rows.slice(0, pageSize).map((row) => ({
        chatJid: row.chat_jid,
        phoneDigits: /^(\d{8,15})(?::\d+)?@s\.whatsapp\.net$/.exec(row.chat_jid)?.[1] ?? null,
        messageCount: Number(row.count),
      })),
      hasMore,
    };
  }

  async messagesForChat(kode: string, chatJid: string, page: number, pageSize: number): Promise<{ messages: IndexedMessage[]; hasMore: boolean }> {
    const result = await this.pool.query<MessageRow>(
      `SELECT wa_message_id, chat_jid, sender_jid, from_me, direction, message_type, occurred_at, body_enc, media_id
         FROM kirim_wa_messages
        WHERE kode = $1 AND chat_jid = $2
        ORDER BY occurred_at DESC, wa_message_id DESC
        LIMIT $3 OFFSET $4`,
      [kode, chatJid, pageSize + 1, page * pageSize],
    );
    const hasMore = result.rows.length > pageSize;
    return { messages: result.rows.slice(0, pageSize).map((row) => this.fromRow(row)), hasMore };
  }

  async hasChat(kode: string, chatJid: string): Promise<boolean> {
    const result = await this.pool.query(`SELECT 1 FROM kirim_wa_messages WHERE kode = $1 AND chat_jid = $2 LIMIT 1`, [kode, chatJid]);
    return (result.rowCount ?? 0) > 0;
  }

  /** Forgets everything about a number whose session was reset: the next session may be another number. */
  async forgetDevice(kode: string): Promise<void> {
    await this.pool.query(`DELETE FROM kirim_wa_messages WHERE kode = $1`, [kode]);
  }

  async prune(retentionDays: number): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM kirim_wa_messages m
        WHERE m.occurred_at < now() - make_interval(days => $1)
          AND m.wa_message_id <> (
            SELECT oldest.wa_message_id FROM kirim_wa_messages oldest
             WHERE oldest.kode = m.kode AND oldest.chat_jid = m.chat_jid
             ORDER BY oldest.occurred_at ASC, oldest.wa_message_id ASC LIMIT 1
          )`,
      [retentionDays],
    );
    return result.rowCount ?? 0;
  }

  private fromRow(row: MessageRow): IndexedMessage {
    return {
      whatsappMessageId: row.wa_message_id,
      direction: row.direction,
      chatJid: row.chat_jid,
      senderJid: row.sender_jid,
      messageType: row.message_type,
      occurredAt: row.occurred_at.toISOString(),
      fromMe: row.from_me,
      body: row.body_enc ? this.crypto.open(row.body_enc, columnAad("kirim_wa_messages", "body_enc", row.wa_message_id)) : null,
      media: row.media_id ? (JSON.parse(row.media_id) as IndexedMessage["media"]) : null,
    };
  }
}

interface MessageRow {
  wa_message_id: string;
  chat_jid: string;
  sender_jid: string | null;
  from_me: boolean;
  direction: "inbound" | "outbound";
  message_type: string;
  occurred_at: Date;
  body_enc: string | null;
  media_id: string | null;
}

/** The lifecycle of one "fetch older messages" request (KIRIM-IMPL-002 §10, J-2). */
export class HistoryImportStore {
  constructor(private readonly pool: Pool) {}

  async create(input: { kode: string; chatJid: string; source: "whatsapp" | "stored"; state: HistoryImportState; providerRequestId?: string | null }): Promise<HistoryImportRecord> {
    const id = randomUUID();
    await this.pool.query(
      `INSERT INTO kirim_wa_history_imports (id, kode, chat_jid, source, state, provider_request_id, requested_at)
       VALUES ($1,$2,$3,$4,$5,$6, now())`,
      [id, input.kode, input.chatJid, input.source, input.state, input.providerRequestId ?? null],
    );
    return { id, kode: input.kode, chatJid: input.chatJid, source: input.source, state: input.state, reason: null, providerRequestId: input.providerRequestId ?? null };
  }

  async find(kode: string, id: string): Promise<HistoryImportRecord | null> {
    const result = await this.pool.query<ImportRow>(
      `SELECT id, kode, chat_jid, source, state, reason, provider_request_id FROM kirim_wa_history_imports WHERE id = $1 AND kode = $2`,
      [id, kode],
    );
    const row = result.rows[0];
    return row ? fromImportRow(row) : null;
  }

  async findByRequestId(providerRequestId: string): Promise<HistoryImportRecord | null> {
    const result = await this.pool.query<ImportRow>(
      `SELECT id, kode, chat_jid, source, state, reason, provider_request_id
         FROM kirim_wa_history_imports WHERE provider_request_id = $1 AND state = 'awaiting' ORDER BY requested_at DESC LIMIT 1`,
      [providerRequestId],
    );
    const row = result.rows[0];
    return row ? fromImportRow(row) : null;
  }

  async complete(id: string): Promise<void> {
    await this.pool.query(`UPDATE kirim_wa_history_imports SET state = 'completed', completed_at = now() WHERE id = $1 AND state = 'awaiting'`, [id]);
  }

  async fail(id: string, reason: string): Promise<void> {
    await this.pool.query(
      `UPDATE kirim_wa_history_imports SET state = 'failed', reason = $2, completed_at = now() WHERE id = $1 AND state = 'awaiting'`,
      [id, reason.slice(0, 200)],
    );
  }

  /** An import WhatsApp never answered is a failure, not a request that hangs for ever. */
  async timeOutStale(olderThanMinutes: number): Promise<number> {
    const result = await this.pool.query(
      `UPDATE kirim_wa_history_imports SET state = 'failed', reason = 'timeout', completed_at = now()
        WHERE state = 'awaiting' AND requested_at < now() - make_interval(mins => $1)`,
      [olderThanMinutes],
    );
    return result.rowCount ?? 0;
  }
}

interface ImportRow {
  id: string;
  kode: string;
  chat_jid: string;
  source: "whatsapp" | "stored";
  state: HistoryImportState;
  reason: string | null;
  provider_request_id: string | null;
}

function fromImportRow(row: ImportRow): HistoryImportRecord {
  return {
    id: row.id,
    kode: row.kode,
    chatJid: row.chat_jid,
    source: row.source,
    state: row.state,
    reason: row.reason,
    providerRequestId: row.provider_request_id,
  };
}
