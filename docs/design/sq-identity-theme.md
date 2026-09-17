# Akun SQ Theme

**Status:** ACCEPTED IMPLEMENTATION PROFILE  
**Specification:** `HUB-IMPL-015`, preserving the functional contracts of `HUB-IMPL-001`, `008`, `010`, `011`, and `012`
**Runtime target:** Keycloak 26.7.2 / `sq-staff-staging`

## Product identity

**Akun SQ** is the only user-facing name for the shared sign-in and account-security experience. Keycloak remains the identity engine. Existing technical identifiers such as realm key `sq-staff-staging`, issuer URLs, client IDs, service names, and network aliases remain stable because they are integration contracts rather than product copy.

The authentication host must look like a focused account system. It must not present an HCIS application shell, SQ Hub workspace, organizational value board, or generic Keycloak branding.

## Login theme

The `sq-hub` login theme extends `keycloak.v2`. It uses Keycloak's native templates for login, errors, reset password, required actions, recovery, logout, and identity brokering. The trusted-device TOTP override remains narrow and preserves the native action URL and field names.

The accepted composition is:

- one centered white account card on a quiet light-gray canvas;
- compact Akun SQ mark and Yayasan Sabilul Qur'an label;
- Google sign-in first, followed by a quiet divider and the NIP/email form;
- direct headings, short supporting text, and full-width controls;
- turquoise primary/focus states, dark navy text, and low-contrast borders;
- no split-screen hero, HCIS panel, pattern grid, or Nilai Utsman content;
- on small screens, a white edge-to-edge surface with comfortable padding;
- normal states fit common desktop/mobile viewports and long states remain scrollable.
- browser autofill retains the same white field surface and readable navy text.

Only `footer.ftl` and the existing trusted-device `login-otp.ftl` are overridden. Shared `template.ftl`, login form, recovery form, and protocol behavior remain owned by the pinned Keycloak release.

## Account Console theme

The Account Console uses the same `sq-hub` theme and extends the supported `keycloak.v3` account theme. It changes presentation through theme properties, messages, logo/favicon assets, and CSS. Keycloak still owns account data, credentials, linked accounts, MFA, and session actions.

The console uses a white masthead, concise navigation, light canvas, rounded bordered content surfaces, turquoise actions, and responsive mobile spacing. A future fully custom React Account Console requires a separate specification only if supported theming cannot satisfy a concrete usability requirement.

## Asset and cache rules

Custom login and account stylesheets use content-derived filenames. `theme.properties` declares matching `contentHashPattern` values. Any CSS content change must change the filename and references in the same PR.

Historical stylesheets may remain for audit history, but `theme.properties` must load only the accepted Akun SQ assets. The active HTML must not load legacy `sq-identity`, HCIS composition, or placeholder overlays.

## Language and accessibility

Wave 1 remains Indonesian-first. Controls retain visible keyboard focus, labels, semantic native form behavior, readable error states, and adequate contrast. English message files may remain as fallback assets but are not enabled as a selectable realm locale.

## Verification

Repository and image smoke checks must prove:

1. login and Account Console theme declarations are valid and use the expected parent themes;
2. login HTML renders `Akun SQ`, the versioned stylesheet, and favicon without active legacy styles;
3. realm issuer/key remains stable and both `loginTheme` and `accountTheme` equal `sq-hub`;
4. native authentication action/form boundaries and trusted-device fields remain intact;
5. normal login has no unnecessary overflow on 1440×900, 1280×720, and 390×844, while long content scrolls;
6. no secret or production identity data is committed.

CI is structural evidence. Staging visual UAT must still inspect login, invalid credentials, password reset, TOTP/trusted device, recovery, logout, personal information, security, sessions, and mobile behavior before production rollout.

Brand assets must reuse the existing official Sabilul Qur'an mark (ysq-mark.svg) and favicon.svg. The generic SQ hexagon from the mockup is a placeholder and is not an approved replacement for the organization logo.
