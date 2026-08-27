# SQ Hub Target Architecture

**Status:** DRAFT

## Context
SQ Hub adalah shared foundation untuk ekosistem aplikasi Sabilul Qur'an. Aplikasi domain harus dapat berkembang dan dirawat secara independen, tetapi berbagi identity, organization master, app access, dan design language.

## Target logical architecture
```text
                         SQ Hub
                           |
       +-------------------+-------------------+
       |                   |                   |
   SQ Identity       Organization Master   App Registry/Access
   (Keycloak)                                  |
       |                                       |
       +-------------------+-------------------+
                           |
                    Hub Launcher
                           |
       +-------------------+-------------------+
       |                   |                   |
      HCIS                SPMB             future apps
       |                   |              Finance/Workspace/...
       +--------- integration contracts --------+

SQ Design System is extracted from the accepted HCIS visual baseline
and applies across SQ Identity and all application frontends.
```

## Identity
- Staff authentication is centralized through SQ Identity.
- Keycloak is the selected self-hosted Identity Provider engine (ADR-0003).
- Domain applications trust SQ Identity using standard OIDC/OAuth2 flows.
- Domain applications do not own staff passwords or MFA material after migration.
- Applications treat the authenticated `sub` as an opaque stable identifier.
- Keycloak is not the source of truth for all application/domain authorization.

## Authorization split
SQ Hub owns Application Access: whether an Identity may enter an application.

Each application owns its domain authorization: what the Identity may do inside that application.

Keycloak owns authentication/session/protocol concerns. Its roles/Authorization Services must not become a second source of truth for Application Access or domain permissions without a superseding ADR.

## Organization
Target ownership Organizational Unit is SQ Hub. HCIS remains operational with its current organization data until the explicit mapping/migration/cutover plan is completed.

## Data boundaries
- Ownership is defined in `docs/domain/ownership-and-integration.md`.
- Physical infrastructure may be shared, but logical ownership must remain explicit.
- Cross-domain operational writes use owned contracts/APIs by default.

## Design system
- HCIS visual language at the accepted reference snapshot is the initial SQ Design System baseline (ADR-0004).
- `docs/design/hcis-baseline.md` captures the foundation so routine agents do not need to rediscover HCIS styling.
- SQ Hub becomes canonical owner of extracted cross-product design primitives once shared packages/tokens are created.
- SQ Identity/Keycloak receives an SQ-branded theme derived from the same baseline.
- Domain-specific UI remains with domain applications.

## Deployment direction
Initial deployment may use one VPS and shared PostgreSQL infrastructure. Logical staging and production environments remain separate.

Keycloak may run on the same VPS initially if measured capacity is sufficient, but it remains a separately operated shared service with its own production configuration, resource limits, backup/restore, and upgrade verification.

Target public naming:
- `hub.sabilulquran.or.id` — Hub Launcher
- `login.sabilulquran.or.id` — SQ Identity / Keycloak entry point
- `hcis.sabilulquran.or.id` — HCIS
- `spmb.sabilulquran.or.id` — SPMB

Staging hostname convention remains TBD.

## Architecture constraints
- Do not create an ERP monolith.
- Do not build a universal Person Registry without proven need.
- Do not create a central universal permission engine for all domain actions in Foundation v1.
- Do not move domain authorization to Keycloak only because Keycloak provides Authorization Services.
- Do not require separate physical servers merely to preserve domain boundaries.
- Do not introduce event bus/message broker before a concrete workflow requires it.
- Do not implement custom cryptographic/authentication protocols when Keycloak/standard protocols cover the requirement.
- Do not invent a new cross-product visual language that conflicts with the accepted HCIS/SQ design baseline.
