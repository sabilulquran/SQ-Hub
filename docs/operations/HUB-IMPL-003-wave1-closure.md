# HUB-IMPL-003 Wave 1 closure map

**Status:** PREPARED — acceptance automation/runbook hardening only  
**Issue:** #9 remains authoritative and OPEN  
**Production cutover:** NOT AUTHORIZED  
**Canonical staging issuer:** `https://login.sabilulquran.or.id/realms/sq-staff-staging`

This document maps every unchecked checkbox currently present in issue #9 to the evidence already available, the part that can be automated, and the part that still requires live staging, browser/human UAT, or production authorization. It must not be used to mark an issue checkbox complete merely because an offline test or this runbook is green.

## Evidence classes

- `AUTOMATED_REPOSITORY`: deterministic code/config behavior that CI can prove without live staging.
- `LIVE_STAGING_AUTOMATABLE`: a staging-only script can execute the check, but an executed result is still required.
- `HUMAN_BROWSER_UAT`: a real browser/user flow is required; code inspection is not a substitute.
- `OPERATOR_SECRET_CONTROL`: requires controlled secret-store/operator verification; secret values must never be printed or committed.
- `PRODUCTION_AUTHORIZATION`: cannot be satisfied by this Wave 1 closure branch.

## Issue #9 unchecked runtime-secret items

| Issue #9 checkbox | Current evidence | Classification | Closure path |
| --- | --- | --- | --- |
| Use a dedicated Keycloak staging DB password. | Repo templates require a runtime DB password but cannot prove uniqueness or non-reuse. | OPERATOR_SECRET_CONTROL | Operator verifies the staging secret record is dedicated; do not paste the value into evidence. Record only `KEYCLOAK_STAGING_DB_SECRET_SEPARATION_PASS`. |
| Establish/verify the named Keycloak administrator and recovery path, then remove bootstrap-only credentials from normal runtime. | Keycloak CI proves bootstrap/recovery configuration mechanics, not the live named administrator/recovery custody. | OPERATOR_SECRET_CONTROL + LIVE_STAGING_AUTOMATABLE | Verify named admin access and recovery procedure on staging; confirm normal runtime no longer depends on bootstrap-only credentials. Record identities by role/handle only. |
| Generate/record the confidential `hcis-staging` client secret in controlled staging secret storage only. | Client exists in source-controlled realm baseline; value is intentionally absent. | OPERATOR_SECRET_CONTROL | Verify secret-store entry and runtime injection without displaying it. |
| Generate/record the `hcis-api-staging` service client secret in controlled staging secret storage only. | Service client contract and machine-token tests exist; value is intentionally absent. | OPERATOR_SECRET_CONTROL | Verify secret-store entry and runtime injection without displaying it. |
| Configure HCIS staging `AUTH_ENCRYPTION_KEY` and OIDC/SQ Hub secrets without committing them. | HCIS env validation requires these inputs and repository has no live values. | OPERATOR_SECRET_CONTROL | Verify runtime secret injection and repository cleanliness. |
| Do not reuse production credentials. | Cannot be proven safely by printing/comparing secret values. | OPERATOR_SECRET_CONTROL | Secret custodian records a boolean separation attestation only. |

## Issue #9 unchecked synthetic-persona items

`tools/wave1/persona-matrix.py` validates the required persona fixture shape and converts runtime-only subjects into short SHA-256 handles. Raw subjects are never emitted.

