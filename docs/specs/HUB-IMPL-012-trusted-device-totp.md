# HUB-IMPL-012 — Akun SQ trusted device for TOTP

**Status:** ACCEPTED
**Product:** Akun SQ
**Area:** Staff MFA UX / Keycloak authenticator
**Depends on:** ADR-0003, `HUB-IMPL-010`, `HUB-IMPL-011`, `docs/security/staff-authentication-policy.md`, `docs/security/security-baseline.md`

## Outcome

Allow a user who has successfully completed local TOTP to trust that browser for at most 30 days. Normal first-factor and Keycloak session behavior remains authoritative. This capability changes neither who is required to enroll TOTP nor any application/domain authorization.

## Behavior

- The OTP page offers **Percayai perangkat ini selama 30 hari**.
- Unchecked or invalid OTP never creates trusted state.
- Checked state is persisted only after valid TOTP.
- A valid proof skips only the TOTP execution on the same browser and user.
- Missing, expired, tampered, replayed, wrong-user, wrong-realm, or credential-stale proof requires TOTP.
- Password or TOTP credential replacement changes the credential fingerprint and invalidates every prior proof.
- Disabled/deleted users cannot pass the authenticator through trusted state.
- The provider is used in the bound browser flow and, when present, the Google post-broker flow so Google remains a first factor rather than an MFA bypass.

## Security model

- Cookie name: `SQ_TRUSTED_DEVICE`.
- Cookie scope: exact realm path; no wildcard domain.
- Attributes: `HttpOnly`, `Secure`, `SameSite=Lax`, maximum age 2,592,000 seconds.
- Payload contains version, expiry, random nonce, opaque user/realm digest, and password+OTP credential fingerprint. It contains no password, OTP secret/value, Keycloak access/refresh/ID token, or Google token.
- The payload is authenticated with HMAC-SHA-256 using a runtime-only random key of at least 256 bits.
- The server retains only a SHA-256 nonce digest plus expiry and credential fingerprint in an internal multi-valued user attribute. A proof is rotated after every accepted use, making an already-used copy fail closed.
- At most ten active device records are retained per user; expired/stale records are pruned during use.
- The signing key is never committed. Missing/invalid runtime key makes the provider require TOTP and never issue trust.

## Deployment boundary

The repository builds an internally maintained provider into the pinned Keycloak image and includes an idempotent flow reconciliation. Provider image deployment, secret injection, realm-flow mutation, and production acceptance are separate owner-authorized operations. This task performs no production mutation.

## Acceptance

Automated tests prove unchecked/invalid OTP cannot issue, valid checked OTP can issue, same user/browser proof validates and rotates, another browser does not, expiration/tampering/replay fail, credential replacement invalidates, and user/realm mismatch fails. Image build must compile/test the provider and Keycloak must discover its factory. Flow reconciliation must replace the built-in OTP execution in a copied non-built-in browser flow and in the Google post-broker flow when configured.

## Non-goals

- changing the set of privileged roles or MFA enrollment policy;
- remembered password, permanent login, IP-only trust, or browser local/session storage;
- custom OAuth/OIDC, Google brokerage, recovery, Application Access, HCIS role mapping, or Platform Administrator behavior;
- arbitrary third-party Keycloak plugins.
