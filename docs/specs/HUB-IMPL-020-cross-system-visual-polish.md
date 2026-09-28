# HUB-IMPL-020 — Cross-system Visual Polish

**Status:** ACCEPTED — user-directed, non-blocking backlog
**Products:** SQ Hub, Akun SQ, HCIS, Aset SQ, and their login/logout transitions
**Type:** Visual-only enhancement after Foundation and Organization Directory closure

## Outcome

Bring the visible application shells and primary account-transition surfaces into closer alignment with the accepted SQ/HCIS visual baseline at 1440×900, 1280×720, and 390×844. Focus on official brand marks, mastheads, navigation, typography, semantic colors, spacing, cards/forms/states, keyboard focus, and mobile containment.

This work does not reopen or change Foundation or Organization Directory status. Both remain **CLOSED**; this is non-blocking visual polish.

## Source of truth

- `docs/design/hcis-baseline.md` and accepted ADR-0004.
- Existing product-specific accepted specs, including HUB-IMPL-006, HUB-IMPL-008, HUB-IMPL-010, HUB-IMPL-015, HUB-IMPL-017, and HUB-IMPL-019.
- This specification's visual-only scope and acceptance criteria.

For this visual pass only, updated brand-lockup sizing in this specification supersedes the 44px/36px SQ Hub mark targets in HUB-IMPL-006. All other accepted behavior and product wording remain in force.

## Baseline patterns and tokens

- Typography: LT Museum for display headings, Inter for body and controls, with system sans-serif fallbacks; compact, clear heading hierarchy.
- Semantic colors: `brand-primary`, `brand-primary-deep`, `brand-primary-pale`, `brand-accent-cyan`, `brand-secondary-yellow`, `brand-accent-orange`, `brand-heading`, `background`, `surface`, `surface-raised`, `foreground`, `muted-foreground`, `border`, and `destructive`, using the established HCIS OKLCH values through semantic tokens.
- Shape and elevation: rounded-xl/2xl/3xl by hierarchy, subtle warm-surface borders, soft card/navigation shadows, and brand-derived visible focus rings.
- Shell: desktop sidebar, sticky masthead, centered max-width content, rounded selected navigation, account identity surface, and a mobile-first compact navigation treatment consistent with the consuming product's accepted pattern.
- Auth: constrained warm form surface and official YSQ logo assets, following accepted Akun SQ composition without changing native provider interactions.

Do not create a shared package. A small local primitive may be proposed only where two or more actual applications have the same useful semantics and API.

## Scope and invariants

- Use official logo assets already present in the ecosystem; do not redraw or invent a mark.
- Preserve each product's wording and navigation labels.
- Make no changes to authentication/OIDC, issuer, realm, sessions, cookies, tokens, MFA, recovery, logout semantics, Application Access, roles, permissions, organization facts, approvals, domain behavior, APIs, or integration contracts.
- Do not use production for experiments or write operations.
- Use synthetic personas only. Do not retain screenshots or evidence that contains personal data, credentials, tokens, cookies, or private identity values.
- Keep changes small and separated by repository.

## Source audit matrix

This is the initial source audit. Production screenshots and authenticated states remain pending until they can be captured without autofill or personal data.

| Application/surface | Viewport | Initial source finding | Classification |
|---|---|---|---|
| SQ Hub shell | 1440×900 | Existing semantic palette and HCIS shell structure; lockup text sizing requires review against HCIS masthead. | brand mark, header, typography, spacing |
| SQ Hub shell | 1280×720 | Same shell; fixed/sidebar and content width need a rendered containment check. | header, navigation, spacing, responsive |
| SQ Hub shell | 390×844 | Compact lockup uses 11px product and 9px organization text; review legibility and touch spacing. | brand mark, header, navigation, typography, responsive, focus |
| Akun SQ login/account/logout | 1440×900 | Anonymous login page was observed. The browser had autofilled fields; that capture is discarded and cannot be used as evidence. | brand mark, header, typography, color, spacing, form, focus |
| Akun SQ login/account/logout | 1280×720 | Not yet captured in a clean browser context. | all categories pending |
| Akun SQ login/account/logout | 390×844 | Not yet captured in a clean browser context; authenticated account/logout states require a supplied safe session. | all categories pending |
| HCIS shell/auth | 1440×900 | Source uses the accepted HCIS semantic OKLCH palette, Inter/LT Museum, and desktop sidebar shell. Current HCIS checkout has unrelated local edits and is read-only for this task. | brand mark, header, navigation, typography, color, spacing |
| HCIS shell/auth | 1280×720 | Rendered source check pending; no changes made. | all categories pending |
| HCIS shell/auth | 390×844 | Source includes responsive mobile patterns; rendered overflow/touch/focus check pending. | navigation, spacing, responsive, focus |
| Aset SQ shell | 1440×900 | Uses a generic package icon in a teal tile instead of an official logo; shell uses default slate/teal colors rather than the shared semantic palette. | brand mark, header, color/token, spacing |
| Aset SQ shell | 1280×720 | Fixed 18rem sidebar and masthead layout require rendered check. | header, navigation, responsive |
| Aset SQ shell | 390×844 | Five-item bottom nav is present; mobile masthead uses 40px generic icon tile and links need 44px/focus/overflow verification. | brand mark, navigation, typography, responsive, focus |
| Login/logout transitions | all target sizes | Login can be observed anonymously; authenticated Hub/HCIS/Aset launcher and end-session screens are not accepted until a safe synthetic session is supplied and captured cleanly. | header, form, state, responsive, focus |

## Required inventory categories

Each per-application review must record findings for: logo/brand mark; header/masthead; navigation; typography; color/token; spacing/alignment; card/form/table; empty/loading/error state; responsive/mobile; and focus/accessibility. Use only sanitized screenshots. Record `not observed` rather than inferring an unseen state.

## Acceptance criteria

- Official logo and product lockup are proportionate, legible, uncropped, and aligned on desktop and mobile.
- Header height/padding, container width, typography, semantic color, radius, shadow, and spacing follow accepted SQ/HCIS patterns.
- Navigation and primary cards/forms/states feel like one SQ product family while retaining product-owned wording and behavior.
- At the three target viewports, no horizontal overflow, clipped controls/navigation, crowded important text, undersized primary touch targets, or off-viewport dialogs.
- Keyboard navigation, visible focus, contrast, semantic headings, form labels, and text-based status/error cues remain accessible.
- No security, authorization, domain, data, or integration behavior changes.
- Every changed repository has its own focused, reviewed PR and applicable typecheck/lint/test/build evidence. Responsive component changes have regression coverage.
- Before/after sanitized screenshots cover the audited application states and target viewports; production acceptance is read-only after official deployment.

## Delivery and rollout

Keep each repository change in a separate PR. Do not declare this baseline closed until exact-PR-head CI, visual/browser acceptance, deployment and post-deployment production visual checks have evidence. Use the official deployment workflow for each accepted PR and record an applicable rollback reference.

## Rollback

Each repository is rolled back by reverting its visual-only merge commit through the repository's normal release workflow. No schema, identity, permission, integration, or data rollback is required.
