# HUB-IMPL-003 HCIS production cutover preparation

**Status:** PREPARATION ONLY — `CUTOVER_BLOCKED`  
**Production authorization:** NOT GRANTED by this document  
**Execution owner:** designated production change owner after explicit approval

> **Runtime reconciliation — 2026-09-16:** a direct read-only VPS audit confirms HCIS production healthy with `AUTH_MODE=oidc`, SQ Identity/Keycloak production healthy, and SQ Hub API production healthy. It also confirms that recovery/email login, Google provider, and trusted-device flows are configured. This is evidence that production runtime has moved beyond the last repository cutover-preparation record. It is **not** evidence that every hard gate below was completed, that an approval/window/owner record exists, or that post-cutover acceptance was formally signed off. Until those records are available, this document remains `CUTOVER_BLOCKED`. See [`project-status-2026-09-16.md`](project-status-2026-09-16.md) for the current reconciliation and [`project-status-2026-09-15.md`](project-status-2026-09-15.md) for the prior snapshot.

This runbook prepares the production migration from HCIS-owned password authentication to SQ Identity. It does not itself authorize a production realm, production secret mutation, HCIS auth-mode switch, DNS change, deployment, or legacy-credential deletion. A later runtime observation that such changes are already active must be documented as observed state, not converted into retrospective authorization.

## Hard gate

The default state is:

```text
CUTOVER_BLOCKED
```

The change owner must not schedule or execute production auth cutover until all of the following are true and independently evidenced. If production has already been changed, use the same list to reconstruct the missing change/acceptance record without inventing retrospective approval:

- issue #9 Wave 1 acceptance gates are complete based on actual live staging/browser/operator evidence, not code tests alone;
- final Wave 1 snapshot records deployed SQ Hub SHA, authoritative HCIS SHA, Keycloak image identity, realm/config identity, and exact staging issuer;
- synthetic persona matrix is complete, including ordinary Employee, manager/local authorization, Human Capital administrator, privileged MFA/recovery, non-Employee, HCIS-local suspended, globally disabled identity, revoked Application Access, and wrong/unknown mapping;
- browser storage inspection confirms no OIDC access, refresh, or ID token is persisted in localStorage/sessionStorage;
- public alternate-route inspection confirms local-password login is unavailable in OIDC mode;
- Keycloak outage behavior is executed on staging: no new OIDC login, no silent local fallback, and an already-created HCIS session follows the accepted local-session contract;
- staging rollback rehearsal succeeds without destructive schema rollback and a fresh synthetic SSO succeeds after restoration;
- staging Keycloak backup and disposable restore verification succeeds;
- runtime secret separation is attested by the responsible custodian without exposing secret values;
- an explicit production change authorization, maintenance window, named incident/rollback decision-maker, and communications owner exist.

If any gate is unknown, stale, failed, or merely inferred, keep `CUTOVER_BLOCKED`.

## Immutable production inputs

Before approval, record immutable/non-secret deployment inputs in the production change record:

- approved SQ Hub source commit SHA and organization-owned image digest/ref;
- approved authoritative HCIS source commit SHA and image digest/ref;
- approved Keycloak production image digest/ref; never use `latest`;
- production realm key and issuer, created only by the authorized production change;
- HCIS OIDC redirect/post-logout origins;
- Application Access application key `hcis` and production canonical URL;
- database backup identifiers/checksums and backup timestamps;
- migration-preview artifact identifier/checksum;
- approval/change-ticket identifiers.

Secrets are referenced by secret-store names/versions only. Do not copy client secrets, passwords, TOTP material, recovery codes, signing keys, session values, raw OIDC tokens, or raw identity subjects into the change record.

## Preflight immediately before the window

The production change owner verifies:

1. approved image/source pins still match the reviewed artifacts;
2. HCIS and SQ Hub database backups have completed and restoration procedures are available;
3. Keycloak production backup/config export strategy is ready for the exact production topology;
4. migration preview has zero unresolved identity ambiguity or eligibility blockers;
5. all target HCIS accounts have explicit `issuer + sub` bindings or are intentionally excluded;
6. Application Access grants are prepared only for eligible identities;
7. monitoring is ready for Keycloak health, callback/token errors, unmapped identities, Application Access denial, MFA failure, and HCIS authorization regression;
8. rollback owner can restore the previous HCIS local-auth configuration if the approved rollback criteria are reached;
9. direct public local login will remain disabled after the OIDC switch; there is no public dual-auth grace period.

A failed preflight returns the change to `CUTOVER_BLOCKED`.

## Authorized cutover sequence

Only after the explicit approval gate:

1. freeze the final approved source/image pins and record the start time;
2. create/verify production backups;
3. verify Keycloak health and approved pinned version;
4. run the final read-only HCIS migration preview; stop on any unresolved blocker;
5. provision approved production SQ identities using the controlled path without importing HCIS password/MFA/recovery/session material;
6. persist exact production `issuer + sub` mapping to the existing HCIS `accounts.id` principals;
7. grant HCIS Application Access only to eligible identities;
8. complete representative activation/MFA checks;
9. switch HCIS production from local authentication to OIDC in the controlled configuration change;
10. verify direct/public local-password authentication is unavailable through the complete route inventory;
11. execute post-cutover acceptance below;
12. declare the cutover accepted only after the authorized owner reviews evidence.

No automatic fallback to local authentication is permitted if SQ Identity or SQ Hub access checking fails during a new login.

## Post-cutover acceptance

At minimum verify using approved representative identities:

- ordinary Employee can authenticate and reaches the same local HCIS principal;
- manager and Human Capital administrator retain expected HCIS-local roles/scopes;
- privileged account satisfies production MFA policy;
- non-Employee Staff behavior matches the intended local HCIS principal;
- HCIS-local suspended account is denied without changing global identity state as a side effect;
- globally disabled identity cannot create a new HCIS session;
- revoked/missing HCIS Application Access denies new session creation;
- wrong/unknown mapping fails closed with no email/NIP fallback;
- existing HCIS authorization checks remain server-side and unchanged in ownership;
- localStorage/sessionStorage contain no OIDC access/refresh/ID token;
- logout ends the HCIS application session and initiates the intended SQ Identity logout;
- cookie attributes/scope satisfy the production contract;
- monitoring shows no unexpected authorization or mapping regression.

Any security-relevant mismatch keeps acceptance open and triggers the incident/rollback decision path.

## Rollback contract

Rollback is a deliberate human-approved incident action, never automatic fallback.

Rollback may be approved for a broad migration/configuration defect, persistent Keycloak instability, incorrect identity resolution/authorization, or another security defect that makes continuation unsafe. Isolated password resets or normal user-support cases are not sufficient by themselves.

During rollback:

- restore the explicitly approved HCIS local-auth configuration/application version;
- keep the identity-link schema in place unless a separate destructive migration is explicitly approved;
- do not rewrite `accounts.id` or local authorization relationships;
- keep public exposure controlled so two login methods are not offered in parallel;
- record the incident, decision owner, start/end times, versions, and sanitized outcome.

## Maximum legacy-credential retention window

