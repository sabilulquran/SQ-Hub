/**
 * HUB-IMPL-005 Rev 2: one automatic retry of the Akun SQ sign-in after `authError=oidc_failed`,
 * for every application this web bundle serves (SQ Hub, Kerja SQ, Kirim SQ, Sekretariat SQ,
 * Portal Organ). The usual cause is an Akun SQ sign-in page left open longer than the 10-minute
 * OIDC transaction: Akun SQ accepted the sign-in, so a fresh start passes straight through.
 */

/**
 * Marker of the last automatic retry: a host-only cookie holding a timestamp, never a token, a
 * state, or an identity. A cookie rather than browser web storage, which this web source never
 * uses for anything related to sign-in (guardrail in security.test.ts).
 */
export const OIDC_RETRY_MARKER_NAME = "sq_oidc_retry_at";
/** A second `oidc_failed` within this window keeps the page's error and retry button. */
export const OIDC_RETRY_WINDOW_MS = 2 * 60 * 1000;

export interface RetryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Where the automatic retry starts, or null when the page must show its own error. Only the
 * generic callback failure is retried; refusals such as `organ_access_denied` or
 * `identity_unavailable` would only fail the same way.
 */
export function oidcRetryStartPath(pathname: string, search: string): string | null {
  if (new URLSearchParams(search).get("authError") !== "oidc_failed") return null;
  return pathname === "/account" || pathname === "/account/"
    ? "/api/auth/oidc/start?returnTo=account"
    : "/api/auth/oidc/start";
}

/**
 * Claims the one automatic retry. True only when no retry happened within `OIDC_RETRY_WINDOW_MS`
 * and the new marker was written and reads back; a missing or failing store (cookies blocked)
 * returns false, so the page keeps its button and can never loop.
 */
export function claimOidcRetry(storage: RetryStorage | undefined, now: number): boolean {
  if (!storage) return false;
  try {
    const previous = storage.getItem(OIDC_RETRY_MARKER_NAME);
    const previousAt = previous === null ? Number.NaN : Number(previous);
    // A timestamp in the future (clock moved back) counts as recent, never as expired.
    if (Number.isFinite(previousAt) && now - previousAt < OIDC_RETRY_WINDOW_MS) return false;
    const marker = String(now);
    storage.setItem(OIDC_RETRY_MARKER_NAME, marker);
    return storage.getItem(OIDC_RETRY_MARKER_NAME) === marker;
  } catch {
    return false;
  }
}

/** The marker cookie as a tiny key-value store; `document.cookie` may throw in a sandbox. */
export function cookieRetryStorage(): RetryStorage | undefined {
  try {
    const page = window.document;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    const maxAge = Math.floor(OIDC_RETRY_WINDOW_MS / 1000);
    return {
      getItem: (key) => {
        const prefix = `${key}=`;
        const entry = page.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
        return entry === undefined ? null : decodeURIComponent(entry.slice(prefix.length));
      },
      setItem: (key, value) => {
        page.cookie = `${key}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
      },
    };
  } catch {
    return undefined;
  }
}

/** The start path to navigate to now, or null to render the application as before. */
export function claimOidcRetryStart(
  pathname: string,
  search: string,
  storage: RetryStorage | undefined,
  now: number,
): string | null {
  const start = oidcRetryStartPath(pathname, search);
  if (start === null) return null;
  return claimOidcRetry(storage, now) ? start : null;
}
