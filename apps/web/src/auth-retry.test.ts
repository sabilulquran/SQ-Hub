import { describe, expect, it } from "vitest";

import {
  claimOidcRetry,
  claimOidcRetryStart,
  OIDC_RETRY_MARKER_NAME,
  OIDC_RETRY_WINDOW_MS,
  oidcRetryStartPath,
} from "@/auth-retry";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

const now = 1_795_485_383_000;

describe("HUB-IMPL-005 Rev 2 automatic sign-in retry", () => {
  it("retries only the generic callback failure", () => {
    expect(oidcRetryStartPath("/", "?authError=oidc_failed")).toBe("/api/auth/oidc/start");
    expect(oidcRetryStartPath("/", "?authError=organ_access_denied")).toBeNull();
    expect(oidcRetryStartPath("/", "?authError=organ_membership_required")).toBeNull();
    expect(oidcRetryStartPath("/", "?authError=identity_unavailable")).toBeNull();
    expect(oidcRetryStartPath("/", "")).toBeNull();
    expect(oidcRetryStartPath("/", "?authError=oidc_failed%26x")).toBeNull();
  });

  it("returns an Akun SQ account action to the account page", () => {
    expect(oidcRetryStartPath("/account", "?authError=oidc_failed")).toBe("/api/auth/oidc/start?returnTo=account");
    expect(oidcRetryStartPath("/account/", "?authError=oidc_failed")).toBe("/api/auth/oidc/start?returnTo=account");
  });

  it("claims the first retry and stores only a timestamp", () => {
    const storage = memoryStorage();
    expect(claimOidcRetry(storage, now)).toBe(true);
    expect([...storage.values.entries()]).toEqual([[OIDC_RETRY_MARKER_NAME, String(now)]]);
  });

  it("refuses a second retry inside the window so a failing sign-in cannot loop", () => {
    const storage = memoryStorage();
    expect(claimOidcRetry(storage, now)).toBe(true);
    expect(claimOidcRetry(storage, now + 5_000)).toBe(false);
    expect(claimOidcRetry(storage, now + OIDC_RETRY_WINDOW_MS - 1)).toBe(false);
    expect(claimOidcRetry(storage, now + OIDC_RETRY_WINDOW_MS)).toBe(true);
  });

  it("treats a marker from the future as recent and replaces an unreadable one", () => {
    expect(claimOidcRetry(memoryStorage({ [OIDC_RETRY_MARKER_NAME]: String(now + 60_000) }), now)).toBe(false);
    const garbled = memoryStorage({ [OIDC_RETRY_MARKER_NAME]: "garbage" });
    expect(claimOidcRetry(garbled, now)).toBe(true);
    expect(garbled.values.get(OIDC_RETRY_MARKER_NAME)).toBe(String(now));
  });

  it("never retries without a working storage", () => {
    expect(claimOidcRetry(undefined, now)).toBe(false);
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => undefined,
    };
    expect(claimOidcRetry(throwing, now)).toBe(false);
    expect(claimOidcRetry({ getItem: () => null, setItem: () => undefined }, now)).toBe(false);
  });

  it("decides the start once per failure and leaves other pages to render", () => {
    const storage = memoryStorage();
    expect(claimOidcRetryStart("/", "?authError=oidc_failed", storage, now)).toBe("/api/auth/oidc/start");
    expect(claimOidcRetryStart("/", "?authError=oidc_failed", storage, now + 1_000)).toBeNull();
    const untouched = memoryStorage();
    expect(claimOidcRetryStart("/", "", untouched, now)).toBeNull();
    expect(claimOidcRetryStart("/", "?authError=organ_access_denied", untouched, now)).toBeNull();
    expect(untouched.values.size).toBe(0);
  });
});
