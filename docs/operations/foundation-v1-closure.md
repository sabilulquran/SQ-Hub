# Akun SQ + SQ Hub Foundation v1 — closure ledger

**Overall:** OPEN — NOT ACCEPTED / NOT CLOSED.
**Audit date:** 2026-09-21.
**Audited main:** `d2de4411760c963df542a540c6e3e63eee37283e`.
**Acceptance owner:** Product Owner SQ Hub/HCIS — Human Capital YSQ.
**Execution roles:** GitHub reviewer for repository evidence; approved production operator for runtime; product owner/approved tester for browser evidence.

This is the current closure control record, not a certificate that Foundation is finished. No unchecked or unexecuted item is PASS by implication.

## Scope and authority

Closure is limited to Foundation contracts HUB-IMPL-003/005/007/009/011/012/015/016/017 and the accepted Staff authentication policy/ADRs. The 21 September owner instruction restores the explicitly named identity/security acceptance as **Foundation closure** gates: password recovery E2E, Google existing-account linking/login including mapping and normal-login regression, trusted-device/TOTP/MFA, browser cookie/storage security, plus source-of-truth closure. PR #67 remains a historical release exception, not a security-test result. Do not erase that history or infer retrospective production authorization.

This decision does **not** reopen every historical `NOT_RUN`/`BLOCKED` row in issue #9 as a Foundation blocker. Rows that do not map to the owner-defined closure checklist remain truthful backlog and may be completed later without preventing Foundation closure. Never relabel them PASS merely because they are non-blocking.

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
| F04 | Administrasi SQ foundation healthy | PASS | Operator 18 September saw the correct admin surface for the authorized account; no separate duplicate admin-boundary UAT is required for current closure absent a regression |
| F05 | Account Console desktop/mobile accepted | PASS | PR #81 deployed; desktop + 390×844 operator evidence 18 September |
| F06 | Logout accepted | PASS | Hub logout production evidence and accepted HCIS staging logout/reauthentication evidence already qualify; no duplicate cross-app rehearsal is required absent a material regression |
| F07 | Password recovery E2E accepted | OPEN | 3.3–3.5 PASS; F-REC must prove new password login succeeds and old password is rejected. Disabled-user recovery may be combined with the MFA/security negative batch |
| F08 | Google existing-account linking/login matrix accepted | NOT_RUN | 4.1–4.5 and associated MFA/trust/mapping checks |
| F09 | Trusted-device/TOTP/MFA matrix accepted | OPEN | 5.1–5.5 PASS; privileged MFA/recovery and the contract-defined expiry/invalidation/security remainder still need qualifying evidence. Automated invariant evidence may satisfy non-browser cryptographic cases when it exactly matches the contract |
| F10 | Browser cookie/storage security accepted | NOT_RUN | 7.1–7.4 and F-BROWSER for Hub |
| F11 | Production deployment workflow proven | PASS — NO-OP path | Run 35581490721; all three components unchanged; no recreate/rollback claim |
| F12 | Rollback/backup operational path documented | PASS | HUB-IMPL-016 runbook documents rollback and deployment run 35581490721 emitted Compose backup references. Compose copies are not DB backups; an isolated restore rehearsal remains an operational improvement, not a separate Foundation closure gate under the 21 September definition of done |
| F13 | Source-of-truth docs current on main | OPEN | This replacement documentation package requires review/merge; consolidated PRD approval must be explicit |
| F14 | No stale Foundation PR misleading status | PASS | PR #84 closed as superseded after replacement PR #88 was opened; history and cross-link retained |
| F15 | Status separates deployed vs verified | OPEN until reviewed/merged | Current ledger/status/README implement the distinction on the documentation branch |
| F16 | Final closure report and owner acceptance exist | NOT_RUN | Complete the final record below only after all required gates have evidence |

F01–F06 describe the precise core behavior already observed, not a waiver of the additional identity/access/security rows below. Do not reduce Foundation to a count of green top-level cells.

## Existing identity UAT — preserved, not restarted

