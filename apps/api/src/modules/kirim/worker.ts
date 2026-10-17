import type { Pool } from "pg";

import { columnAad, type KirimCrypto } from "./crypto.js";
import { MAX_SEND_ATTEMPTS, rateAllows, retryDelayMs, sendGapMs, windowDecision } from "./policy.js";
import type { KirimLog } from "./providers/log.js";
import type { DeviceRef, KirimProvider, ProviderName, SendResult } from "./providers/types.js";
import {
  conversationContact,
  dbNow,
  setDeviceStatus,
  transitionOutbox,
  withTransaction,
} from "./repository.js";
import type { KirimService } from "./service.js";

/** Lease on a claimed outbox row (§5.2). A crashed send becomes claimable again afterwards. */
export const LEASE_MS = 60_000;
const MAX_CANDIDATES_PER_DEVICE = 20;

interface ClaimedRow {
  outboxId: string;
  messageId: string;
  conversationId: string;
  jenis: "notifikasi" | "kode";
  tipe: string;
  bodyEnc: string | null;
  mediaId: string | null;
  attempts: number;
}

/**
 * Send worker running as a timer inside the SQ Hub API process (§5.2). One round at a time;
 * claims use FOR UPDATE SKIP LOCKED with a lease so two processes would not double-send, and
 * the engine idempotency key `kirim:<outbox_id>` covers a restart in the middle of a send.
 */
export class KirimSendWorker {
  /** Earliest next send per number, for the random 2–6 s gap. In memory: a restart only shortens one gap. */
  private readonly nextSendAt = new Map<string, number>();

  constructor(
    private readonly pool: Pool,
    private readonly crypto: KirimCrypto,
    private readonly service: KirimService,
    private readonly providers: Record<ProviderName, KirimProvider | undefined>,
    private readonly options: { random?: () => number; log?: KirimLog; clock?: () => number } = {},
  ) {}

  async runOnce(): Promise<{ sent: number; expired: number }> {
    const expired = await this.expireDue();
    let sent = 0;
    const devices = await this.pool.query<{ id: string; kode: string; provider: ProviderName; providerRef: string | null; ratePerMenit: number; mulai: string; selesai: string }>(
      `SELECT d.id, d.kode, d.provider, d.provider_ref AS "providerRef", d.rate_per_menit AS "ratePerMenit",
              to_char(d.jam_kirim_mulai, 'HH24:MI:SS') AS mulai, to_char(d.jam_kirim_selesai, 'HH24:MI:SS') AS selesai
       FROM kirim_devices d
       WHERE NOT d.antrean_dijeda AND d.status <> 'nonaktif' AND (d.provider = 'log' OR d.status = 'tersambung')
         AND EXISTS (SELECT 1 FROM kirim_outbox o WHERE o.device_id = d.id AND o.status = 'antre' AND o.next_attempt_at <= now())
       ORDER BY d.kode`,
    );
    for (const device of devices.rows) {
      if ((this.nextSendAt.get(device.id) ?? 0) > this.now()) continue;
      const recent = await this.pool.query<{ count: string }>(
        `SELECT count(*) AS count FROM kirim_messages
         WHERE device_id = $1 AND arah = 'keluar' AND asal = 'otomatis' AND provider_at > now() - interval '60 seconds'`,
        [device.id],
      );
      if (!rateAllows(Number(recent.rows[0]?.count ?? 0), device.ratePerMenit)) continue;
      const claimed = await this.claim(device);
      if (!claimed) continue;
      const provider = this.providers[device.provider];
      if (!provider) {
        await this.releaseLease(claimed.outboxId);
        continue;
      }
      await this.send(device, provider, claimed);
      this.nextSendAt.set(device.id, this.now() + sendGapMs(this.options.random ?? Math.random));
      sent += 1;
    }
    return { sent, expired };
  }

  /** Messages past `expires_at` before hand-over become `gagal/expired` without being sent. */
  private async expireDue(): Promise<number> {
    return withTransaction(this.pool, async (client) => {
      const due = await client.query<{ id: string }>(
        `SELECT id FROM kirim_outbox WHERE status = 'antre' AND expires_at <= now() FOR UPDATE SKIP LOCKED LIMIT 200`,
      );
      for (const row of due.rows) {
        await transitionOutbox(client, this.crypto, { outboxId: row.id, fromStatuses: ["antre"], status: "gagal", errorCode: "expired" });
      }
      return due.rows.length;
    });
  }