| Issue #9 checkbox | Current evidence | Classification | Closure path |
| --- | --- | --- | --- |
| ordinary Employee | Not executed/recorded. | HUMAN_BROWSER_UAT | Prepare with persona matrix; provision synthetic identity, explicit HCIS mapping and active HCIS Application Access, then execute browser SSO. |
| manager / local-authorization check | Existing HCIS authorization model is preserved in code, but manager browser continuity is not recorded. | HUMAN_BROWSER_UAT | Execute SSO and verify existing manager role/scope behavior in HCIS. |
| Human Capital administrator | Not executed/recorded. | HUMAN_BROWSER_UAT | Execute SSO and verify authorization remains HCIS-local. |
| privileged / Super Admin MFA persona | Keycloak CI verifies TOTP/recovery prerequisites, not a privileged live login. | HUMAN_BROWSER_UAT | Provision synthetic privileged identity, require TOTP according to policy, and execute the login flow. |
| non-Employee Staff persona | Not executed/recorded. | HUMAN_BROWSER_UAT | Map a synthetic non-Employee identity explicitly and verify expected local principal/access. |
| HCIS-local suspended persona | HCIS automated tests deny a suspended local account before Application Access. Live lifecycle compatibility is not recorded. | AUTOMATED_REPOSITORY + HUMAN_BROWSER_UAT | Execute staging negative UAT and separately show the Keycloak identity remains globally usable/enabled as intended. |
| globally disabled Keycloak persona | Not executed/recorded. | HUMAN_BROWSER_UAT | Disable only the synthetic global identity and prove no new HCIS session can be created. |
| wrong/unknown mapping negative case | HCIS automated tests already cover wrong issuer/same subject, same issuer/wrong subject, and unknown subject with no email/NIP fallback. | AUTOMATED_REPOSITORY + HUMAN_BROWSER_UAT | Preserve regression coverage; execute one deterministic live negative mapping case before final Wave 1 acceptance. |

The already-checked `identity without HCIS Application Access / revoked-access negative case` remains evidence-backed and is not reclassified by this document.

## Issue #9 unchecked browser-UAT items

| Issue #9 checkbox | Current evidence | Classification | Closure path |
| --- | --- | --- | --- |
| Employee SSO succeeds. | Core synthetic happy path exists but was not classified as ordinary Employee. | HUMAN_BROWSER_UAT | Execute the ordinary Employee persona. |
| HCIS manager/local role and scope remain unchanged after SSO. | HCIS keeps authorization on local `accounts.id`; no manager browser evidence. | HUMAN_BROWSER_UAT | Verify representative manager-only HCIS capability after SSO. |
| Human Capital admin authorization remains HCIS-local. | Architecture and HCIS service preserve local authorization; no HC-admin browser evidence. | HUMAN_BROWSER_UAT | Verify representative HC-admin-only capability after SSO. |
| Privileged persona is forced through TOTP. | Keycloak realm/flow CI covers prerequisites only. | HUMAN_BROWSER_UAT | Execute privileged login and record sanitized `PRIVILEGED_TOTP_REQUIRED_PASS`. |
| Recovery Authentication Code path is available and one code is successfully exercised. | Keycloak CI verifies recovery flow configuration but intentionally does not read credential material. | HUMAN_BROWSER_UAT | Exercise one operator-held recovery code; record only `RECOVERY_AUTHENTICATION_EXERCISED_PASS`, never the code. |
| non-Employee Staff behavior matches expected HCIS local principal/access. | Not executed/recorded. | HUMAN_BROWSER_UAT | Execute persona and verify local principal/permissions. |
| HCIS-local suspended account is denied without disabling the global Keycloak identity. | HCIS unit coverage proves local denial. | AUTOMATED_REPOSITORY + HUMAN_BROWSER_UAT | Prove staging denial plus independent global identity availability. |
| globally disabled Keycloak identity cannot obtain a new HCIS session. | Not executed/recorded. | HUMAN_BROWSER_UAT | Execute disabled-global-identity negative flow. |
| unknown/wrong `issuer + sub` fails closed; no email/NIP fallback occurs. | HCIS `auth-oidc-service` regression coverage already proves exact-pair lookup and deny. | AUTOMATED_REPOSITORY + HUMAN_BROWSER_UAT | Keep CI green; run one live synthetic negative mapping case. |
| local password endpoint is unavailable through all alternate public routes while HCIS runs in OIDC mode. | HCIS route test proves canonical local login route returns `LOCAL_AUTH_DISABLED` in OIDC mode. | AUTOMATED_REPOSITORY + LIVE_STAGING_AUTOMATABLE | Run `tools/wave1/staging-preflight.sh` against the explicit public route inventory; add any discovered historical aliases before acceptance. |
| browser `localStorage` / `sessionStorage` contain no OIDC tokens. | Server-side code exchange design exists; no real-browser storage inspection is recorded. | HUMAN_BROWSER_UAT | Inspect both storage areas after login and callback. This must not be replaced by a source grep. |

The already-checked missing/revoked Application Access and logout items retain their existing live evidence. Provider logout metadata is additionally checked by the staging preflight, but metadata alone is not a replacement for the accepted browser logout evidence.

## Issue #9 unchecked rollback-rehearsal items

