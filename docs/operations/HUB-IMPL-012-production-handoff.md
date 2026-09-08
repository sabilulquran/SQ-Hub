# HUB-IMPL-012 production handoff

**Scope:** provider deployment and realm-flow activation after reviewed artifacts are merged. This document does not authorize production mutation or rollback.

## Preconditions

1. Verify the merged source SHA, successful provider tests, immutable Keycloak image digest, and the exact Keycloak 26.7.2 runtime.
2. Back up Keycloak and prove the accepted restore path is available.
3. Generate a random key containing at least 32 bytes and store its Base64 value as `SQ_TRUSTED_DEVICE_SIGNING_KEY` in the approved production secret store. Never print or paste it into chat, Git, screenshots, evidence, or shell history.
4. Deploy the reviewed immutable image and inject the signing key before changing the realm flow. A missing key deliberately falls back to requiring TOTP, but activation must not proceed in that state.
5. Preserve SMTP, issuer, clients, Google secret, users, credentials, Application Access, Platform Administrator, and HCIS mappings.

## Controlled activation

Authenticate a short-lived `kcadm` configuration on the production host. Run `infra/keycloak/scripts/reconcile-trusted-device.sh` twice with `KEYCLOAK_REALM=sq-staff`. The script copies a built-in Browser flow before modifying it, binds the copy, disables only the prior `auth-otp-form`, and enables `sq-trusted-device-otp` at the same policy position. If the Google provider exists, it performs the same replacement in its post-broker flow.

Expected sanitized markers include:

```text
TRUSTED_DEVICE_BROWSER_FLOW_PASS
TRUSTED_DEVICE_GOOGLE_POST_FLOW_PASS
TRUSTED_DEVICE_RECONCILE_IDEMPOTENT_PASS
```

`TRUSTED_DEVICE_GOOGLE_POST_FLOW_NOT_CONFIGURED` is not acceptable when Google login is enabled.

## Controlled acceptance

Using synthetic/approved production test identities and separate browser profiles, verify unchecked, wrong OTP, checked+valid OTP, same browser, other browser, expiry, tampering, password reset, TOTP replacement, disabled user, ordinary user policy, privileged user policy, and Google first-factor behavior. Inspect the cookie attributes without recording its value. Confirm no browser storage token exposure and HCIS OIDC/authorization regression is **NO**.

Remove the short-lived admin configuration after acceptance. Signing-key rotation invalidates all trusted devices and is a safe incident response. Rollback remains owner-only.
