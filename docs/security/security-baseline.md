# SQ Hub Security Baseline

**Status:** DRAFT

## Principles
- Least privilege by default.
- Authentication and authorization are separate concerns.
- No production secrets or personal production data in repository, prompts, fixtures, screenshots, or demos.
- Security-sensitive decisions must be documented rather than inferred by implementation agents.
- Identity protocol/security internals are delegated to Keycloak rather than reimplemented in SQ Hub.

## Authentication
- Staff authentication is centralized through SQ Identity.
- SQ Identity uses Keycloak according to ADR-0003.
- Domain applications must not receive or store Staff passwords after migration cutover.
- Domain applications integrate to SQ Identity through standard OIDC/OAuth2 behavior; do not invent custom token exchange/login protocols without a superseding ADR.
- Staff authentication policy is defined in `docs/security/staff-authentication-policy.md`.
- Keycloak fine-grained Authorization Services are not the canonical domain-permission engine; Application Access stays with SQ Hub and domain permissions stay with each application.

### Login identifiers
- Employee username baseline: NIP/`employee_number`.
- Verified unique email may be accepted as alternate login.
- Staff without NIP uses verified unique email during Foundation v1.
- Application identity mapping uses opaque OIDC `issuer + sub`, not email/NIP.
- NIK is not a login username.

### Password baseline
- minimum 12 characters;
- password must not equal username/NIP;
- use provider common-password/blacklist controls when maintainable;
- no mandatory periodic rotation solely because password age elapsed;
- reset on compromise/admin reset or explicit security-policy change.

### MFA baseline
MFA is mandatory for privileged/security-sensitive identities, including platform/identity administrators, HCIS Super Admin, application administrators, and roles able to administer sensitive employee/payroll/security/access-control data. Staff ordinary is optional-enrollment on Foundation v1.

Initial second factor: TOTP with recovery codes. Passkey/WebAuthn may be enabled after UAT; SMS OTP is not baseline.

## Keycloak production baseline
Before production use:
- pin an explicitly tested Keycloak version/container image;
- never deploy `latest` as the production version selector;
- configure HTTPS/reverse-proxy/hostname settings according to the supported production guide;
- set explicit CPU/memory constraints and validate actual VPS capacity;
- isolate staging and production realm/data/configuration so test accounts/config do not mutate production;
- enable and verify brute-force protection;
- keep admin/service credentials outside source control and grant only required Admin API permissions;
- document and test database/configuration backup and restore;
- test provider upgrade and rollback before production upgrades;
- maintain an emergency privileged-access/recovery procedure that does not depend on a normal domain application being healthy;
- verify the SQ-branded login theme after each provider upgrade before rollout.

## Sessions
Foundation v1 baseline:
- SSO Session Idle: 8 hours;
- SSO Session Max: 12 hours;
- Remember Me: disabled initially;
- access token baseline: 5 minutes;
- application absolute session must not outlive the SSO maximum without reauthentication.

Applications may maintain their own server-side application session while relying on SQ Identity/Keycloak for SSO.

Do not solve SSO by sharing one broad application cookie across all `*.sabilulquran.or.id` subdomains. Use centralized IdP redirect/session behavior so each application maintains an appropriately scoped session.

For backend-backed web applications, perform authorization-code exchange and refresh-token handling server-side. Do not place access/refresh tokens in browser localStorage/sessionStorage.

## Logout
User-facing logout must terminate the current application session and SQ Identity SSO session. Before a second internal application is production, cross-application/global logout behavior must be verified with the chosen OIDC/Keycloak client implementation.

## Secrets
- Database passwords, signing keys, encryption keys, API tokens, OIDC client secrets, Keycloak admin/service credentials, and similar material must be supplied through environment/secret management and never committed.
- Do not log credentials, authorization codes, access tokens, refresh tokens, session cookies, or client secrets.

## Authorization
- SQ Hub Application Access only grants entry to an application; it does not imply broad permission inside that application.
- Domain applications enforce their own permissions server-side.
- Client-side hiding is not an authorization control.
- Token claims may contain derived access information for performance/integration, but must not silently become a competing source of truth to SQ Hub Application Access.

## Audit
Security-sensitive administrative actions must create audit records with minimum actor, action, target, timestamp, and outcome. Audit records must not contain raw passwords, authentication tokens, MFA secrets, or unnecessary sensitive payloads.

Identity-provider security events and SQ Hub business/admin audit events may live in different stores, but correlation should be possible where operationally relevant.

## HCIS migration security
HCIS authentication migration follows ADR-0005 and `docs/migration/hcis-auth-cutover-plan.md`.

Required constraints:
- preserve HCIS local authorization principal IDs;
- map Keycloak using unique `issuer + sub`;
- do not migrate legacy HCIS password hashes, MFA secrets, recovery codes, or sessions;
- no production dual-login period;
- no automatic fallback from OIDC to local auth;
- legacy credential material may remain for maximum 14 days only as explicit rollback material, then must be irreversibly removed after accepted cutover.

## Environment isolation
Development/staging and production are logically separate even when hosted on the same VPS. AI agents must not receive unrestricted production database or Keycloak-admin write access.

## Data handling
- Use synthetic data in development and AI workflows.
- Minimize collection and exposure of identifiers.
- NIK must not be used as a login username.

## Production readiness blockers
The following must be resolved before production launch/cutover:
- tested and pinned Keycloak production configuration;
- authentication policy implemented as accepted;
- HCIS authentication migration/cutover rehearsed;
- Application Access available for HCIS users;
- backup and restore procedure tested;
- security-sensitive flows tested (login, SSO, logout, disable, recovery, MFA, privileged access);
- privileged access and recovery path documented;
- audit behavior verified;
- secret injection/rotation mechanism documented;
- SQ Identity theme verified against the pinned Keycloak version.
