# SQ Hub

Shared digital platform foundation for Sabilul Qur'an.

SQ Hub menyediakan fondasi lintas aplikasi untuk identity/SSO staf, Organizational Unit master, Application Registry/Access, Hub Launcher, design system, dan shared capability lain yang benar-benar dibutuhkan lintas domain.

SQ Hub **bukan ERP monolith**. Business logic HCIS, SPMB, Finance, Workspace, Academic, dan aplikasi domain lain tetap dimiliki aplikasi masing-masing.

## Status
Foundation documentation accepted. Wave 1 implementation is in progress.

Current runtime status:
- `HUB-IMPL-002` Application Registry + Application Access — implemented in the SQ Hub API foundation and protected by CI;
- `HUB-IMPL-001` Keycloak staging foundation — next infrastructure implementation;
- `HUB-IMPL-003` HCIS OIDC consumer — follows after the identity/access foundations are available.

Keputusan foundation yang sudah dikunci:
- **SQ Identity menggunakan Keycloak** sebagai self-hosted Identity Provider engine.
- **Employee login menggunakan NIP/employee number sebagai primary username**, dengan verified unique email sebagai alternate login; Staff tanpa NIP memakai verified unique email pada Foundation v1.
- **MFA wajib untuk privileged/security-sensitive Staff**, belum mandatory untuk seluruh Staff pada Foundation v1.
- **SSO session baseline:** idle 8 jam, max 12 jam, Remember Me off pada rollout awal.
- **HCIS auth migration tidak memindahkan password/MFA lama**; local principal ID dipertahankan dan ditautkan ke Keycloak melalui OIDC `issuer + sub`.
- **HCIS frontend menjadi baseline awal SQ Design System**; shared primitives nantinya diekstrak ke SQ Hub.
- **SQ Hub mengikuti engineering family HCIS:** TypeScript, Fastify, PostgreSQL, React/Vite/Tailwind ketika web dibutuhkan.
- **Wave 1 staging naming:** `login.sabilulquran.or.id` uses the `sq-staff-staging` realm and separate staging data/configuration; the application hosts are `hub-staging.sabilulquran.or.id` and `hcis-staging.sabilulquran.or.id`.

## Source of truth
Mulai dari:
- [`AGENTS.md`](AGENTS.md) — aturan engineering dan AI.
- [`docs/product/vision.md`](docs/product/vision.md) — visi dan boundary produk.
- [`docs/product/foundation-prd.md`](docs/product/foundation-prd.md) — requirement Foundation v1.
- [`docs/product/implementation-wave-1.md`](docs/product/implementation-wave-1.md) — scope delivery implementation pertama.
- [`docs/specs/`](docs/specs/) — implementation contracts dengan specification ID.
- [`docs/domain/glossary.md`](docs/domain/glossary.md) — istilah resmi.
- [`docs/domain/ownership-and-integration.md`](docs/domain/ownership-and-integration.md) — ownership data dan integrasi lintas aplikasi.
- [`docs/architecture/target-architecture.md`](docs/architecture/target-architecture.md) — target logical architecture.
- [`docs/architecture/adr/`](docs/architecture/adr/) — keputusan arsitektur accepted.
- [`docs/security/security-baseline.md`](docs/security/security-baseline.md) — security baseline.
- [`docs/security/staff-authentication-policy.md`](docs/security/staff-authentication-policy.md) — login, password, MFA, session, logout, dan recovery policy Staff.
- [`docs/migration/hcis-auth-cutover-plan.md`](docs/migration/hcis-auth-cutover-plan.md) — executable migration/cutover runbook untuk HCIS -> SQ Identity.
- [`docs/design/design-system-direction.md`](docs/design/design-system-direction.md) — arah SQ Design System.
- [`docs/design/hcis-baseline.md`](docs/design/hcis-baseline.md) — snapshot/ringkasan visual HCIS yang menjadi baseline SQ.
- [`docs/operations/operational-baseline.md`](docs/operations/operational-baseline.md) — environment, observability, backup, dan recovery minimum.
- [`docs/development/ai-assisted-workflow.md`](docs/development/ai-assisted-workflow.md) — workflow pengembangan AI-assisted.

## Wave 1
Implementation order:
1. `HUB-IMPL-001` — Keycloak staging foundation.
2. `HUB-IMPL-002` — Application Registry + Application Access.
3. `HUB-IMPL-003` — HCIS OIDC consumer integration.

Wave 1 intentionally does not include production auth cutover, Organization migration, full launcher/admin UI, or SPMB implementation.

## URLs
Production target:
- `hub.sabilulquran.or.id` — SQ Hub launcher.
- `login.sabilulquran.or.id` — SQ Identity / Keycloak entry point.
- `hcis.sabilulquran.or.id` — HCIS.
- `spmb.sabilulquran.or.id` — SPMB.

Wave 1 staging:
- `hub-staging.sabilulquran.or.id`
- `login.sabilulquran.or.id` — SQ Identity staging uses the `sq-staff-staging` realm and separate staging data/configuration.
- `hcis-staging.sabilulquran.or.id`

Staging dan production wajib terpisah secara logis walaupun berada pada VPS yang sama.
