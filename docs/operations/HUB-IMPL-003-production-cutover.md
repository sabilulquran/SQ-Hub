# HUB-IMPL-003 HCIS production cutover preparation

**Status:** PREPARATION ONLY — `CUTOVER_BLOCKED`  
**Production authorization:** NOT GRANTED by this document  
**Execution owner:** designated production change owner after explicit approval

See [2026-09-06 staging evidence](HUB-IMPL-003-production-readiness-2026-09-06.md)
for the deployed verifier repair and current gate results. Technical acceptance
is still incomplete; this runbook remains blocked. Issue #17 long-state visual
UAT is not a production cutover hard gate. Technical staging acceptance and
human production authorization/window/owners must be reported separately.

This runbook prepares the production migration from HCIS-owned password authentication to SQ Identity. It does not authorize a production realm, production secret mutation, HCIS auth-mode switch, DNS change, deployment, or legacy-credential deletion.

## Hard gate

The default state is:

```text
CUTOVER_BLOCKED
```

The change owner must not schedule or execute production auth cutover until all of the following are true and independently evidenced:

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

Cleanup is not performed by this Agent 2 branch.

## Evidence retention

Retain only non-secret acceptance evidence: source/image pins, timestamps, health/result markers, persona handles, audit/event references, and approval identifiers. Never retain credential values or raw live OIDC subjects in the repository.
