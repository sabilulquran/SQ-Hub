import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

import { columnAad, type WaCrypto } from "../crypto.js";

/**
 * KIRIM-IMPL-005 §5. The event log Kirim SQ pulls by cursor. The cursor is the whole recovery
 * story: Hub remembers the last cursor it stored for this number, asks for everything after it,
 * and a webhook only ever makes that pull happen sooner. So the cursor must never go backwards
 * and an event must never become visible to a reader before an event with a lower cursor.
 *
 * Appends are therefore serialized in this process and numbered `max(cursor) + 1` inside the
 * insert. One worker is the only writer by design; the unique index on `cursor` turns a second
 * writer into a loud failure rather than a silently reordered log.
 */

export interface EventEnvelope {
  eventId: string;
  cursor: number;
  type: string;
  deviceId: string;
  messageId: string | null;
  occurredAt: string;
  payload: unknown;
}

export interface EventPage {
  events: EventEnvelope[];
  nextCursor: number;
  hasMore: boolean;
}

export const EVENT_PAYLOAD_VERSION = 1;

export class EventStore {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly pool: Pool,
    private readonly crypto: WaCrypto,
  ) {}

  /**
   * Appends one event and returns it. The payload is sealed: it carries message bodies, numbers
   * and JIDs, and this table lives in the same database as the Hub's own rows (§12).
   */
  append(input: {
    deviceId: string;
    type: string;
    messageId?: string | null;
    occurredAt?: string;
    payload: Record<string, unknown>;
  }): Promise<EventEnvelope> {
    const run = this.tail.then(
      () => this.insert(input),
      () => this.insert(input),
    );
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async insert(input: {
    deviceId: string;
    type: string;
    messageId?: string | null;
    occurredAt?: string;
    payload: Record<string, unknown>;
  }): Promise<EventEnvelope> {
    const id = randomUUID();
    const occurredAt = input.occurredAt ?? new Date().toISOString();
    const payload = { version: EVENT_PAYLOAD_VERSION, ...input.payload };
    const sealed = this.crypto.sealJson(payload, columnAad("kirim_wa_events", "payload_enc", id));
    const result = await this.pool.query<{ cursor: string }>(
      `INSERT INTO kirim_wa_events (id, cursor, kode, type, message_id, occurred_at, payload_enc)
       VALUES ($1, (SELECT coalesce(max(cursor), 0) + 1 FROM kirim_wa_events), $2, $3, $4, $5, $6)
       RETURNING cursor::text`,
      [id, input.deviceId, input.type.slice(0, 100), input.messageId ?? null, occurredAt, sealed],
    );
    return {
      eventId: id,
      cursor: Number(result.rows[0]!.cursor),
      type: input.type,
      deviceId: input.deviceId,
      messageId: input.messageId ?? null,
      occurredAt,
      payload,
    };
  }

  /**
   * Lets the appends already queued finish. An event written by a listener just before shutdown
   * is the only copy of that message until Kirim SQ pulls it, so it must not be dropped.
   */
  async drain(timeoutMs = 5_000): Promise<void> {
    await Promise.race([this.tail, new Promise((done) => setTimeout(done, timeoutMs))]);
  }

  /**
   * A pull is also an acknowledgement: by asking for everything after `after`, Kirim SQ says it
   * has stored every event up to it. That watermark is what makes pruning safe (`prune`).
   */
  async list(deviceId: string, after: number, limit: number): Promise<EventPage> {
    if (after > 0) {
      await this.pool.query(
        `INSERT INTO kirim_wa_cursors (kode, read_cursor, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (kode) DO UPDATE SET read_cursor = greatest(kirim_wa_cursors.read_cursor, EXCLUDED.read_cursor), updated_at = now()`,
        [deviceId, after],
      );
    }
    const result = await this.pool.query<{
      id: string;
      cursor: string;
      type: string;
      kode: string;
      message_id: string | null;
      occurred_at: Date;
      payload_enc: string;
    }>(
      `SELECT id, cursor::text, type, kode, message_id, occurred_at, payload_enc
         FROM kirim_wa_events
        WHERE kode = $1 AND cursor > $2
        ORDER BY cursor ASC
        LIMIT $3`,
      [deviceId, after, limit + 1],
    );
    const hasMore = result.rows.length > limit;
    const events = result.rows.slice(0, limit).map((row) => ({
      eventId: row.id,
      cursor: Number(row.cursor),
      type: row.type,
      deviceId: row.kode,
      messageId: row.message_id,
      occurredAt: row.occurred_at.toISOString(),
      payload: this.crypto.openJson<unknown>(row.payload_enc, columnAad("kirim_wa_events", "payload_enc", row.id)),
    }));
    return { events, nextCursor: events.at(-1)?.cursor ?? after, hasMore };
  }

  /**
   * Drops only events Kirim SQ has provably read: its own pull moved the watermark past them, and
   * it stores every event it processes in `kirim_events`. An event that was never acknowledged is
   * kept however old it is, because losing it would lose a message nobody else has.
   */
  async prune(olderThanDays: number): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM kirim_wa_events e
        USING kirim_wa_cursors c
        WHERE c.kode = e.kode
          AND e.cursor <= c.read_cursor
          AND e.occurred_at < now() - make_interval(days => $1)`,
      [olderThanDays],
    );
    return result.rowCount ?? 0;
  }
}
