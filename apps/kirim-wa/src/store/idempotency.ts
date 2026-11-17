import { createHash } from "node:crypto";

import type { Pool } from "pg";

import { columnAad, type WaCrypto } from "../crypto.js";

/**
 * KIRIM-IMPL-005 §5. Send idempotency, ported in behaviour from JalurPesan's
 * `services/message-sender.ts` but written against this worker's own store.
 *
 * Three answers, and the difference matters to Kirim SQ:
 * - the same key with the same request → the first result again, never a second WhatsApp message;
 * - the same key with a different request → `409 idempotency_key_conflict`, which Kirim SQ treats
 *   as a permanent rejection (a bug in the caller, not something a retry fixes);
 * - the same key while the first attempt is still running → `409 in_progress`, which Kirim SQ
 *   treats as "the number is busy" and retries later.
 */

export type IdempotencyState = "pending" | "done" | "failed";

export interface StoredSendResult {
  whatsappMessageId: string;
  sentAt: string;
}

export type ClaimResult =
  | { kind: "claimed" }
  | { kind: "replay"; result: StoredSendResult }
  | { kind: "conflict" }
  | { kind: "in_progress" };

/** A failed attempt is not an answer: the key is released so the caller may retry with it. */
export class IdempotencyStore {
  constructor(
    private readonly pool: Pool,
    private readonly crypto: WaCrypto,
  ) {}

  async claim(kode: string, key: string, fingerprint: string): Promise<ClaimResult> {
    const inserted = await this.pool.query(
      `INSERT INTO kirim_wa_idempotency (kode, key, fingerprint, state, created_at, updated_at)
       VALUES ($1, $2, $3, 'pending', now(), now())
       ON CONFLICT (kode, key) DO NOTHING`,
      [kode, key, fingerprint],
    );
    if ((inserted.rowCount ?? 0) === 1) return { kind: "claimed" };

    const existing = await this.pool.query<{ fingerprint: string; state: IdempotencyState; result_enc: string | null }>(
      `SELECT fingerprint, state, result_enc FROM kirim_wa_idempotency WHERE kode = $1 AND key = $2`,
      [kode, key],
    );
    const row = existing.rows[0];
    if (!row) return this.claim(kode, key, fingerprint);
    if (row.fingerprint !== fingerprint) return { kind: "conflict" };
    if (row.state === "done" && row.result_enc) {
      return { kind: "replay", result: this.crypto.openJson<StoredSendResult>(row.result_enc, this.aad(kode, key)) };
    }
    if (row.state === "failed") {
      // The previous attempt never reached WhatsApp. Take the key back for this attempt.
      const retaken = await this.pool.query(
        `UPDATE kirim_wa_idempotency SET state = 'pending', updated_at = now()
          WHERE kode = $1 AND key = $2 AND state = 'failed'`,
        [kode, key],
      );
      return (retaken.rowCount ?? 0) === 1 ? { kind: "claimed" } : { kind: "in_progress" };
    }
    return { kind: "in_progress" };
  }

  async succeed(kode: string, key: string, result: StoredSendResult): Promise<void> {
    await this.pool.query(
      `UPDATE kirim_wa_idempotency SET state = 'done', result_enc = $3, updated_at = now() WHERE kode = $1 AND key = $2`,
      [kode, key, this.crypto.sealJson(result, this.aad(kode, key))],
    );
  }

  async fail(kode: string, key: string): Promise<void> {
    await this.pool.query(
      `UPDATE kirim_wa_idempotency SET state = 'failed', updated_at = now() WHERE kode = $1 AND key = $2 AND state = 'pending'`,
      [kode, key],
    );
  }

  /**
   * A `pending` row left behind by a worker that died mid-send would block its key forever. After
   * this long it is released, matching the one minute a Baileys send is given plus slack.
   */
  async releaseStale(olderThanMinutes = 10): Promise<number> {
    const result = await this.pool.query(
      `UPDATE kirim_wa_idempotency SET state = 'failed', updated_at = now()
        WHERE state = 'pending' AND updated_at < now() - make_interval(mins => $1)`,
      [olderThanMinutes],
    );
    return result.rowCount ?? 0;
  }

  async prune(olderThanDays: number): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM kirim_wa_idempotency WHERE updated_at < now() - make_interval(days => $1)`,
      [olderThanDays],
    );
    return result.rowCount ?? 0;
  }

  private aad(kode: string, key: string): string {
    return columnAad("kirim_wa_idempotency", "result_enc", `${kode}:${key}`);
  }
}

/**
 * What makes two sends "the same request". Ported from JalurPesan `requestFingerprint`: the
 * target, the content and every extra that changes what the recipient sees are all in it, so a
 * caller that reuses a key for different content is told rather than silently served the old
 * message.
 */
export function sendFingerprint(parts: Record<string, unknown>): string {
  return createHash("sha256").update(stableJson(parts)).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
}
