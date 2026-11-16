# SQ Hub

**SQ Hub** adalah nama seluruh ekosistem aplikasi Yayasan Sabilul Qur'an (ADR-0014): satu nama payung, satu akun per orang per portal, dan aplikasi-aplikasi yang berdiri berdampingan. Istilah "SQ Core" sudah tidak dipakai, kecuali pada nama teknis dan catatan lama.

Repository ini (`SQ-Hub`) memuat **bagian platform SQ Hub** — Beranda (halaman awal dan peluncur aplikasi), Akun SQ (identity/SSO), Admin SQ (Application Registry/Access, peran, siklus akun), Direktori Organisasi, dan design system — serta aplikasi yang berjalan di dalam proses Hub menurut ADR-0014 D6: Kirim SQ, Portal Organ, Kerja SQ, Sekretariat SQ, dan (disetujui, belum dibangun) Al-Qur'an. Workforce organization tetap di-author oleh HCIS; platform mendistribusikan projection lintas aplikasi sesuai ADR-0007.

SQ Hub **bukan ERP monolith**. Aturan dan data HCIS, SPMB SQ, Keuangan, Sekolah, dan aplikasi lain tetap dimiliki aplikasi masing-masing. Aplikasi yang berjalan di proses Hub tetap memiliki tabel, aturan, dan flag rilisnya sendiri.

## Istilah dan peta

| Istilah | Arti |
| --- | --- |
| **SQ Hub** | Seluruh ekosistem |
| **Portal** | Pintu masuk satu kelompok pengguna: Admin, Pegawai, Organ, Keluarga, Pelamar, Situs publik |
| **Aplikasi** | Sistem yang mengurus satu bidang dan memegang data serta aturannya (HCIS, Aset SQ, Kirim SQ, Kerja SQ, …) |
| **Modul** | Bagian di dalam satu aplikasi (Cuti dan Payroll di dalam HCIS) |

Daftar aplikasi, portal, alamat, dan statusnya **hanya** disimpan di [`docs/product/struktur-sq-hub.md`](docs/product/struktur-sq-hub.md) (STRUKTUR-001). Dokumen lain, termasuk README ini, menautkan ke sana dan tidak menyimpan daftar sendiri. Keputusannya ada di [ADR-0014](docs/architecture/adr/0014-sq-hub-ecosystem-structure.md).

## Status
Foundation (Akun SQ dan dasar platform) **CLOSED** pada 2026-09-23 ([`project-status-2026-09-23.md`](docs/operations/project-status-2026-09-23.md)); Organization Directory v1 diterima di production pada 2026-09-25. Status tiap aplikasi dan alamat yang berjalan ada di STRUKTUR-001 §5 dan §10. Status deployment tidak boleh disimpulkan hanya dari status specification atau merge.

Production berjalan di host Mi8 sebagai proses Node biasa, tanpa container ([`vps-deployment-retired-2026-10-19.md`](docs/operations/vps-deployment-retired-2026-10-19.md)). Staging di VPS production dipensiunkan permanen pada 2 Oktober 2026 ([`permanent-staging-retirement-2026-10-02.md`](docs/operations/permanent-staging-retirement-2026-10-02.md)); topologinya production-only. Dokumen `project-status-2026-09-15` s.d. `-09-18` dan ledger HUB-IMPL-003 adalah catatan lama sesuai tanggalnya.

Keputusan foundation yang sudah dikunci:
- **SQ Identity menggunakan Keycloak** sebagai self-hosted Identity Provider engine.
- **Employee login menggunakan NIP/employee number sebagai primary username**, dengan verified unique email sebagai alternate login; Staff tanpa NIP memakai verified unique email pada Foundation v1.
- **MFA wajib untuk privileged/security-sensitive Staff**, belum mandatory untuk seluruh Staff pada Foundation v1.
- **SSO session baseline:** idle 8 jam, max 12 jam, Remember Me off pada rollout awal.
- **HCIS auth migration tidak memindahkan password/MFA lama**; local principal ID dipertahankan dan ditautkan ke Keycloak melalui OIDC `issuer + sub`.
- **HCIS tetap system of authority dan authoring untuk workforce organization**; platform SQ Hub menyediakan shared Organization Directory projection/distribution, sedangkan approval/workflow tetap dimiliki aplikasi domain (ADR-0007).
- **HCIS frontend menjadi baseline awal SQ Design System**; shared primitives nantinya diekstrak ke platform SQ Hub (repo `SQ-Hub`).
- **Repo `SQ-Hub` mengikuti engineering family HCIS:** TypeScript, Fastify, PostgreSQL, React/Vite/Tailwind ketika web dibutuhkan.

## Source of truth
Mulai dari:
- [`docs/product/struktur-sq-hub.md`](docs/product/struktur-sq-hub.md) — peta SQ Hub: istilah, portal, daftar aplikasi dan statusnya (STRUKTUR-001).
- [`AGENTS.md`](AGENTS.md) — aturan engineering dan AI.
- [`docs/product/vision.md`](docs/product/vision.md) — visi dan boundary produk.
- [`docs/product/roadmap-and-decision-register.md`](docs/product/roadmap-and-decision-register.md) — register keputusan per fase dan per aplikasi.
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

## Wave 1 (catatan lama)
Urutan implementation pertama, sudah selesai: `HUB-IMPL-001` (Keycloak foundation), `HUB-IMPL-002` (Application Registry + Application Access), `HUB-IMPL-003` (HCIS OIDC consumer integration). Lihat [`docs/product/implementation-wave-1.md`](docs/product/implementation-wave-1.md). Indeks seluruh specification ada di [`docs/specs/README.md`](docs/specs/README.md).

## Alamat
Semua alamat production (`hub.`, `login.`, `organ.`, `kirim.`, `kerja.`, dan alamat tiap aplikasi) beserta hasil pemeriksaan terakhirnya ada di STRUKTUR-001 §2, §5, dan §10. Host staging Wave 1 (`hub-staging`, `hcis-staging`, realm `sq-staff-staging`) sudah dipensiunkan dan tidak boleh dibuat ulang.
