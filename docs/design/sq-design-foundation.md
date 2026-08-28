# SQ Design Foundation

**Status:** ACCEPTED  
**Specification:** HUB-IMPL-004  
**Initial implementation:** `apps/web/src/styles.css`

## Purpose

This document turns the accepted HCIS visual baseline into the first canonical SQ Hub design foundation. It does not create a distributable shared package yet; per repository rules, a package is extracted only after a second real application consumer requires it.

## Brand relationship

SQ Hub, SQ Identity, HCIS, and future internal SQ applications belong to one YSQ product family.

- Reuse the approved YSQ mark/logo assets.
- Product identity is expressed through the product name beside the YSQ brand, not by inventing unrelated marks.
- Domain applications may have their own information architecture while preserving the shared visual language.
- SQ Hub must look like the parent workspace, not like HCIS with different labels.

## Typography

Canonical stacks:

```css
--font-heading: "LT Museum", "Inter", ui-sans-serif, system-ui, sans-serif;
--font-body: "Inter", ui-sans-serif, system-ui, sans-serif;
```

Use display typography for high-level page/product headings and body typography for controls, labels, descriptions, and dense application content.

## Semantic color tokens

The initial implementation retains the accepted HCIS OKLCH values and names them semantically in the SQ Hub web theme:

| Token | Role |
|---|---|
| `brand-primary` | primary YSQ turquoise/action/identity color |
| `brand-primary-deep` | strong turquoise text/action emphasis |
| `brand-primary-pale` | selected/soft turquoise surface |
| `brand-cyan` | cool supporting accent |
| `brand-yellow` | warm secondary accent |
| `brand-orange` | warm supporting accent |
| `background` / `surface` | warm application background |
| `surface-raised` | raised cards/menus |
| `foreground` | primary text |
| `muted-foreground` | secondary text |
| `border` | subtle structural border |
| `ring` | keyboard focus ring |
| `destructive` | destructive/error actions |

Components consume semantic tokens instead of repeating raw OKLCH values.

## Shape and elevation

- Primary containers: generous `2xl`/`3xl` rounding.
- Small controls: `xl`/`2xl` rounding.
- Cards use subtle borders plus `shadow-soft`.
- Menus/floating surfaces use `shadow-raised`.
- Brand hero surfaces may use `shadow-brand-card`.
- Keyboard focus is always visible and uses the semantic ring token.

## Shared shell pattern

The initial internal application/workspace family pattern is:

- desktop fixed sidebar;
- sticky header;
- max-width content canvas;
- compact mobile header;
- mobile bottom navigation where navigation density justifies it;
- YSQ brand lockup;
- consistent identity/avatar treatment;
- account menu convention with `Akun Saya` and `Keluar`;
- warm neutral surfaces with turquoise selected states.

Navigation labels and authorization decisions remain supplied by each product/domain.

## Asset provenance

The initial SQ Hub implementation copies the exact approved HCIS YSQ mark and favicon blobs into its own application assets. Font files are not duplicated or redistributed by this document.

## Extraction rule

`apps/web/src/styles.css` is the canonical implementation for this first slice. When another concrete consumer needs the same primitives, extract only the proven reusable tokens/components into an explicit shared package with its own versioning/distribution contract. Do not prematurely centralize business-specific HCIS or SQ Hub components.
