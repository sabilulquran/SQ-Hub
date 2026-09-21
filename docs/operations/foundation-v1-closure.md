# Akun SQ + SQ Hub Foundation v1 — closure ledger

**Overall:** OPEN — NOT ACCEPTED / NOT CLOSED.
**Audit date:** 2026-09-21.
**Audited main:** `d2de4411760c963df542a540c6e3e63eee37283e`.
**Acceptance owner:** Product Owner SQ Hub/HCIS — Human Capital YSQ.
**Execution roles:** GitHub reviewer for repository evidence; approved production operator for runtime; product owner/approved tester for browser evidence.

This is the current closure control record, not a certificate that Foundation is finished. No unchecked or unexecuted item is PASS by implication.

## Scope and authority

Closure is limited to Foundation contracts HUB-IMPL-003/005/007/009/011/012/015/016/017 and the accepted Staff authentication policy/ADRs. The 21 September owner instruction restores required identity/security acceptance as a **Foundation closure** gate. PR #67 remains a historical release exception, not a security-test result. Do not erase that history or infer retrospective production authorization.

HUB-IMPL-013, HUB-IMPL-018 runtime, PR #12, SQ Portal, external identity, SPMB implementation, and other later phases are not implementation scope. Testing a synthetic disabled identity is existing authentication acceptance, not implementation of Identity Lifecycle. HCIS retains organization and domain-authorization authority.

## Evidence rules

Track source, deployment, and test result independently. Test results use PASS / FAIL / NOT_RUN / BLOCKED. A capability may be deployed while its acceptance remains OPEN.

A qualifying evidence record identifies scenario ID, UTC/WIB timestamp, synthetic persona handle, browser/environment, source/image or referenced deployment baseline, expected/actual outcome, evidence source, and rollback result when state changed. Never retain raw subject, password, OTP/seed, recovery code, token, cookie value, full auth URL, environment dump, or production personal data.

Accepted historical execution is reused only for the exact behavior it covered and only when no material runtime/code/policy delta invalidates it. Preserve the original environment and date. CI is not browser UAT. A later healthy run does not upgrade an old NOT_RUN. A new bug invalidates only the affected result, with an explicit explanation.

## Foundation exit checklist

| ID | Required item | Current state | Evidence / remaining boundary |
| --- | --- | --- | --- |
| F01 | Core Akun SQ production healthy | PASS, dated evidence | Operator 18 September; deployment health path 21 September. Not a claim that every security journey passed |
| F02 | SQ Hub production healthy | PASS, dated evidence | Operator 18 September and run 35581490721 |
| F03 | HCIS launch/Application Access healthy | PASS for recorded core paths | Production launcher observation plus accepted staging revoke/outage; remaining distinct negatives/personas remain below |
| F04 | Administrasi SQ foundation healthy | PASS for recorded surface | Operator 18 September saw the correct admin surface; full boundary checks remain F-ADMIN |
| F05 | Account Console desktop/mobile accepted | PASS | PR #81 deployed; desktop + 390×844 operator evidence 18 September |
| F06 | Logout accepted for recorded app/SSO paths | PASS for recorded paths | Existing Hub operator evidence and HCIS accepted staging logout; cross-app delta F-LOGOUT remains separate |
| F07 | Password recovery E2E accepted | OPEN | 3.3–3.5 PASS; F-REC and disabled-user 3.6 still require qualifying evidence |
| F08 | Google existing-account linking/login matrix accepted | NOT_RUN | 4.1–4.5 and associated MFA/trust/mapping checks |
| F09 | Trusted-device/TOTP/MFA matrix accepted | OPEN | 5.1–5.5 PASS; 3.1–3.2 and 5.6–5.12 pending |
| F10 | Browser cookie/storage security accepted | NOT_RUN | 7.1–7.4 and F-BROWSER for Hub |
| F11 | Production deployment workflow proven | PASS — NO-OP path | Run 35581490721; all three components unchanged; no recreate/rollback claim |
| F12 | Rollback/backup operational path documented | PASS — documentation only | HUB-IMPL-016 production runbook; actual backup/restore/custody reconciliation remains F-OPS, not implied by Compose copies |
| F13 | Source-of-truth docs current on main | OPEN | This replacement documentation package requires review/merge; consolidated PRD approval must be explicit |
| F14 | No stale Foundation PR misleading status | OPEN | Close #84 as superseded only after replacement exists; retain cross-link/history |
| F15 | Status separates deployed vs verified | OPEN until reviewed/merged | Current ledger/status/README implement the distinction on the documentation branch |
| F16 | Final closure report and owner acceptance exist | NOT_RUN | Complete the final record below only after all required gates have evidence |

F01–F06 describe the precise core behavior already observed, not a waiver of the additional identity/access/security rows below. Do not reduce Foundation to a count of green top-level cells.

## Existing identity UAT — preserved, not restarted

