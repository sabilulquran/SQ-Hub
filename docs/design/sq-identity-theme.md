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
- loads the parent PatternFly stylesheet followed by the accepted base SQ stylesheet and one cache-versioned Akun SQ polish stylesheet;
- keeps the shared Keycloak page structure so login, error, OTP/MFA, recovery, password/update-profile required actions, and logout confirmation inherit one visual system;
- overrides only the small `footer.ftl` extension point for shared account/footer copy;
- uses Keycloak's native `favicons.*` theme property rather than patching `<head>` markup;
- disables automatic dark-mode theming for this initial brand profile because the accepted HCIS authentication baseline is a controlled warm-light surface;
- uses Indonesian as the only enabled Wave 1 login locale so browser `Accept-Language` preferences cannot silently override the intended Indonesian-first employee experience;
- keeps an English message bundle in the repository as a future/fallback translation asset, but English is not exposed as a selectable Wave 1 realm locale;
- bundles no font files. `LT Museum` and `Inter` remain preferred family names with system fallbacks according to the accepted licensing/distribution guardrail.

Avoid overriding Keycloak's shared `template.ftl` unless a later requirement cannot be achieved through theme properties, CSS, messages, and supported extension points. A full template override increases upgrade coupling and must be reviewed against the exact pinned Keycloak release.

## Cache-safe theme assets

Keycloak serves theme static resources with long browser cache lifetimes. A deployment must not replace a long-lived stylesheet while keeping the same resource URL.

The active Akun SQ polish stylesheet uses a content-derived filename such as `css/sq-account-41ad9ff20ec3.css`, and `theme.properties` declares a `contentHashPattern` for that asset family. When the active polish stylesheet content changes, its filename must change as part of the same reviewed change.

Historical theme stylesheets may remain in source control for traceability, but obsolete visual overlays must not remain active simultaneously when they conflict with the current composition.

Do not solve theme rollout by disabling production static caching globally. Cache invalidation belongs in versioned resource identity.

## Visual composition

Large screens use the HCIS-derived authentication composition:

- approximately 56/44 split layout;
- left SQ brand panel with primary turquoise/deep turquoise gradient, controlled cyan/yellow accents, and the YSQ mark;
- right warm-light authentication surface with a constrained form width;
- `LT Museum`-first heading treatment and `Inter`-first UI/body treatment;
- rounded but calmer form controls and actions;
- SQ turquoise focus/primary-action states rather than generic Keycloak blue;
- restrained raised surfaces for alerts, OTP choices, recovery-code panels, and required actions;
- UTSMAN values remain supporting brand material and must not compete with the primary authentication task.

Tablet/mobile collapses to a compact brand header above the authentication surface. Authentication controls remain full width and retain visible keyboard focus.

## Brand assets

`resources/img/ysq-mark.svg` wraps the approved YSQ mark source used by the HCIS visual baseline so the Keycloak theme can consume it as a text-managed repository asset without adding a new unofficial logo treatment.

`resources/img/favicon.svg` wraps the exact HCIS favicon artwork from `imadjinasi/hcisysq/apps/web/public/favicon.png`. Akun SQ therefore uses the same recognizable browser-tab mark instead of the generic Keycloak favicon.

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
5. rendered HTML contains `Akun SQ`, the cache-versioned Akun SQ stylesheet, and the custom favicon resource;
6. rendered HTML does not load the retired visual-parity overlay simultaneously with the current Akun SQ polish overlay;
7. no client secrets or production identity data are committed.

After CI, staging browser UAT should visually inspect at minimum:

- normal login, including favicon and mobile layout;
- a returning browser that previously cached the old theme stylesheet;
- invalid-credential/error state;
- OTP/TOTP and recovery-code surfaces;
- required password/profile action when intentionally triggered;
- logout confirmation and signed-out return behavior.

The redundant second Keycloak logout confirmation observed during earlier HCIS UAT is a separate RP-initiated logout integration finding. This theme should make that page branded, but removing an IdP confirmation must be solved through the approved logout protocol/client flow rather than hiding or bypassing the security step with CSS.
