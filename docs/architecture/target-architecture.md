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

Shared design system applies across all application frontends.
```

## Identity
- Staff authentication is centralized.
- Domain applications trust SQ Identity using a standard SSO protocol.
- Domain applications do not own staff passwords.
- A mature self-hosted Identity Provider is preferred over implementing OAuth/OIDC/MFA protocol internals from scratch.
- Exact provider remains an ADR decision.

## Authorization split
SQ Hub owns Application Access: whether an Identity may enter an application.

Each application owns its domain authorization: what the Identity may do inside that application.

## Data boundaries
- Ownership is defined in `docs/domain/ownership-and-integration.md`.
- Physical infrastructure may be shared, but logical ownership must remain explicit.
- Cross-domain operational writes use owned contracts/APIs by default.

## Deployment direction
Initial deployment may use one VPS and shared PostgreSQL infrastructure. Logical staging and production environments remain separate.

Target public naming:
- `hub.sabilulquran.or.id` — Hub Launcher
- `login.sabilulquran.or.id` — SQ Identity entry point
- `hcis.sabilulquran.or.id` — HCIS
- `spmb.sabilulquran.or.id` — SPMB

Staging hostname convention remains TBD.

## Architecture constraints
- Do not create an ERP monolith.
- Do not build a universal Person Registry without proven need.
- Do not create a central universal permission engine for all domain actions in Foundation v1.
- Do not require separate physical servers merely to preserve domain boundaries.
- Do not introduce event bus/message broker before a concrete workflow requires it.
- Do not implement custom cryptographic/authentication protocols when mature, auditable components exist.
