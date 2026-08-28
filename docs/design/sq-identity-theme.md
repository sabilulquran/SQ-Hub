# SQ Identity Theme

**Status:** ACCEPTED IMPLEMENTATION PROFILE
**Specification:** `HUB-IMPL-001`
**Visual baseline:** `docs/design/hcis-baseline.md`
**Runtime target:** Keycloak 26.7.2 / `sq-staff-staging`

## Purpose

SQ Identity is the shared authentication surface for Sabilul Qur'an applications. Its visual language follows the accepted HCIS/SQ design baseline without becoming HCIS-specific. The login host must feel like part of the same product family whether the user arrives from HCIS, SQ Hub, SPMB, Finance, or a future internal application.

## Implementation profile

The `sq-hub` Keycloak login theme:

- extends Keycloak `keycloak.v2` rather than copying a full Keycloak page template;
- loads the parent PatternFly stylesheet followed by `resources/css/sq-hub.css`;
- keeps the shared Keycloak page structure so login, error, OTP/MFA, recovery, password/update-profile required actions, and logout confirmation inherit one visual system;
- overrides only the small `footer.ftl` extension point for shared SQ Identity footer copy;
- uses Keycloak's native `favicons.*` theme property rather than patching `<head>` markup;
- disables automatic dark-mode theming for this initial brand profile because the accepted HCIS authentication baseline is a controlled warm-light surface;
- supports Indonesian and English, with Indonesian as the staging realm default;
- bundles no font files. `LT Museum` and `Inter` remain preferred family names with system fallbacks according to the accepted licensing/distribution guardrail.

Avoid overriding Keycloak's shared `template.ftl` unless a later requirement cannot be achieved through theme properties, CSS, messages, and supported extension points. A full template override increases upgrade coupling and must be reviewed against the exact pinned Keycloak release.

## Visual composition

Large screens use the HCIS-derived authentication composition:

- approximately 56/44 split layout;
- left SQ brand panel with primary turquoise/deep turquoise gradient, subtle dot field, cyan/yellow accents, and the YSQ mark;
- right warm-light authentication surface with a constrained form width;
- `LT Museum`-first heading treatment and `Inter`-first UI/body treatment;
- rounded form controls and actions;
- SQ turquoise focus/primary-action states rather than generic Keycloak blue;
- restrained raised surfaces for alerts, OTP choices, recovery-code panels, and required actions.

Tablet/mobile collapses to a compact brand header above the authentication surface. Authentication controls remain full width and retain visible keyboard focus.

## Brand assets

`resources/img/ysq-mark.svg` wraps the approved YSQ mark source used by the HCIS visual baseline so the Keycloak theme can consume it as a text-managed repository asset without adding a new unofficial logo treatment.

`resources/img/favicon.svg` wraps the exact HCIS favicon artwork from `imadjinasi/hcisysq/apps/web/public/favicon.png`. SQ Identity therefore uses the same recognizable browser-tab mark instead of the generic Keycloak favicon.

Do not add or redistribute HCIS font files through this theme.

## Product wording

The authentication surface says **SQ Identity**, not Human Capital Information System and not SQ Hub as the global identity product name. Domain-application wording belongs in the calling application.

Baseline Indonesian copy includes:

- `Selamat datang kembali` for the main login heading;
- `NIP atau email` for the Staff identifier;
- SQ Identity-specific security, recovery, profile-completion, and logout wording;
- an application-neutral footer explaining that account authority and granted application access still apply.

## Favicon and page identity

The Keycloak theme declares `img/favicon.svg` through the supported `favicons.*` theme property. The login title/message bundle uses `SQ Identity`, so browser tabs and authentication pages do not expose generic Keycloak branding as the primary product identity.

## Staging realm presentation

The repository baseline names the staging realm display label `SQ Identity Staging`, enables `id` and `en`, and sets `id` as the default locale. These are presentation settings only; the immutable OIDC realm key and issuer remain `sq-staff-staging` and must not be renamed.

An existing Keycloak realm is not assumed to be overwritten merely because the import JSON changed. Staging deployment must explicitly verify/apply the non-secret display/locale settings through the approved Keycloak administration path if the existing realm retains older values.

## Verification

Repository CI must prove that:

1. the optimized Keycloak image builds and becomes ready;
2. the realm still imports with the accepted security/session/client baseline;
3. an HCIS authorization request renders HTTP 200 using the `sq-hub` theme;
4. rendered HTML contains `SQ Identity`, Indonesian login copy, `sq-hub.css`, and the custom favicon resource;
5. no client secrets or production identity data are committed.

After CI, staging browser UAT should visually inspect at minimum:

- normal login, including favicon and mobile layout;
- invalid-credential/error state;
- OTP/TOTP and recovery-code surfaces;
- required password/profile action when intentionally triggered;
- logout confirmation and signed-out return behavior.

The redundant second Keycloak logout confirmation observed during HCIS UAT is a separate RP-initiated logout integration finding. This theme should make that page branded, but removing the extra confirmation must be solved through the approved logout protocol/client flow rather than hiding or bypassing the IdP security step with CSS.