Authoritative detailed matrix: [HUB-IMPL-003 production cutover packet](HUB-IMPL-003-production-cutover.md#execution-matrix--58-scenarios). Tracker: [issue #9](https://github.com/sabilulquran/SQ-Hub/issues/9).

At this audit the 58-row ledger is **27 PASS / 28 NOT_RUN / 3 BLOCKED**. It includes repository/process gates and accepted staging reuse; it is not a Foundation completion percentage.

Already-qualified browser/runtime evidence includes recovery delivery/reset/single-use/expiry (3.3–3.5), trusted-device unchecked/wrong OTP/checked-valid/same browser/other browser (5.1–5.5), NIP/email/same principal (1.1–1.3), ordinary HCIS authorization (2.1), and HCIS-local suspension with safe restore (6.1). Preserve accepted staging revoke/access-outage/logout results with their staging label.

| Remaining group | Exact legacy IDs | Dependency / exit evidence |
| --- | --- | --- |
| Staff/persona authorization | 1.4, 2.2, 2.3, 2.4 | Approved non-Employee, manager, HC admin, privileged fixtures; expected domain scopes preserved |
| Exact mapping and deny paths | 1.5, 6.2, 6.3, 6.5 | Approved unmapped/no-access/disabled fixtures; no heuristic join or new unauthorized session; wrong-pair automated regression retained |
| Privileged MFA/recovery | 3.1, 3.2, 3.6 | Enforced TOTP; one-time recovery Authentication Code; disabled recovery cannot create a session |
| Google | 4.1–4.5 | Real organization-controlled Google fixtures; exact asserted email, local proof, MFA, same principal, no privilege changes |
| Trust remainder | 5.6–5.12 | Expiry/tamper, password/TOTP replacement, disabled identity, ordinary/privileged comparison, Google parity |
| Browser | 7.1–7.4 | Actual storage and cookie metadata inspection; no copied values |
| Fixture assignment | 10.2 | Operator-confirmed current synthetic handles and intended outcomes, not an assumption that old test users still exist |
| Keycloak outage | 9.1–9.3, BLOCKED | Isolated/production-like target and approval; never stop or isolate production Keycloak |

Tamper/replay, user/realm mismatch, proof rotation, and signing-key fail-closed behavior are also requirements of HUB-IMPL-012. Existing automated coverage must be referenced for those exact invariants; it must not masquerade as production browser execution. Any required controlled runtime exercise follows the approved isolated-target procedure in the UAT guide.

## Foundation delta register

These IDs supplement rather than renumber the historical 58 rows. Every row is currently NOT_RUN unless evidence is explicitly recorded later.

| ID | Required evidence | Layer / routing |
| --- | --- | --- |
| F-REC | After a supported reset, fresh login with the new password succeeds; old password is rejected; no credential exposure in evidence/error/storage | Production synthetic browser. Combine with 5.8 to avoid duplicate resets; retain existing 3.3–3.5 evidence |
| F-BROWSER | Hub transaction/session cookie host-only, Secure, HttpOnly, SameSite=Lax, Path=/; no OIDC material in local/session storage, IndexedDB or application-managed cache | Production browser; current Hub contract HUB-IMPL-016. Keycloak native in-memory adapter tokens are not persistent storage |
| F-ADMIN | Authorized platform admin can use the existing Administrasi SQ surface; ordinary identity denied direct admin entry; platform admin does not acquire HCIS domain privilege | Browser + approved expected-access snapshot; synthetic fixtures, no real-user role changes |
| F-LOGOUT | Hub and HCIS logout each terminate their own app session and Akun SQ session; cross-application behavior is observed and compared with the accepted global-logout policy | Production browser with both applications open; refresh protected data, not only cached page display. Unexpected surviving access is a defect, not an assumed PASS |
| F-OPS | Reconcile current component/runtime provenance, backup and isolated restore references, rollback/recovery ownership, privileged recovery/custody and original cutover-record gaps | Existing accepted operational evidence may be reused for the exact behavior. Missing references remain pending. Do not trigger cutover/restore or expose secrets just to fill a table |
| F-REVIEW | Review diff, pass relevant CI, owner-authorized merge, source-of-truth approval, and stale-PR cleanup | GitHub; no deployment needed for docs-only changes |

F-OPS distinguishes an existing documented path from a performed restore. Preserve the bounded legacy-credential policy of ADR-0005; this documentation task neither verifies nor changes retained HCIS credentials. An authorized operator must reconcile any missing record rather than silently extending a retention window or performing destructive cleanup.

## PR reconciliation

PR #84 is not accepted as a closure package: it used an older baseline, conflated PRD acceptance wording with delivery, omitted required security scenarios, and failed to carry all existing recovery/trust evidence accurately. This branch is built from audited main. Replacement PR number, cleanup result, and CI evidence must be recorded after GitHub confirms them. No PR may be auto-merged by this ledger.

PR #12 and #42 are preserved as discovery/proposal and do not block this package through implementation work. They must remain clearly outside Foundation implementation.

## Final closure report — not signed

| Final field | Value |
| --- | --- |
| Foundation decision | OPEN / NOT ACCEPTED |
| Final source SHA and merged closure PR | PENDING |
| Production component provenance | Latest known: deployment evidence 2026-09-21; final reconciliation PENDING |
| Mandatory scenario results and evidence references | PENDING; retained PASS results above are not reset |
| Failed/NOT_RUN/BLOCKED required items | Present; see registers above |
| Backup/rollback operational evidence and custodian | PENDING reconciliation |
| Synthetic fixture state restoration/cleanup | PENDING; no cleanup by this documentation task |
| Acceptance owner sign-off and timestamp | NOT GIVEN |
| Permission to start next phase | NOT GIVEN by this record |

Only after all required results are qualified, documentation is merged/current, state restoration is verified, and the acceptance owner signs off may the decision become CLOSED. Do not print a completed-Foundation statement while an important acceptance is unproven. Use [the UAT guide](akun-sq-production-uat-checklist-2026-09-21.md) for the next executable batch.
