> **RETIRED / ARCHIVED — DO NOT DEPLOY — DO NOT RECREATE.** Staging references and staging commands in this document are historical evidence. The production VPS is production-only by owner decision of 2 October 2026. See the permanent-retirement runbook; historical staging instructions do not authorize deployment.

# HUB-IMPL-005 — SQ Hub Authenticated Workspace

**Status:** ACCEPTED  
**Date:** 2026-08-29  
**Depends on:** `HUB-IMPL-002`, `HUB-IMPL-004`, ADR-0003, staff authentication policy  
**Environment first:** staging

## Objective

Turn the visual SQ Hub shell from `HUB-IMPL-004` into a real internal staff workspace without moving credentials, domain authorization, or browser tokens into SQ Hub.

The implementation must provide a dedicated SQ Hub OIDC client, server-side Authorization Code + PKCE handling, a host-only application session, an authenticated workspace snapshot derived from Application Access, and official logout through SQ Identity.

## Identity and OIDC

SQ Hub is an OIDC relying party of SQ Identity/Keycloak.

Staging contract:

- issuer: `https://login.sabilulquran.or.id/realms/sq-staff-staging`;
- client ID: `sq-hub-staging`;
- client type: confidential;
- standard Authorization Code flow only;
- PKCE: S256;
- implicit flow: disabled;
- direct access grants: disabled;
- redirect URI: `https://hub-staging.sabilulquran.or.id/auth/callback`;
- post-logout redirect: `https://hub-staging.sabilulquran.or.id/`;
- requested scopes: `openid profile`.

Client secrets are environment secrets and must never be committed.

The application validates issuer, `sub`, state, nonce, and PKCE through the standard OIDC library. SQ Hub must not implement its own OAuth/OIDC protocol logic.

## OIDC transaction state

Authorization transaction material is server-side.

A short-lived opaque transaction cookie identifies a database row containing:

- state;
- PKCE code verifier;
- nonce;
- created/expiry time.

Rules:

- transaction TTL: 10 minutes;
- transaction cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`, host-only, and `Secure` in staging/production;
- no state, verifier, nonce, authorization code, access token, refresh token, or ID token is stored in browser localStorage/sessionStorage;
- the transaction is consumed once on callback and removed even when completion fails.

## SQ Hub application session

After successful OIDC callback, SQ Hub creates its own opaque server-side session.

Session storage contains only the identity/profile data necessary for the Hub experience, not Keycloak bearer tokens:

- OIDC issuer;
- opaque OIDC subject;
- display name derived from standard profile claims;
- token hash;
- created time;
- last-seen time;
- absolute expiry;
- revoked time;
- request metadata needed for security audit where available.

Session baseline follows staff policy:

- idle expiry: 8 hours;
- absolute maximum: 12 hours;
- cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`, host-only, and `Secure` in staging/production;
- no `Domain` attribute;
- raw session tokens are never stored in the database;
- logout revokes the server-side session and clears the browser cookie.

Application Access is not copied into the session.

## Who may enter SQ Hub

Foundation v1 does not invent a separate `hub` Application Access grant.

A successfully authenticated identity in the accepted staff realm may create an SQ Hub session. The workspace may legitimately be empty if that identity has no active Application Access grants.

This does not grant access to any domain application.

## Authenticated workspace contract

`GET /workspace` requires a valid SQ Hub session and returns the exact browser-facing `WorkspaceSnapshot` contract established in `HUB-IMPL-004`:

```ts
interface WorkspaceSnapshot {
  user: {
    displayName: string;
    initials: string;
    contextLabel?: string;
  };
  applications: Array<{
    key: string;
    name: string;
    description?: string;
    canonicalUrl: string;
  }>;
}
```

Application selection is performed server-side on every workspace request:

- application status must be `active`;
- the identity's Application Access status must be `active`;
- revoked/no-grant/inactive applications are not returned at all;
- the browser is never given the full registry and asked to hide inaccessible applications;
- domain roles/permissions are not evaluated by SQ Hub.

The initial registry has no shared description field, so `description` may be omitted rather than inventing business copy.

