# HUB-IMPL-021 — Keycloak token exchange for Ringkasan Yayasan (operator preparation)

**Status:** PREPARED, NOT APPLIED. This document describes configuration only. Nothing here has been applied to Mi8VPS or any Keycloak realm. Applying it on production needs explicit owner approval at rollout (HUB-IMPL-021 Rollout step 2, ADR-0009).

**Scope:** realm `sq-staff`, requester client `sq-hub` (production Hub OIDC client), Keycloak 26.7.2 as pinned in `infra/keycloak/Containerfile`. One target client per application that publishes a governance summary (first: HCIS; later Aset SQ, Karir SQ).

## What Hub does

For each eligible application, SQ Hub API sends, server-side:

```text
POST {issuer}/protocol/openid-connect/token
grant_type=urn:ietf:params:oauth:grant-type:token-exchange
client_id=sq-hub, client_secret=<runtime secret>
subject_token=<user's current Hub access token>
subject_token_type=urn:ietf:params:oauth:token-type:access_token
requested_token_type=urn:ietf:params:oauth:token-type:access_token
audience=<registry governance_audience>
scope=sq-governance-<registry governance_audience>
```

- The subject token is the user's own access token, obtained by refreshing the Hub session's sealed refresh token. Hub never uses a service identity to vouch for a user.
- Hub only exchanges to audiences registered in `applications.governance_audience`, for applications that are active, have a summary path, and where the user has active Application Access, and only when the user has an effective Organ Yayasan membership.
- No refresh token is requested. The exchanged token is used for one request with a 3-second budget and is never stored, logged or sent to the browser.

## Keycloak configuration (per Keycloak standard token exchange v2)

Keycloak's `audience` parameter **filters** audiences and never adds them. An audience must already be available through a client scope of the requester. The subject token must contain the requester (`sq-hub`) in `aud`.

1. **Enable standard token exchange on `sq-hub`.** Client › Capability config › "Standard token exchange" = On (`attributes."standard.token.exchange.enabled" = "true"`). Leave "Allow refresh token in Standard Token Exchange" = No.
2. **Make `sq-hub` an audience of its own access tokens.** Add an Audience mapper to the `sq-hub-dedicated` scope: included client audience `sq-hub`, add to access token = On, add to ID token = Off.
3. **For each target application** (example HCIS production client `hcis`; use the exact client ID that the application validates as its own `aud`):
   - Create client scope `sq-governance-hcis` (type None, protocol openid-connect, "Include in token scope" On).
   - Add an Audience mapper: included client audience `hcis`, add to access token = On, add to ID token = Off.
   - Assign `sq-governance-hcis` to `sq-hub` as an **Optional** client scope. Never Default: a default scope would put `hcis` in every Hub token, so an ordinary Hub token would already be valid at the governance endpoint.
4. **Registry.** In Admin Center › Registry aplikasi set, for HCIS: path `/governance/summary`, audience `hcis`, order `1`. For Aset SQ: path `/api/v1/governance/summary`, audience `aset-sq`.
   - Use the path the Hub API actually reaches, not the browser URL. The browser reaches HCIS at `https://<hcis-host>/api/governance/summary`, because the HCIS web proxy strips `/api` before the request reaches the HCIS API. On Mi8, Hub's server-side fetch goes through the internal proxy, which forwards the path unchanged, and HCIS mounts the route at `/governance/summary`. With `/api/governance/summary` in the registry, HCIS returned 404, so Hub hid the card. Production was corrected on 2026-10-18 (platform audit actor `ops:ringkasan-yayasan-20261018`; see sq-core-ops `runbooks/release-2026-10-18-ringkasan-yayasan-activation.md`).
   - Aset SQ serves `/api/v1/...` from its API itself, so its path is the same on both routes.
5. **Do not** grant `sq-hub` any other optional scope with audience mappers for applications outside the registry. The registry plus the optional scopes are the allowlist on both sides.

The target application validates (HUB-IMPL-021 §3): signature, issuer `…/realms/sq-staff`, expiry, `aud` contains its own client ID, maps `iss + sub` like its login, checks its own governance role, accepts the bearer token only on the governance summary endpoint. HCIS ORG-010 also checks `azp = sq-hub`; an exchanged token keeps `azp = sq-hub`.

## Probes before enabling (rollout step 2, needs owner approval)

Run with a synthetic disposable staff identity that has an effective membership in a non-production Hub database or with the owner present. Never print tokens; record only HTTP status and decoded claim names.

| Probe | Expected |
| --- | --- |
| Exchange with `audience=hcis`, `scope=sq-governance-hcis` | `200`; decoded `aud` = `["hcis"]` only, `azp` = `sq-hub`, no `refresh_token` |
| Exchange with an audience not assigned as optional scope (e.g. `audience=aset` before step 3 for Aset) | rejected (`400`/`403`) |
| Exchange with `audience=hcis` from a client without standard token exchange | rejected |
| HCIS governance endpoint with the HCIS-exchanged token | `200` for an identity with the board role, `403` without |
| HCIS governance endpoint with an Aset-exchanged token (AC 8) | `401`/`403` |
| HCIS non-governance endpoint (e.g. `/api/me`) with the HCIS-exchanged token (AC 9) | `401`/`403` |
| Ordinary Hub access token (not exchanged) at the HCIS governance endpoint | `401`/`403` (no `hcis` audience) |

AC 8 and AC 9 are enforced by each domain application and Keycloak; Hub's tests prove only that each exchanged token is sent to its own application.

## Rollback

- Remove `governance_summary_path` from a registry entry: that card disappears at once.
- Remove the optional `sq-governance-*` scope from `sq-hub`, or switch "Standard token exchange" off: every card shows "Tidak dapat dimuat"; nothing else in Hub changes.
- Hub stores no summary data, so nothing needs purging.

## Notes

- If a member's Hub refresh token has expired, `GET /api/governance/summaries` returns `428 ACCOUNT_REAUTH_REQUIRED` and the page asks the member to sign in again.
- Keycloak's exact error for an unavailable audience is not specified in its documentation; Hub treats any non-`200` exchange as a failed card and logs only `exchange_failed`.
