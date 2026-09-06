# HUB-IMPL-010 staging UAT

**Scope:** SQ Hub, Administrasi SQ, and Akun SQ polish on staging only.

See [2026-09-06 readiness evidence](HUB-IMPL-003-production-readiness-2026-09-06.md)
for the current functional/authentication status. Remaining recovery/alternate
method UAT is not marked PASS by verifier CI. Issue #17's genuine long-state
visual evidence remains a separate UX follow-up, not a production cutover hard
gate; the visual acceptance requirement itself is not weakened.

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

11. Desktop around 1440x900: Akun SQ uses the accepted **3fr / 2fr (approximately 60/40)** composition with HCIS teal brand panel, HCIS slate right panel, and centered constrained white auth card.
12. At 1440x900, normal login content that fits must not produce unnecessary vertical scroll, white page tail, or avoidable extra document height.
13. Repeat the normal-login scroll check at one shorter desktop viewport (recommended 1280x720). If the normal login content fits, unnecessary vertical scrolling is a failure.
14. Intentionally long recovery/required-action/error content must remain scrollable. Do not accept a fix that globally hides vertical overflow or clips legitimate auth content.
15. Mobile around 390x844: compact brand header, full-width form controls, and no horizontal overflow.
16. Login, invalid credential, TOTP/alternate method, recovery authentication, recovery setup, required action when intentionally triggered, error, and logout confirmation retain standard Keycloak behavior.
17. UTSMAN values remain visible as supporting brand material on desktop without dominating the authentication task.
18. Recovery-code layout remains separated/non-colliding. Do not capture generated or entered recovery codes.
19. Exact Sabilul Qur'an organizational logo is rendered from the approved `logo.png` / `logo-white.png` theme assets; no synthetic CSS mark/placeholder is visible.
20. Returning-browser/cache check loads the accepted `sq-account-hcis-<hash>.css` composition and versioned `hcis-logo-assets-<hash>.css` helper, and does not load retired conflicting Akun SQ/SQ Identity overlays.
21. User-facing wording remains **Akun SQ** while OIDC issuer, realm key (`sq-staff-staging`), client IDs, and native Keycloak auth semantics remain unchanged.
22. Production remains untouched.

## Sanitized evidence markers

- `HUB_POLISH_DESKTOP_PASS`
- `HUB_POLISH_MOBILE_PASS`
- `ADMIN_POLISH_VALIDATION_PASS`
- `ADMIN_POLISH_BOUNDARY_PASS`
- `AKUN_SQ_NAMING_PASS`
- `AKUN_SQ_DESKTOP_PASS`
- `AKUN_SQ_DESKTOP_SCROLL_PASS`
- `AKUN_SQ_SHORT_DESKTOP_SCROLL_PASS`
- `AKUN_SQ_LONG_STATE_SCROLL_PASS`
- `AKUN_SQ_MOBILE_PASS`
- `AKUN_SQ_AUTH_SURFACES_PASS`
- `AKUN_SQ_EXACT_LOGO_PASS`
- `AKUN_SQ_CACHE_VERSION_PASS`
- `HUB_IMPL_010_STAGING_ONLY_PASS`

These markers are for future runtime evidence only. Repository CI/source checks do **not** by themselves mark HUB-IMPL-010 visual UAT as passed.
