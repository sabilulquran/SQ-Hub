# SQ Hub Target Architecture

**Status:** LIVING description of the current architecture. The decisions themselves are in the accepted ADRs cited in each section; this document adds none. Aligned to ADR-0014 on 2026-11-16. (It was previously labelled DRAFT and also carried a blanket RETIRED banner; only its Wave 1 staging notes are retired, see "Deployment".)

**Terms:** SQ Hub is the whole ecosystem. In this document "the platform" or "Hub" means the platform part of SQ Hub (Beranda, Akun SQ, Admin SQ, Direktori Organisasi) that lives in the `SQ-Hub` repository. The list of applications, where each runs, and their status is [`docs/product/struktur-sq-hub.md`](../product/struktur-sq-hub.md) (STRUKTUR-001).

## Context
SQ Hub adalah ekosistem aplikasi Yayasan Sabilul Qur'an. Aplikasi harus dapat berkembang dan dirawat secara independen, tetapi berbagi bagian platform: identity (Akun SQ), Organization Directory, app access (Admin SQ), Beranda, dan design language.

## Target logical architecture
```text
                          SQ Hub (the ecosystem)

  Portals:  Admin | Pegawai | Organ | Keluarga | Pelamar | Situs publik
                              |
                  login.  Akun SQ (Keycloak realms)
                              |
  +-----------------------------------------------------------------+
  | Platform part of SQ Hub (repo SQ-Hub, one Node process + DB)    |
  |   Beranda (launcher)   Admin SQ (App Registry/Access, roles)    |
  |   Organization Directory  <- versioned contract <-  HCIS        |
  |   Applications hosted in the Hub process (ADR-0014 D6):         |
  |     Kirim SQ | Portal Organ | Kerja SQ | Sekretariat SQ | ...   |
  |     each with its own table prefix, rules, and release flag     |
  +-----------------------------------------------------------------+
        |  OIDC, Application Access check, launcher list, Directory
        |  read contract, Kirim SQ sending, governance summaries
        v
  Applications in their own program and database (ADR-0001 default):
     HCIS | Aset SQ | Karir SQ | SPMB SQ | Keluarga SQ | Keuangan | ...

Approval/workflow policy and transactions remain in each application.
Each application that holds foundation data publishes a Laporan face
(governance summary) that Portal Organ displays and never stores.

SQ Design System is extracted from the accepted HCIS visual baseline
and applies across Akun SQ and all application frontends.
```

The diagram names examples only. Which applications exist, which process each runs in, and whether it is live is recorded in STRUKTUR-001 §5.

## Where an application runs
ADR-0014 D6 (amending ADR-0001):

- Default: its own program and database. This always applies to applications that hold sensitive personal data, payroll, finance, or student records.
- An application may run inside the Hub process when (1) it is a capability other applications call (Kirim SQ, ADR-0011), (2) it only shows data owned by others (Portal Organ, ADR-0012), or (3) it is small, its data is not sensitive, and server memory is the constraint. Reason 3 is a recorded compromise; such an application moves to its own program when memory allows or its data grows more sensitive.
- Hosting inside the Hub process never changes ownership. The application keeps its own tables (own prefix), rules, and release flag (`*_ENABLED`), imports nothing from other applications' code, and is reached by other applications only through a contract.
- The code folders under `apps/api/src/modules/` and `apps/web/src/` are technical names; a folder there may be a platform part or a hosted application.

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
The platform (Admin SQ) owns Application Access: whether an Identity may enter an application.

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
- The platform owns the shared Organization Directory projection/distribution layer.
- Hub ingests organization facts through an authenticated controlled contract and does not edit HCIS-owned facts.
- Keuangan, Kerja SQ, and other applications consume the Hub read contract instead of coupling directly to the HCIS database.
- Hub is not a central approval engine. Domain apps own approval policy, workflow state, delegation, escalation, authorization, and decision audit.
- Domain transactions snapshot the resolved approver plus organization version/effective time; later organization changes do not silently rewrite in-flight approvals unless the domain has an explicit rule.
- Hub may serve last-known-good organization projection during temporary HCIS unavailability, with source/version/as-of/staleness metadata.
- Identifier, full-snapshot pull, reconciliation, and freshness are set by HUB-IMPL-018 (ACCEPTED); deployment SLA and history retention remain TBD.

