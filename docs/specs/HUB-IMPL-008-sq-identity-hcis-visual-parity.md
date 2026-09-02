# HUB-IMPL-008 — SQ Identity HCIS visual-parity refinement

**Status:** ACCEPTED  
**Product:** SQ Identity  
**Area:** Login theme / design system  
**Delivery:** Separate from Go 5A  
**Depends on:** ADR-0003, `HUB-IMPL-001`, `docs/design/hcis-baseline.md`, `docs/design/sq-identity-theme.md`

## Outcome

Refine the staging-only SQ Identity login theme so its composition and interaction quality visibly follow the accepted HCIS authentication baseline, while preserving SQ Identity as the shared identity product.

This is a visual-parity refinement. It does not change authentication protocol behavior, identity ownership, realm/client configuration, MFA policy, application access, or production deployment.

## Reference and scope

The immutable visual reference is HCIS `AuthLayout.tsx` at commit `a1117ce0899d97824955feadf72c5b68d6e9f9e5`, recorded in `docs/design/hcis-baseline.md`. The corresponding HCIS styles and approved brand assets are the source for composition and reusable primitives, subject to the existing asset-licensing rules.

The implementation applies to the Keycloak `sq-hub` login theme at `login.sabilulquran.or.id` for the `sq-staff-staging` realm only.

## Required visual direction

The implementation must reuse or faithfully translate the HCIS authentication composition and primitives; merely matching palette values is insufficient.

### Desktop

- Preserve the HCIS-derived approximately 56/44 responsive split.
- The left side is a dedicated branded panel with the approved YSQ/Sabilul Qur'an lockup, HCIS-equivalent spacing, type hierarchy, controlled ornaments, and turquoise/cyan/yellow treatments.
- The brand panel headline is **SQ Identity**. It must not identify the product as HCIS.
- The organization label is **Yayasan Sabilul Qur'an**.
- Use identity-oriented, application-neutral supporting copy. Do not use HR, employee-record, payroll, or other HCIS business wording.
- The supporting brand treatment may present these YSQ working values only: **Uswah Hasanah, Ta'awun, Syaja'ah, Musyawarah, Muhasabah, Amanah**. They are shared brand language, not authorization claims or Keycloak roles.
- The right side remains a warm, clean authentication surface with a constrained form width, HCIS-equivalent cards, controls, focus states, and footer rhythm.

### Mobile

- At approximately 390x844, collapse the composition into the HCIS-equivalent compact brand header above the authentication surface.
- Retain a clear SQ Identity lockup, readable type hierarchy, full-width controls, usable account recovery/OTP choices, and visible keyboard focus.
- Do not introduce horizontal overflow, clipped brand content, or controls that are obscured by the viewport.

## Keycloak boundary

- Retain standard Keycloak authentication, OTP/TOTP, recovery, error, logout, and required-action flows; do not create a custom credential, MFA, or recovery flow.
- Preserve the existing Indonesian Wave 1 locale policy, approved favicon behavior, and the rule that no font files are redistributed.
- Prefer theme properties, messages, supported CSS, and the existing small footer extension.
- A narrow template override may be proposed only if the pinned Keycloak `keycloak.v2` structure cannot faithfully support the required HCIS-derived composition. Such a change must preserve Keycloak form/action semantics, be scoped to the exact pinned Keycloak release, and receive separate review for upgrade coupling.
- Any changed static stylesheet must use a new content-derived filename and update `contentHashPattern` as required by `docs/design/sq-identity-theme.md`.

## Non-goals

- Go 5A Admin Center changes or other SQ Hub workspace changes;
- production theme deployment;
- custom Keycloak login protocol implementation;
- changing realm identity, OIDC issuer, users, passwords, TOTP/recovery material, client secrets, or Keycloak authorization roles;
- copying HCIS business labels, workflows, or domain UI into SQ Identity.

## Verification and acceptance

Before any staging deployment, CI and review must show:

1. login, invalid-credential/error, OTP/TOTP, recovery-code, required-action, and logout surfaces retain functional Keycloak controls;
2. the theme still renders the SQ Identity product name, approved favicon, Indonesian copy, and cache-versioned stylesheet;
3. 1440x900 and 390x844 screenshots demonstrate the required HCIS-derived composition, with no horizontal overflow;
4. the desktop and mobile screenshots are reviewed against the immutable HCIS `AuthLayout` reference for spacing, typography hierarchy, ornaments, cards, and responsive behavior;
5. screenshots and evidence contain only synthetic data and no credentials, tokens, cookies, raw OIDC subjects, MFA material, recovery codes, or client secrets;
6. staging only is touched; production remains untouched.

## Implementation follow-up

Implementation is authorized by this accepted specification and must be made in its own focused change/PR, separate from PR #27, with the cache-safe asset update and visual UAT evidence above.
