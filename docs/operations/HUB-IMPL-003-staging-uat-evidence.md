# HUB-IMPL-003 Foundation v1 staging UAT evidence

**Status:** ACCEPTED — core HCIS OIDC integration only
**Scope:** HCIS OIDC consumer integration on staging only
**Specification:** `HUB-IMPL-003`
**Recorded:** 2026-08-28 (Asia/Jakarta)

## Scope and evidence handling

This report distinguishes automated/CI evidence, read-only staging observations, and operator-reported controlled live-staging execution. It does not make a Wave 1 completion or production-cutover claim.

The synthetic UAT identity is `uat.hcis.staging@sabilulquran.or.id`. No credential, OIDC subject, access token, client secret, session value, or production data is recorded here.

## Evidence matrix

| Scenario | Expected | Actual | Evidence | Result |
| --- | --- | --- | --- | --- |
| SQ Hub Application Access API contract | A bearer-authenticated machine client receives only an entry decision, not HCIS permissions. | Missing/invalid/forbidden machine credentials are rejected; a revoked grant returns `allowed: false` and `GRANT_REVOKED`. | Local `apps/api/test/app.test.ts`: 5 tests passed. | VERIFIED (automated) |
| Machine-token verification | Only the configured issuer, audience, and allowlisted client are accepted. | Expected token accepted; wrong audience and unknown client rejected. | Local `apps/api/test/machine-auth.test.ts`: 3 tests passed. | VERIFIED (automated) |
| SQ Hub build gates | Foundation API is type-safe, lint-clean, and buildable. | `npm run typecheck`, `npm run lint`, and `npm run build` passed. | Local command output on this branch. | VERIFIED (automated) |
| PostgreSQL-backed Application Access integration suite | Registry, grant/revoke, exact issuer+subject, idempotence, and audit behavior run against PostgreSQL. | GitHub Actions succeeded with PostgreSQL 17 after applying migrations from an empty database, re-applying migrations idempotently, and seeding the staging-shaped registry. The workflow `Test` step passed. | [GitHub Actions run 33138782659](https://github.com/imadjinasi/SQ-Hub/actions/runs/33138782659) for PR #13 / commit `1a89e24`; this verifies the SQ Hub API suite, not HCIS live OIDC behavior. | VERIFIED (CI) |
| Public staging reachability and OIDC entry surface | The active Identity discovery endpoint and HCIS staging root are reachable over TLS; the HCIS entry surface uses SQ Identity rather than a local-password form. | Discovery and HCIS root returned HTTP 200. The anonymous HCIS page exposed `Masuk dengan SQ Identity`; its OIDC start redirected to the active Keycloak authorization endpoint for client `hcis-staging`. | Read-only curl and in-app-browser observation, 2026-08-28. | VERIFIED (live read-only) |
| Provider logout metadata | The active provider advertises an RP-initiated logout endpoint. | Discovery exposes `https://login.sabilulquran.or.id/realms/sq-staff-staging/protocol/openid-connect/logout`. | Read-only OIDC discovery inspection, 2026-08-28. | VERIFIED (live read-only) |
| HCIS OIDC happy path | Synthetic user authenticates at SQ Identity and reaches its existing HCIS local principal. | Verified end to end. | Operator-reported staging UAT, 2026-08-28. | VERIFIED (live) |
| Exact identity mapping | HCIS resolves the principal by exact opaque `issuer + sub`, not email/NIP. | Verified with the existing mapped synthetic identity and exact active issuer. | Operator-reported staging UAT; opaque subject intentionally omitted. | VERIFIED (live) |
| Application Access grant and new-login revoke | An active HCIS grant permits new login; revocation denies the next new session; restore permits it again. | Grant allowed login, revoke denied a new login, and grant restoration allowed login again. | Supported SQ Hub `access-admin` CLI plus browser UAT. | VERIFIED (live) |
| Existing-session timing after revoke | A session established before grant revocation continues to work; a new session after logout is denied; restoring the grant restores new login. | After the synthetic `hcis` grant was revoked, the already-authenticated HCIS session still refreshed and opened the protected Kehadiran page. After logout, a new login was denied. After the grant was restored, a fresh login succeeded. | Controlled live staging execution, 2026-08-28; revoke audit timestamp `2026-08-28T04:08:20.658Z`. | VERIFIED (live) |
| SQ Hub unavailable during new session | If the access-check service is unavailable, HCIS creates no new session and presents controlled denied/unavailable behavior; it never falls back to local auth. | Only `sq-hub-staging-api-1` was stopped. A fresh HCIS login failed closed with the expected controlled denial/unavailable behavior and did not fall back to local authentication. | Controlled live staging execution, 2026-08-28. | VERIFIED (live) |
| Existing session during SQ Hub outage | Existing valid HCIS sessions continue without a per-request SQ Hub dependency. | While `sq-hub-staging-api-1` was stopped, the already-authenticated HCIS browser remained usable, including protected navigation. HCIS, its PostgreSQL, and Keycloak remained healthy. | Controlled live staging execution and container-status observation, 2026-08-28. | VERIFIED (live) |
| SQ Hub outage recovery | After the access-check API recovers, new HCIS login works again with an active grant. | `sq-hub-staging-api-1` returned to `healthy`; `http://127.0.0.1:18100/health` returned `{"status":"ok"}`; a fresh HCIS login then succeeded. | Controlled live staging execution, 2026-08-28. | VERIFIED (live) |
| Logout contract | Local HCIS session is invalidated and the intended Keycloak SSO session is terminated through RP-initiated logout. | HCIS logout redirected into the Keycloak logout flow. Keycloak displayed a confirmation button; after confirming logout, reopening HCIS in the same browser context required authentication again rather than silently reusing SSO. | Controlled live browser UAT, 2026-08-28. | VERIFIED (live; UX finding recorded) |
| Application Access denial experience | Denial is safe and does not leak details. | Current message is generic: `Masuk melalui SQ Identity gagal atau akses HCIS tidak tersedia. Silakan coba lagi.` | Operator-reported staging UAT. | VERIFIED (finding recorded) |
| Active issuer/source-of-truth alignment | Accepted staging docs/config examples use the exact issuer advertised by the active realm. | PR #14 aligned source-of-truth, config examples, CI/test fixtures, and proxy examples to `https://login.sabilulquran.or.id/realms/sq-staff-staging` and was merged after successful CI and Keycloak Infra checks. | PR #14, merged as `27bfe1d9ffd2869bbfb457a65b4335a6073e7103`. | VERIFIED (repository) |

## Core acceptance decision

The **core HCIS OIDC integration UAT is ACCEPTED for staging**.

The narrow core decision is supported by all four previously blocking conditions:

1. an HCIS session established before Application Access revoke remained valid; a new session after revoke was denied; restoring the grant restored new login;
2. an existing HCIS session remained valid while the SQ Hub Application Access API was unavailable, while a new login failed closed without local-auth fallback; recovery restored new login;
3. HCIS logout invalidated the application session and, after the Keycloak confirmation step, terminated the SSO session so the same browser was required to authenticate again;
4. the active issuer/source-of-truth mismatch was resolved by merged PR #14.

This acceptance is deliberately narrower than full `HUB-IMPL-003`, Wave 1 completion, or production cutover readiness.

## Deferred pre-production security/persona gates

The following gates remain required by the accepted specification and staging runbook. They are recorded without invented execution results:

| Deferred gate | Source requirement | Current result |
| --- | --- | --- |
| Ordinary Employee persona | Spec and runbook require an ordinary Employee synthetic persona. The recorded happy path does not classify the current synthetic user as this persona. | NOT EXECUTED / NOT RECORDED |
| Local authorization continuity for manager and Human Capital administrator | `HUB-IMPL-003` requires existing role/permission/scope behavior to continue; the runbook requires manager and Human Capital administrator browser UAT. | NOT EXECUTED / NOT RECORDED |
| Privileged/Super Admin MFA and recovery | Spec and runbook require a privileged persona with MFA; runbook requires TOTP and recovery-path verification. | NOT EXECUTED / NOT RECORDED |
| Non-Employee Staff | Spec and runbook require a non-Employee Staff persona. | NOT EXECUTED / NOT RECORDED |
| HCIS-local suspended/inactive compatibility | Suspended/inactive HCIS account must be denied without automatically disabling its global Keycloak identity. | NOT EXECUTED / NOT RECORDED |
| Globally disabled identity | A globally disabled Keycloak identity must be denied. | NOT EXECUTED / NOT RECORDED |
| Mapping and callback failure cases | Wrong issuer/same subject, same issuer/wrong subject, unknown/ambiguous identity, and invalid state/nonce/code must deny safely. | NOT EXECUTED / NOT RECORDED |
| Machine access-check failure | HCIS must not bypass a rejected/failed machine credential when it asks SQ Hub for Application Access. | NOT EXECUTED END TO END; SQ Hub API machine-token contract is VERIFIED (CI). |
| Browser/session security | Browser storage must contain no OIDC access/refresh tokens; application cookies must have the required scope/security attributes. | NOT EXECUTED / NOT RECORDED |
| OIDC-mode local-auth exclusion | Local-password authentication must be unreachable through alternate public routes while HCIS runs in OIDC mode. | NOT EXECUTED / NOT RECORDED |
| Keycloak outage behavior | A Keycloak outage must deny new OIDC login without a silent local-auth fallback; existing HCIS local sessions may continue until normal expiry. | NOT EXECUTED / NOT RECORDED |
| Staging rollback rehearsal | Configuration-first rollback to isolated local-auth staging and restoration to OIDC must be rehearsed and documented. | NOT EXECUTED / NOT RECORDED |
| Keycloak staging backup/restore | Wave 1 requires a tested Keycloak staging backup/restore. | NOT EXECUTED / NOT RECORDED |

These gates keep **Wave 1 completion and production cutover blocked**. They have not been removed or waived by accepting the core integration.

## Executed live core procedure

### Session timing

1. A synthetic user established an HCIS session while its `hcis` Application Access grant was active.
2. The supported SQ Hub CLI revoked only that synthetic grant.
3. The existing browser refreshed `/app`, opened Kehadiran, and returned to Dashboard successfully.
4. The HCIS logout operation ended the existing application session.
5. A fresh login while the grant remained revoked was denied after SQ Identity authentication.
6. The supported SQ Hub CLI restored the grant.
7. A fresh login then succeeded.

### SQ Hub API outage / fail closed

1. An already-authenticated HCIS browser session was kept open.
2. Only `sq-hub-staging-api-1` was stopped. HCIS, HCIS PostgreSQL, Keycloak, and Keycloak PostgreSQL remained running and healthy.
3. The existing HCIS browser remained usable.
4. A fresh login in another browser context failed closed and did not expose/fall back to local password authentication.
5. `sq-hub-staging-api-1` was started again and reached `healthy` after the container health check.
6. The local health endpoint returned `{"status":"ok"}` and a fresh HCIS login succeeded.

### Logout contract

1. The authenticated browser invoked HCIS's existing logout contract.
2. HCIS redirected to the Keycloak RP-initiated logout flow.
3. Keycloak displayed an explicit logout confirmation action before ending the SSO session.
4. After confirmation, reopening HCIS in the same browser context required authentication again.

## UAT findings and technical debt

1. HCIS has no profile/logout menu although a backend/frontend logout contract exists. A focused HCIS UX follow-up should expose the supported logout path on desktop and mobile.
2. Keycloak currently adds an additional logout-confirmation step after the user has already initiated logout from HCIS. This is not a core security failure because the SSO session terminates after confirmation, but it is a UX debt. A follow-up should use the supported RP-initiated logout/client contract to remove redundant confirmation where safely possible rather than bypassing IdP logout semantics.
3. Application Access denial currently shares the generic OIDC/access message above. A future approved UX change should distinguish a denied HCIS Application Access grant from a generic OIDC/authentication failure without leaking sensitive details.
4. The synthetic Keycloak user was asked to complete its profile on first login because `firstName` and `lastName` were not provisioned. Provisioning completeness should be defined and checked for staging personas.
5. SQ Identity's login/logout surfaces remain visually too generic relative to the accepted HCIS/SQ design baseline, including page-level branding details such as favicon. A dedicated identity-theme UX follow-up should align the complete Keycloak journey without making it HCIS-specific.
6. Account/security management should ultimately be centralized in SQ Account / SQ Hub rather than duplicated in each domain application.
7. Existing HCIS local-account mechanics are migration compatibility concerns; they must not become the default identity/access pattern for future domain applications.

## Acceptance recommendation

**ACCEPT the core HCIS OIDC integration UAT for staging.** The live session-timing, SQ Hub outage/fail-closed, recovery, logout/SSO, and issuer-alignment blockers are now evidenced as passed.

**DO NOT ACCEPT Wave 1 completion or production cutover readiness.** The deferred pre-production security/persona gates above remain outstanding, alongside the separate production-cutover authorization and operational requirements in the accepted source-of-truth.
