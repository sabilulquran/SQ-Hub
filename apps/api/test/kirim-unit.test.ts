import { createHmac, randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { safeLogUrl } from "../src/app.js";
import { loadKirimConfig, parseDataKeys } from "../src/modules/kirim/config.js";
import {
  InvalidNumberError,
  KirimCrypto,
  KirimCryptoError,
  maskPhone,
  normalizePhone,
  signKirimWebhook,
  verifyJalurPesanSignature,
} from "../src/modules/kirim/crypto.js";
import { contactFromJid, contactFromMessage } from "../src/modules/kirim/ingest.js";
import {
  MAX_SEND_ATTEMPTS,
  advanceStatus,
  rateAllows,
  retryDelayMs,
  sendGapMs,
  sendWindow,
  webhookRetryDelayMs,
  wibDayStart,
  windowDecision,
} from "../src/modules/kirim/policy.js";
import { canonicalJson } from "../src/modules/kirim/service.js";
import { isAllowedWebhookUrl } from "../src/modules/kirim/webhooks.js";

const key = (fill: number) => Buffer.alloc(32, fill);

describe("KIRIM-IMPL-001 §4.1 number normalization", () => {
  it.each([
    ["081234567890", "+6281234567890"],
    ["6281234567890", "+6281234567890"],
    ["+6281234567890", "+6281234567890"],
    ["0812-3456-7890", "+6281234567890"],
    ["0812 3456 7890", "+6281234567890"],
    ["(0812) 3456-7890", "+6281234567890"],
    ["+14155550123", "+14155550123"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(["081234", "+1234567", "+1234567890123456", "08123abc4567", "81234567890", "", "021-555-1234"])(
    "rejects %s as invalid_number",
    (input) => {
      expect(() => normalizePhone(input)).toThrow(InvalidNumberError);
    },
  );

  it("masks to the country code, operator prefix and last four digits only", () => {
    expect(maskPhone("+6281234567890")).toBe("+62 812-••••-7890");
    expect(maskPhone("+6281234567890")).not.toContain("3456");
    expect(maskPhone("+123456789")).toBe("+12 ••••-6789");
  });
});

describe("KIRIM-IMPL-001 §4.1 column encryption", () => {
  const crypto = new KirimCrypto([{ kid: "k1", key: key(1) }], key(9));

  it("round-trips with the envelope format v1.<kid>.<iv>.<ciphertext>.<tag>", () => {
    const sealed = crypto.seal("Assalamu'alaikum", "kirim:kirim_messages:body_enc:row-1");
    expect(sealed.split(".")).toHaveLength(5);
    expect(sealed.startsWith("v1.k1.")).toBe(true);
    expect(sealed).not.toContain("Assalamu");
    expect(crypto.open(sealed, "kirim:kirim_messages:body_enc:row-1")).toBe("Assalamu'alaikum");
  });

  it("rejects a value moved to another row (AAD)", () => {
    const sealed = crypto.seal("rahasia", "kirim:kirim_messages:body_enc:row-1");
    expect(() => crypto.open(sealed, "kirim:kirim_messages:body_enc:row-2")).toThrow(KirimCryptoError);
  });

  it("rejects a modified tag", () => {
    const parts = crypto.seal("rahasia", "aad").split(".");
    const tag = Buffer.from(parts[4]!, "base64url");
    tag[0] = tag[0]! ^ 0xff;
    parts[4] = tag.toString("base64url");
    expect(() => crypto.open(parts.join("."), "aad")).toThrow(KirimCryptoError);
  });

  it("keeps reading old values after rotation and writes with the first key", () => {
    const old = crypto.seal("lama", "aad");
    const rotated = new KirimCrypto([{ kid: "k2", key: key(2) }, { kid: "k1", key: key(1) }], key(9));
    expect(rotated.open(old, "aad")).toBe("lama");
    expect(rotated.seal("baru", "aad").startsWith("v1.k2.")).toBe(true);
  });

  it("rejects an unknown key id", () => {
    const other = new KirimCrypto([{ kid: "k3", key: key(3) }], key(9));
    expect(() => crypto.open(other.seal("x", "aad"), "aad")).toThrow(KirimCryptoError);
  });

  it("encrypts media files with the same key and row binding (D-8)", () => {
    const pdf = Buffer.from("%PDF-1.7 test");
    const sealed = crypto.sealFile(pdf, "kirim:kirim_media:file:m1");
    expect(sealed.includes(pdf)).toBe(false);
    expect(crypto.openFile(sealed, "kirim:kirim_media:file:m1").equals(pdf)).toBe(true);
    expect(() => crypto.openFile(sealed, "kirim:kirim_media:file:m2")).toThrow(KirimCryptoError);
  });

  it("produces stable HMAC lookups that differ per key", () => {
    const again = new KirimCrypto([{ kid: "k1", key: key(1) }], key(9));
    const otherLookup = new KirimCrypto([{ kid: "k1", key: key(1) }], key(8));
    expect(crypto.lookup("pn:+6281234567890")).toBe(again.lookup("pn:+6281234567890"));
    expect(crypto.lookup("pn:+6281234567890")).toMatch(/^[0-9a-f]{64}$/);
    expect(crypto.lookup("pn:+6281234567890")).not.toBe(otherLookup.lookup("pn:+6281234567890"));
  });
});

describe("KIRIM-IMPL-001 §5.2 send window (WIB)", () => {
  // 06:00 WIB = 23:00 UTC the previous day.
  const wib = (iso: string) => new Date(`${iso}+07:00`);

  it("opens exactly at 06.00 and stays open at 20.59", () => {
    expect(sendWindow(wib("2026-10-18T06:00:00"), "06:00", "21:00")).toEqual({ open: true });
    expect(sendWindow(wib("2026-10-18T20:59:59"), "06:00", "21:00")).toEqual({ open: true });
  });

  it("closes at 21.00 and waits for 06.00 the next day", () => {
    expect(sendWindow(wib("2026-10-18T21:00:00"), "06:00", "21:00")).toEqual({ open: false, nextOpenAt: wib("2026-10-19T06:00:00") });
  });

  it("waits from midnight until 06.00 the same day", () => {
    expect(sendWindow(wib("2026-10-19T00:00:00"), "06:00", "21:00")).toEqual({ open: false, nextOpenAt: wib("2026-10-19T06:00:00") });
  });

  it("expires a notification whose expiry comes before the morning", () => {
    expect(windowDecision({ now: wib("2026-10-18T21:30:00"), jenis: "notifikasi", start: "06:00", end: "21:00", expiresAt: wib("2026-10-19T05:00:00") })).toEqual({ action: "expire" });
    expect(windowDecision({ now: wib("2026-10-18T21:30:00"), jenis: "notifikasi", start: "06:00", end: "21:00", expiresAt: wib("2026-10-19T09:00:00") })).toEqual({ action: "wait", until: wib("2026-10-19T06:00:00") });
  });

  it("lets kode through at any hour", () => {
    expect(windowDecision({ now: wib("2026-10-18T23:00:00"), jenis: "kode", start: "06:00", end: "21:00", expiresAt: wib("2026-10-18T23:10:00") })).toEqual({ action: "send" });
  });

  it("uses the WIB calendar day for quotas", () => {
    expect(wibDayStart(new Date("2026-10-18T18:30:00Z")).toISOString()).toBe("2026-10-18T17:00:00.000Z");
  });
});

describe("KIRIM-IMPL-001 §5.2 rate limit, gap and retry", () => {
  it("allows up to rate_per_menit in a rolling minute", () => {
    expect(rateAllows(9, 10)).toBe(true);
    expect(rateAllows(10, 10)).toBe(false);
  });

  it("keeps the random gap within 2–6 seconds", () => {
    expect(sendGapMs(() => 0)).toBe(2_000);
    expect(sendGapMs(() => 0.5)).toBe(4_000);
    expect(sendGapMs(() => 0.999999)).toBe(6_000);
    expect(sendGapMs(() => 1)).toBeLessThanOrEqual(6_000);
  });

  it("retries after 1, 5 and 30 minutes, then gives up", () => {
    expect(MAX_SEND_ATTEMPTS).toBe(4);
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([60_000, 300_000, 1_800_000, null]);
  });

  it("webhook backoff doubles from 30 seconds and stops after 8 attempts", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(webhookRetryDelayMs)).toEqual([30_000, 60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000, null]);
  });
});

describe("KIRIM-IMPL-001 §5.3 status only moves forward", () => {
  it("advances diserahkan → terkirim → dibaca", () => {
    expect(advanceStatus("diserahkan", "terkirim")).toBe("terkirim");
    expect(advanceStatus("terkirim", "dibaca")).toBe("dibaca");
    expect(advanceStatus("diserahkan", "dibaca")).toBe("dibaca");
  });

  it("ignores late, duplicate and out-of-order events", () => {
    expect(advanceStatus("dibaca", "terkirim")).toBeNull();
    expect(advanceStatus("terkirim", "terkirim")).toBeNull();
    expect(advanceStatus("antre", "terkirim")).toBeNull();
    expect(advanceStatus("gagal", "dibaca")).toBeNull();
    expect(advanceStatus("dibatalkan", "terkirim")).toBeNull();
  });
});

describe("KIRIM-IMPL-001 §2 and §6.3 signatures", () => {
  const body = JSON.stringify({ event_id: "e1", type: "message.status" });

  it("signs outgoing webhooks as hex HMAC-SHA256(secret, timestamp.body)", () => {
    const expected = createHmac("sha256", "rahasia").update(`1700000000.${body}`).digest("hex");
    expect(signKirimWebhook("rahasia", 1700000000, body)).toBe(expected);
  });

  const now = 1_800_000_000;
  const sign = (timestamp: number, raw: string) => `v1=${createHmac("sha256", "jp-secret").update(`${timestamp}.${raw}`).digest("hex")}`;

  it("accepts a valid JalurPesan signature", () => {
    expect(verifyJalurPesanSignature({ secret: "jp-secret", signature: sign(now, body), timestamp: String(now), rawBody: body, nowSeconds: now })).toBe(true);
  });

  it("rejects a wrong signature", () => {
    expect(verifyJalurPesanSignature({ secret: "jp-secret", signature: `v1=${"0".repeat(64)}`, timestamp: String(now), rawBody: body, nowSeconds: now })).toBe(false);
    expect(verifyJalurPesanSignature({ secret: "jp-secret", signature: undefined, timestamp: String(now), rawBody: body, nowSeconds: now })).toBe(false);
  });

  it("rejects an old timestamp", () => {
    const old = now - 301;
    expect(verifyJalurPesanSignature({ secret: "jp-secret", signature: sign(old, body), timestamp: String(old), rawBody: body, nowSeconds: now })).toBe(false);
  });

  it("rejects a modified body", () => {
    expect(verifyJalurPesanSignature({ secret: "jp-secret", signature: sign(now, body), timestamp: String(now), rawBody: `${body} `, nowSeconds: now })).toBe(false);
  });
});

describe("KIRIM-IMPL-001 configuration and boundaries", () => {
  const dataKey = `k1:${randomBytes(32).toString("base64")}`;
  const lookup = randomBytes(32).toString("base64");

  it("stays off unless KIRIM_ENABLED=true", () => {
    expect(loadKirimConfig({})).toBeNull();
    expect(loadKirimConfig({ KIRIM_ENABLED: "false", KIRIM_DATA_KEYS: dataKey })).toBeNull();
  });

  it("requires keys and a media root when enabled", () => {
    expect(() => loadKirimConfig({ KIRIM_ENABLED: "true" })).toThrow(/KIRIM_DATA_KEYS/);
    const config = loadKirimConfig({ KIRIM_ENABLED: "true", KIRIM_DATA_KEYS: dataKey, KIRIM_LOOKUP_KEY: lookup, KIRIM_MEDIA_ROOT: "/tmp/kirim" });
    expect(config).toMatchObject({ tokenAudience: "sq-hub-kirim", workerIntervalMs: 2000, eventPullIntervalMs: 60000, inboundMediaMaxBytes: 16 * 1024 * 1024, jalurpesan: null, admin: null });
  });

  it("validates data key entries", () => {
    expect(() => parseDataKeys("k1:short")).toThrow(/32 bytes/);
    expect(() => parseDataKeys(`${dataKey},${dataKey}`)).toThrow(/duplicated/);
    expect(parseDataKeys(`k2:${randomBytes(32).toString("base64")},${dataKey}`).map((entry) => entry.kid)).toEqual(["k2", "k1"]);
  });

  it("allows webhooks only to Mi8 loopback or *.sabilulquran.or.id over https (D-4)", () => {
    expect(isAllowedWebhookUrl("http://127.0.0.1:3303/hooks/kirim")).toBe(true);
    expect(isAllowedWebhookUrl("https://spmb.sabilulquran.or.id/api/kirim/webhook")).toBe(true);
    expect(isAllowedWebhookUrl("http://127.0.0.1/hooks")).toBe(false);
    expect(isAllowedWebhookUrl("http://localhost:3303/hooks")).toBe(false);
    expect(isAllowedWebhookUrl("http://spmb.sabilulquran.or.id/hooks")).toBe(false);
    expect(isAllowedWebhookUrl("https://sabilulquran.or.id.evil.example/hooks")).toBe(false);
    expect(isAllowedWebhookUrl("https://user:pass@spmb.sabilulquran.or.id/hooks")).toBe(false);
  });

  it("maps WhatsApp addresses to canonical contacts (D-6)", () => {
    expect(contactFromJid("6281234567890@s.whatsapp.net")).toEqual({ canonical: "pn:+6281234567890", jenis: "pn" });
    expect(contactFromJid("6281234567890:12@s.whatsapp.net")).toEqual({ canonical: "pn:+6281234567890", jenis: "pn" });
    expect(contactFromJid("123456789012345@lid")).toEqual({ canonical: "lid:123456789012345@lid", jenis: "lid" });
    expect(contactFromJid("12036302@g.us")).toBeNull();
  });

  it("keys a chat on the phone number even when WhatsApp addresses it by LID (D-6 revisi 2026-10-30)", () => {
    // A LID chat: the number rides along as peerJidAlt, and that is what the conversation is keyed on, so the
    // chat a staff member started and the person's replies stay one conversation.
    expect(contactFromMessage({ chatJid: "123456789012345@lid", senderJid: "123456789012345@lid", peerJidAlt: "6281234567890@s.whatsapp.net" }))
      .toEqual({ canonical: "pn:+6281234567890", jenis: "pn", lid: "lid:123456789012345@lid" });
    // No number anywhere: the LID still identifies the contact.
    expect(contactFromMessage({ chatJid: "123456789012345@lid", senderJid: null, peerJidAlt: null }))
      .toEqual({ canonical: "lid:123456789012345@lid", jenis: "lid", lid: "lid:123456789012345@lid" });
    // The old shape, before WhatsApp moved to LID.
    expect(contactFromMessage({ chatJid: "6281234567890@s.whatsapp.net", senderJid: "6281234567890@s.whatsapp.net", peerJidAlt: null }))
      .toEqual({ canonical: "pn:+6281234567890", jenis: "pn", lid: null });
    expect(contactFromMessage({ chatJid: "12036302@g.us", senderJid: null, peerJidAlt: null })).toBeNull();
  });

  it("hashes request bodies independently of key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [1, "x"] } })).toBe(canonicalJson({ a: { c: [1, "x"], d: 2 }, b: 1 }));
  });

  it("drops query strings from Kirim SQ request logs", () => {
    expect(safeLogUrl("/admin/kirim/queue?device=spmb&status=gagal")).toBe("/admin/kirim/queue");
    expect(safeLogUrl("/internal/kirim/messages/abc?x=1")).toBe("/internal/kirim/messages/abc");
    expect(safeLogUrl("/workspace?x=1")).toBe("/workspace?x=1");
  });
});
