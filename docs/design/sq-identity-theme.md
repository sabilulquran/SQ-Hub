# Akun SQ Theme

**Status:** ACCEPTED IMPLEMENTATION PROFILE  
**Specification:** `HUB-IMPL-001`, refined by `HUB-IMPL-008` and `HUB-IMPL-010`  
**Visual baseline:** `docs/design/hcis-baseline.md`  
**Runtime target:** Keycloak 26.7.2 / `sq-staff-staging`

## Purpose

**Akun SQ** is the user-facing shared authentication surface for Sabilul Qur'an applications. Keycloak remains the IdP engine and the established technical identity implementation. Its visual language follows the accepted HCIS/SQ design baseline without becoming HCIS-specific.

The login host must feel like part of the same product family whether the user arrives from HCIS, SQ Hub, SPMB, Finance, or a future internal application.

## Naming boundary

User-facing authentication copy uses **Akun SQ**. Existing technical identifiers such as `sq-identity`, `identity-directory`, realm/client identifiers, and architectural references may remain where renaming them would create migration or protocol risk.

The immutable realm key remains `sq-staff-staging`; changing the visible product name must not change the OIDC issuer.

## Implementation profile

The `sq-hub` Keycloak login theme:

- extends Keycloak `keycloak.v2` rather than copying a full Keycloak page template;
- loads the parent PatternFly stylesheet followed by one active content-versioned Akun SQ HCIS-fidelity composition stylesheet and a content-versioned exact-logo helper;
- keeps retired visual overlays in source only for traceability and does not load them simultaneously with the accepted composition;
- keeps the shared Keycloak page structure so login, error, OTP/MFA, recovery, password/update-profile required actions, and logout confirmation inherit one visual system;
- overrides only the small `footer.ftl` extension point for shared brand/account/footer content;
- uses Keycloak's native `favicons.*` theme property rather than patching `<head>` markup;
- disables automatic dark-mode theming for this initial brand profile because the accepted HCIS authentication baseline is a controlled warm-light surface;
- uses Indonesian as the only enabled Wave 1 login locale so browser `Accept-Language` preferences cannot silently override the intended Indonesian-first employee experience;
- keeps an English message bundle in the repository as a future/fallback translation asset, but English is not exposed as a selectable Wave 1 realm locale;
- bundles no font files. `LT Museum` and `Inter` remain preferred family names with system fallbacks according to the accepted licensing/distribution guardrail.

Avoid overriding Keycloak's shared `template.ftl` or native form templates unless a later requirement cannot be achieved through theme properties, CSS, messages, and supported extension points. A template override increases upgrade coupling and must be reviewed against the exact pinned Keycloak release.

## Cache-safe theme assets

Keycloak serves theme static resources with long browser cache lifetimes. A deployment must not replace a long-lived custom stylesheet while keeping the same resource URL.

The accepted Akun SQ composition uses a content-derived filename in the `css/sq-account-hcis-<hash>.css` family. The exact-logo helper uses the same content-versioned principle in the `css/hcis-logo-assets-<hash>.css` family. `theme.properties` declares a `contentHashPattern` covering both custom asset families. When either active custom stylesheet changes, its filename must change as part of the same reviewed change.

Historical theme stylesheets may remain in source control for traceability, but obsolete visual overlays must not remain active simultaneously when they conflict with the current composition.

Do not solve theme rollout by disabling production static caching globally. Cache invalidation belongs in versioned resource identity.

## Visual composition

Large screens use the final accepted HUB-IMPL-010 authentication composition:

- **3fr / 2fr split (approximately 60/40)**;
- left SQ brand panel using the accepted HCIS teal treatment and supporting grid/pattern rhythm;
- HCIS slate right panel;
- centered constrained white authentication card with the accepted radius/shadow rhythm;
- HCIS typography hierarchy and compact form spacing;
- SQ turquoise focus/primary-action states rather than generic Keycloak blue;
- UTSMAN values remain supporting brand material and must not compete with the primary authentication task;
- at normal desktop login states, the document must not become taller than the viewport merely because of theme min-height/padding composition;
- genuinely taller recovery, required-action, error, or other authentication states remain allowed to scroll; vertical overflow must not be globally hidden to conceal layout defects.

