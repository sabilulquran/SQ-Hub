# SQ Hub Security Baseline

**Status:** DRAFT

## Principles
- Least privilege by default.
- Authentication and authorization are separate concerns.
- No production secrets or personal production data in repository, prompts, fixtures, screenshots, or demos.
- Security-sensitive decisions must be documented rather than inferred by implementation agents.
- Identity protocol/security internals are delegated to a mature self-hosted provider rather than reimplemented in SQ Hub.

## Authentication
- Staff authentication is centralized through SQ Identity.
- SQ Identity uses Keycloak according to ADR-0003.
- Domain applications must not receive or store staff passwords.
- Domain applications integrate to SQ Identity through standard OIDC/OAuth2 behavior; do not invent custom token exchange/login protocols without a superseding ADR.
- MFA policy is required before production cutover; exact scope is TBD.
- Super-admin or equivalent privileged identity requires stronger authentication controls than ordinary staff.
- Keycloak fine-grained Authorization Services are not the canonical domain-permission engine; Application Access stays with SQ Hub and domain permissions stay with each application.

## Keycloak production baseline
Before production use:
- pin an explicitly tested Keycloak version/container image;
- never deploy `latest` as the production version selector;
- configure HTTPS/reverse-proxy/hostname settings according to the supported production guide;
- set explicit CPU/memory constraints and validate the actual VPS capacity;
- isolate staging and production realm/data/configuration so test accounts/config do not mutate production;
- keep admin/service credentials outside source control and grant only required Admin API permissions;
- document and test database/configuration backup and restore;
- test provider upgrade and rollback before production upgrades;
- maintain an emergency privileged-access/recovery procedure that does not depend on a normal domain application being healthy;
- verify the SQ-branded login theme after each provider upgrade before rollout.

## Sessions
Session lifetime, idle timeout, reauthentication triggers, logout behavior, and recovery must be explicitly specified before production. Applications may maintain their own application session while relying on SQ Identity/Keycloak for SSO.

Do not solve SSO by sharing one broad application cookie across all `*.sabilulquran.or.id` subdomains. Use the centralized IdP redirect/session model so each application can maintain an appropriately scoped session.

## Secrets
- Database passwords, signing keys, encryption keys, API tokens, OIDC client secrets, Keycloak admin/service credentials, and similar material must be supplied through environment/secret management and never committed.
- Do not log credentials, authorization codes, access tokens, refresh tokens, session cookies, or client secrets.

## Authorization
- SQ Hub Application Access only grants entry to an application; it does not imply broad permission inside that application.
- Domain applications enforce their own permissions server-side.
- Client-side hiding is not an authorization control.
- Token claims may contain derived access information for performance/integration, but they must not silently become a competing source of truth to SQ Hub Application Access.

## Audit
Security-sensitive administrative actions must create audit records with minimum actor, action, target, timestamp, and outcome. Audit records must not contain raw passwords, authentication tokens, or unnecessary sensitive payloads.

Identity-provider security events and SQ Hub business/admin audit events may live in different stores, but correlation should be possible where operationally relevant.

## Environment isolation
Development/staging and production are logically separate even when hosted on the same VPS. AI agents must not be given unrestricted production database or Keycloak-admin write access.

## Data handling
- Use synthetic data in development and AI workflows.
- Minimize collection and exposure of identifiers.
- NIK must not be used as a login username.

## Production readiness blockers
The following must be resolved before production launch/cutover:
- tested and pinned Keycloak production configuration;
- MFA policy accepted;
- session policy accepted;
- login identifier/fallback policy accepted;
- HCIS authentication migration/cutover plan accepted and rehearsed;
- backup and restore procedure tested;
- security-sensitive flows tested (login, SSO, logout, disable, recovery, MFA, privileged access);
- privileged access and recovery path documented;
- audit behavior verified;
- secret injection/rotation mechanism documented;
- SQ Identity theme verified against the selected Keycloak version.
