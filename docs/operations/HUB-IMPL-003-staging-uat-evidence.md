# HUB-IMPL-003 Foundation v1 staging UAT evidence

**Status:** IN PROGRESS — do not accept yet
**Scope:** HCIS OIDC consumer integration on staging only
**Specification:** `HUB-IMPL-003`
**Recorded:** 2026-08-28 (Asia/Jakarta)

## Scope and evidence handling

This report distinguishes between evidence produced in the local SQ Hub checkout, operator-reported staging observations supplied for this UAT, and scenarios that still require a controlled live-staging execution. It does not make a production-cutover claim.

The synthetic UAT identity is `uat.hcis.staging@sabilulquran.or.id`. No credential, OIDC subject, access token, client secret, session value, or production data is recorded here.

## Evidence matrix

| Scenario | Expected | Actual | Evidence | Result |
| --- | --- | --- | --- | --- |
| SQ Hub Application Access API contract | A bearer-authenticated machine client receives only an entry decision, not HCIS permissions. | Missing/invalid/forbidden machine credentials are rejected; a revoked grant returns `allowed: false` and `GRANT_REVOKED`. | Local `apps/api/test/app.test.ts`: 5 tests passed. | VERIFIED (automated) |
| Machine-token verification | Only the configured issuer, audience, and allowlisted client are accepted. | Expected token accepted; wrong audience and unknown client rejected. | Local `apps/api/test/machine-auth.test.ts`: 3 tests passed. | VERIFIED (automated) |
| SQ Hub build gates | Foundation API is type-safe, lint-clean, and buildable. | `npm run typecheck`, `npm run lint`, and `npm run build` passed. | Local command output on this branch. | VERIFIED (automated) |
| PostgreSQL-backed Application Access integration suite | Registry, grant/revoke, exact issuer+subject, idempotence, and audit behavior run against PostgreSQL. | GitHub Actions succeeded with PostgreSQL 17 after applying migrations from an empty database, re-applying migrations idempotently, and seeding the staging-shaped registry. The workflow `Test` step passed. | [GitHub Actions run 33138782659](https://github.com/imadjinasi/SQ-Hub/actions/runs/33138782659) for PR #13 / commit `1a89e24`; this verifies the SQ Hub API suite, not HCIS live OIDC behavior. | VERIFIED (CI) |
| Public staging reachability and OIDC entry surface | The active Identity discovery endpoint and HCIS staging root are reachable over TLS; the HCIS entry surface uses SQ Identity rather than a local-password form. | Discovery and HCIS root returned HTTP 200. The anonymous HCIS page exposed `Masuk dengan SQ Identity`; its OIDC start redirected to the active Keycloak authorization endpoint for client `hcis-staging`. | Read-only curl and in-app-browser observation, 2026-08-28. | VERIFIED (live read-only) |
| Provider logout metadata | The active provider advertises an RP-initiated logout endpoint. | Discovery exposes `https://login.sabilulquran.or.id/realms/sq-staff-staging/protocol/openid-connect/logout`. This alone does not prove HCIS invokes it or that SSO termination succeeds. | Read-only OIDC discovery inspection, 2026-08-28. | VERIFIED (live read-only) |
| HCIS OIDC happy path | Synthetic user authenticates at SQ Identity and reaches its existing HCIS local principal. | Reported manually verified end to end. | UAT context supplied to this task. | VERIFIED (live, operator-reported) |
| Exact identity mapping | HCIS resolves the principal by exact opaque `issuer + sub`, not email/NIP. | Reported manually verified. | UAT context supplied to this task. | VERIFIED (live, operator-reported) |
| Application Access grant and new-login revoke | An active HCIS grant permits new login; revocation while logged out denies the next login; restore permits it again. | Reported manually verified. | UAT context supplied to this task. | VERIFIED (live, operator-reported) |
| Existing-session timing after revoke | A session already established before grant revocation continues to work; a new session after logout is denied; restoring the grant restores new login. | Not executed in this run. | Controlled live procedure below. | NEEDS LIVE EXECUTION |
| SQ Hub unavailable during new session | If the access-check service is unavailable, HCIS creates no new session and presents controlled denied/unavailable behavior; it never falls back to local auth. | Not executed in this run. | Controlled live procedure below. | NEEDS LIVE EXECUTION |
| Existing session during SQ Hub outage | Existing valid HCIS sessions continue without a per-request SQ Hub dependency. | Not executed in this run. | Controlled live procedure below. | NEEDS LIVE EXECUTION |
| Logout contract | Local HCIS session is invalidated, RP-initiated logout is used correctly, and the actual Keycloak SSO result is observed. | HCIS backend logout endpoint is reported to work, but this run could not execute an authenticated browser/session verification or observe IdP SSO termination. | UAT context supplied to this task; controlled live procedure below. | NEEDS LIVE EXECUTION |
| Application Access denial experience | Denial is safe and does not leak details. | Current message is generic: `Masuk melalui SQ Identity gagal atau akses HCIS tidak tersedia. Silakan coba lagi.` | UAT context supplied to this task. | VERIFIED (finding recorded) |

## Environment discrepancy requiring resolution

The accepted runbook and examples use `https://login-staging.sabilulquran.or.id/realms/sq-staff-staging`, but this host did not resolve from this UAT workstation. The supplied current endpoint `https://login.sabilulquran.or.id/realms/sq-staff-staging/.well-known/openid-configuration` returned HTTP 200 and declares this exact issuer:

```text
https://login.sabilulquran.or.id/realms/sq-staff-staging
```

This report does **not** infer that those issuers are interchangeable. Before accepting the remaining UAT scenarios, the operator must record the exact `issuer` value from the active discovery document and align the relevant staging documentation/configuration through the normal change process. Existing persisted `issuer + sub` bindings must use the exact configured issuer.

## Acceptance scope classification

The **core HCIS OIDC integration UAT** is a deliberately narrow staging integration decision. Its remaining controlled-live scenarios are:

1. existing-session behavior after an HCIS Application Access revoke, followed by denied new login and restored new-login capability;
2. new-login fail-closed behavior while the SQ Hub Application Access API is unavailable, including continuity of a session established before the outage;
3. authenticated logout, including local HCIS-session invalidation and the intended Keycloak SSO-session termination result;
4. active issuer/source-of-truth alignment.

Passing those scenarios can support acceptance of the **core HCIS OIDC integration only**. It does not declare all HUB-IMPL-003 acceptance criteria, Wave 1 definition-of-done items, or production cutover gates complete.

The following **deferred pre-production security/persona gates** remain required by the accepted specification and staging runbook. They are recorded here without an invented execution result:

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

These gates keep **Wave 1 completion and production cutover blocked** even if the four core integration scenarios later pass. They have not been removed, waived, or reclassified as production implementation work by this report.

## Remaining live-staging operator runbook

Use only the current synthetic user and the approved staging operator path. Do not use raw SQL, do not print secrets, and do not touch production, Keycloak, HCIS PostgreSQL, edge Caddy, or unrelated services. Do not build images on the VPS.

### 1. Establish the exact staging facts

1. Capture the deployed SQ Hub and HCIS commit SHAs, Keycloak image/version, and `docker compose ps` output for the staging projects.
2. Use the exact active issuer recorded above and record only the public `end_session_endpoint` field. Align the hostname discrepancy through the normal documentation/configuration change process.
3. Confirm the SQ Hub Application Access record for the synthetic identity with `access show`, using the exact active issuer and the existing opaque subject. Do not include the subject in this report.
4. Confirm the exact SQ Hub Compose API service through `docker compose -p sq-hub-staging ... ps`; this is the only service permitted to stop in the outage scenario.

### 2. Session-timing test

1. In Browser A, sign in to HCIS and open a protected page. Keep this browser session open.
2. Through the supported SQ Hub `access-admin` command, revoke only the synthetic user's `hcis` grant. Record the command outcome/audit event without recording credentials or subjects.
3. Reload the same protected page in Browser A. It must continue to work, proving that HCIS does not check SQ Hub on every protected request.
4. Use the documented HCIS backend logout operation to terminate Browser A's local HCIS session.
5. In a fresh private Browser B, establish a new session. After Identity authentication, HCIS must deny access and must not create a new HCIS session.
6. Restore the same grant with the supported SQ Hub CLI. In a fresh Browser C, a new login must work.
7. Leave the synthetic grant restored unless an explicitly approved cleanup requires otherwise.

### 3. SQ Hub outage / fail-closed test

1. Keep one already-authenticated HCIS browser session (Browser A) open and prepare a second fresh browser context (Browser B).
2. After confirming the exact service name, stop only the SQ Hub staging API service with the approved Compose project/service command. Do not stop the database, Keycloak, HCIS, or proxy.
3. Reload a protected page in Browser A. It must remain usable for its normal local-session lifetime.
4. In Browser B, attempt a new HCIS OIDC login. After the callback, HCIS must show a controlled unavailable/denied result, issue no new HCIS session, and never present or silently use a local-password path.
5. Start the same SQ Hub API service again. Wait for its health check to pass, then perform a fresh login in Browser C. It must work with the active grant.
6. Record the stop/start timestamps, health result, HTTP/browser result, and any safe correlation IDs. Do not copy token, cookie, authorization-code, or secret values into the evidence.

### 4. Logout-contract test

1. Create a fresh authenticated HCIS session.
2. Invoke the already-implemented HCIS logout operation and record its HTTP status and final safe redirect destination.
3. Reload a protected HCIS route. The local session must be invalid and HCIS must start authentication rather than serve the protected page.
4. In a fresh browser context, reopen HCIS and complete the redirect flow. Record whether Keycloak prompts for authentication or silently reuses SSO. The required behavior is that the application session **and intended Keycloak SSO session** are terminated; a silent SSO reuse is a failure unless the approved client/logout contract explicitly states otherwise.
5. Confirm that no OIDC access/refresh token appears in `localStorage` or `sessionStorage`; do not record values.

## UAT findings and technical debt

1. HCIS has no profile/logout menu although a backend/frontend logout contract exists. This is a product finding; no UI change is authorized by `HUB-IMPL-003`.
2. Application Access denial currently shares the generic OIDC/access message above. A future approved UX change should distinguish a denied HCIS Application Access grant from a generic OIDC/authentication failure without leaking sensitive details.
3. The synthetic Keycloak user was asked to complete its profile on first login because `firstName` and `lastName` were not provisioned. Provisioning completeness should be defined and checked for staging personas.
4. Account/security management should ultimately be centralized in SQ Account / SQ Hub rather than duplicated in each domain application.
5. Existing HCIS local-account mechanics are migration compatibility concerns; they must not become the default identity/access pattern for future domain applications.
6. The staging issuer hostname in current documentation conflicts with the reachable endpoint supplied for this UAT. This must be resolved as a documented configuration/source-of-truth issue, not by assuming equivalence.

## Acceptance recommendation

**DO NOT ACCEPT the core HCIS OIDC integration UAT yet.**

Its exact blockers are:

1. The existing-session revocation/new-session denial/restoration timing scenario has not been executed and evidenced live.
2. The SQ Hub access-check outage scenario has not been executed and evidenced live, including proof of no local-auth fallback and no new HCIS session.
3. The logout flow has not been verified end to end for both local HCIS-session invalidation and actual Keycloak SSO-session termination.
4. The active staging issuer/hostname must be reconciled with the accepted runbook/configuration before the remaining evidence can be considered authoritative.

The local and CI SQ Hub API tests reduce implementation risk but do not substitute for these authenticated HCIS staging scenarios.

**DO NOT ACCEPT Wave 1 completion or production cutover readiness.** The deferred pre-production security/persona gates above remain outstanding, alongside the separate production-cutover authorization and operational requirements in the accepted source-of-truth.