  /**
   * Claims the next due row for one number by priority then age. `notifikasi` outside the WIB
   * send window is moved to the next window start, or fails as expired if that comes too late.
   */
  private async claim(device: { id: string; mulai: string; selesai: string }): Promise<ClaimedRow | null> {
    return withTransaction(this.pool, async (client) => {
      const now = await dbNow(client);
      const candidates = await client.query<ClaimedRow & { expiresAt: Date }>(
        `SELECT o.id AS "outboxId", o.message_id AS "messageId", m.conversation_id AS "conversationId", o.jenis, m.tipe,
                m.body_enc AS "bodyEnc", m.media_id AS "mediaId", o.attempts, o.expires_at AS "expiresAt"
         FROM kirim_outbox o JOIN kirim_messages m ON m.id = o.message_id
         WHERE o.device_id = $1 AND o.status = 'antre' AND o.next_attempt_at <= now()
         ORDER BY CASE o.prioritas WHEN 'kode' THEN 0 WHEN 'tinggi' THEN 1 ELSE 2 END, o.created_at
         LIMIT ${MAX_CANDIDATES_PER_DEVICE}
         FOR UPDATE OF o SKIP LOCKED`,
        [device.id],
      );
      for (const candidate of candidates.rows) {
        const decision = windowDecision({ now, jenis: candidate.jenis, start: device.mulai, end: device.selesai, expiresAt: candidate.expiresAt });
        if (decision.action === "expire") {
          await transitionOutbox(client, this.crypto, { outboxId: candidate.outboxId, fromStatuses: ["antre"], status: "gagal", errorCode: "expired" });
          continue;
        }
        if (decision.action === "wait") {
          await client.query("UPDATE kirim_outbox SET next_attempt_at = $2, updated_at = now() WHERE id = $1", [candidate.outboxId, decision.until]);
          continue;
        }
        await client.query(
          "UPDATE kirim_outbox SET next_attempt_at = now() + ($2::int * interval '1 millisecond'), updated_at = now() WHERE id = $1",
          [candidate.outboxId, LEASE_MS],
        );
        return candidate;
      }
      return null;
    });
  }

  private async releaseLease(outboxId: string): Promise<void> {
    await this.pool.query("UPDATE kirim_outbox SET next_attempt_at = now() WHERE id = $1 AND status = 'antre'", [outboxId]);
  }

  private async send(device: DeviceRef & { provider: ProviderName }, provider: KirimProvider, row: ClaimedRow): Promise<void> {
    const contact = await conversationContact(this.pool, this.crypto, row.conversationId);
    const phoneDigits = contact.startsWith("pn:+") ? contact.slice(4) : null;
    const body = row.bodyEnc ? this.crypto.open(row.bodyEnc, columnAad("kirim_messages", "body_enc", row.messageId)) : null;
    const idempotencyKey = `kirim:${row.outboxId}`;
    let result: SendResult;
    if (!phoneDigits) {
      result = { ok: false, kind: "rejected", code: "invalid_number" };
    } else if (row.mediaId) {
      const media = await this.pool.query<{ mime: string; path: string | null }>("SELECT mime, path FROM kirim_media WHERE id = $1", [row.mediaId]);
      const stored = media.rows[0];
      result = stored?.path
        ? await provider.sendDocument(
            device,
            { phoneDigits },
            { mediaId: row.mediaId, mime: stored.mime, filename: `${row.mediaId}.pdf`, data: () => this.service.readMediaFile(row.mediaId!, stored.path!) },
            body,
            idempotencyKey,
          )
        : { ok: false, kind: "rejected", code: "media_invalid" };
    } else {
      result = await provider.sendText(device, { phoneDigits }, body ?? "", idempotencyKey);
    }
    await this.applyResult(device, provider.name, row, result);
  }

  private async applyResult(device: DeviceRef, providerName: ProviderName, row: ClaimedRow, result: SendResult): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      if (result.ok) {
        await transitionOutbox(client, this.crypto, {
          outboxId: row.outboxId,
          fromStatuses: ["antre"],
          status: "diserahkan",
          errorCode: null,
          incrementAttempts: true,
          provider: { messageId: result.providerMessageId, dryRun: result.dryRun, provider: providerName },
        });
        return;
      }
      if (result.kind === "device") {
        // Not counted as an attempt: the number is marked disconnected and its queue waits.
        await client.query("UPDATE kirim_outbox SET next_attempt_at = now(), updated_at = now() WHERE id = $1 AND status = 'antre'", [row.outboxId]);
        await setDeviceStatus(client, this.crypto, device.id, "terputus");
        this.options.log?.({ event: "kirim.device.disconnected", device: device.kode }, "kirim number disconnected; queue paused");
        return;
      }
      const attempts = row.attempts + 1;
      const delay = result.kind === "retryable" && attempts < MAX_SEND_ATTEMPTS ? retryDelayMs(attempts) : null;
      if (delay !== null) {
        await client.query(
          `UPDATE kirim_outbox SET attempts = attempts + 1, error_code = $2,
             next_attempt_at = now() + ($3::int * interval '1 millisecond'), updated_at = now()
           WHERE id = $1 AND status = 'antre'`,
          [row.outboxId, result.code, delay],
        );
        return;
      }
      await transitionOutbox(client, this.crypto, {
        outboxId: row.outboxId,
        fromStatuses: ["antre"],
        status: "gagal",
        errorCode: result.code,
        incrementAttempts: true,
      });
    });
    this.options.log?.(
      { event: "kirim.send.result", device: device.kode, outcome: result.ok ? "diserahkan" : result.kind, code: result.ok ? null : result.code },
      "kirim send attempt",
    );
  }

  private now(): number {
    return this.options.clock?.() ?? Date.now();
  }
}