## User presentation

The Hub does not expose OIDC `sub` to the browser.

`displayName` is taken from the standard OIDC `name` profile claim when available, with `preferred_username` as a safe fallback. Initials are derived server-side from that presentation name.

Organizational context is omitted until a shared organizational/profile contract exists; this implementation must not query HCIS business data merely to decorate the Hub shell.

## Browser flow

The web application boot sequence is:

1. request `/api/workspace` with same-origin credentials;
2. if `200`, render `WorkspaceShell` using only the returned snapshot;
3. if `401`, navigate to `/api/auth/oidc/start`;
4. for unexpected availability failures, show a safe retry state rather than fabricating workspace data.

OIDC callback is server-side at `/auth/callback` and redirects back to `/` after session creation.

### Rev 2 - 24 November 2026: one automatic retry after a failed callback

**Status:** ACCEPTED (owner, 2026-11-24: "Ya, perbaiki" on the audit of sign-ins that landed on the "Masuk dengan Akun SQ" retry state).

Applies to every application the Hub web bundle serves and that reuses the Hub auth code: SQ Hub, Kerja SQ, Kirim SQ, Sekretariat SQ, and Portal Organ.

Finding: the OIDC transaction lives 10 minutes (`HUB_OIDC_TRANSACTION_TTL_MINUTES`, and `transactionTtlMinutes: 10` in the Kerja, Kirim, Sekretariat and Organ modules), while the Akun SQ sign-in page (realm `sq-staff` `login_lifespan`) lives 30 minutes. A sign-in page left open for 10 to 30 minutes lets Keycloak accept the sign-in, but the callback finds no transaction and redirects to `/?authError=oidc_failed`. The page then stopped at its error state although the Akun SQ SSO session was already active. One transaction cookie per application also lets two tabs, or two starts sent close together, replace each other's transaction; the losing callback fails the same way.

- Before any application renders, the web entry reads `authError`. On `oidc_failed` it writes a marker cookie `sq_oidc_retry_at` (epoch milliseconds; host-only, `Path=/`, `Max-Age=120`, `SameSite=Lax`, `Secure` on HTTPS; not `HttpOnly` because the page itself must read it back), reads it back, and replaces the location with `/api/auth/oidc/start` (`?returnTo=account` on `/account`). Meanwhile only a neutral "Membuka Akun SQ…" status shows. Because the SSO session is usually active, the person lands in the application without seeing the error.
- Loop bound: a retry is allowed only when no marker is newer than 2 minutes; a marker dated in the future counts as recent. A second `oidc_failed` inside the window shows the application's existing error and retry state. When the marker cannot be stored (cookies blocked, `document.cookie` throwing, or the value not reading back) there is no automatic retry: with cookies blocked the transaction cookie is lost too, so this is the case that would otherwise loop.
- The marker is a cookie, not web storage, because the web source keeps no authentication material in `localStorage` or `sessionStorage` (guardrail `apps/web/src/security.test.ts`, unchanged). It carries only a timestamp; it is not a token, state, code, or identity.
- Only `oidc_failed` is retried. `identity_unavailable`, `organ_access_denied`, `organ_membership_required` and any other value keep their current behaviour.
- The URL contract, transaction TTL and transaction cookies are unchanged. The retry starts a new transaction owned by the same browser, so it adds no login CSRF path. Portal Organ's step-up start (`?stepUp=1`) is not repeated automatically: a failed step-up comes back signed in at the normal level and the member asks for the step-up again.
- Observability: callback routes stay `logLevel: "silent"` so the authorization code never reaches a request log. A refused callback now writes one warning `{ event: "oidc_callback_refused", client, code }`, where `code` is the fixed `HubAuthError` code (for example `OIDC_TRANSACTION_MISSING`, `OIDC_TRANSACTION_EXPIRED`, `OIDC_COMPLETION_FAILED`, `OIDC_STEP_UP_FAILED`) or `OIDC_CALLBACK_UNEXPECTED`. No message, state, code, token, cookie or identity is logged.
- No migration and no new audit table.
- Acceptance:
  - HUB-IMPL-005-R2-A: the first `oidc_failed` in a tab restarts the sign-in automatically, without rendering the application's error state.
  - HUB-IMPL-005-R2-B: a second `oidc_failed` within 2 minutes renders the existing error state; there is no loop.
  - HUB-IMPL-005-R2-C: other `authError` values are not retried.
  - HUB-IMPL-005-R2-D: when the marker cookie cannot be stored the behaviour is the same as before Rev 2.
  - HUB-IMPL-005-R2-E: every refused callback in every Hub-family client logs exactly the fixed refusal code and no request value.

