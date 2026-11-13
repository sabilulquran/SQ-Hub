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
- Missing, expired, tampered, replayed, wrong-user, wrong-realm, or credential-stale proof requires TOTP. A proof replaced by rotation counts as replayed once its grace window (below) has passed.
- Password or TOTP credential replacement changes the credential fingerprint and invalidates every prior proof.
- Disabled/deleted users cannot pass the authenticator through trusted state.
- The provider is used in the bound browser flow and, when present, the Google post-broker flow so Google remains a first factor rather than an MFA bypass.

## Security model

- Cookie name: `SQ_TRUSTED_DEVICE`.
- Cookie scope: exact realm path; no wildcard domain.
- Attributes: `HttpOnly`, `Secure`, `SameSite=Lax`, maximum age 2,592,000 seconds.
- Payload contains version, expiry, random nonce, opaque user/realm digest, and password+OTP credential fingerprint. It contains no password, OTP secret/value, Keycloak access/refresh/ID token, or Google token.
- The payload is authenticated with HMAC-SHA-256 using a runtime-only random key of at least 256 bits.
- The server retains only a SHA-256 nonce digest plus expiry, credential fingerprint, and the moment the record stops being accepted, in an internal multi-valued user attribute. A proof is rotated after every accepted use. The replaced copy keeps working for a rotation grace of 120 seconds and fails closed after that. A request accepted through that window issues nothing: no further cookie and no further record, so repeated stale copies cannot grow the device list. The grace exists because one sign-in can reach the authenticator more than once - a reload, a retried step, or two applications authenticating at the same moment - and without the grace that second request would silently end a 30-day trust. Records inside their grace window are dropped first when an account passes the device limit, so they never push out a device that is still trusted.
- At most ten active device records are retained per user; expired/stale records are pruned during use.
- The signing key is never committed. Missing/invalid runtime key makes the provider require TOTP and never issue trust.

## Deployment boundary

The repository builds an internally maintained provider into the pinned Keycloak image and includes an idempotent flow reconciliation. Provider image deployment, secret injection, realm-flow mutation, and production acceptance are separate owner-authorized operations. This task performs no production mutation.

## Acceptance

Automated tests prove unchecked/invalid OTP cannot issue, valid checked OTP can issue, same user/browser proof validates and rotates, a second request inside the rotation grace keeps the trust while a copy replayed after the grace fails, records written before the grace window still validate, another browser does not, expiration/tampering/replay fail, credential replacement invalidates, and user/realm mismatch fails. Image build must compile/test the provider and Keycloak must discover its factory. Flow reconciliation must replace the built-in OTP execution in a copied non-built-in browser flow and in the Google post-broker flow when configured.

## Revisions

### Rev 2 - 13 November 2026: rotation grace

Production evidence: between 17 October and 13 November 2026 the `sq.internal.trusted-device.v1` attribute of three
staff accounts accumulated 15 records in total (8 on one account, 3 of them on 13 November alone). A proof that is
used and rotated leaves the record count unchanged, so each extra record marks a trust that was granted and then
lost without the person removing it. Diagnostic logging added the same day confirmed the mechanism itself works: a
presented proof validated with `decision=TRUSTED` and skipped the code step.

The remaining loss path in the design is single use. Any second request carrying the pre-rotation copy - a reload, a
retried step, two applications authenticating at once - was refused, the cookie was deleted, and the person had to
tick the box again. Rev 2 keeps rotation and keeps replay failing closed, but gives the replaced copy a 120-second
grace. The window is bound to the same user, realm, and credential fingerprint as the proof it replaces, so it
widens nothing else. `DRAFT` assumption: 120 seconds, chosen to cover a redirect chain and a retry without leaving a
usable copy around; it needs no owner decision and can be shortened if a shorter window proves enough.

## Non-goals

- changing the set of privileged roles or MFA enrollment policy;
- remembered password, permanent login, IP-only trust, or browser local/session storage;
- custom OAuth/OIDC, Google brokerage, recovery, Application Access, HCIS role mapping, or Platform Administrator behavior;
- arbitrary third-party Keycloak plugins.
