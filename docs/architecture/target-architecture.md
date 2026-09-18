# SQ Hub Target Architecture

**Status:** DRAFT

## Context
SQ Hub adalah shared foundation untuk ekosistem aplikasi Sabilul Qur'an. Aplikasi domain harus dapat berkembang dan dirawat secara independen, tetapi berbagi identity, Organization Directory, app access, dan design language.

## Target logical architecture
```text
                 HCIS workforce organization
                 authoring / authority
                           |
             versioned authenticated contract
                           v
                         SQ Hub
                           |
       +-------------------+-------------------+
       |                   |                   |
   SQ Identity       Organization Directory  App Registry/Access
   (Keycloak)         projection/distribution     |
       |                   |                       |
       +-------------------+-----------------------+
                           |
                    Hub Launcher
                           |
       +-------------------+-------------------+
       |                   |                   |
      HCIS                SPMB             future apps
                                           Finance/Workspace/...

Approval/workflow policy and transactions remain in each domain application.

SQ Design System is extracted from the accepted HCIS visual baseline
and applies across SQ Identity and all application frontends.
```

## Identity
- Staff authentication is centralized through SQ Identity.
- Keycloak is the selected self-hosted Identity Provider engine (ADR-0003).
- Domain applications trust SQ Identity using standard OIDC/OAuth2 flows.
- Domain applications do not own Staff passwords or MFA material after migration.
- Applications treat `issuer + sub` as the opaque stable external identity key.
- Keycloak is not the source of truth for all application/domain authorization.
- Human login policy: Employee uses NIP/`employee_number` as primary username, verified unique email may be an alternate; Staff without NIP uses verified unique email in Foundation v1.

## Web application authentication pattern
For internal web applications with a backend, prefer server-side Authorization Code flow:
```text
Browser
   -> Application
   -> redirect SQ Identity / Keycloak
   -> user authenticates
   -> application server callback + code exchange
   -> resolve issuer+sub to local principal
   -> check SQ Hub Application Access
   -> create app-scoped HttpOnly session
   -> domain authorization
```

Access/refresh tokens are handled server-side and are not stored in browser localStorage/sessionStorage. Each application owns its own scoped session cookie; SSO comes from the IdP session, not a wildcard shared cookie.

Foundation v1 SSO baseline: idle 8 hours, maximum 12 hours, Remember Me disabled initially, access-token baseline 5 minutes.

## Authorization split
SQ Hub owns Application Access: whether an Identity may enter an application.

Each application owns its domain authorization: what the Identity may do inside that application.

Keycloak owns authentication/session/protocol concerns. Its roles/Authorization Services must not become a second source of truth for Application Access or domain permissions without a superseding ADR.

## Application Access runtime pattern
Wave 1 domain applications check SQ Hub Application Access when creating a **new application session**, not synchronously on every protected request.

```text
OIDC login succeeds
      -> domain app calls SQ Hub access-check API
      -> grant active?
           yes -> create local app session
           no  -> deny
```

This means:
- new session issuance fails closed if access cannot be verified;
- existing valid domain sessions are not torn down merely because SQ Hub API is temporarily under maintenance;
- Application Access revocation is immediately effective for new sessions;
- faster revocation of already-issued sessions is a later cross-application capability, not a reason to make every domain request depend on SQ Hub.

Machine calls to SQ Hub use dedicated service identities/tokens, not human credentials.

## HCIS transition pattern
HCIS migration follows ADR-0005.

Existing HCIS `accounts.id` remains the local authorization principal during migration. HCIS adds `identity_issuer + identity_subject` mapping to Keycloak while retaining existing local role/permission/scope relations.

Credential migration is intentionally avoided:
- no password hash import;
- no HCIS MFA-secret import;
- no recovery-code import;
- no old session import.

Users activate/create new SQ Identity credentials. Production cutover changes HCIS from local password auth to OIDC as a controlled switch, without a public dual-auth period. Legacy credential data is removed after a maximum 14-day rollback window.

## Organization
ADR-0007 defines the organization boundary:

