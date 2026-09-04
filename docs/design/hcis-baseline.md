# HCIS-to-SQ Design Baseline

**Status:** ACCEPTED
**Reference repository:** `imadjinasi/hcisysq`
**Reference commit:** `a1117ce0899d97824955feadf72c5b68d6e9f9e5`

## Purpose
Dokumen ini membekukan baseline visual HCIS yang telah disetujui sebagai arah brand SQ Hub. Tujuannya agar agent tidak perlu membaca seluruh frontend HCIS untuk task desain biasa, sekaligus mencegah visual drift antar aplikasi.

Ini adalah baseline extraction, bukan copy seluruh business UI HCIS.

## Primary source files
- `apps/web/src/styles.css` (blob `a6de39cb7a3c0a826c77ed961180e067b6b1ec3e`)
- `apps/web/src/layouts/AppShell.tsx` (blob `4ae7f7a31ac46726546591700b2ab1d623918f45`)
- `apps/web/src/layouts/AuthLayout.tsx` (blob `362f110496596f6803bdb072112a6cee6fb2823b`)
- `apps/web/src/components/hcis/` (tree `daa7ff72b2acc016657966f784b97a2284128765`)

Immutable reference examples:
- https://github.com/imadjinasi/hcisysq/blob/a1117ce0899d97824955feadf72c5b68d6e9f9e5/apps/web/src/styles.css
- https://github.com/imadjinasi/hcisysq/blob/a1117ce0899d97824955feadf72c5b68d6e9f9e5/apps/web/src/layouts/AppShell.tsx
- https://github.com/imadjinasi/hcisysq/blob/a1117ce0899d97824955feadf72c5b68d6e9f9e5/apps/web/src/layouts/AuthLayout.tsx

## Typography baseline
- Heading/display: `LT Museum`, with `Inter` and system sans-serif fallbacks.
- Body/UI: `Inter`, with system sans-serif fallbacks.
- Headings use a confident, compact visual hierarchy; utility labels may use small uppercase tracking where appropriate.

Font asset licensing/distribution must follow the existing authorized YSQ/HCIS arrangement. Do not duplicate or expose font files outside approved application assets.

## Color baseline
Current HCIS CSS variables use OKLCH and form the initial SQ semantic palette:

| Token | Baseline value | Role |
|---|---|---|
| `brand-primary` | `oklch(0.651 0.106 195.68)` | main SQ turquoise |
| `brand-primary-deep` | `oklch(0.49 0.09 195.68)` | stronger text/action accent |
| `brand-primary-pale` | `oklch(0.93 0.035 195.68)` | selected/soft background |
| `brand-accent-cyan` | `oklch(0.746 0.11 207.2)` | supporting accent |
| `brand-secondary-yellow` | `oklch(0.832 0.161 88.87)` | secondary/warm accent |
| `brand-accent-orange` | `oklch(0.755 0.14 56.12)` | supporting warm accent |
| `brand-heading` | `oklch(0 0 0)` | heading text |
| `background` / `surface` | `oklch(0.982 0.006 96)` | warm light application background |
| `surface-raised` | `oklch(0.998 0.002 95)` | raised cards/dialogs |
| `foreground` | `oklch(0.23 0.018 245)` | primary text |
| `muted-foreground` | `oklch(0.52 0.024 245)` | secondary text |
| `border` | `oklch(0.89 0.012 195.68)` | subtle border |
| `destructive` | `oklch(0.57 0.19 28)` | destructive/error action |

These values are the starting source, not permission to hardcode color values throughout applications. Implementation should consume semantic tokens.

## Elevation and shape
HCIS establishes:
- generous rounded geometry, commonly `rounded-xl`, `rounded-2xl`, and `rounded-3xl` depending on hierarchy;
- subtle borders over warm light surfaces;
- soft multi-layer shadows for cards/navigation;
- stronger but still soft raised shadow for floating/mobile navigation;
- focused input/button shadows derived from the primary turquoise rather than generic blue.

The shared system should preserve this character while reducing arbitrary one-off shadow definitions into documented semantic elevation tokens.

## Application-shell baseline
The HCIS `AppShell` is the visual reference for:
- fixed desktop sidebar;
- sticky top header;
- centered/max-width content area;
- mobile-first fallback with bottom navigation;
- rounded navigation items and selected-state pale primary surface;
- user identity chip/avatar treatment;
- subtle surface translucency/backdrop blur where useful.

Do not copy HCIS navigation labels or capability checks into shared components. Shared shell owns structure/appearance; each application supplies its own navigation model and authorization result.

## Authentication baseline
The HCIS `AuthLayout` is the visual starting point for `login.sabilulquran.or.id`:
- responsive split layout, approximately 56/44 on large screens;
- dedicated brand panel;
- warm clean form surface;
- controlled decorative brand-accent glows;
- constrained form width;
- consistent SQ typography/colors/footer language.

Keycloak must be themed to this language. Do not reproduce HCIS-specific product wording such as "Human Capital Information System" on the global SQ Identity login page.

## Candidate shared components
Existing HCIS components should be reviewed and generalized before extraction, including:
- form field;
- password/input treatments;
- status badge semantics;
- auth footer/brand panel composition;
- common buttons/cards if equivalents are identified in current pages.

A component becomes shared because its semantics and API are useful across applications, not merely because its CSS looks reusable.

## Extraction order
1. normalize semantic tokens from HCIS into SQ design-token documentation/package;
2. define shared typography/elevation/radius conventions;
3. generalize Auth layout for SQ Identity;
4. generalize app shell without HCIS business navigation;
5. extract common form/status components only when SPMB/SQ Hub creates the second concrete consumer;
6. migrate HCIS to consume/alignment with SQ shared primitives after those primitives stabilize.

## Rule for future changes
Changes made only inside HCIS after this snapshot do not automatically become SQ Design System changes. Cross-product visual changes must be proposed against SQ Hub's design source of truth and assessed for HCIS/SPMB/other consumers.