Legacy HCIS password/MFA/recovery material may remain solely for emergency rollback for a maximum of **14 days** after the accepted production cutover. The exact deletion deadline must be recorded when cutover is accepted; it cannot be extended by this runbook.

During that window:

- direct local login remains externally disabled;
- old HCIS password/MFA/recovery paths receive no new credential changes;
- access to retained material stays restricted to the minimum operational need;
- daily operational review confirms whether the rollback window can be closed early.

## Irreversible cleanup schedule

After production acceptance and no later than the 14-day deadline, execute a separate reviewed cleanup change to:

- remove/clear obsolete HCIS password hashes and password-change semantics that are no longer required;
- remove obsolete HCIS MFA secret material and recovery-code records when no longer domain-relevant;
- retire local password/TOTP/recovery endpoints and code paths;
- remove obsolete auth encryption-key dependency only after confirming no remaining encrypted data needs it;
- preserve local principal IDs, OIDC identity binding, HCIS roles/permissions/scopes, required app sessions, and policy-compliant audit history;
- verify local auth cannot reappear after cleanup through an alternate route;
- update HCIS source-of-truth documentation in the same reviewed cleanup change.

Cleanup is not performed by this documentation branch.

## Evidence retention

Retain only non-secret acceptance evidence: source/image pins, timestamps, health/result markers, persona handles, audit/event references, and approval identifiers. Never retain credential values or raw live OIDC subjects in the repository.

---

## Production identity UAT closure packet — 2026-09-16

