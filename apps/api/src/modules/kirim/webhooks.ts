import type { Pool } from "pg";

import { columnAad, signKirimWebhook, type KirimCrypto } from "./crypto.js";
import { webhookRetryDelayMs } from "./policy.js";
import type { KirimLog } from "./providers/log.js";

/** KIRIM-IMPL-001 §6.2 outgoing consumer webhooks. */

export const WEBHOOK_TIMEOUT_MS = 10_000;
const LEASE_MS = 60_000;
const BATCH = 20;

/**
 * D-4: R1 webhooks go only to a consumer on Mi8 (`http://127.0.0.1:<port>/…`) or to
 * `https://<host>.sabilulquran.or.id/…`. No credentials in the URL.
 */
export function isAllowedWebhookUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) return false;
  if (url.protocol === "http:") return url.hostname === "127.0.0.1" && url.port !== "";
  if (url.protocol === "https:") return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.sabilulquran\.or\.id$/.test(url.hostname);
  return false;
}

export type WebhookTransport = (request: {
  url: string;
  body: string;
  headers: Record<string, string>;
  timeoutMs: number;
}) => Promise<{ status: number }>;

export const fetchWebhookTransport: WebhookTransport = async (request) => {
  const response = await fetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: request.body,
    redirect: "manual",
    signal: AbortSignal.timeout(request.timeoutMs),
  });
  await response.body?.cancel();
  return { status: response.status };
};

export class KirimWebhookSender {
  constructor(
    private readonly pool: Pool,
    private readonly crypto: KirimCrypto,
    private readonly options: {
      transport?: WebhookTransport;
      secrets?: NodeJS.ProcessEnv;
      nowSeconds?: () => number;
      log?: KirimLog;
    } = {},
  ) {}

  /** Delivers due events. The body and `event_id` are identical on every attempt. */
  async runOnce(): Promise<{ delivered: number; failed: number }> {
    const claimed = await this.pool.query<{
      id: string;
      eventType: string;
      payloadEnc: string;
      attempts: number;
      webhookUrl: string | null;
      webhookSecretRef: string | null;
      consumer: string;
    }>(
      `UPDATE kirim_webhook_deliveries d
       SET next_attempt_at = now() + ($1::int * interval '1 millisecond')
       FROM kirim_consumers c
       WHERE c.id = d.consumer_id AND d.id IN (
         SELECT id FROM kirim_webhook_deliveries
         WHERE status IN ('pending', 'retry') AND next_attempt_at <= now()
         ORDER BY next_attempt_at
         LIMIT ${BATCH}
         FOR UPDATE SKIP LOCKED
       )
       RETURNING d.id, d.event_type AS "eventType", d.payload_enc AS "payloadEnc", d.attempts,
                 c.webhook_url AS "webhookUrl", c.webhook_secret_ref AS "webhookSecretRef", c.nama AS consumer`,
      [LEASE_MS],
    );
    let delivered = 0;
    let failed = 0;
    for (const row of claimed.rows) {
      const status = await this.deliver(row);
      const attempts = row.attempts + 1;
      if (status !== null && status >= 200 && status < 300) {
        await this.pool.query(
          `UPDATE kirim_webhook_deliveries SET status = 'berhasil', attempts = $2, last_status_code = $3, delivered_at = now() WHERE id = $1`,
          [row.id, attempts, status],
        );
        delivered += 1;
        continue;
      }
      failed += 1;
      const delay = webhookRetryDelayMs(attempts);
      await this.pool.query(
        `UPDATE kirim_webhook_deliveries SET
           status = CASE WHEN $3::int IS NULL THEN 'habis' ELSE 'retry' END,
           attempts = $2, last_status_code = $4,
           next_attempt_at = CASE WHEN $3::int IS NULL THEN next_attempt_at ELSE now() + ($3::int * interval '1 millisecond') END
         WHERE id = $1`,
        [row.id, attempts, delay, status],
      );
      this.options.log?.(
        { event: "kirim.webhook.failed", consumer: row.consumer, type: row.eventType, attempts, statusCode: status, exhausted: delay === null },
        "kirim webhook delivery failed",
      );
    }
    return { delivered, failed };
  }

  private async deliver(row: { id: string; payloadEnc: string; webhookUrl: string | null; webhookSecretRef: string | null }): Promise<number | null> {
    const secret = row.webhookSecretRef ? (this.options.secrets ?? process.env)[row.webhookSecretRef] : undefined;
    if (!row.webhookUrl || !secret || !isAllowedWebhookUrl(row.webhookUrl)) return null;
    const body = this.crypto.open(row.payloadEnc, columnAad("kirim_webhook_deliveries", "payload_enc", row.id));
    const timestamp = this.options.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
    try {
      const response = await (this.options.transport ?? fetchWebhookTransport)({
        url: row.webhookUrl,
        body,
        headers: {
          "content-type": "application/json",
          "x-kirim-event-id": row.id,
          "x-kirim-timestamp": String(timestamp),
          "x-kirim-signature": signKirimWebhook(secret, timestamp, body),
        },
        timeoutMs: WEBHOOK_TIMEOUT_MS,
      });
      return response.status;
    } catch {
      return null;
    }
  }
}
