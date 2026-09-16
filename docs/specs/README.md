# SQ Hub specification ID index

Indeks ini membantu maintainer membedakan specification yang sudah berada di `main` dari proposal yang masih berada di Pull Request. Keberadaan sebuah ID di indeks **bukan** persetujuan implementasi, deployment, atau acceptance runtime. Status normatif tetap mengikuti dokumen specification dan source of truth yang lebih tinggi sesuai `AGENTS.md`.

## Specification di `main`

| ID | Dokumen di `main` | Catatan |
| --- | --- | --- |
| HUB-IMPL-001 | [Keycloak staging](HUB-IMPL-001-keycloak-staging.md) | Lihat status pada specification. |
| HUB-IMPL-002 | [Application Registry + Application Access](HUB-IMPL-002-application-registry-access.md) | Lihat status pada specification. |
| HUB-IMPL-003 | [HCIS OIDC client](HUB-IMPL-003-hcis-oidc-client.md) | Lihat status pada specification. |
| HUB-IMPL-004 | [SQ Hub shell](HUB-IMPL-004-sq-hub-shell.md) | Lihat status pada specification. |
| HUB-IMPL-005 | [Hub authenticated workspace](HUB-IMPL-005-hub-authenticated-workspace.md) | Lihat status pada specification. |
| HUB-IMPL-006 | [Hub/HCIS visual parity](HUB-IMPL-006-hub-hcis-visual-parity.md) | Lihat status pada specification. |
| HUB-IMPL-007 | [SQ Admin Center access foundation](HUB-IMPL-007-sq-admin-center-access-foundation.md) | Lihat status pada specification. |
| HUB-IMPL-008 | [SQ Identity/HCIS visual parity](HUB-IMPL-008-sq-identity-hcis-visual-parity.md) | Lihat status pada specification. |
| HUB-IMPL-009 | [SQ Admin Center Application Access](HUB-IMPL-009-sq-admin-center-application-access.md) | Lihat status pada specification. |
| HUB-IMPL-010 | [Akun SQ UI polish](HUB-IMPL-010-akun-sq-ui-polish.md) | Lihat status pada specification. |
| HUB-IMPL-011 | [Akun SQ recovery and Google sign-in](HUB-IMPL-011-identity-recovery-google.md) | **ACCEPTED** di `main`; nomor ini tidak tersedia untuk proposal lain. |
| HUB-IMPL-012 | [Akun SQ trusted device for TOTP](HUB-IMPL-012-trusted-device-totp.md) | **ACCEPTED** di `main`; nomor ini tidak tersedia untuk proposal lain. |

## ID proposal aktif yang belum berada di `main`

| ID | Proposal | Status saat rekonsiliasi 2026-09-15 |
| --- | --- | --- |
| HUB-IMPL-013 | [PR #42 — Go 5C staff provisioning and offboarding](https://github.com/sabilulquran/SQ-Hub/pull/42) | **DRAFT / PROPOSED**. ID menggantikan nomor proposal lama HUB-IMPL-011 yang berbenturan dengan specification accepted. Belum memberi izin merge atau deployment. |
| HUB-IMPL-014 | [PR #43 — Organizational Unit master foundation](https://github.com/sabilulquran/SQ-Hub/pull/43) | **DRAFT / PROPOSED**. ID menggantikan nomor proposal lama HUB-IMPL-012 yang berbenturan dengan specification accepted. Belum memberi izin merge, cutover, atau deployment. |

PR gabungan historis #45 masih memuat nomor proposal lama HUB-IMPL-011/012 pada branch-nya, tetapi sudah ditutup sebagai superseded setelah perbaikan yang masih berguna dipindahkan ke PR #42 dan #43. Branch historis tidak mengubah pemetaan ID aktif di atas.

## Bukti staging historis

Bukti staging Wave 1 tanggal 6 September 2026 dipertahankan di [`docs/operations/HUB-IMPL-003-production-readiness-2026-09-06.md`](../operations/HUB-IMPL-003-production-readiness-2026-09-06.md). Dokumen tersebut adalah **rekaman historis sesuai tanggalnya**, bukan status runtime terkini. Untuk rekonsiliasi kondisi per 15 September 2026, gunakan [`docs/operations/project-status-2026-09-15.md`](../operations/project-status-2026-09-15.md).
