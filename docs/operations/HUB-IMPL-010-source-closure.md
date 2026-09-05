# HUB-IMPL-010 Akun SQ source-closure evidence

**Scope:** repository-only closure evidence for Akun SQ identity theme.  
**Base candidate:** `827375f31a6ab2badaf9ee0214f2089ec722a8af`.  
**Runtime/staging visual UAT:** still required; this document does not declare visual acceptance.

## Source audit

The final accepted Akun SQ presentation is the correction introduced by PR #38 and the exact-logo correction from PR #39:

- desktop composition: `3fr / 2fr` (approximately 60/40);
- HCIS slate right panel and centered constrained white authentication card;
- HCIS-derived typography, spacing, radius and shadow rhythm;
- exact HCIS `logo.png` / `logo-white.png` assets from PR #39;
- Keycloak-native authentication markup/flows remain authoritative.

At the base candidate, `theme.properties` still loaded both `sq-account-hcis-d8e0fab49a38.css` and the later `sq-account-hcis-f7a4c91d2e36.css`. The older `d8e0...` layer contains the rejected 56/44 composition and conflicting decorative treatment. The closure branch removes that retired layer from the active stylesheet stack. Historical files remain in source for traceability only.

The final active custom stack is:

1. Keycloak parent `css/styles.css`;
2. `css/sq-account-hcis-5ae1544133ef.css`;
3. `css/hcis-logo-assets-294b82789923.css`.

The logo helper is content-versioned without changing the approved binary assets. Expected Git blob identities remain:

- `logo.png`: `9c738fe89212ec5f107c0dd6fe738bbf42ae94c1`;
- `logo-white.png`: `6c71fddbba785a167b965901d400fd1559a41e50`.

`footer.ftl` references those two real assets directly and contains none of the retired synthetic `sq-brand-lockup__mark` / `sq-brand-lockup__text` placeholder markup.

## Regression contract

The identity parity workflow now protects:

- exact active stylesheet order and absence of retired conflicting overlays;
- final `3fr / 2fr` composition, HCIS slate surface, constrained card, radius and typography markers;
- exact HCIS logo blobs and direct rendered footer references;
- absence of fake logo placeholder classes;
- `Akun SQ` user-facing naming;
- Keycloak-native template boundary: no custom login, OTP, TOTP or recovery protocol templates are introduced;
- normal desktop layout at 1440x900 and 1280x720 has no unnecessary vertical overflow in the representative native-login DOM;
- mobile 390x844 has no horizontal/layout overflow;
- an intentionally long authentication state remains vertically scrollable;
- at 390x844, the exact logo remains in the compact teal header and does not intersect the auth-card title;
- no global `overflow-y: hidden` workaround is accepted.

The browser-layout check is a repository regression smoke, not a screenshot-diff suite and not a substitute for staging visual UAT.

## Issue #17

Issue #17 remains open by design. Source-level evidence now covers the reported failure mode at 1440x900 plus a shorter desktop viewport, while also proving that long states can still scroll.

The issue should only be closed after the corrected branch is integrated, deployed through the separately authorized staging process, and runtime browser UAT confirms the real Keycloak login page has no unnecessary desktop vertical scroll or white page tail.

## Documentation boundary

Current identity implementation/UAT documentation in this branch states the accepted `3fr / 2fr` Akun SQ contract.

The frozen HCIS baseline remains unchanged because its approximately 56/44 statement records the immutable HCIS source snapshot. The existing `docs/specs/HUB-IMPL-010-akun-sq-ui-polish.md` also still contains earlier 56/44 wording. That specification path is outside this parallel agent's exclusive write ownership, so it is not modified here; central integration should reconcile that stale current-contract sentence without rewriting historical facts.

## Integration dependency

`.github/workflows/keycloak-infra.yml` is outside this agent's ownership. Its existing rendered-login assertion still expects `css/sq-account-hcis-d8e0fab49a38.css`, which conflicts with the closure requirement that the retired stylesheet must not be active/rendered. Central integration must update that stale assertion to the accepted final stylesheet stack. This branch does not add inert markup or otherwise spoof the retired filename merely to satisfy that obsolete check.

No issuer, realm key, client ID, authentication protocol, user, secret, staging runtime, or production runtime is changed by this closure work.
