# SQ Hub

Shared digital platform foundation for Sabilul Qur'an.

**Akun SQ** adalah produk identitas/login Staff; **Keycloak** adalah engine di belakangnya. **SQ Hub** adalah launcher/workspace/platform internal, bukan ERP monolith. Business logic HCIS, SPMB, Finance, Workspace, Academic, dan aplikasi domain lain tetap dimiliki aplikasi masing-masing. HCIS adalah authority workforce organization; Organization Directory Hub adalah arah projection/distribution yang runtime-nya masih DISCOVERY, bukan fitur yang sudah live.

## Status — 21 September 2026

**Foundation v1: OPEN — production core tersedia, acceptance keseluruhan belum CLOSED.** Status ACCEPTED pada ADR/specification tidak berarti seluruh Foundation sudah diterima. PRD konsolidasi masih DRAFT sampai ada persetujuan dokumen yang dicatat; accepted ADR/spec tetap berlaku.

Mulai dari catatan terkini:

- [Status proyek 2026-09-21](docs/operations/project-status-2026-09-21.md).
- [Ledger penutupan Foundation v1](docs/operations/foundation-v1-closure.md).
- [Panduan UAT delta production](docs/operations/akun-sq-production-uat-checklist-2026-09-21.md).
- [Bukti deployment GitHub production 2026-09-21](docs/operations/HUB-IMPL-016-deployment-evidence-2026-09-21.md).

Baseline GitHub yang diperiksa: `d2de4411760c963df542a540c6e3e63eee37283e` (merge PR #87). CI dan Hub Production Launcher Contract PASS. Deploy SQ Hub Production run `35581490721` SUCCESS dengan API, web, dan identity **NO-OP**, karena image yang diinginkan sudah berjalan. Keberhasilan ini bukan pengujian recreate, rollback, recovery, Google, atau MFA.

Evidence tidak dimulai dari nol. Ledger identity UAT terdahulu memiliki **27 PASS / 28 NOT_RUN / 3 BLOCKED**: di antaranya pengiriman email recovery, reset/single-use/expired-link, serta lima skenario dasar trusted-device sudah memiliki bukti production. Mandatory blocker Foundation sekarang adalah penyelesaian recovery E2E, Google existing-account/mapping regression, sisa MFA/trusted-device, dan browser storage/cookie security. Baris issue #9 lain yang tidak memetakan ke definisi selesai tersebut tetap backlog jujur, bukan PASS dan bukan blocker Foundation.

SQ Hub production, login Akun SQ, HCIS launch/Application Access, Administrasi SQ surface, dan Account Console desktop/mobile memiliki evidence operator 18 September 2026. Pernyataan lama bahwa Hub belum memiliki DNS/web adalah snapshot historis, bukan kondisi terkini. [Catatan 18 September](docs/operations/project-status-2026-09-18.md) mempertahankan detailnya.

Keputusan PR #67 mengizinkan rilis dengan acceptance tertentu tertunda; keputusan tersebut bukan PASS dan bukan closure Foundation. Instruksi pemilik produk 21 September mengharuskan acceptance penting ditutup sebelum fase berikutnya. [Issue #9](https://github.com/sabilulquran/SQ-Hub/issues/9) tetap menjadi tracker acceptance identity. Dokumen cutover lama adalah rekaman persiapan/rekonsiliasi, bukan izin untuk menjalankan cutover ulang.

## Batas fase aktif

Pekerjaan aktif hanya menutup Foundation: bukti runtime/browser, koreksi defect yang terkonfirmasi, deployment/rollback operational record, dan source of truth.

- PR #42 / HUB-IMPL-013: provisioning/offboarding masih PROPOSED; jangan diimplementasikan dalam closure ini.
- HUB-IMPL-018: Organization Directory runtime masih DISCOVERY. HCIS tetap authority organisasi, approval/workflow tetap domain-owned.
- PR #12: SQ Account/SQ Portal/external identity tetap discovery; bukan backlog implementasi Foundation.

## Keputusan teknis yang tetap berlaku

Employee memakai NIP/employee number sebagai username utama dan verified unique email sebagai alternatif. Staff tanpa NIP memakai verified unique email; NIK bukan login identifier. Technical identity adalah exact OIDC `issuer + sub`, bukan email/NIP.

MFA wajib untuk privileged/security-sensitive Staff; Staff biasa dapat enroll sukarela. SSO idle 8 jam, max 12 jam, Remember Me off. Backend menangani OIDC code/token exchange; browser tidak menyimpan bearer token di persistent storage. Cookie aplikasi tidak dibagi ke seluruh subdomain.

Application Access hanya mengatur entry ke aplikasi, bukan role domain. Platform Administrator bukan super-admin universal. HCIS mempertahankan local principal ID dan tidak memigrasikan password hash/MFA/recovery/session lama ke Keycloak.

Engineering stack mengikuti ADR-0006: TypeScript, Fastify/PostgreSQL, React/Vite/Tailwind sesuai kebutuhan. HCIS visual baseline menjadi dasar design system SQ; shared packages hanya dibuat bila reuse nyata tersedia.

## Source of truth

- [AGENTS.md](AGENTS.md) — aturan engineering dan AI.
- [Visi produk](docs/product/vision.md), [Foundation PRD](docs/product/foundation-prd.md), dan [Implementation Wave 1](docs/product/implementation-wave-1.md).
- [Implementation contracts](docs/specs/), [glossary](docs/domain/glossary.md), dan [ownership/integration](docs/domain/ownership-and-integration.md).
- [Target architecture](docs/architecture/target-architecture.md) dan [ADR](docs/architecture/adr/).
- [Security baseline](docs/security/security-baseline.md) dan [Staff authentication policy](docs/security/staff-authentication-policy.md).
- [HCIS auth cutover plan](docs/migration/hcis-auth-cutover-plan.md).
- [Design-system direction](docs/design/design-system-direction.md) dan [HCIS visual baseline](docs/design/hcis-baseline.md).
- [Operational baseline](docs/operations/operational-baseline.md) dan [AI-assisted workflow](docs/development/ai-assisted-workflow.md).

## Wave 1 historis

Implementation awal terdiri dari HUB-IMPL-001 Keycloak staging, HUB-IMPL-002 Application Registry/Access, dan HUB-IMPL-003 HCIS OIDC. Wave 1 awal tidak mengotorisasi production cutover, Organization Directory integration, full launcher/admin UI, atau SPMB. Promosi production berikutnya memiliki contract/evidence tersendiri; sejarah scope tidak ditulis ulang secara retrospektif.

## Environments

Production: `hub.sabilulquran.or.id` (SQ Hub), `login.sabilulquran.or.id/realms/sq-staff` (Akun SQ issuer), `hcis.sabilulquran.or.id` (HCIS). SPMB adalah integrasi lanjutan, tidak dinyatakan deployed oleh dokumen ini.

Staging: `hub-staging.sabilulquran.or.id`, `hcis-staging.sabilulquran.or.id`, dan issuer `https://login.sabilulquran.or.id/realms/sq-staff-staging`. Staging/production wajib terpisah realm, data, konfigurasi, dan credential walaupun berada pada VPS yang sama.
