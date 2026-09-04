# HUB-IMPL-010 — Akun SQ and SQ Hub interface polish

**Status:** ACCEPTED  
**Product:** SQ Hub + shared Staff authentication surface  
**Area:** Product naming / visual design / interaction polish  
**Delivery:** Before Go 5C  
**Depends on:** `HUB-IMPL-005`, `HUB-IMPL-007`, `HUB-IMPL-008`, `HUB-IMPL-009`, `docs/design/hcis-baseline.md`, `docs/design/sq-identity-theme.md`, `docs/security/staff-authentication-policy.md`

## Outcome

Polish the staging SQ Hub workspace, SQ Admin Center, and shared Staff authentication experience into one coherent SQ product family before Go 5C provisioning/offboarding work begins.

The user-facing name of the shared Staff authentication surface becomes **Akun SQ**. This is a presentation/product-language change only: Keycloak remains the IdP engine and the existing OIDC issuer, realm key, client IDs, technical identity keys, authentication flows, MFA/recovery behavior, session policy, and authorization ownership remain unchanged.

## Visual acceptance correction — 2026-09-03

The first HUB-IMPL-010 staging visual was rejected because Akun SQ and SQ Hub still looked like different design products from the approved HCIS experience. This correction is authoritative for visual implementation and supersedes earlier wording that could be interpreted as permission to create a looser, merely HCIS-inspired variant.

Frozen visual source: `imadjinasi/hcisysq@a1117ce0899d97824955feadf72c5b68d6e9f9e5`, especially:
- `apps/web/src/layouts/AuthLayout.tsx`;
- `apps/web/src/components/hcis/HcisBrandPanel.tsx`;
- `apps/web/src/components/hcis/LoginForm.tsx`;
- `apps/web/src/layouts/AppShell.tsx`.

Acceptance is intentionally simple: **at a glance, Akun SQ, SQ Hub, and SQ Admin Center must read as one visual family with HCIS, not as products that merely share a color palette.** Business navigation and capabilities remain product-specific; shared structure, proportions, typography hierarchy, surfaces, icon treatment, radius/shadow rhythm, and responsive shell follow the frozen HCIS baseline closely.

The final Akun SQ correction accepted after comparison with the HCIS reference uses a **3fr / 2fr desktop composition (approximately 60/40)**. This is the current authoritative HUB-IMPL-010 authentication contract. Earlier 56/44 wording records the earlier HCIS-derived target and is not the final Akun SQ acceptance geometry.

## Product naming decision

User-facing authentication wording must use **Akun SQ** instead of **SQ Identity** on login, logout, recovery, required-action, footer, and SQ Hub explanatory copy.

Examples:
- `Masuk ke Akun SQ` / `Selamat datang kembali`;
- `Keluar dari Akun SQ?`;
- `Login dan keamanan akun dikelola melalui Akun SQ.`

Technical implementation names may continue to use established `sq-identity`, `identity-directory`, realm/client identifiers, and architectural terminology where changing them would create migration or protocol risk. The immutable staging realm key remains `sq-staff-staging`; the issuer URL must not change.

## SQ Hub workspace polish

The workspace must use the frozen HCIS AppShell visual structure rather than a separate dashboard/landing-page composition.

Required direction:
- desktop sidebar follows the HCIS `w-72`-class proportion and spacing rhythm;
- logo/product lockup, navigation icon tiles, selected pale-turquoise state, sticky header, account card, centered max-width content, and mobile bottom navigation follow the frozen HCIS AppShell language closely;
- `Aplikasi Saya` is page content inside that shell, not a separate dashboard design;
- remove the giant turquoise greeting/hero treatment when no equivalent exists in the HCIS AppShell baseline;
- application cards use the same warm surface, restrained shadow, radius, typography, and icon-tile language as HCIS;
- replace `SQ Identity` explanatory language with `Akun SQ`;
- preserve responsive mobile navigation and accessible focus treatment;
- no new application/business capability is introduced by this visual pass.

## SQ Admin Center polish

The Admin Center must use the same HCIS-derived SQ Hub shell and must not read as a third product, while preserving all existing Go 5A/Go 5B behavior and authorization boundaries.