## Data boundaries
- Ownership is defined in `docs/domain/ownership-and-integration.md`.
- Physical infrastructure may be shared, but logical ownership must remain explicit.
- Cross-domain operational writes use owned contracts/APIs by default.

## Engineering stack
The `SQ-Hub` repository follows ADR-0006 and the HCIS engineering family:
- TypeScript/Node.js;
- Fastify + PostgreSQL for API;
- React/Vite/Tailwind for web when required;
- Vitest/typecheck/lint quality gates.

Same technology family does not mean same runtime or repository. HCIS and the platform remain independently deployable.

## Design system
- HCIS visual language at the accepted reference snapshot is the initial SQ Design System baseline (ADR-0004).
- `docs/design/hcis-baseline.md` captures the foundation so routine agents do not need to rediscover HCIS styling.
- The `SQ-Hub` repository becomes canonical owner of extracted cross-product design primitives once shared packages/tokens are created.
- SQ Identity/Keycloak receives an SQ-branded theme derived from the same baseline.
- Domain-specific UI remains with domain applications.

## Deployment
Production runs on the Mi8 host as plain Node processes with a shared PostgreSQL server, without containers (`docs/operations/vps-deployment-retired-2026-10-19.md`). Logical database and service ownership stay separate per application.

Keycloak runs on the same host as a separately operated shared service with its own configuration, backup/restore, and upgrade verification.

There is **no staging environment**: staging on the production VPS was permanently retired on 2 October 2026 (`docs/operations/permanent-staging-retirement-2026-10-02.md`), and the earlier paid VPS itself was shut down after the move to Mi8. The Wave 1 staging names (`hub-staging`, `hcis-staging`, realm `sq-staff-staging`) are historical and must not be recreated.

Production addresses are not listed here. The portal and application addresses, and the last live check of each, are in STRUKTUR-001 §2, §5, and §10. Sign-in for every portal goes through `login.sabilulquran.or.id`.

## Implementation Wave 1 (historical)
The first implementation contracts, all delivered:
- `HUB-IMPL-001` — Keycloak staging foundation;
- `HUB-IMPL-002` — Application Registry and Application Access;
- `HUB-IMPL-003` — HCIS OIDC consumer integration.

See `docs/product/implementation-wave-1.md`. The full specification index is `docs/specs/README.md`.

## Architecture constraints
- Do not create an ERP monolith.
- Do not build a universal Person Registry without proven need.
- Do not create a central universal permission engine for all domain actions in Foundation v1.
- Do not create a central approval engine in the platform.
- Do not create direct database coupling, dual-write, a parallel organization master, or a Keycloak organization master.
- Do not move domain authorization to Keycloak only because Keycloak provides Authorization Services.
- Do not require separate physical servers merely to preserve domain boundaries.
- Do not introduce event bus/message broker before a concrete workflow requires it.
- Do not implement custom cryptographic/authentication protocols when Keycloak/standard protocols cover the requirement.
- Do not migrate legacy HCIS password/MFA formats into Keycloak through custom compatibility plugins without a superseding ADR.
- Do not silently fall back from failed OIDC authentication to legacy local login.
- Do not make every domain request synchronously depend on SQ Hub merely to achieve faster access revocation.
- Do not move an application into the Hub process outside the three reasons of ADR-0014 D6, and do not let a hosted application share tables or code with another application.
- Do not invent a new cross-product visual language that conflicts with the accepted HCIS/SQ design baseline.