Tablet/mobile collapses to a compact brand header above the authentication surface. Authentication controls remain full width, retain visible keyboard focus, and must not introduce horizontal overflow.

The earlier approximately 56/44 wording remains a historical description of the earlier HCIS-derived target. PR #38's accepted correction established the current Akun SQ contract above; current implementation and UAT must use 3fr / 2fr.

## Brand assets

The approved organizational lockup is sourced from the exact HCIS assets copied into the theme as:

- `resources/img/logo.png`;
- `resources/img/logo-white.png`.

The rendered footer/brand extension references these real assets directly. Their expected Git blob identities are locked by CI so a synthetic CSS mark, placeholder wordmark, or silently replaced binary cannot reappear.

`resources/img/favicon.svg` remains the approved Akun SQ browser-tab mark through Keycloak's supported favicon theme property.

Historical `ysq-mark.svg` may remain in source for traceability, but it is not the accepted rendered organizational lockup for the final HUB-IMPL-010 composition.

Do not add or redistribute HCIS font files through this theme.

## Product wording

The authentication surface says **Akun SQ**, not Human Capital Information System, SQ Hub, or SQ Identity as the visible product name. Domain-application wording belongs in the calling application.

Baseline Indonesian copy includes:

- `Selamat datang kembali` for the main login heading;
- `NIP atau email` for the Staff identifier;
- Akun SQ-specific security, recovery, profile-completion, and logout wording;
- an application-neutral footer explaining that Akun SQ handles sign-in/security while granted application authority still applies.

## Favicon and page identity

The Keycloak theme declares `img/favicon.svg` through the supported `favicons.*` theme property. Login title/message bundles use `Akun SQ`, so browser tabs and authentication pages do not expose generic Keycloak branding or the retired SQ Identity label as the primary product identity.

## Staging realm presentation

The immutable realm key and issuer remain `sq-staff-staging`. Realm display metadata may use Akun SQ-oriented presentation language, but those presentation settings must never be implemented by renaming the realm key.

The Indonesian-only Wave 1 setting remains intentional. If English or another locale becomes a real product requirement later, re-enable it deliberately and define the desired locale-selection policy before rollout.

An existing Keycloak realm is not assumed to be overwritten merely because import JSON changes. Staging deployment must explicitly verify/apply any non-secret display/locale setting through the approved Keycloak administration path.

## Verification

Repository CI must prove that:

1. the optimized Keycloak image builds and becomes ready;
2. the realm still imports with the accepted security/session/client baseline;
3. an HCIS authorization request renders HTTP 200 using the `sq-hub` theme;
4. a request advertising English in `Accept-Language` still renders the Indonesian Wave 1 login copy;
5. rendered HTML contains `Akun SQ`, the accepted cache-versioned composition stylesheet, exact-logo helper, and custom favicon resource;
6. rendered HTML does not load retired conflicting Akun SQ/SQ Identity overlays;
7. exact `logo.png` and `logo-white.png` blobs and direct rendered references remain locked;
8. the theme still inherits Keycloak-native form/action semantics and does not fork login/MFA/recovery protocol templates;
9. normal login has no unnecessary vertical scroll at 1440x900 and at one shorter desktop viewport, mobile has no horizontal layout overflow, and an intentionally long auth state remains scrollable;
10. no client secrets or production identity data are committed.

After CI, staging browser UAT must still visually inspect at minimum:

- normal login at 1440x900 and one shorter desktop viewport;
- mobile around 390x844;
- a returning browser that previously cached old theme stylesheets;
- invalid-credential/error state;
- OTP/TOTP and Try Another Way;
- recovery authentication and recovery setup;
- required password/profile action when intentionally triggered;
- logout confirmation and signed-out return behavior.

Automated source/layout checks do not constitute human visual UAT acceptance.

The redundant second Keycloak logout confirmation observed during earlier HCIS UAT is a separate RP-initiated logout integration finding. This theme should make that page branded, but removing an IdP confirmation must be solved through the approved logout protocol/client flow rather than hiding or bypassing the security step with CSS.
