import { describe, expect, it } from "vitest";

import { DEFAULT_SEND_SAFETY_CONFIG, PerDeviceSendSafety, SendSafetyError } from "../src/wa/send-safety.js";
import { isSensitiveLibsignalDiagnostic, installLibsignalConsoleRedaction } from "../src/wa/libsignal-console-redaction.js";

/**
 * Carried over from JalurPesan `server/test/send-safety.test.ts` and
 * `server/test/libsignal-console-redaction.test.ts` (KIRIM-IMPL-005 §13). These two guards are
 * why a number does not get itself blocked, and why private ratchet material never reaches a log
 * file on a phone.
 */

function safety(config: Partial<typeof DEFAULT_SEND_SAFETY_CONFIG>, clock: { now: number }) {
  return new PerDeviceSendSafety({ ...DEFAULT_SEND_SAFETY_CONFIG, ...config }, () => clock.now);
}

describe("send safety", () => {
  it("keeps a minimum interval between sends from one number", () => {
    const clock = { now: 0 };
    const guard = safety({ minimumIntervalMs: 1_000, duplicateWindowMs: 0 }, clock);
    guard.acquire("spmb", "62811111111", "First")();
    clock.now = 999;
    expect(() => guard.acquire("spmb", "62811111111", "Second")).toThrow(SendSafetyError);
    clock.now = 1_000;
    expect(() => guard.acquire("spmb", "62811111111", "Second")).not.toThrow();
  });

  it("holds a rolling minute and hour limit per number", () => {
    const clock = { now: 0 };
    const guard = safety({ minimumIntervalMs: 0, duplicateWindowMs: 0, maxPerMinute: 2, maxPerHour: 3 }, clock);
    guard.acquire("spmb", "62811111111", "One")();
    clock.now = 1;
    guard.acquire("spmb", "62811111111", "Two")();
    clock.now = 2;
    expect(() => guard.acquire("spmb", "62811111111", "Three")).toThrow(/menit|minute/i);
    clock.now = 60_001;
    guard.acquire("spmb", "62811111111", "Three")();
    clock.now = 60_002;
    try {
      guard.acquire("spmb", "62811111111", "Four");
      throw new Error("expected the hour limit to stop this send");
    } catch (error) {
      expect((error as SendSafetyError).code).toBe("hour_limit");
    }
  });

  it("suppresses the very same message to the same person inside the window", () => {
    const clock = { now: 0 };
    const guard = safety({ minimumIntervalMs: 0, duplicateWindowMs: 10_000 }, clock);
    guard.acquire("spmb", "62811111111", "Same message")();
    clock.now = 9_999;
    try {
      guard.acquire("spmb", "62811111111", "Same message");
      throw new Error("expected the duplicate guard to stop this send");
    } catch (error) {
      expect((error as SendSafetyError).code).toBe("duplicate");
    }
    // Another recipient is another message, not a duplicate.
    expect(() => guard.acquire("spmb", "62822222222", "Same message")).not.toThrow();
  });

  it("allows one send at a time per number and keeps numbers apart", () => {
    const clock = { now: 0 };
    const guard = safety({ minimumIntervalMs: 0, duplicateWindowMs: 0 }, clock);
    const release = guard.acquire("spmb", "62811111111", "First");
    try {
      guard.acquire("spmb", "62822222222", "Second");
      throw new Error("expected the in-progress guard to stop this send");
    } catch (error) {
      expect((error as SendSafetyError).code).toBe("send_in_progress");
    }
    // A different number has its own state entirely.
    expect(() => guard.acquire("hcis", "62811111111", "First")).not.toThrow();
    release();
    expect(() => guard.acquire("spmb", "62822222222", "Second")).not.toThrow();
  });
});

describe("libsignal console redaction", () => {
  it("drops the library's session diagnostics and nothing else", () => {
    expect(isSensitiveLibsignalDiagnostic(["Closing session: {...}"])).toBe(true);
    expect(isSensitiveLibsignalDiagnostic(["Opening session: {...}"])).toBe(true);
    expect(isSensitiveLibsignalDiagnostic(["kirim-wa is listening"])).toBe(false);
    expect(isSensitiveLibsignalDiagnostic([{ event: "anything" }])).toBe(false);
  });

  it("installs on the console and can be taken off again", () => {
    const written: unknown[][] = [];
    const target = { info: (...args: unknown[]) => written.push(args), warn: (...args: unknown[]) => written.push(args) };
    const restore = installLibsignalConsoleRedaction(target);

    target.info("Closing session:", { ratchet: "secret" });
    target.warn("Session already open", { ratchet: "secret" });
    target.info("ordinary line");

    expect(written).toEqual([["ordinary line"]]);
    restore();
    target.info("Closing session:", {});
    expect(written).toHaveLength(2);
  });
});
