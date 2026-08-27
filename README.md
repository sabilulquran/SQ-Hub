# SQ Hub

Shared digital platform foundation for Sabilul Qur'an.

SQ Hub menyediakan fondasi lintas aplikasi untuk identity/SSO staf, Organizational Unit master, Application Registry/Access, Hub Launcher, design system, dan shared capability lain yang benar-benar dibutuhkan lintas domain.

SQ Hub **bukan ERP monolith**. Business logic HCIS, SPMB, Finance, Workspace, Academic, dan aplikasi domain lain tetap dimiliki aplikasi masing-masing.

## Status
Foundation documentation. Belum ada application implementation.

Keputusan foundation yang sudah dikunci:
- **SQ Identity menggunakan Keycloak** sebagai self-hosted Identity Provider engine.
- **HCIS frontend menjadi baseline awal SQ Design System**; shared primitives nantinya diekstrak ke SQ Hub.

## Source of truth
Mulai dari:
- [`AGENTS.md`](AGENTS.md) — aturan engineering dan AI.
- [`docs/product/vision.md`](docs/product/vision.md) — visi dan boundary produk.
- [`docs/product/foundation-prd.md`](docs/product/foundation-prd.md) — requirement Foundation v1.
- [`docs/domain/glossary.md`](docs/domain/glossary.md) — istilah resmi.
- [`docs/domain/ownership-and-integration.md`](docs/domain/ownership-and-integration.md) — ownership data dan integrasi lintas aplikasi.
- [`docs/architecture/target-architecture.md`](docs/architecture/target-architecture.md) — target logical architecture.
- [`docs/architecture/adr/`](docs/architecture/adr/) — keputusan arsitektur accepted, termasuk IdP dan design baseline.
- [`docs/security/security-baseline.md`](docs/security/security-baseline.md) — security baseline.
- [`docs/design/design-system-direction.md`](docs/design/design-system-direction.md) — arah SQ Design System.
- [`docs/design/hcis-baseline.md`](docs/design/hcis-baseline.md) — snapshot/ringkasan visual HCIS yang menjadi baseline SQ.
- [`docs/operations/operational-baseline.md`](docs/operations/operational-baseline.md) — environment, observability, backup, dan recovery minimum.
- [`docs/development/ai-assisted-workflow.md`](docs/development/ai-assisted-workflow.md) — workflow pengembangan AI-assisted.

## Initial URLs
Target production naming:
- `hub.sabilulquran.or.id` — SQ Hub launcher.
- `login.sabilulquran.or.id` — SQ Identity / Keycloak entry point.
- `hcis.sabilulquran.or.id` — HCIS.
- `spmb.sabilulquran.or.id` — SPMB.

Staging naming masih TBD, tetapi staging dan production wajib terpisah secara logis walaupun berada pada VPS yang sama.
