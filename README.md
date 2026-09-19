# SQ Hub

Shared digital platform foundation for Sabilul Qur'an.

SQ Hub menyediakan fondasi lintas aplikasi untuk identity/SSO staf, shared Organization Directory, Application Registry/Access, Hub Launcher, design system, dan shared capability lain yang benar-benar dibutuhkan lintas domain. Workforce organization tetap di-author oleh HCIS; SQ Hub mendistribusikan projection lintas aplikasi sesuai ADR-0007.

SQ Hub **bukan ERP monolith**. Business logic HCIS, SPMB, Finance, Workspace, Academic, dan aplikasi domain lain tetap dimiliki aplikasi masing-masing.

## Status
Foundation v1 sekarang berstatus **ACCEPTED**. Core Akun SQ + SQ Hub telah melewati fase rancangan awal dan memiliki evidence production untuk login/SSO, launcher, Application Access, Administrasi SQ foundation, serta Account Console.

Ringkasan status terkini:
- [`docs/operations/project-status-2026-09-19.md`](docs/operations/project-status-2026-09-19.md)

Pemisahan evidence tetap wajib:
- **repository/CI** membuktikan source/configuration dan automated contract;
- **operator/runtime/browser** membuktikan kondisi production pada waktu pengujian;
- capability yang masih memerlukan runtime acceptance tidak boleh dinyatakan selesai hanya karena source sudah merge.

Status ringkas per area:
- **Akun SQ core** — production;
- **SQ Hub launcher** — production;
- **HCIS SSO + Application Access** — production;
- **Account Console** — production dan responsive;
- **password recovery / Google / trusted-device** — source sudah accepted dan production component teramati aktif, tetapi journey end-to-end masih membutuhkan evidence penutupan;
- **Staff provisioning/offboarding** — proposal HUB-IMPL-013, belum accepted;
- **Organization Directory HCIS → Hub** — boundary Accepted melalui ADR-0007, runtime masih HUB-IMPL-018 DISCOVERY;
- **SQ Portal / universal person / external identity** — visi/discovery lanjutan, bukan scope Foundation v1.

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

Wave 1 intentionally does not include production auth cutover, Organization Directory integration, full launcher/admin UI, or SPMB implementation. Production deployment yang kemudian teramati harus direkonsiliasi sebagai operational evidence terpisah; hal itu tidak mengubah non-goal historis atau acceptance criteria secara retrospektif.

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