Required direction:
- use the same desktop sidebar proportions, navigation icon-tile treatment, sticky header, account surface, typography/radius/shadow rhythm, and responsive language as the workspace;
- avoid duplicated `Administrasi SQ` page-title treatment;
- keep the existing three Go 5B areas: `Aplikasi`, `Akses Aplikasi`, `Audit Platform`;
- keep application key immutable during edit;
- keep human-readable Indonesian validation and canonical URL helper text;
- keep mandatory access-change reason and revoke confirmation;
- keep Audit Platform sanitized and readable;
- raw OIDC subjects, tokens, credentials, TOTP values, recovery codes, and client secrets remain excluded from rendered administrative evidence.

## Akun SQ authentication polish

The Keycloak `sq-hub` login theme remains based on `keycloak.v2` and must reproduce the accepted HCIS composition closely while preserving native Keycloak authentication surfaces.

Required direction:
- retain the final accepted **3fr / 2fr desktop authentication composition (approximately 60/40)** and compact mobile header;
- use the HCIS slate right panel and centered constrained white authentication card;
- restore a proper Sabilul Qur'an organizational lockup at the upper-left of the turquoise panel using the approved HCIS logo assets; do not let a giant `Akun SQ` wordmark replace organizational branding;
- keep `Akun SQ` as the application-neutral authentication product headline and use application-neutral Sabilul Qur'an digital-service copy;
- render the six UTSMAN values as a 3×2 card grid on desktop;
- match the accepted HCIS typography hierarchy, spacing, form width, input/password controls, button treatment, radius, shadow, and footer rhythm;
- normal desktop login must not create a white page tail or unnecessary document height when the content fits the viewport;
- longer recovery/required-action/error states remain allowed to scroll; do not globally hide vertical overflow to force a viewport fit;
- mobile must remain compact and must not introduce horizontal overflow;
- preserve login, invalid credentials, OTP/TOTP, Try Another Way, recovery authentication/setup, required actions, errors, and logout surfaces;
- do not add fake Google sign-in or fake password-recovery capability when the IdP is not configured for it;
- load one active content-versioned HCIS-fidelity composition stylesheet. Historical stylesheets may remain in the repository for traceability, but retired conflicting visual overlays must not be loaded by the theme;
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
- changing Application Registry/Application Access data models.

## Verification and acceptance

Before staging deployment:
1. Hub API/web and Keycloak CI remain green; existing authorization/security tests are not weakened;
2. desktop and mobile visual smoke covers SQ Hub workspace and Admin Center;
3. Keycloak login, invalid credential, OTP/TOTP, recovery, required action, and logout surfaces remain functional;
4. rendered authentication UI contains `Akun SQ` and no longer presents `SQ Identity` as the user-facing product name;
5. the active Keycloak composition stylesheet and logo helper use content-versioned asset names, and retired conflicting overlays are absent from rendered login HTML;
6. repository contracts lock the 3fr / 2fr composition, exact approved HCIS logo blobs, native Keycloak form/action boundary, normal desktop no-scroll behavior at 1440x900 plus a shorter desktop viewport, mobile no-horizontal-overflow behavior, and long-state scrollability;
7. Admin Center predictable invalid form input remains human-readable without exposing backend internals;
8. screenshots/evidence use only synthetic staging data and contain no passwords, TOTP values, recovery codes, cookies, tokens, secrets, or raw OIDC subjects;
9. production remains untouched.

## Staging UAT

A focused UAT after CI must check:
- SQ Hub desktop/mobile shell fidelity, spacing, application cards, and account copy;
- Admin Center shell fidelity, application form, Staff/access panel, audit readability, and authorization behavior;
- Akun SQ desktop/mobile login plus invalid credential, TOTP/alternate method, recovery layout, required action when intentionally triggered, logout confirmation, and returning-browser cache refresh;
- normal desktop login at 1440x900 and one shorter desktop viewport has no unnecessary vertical scroll when content fits, while intentionally long auth states remain scrollable;
- visual acceptance remains a user decision; CI/runtime health alone does not declare visual acceptance;
- Platform Administrator is revoked again after any privileged synthetic UAT.

## Implementation follow-up

Implementation is authorized by this accepted specification and must be delivered in a focused implementation PR before Go 5C. Production deployment is explicitly excluded.