Authoritative detailed matrix: [HUB-IMPL-003 production cutover packet](HUB-IMPL-003-production-cutover.md#execution-matrix--58-scenarios). Tracker: [issue #9](https://github.com/sabilulquran/SQ-Hub/issues/9).

At this audit the 58-row ledger is **27 PASS / 28 NOT_RUN / 3 BLOCKED**. It includes repository/process gates and accepted staging reuse; it is not a Foundation completion percentage.

Already-qualified browser/runtime evidence includes recovery delivery/reset/single-use/expiry (3.3–3.5), trusted-device unchecked/wrong OTP/checked-valid/same browser/other browser (5.1–5.5), NIP/email/same principal (1.1–1.3), ordinary HCIS authorization (2.1), and HCIS-local suspension with safe restore (6.1). Preserve accepted staging revoke/access-outage/logout results with their staging label.

## Mandatory closure mapping from the historical identity ledger

The historical ledger stays intact, but only the rows below are elevated as current Foundation closure gates because they map directly to the owner's 21 September definition of done.

| Mandatory group | Legacy / delta IDs | Exit evidence |
| --- | --- | --- |
| Recovery completion | F-REC; reuse 3.3–3.5 | Fresh login with the new password succeeds, old password is rejected, existing identity/access remains unchanged; delivery/reset/single-use/expiry evidence is retained |
| Google existing-account + mapping regression | 4.1–4.5 plus 1.5/6.5 where needed to prove wrong/unknown mapping remains fail-closed | Unknown Google is rejected/no auto-create; first link requires local proof; MFA interaction follows policy; subsequent Google login reaches the same principal; no privilege/access gain; normal NIP/email login and exact mapping remain intact |
| MFA / trusted device | 3.1–3.2, 5.6–5.12; combine disabled-user negative behavior with 3.6/6.2 when practical | Privileged MFA and recovery behavior; expiry/tamper/invalidation; password/TOTP replacement invalidation; disabled identity denial; ordinary-vs-privileged policy; Google parity. Existing 5.1–5.5 remain PASS |
| Browser security | 7.1–7.4 + F-BROWSER | No persisted bearer/OIDC secret material; Hub and trusted-device cookie metadata match accepted contracts |

Other historical rows such as non-Employee/manager/HC-admin persona expansion, missing-access variants already covered by accepted revoke behavior, fixture bookkeeping, and Keycloak-outage rehearsal remain issue #9 backlog. Keycloak outage 9.1–9.3 must still never be run against production; an isolated/production-like target is required if that backlog is pursued. They do not block Foundation closure unless a new mandatory test reveals a material regression that makes them relevant again.

Tamper/replay, user/realm mismatch, proof rotation, and signing-key fail-closed behavior are also requirements of HUB-IMPL-012. Existing automated coverage must be referenced for those exact invariants; it must not masquerade as production browser execution. Any required controlled runtime exercise follows the approved isolated-target procedure in the UAT guide.

## Foundation delta register

These IDs supplement rather than renumber the historical 58 rows. Only the rows below are additional current closure requirements.

| ID | Required evidence | Layer / routing |
| --- | --- | --- |
| F-REC | After a supported reset, fresh login with the new password succeeds; old password is rejected; no credential exposure in evidence/error/storage | Production synthetic browser. Combine with password-reset trust invalidation to avoid duplicate resets; retain existing 3.3–3.5 evidence |
| F-BROWSER | Hub transaction/session cookie host-only, Secure, HttpOnly, SameSite=Lax, Path=/; no OIDC material in local/session storage, IndexedDB or application-managed cache | Production browser; current Hub contract HUB-IMPL-016. Keycloak native in-memory adapter tokens are not persistent storage |
| F-REVIEW | Review diff, pass relevant CI, owner-authorized merge, source-of-truth approval, and stale-PR cleanup | GitHub; no deployment needed for docs-only changes |

Core Administrasi SQ, logout, HCIS launch/Application Access, Account Console, and deployment/rollback documentation already have qualifying evidence in the top-level exit checklist and are not assigned duplicate mandatory UAT rows here. If the mandatory identity/security UAT exposes a regression in one of those areas, reopen only the affected gate and diagnose the root cause.

## PR reconciliation

PR #84 is not accepted as a closure package: it used an older baseline, conflated PRD acceptance wording with delivery, omitted required security scenarios, and failed to carry all existing recovery/trust evidence accurately. This branch is built from audited main. Replacement PR #88 is the active documentation package; PR #84 was closed as superseded with a cross-link after #88 existed. CI/review evidence for the final PR head remains a merge gate. No PR may be auto-merged by this ledger.

PR #12 and #42 are preserved as discovery/proposal and do not block this package through implementation work. They must remain clearly outside Foundation implementation.

## Final closure report — not signed

| Final field | Value |
| --- | --- |
| Foundation decision | OPEN / NOT ACCEPTED |
| Final source SHA and merged closure PR | PENDING |
| Production component provenance | Latest known: deployment evidence 2026-09-21; final reconciliation PENDING |
| Mandatory scenario results and evidence references | PENDING; retained PASS results above are not reset |
| Failed/NOT_RUN/BLOCKED required items | Present; see registers above |
| Backup/rollback operational path | Documented path PASS via HUB-IMPL-016 runbook + deployment evidence; no separate restore rehearsal required for this Foundation closure |
| Synthetic fixture state restoration/cleanup | PENDING; no cleanup by this documentation task |
| Acceptance owner sign-off and timestamp | NOT GIVEN |
| Permission to start next phase | NOT GIVEN by this record |

Only after all required results are qualified, documentation is merged/current, state restoration is verified, and the acceptance owner signs off may the decision become CLOSED. Do not print a completed-Foundation statement while an important acceptance is unproven. Use [the UAT guide](akun-sq-production-uat-checklist-2026-09-21.md) for the next executable batch.