The account-menu `Keluar` action:

1. `POST /api/auth/logout`;
2. server revokes the local Hub session and clears the session cookie;
3. server returns the SQ Identity end-session URL when available;
4. browser navigates to that URL;
5. Keycloak logout confirmation may remain visible; SQ Hub must not bypass it with CSS/client hacks.

## Reverse proxy boundary

The SQ Hub web container is the public staging target.

Its nginx config must:

- proxy `/api/*` to the internal SQ Hub API;
- proxy exact `/auth/callback` to the internal SQ Hub API so the authorization code never reaches SPA/static handling;
- serve the SPA for other routes;
- keep static asset caching bounded and health endpoint available.

The API remains internal/private to the application stack except for existing explicitly published operational/internal paths already required by the foundation.

## Keycloak configuration boundary

Repository realm configuration records the desired staging client shape for repeatability, but client secret material is never committed.

Live staging client creation/update and secret placement are deployment operations and require:

- exact staging realm only;
- no mutation to HCIS client/audience/mappers;
- no production realm mutation;
- post-change issuer/client smoke verification.

## Audit

At minimum, SQ Hub records security events for:

- successful Hub session creation;
- failed/expired OIDC transaction completion where safely attributable;
- (Rev 2) every refused callback, as the operational warning `oidc_callback_refused` with only its fixed code;
- Hub logout.

Audit payload must not contain credentials, cookies, authorization codes, access/refresh/ID tokens, PKCE verifiers, or client secrets.

## Acceptance criteria

1. Dedicated staging client contract is represented as `sq-hub-staging`; no existing HCIS client behavior is changed.
2. Authorization Code + S256 PKCE, state, and nonce are handled server-side with the standard OIDC library.
3. Browser receives only opaque Hub cookies; no OIDC token/code storage code exists in localStorage/sessionStorage.
4. OIDC transaction state is short-lived, one-time, server-side, and cleaned after callback.
5. Hub session enforces idle 8h and absolute 12h server-side and uses a secure host-only cookie in staging.
6. `GET /workspace` returns only applications with active registry status + active Application Access for the authenticated `issuer + sub`.
7. Revoking an application's grant removes that application from a subsequent workspace response without invalidating the Hub identity session.
8. Empty access produces a valid empty workspace, not authentication failure.
9. Browser never receives OIDC subject or the complete unauthorized application registry.
10. Account-menu logout revokes the local Hub session, clears its cookie, and continues through SQ Identity logout.
11. Reopening the Hub after completed SSO logout requires authentication.
12. Web reverse proxy keeps `/auth/callback` server-side and proxies `/api/*` to the API.
13. API/web typecheck, lint, test, and build pass; relevant auth/workspace integration tests exist.
14. Staging UAT uses synthetic identity data; no secret or production personal data is committed or printed.
15. Production remains untouched until explicit cutover approval.

## Staging UAT

Minimum live UAT before acceptance:

- unauthenticated Hub redirects to branded SQ Identity;
- synthetic UAT login reaches SQ Hub and visible identity is correct;
- only granted applications render;
- revoke HCIS Application Access while Hub session remains active -> Hub stays authenticated but HCIS disappears after workspace refresh;
- restore HCIS access -> HCIS reappears;
- no OIDC tokens/codes in browser storage;
- account-menu logout invalidates Hub local session and completes SQ Identity logout;
- same-browser reopen requires authentication;
- final Application Access restored active;
- HCIS/SQ Hub/Keycloak staging health remains good;
- production untouched.
