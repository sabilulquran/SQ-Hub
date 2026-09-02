# HUB-IMPL-010 — Akun SQ and SQ Hub interface polish

**Status:** ACCEPTED  
**Product:** SQ Hub + shared Staff authentication surface  
**Area:** Product naming / visual design / interaction polish  
**Delivery:** Before Go 5C  
**Depends on:** `HUB-IMPL-005`, `HUB-IMPL-007`, `HUB-IMPL-008`, `HUB-IMPL-009`, `docs/design/hcis-baseline.md`, `docs/design/sq-identity-theme.md`, `docs/security/staff-authentication-policy.md`

## Outcome

Polish the staging SQ Hub workspace, SQ Admin Center, and shared Staff authentication experience into one coherent SQ product family before Go 5C provisioning/offboarding work begins.

The user-facing name of the shared Staff authentication surface becomes **Akun SQ**. This is a presentation/product-language change only: Keycloak remains the IdP engine and the existing OIDC issuer, realm key, client IDs, technical identity keys, authentication flows, MFA/recovery behavior, session policy, and authorization ownership remain unchanged.

## Product naming decision

User-facing authentication wording must use **Akun SQ** instead of **SQ Identity** on login, logout, recovery, required-action, footer, and SQ Hub explanatory copy.

Examples:
- `Masuk ke Akun SQ` / `Selamat datang kembali`;
- `Keluar dari Akun SQ?`;
- `Login dan keamanan akun dikelola melalui Akun SQ.`

Technical implementation names may continue to use established `sq-identity`, `identity-directory`, realm/client identifiers, and architectural terminology where changing them would create migration or protocol risk. The immutable staging realm key remains `sq-staff-staging`; the issuer URL must not change.

## SQ Hub workspace polish

The workspace must retain the accepted HCIS-derived shell semantics while reducing visual noise and dashboard-template duplication.

Required direction:
- reduce desktop sidebar width and excessive whitespace while preserving clear navigation hierarchy;
- keep one strong page title hierarchy rather than repeating the same page title in both header and hero;
- reduce oversized hero/card radius and shadow intensity to a calmer application surface;
- keep the turquoise SQ brand treatment but use warm neutral surfaces for most content;
- tighten application-grid spacing and empty states;
- replace `SQ Identity` explanatory language with `Akun SQ`;
- preserve responsive mobile navigation and accessible focus treatment;
- no new application/business capability is introduced by this visual pass.

## SQ Admin Center polish

The Admin Center must become denser, easier to scan, and more operationally legible without weakening authorization boundaries.

Required direction:
- avoid duplicated `Administrasi SQ` page-title treatment;
- compact tabs, cards, forms, and spacing while keeping the existing three Go 5B areas: `Aplikasi`, `Akses Aplikasi`, `Audit Platform`;
- keep application key visibly immutable during edit;
- present form validation in human-readable Indonesian instead of raw backend codes such as `INVALID_REQUEST` where a safe local explanation is possible;
- provide clear helper text for canonical URL format;
- make Staff lookup/result, MFA readiness, access status, and grant/revoke actions easier to scan;
- keep mandatory access-change reason and revoke confirmation;
- keep Audit Platform sanitized and readable as an administrative event log;
- raw OIDC subjects, tokens, credentials, TOTP values, recovery codes, and client secrets remain excluded from rendered administrative evidence.

## Akun SQ authentication polish

The Keycloak `sq-hub` login theme remains based on `keycloak.v2` and the HCIS/SQ visual baseline, but the current patch-on-patch appearance must be consolidated into a calmer composition.

Required direction:
- retain the approximately 56/44 desktop authentication composition and compact mobile header;
- use `Akun SQ` as the visible product name everywhere in the theme;
- make the authentication form the primary focus; brand ornamentation and UTSMAN values are supporting material, not competing primary cards;
- simplify the UTSMAN treatment so it remains recognizable without visually dominating the brand panel;
- normalize spacing, radii, focus states, alerts, OTP choices, recovery-code layout, required actions, and logout confirmation;
- preserve the approved YSQ mark, SQ palette, Indonesian-first presentation, and favicon behavior;
- replace stacked legacy visual overlay usage with one new content-versioned polish stylesheet loaded last; existing historical stylesheets may remain in the repository but must not both remain active if they produce conflicting presentation;
- no custom credential/MFA/recovery protocol and no broad Keycloak template fork.

## Security and protocol invariants

This specification must not change:
- OIDC issuer or realm key;
- technical identity mapping by exact `issuer + sub`;
- server-side Hub session model;
- MFA/recovery policy;
- Application Access semantics;
- Platform Administrator semantics or fresh-session/revocation rules;
- Keycloak directory-client privilege boundary;
- domain authorization ownership;
- production runtime.

Browser code must continue to avoid access/refresh tokens in local/session storage. Authentication and admin API failures remain fail-closed.

## Non-goals

- Go 5C Staff provisioning, password-reset operations, identity disable/enable, or offboarding;
- changing realm/client identity, issuer hostname, credential policy, MFA policy, or session lifetimes;
- production cutover;
- redesigning HCIS business screens;
- introducing a standalone design-system package without a second concrete consumer need;
- changing Application Registry/Application Access data models.

## Verification and acceptance

Before staging deployment:
1. Hub API/web and Keycloak CI remain green; existing authorization/security tests are not weakened;
2. desktop and mobile visual smoke covers SQ Hub workspace and Admin Center;
3. Keycloak login, invalid credential, OTP/TOTP, recovery, required action, and logout surfaces remain functional;
4. rendered authentication UI contains `Akun SQ` and no longer presents `SQ Identity` as the user-facing product name;
5. the new Keycloak polish stylesheet uses a new content-versioned asset name and returning-browser cache behavior is verified;
6. Admin Center local validation converts predictable invalid form input into human-readable Indonesian without exposing backend internals;
7. screenshots/evidence use only synthetic staging data and contain no passwords, TOTP values, recovery codes, cookies, tokens, secrets, or raw OIDC subjects;
8. production remains untouched.

## Staging UAT

A focused UAT after CI must check:
- SQ Hub desktop/mobile hierarchy, spacing, application cards, and account copy;
- Admin Center application form, Staff/access panel, audit readability, and authorization behavior;
- Akun SQ desktop/mobile login plus invalid credential, TOTP/alternate method, recovery layout, required action when intentionally triggered, logout confirmation, and returning-browser cache refresh;
- Platform Administrator is revoked again after any privileged synthetic UAT.

## Implementation follow-up

Implementation is authorized by this accepted specification and must be delivered in a focused implementation PR before Go 5C. Production deployment is explicitly excluded.