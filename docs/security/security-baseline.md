# SQ Hub Security Baseline

**Status:** DRAFT

## Principles
- Least privilege by default.
- Authentication and authorization are separate concerns.
- No production secrets or personal production data in repository, prompts, fixtures, screenshots, or demos.
- Security-sensitive decisions must be documented rather than inferred by implementation agents.

## Authentication
- Staff authentication is centralized through SQ Identity.
- Domain applications must not receive or store staff passwords.
- MFA policy is required before production cutover; exact scope is TBD.
- Super-admin or equivalent privileged identity requires stronger authentication controls than ordinary staff.

## Sessions
Session lifetime, idle timeout, reauthentication triggers, logout behavior, and recovery must be explicitly specified before production. Applications may maintain their own application session while relying on SQ Identity for SSO.

## Secrets
- Database passwords, signing keys, encryption keys, API tokens, client secrets, and similar material must be supplied through environment/secret management and never committed.
- Do not log credentials or tokens.

## Authorization
- SQ Hub Application Access only grants entry to an application; it does not imply broad permission inside that application.
- Domain applications enforce their own permissions server-side.
- Client-side hiding is not an authorization control.

## Audit
Security-sensitive administrative actions must create audit records with minimum actor, action, target, timestamp, and outcome. Audit records must not contain raw passwords, authentication tokens, or unnecessary sensitive payloads.

## Environment isolation
Development/staging and production are logically separate even when hosted on the same VPS. AI agents must not be given unrestricted production database write access.

## Data handling
- Use synthetic data in development and AI workflows.
- Minimize collection and exposure of identifiers.
- NIK must not be used as a login username.

## Production readiness blockers
The following must be resolved before production launch:
- Identity Provider selected and hardened;
- MFA policy accepted;
- session policy accepted;
- backup and restore procedure tested;
- security-sensitive flows tested;
- privileged access and recovery path documented;
- audit behavior verified;
- secret injection/rotation mechanism documented.
