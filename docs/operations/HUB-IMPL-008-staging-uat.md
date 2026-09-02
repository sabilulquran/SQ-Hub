# HUB-IMPL-008 staging UAT

**Scope:** SQ Identity visual parity on `sq-staff-staging` only.

Use only synthetic staging identities. Do not capture passwords, TOTP values, recovery codes, cookies, tokens, raw OIDC subjects, or client secrets in evidence.

## Required checks

1. Desktop (about 1440x900): login shows the HCIS-derived 56/44 composition, SQ Identity wording, Yayasan Sabilul Qur'an brand panel, UTSMAN values, warm authentication surface, and no unexplained top/side whitespace.
2. Mobile (about 390x844): compact brand header, readable form, full-width controls, no horizontal overflow.
3. Invalid credential: branded error remains readable and form controls still work.
4. OTP/TOTP: standard Keycloak OTP challenge remains usable and `Coba Cara Lain` remains available when configured.
5. Recovery authentication: recovery-code form remains usable. Do not capture the entered code.
6. Recovery-code setup: generated codes are visually separated; entries must not collide or concatenate across columns. Do not capture or retain the generated codes in screenshots/evidence.
7. Required action: password/profile/TOTP setup surface keeps usable controls and focus states when intentionally triggered.
8. Logout confirmation and signed-out return remain standard Keycloak behavior with SQ branding.
9. Returning browser/cache check: the new content-derived stylesheet is requested and the previous visual is not retained.
10. Production remains untouched.

## Sanitized evidence

Record only pass/fail markers and non-sensitive screenshots. Suitable markers:

- `IDENTITY_DESKTOP_PARITY_PASS`
- `IDENTITY_MOBILE_PARITY_PASS`
- `IDENTITY_AUTH_SURFACES_PASS`
- `IDENTITY_RECOVERY_LAYOUT_PASS`
- `IDENTITY_CACHE_VERSION_PASS`
- `IDENTITY_STAGING_ONLY_PASS`
