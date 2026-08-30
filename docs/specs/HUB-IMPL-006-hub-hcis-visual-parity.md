# HUB-IMPL-006 — SQ Hub HCIS visual parity

**Status:** ACCEPTED
**Scope:** SQ Hub shell branding alignment only
**Environment:** development / staging

## Goal

Bring the authenticated SQ Hub shell into closer visual parity with the accepted HCIS-to-SQ design baseline before starting SQ Admin Center work.

This task does not change authentication, session handling, Application Access, workspace API behavior, routing, or domain authorization.

## Source of truth

- `docs/design/hcis-baseline.md`
- HCIS baseline snapshot `imadjinasi/hcisysq@a1117ce0899d97824955feadf72c5b68d6e9f9e5`
- HCIS `apps/web/src/layouts/AppShell.tsx`
- SQ Hub current authenticated shell

## Brand asset decision

The existing SQ Hub asset `apps/web/src/assets/brand/ysq-mark.png` is already byte-identical to the HCIS baseline asset (`git blob 12aa54b04a13c907a0b0218ad40a2c5d47671613`).

Therefore this task MUST NOT introduce a replacement or invented logo. The correction is presentation treatment.

## Required visual changes

1. Display the YSQ mark directly in the application lockup, matching the HCIS shell treatment rather than wrapping it in a decorative white rounded tile.
2. Desktop mark target: 44x44 (`h-11 w-11`).
3. Compact/mobile mark target: 36x36 (`h-9 w-9`).
4. Align product-name/subtitle typography and spacing with the HCIS application-shell proportions while retaining product-specific copy:
   - product: `SQ Hub`;
   - organization: `Yayasan Sabilul Qur'an`.
5. Keep the existing accepted SQ semantic colors, typography families, shell structure, navigation model, application cards, account menu, and responsive behavior unless a narrowly necessary adjustment is required to prevent layout overflow.
6. Do not copy HCIS business navigation or HCIS-specific product wording into SQ Hub.

## Non-goals

- redesigning the Hub home page;
- changing OIDC or session behavior;
- changing Application Access semantics;
- changing HCIS;
- changing SQ Identity;
- introducing a shared component package;
- production deployment.

## Acceptance criteria

- SQ Hub uses the same YSQ mark asset as the HCIS baseline;
- no decorative logo tile remains around the application mark;
- desktop brand lockup visually follows the HCIS shell proportion;
- compact/mobile lockup visually follows the HCIS shell proportion and remains readable at approximately 390x844;
- `SQ Hub` remains the product name;
- `Yayasan Sabilul Qur'an` remains visible in the lockup;
- account controls and navigation remain usable;
- existing workspace authorization and auth tests remain unchanged/passing;
- CI typecheck, lint, tests, build, and visual smoke pass before merge.

## Rollback

This is a frontend-only presentation change. Rollback is a revert of the visual-parity commit/PR; no database, identity, access, or infrastructure migration is involved.