`tools/wave1/rollback-rehearsal.sh` is a staging-only controller. It refuses the production hostname/project, preserves the schema, suppresses credentialed probe output, restores OIDC on failure where possible, and prints sanitized markers. The actual rehearsal is still `MANUAL_STAGING_REQUIRED` until executed on shared staging.

| Issue #9 checkbox | Current evidence | Classification | Closure path |
| --- | --- | --- | --- |
| Record current staging mappings/access state. | Existing CLI supports inspection but final state snapshot is missing. | LIVE_STAGING_AUTOMATABLE | Capture non-secret state using redacted persona handles plus `tools/wave1/final-snapshot.sh`. |
| Stop HCIS OIDC staging. | Runbook exists; not rehearsed. | LIVE_STAGING_AUTOMATABLE | Guarded rollback script performs a staging-only mode transition. |
| Restore the isolated HCIS staging target to local-auth mode per HCIS recovery note. | Configuration-first rollback is documented. | LIVE_STAGING_AUTOMATABLE | Script applies a temporary Compose override only to the `hcis-staging` project. |
| Verify local authentication + existing HCIS authorization. | No live rehearsal result. | HUMAN_BROWSER_UAT via operator-owned probe | `WAVE1_LOCAL_AUTH_PROBE` must perform a real credentialed staging check outside the repo; script records only PASS/FAIL. |
| Restore OIDC staging without destructive schema rollback. | Recovery contract documented; no execution evidence. | LIVE_STAGING_AUTOMATABLE | Script restores the base OIDC compose and verifies the identity-link columns still exist. |
| Re-run a successful synthetic SSO. | Core SSO was previously accepted, but not after rollback rehearsal. | HUMAN_BROWSER_UAT via operator-owned probe | `WAVE1_OIDC_SSO_PROBE` performs the real synthetic SSO; script records only PASS/FAIL. |

## Issue #9 unchecked evidence / exit items

| Issue #9 checkbox | Current evidence | Classification | Closure path |
| --- | --- | --- | --- |
| Record deployed SQ Hub and HCIS commit SHAs as a final Wave 1 snapshot. | Frozen implementation commits exist, but final deployed-version snapshot is missing. | LIVE_STAGING_AUTOMATABLE | Run `tools/wave1/final-snapshot.sh` on staging. |
| Record Keycloak image/realm version as a final Wave 1 snapshot. | Image is pinned in repository and realm config is source-controlled; final deployed snapshot is missing. | LIVE_STAGING_AUTOMATABLE | Snapshot records running image ref/image ID plus realm-config SHA-256 and exact issuer. |
| Record persona matrix outcomes using synthetic identifiers only. | Matrix outcome report missing. | HUMAN_BROWSER_UAT | Use redacted persona handles; never store raw live subjects. |
| Record MFA/recovery result. | Prerequisite configuration is CI-verified; live result missing. | HUMAN_BROWSER_UAT | Record boolean markers only after execution. |
| Record logout/storage inspection result. | Logout is accepted live; browser storage inspection remains missing. | HUMAN_BROWSER_UAT | Preserve logout evidence and add browser storage result. |
| Record rollback + restore result. | Not executed. | LIVE_STAGING_AUTOMATABLE + HUMAN_BROWSER_UAT | Run guarded rehearsal with both credentialed probes. |

## Additional accepted-spec gates not represented as currently unchecked issue checkboxes

- Keycloak outage behavior still requires live staging verification: no new OIDC login, no silent local-auth fallback, and an already-created HCIS session may continue until normal expiry/local invalidation. Do not infer this from the SQ Hub outage test.
- Keycloak **live staging** backup/restore remains outstanding even though `.github/workflows/keycloak-infra.yml` already exercises backup/disposable-restore mechanics in CI. Run `tools/wave1/keycloak-backup-restore.sh` against staging and retain only sanitized markers.
- Exact staging issuer is continuously checkable without secrets using `tools/wave1/staging-preflight.sh`.

## Closure rule

Wave 1 remains blocked until all required live/browser/operator results have actually been executed and recorded. `tools/wave1/verify_contract.py` and the dedicated Wave 1 CI workflow validate only that the closure machinery is internally consistent; they do **not** convert `MANUAL_STAGING_REQUIRED`, `HUMAN_BROWSER_UAT`, secret-control, or production-authorization items into PASS.
