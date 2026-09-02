# HUB-IMPL-010 staging UAT

**Scope:** SQ Hub, Administrasi SQ, and Akun SQ polish on staging only.

Use only synthetic staging identities. Do not capture or paste passwords, cookies, access/refresh tokens, raw OIDC subjects, client secrets, TOTP values, recovery codes, or other credential material in evidence.

## SQ Hub

1. Desktop: sidebar and workspace hierarchy are compact and readable; the page does not repeat oversized titles and application cards remain easy to scan.
2. Mobile around 390x844: brand header and bottom navigation remain usable with no horizontal overflow.
3. User-facing authentication copy says **Akun SQ** and does not present **SQ Identity** as the product name.
4. Ordinary Staff still sees only applications granted by Application Access.

## Administrasi SQ

5. Fresh current Platform Administrator session can open Administrasi SQ; ordinary Staff still cannot discover/use the protected route.
6. `Aplikasi`, `Akses Aplikasi`, and `Audit Platform` remain available and visually denser without changing authorization semantics.
7. Application Registry form explains the canonical URL format. Entering a hostname without a URL scheme produces a human-readable Indonesian validation message rather than `INVALID_REQUEST`.
8. Existing application key is visibly immutable while editing.
9. Staff lookup, MFA readiness, access state, reason field, grant/revoke controls, and audit rows remain readable; no raw OIDC subject or credential material is rendered.
10. Revoking temporary Platform Administrator privilege immediately removes the admin surface while the ordinary Hub session may remain available.

## Akun SQ

11. Desktop around 1440x900: Akun SQ retains the accepted approximately 56/44 composition with a calmer brand panel and the form as the primary focus.
12. Mobile around 390x844: compact brand header, full-width form controls, and no horizontal overflow.
13. Login, invalid credential, TOTP/alternate method, recovery authentication, required action when intentionally triggered, and logout confirmation retain standard Keycloak behavior.
14. UTSMAN values remain visible as supporting brand material on desktop without dominating the authentication task.
15. Recovery-code layout remains separated/non-colliding. Do not capture generated or entered recovery codes.
16. Returning-browser/cache check loads the new `sq-account-*.css` resource and does not load the retired `sq-identity-615a8687ea40.css` overlay.
17. OIDC issuer/realm key and application behavior remain unchanged.
18. Production remains untouched.

## Sanitized evidence markers

- `HUB_POLISH_DESKTOP_PASS`
- `HUB_POLISH_MOBILE_PASS`
- `ADMIN_POLISH_VALIDATION_PASS`
- `ADMIN_POLISH_BOUNDARY_PASS`
- `AKUN_SQ_NAMING_PASS`
- `AKUN_SQ_DESKTOP_PASS`
- `AKUN_SQ_MOBILE_PASS`
- `AKUN_SQ_AUTH_SURFACES_PASS`
- `AKUN_SQ_CACHE_VERSION_PASS`
- `HUB_IMPL_010_STAGING_ONLY_PASS`
