# ADR-0004: Adopt HCIS as the Initial SQ Design Baseline

**Status:** ACCEPTED
**Date:** 2026-08-27

## Context
HCIS already contains a visual system that is considered aligned with the Sabilul Qur'an brand. Re-designing SQ Hub, SQ Identity, and future applications from a blank slate would duplicate work, increase inconsistency, and encourage AI-generated visual drift.

## Decision
Adopt the current HCIS frontend visual language as the **initial canonical baseline for the SQ Design System**.

The baseline is derived from HCIS `main` at commit:
`a1117ce0899d97824955feadf72c5b68d6e9f9e5`

Key reference artifacts at that snapshot:
- `apps/web/src/styles.css` — brand/semantic color variables, typography, surfaces, borders, and shadows;
- `apps/web/src/layouts/AppShell.tsx` — responsive application-shell language;
- `apps/web/src/layouts/AuthLayout.tsx` — authentication-page composition;
- `apps/web/src/components/hcis/` — candidate form/status/auth patterns to audit for shared extraction.

## What is adopted
- brand color direction and semantic token approach;
- `LT Museum` as heading/display family and `Inter` as body family, subject to existing brand/font licensing and deployment availability;
- warm/light surface treatment;
- turquoise primary brand direction with cyan/yellow/orange supporting accents;
- rounded geometry, border treatment, and soft/raised shadow language;
- responsive shell behavior and visual density as a starting point;
- authentication layout language as the visual basis for the SQ Identity/Keycloak theme.

## What is not automatically adopted
HCIS business-specific UI and navigation semantics do not become shared platform components merely because they already exist.

Examples that remain HCIS-owned unless proven reusable:
- leave calendar/workflow;
- attendance-specific UI;
- payslip/payroll UI;
- HCIS navigation labels and Human Capital-specific capability logic.

## Canonical-source transition
During the extraction phase, HCIS is the reference implementation. Once SQ Hub publishes accepted shared tokens/components, **SQ Hub becomes the canonical source for shared design primitives** and HCIS should consume or align to those primitives rather than permanently owning the cross-product design system.

This avoids a long-term dependency where every future application must inspect HCIS internals to discover the brand language.

## AI guardrail
AI agents must not invent a new visual language for SQ Hub/SPMB/other applications when an equivalent HCIS/SQ pattern exists. If a new pattern is required, document the gap and decide whether it belongs to the shared design system or the domain application.

## Consequences
- SQ Hub and SPMB should look familiar to current HCIS users from day one.
- Initial design work changes from "invent a design system" to "extract, normalize, document, and reuse the HCIS design system".
- Keycloak login theming should reproduce the SQ authentication language rather than its default visual identity.
- Shared package naming/technology remains an implementation decision; visual behavior is the source-of-truth decision here.
