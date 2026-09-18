# HUB-IMPL-003 — HCIS OIDC Consumer Integration

**Status:** ACCEPTED
**Product:** SQ Hub / HCIS integration
**Area:** Staff authentication migration rehearsal
**Depends on:** HUB-IMPL-001, HUB-IMPL-002, ADR-0005, HCIS source-of-truth docs

## Outcome
HCIS staging authenticates Staff through SQ Identity/Keycloak while preserving HCIS-local authorization semantics and existing `accounts.id` references.

This spec is staging implementation/rehearsal only. It does not authorize production cutover.

## Current HCIS facts to preserve
Current HCIS:
- stores auth principal in `accounts`;
- roles/scopes reference `accounts.id`;
- uses direct local password/TOTP authentication today;
- creates an HCIS-local application session cookie;
- separates role/permission data from password verification sufficiently that authentication can be replaced without re-keying authorization.

## Schema change
Add external identity mapping to the existing HCIS local account/principal.

Minimum semantic fields:
- `identity_issuer text null`;
- `identity_subject text null`.

Requirements:
- `(identity_issuer, identity_subject)` unique when both populated;
- both null or both non-null;
- no change to `accounts.id` primary key;
- no rewrite of `account_role_assignments.account_id`;
- migration supports pre-cutover local accounts without identity mapping;
- down/recovery strategy documented.

## Authentication modes
A staging-safe configuration may support:
- `local` — current HCIS direct authentication;
- `oidc` — SQ Identity authentication.

Rules:
- mode is server configuration, not a user-selectable login option;
- production remains in its current mode until a separate cutover change;
- no route silently falls back from OIDC to local password authentication;
- do not expose a screen offering both login methods.

## OIDC flow
Use maintained OIDC client/library behavior rather than hand-building protocol verification.

Flow:
1. unauthenticated user enters HCIS staging;
2. HCIS starts Authorization Code flow and redirects to SQ Identity;
3. Keycloak authenticates user;
4. HCIS callback validates state/nonce/issuer and exchanges authorization code server-side;
5. HCIS resolves local account by exact `issuer + sub`;
6. HCIS rejects missing/ambiguous mapping;
7. HCIS verifies local account/domain state;
8. HCIS calls SQ Hub Application Access check for `hcis` using its machine credential;
9. only if allowed, HCIS creates its own app-scoped HttpOnly session;
10. existing HCIS role/permission/scope authorization continues against local `accounts.id`.

Do not join by email/NIP in the callback path.

## Browser/session rules
- OIDC access/refresh tokens are not stored in localStorage/sessionStorage;
- token/code exchange stays server-side;
- browser receives HCIS application session cookie only;
- production cookie must be `HttpOnly` and `Secure`, with appropriate SameSite/path/origin scoping;
- cookie must not be wildcard-shared with SQ Hub/SPMB;
- local HCIS session absolute lifetime cannot exceed the accepted SSO maximum without reauthentication.

The existing `hcis_session` implementation may be adapted/reused internally if it no longer represents direct password ownership and meets the accepted session policy. A separate session implementation is not required merely for naming purity.

## Application Access timing
SQ Hub Application Access is checked when creating a new HCIS OIDC-derived session.

Existing sessions do not synchronously call SQ Hub on every request. This prevents routine SQ Hub maintenance from terminating already-valid HCIS sessions.

If the access-check service is unavailable during new login, HCIS fails closed and does not create a new session.

## Provisioning/mapping rehearsal
For synthetic staging accounts:
- match an existing HCIS local account explicitly;
- create/provision Keycloak identity through the accepted staging flow;
- store returned `issuer + sub` mapping against that local account;
- create HCIS Application Access grant in SQ Hub;
- no password/TOTP/recovery/session data is copied from HCIS.

Migration tooling may use NIP/email to locate candidate source/target records during preview, but persisted binding is `issuer + sub` and ambiguous mapping is a blocker.

## Local lifecycle vs global identity lifecycle
HCIS-local `inactive`/`suspended` state blocks HCIS usage but does not automatically disable the global Keycloak identity.

A Staff member may legitimately lose HCIS access while retaining SPMB or another application. Global identity disablement is a platform lifecycle decision, not a side effect of HCIS status.

## Authorization invariants
After OIDC login:
- HCIS permission resolution uses existing HCIS roles/permissions/scopes;
- Keycloak roles do not grant leave/payroll/employee permissions;
- SQ Hub Application Access grants entry only;
- `principal_type` and local account relationships remain HCIS-owned during this migration;
- client-side navigation hiding is not used as authorization.

## Logout
User-facing logout in OIDC mode must:
1. revoke/expire HCIS application session;
2. initiate the appropriate SQ Identity logout behavior;
3. return user to a safe signed-out HCIS/SQ destination.

Staging verification must prove that re-opening HCIS after logout requires authentication unless another still-valid global session behavior is intentionally part of the tested Keycloak logout semantics.

## Failure behavior
- unknown `issuer + sub` -> deny, audit/log safe metadata;
- duplicate/ambiguous mapping -> deny;
- local suspended/inactive -> deny HCIS;
- no Application Access -> deny HCIS;
- SQ Hub access-check unavailable during session creation -> deny new session;
- Keycloak unavailable -> no new OIDC login, existing HCIS local sessions may continue until their normal expiry;
- invalid/missing state/nonce/code validation -> deny;
- do not log code/access/refresh/id tokens.

## Tests
Minimum automated/integration coverage:
- identity mapping uniqueness;
- successful synthetic OIDC mapping resolves original `accounts.id`;
- local role assignments still work after OIDC login;
- wrong issuer same subject -> not matched;
- same issuer wrong subject -> not matched;
- unknown subject -> denied;
- inactive/suspended HCIS local account -> denied without disabling Keycloak globally;
- no/revoked Application Access -> denied;
- access-check outage -> new session denied;
- existing HCIS session does not require per-request SQ Hub call;
- machine-token failure -> access check cannot be bypassed;
- local auth cannot be reached in OIDC mode through alternate public route;
- token values not present in browser storage in browser smoke test;
- logout behavior verified;
- existing HCIS permission tests remain green.

## Staging UAT personas
Use synthetic personas for:
- ordinary Employee;
- unit manager;
- Human Capital administrator;
- privileged/Super Admin with MFA;
- non-Employee Staff;
- HCIS-local suspended user;
- globally disabled Keycloak identity;
- identity authenticated but without HCIS Application Access.

## Acceptance criteria
- HCIS staging can switch to OIDC mode without changing production mode;
- synthetic NIP login through SQ Identity reaches correct HCIS local principal;
- Application Access gate works;
- existing HCIS domain authorization remains intact;
- no legacy HCIS credential import occurs;
- no browser token storage occurs;
- no public dual-auth login occurs;
- OIDC/access-check failures fail closed for new sessions;
- staging rollback to local mode is rehearsed and documented;
- actual lint/typecheck/test/build/browser-smoke commands are recorded.

## Non-goals
- production auth cutover;
- removal of legacy HCIS credentials/code (that happens after production rollback window);
- Organization Directory integration or any migration of workforce-organization authoring ownership from HCIS to Hub;
- redesign of HCIS role/permission model;
- SPMB OIDC integration;
- universal session revocation/event bus.