**Repository source snapshot:** `e73a79b85f44b844a544fddd0705586be517fa2d`  
**Specs covered:** `HUB-IMPL-003`, `HUB-IMPL-011`, `HUB-IMPL-012`  
**Authoritative HUB-IMPL-003 acceptance issue:** [#9](https://github.com/sabilulquran/SQ-Hub/issues/9)  
**Runtime mutation by this packet:** none  
**Overall state:** `CUTOVER_BLOCKED`

This packet is an execution plan and evidence ledger for closing production login UAT after production was observed running HCIS through SQ Identity/OIDC. It does not reinterpret an observed healthy deployment as acceptance. It also does not require an accepted live UAT scenario to be repeated solely because the environment label changed. Evidence reuse follows the explicit rules below so accepted staging results, production smoke checks, new-feature UAT, and production-only operational rehearsals remain distinguishable.

### Result and classification vocabulary

Use only these result values in the execution record:

- `PASS`: the scenario was actually executed at the required layer and met the expected result;
- `FAIL`: the scenario was actually executed and did not meet the expected result;
- `NOT_RUN`: no qualifying execution evidence exists yet;
- `BLOCKED`: a concrete dependency or approval prevents execution.

Classification may contain more than one of:

- `GITHUB_EVIDENCED`: source, test, workflow, accepted specification, or a previously executed result recorded in GitHub establishes a prerequisite/contract;
- `ACCEPTED_STAGING_EVIDENCE`: an accepted live staging execution already exercised the same environment-independent behavior and the acceptance owner has accepted it for closure without a duplicate production mutation;
- `PRODUCTION_DELTA_REQUIRED`: a material production-only difference still requires a production observation;
- `USER_BROWSER_REQUIRED`: the production user-facing result must be exercised in a browser by the product owner or approved tester;
- `CODEX_VPS_REQUIRED`: the check requires local/VPS/runtime inspection or a controlled runtime action by Codex;
- `OWNER_DECISION_REQUIRED`: explicit product/change-owner approval or acceptance is required.

Repository source/configuration evidence alone never upgrades a browser/VPS scenario to `PASS`. Accepted live staging evidence may satisfy an environment-independent row when the recorded procedure actually covered that exact behavior and the acceptance owner explicitly accepts reuse. A staging result must not be relabeled as a production execution; the evidence column/classification must retain its staging scope. Production-only DNS, sender, secret, cookie, runtime image, or operational behavior still requires production evidence.

### Evidence reuse and no-repeat rule — 2026-09-17

The acceptance owner confirmed that the core HCIS OIDC staging UAT accepted on 2026-08-28 remains valid. The 58-row production packet must not reset those accepted results to zero or trigger production mutations merely to reproduce them.

Apply the following routing before scheduling any scenario:

1. Reuse accepted live staging evidence when the same implementation contract and behavior were actually exercised and no material production-only input changes the result.
2. Run a production delta only for production-specific state, a newly added feature, a known defect, or a behavior not covered by the accepted execution.
3. Never reuse one happy-path result for a different persona, MFA, Google, trusted-device, storage, lifecycle, or failure-mode gate.
4. Do not repeat an accepted destructive or outage rehearsal in production. Repeat it only in an isolated target when a material implementation change invalidates the prior evidence.
5. Record the source environment on every reused result. `PASS` means the gate is satisfied for closure; it does not claim that the reused execution occurred in production.

Under this rule, the accepted staging Application Access revoke/restore, SQ Hub access-check outage, logout/reauthentication, existing-session timing, and no-local-fallback evidence are retained as qualifying core evidence. The production NIP/email and HCIS-local suspension checks executed on 2026-09-16/17 are retained as production deltas. Recovery/Google/trusted-device behavior remains separate feature UAT because those features were added after the accepted core staging run or were not covered by it.

### GitHub evidence already available

- The accepted Foundation product/domain boundary keeps Staff global identity in SQ Identity, Application Access in SQ Hub, and HCIS domain roles/permissions in HCIS.
- `HUB-IMPL-003` requires exact `issuer + sub` mapping, preservation of local `accounts.id`, no email/NIP callback join, fail-closed behavior, server-side OIDC exchange, application-scoped sessions, and no browser OIDC-token storage.
- `HUB-IMPL-011` requires native password recovery, unique verified email alternate login, Google link-only-existing behavior with local-password proof, conditional TOTP, no upstream-token storage, and no privilege mapper.
- `HUB-IMPL-012` requires trusted-device proof only after valid checked TOTP, maximum 30-day lifetime, same-user/same-realm binding, expiry/tamper/replay/credential-reset failure, disabled-user denial, realm-scoped `HttpOnly`/`Secure`/`SameSite=Lax` cookie, and Google post-broker participation.
- Keycloak CI verifies the recovery/Google reconciliation contract, recovery-code prerequisites, trusted-device provider discovery/flow reconciliation, and backup/disposable-restore mechanics. Trusted-device unit tests cover unchecked/wrong OTP issue rules, rotation/replay, other user/realm/browser, expiry/tamper/credential change, and minimum signing-key strength.
- The Wave 1 workflow explicitly asserts that its CI is contract-only and that manual/browser gates remain manual.
- Issue #9 and `HUB-IMPL-003-staging-uat-evidence.md` record accepted live staging evidence for Application Access revoke/restore, SQ Hub API outage/fail-closed recovery, no local-auth fallback, existing-session timing, and logout/reauthentication. Rows below explicitly identify when that evidence is reused; no row may silently change scope.

### Execution matrix — 58 scenarios

| ID | Scenario | Preconditions / persona | Langkah ringkas | Expected result | Evidence aman | Status | Classification | Execution owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1.1 | Login dengan NIP/employee number | Synthetic ordinary Employee; NIP known to tester; HCIS access active | Open HCIS production in fresh browser; sign in with NIP | Authentication succeeds and HCIS opens | `UAT-HCIS-001`; operator-reported successful production login, 2026-09-16/17; no credential retained | PASS | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED + PRODUCTION_DELTA_REQUIRED | Product owner/tester |
| 1.2 | Login dengan verified unique email | Same synthetic Employee; verified unique email | Repeat fresh login using email instead of NIP | Same identity authenticates successfully | `UAT-HCIS-001`; operator-reported successful alternate-email production login, 2026-09-16/17 | PASS | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED + PRODUCTION_DELTA_REQUIRED | Product owner/tester |
| 1.3 | NIP/email resolve to same HCIS `accounts.id` | Persona has pre-recorded synthetic expected local-principal handle | Compare sanitized local-principal result for 1.1 and 1.2 | Both logins resolve to the same existing HCIS principal | Production login pair plus stable HCIS account handle `61e09f4fbaca`; exact mapping present; no raw `sub` | PASS | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED + CODEX_VPS_REQUIRED + PRODUCTION_DELTA_REQUIRED | Product owner + Codex |
| 1.4 | non-Employee Staff mapping | Synthetic Staff without NIP; verified unique email; explicit mapping/access | Login with approved email and open HCIS | Intended existing local Staff principal is used | Synthetic handle + expected local-principal marker | NOT_RUN | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED | Product owner/tester |
| 1.5 | Technical mapping remains exact `issuer + sub` | Synthetic unmapped/wrong-mapping case available | Attempt login for identity that must not match by email/NIP | Access denied; no silent email/NIP technical remap | `UNKNOWN_MAPPING_DENIED=PASS`; no raw `sub` | NOT_RUN | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED | Product owner/tester |
| 2.1 | Ordinary Employee authorization continuity | Ordinary Employee with known normal HCIS capability | Login and open representative Employee-only page/action | Expected access works; no extra privilege | `UAT-HCIS-001` opened the Employee attendance workspace successfully; direct navigation to the Human Capital leave-administration route returned no queue and the explicit denial that the account has no active Human Capital assignment | PASS | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED + CODEX_VPS_REQUIRED + PRODUCTION_DELTA_REQUIRED | Product owner/tester |
| 2.2 | Manager role/scope continuity | Synthetic manager with known local role/scope | Login; exercise one manager-only and one prohibited capability | Existing HCIS manager scope is unchanged | Capability names + boolean results | NOT_RUN | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED | Product owner/tester |
| 2.3 | Human Capital administrator continuity | Synthetic HC admin with accepted local permissions | Login; exercise representative HC admin capability | Expected HCIS-local permission remains available | Capability name + boolean result | NOT_RUN | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED | Product owner/tester |
| 2.4 | Privileged/Super Admin local authorization | Synthetic privileged HCIS principal; MFA ready | Complete MFA; exercise representative privileged HCIS capability | Local privileged authorization is preserved | Synthetic handle + capability marker; no OTP | NOT_RUN | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED | Product owner/tester |
| 2.5 | Domain roles remain HCIS-owned, not Keycloak-owned | Review accepted product/domain/ADR/spec and broker config | Verify no acceptance step relies on Keycloak realm/client role to grant HCIS business permission | Ownership remains HCIS; Application Access remains entry gate only | Links to accepted docs + reconciliation markers | PASS | GITHUB_EVIDENCED | GitHub reviewer |
| 3.1 | Privileged user is required to complete TOTP | Synthetic privileged identity with TOTP enrolled | Fresh login; stop before OTP, then complete OTP | No HCIS session before TOTP; session after valid TOTP | `PRIVILEGED_TOTP_REQUIRED=PASS`; no OTP/seed | NOT_RUN | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED | Product owner/tester |
| 3.2 | Recovery Authentication Code is one-time | Same synthetic privileged identity; operator-held code | Use one recovery code; then attempt same code again in a fresh auth attempt | First accepted; reuse denied | Availability/exercised/reuse-denied booleans only | NOT_RUN | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED | Product owner/tester |
| 3.3 | Forgot Password sends through production sender | Synthetic account with controlled mailbox | Use `Lupa password?`; inspect received mail | Mail arrives from approved production sender/route | Fresh controlled request at 2026-09-17 11:33 WIB correlated the Akun SQ success screen, cPanel Track Delivery `Accepted`, and a new unread message in Gmail Inbox | PASS | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED + CODEX_VPS_REQUIRED + PRODUCTION_DELTA_REQUIRED | Product owner/tester |
| 3.4 | Password-reset link is single-use | Synthetic account; reset email received | Complete reset once, then reuse same link | First reset succeeds; second use rejected | Synthetic tester completed one reset; immediate reuse displayed `Tindakan kedaluwarsa. Silakan lanjutkan dengan log masuk sekarang.`; no password, URL, or token retained | PASS | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED + PRODUCTION_DELTA_REQUIRED | Product owner/tester |
| 3.5 | Expired reset link is rejected | Synthetic account; owner-approved way to obtain an expired test link | Open expired action link | Reset is rejected without session creation | Production browser displayed expired-login/reset state and created no session; no URL/token retained | PASS | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED + PRODUCTION_DELTA_REQUIRED | Product owner/tester |
| 3.6 | Disabled user cannot recover into a new session | Synthetic globally disabled identity; controlled mailbox | Attempt recovery/reset and then protected-page access | No new authenticated HCIS session is created | Disabled persona handle + denial marker | NOT_RUN | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED + OWNER_DECISION_REQUIRED | Product owner/change owner |
| 4.1 | Unknown Google account is rejected; no user created | Approved synthetic Google account with no existing Akun SQ match | Choose Google login and authenticate upstream | Link/login is rejected; no new Akun SQ user appears | Synthetic Google handle + `NO_AUTO_CREATE=PASS` | NOT_RUN | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED | Product owner/tester |
| 4.2 | First Google link requires confirmation and local-password proof | Existing synthetic Akun SQ user and matching Google email, not yet linked | Start first Google login and follow linking flow | Explicit confirmation and local password proof are required before link | Boolean step markers; no password | NOT_RUN | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED | Product owner/tester |
| 4.3 | TOTP user still receives challenge during Google linking/login | Existing synthetic TOTP user | Start Google login after link precondition | TOTP challenge appears where policy requires it | `GOOGLE_TOTP_CHALLENGE=PASS`; no OTP | NOT_RUN | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED | Product owner/tester |
| 4.4 | Subsequent Google login returns to same Keycloak/HCIS principal | Synthetic linked user with prior baseline local principal | Fresh browser Google login; compare sanitized principal result | Same Keycloak identity mapping and same HCIS local principal are reached | Synthetic account handle + local-principal marker | NOT_RUN | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED | Product owner/tester |
| 4.5 | Google login adds no privilege/access/domain role | Same linked synthetic user; baseline role/access snapshot available | Compare authorized capabilities before/after link/login | No new realm/client role, Application Access, Platform Administrator, or HCIS role is granted | Boolean unchanged markers; no raw role dump containing PII | NOT_RUN | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED | Product owner/tester |
| 5.1 | Login without trusted-device checkbox | Synthetic TOTP user; fresh browser/profile | Login with valid TOTP leaving checkbox off; log out; fresh login | No trusted-device bypass is created | `UAT-HCIS-001` completed password + valid TOTP with trust unchecked; Account Console opened and server-side `sq.internal.trusted-device.v1` record count remained zero | PASS | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED + CODEX_VPS_REQUIRED + PRODUCTION_DELTA_REQUIRED | Product owner/tester |
| 5.2 | Wrong OTP is rejected | Synthetic TOTP user | Enter an intentionally wrong OTP | Authentication fails; trusted state is not created | `UAT-HCIS-001`: invalid OTP displayed `Kode autentikator tidak valid`; trust remained unchecked and server-side trusted-device record count remained zero; no OTP retained | PASS | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED + CODEX_VPS_REQUIRED + PRODUCTION_DELTA_REQUIRED | Product owner/tester |
| 5.3 | Checked + valid OTP creates trusted state | Synthetic TOTP user; fresh browser | Check trust option and submit valid OTP | Login succeeds and trusted-device cookie/state is created | `UAT-HCIS-001`: checked + valid OTP opened Account Console and server-side trusted-device record count changed from zero to one; no cookie value or OTP retained | PASS | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED + CODEX_VPS_REQUIRED + PRODUCTION_DELTA_REQUIRED | Product owner/tester |
| 5.4 | Same browser follows trusted-device policy | Persona from 5.3; same profile | Log out/end app session as agreed; start new login within trust lifetime | TOTP is skipped only as specified; first factor/session rules still apply | Same in-app browser required username/password, then opened Account Console without an OTP page; one active trusted-device record remained | PASS | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED + CODEX_VPS_REQUIRED + PRODUCTION_DELTA_REQUIRED | Product owner/tester |
| 5.5 | Different browser/profile still requires TOTP | Same user; second clean browser profile | Start login in second profile | TOTP is required | `UAT-HCIS-001` authenticated in a separate Edge Profile 2 only after the tester completed its TOTP challenge with trust unchecked; Account Console opened and the server-side trusted-device record count remained one, belonging to the previously trusted browser | PASS | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED + CODEX_VPS_REQUIRED + PRODUCTION_DELTA_REQUIRED | Product owner/tester |
| 5.6 | Expired trusted state is rejected | Synthetic user with owner-approved expired proof/test timing | Attempt login with expired trust state | TOTP is required; expired proof not accepted | Expiry/denial boolean only | NOT_RUN | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED | Product owner/tester |
| 5.7 | Tampered trusted cookie is rejected | Synthetic user; test browser; cookie value must not be recorded | Alter the test cookie locally, then authenticate | Tampered proof is rejected and TOTP is required | `TRUST_TAMPER_DENIED=PASS`; no cookie value/screenshot | NOT_RUN | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED | Product owner/tester |
| 5.8 | Password reset invalidates prior trusted state | Synthetic TOTP user with trusted state | Reset password through supported flow, then retry same browser | Prior trusted state no longer skips TOTP | `PASSWORD_RESET_INVALIDATES_TRUST=PASS` | NOT_RUN | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED | Product owner/tester |
| 5.9 | TOTP credential replacement invalidates prior trusted state | Synthetic TOTP user with trusted state | Replace TOTP credential through approved flow; retry same browser | Prior trusted state is invalidated | `TOTP_REPLACE_INVALIDATES_TRUST=PASS` | NOT_RUN | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED | Product owner/tester |
| 5.10 | Disabled user remains denied despite trusted state | Synthetic trusted user that is then disabled under approved test plan | Attempt new login from previously trusted browser | User is denied; trust cookie cannot bypass disablement | Disabled synthetic handle + denial marker | NOT_RUN | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED + OWNER_DECISION_REQUIRED | Product owner/change owner |
| 5.11 | Ordinary vs privileged MFA policy remains correct | One ordinary and one privileged synthetic persona | Compare login challenges/enforcement | Ordinary policy remains optional unless enrolled/risk policy says otherwise; privileged remains mandatory | Persona class + boolean policy result | NOT_RUN | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED | Product owner/tester |
| 5.12 | Google path follows same trusted-device/MFA policy | Synthetic Google-linked TOTP user | Execute Google login with/without valid trusted proof | Google is only first factor; trusted-device/TOTP rules match browser flow | `GOOGLE_TRUSTED_DEVICE_POLICY=PASS` | NOT_RUN | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED | Product owner/tester |
| 6.1 | HCIS-local suspended account is denied without global disable | Synthetic HCIS-local suspended persona; global identity intentionally enabled | Attempt HCIS login; separately verify global identity remains enabled/usable as approved | HCIS denied; global identity not disabled as side effect | `UAT-HCIS-001`; HCIS displayed inactive-account denial; Keycloak remained enabled; audited restore returned HCIS to active and fresh login succeeded | PASS | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED + CODEX_VPS_REQUIRED + PRODUCTION_DELTA_REQUIRED | Product owner + Codex/change owner |
| 6.2 | Globally disabled Keycloak identity gets no new session | Synthetic identity approved for disable test | Disable/confirm disabled state under change plan; attempt HCIS login | No new HCIS session | Synthetic handle + disabled boolean + denial marker | NOT_RUN | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED + CODEX_VPS_REQUIRED + OWNER_DECISION_REQUIRED | Product owner + Codex/change owner |
| 6.3 | Identity without HCIS Application Access is denied | Synthetic mapped identity with no HCIS grant | Attempt fresh HCIS login | No HCIS session is created | Synthetic handle + `NO_APP_ACCESS_DENIED=PASS` | NOT_RUN | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED | Product owner/tester |
| 6.4 | Revoked Application Access is denied on next login | Synthetic user initially granted HCIS access | Establish baseline; revoke via approved operator path; attempt fresh login; restore only if approved | Existing-session timing follows contract; new login denied | Accepted live staging procedure on 2026-08-28: active session continued, fresh login denied after revoke, restore allowed fresh login | PASS | GITHUB_EVIDENCED + ACCEPTED_STAGING_EVIDENCE | Product owner + Codex/change owner |
| 6.5 | Unknown/wrong `issuer + sub` is denied | Synthetic unmapped identity; wrong-pair cases remain covered by regression tests | Perform one live unknown-mapping login; retain wrong-pair automated evidence | Live unknown mapping denied; no fallback; wrong-pair regression remains green | Live denial marker + test/workflow link; no raw `sub` | NOT_RUN | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED | Product owner/tester |
| 6.6 | No silent fallback to local password, email, or NIP mapping | OIDC mode; synthetic unmapped/denied case | After identity/access failure, inspect user-visible route behavior and retry direct local-login URL inventory | No local-auth screen/session or heuristic remap becomes available | Accepted staging revoke/outage denial showed no fallback; production route inventory independently confirms local auth disabled | PASS | GITHUB_EVIDENCED + ACCEPTED_STAGING_EVIDENCE + CODEX_VPS_REQUIRED | Product owner + Codex |
| 7.1 | `localStorage` contains no access/refresh/ID token | Any successful synthetic login | Open browser devtools after callback; inspect keys/values locally without copying secrets | No OIDC access/refresh/ID token persisted | Key names or `NO_OIDC_TOKEN_IN_LOCALSTORAGE=PASS`; no values | NOT_RUN | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED | Product owner/tester |
| 7.2 | `sessionStorage` contains no access/refresh/ID token | Same session as 7.1 | Inspect sessionStorage | No OIDC access/refresh/ID token persisted | Key names or pass marker; no values | NOT_RUN | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED | Product owner/tester |
| 7.3 | Session/trusted-device cookie attributes are correct | Successful HCIS session; trusted-device test session | Inspect browser cookie metadata only | Session/trust cookies have expected `Secure`, `HttpOnly`, `SameSite`, path/domain/expiry behavior | Cookie name + attributes; never cookie value | NOT_RUN | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED | Product owner/tester |
| 7.4 | No wildcard/shared auth cookie across all subdomains | Same cookie inspection | Check Domain/Path scopes for HCIS and trusted-device cookies | No broad `*.sabilulquran.or.id` shared auth cookie; trusted-device remains realm-scoped | Cookie name + Domain/Path only | NOT_RUN | GITHUB_EVIDENCED + USER_BROWSER_REQUIRED | Product owner/tester |
| 8.1 | Logout ends HCIS application session | Successful synthetic HCIS login | Click HCIS logout; immediately revisit protected HCIS URL | Previous application session no longer grants access | Accepted live staging logout procedure, 2026-08-28 | PASS | GITHUB_EVIDENCED + ACCEPTED_STAGING_EVIDENCE | Product owner/tester |
| 8.2 | Logout initiates agreed SQ Identity logout | Same logout flow | Observe redirect/Keycloak logout UI/flow | Agreed IdP logout flow starts | Accepted staging observation: HCIS redirected to Keycloak RP-initiated logout flow | PASS | GITHUB_EVIDENCED + ACCEPTED_STAGING_EVIDENCE | Product owner/tester |
| 8.3 | Protected page requires appropriate authentication after logout | Completed 8.1/8.2 | Navigate directly to protected HCIS URL | User must authenticate according to remaining global-session semantics | Accepted staging observation: after logout confirmation, reopening HCIS required authentication | PASS | GITHUB_EVIDENCED + ACCEPTED_STAGING_EVIDENCE | Product owner/tester |
| 8.4 | Existing-session behavior is recorded without identifiers | One active session; accepted session policy known | Observe expected continuation/expiry conditions during normal use | Behavior matches contract; no session ID/cookie recorded | Accepted staging revoke/outage execution recorded existing-session continuation without retained identifiers | PASS | GITHUB_EVIDENCED + ACCEPTED_STAGING_EVIDENCE | Product owner/tester |
| 9.1 | Keycloak unavailable => new login fails closed | Safe rehearsal environment/window and owner approval | Codex stops/isolates only approved Keycloak target; tester attempts new login; restore | No new login/session is created | Start/end time, service state, HTTP/result marker; no logs with tokens | BLOCKED | GITHUB_EVIDENCED + CODEX_VPS_REQUIRED + OWNER_DECISION_REQUIRED + USER_BROWSER_REQUIRED | Change owner + Codex + tester |
| 9.2 | Keycloak outage has no fallback to local login | Same controlled outage as 9.1 | During outage, inspect HCIS login/direct-local route behavior | No local-password fallback appears | Sanitized route/status markers | BLOCKED | GITHUB_EVIDENCED + CODEX_VPS_REQUIRED + OWNER_DECISION_REQUIRED + USER_BROWSER_REQUIRED | Change owner + Codex + tester |
| 9.3 | Existing HCIS session follows accepted expiry/invalidation during Keycloak outage | Pre-existing synthetic HCIS session; same controlled outage | Keep existing session active while IdP is isolated; observe accepted behavior; restore | Existing session follows local contract, not arbitrary immediate/fallback behavior | Time/result marker; no session ID/cookie | BLOCKED | GITHUB_EVIDENCED + CODEX_VPS_REQUIRED + OWNER_DECISION_REQUIRED + USER_BROWSER_REQUIRED | Change owner + Codex + tester |
| 9.4 | Application Access check failure does not open access | Safe rehearsal environment/window; accepted staging execution available | Isolate/fail access-check path for a fresh login; restore | New session is denied; no bypass | Accepted live staging execution, 2026-08-28: SQ Hub API stopped, fresh login failed closed, existing session remained usable, recovery restored fresh login | PASS | GITHUB_EVIDENCED + ACCEPTED_STAGING_EVIDENCE | Change owner + Codex + tester |
| 9.5 | Alternate public local-login routes remain unavailable in OIDC mode | Current production route inventory | Codex read-only enumerates known/historical public auth routes and probes without credentials | Every local-password entry route is unavailable/disabled in OIDC mode | See C5 evidence below: canonical POST returns `404 LOCAL_AUTH_DISABLED`; unprefixed backend path returns 405; production mode reports `oidc` | PASS | GITHUB_EVIDENCED + CODEX_VPS_REQUIRED | Codex |
| 10.1 | Record source SHA, image/digest, issuer, execution time | Running HCIS, Keycloak, SQ Hub API production | Record GitHub source SHA; Codex read-only records immutable runtime refs and issuer; tester records execution time | Complete non-secret provenance set exists | See C1 evidence below: source/image refs, immutable digests, issuer, timestamp | PASS | GITHUB_EVIDENCED + CODEX_VPS_REQUIRED | Codex + GitHub reviewer |
| 10.2 | Complete persona matrix using synthetic/redacted handles | Owner-approved test identities for all required persona classes | Assign stable redacted handle, expected principal/access, and scenario coverage | Every required persona has an owner and expected outcome | Redacted handle table; no raw `sub`/PII | NOT_RUN | USER_BROWSER_REQUIRED + OWNER_DECISION_REQUIRED | Product owner |
| 10.3 | Record each scenario as PASS/FAIL/BLOCKED/NOT_RUN | This matrix exists | Update only after evidence is produced; do not infer PASS | Every scenario has one explicit result | This matrix + evidence reference | PASS | GITHUB_EVIDENCED | GitHub reviewer |
| 10.4 | Name acceptance owner and executor for every check | Owner authorization recorded below | Owner assigns acceptance owner and approved tester/Codex operator identities by role/name | Accountability is explicit before final acceptance | Product Owner SQ Hub/HCIS — Human Capital YSQ; Codex/engineering executor; product owner/tester browser operator | PASS | GITHUB_EVIDENCED | Product/change owner |
| 10.5 | Map results to issue #9 and accepted specs | Matrix + mapping section below | For each completed scenario, add evidence reference to issue/PR and relevant spec gate | No orphan evidence or double-counted gate | GitHub links/anchors only | PASS | GITHUB_EVIDENCED | GitHub reviewer |
| 10.6 | Keep issue #9 open until all required gates have evidence | Issue #9 currently open | Do not close while any required row is NOT_RUN/BLOCKED/FAIL or owner acceptance missing | Issue remains open until real closure | Issue state + final acceptance comment | PASS | GITHUB_EVIDENCED + OWNER_DECISION_REQUIRED | Product owner/GitHub maintainer |

### Mapping back to issue #9 and accepted specs

| Matrix group | Primary source-of-truth / issue gate |
| --- | --- |
| 1. Login and identity mapping | `HUB-IMPL-003` OIDC flow, provisioning/mapping, acceptance; issue #9 synthetic personas + Browser UAT |
| 2. HCIS authorization continuity | Foundation PRD HUB-FND-005/HUB-FND-010, domain ownership, ADR-0005, `HUB-IMPL-003` authorization invariants; issue #9 manager/HC admin/browser UAT |
| 3. MFA and password recovery | Staff authentication policy, `HUB-IMPL-003` privileged/recovery UAT, `HUB-IMPL-011` password recovery; issue #9 privileged/MFA/recovery gates |
| 4. Google account linking | `HUB-IMPL-011` Google sign-in acceptance and production handoff |
| 5. Trusted device | `HUB-IMPL-012` behavior/security/acceptance and production handoff |
| 6. Negative access/fail-closed identity | `HUB-IMPL-003` lifecycle/failure/tests; issue #9 suspended/disabled/access/mapping gates |
| 7. Browser storage/cookie security | Staff authentication policy, security baseline, `HUB-IMPL-003` browser/session rules, `HUB-IMPL-012` cookie contract; issue #9 storage gate |
| 8. Logout/session behavior | Staff authentication policy + `HUB-IMPL-003` logout; issue #9 logout/storage evidence |
| 9. Failure behavior | `HUB-IMPL-003` failure behavior + Wave 1 closure additional gates; issue #9 outage/session evidence where already executed on staging |
| 10. Evidence/acceptance closure | Issue #9 evidence/exit criteria + this production-cutover hard gate |

An accepted staging result may satisfy the same environment-independent gate under the no-repeat rule, but it must remain labeled as staging evidence and must not be described as a production browser execution. Likewise, one browser happy-path login must not be reused as proof of manager, HC admin, privileged MFA, storage, Google, trusted-device, or outage behavior unless the recorded execution actually covered that distinct gate.

### Codex read-only evidence — 2026-09-16

The following observations were executed directly against production at `2026-09-16T05:08:07Z` (`12:08:07 WIB`). No container, database, realm, secret, DNS record, reverse-proxy rule, access grant, or user state was changed.

#### C1 — runtime provenance (`10.1`)

| Runtime | Source/image reference | Immutable image digest | Observed state |
| --- | --- | --- | --- |
| HCIS web | `ghcr.io/sabilulquran/hcisysq-web:sha-9e9098c5bd8579ae9ec36dc1f698c03a064c66ab` | `sha256:8a12529a74f8ed2970226cf188ac11abe00f12cda82efa3a52b22d265582cea5` | healthy; OCI revision matches source SHA |
| HCIS API | `ghcr.io/sabilulquran/hcisysq-api:sha-9e9098c5bd8579ae9ec36dc1f698c03a064c66ab` | `sha256:867185fe85b44068d443e59105edd9238bbdd5036d684be2391c0683c337beb4` | healthy; `AUTH_MODE=oidc`; OCI revision matches source SHA |
| SQ Identity / Keycloak | `ghcr.io/sabilulquran/sq-hub-keycloak:sha-347bc06cfe3af96b12106e7737fe7aa7cd799e4b` | `sha256:38405c96e88ba2f9779bbcdd50780dd02a393ebe15c34425ddd51dd327a5afee` | healthy; the digest-pinned container matches, but the OCI revision label remains the known mismatched `df15afa5a3a8a2b10021f879ffa93b30fb36c73a` |
| SQ Hub API | `ghcr.io/sabilulquran/sq-hub-api:sha-07961141815e5f0c0f3818ad10ae454d3477fce4` | `sha256:b272495a4de18ae0c037bf046093a089ea1a2fe1ee628e80abf0eda35d49761f` | healthy; image has no OCI revision label |

The public production issuer returned by OIDC discovery was exactly `https://login.sabilulquran.or.id/realms/sq-staff`. The source/image mismatch is recorded rather than guessed: Keycloak's immutable digest and local source tag are known, while its OCI revision label is stale. This completes the non-secret runtime snapshot but does not prove any browser scenario.

#### C5 — public local-auth route inventory (`9.5`, partial support for `6.6`)

The current HCIS source defines the password endpoint at `POST /auth/login`; the public edge exposes the API under `/api`, while the public host reverse-proxies the HCIS web service. Read-only probes using an obviously synthetic invalid payload produced:

| Public route | Result |
| --- | --- |
| `GET /api/auth/mode` | HTTP 200 with `mode=oidc` |
| `POST /api/auth/login` | HTTP 404 with stable code `LOCAL_AUTH_DISABLED` |
| `POST /auth/login` | HTTP 405; the unprefixed backend route is not exposed as a password API |
| `GET /login` | HTTP 200 web shell; current source renders the SQ Identity entry path when runtime mode is OIDC |
| `GET /api/auth/oidc/start` | HTTP 302 to the production SQ Identity issuer; query parameters were not retained |

This is sufficient evidence for `9.5`. Row `6.6` remains `NOT_RUN`: route denial alone does not prove the distinct negative browser case after a failed identity mapping or access decision.

### Production Identity UAT Owner Authorization — 2026-09-16

The acceptance owner is assigned by role as **Product Owner SQ Hub/HCIS — Human Capital YSQ**. Codex/engineering acts as executor and evidence collector; it does not declare final acceptance.

The owner authorizes the following bounded execution:

1. C2 may run read-only to prove that NIP and verified unique email login reach the same HCIS local principal.
2. C3/C4 mutation is permitted only for explicitly designated synthetic UAT personas and only for HCIS local suspend/restore, SQ Identity/Keycloak disable/restore, and HCIS Application Access revoke/restore.
3. Every C3/C4 scenario must run serially as `snapshot state -> mutation -> browser test -> evidence -> rollback -> verify rollback`. A rollback failure stops all subsequent mutation and is escalated to the acceptance owner.
4. No real Staff account may be mutated. Credential/password/OTP/TOTP/recovery material, HCIS roles, Keycloak realm/client roles, Platform Administrator, `issuer + sub` mapping, and unrelated production configuration are outside the authorization.
5. Evidence is limited to a synthetic/redacted handle, timestamps, non-secret before/after state, PASS/FAIL result, and rollback verification. Secrets, tokens, cookie values, client secrets, raw OIDC subjects, and production data dumps are prohibited.
6. C6/C7 must not stop or isolate production services. Those rehearsals require a separate isolated/production-like target.
7. Final acceptance remains owner-only after every required gate has qualifying evidence. Source/configuration/health evidence cannot upgrade an unexecuted browser scenario to PASS.

#### C2/C3/C4 execution-readiness discovery

A read-only production query at `2026-09-16T05:50:06Z` used only short one-way handles and boolean/non-secret state. It found no Keycloak or HCIS account carrying the repository's explicit synthetic/UAT/test markers. It did find one currently mapped production identity, but it is not treated as synthetic:

- identity handle `a52f72ffcc95` is enabled in Keycloak, has a non-email username distinct from its email, and has an email present but `emailVerified=false`;
- the same identity handle maps through the exact production issuer to HCIS account handle `c07612fa55d1`, which is an active Employee-linked principal;
- the same identity handle has active `hcis` Application Access.

This proves that the existing exact mapping and access records agree structurally, but it does not prove NIP/email browser login. Because the email is not verified and the identity is not proven synthetic, it must not be used for C2 email-login evidence or any C3/C4 mutation. C2 browser execution remains `NOT_RUN`; C3/C4 cannot begin until the acceptance owner designates or provisions clearly marked synthetic personas through the approved secure path. No user state was changed by this discovery.

#### Controlled production UAT persona provisioning

At `2026-09-16T07:10:55Z`, the owner-authorized synthetic persona `UAT-HCIS-001` was provisioned for C2-C4. The operation used a dedicated Gmail plus-address alias that was unused in HCIS and Keycloak; the already-used base HCIS email was not reused. Retained evidence is limited to the synthetic handle and non-secret state:

- Keycloak contains one enabled ordinary Staff identity with complete first/last name fields, `emailVerified=false`, required actions `VERIFY_EMAIL` and `UPDATE_PASSWORD`, no credential yet, no group membership, and no privileged role match;
- HCIS contains one active synthetic Employee and one active `EMPLOYEE` account with no local password and no HCIS role assignment;
- the HCIS operator CLI returned `would_map` in preview and `mapped` on apply, followed by an exact issuer/subject equality check; the raw subject was not retained in this document;
- SQ Hub contains one active `hcis` Application Access grant, created by the supported operator CLI with actor `codex-vps` and an audit event;
- Keycloak accepted dispatch of a 24-hour action email for email verification and password creation. The first attempt with an unregistered root redirect URI was rejected before dispatch; the successful attempt omitted the application redirect.

This established the authorized baseline but was not browser evidence at provisioning time. Rows `1.1`-`1.3` and C2-C4 were therefore `NOT_RUN` at that point, and the baseline was not mutated before the NIP/email login and local-principal continuity checks below succeeded.

#### Production delta execution — 2026-09-16/17

The mailbox custodian completed email verification and credential creation without retaining credential material. The following production deltas were then executed with the synthetic persona `UAT-HCIS-001`:

- NIP login and verified-email alternate login both opened HCIS; a read-only comparison resolved both journeys to stable HCIS account handle `61e09f4fbaca` with the exact production OIDC mapping still present (`1.1`-`1.3`: `PASS`);
- a fresh controlled Forgot Password request on 17 September 2026 at 11.33 WIB was confirmed from the Akun SQ success screen through cPanel Track Delivery `Accepted` to a new unread Gmail Inbox message (`3.3`: `PASS`);
- an expired reset/action journey was rejected and created no authenticated session (`3.5`: `PASS`);
- the HCIS local account was snapshotted as active, changed only to `suspended`, and denied login with the controlled inactive-account message while the global Keycloak identity remained enabled; the account was restored to active, both mutation events were audited, and a fresh login succeeded (`6.1`: `PASS`);
- the global Keycloak identity was temporarily disabled and its disabled state was verified, but the browser-denial step was not executed. The identity was restored to enabled and verified before the test window ended (`6.2`: `NOT_RUN`, safe rollback confirmed).

Final retained state after the controlled execution: HCIS account `active`, Employee `active`, Keycloak identity `enabled` and email verified, exact OIDC mapping present, and Application Access active. No password, reset URL, token, cookie value, raw OIDC subject, client secret, or production data dump is retained.

#### Forgot Password delivery diagnosis — 2026-09-17

The read-only diagnosis found no production mutation to apply:

- the Keycloak container was healthy and had not restarted during the test window;
- the `sq-staff` realm had a complete SMTP configuration with authentication enabled, SSL on port 465, an organization-domain sender, and credential fields present; secret values were not read or retained;
- the Keycloak container could establish a TCP connection to the configured SMTP endpoint;
- Keycloak logs contained no SMTP/email exception for the relevant period, although successful send events cannot be reconstructed from those logs because realm success-event auditing was not enabled;
- cPanel Track Delivery retained multiple Akun SQ messages to the synthetic Gmail alias during the reported test window and marked each one `Accepted` / delivered successfully;
- public DNS exposed SPF and DKIM records, and DMARC was present with policy `reject`.

A single fresh controlled request at 2026-09-17 11:33 WIB completed the correlation: Akun SQ displayed its successful-send message, cPanel Track Delivery recorded the message as `Accepted`, and Gmail displayed a new unread reset message in Inbox after refresh. Row `3.3` is therefore `PASS`. No SMTP configuration change, credential rotation, or Keycloak restart was needed.

The mailbox custodian then completed one reset using the latest message. Immediate reuse of that exact link was rejected with `Tindakan kedaluwarsa. Silakan lanjutkan dengan log masuk sekarang.` Row `3.4` is therefore `PASS`. No password, reset URL, or token was retained.

### Browser handoff for the product owner

Use only approved synthetic/production test identities. Do not send passwords, OTPs, recovery codes, reset links, tokens, cookie values, Google secrets, or raw OIDC subjects through chat or GitHub.

- [ ] Prepare one redacted handle for ordinary Employee, manager, Human Capital admin, privileged/Super Admin, non-Employee Staff, suspended HCIS account, globally disabled identity, no-access identity, and Google-link test users.
- [x] Test NIP and verified-email login and confirm they reach the same expected HCIS user (`UAT-HCIS-001`, production delta recorded above).
- [ ] Verify Employee, manager, HC admin, and privileged HCIS permissions using one representative capability each; confirm no unexpected extra permission.
- [x] Verify Forgot Password production delivery from Akun SQ through cPanel acceptance to the controlled Gmail Inbox.
- [x] Verify a completed password-reset link cannot be reused. Expired reset rejection is also recorded as `PASS`.
- [ ] Test privileged TOTP, one recovery authentication code plus denied reuse, and disabled-user recovery denial.
- [ ] Test Google: unknown account rejected, first link asks for confirmation + Akun SQ password, TOTP still appears when required, later Google login returns to the same HCIS user, and no new privilege appears.
- [ ] Test trusted device with checkbox off, wrong OTP, checked+valid OTP, same browser, different browser/profile, expiry, tampering, password reset, TOTP replacement, disabled user, ordinary/privileged policy, and Google login.
- [ ] In browser developer tools, verify localStorage/sessionStorage contain no access/refresh/ID token. Record cookie names and security attributes only, never values.
- [x] Retain the accepted staging logout/direct-revisit/reauthentication evidence; do not repeat it solely for a production label.
- [x] Retain the accepted staging Application Access revoke/restore and SQ Hub outage evidence; do not repeat those mutations in production.
- [x] Execute the HCIS-local suspended account production delta and verify active-state rollback.
- [ ] Run only the remaining distinct negative cases: globally disabled identity if still required, missing-access (distinct from revoked), and unknown mapping.
- [ ] For each row, record only `PASS`, `FAIL`, `BLOCKED`, or `NOT_RUN` plus timestamp, redacted persona handle, and a short non-secret observation.

### Codex local/VPS handoff

Codex must not execute production mutations until the product/change owner explicitly authorizes the exact target and window. Read-only checks may proceed under the normal approved access path. If a command might print a secret, token, cookie, raw OIDC subject, personal data, or production dump, change the command/output before running it.

| Handoff | What to inspect / scenario rows | Host/service | Mode | Safe output to retain | Never retain | Risk and rollback if mutation is later approved |
| --- | --- | --- | --- | --- | --- | --- |
| C1 Runtime provenance | 10.1: deployed source/image refs for HCIS, Keycloak/SQ Identity, SQ Hub API; production issuer; execution timestamp | Production VPS; HCIS web/API, Keycloak, SQ Hub API | Read-only | Container/service name, source SHA if exposed, immutable image ref/digest, exact issuer URL, UTC/WIB timestamp | Env contents, secrets, tokens, DB data, raw `sub` | Low read-only risk; no rollback. If metadata label conflicts with source tag, record both rather than guessing provenance. |
| C2 HCIS local-principal continuity | Completed: `1.1`-`1.3` prove NIP and email logins for the same synthetic persona resolve to the same pre-existing local principal | HCIS production browser + read-only DB comparison | Complete | Synthetic persona handle + stable account handle + equality marker | Email/NIP if not synthetic, password, session IDs, raw OIDC subject, production row dump | No repeat required unless identity mapping or login-identifier configuration materially changes. |
| C3 Lifecycle state boundary | `6.1` complete; `6.2` not executed in browser and safely rolled back | HCIS production + Keycloak production | Partial | Redacted handle + HCIS denial + restored state; global disable rollback marker | Keycloak user ID/raw `sub`, credentials, personal attributes, full user export | Repeat only the distinct global-disable browser denial if it remains an accepted release gate. |
| C4 Application Access revoke fixture | Completed by accepted live staging evidence for `6.4` | SQ Hub staging API/operator path + HCIS staging browser | Complete by accepted evidence reuse | Accepted revoke timestamp, existing-session continuation, fresh-login denial, and restore result | Service tokens, client secrets, raw API payloads containing identity identifiers | Do not repeat in production solely to relabel the environment. Re-run in isolation only after a material access-check implementation change. |
| C5 Public local-auth route inventory | 6.6/9.5: enumerate known/current/historical HCIS login endpoints and edge routes while `AUTH_MODE=oidc` | HCIS production + reverse proxy/Caddy | Read-only | Route/path, HTTP status, stable application error code/body fragment that contains no sensitive data | Authorization headers, cookies, response tokens, full proxy config with secrets | Low read-only risk; no rollback. Do not brute-force or probe unrelated paths. |
| C6 Keycloak outage rehearsal | 9.1-9.3: fail-closed new login, no local fallback, existing-session behavior | Prefer restored staging/isolated production-like target; production only in an explicitly approved maintenance window | Mutation: stop/isolate Keycloak target; restore after observation | Target name, start/end time, health state, browser PASS/FAIL markers, restore health marker | Container env, admin credentials, tokens, cookies, session IDs, verbose auth logs | High availability risk. Pre-record running state; isolate only the approved Keycloak service/network path; restore immediately; verify health/discovery; invoke rollback/incident owner if restore fails. |
| C7 Application Access failure rehearsal | Completed by accepted live staging evidence for `9.4` | SQ Hub staging API + HCIS staging | Complete by accepted evidence reuse | Stopped/recovered service state, fresh-login denial, existing-session continuity, and restored fresh login | Machine token/client secret, request authorization headers, production DB data | Do not repeat in production. Re-run only in an isolated target after a material integration change invalidates the accepted evidence. |

For C6/C7, the repository provides no authorization to stop production services. Rows 9.1-9.3 remain `BLOCKED` because the accepted staging evidence covered SQ Hub access-check failure, not a Keycloak outage. Row 9.4 is satisfied by the accepted live staging SQ Hub outage rehearsal and must not be repeated in production merely to change the environment label.

### Owner decisions and remaining inputs

The owner role, bounded C3/C4 authorization, production prohibition for C6/C7, rollback escalation, synthetic persona, mapping, active-access baseline, completed C2, and completed HCIS-local part of C3 are recorded above. Do not repeat C4 in production: the exact revoke/new-login denial/existing-session/restore behavior is already covered by accepted live staging evidence.

On 2026-09-17 the product owner initially declared recovery/Google (`HUB-IMPL-011`) and trusted device (`HUB-IMPL-012`) mandatory release gates. Later that day, the product owner issued a release exception: the distinct unexecuted Google, trusted-device, additional-persona, lifecycle, and browser-storage/cookie scenarios are deferred to a separately tracked acceptance backlog. Their rows remain `NOT_RUN`; they are not inferred from configuration or relabeled `PASS`. This exception accepts the missing-live-evidence risk for the current release and does not authorize use of real identities as UAT fixtures.

The remaining work is limited to real deltas:

1. provision or designate an organization-controlled Google identity whose asserted email exactly matches a verified unique synthetic Akun SQ email for rows `4.2`-`4.5`; use a separate unmatched Google identity for `4.1`;
2. enroll approved synthetic ordinary and privileged TOTP fixtures without recording QR codes, seeds, OTP values, recovery codes, or credentials;
3. execute the recovery/Google and trusted-device browser matrices in state-safe order, including password/TOTP replacement invalidation and bounded disabled-user rollback;
4. execute the globally-disabled identity browser denial (`6.2`) as part of the approved synthetic lifecycle coverage; the earlier attempted state change was safely rolled back without browser evidence and therefore is not marked `PASS`;
5. execute Keycloak outage rows `9.1`-`9.3` only in an isolated/production-like target; they are explicitly excluded from production execution;
6. retain issue #9 as the backlog tracker until the deferred scenarios have qualifying evidence. It does not block the current release under the product-owner exception.

### Consistency and invented-requirement audit

No new authentication or authorization behavior is introduced by this packet. The scenarios above are direct operationalization of the accepted product/domain boundary, ADR-0003, ADR-0005, `HUB-IMPL-003`, `HUB-IMPL-011`, `HUB-IMPL-012`, Staff authentication policy, security baseline, issue #9 gates, and the requested production UAT scope.

No normative conflict was found between the accepted domain ownership document, accepted ADRs, and the three accepted implementation specs for these scenarios. Two temporal/status differences must remain explicit rather than be “fixed” by inference:

- ADR-0005 describes the pre-cutover HCIS context, while the 2026-09-16 runtime audit observes production already running OIDC. That is a historical-context difference, not permission to infer that acceptance or authorization was complete.
- `HUB-IMPL-003` is a staging implementation/rehearsal spec and explicitly does not authorize production cutover. The observed production runtime therefore does not supersede the hard gates in this runbook; missing approval, rollback rehearsal, browser evidence, and owner acceptance keep `CUTOVER_BLOCKED`.

The Foundation PRD and security baseline are marked DRAFT, so accepted ADR/spec/policy text is used where a binding decision is required. The accepted Staff authentication policy and accepted implementation specs are consistent with the matrix. Repository tests and workflows are treated as contract evidence only; they are not substituted for production browser execution. No PASS above depends solely on a health check. No production secret, credential, token, cookie value, raw OIDC subject, personal-data dump, or production database dump is requested as evidence.
