/** Pure send-policy rules from KIRIM-IMPL-001 §5.2, §5.3 and §6.2, kept free of I/O for unit tests. */

/** WIB is a fixed UTC+7 offset (§2). */
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function timeOfDayMs(value: string): number {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new Error("invalid time of day");
  return ((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3] ?? 0)) * 1000;
}

/**
 * `notifikasi` is sent only in [start, end) WIB. Outside the window the message waits for the
 * next start; `now` comes from the database clock, not the Node process (§9).
 */
export function sendWindow(now: Date, start: string, end: string): { open: true } | { open: false; nextOpenAt: Date } {
  const local = now.getTime() + WIB_OFFSET_MS;
  const dayStart = Math.floor(local / DAY_MS) * DAY_MS;
  const offset = local - dayStart;
  const startMs = timeOfDayMs(start);
  const endMs = timeOfDayMs(end);
  if (offset >= startMs && offset < endMs) return { open: true };
  const nextLocal = offset < startMs ? dayStart + startMs : dayStart + DAY_MS + startMs;
  return { open: false, nextOpenAt: new Date(nextLocal - WIB_OFFSET_MS) };
}

export type WindowDecision =
  | { action: "send" }
  | { action: "wait"; until: Date }
  | { action: "expire" };

export function windowDecision(input: {
  now: Date;
  jenis: "notifikasi" | "kode" | "percakapan";
  start: string;
  end: string;
  expiresAt: Date;
}): WindowDecision {
  if (input.expiresAt.getTime() <= input.now.getTime()) return { action: "expire" };
  // `kode` and officer replies (`percakapan`, KIRIM-IMPL-002 §5.2) ignore the send window.
  if (input.jenis !== "notifikasi") return { action: "send" };
  const window = sendWindow(input.now, input.start, input.end);
  if (window.open) return { action: "send" };
  if (input.expiresAt.getTime() <= window.nextOpenAt.getTime()) return { action: "expire" };
  return { action: "wait", until: window.nextOpenAt };
}

/** Retryable results wait 1, 5, then 30 minutes: 3 retries, 4 attempts, then `gagal`. */
const RETRY_DELAYS_MINUTES = [1, 5, 30] as const;
export const MAX_SEND_ATTEMPTS = RETRY_DELAYS_MINUTES.length + 1;

/** `attempts` counts attempts already made, including the one that just failed. */
export function retryDelayMs(attempts: number): number | null {
  const minutes = RETRY_DELAYS_MINUTES[attempts - 1];
  return minutes === undefined ? null : minutes * 60_000;
}

/** At most `ratePerMinute` automatic messages per number in a rolling 60 seconds. */
export function rateAllows(sentInLastMinute: number, ratePerMinute: number): boolean {
  return sentInLastMinute < ratePerMinute;
}

/** Random 2–6 second gap between sends on one number; the random source is injected. */
export function sendGapMs(random: () => number): number {
  const value = Math.min(Math.max(random(), 0), 0.999999);
  return 2_000 + Math.floor(value * 4_001);
}

export type OutboundStatus = "antre" | "diserahkan" | "terkirim" | "dibaca" | "gagal" | "dibatalkan";
const RANK: Record<string, number> = { antre: 0, diserahkan: 1, terkirim: 2, dibaca: 3 };

/** Status only moves forward; late, duplicate or out-of-order events never move it back (§5.3). */
export function advanceStatus(current: OutboundStatus, incoming: "terkirim" | "dibaca"): OutboundStatus | null {
  const from = RANK[current];
  if (from === undefined || from < RANK.diserahkan!) return null;
  return RANK[incoming]! > from ? incoming : null;
}

/** §6.2 webhook retry: 30 s, 1, 2, 4 … minutes capped at 1 hour, at most 8 attempts, then `habis`. */
export const MAX_WEBHOOK_ATTEMPTS = 8;
export function webhookRetryDelayMs(attempts: number): number | null {
  if (attempts >= MAX_WEBHOOK_ATTEMPTS) return null;
  return Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));
}

/** Calendar day in WIB, for the daily quota (§5.1 step 10). */
export function wibDayStart(now: Date): Date {
  const local = now.getTime() + WIB_OFFSET_MS;
  return new Date(Math.floor(local / DAY_MS) * DAY_MS - WIB_OFFSET_MS);
}