- HCIS is system of authority and authoring for workforce organization: organizational units, positions/jobs, employee placements, manager relationships, effective dates, and related employment facts.
- SQ Hub owns the shared Organization Directory projection/distribution layer.
- Hub ingests organization facts through an authenticated controlled contract and does not edit HCIS-owned facts.
- Finance, Workspace, and other domain applications should consume the Hub read contract instead of coupling directly to the HCIS database.
- Hub is not a central approval engine. Domain apps own approval policy, workflow state, delegation, escalation, authorization, and decision audit.
- Domain transactions snapshot the resolved approver plus organization version/effective time; later organization changes do not silently rewrite in-flight approvals unless the domain has an explicit rule.
- Hub may serve last-known-good organization projection during temporary HCIS unavailability, with source/version/as-of/staleness metadata.
- SLA, global identifier, snapshot/delta, conflict handling, and retention remain DISCOVERY/TBD in HUB-IMPL-018.

## Data boundaries
- Ownership is defined in `docs/domain/ownership-and-integration.md`.
- Physical infrastructure may be shared, but logical ownership must remain explicit.
- Cross-domain operational writes use owned contracts/APIs by default.

## Engineering stack
SQ Hub follows ADR-0006 and the HCIS engineering family:
- TypeScript/Node.js;
- Fastify + PostgreSQL for API;
- React/Vite/Tailwind for web when required;
- Vitest/typecheck/lint quality gates.

Same technology family does not mean same runtime or repository. HCIS and SQ Hub remain independently deployable.

## Design system
- HCIS visual language at the accepted reference snapshot is the initial SQ Design System baseline (ADR-0004).
- `docs/design/hcis-baseline.md` captures the foundation so routine agents do not need to rediscover HCIS styling.
- SQ Hub becomes canonical owner of extracted cross-product design primitives once shared packages/tokens are created.
- SQ Identity/Keycloak receives an SQ-branded theme derived from the same baseline.
- Domain-specific UI remains with domain applications.

## Deployment direction
Initial deployment may use one VPS and shared PostgreSQL server infrastructure. Logical database/service ownership and staging/production environments remain separate.

Keycloak may run on the same VPS initially if measured capacity is sufficient, but it remains a separately operated shared service with its own production configuration, resource limits, backup/restore, and upgrade verification.

Target production naming:
- `hub.sabilulquran.or.id` — Hub Launcher
- `login.sabilulquran.or.id` — SQ Identity / Keycloak entry point
- `hcis.sabilulquran.or.id` — HCIS
- `spmb.sabilulquran.or.id` — SPMB

Wave 1 staging naming:
- `hub-staging.sabilulquran.or.id`
- `login.sabilulquran.or.id` — staging is isolated by the `sq-staff-staging` realm and separate staging data/configuration.
- `hcis-staging.sabilulquran.or.id`

Staging and production may share a VPS but must not share mutable realm/database/configuration state.

## Implementation Wave 1
Implementation contracts:
- `HUB-IMPL-001` — Keycloak staging foundation;
- `HUB-IMPL-002` — Application Registry and Application Access;
- `HUB-IMPL-003` — HCIS OIDC consumer integration.

See `docs/product/implementation-wave-1.md`.

## Architecture constraints
- Do not create an ERP monolith.
- Do not build a universal Person Registry without proven need.
- Do not create a central universal permission engine for all domain actions in Foundation v1.
- Do not create a central approval engine in SQ Hub.
- Do not create direct database coupling, dual-write, a parallel organization master, or a Keycloak organization master.
- Do not move domain authorization to Keycloak only because Keycloak provides Authorization Services.
- Do not require separate physical servers merely to preserve domain boundaries.
- Do not introduce event bus/message broker before a concrete workflow requires it.
- Do not implement custom cryptographic/authentication protocols when Keycloak/standard protocols cover the requirement.
- Do not migrate legacy HCIS password/MFA formats into Keycloak through custom compatibility plugins without a superseding ADR.
- Do not silently fall back from failed OIDC authentication to legacy local login.
- Do not make every domain request synchronously depend on SQ Hub merely to achieve faster access revocation.
- Do not invent a new cross-product visual language that conflicts with the accepted HCIS/SQ design baseline.
