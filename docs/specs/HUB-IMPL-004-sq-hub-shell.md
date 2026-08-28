# HUB-IMPL-004 — SQ Hub Workspace Shell and Brand Foundation

**Status:** ACCEPTED  
**Date:** 2026-08-29  
**Product capabilities:** HUB-FND-006 Hub Launcher, HUB-FND-007 Shared Design Foundation  
**Reference design:** `docs/design/hcis-baseline.md`

## Objective

Build the first user-facing SQ Hub workspace shell for internal staff and establish SQ Hub as the canonical visual source for the shared YSQ application language.

The shell must feel immediately related to HCIS without becoming an HCIS clone. HCIS remains a domain application; SQ Hub is the internal workspace that launches authorized domain applications and hosts future shared/platform surfaces.

## Accepted product model

SQ Hub is an internal, app-oriented workspace. It is not an ERP monolith and is not a mandatory gateway for deep links into domain applications.

For this implementation slice:

- `Home` is the default workspace surface;
- the application launcher shows only applications returned by an authorized server-side workspace contract;
- application cards link to each application's canonical URL;
- the shell exposes a consistent account affordance and a reserved `Akun Saya` entry owned by the future SQ Account Center;
- `Administrasi SQ` is represented as a reserved platform-administration destination, but no universal platform-admin authorization model is invented in this task;
- domain business navigation, permissions, and business data stay in their domain applications.

## Visual contract

The HCIS baseline is normative for the initial SQ Hub visual language.

### Brand assets

- Use the existing YSQ mark/logo family already approved in HCIS.
- Do not invent a separate SQ Hub brand mark.
- Product naming is expressed typographically as `SQ Hub` next to/around the YSQ mark.
- Favicon must use the same approved YSQ favicon artwork used by HCIS unless a later design decision supersedes it.
- Binary/font assets must not be exposed outside approved application assets.

### Typography

Match HCIS:

- display/headings: `LT Museum`, then `Inter`, then system sans-serif fallback;
- body/UI: `Inter`, then system sans-serif fallback.

### Semantic palette

Use semantic tokens derived from the accepted HCIS baseline rather than one-off hardcoded colors in components. Initial token values are the values documented in `docs/design/hcis-baseline.md`, including:

- SQ turquoise primary/deep/pale;
- warm application background and raised surfaces;
- subtle turquoise borders;
- yellow/orange supporting accents;
- shared destructive and focus-ring semantics.

### Shape/elevation

Match HCIS character:

- rounded-xl/2xl/3xl hierarchy;
- warm light surfaces;
- subtle borders;
- soft multilayer card/navigation shadows;
- stronger raised shadow for menus/floating surfaces;
- turquoise-derived focus treatment.

### Shell structure

Desktop baseline:

- fixed left sidebar;
- sticky header;
- max-width content area;
- YSQ mark + `SQ Hub` product lockup;
- Home navigation;
- reserved `Administrasi SQ` entry;
- account chip/menu at the lower sidebar and compact header trigger.

Mobile baseline:

- compact sticky header;
- account trigger remains reachable;
- application launcher remains the primary content;
- no horizontal overflow at 390 px viewport width;
- navigation remains usable without the desktop sidebar.

## Workspace data contract

The UI is intentionally separated from authorization logic.

```ts
interface WorkspaceSnapshot {
  user: {
    displayName: string;
    initials: string;
    contextLabel?: string;
  };
  applications: Array<{
    key: string;
    name: string;
    description?: string;
    canonicalUrl: string;
  }>;
}
```

Rules:

- production/staging workspace data must come from an authenticated server-side contract;
- the browser must not independently calculate Application Access;
- the browser must never receive all applications and then hide unauthorized entries client-side;
- static fixtures are allowed only in automated tests/local visual development and must be visibly isolated from runtime data loading;
- application visibility is based on SQ Hub Application Access; domain permissions remain domain-owned.

The server-side authenticated workspace endpoint and SQ Hub's own OIDC session may be delivered as a security-reviewed follow-up change if they are not already available. Until that contract exists, this task may land the visual shell and typed UI contract, but it must not expose an unauthenticated production launcher containing guessed application access.

## Account experience

The shell provides the same ecosystem convention introduced in HCIS:

- visible user identity context;
- `Akun Saya` reserved for SQ Account Center and non-navigating until a real target exists;
- `Keluar` is reserved for the official server-side SQ Hub/SQ Identity logout contract once the authenticated shell is wired.

This task must not create local password, MFA, recovery, or credential settings in SQ Hub.

## `Administrasi SQ`

`Administrasi SQ` is a reserved navigation concept for cross-application/platform administration. This task does not define or grant a universal administrator role.

Until an accepted administration/authorization specification exists:

- the visual shell may show a disabled/reserved affordance labelled `Segera` in development/design states;
- no privileged API, route, or authorization behavior is created from this spec alone.

## Accessibility baseline

- semantic interactive elements;
- visible keyboard focus;
- account menu announces `aria-haspopup` / `aria-expanded`;
- Escape and outside-click close menus;
- minimum 320 px page support and no horizontal overflow at 390×844;
- icons used decoratively are hidden from assistive technology; meaningful controls have accessible names.

## Implementation scope

### In scope

1. `apps/web` React/Vite/Tailwind workspace.
2. Canonical SQ/YSQ semantic design tokens derived from HCIS.
3. SQ Hub favicon/title/metadata.
4. Responsive workspace shell.
5. Reusable brand lockup, account menu, application card/launcher components.
6. Typed `WorkspaceSnapshot` UI boundary.
7. Development/test-only synthetic workspace fixture.
8. Unit/render tests for brand, launcher filtering boundary, account affordances, and responsive shell markers.
9. Root scripts and CI updated so API + web are checked together.

### Out of scope

- public/external SQ Portal;
- universal Person Registry;
- domain permission administration;
- HCIS business UI/navigation;
- working SQ Admin Center privilege model;
- account credential/security settings;
- silent client-side reconstruction of Application Access;
- production deployment/cutover without staging verification.

## Acceptance criteria

- UI visibly matches the HCIS/YSQ family in logo treatment, typography, semantic colors, shape, elevation, and interaction detail.
- Browser title is `SQ Hub · Yayasan Sabilul Qur'an` and the approved YSQ favicon is configured.
- Home contains an application-launcher region that renders only entries present in `WorkspaceSnapshot.applications`.
- HCIS-specific business navigation is not copied into SQ Hub.
- `Akun Saya` is visibly owned by SQ Account Center and remains disabled until a real account-center target exists.
- `Administrasi SQ` does not create hidden universal authorization.
- desktop and 390×844 mobile layouts have no horizontal overflow by design.
- keyboard account-menu interaction has visible focus, Escape close, outside-click close, and ARIA state.
- no access/refresh/ID token storage code is introduced in browser localStorage/sessionStorage.
- API and web typecheck/lint/test/build pass in CI.
- no secret or production data is committed.

## Follow-up security gate

Before the shell is deployed as an authenticated staff launcher, a follow-up implementation must provide and verify:

- dedicated SQ Hub OIDC confidential client;
- server-side Authorization Code + PKCE session handling;
- secure host-only application session cookie;
- authenticated workspace endpoint that queries Application Access server-side;
- official logout/end-session flow;
- browser token-storage verification;
- staging UAT with synthetic identities.

That follow-up must preserve the staff authentication policy and may not weaken the existing Keycloak/HCIS security boundary to make the launcher work.
