# ADR-0006: Reuse the HCIS Engineering Stack for SQ Hub Foundation

**Status:** ACCEPTED
**Date:** 2026-08-27

## Context
SQ Hub and HCIS are separate repositories and independently deployable applications, but they belong to one product family. HCIS already has an established TypeScript stack and the accepted visual baseline for the SQ Design System.

Introducing a different web/API stack in SQ Hub would increase AI context switching, duplicate conventions, make shared design extraction harder, and create operational overhead without a demonstrated benefit.

## Decision
Use the same engineering family as HCIS for SQ Hub Foundation:

### API
- TypeScript / Node.js;
- Fastify;
- PostgreSQL through `pg`;
- Zod for boundary validation;
- Vitest;
- ESLint + TypeScript typecheck.

### Web
When web implementation begins:
- React;
- Vite;
- TanStack Router unless a concrete SQ Hub requirement proves another router necessary;
- Tailwind CSS;
- Vitest;
- SQ Design System derived from the accepted HCIS baseline.

### Repository shape
Initial target:
```text
apps/
  api/
  web/        # when launcher/admin UI starts
packages/
  ui/         # only after real cross-app extraction is ready
  config/     # only when reuse is real
infra/
docs/
```

Do not create packages merely to fill this target tree.

## Version policy
This ADR chooses the technology family, not eternal dependency versions. Exact versions are pinned in repository lockfiles/config when implementation starts and are upgraded through normal review/testing.

Do not copy dependencies from HCIS that SQ Hub does not use.

## Shared design across separate repositories
Separate repos do not imply copied UI forever. HCIS is the initial reference implementation. Cross-product design primitives will be extracted into a distributable SQ package only when a second consumer exists and the package distribution/versioning approach has an implementation spec.

Until then, agents use `docs/design/hcis-baseline.md` rather than cloning arbitrary HCIS business components.

## Consequences
- Lower cognitive and operational overhead for AI-assisted development.
- Easier code review because HCIS and SQ Hub use familiar patterns.
- Easier future extraction of SQ UI primitives.
- Repository independence remains intact: neither application runtime depends on the other's source repository.
- A different technology may still be chosen for a future domain when justified by an ADR and concrete requirement.