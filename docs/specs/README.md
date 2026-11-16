# SQ Hub specification ID index

**Terms (ADR-0014, 2026-11-16):** SQ Suite is the whole ecosystem; SQ Hub is its landing page and launcher. This index covers the `SQ-Hub` repository, which holds the SQ Hub platform (the SQ Hub landing page and launcher, Akun SQ, Admin SQ, Direktori Organisasi) and the applications that run inside the Hub process (Kirim SQ, Portal Organ, Kerja SQ, Sekretariat SQ). Accepted specifications are not rewritten: where one says "modul `kirim`/`kerja`/`sekretariat` di SQ Hub" or "SQ Core", read it with the table in ADR-0014 D8. Whether something is running in production is recorded in [`docs/product/struktur-sq-suite.md`](../product/struktur-sq-suite.md) §5, not here.

Staging references inside older specifications are historical: staging was permanently retired on 2 October 2026 and must not be recreated.

Indeks ini membantu maintainer menemukan specification yang berada di `main` dan statusnya. Keberadaan sebuah ID di indeks **bukan** persetujuan implementasi, deployment, atau acceptance runtime. Status normatif tetap mengikuti dokumen specification dan source of truth yang lebih tinggi sesuai `AGENTS.md`.

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
| HUB-IMPL-013 | [Identity Lifecycle pegawai](HUB-IMPL-013-go5c-staff-provisioning-offboarding.md) | **ACCEPTED** 2026-10-02; controlled production UAT amendment. Repository implementation and production activation evidence are tracked separately (`docs/operations/HUB-IMPL-013-*`). |
| HUB-IMPL-015 | [Akun SQ account experience](HUB-IMPL-015-akun-sq-account-experience.md) | **ACCEPTED**; redesign login dan Account Console tanpa perubahan protokol/issuer. |
| HUB-IMPL-016 | [SQ Hub production launcher release package](HUB-IMPL-016-hub-production-launcher.md) | **ACCEPTED**; repository contract/runbook untuk launcher production, tanpa klaim deployment live. |
| HUB-IMPL-017 | [SQ Hub + Akun SQ navigation experience](HUB-IMPL-017-sq-hub-akun-sq-navigation-experience.md) | Lihat status pada specification. |
| HUB-IMPL-018 | [Organization Directory v1](HUB-IMPL-018-organization-directory-foundation.md) | **ACCEPTED**; full-snapshot HCIS -> Hub contract, service identity, LKG/staleness, dan read contract untuk consumer termasuk Aset SQ. |
| HUB-IMPL-019 | [Native Akun SQ experience](HUB-IMPL-019-native-akun-sq-experience.md) | **ACCEPTED**; halaman akun native di `hub.sabilulquran.or.id/account`. |
| HUB-IMPL-020 | [Cross-system Visual Polish](HUB-IMPL-020-cross-system-visual-polish.md) | **ACCEPTED** atas permintaan pengguna; enhancement visual non-blocking pasca-closure. Foundation dan Organization Directory tetap **CLOSED**. |
| HUB-IMPL-021 | [Ringkasan Yayasan](HUB-IMPL-021-ringkasan-yayasan.md) | **ACCEPTED** 2026-10-17 bersama ADR-0009; kontrak ringkasan tata kelola per aplikasi (wajah Laporan menurut ADR-0014) dan keanggotaan organ. §5 (halaman Ringkasan Yayasan sebagai pintu organ) digantikan ORGAN-IMPL-001 saat `PORTAL_ORGAN_ENABLED` menyala; §1–§4 tetap dipakai. |
| HUB-IMPL-022 | [Shared app launcher list](HUB-IMPL-022-shared-app-launcher-list.md) | **ACCEPTED** 2026-10-23; endpoint peluncur internal untuk header tiap aplikasi, tabel key -> ikon. |
| HUB-IMPL-023 | [Admin Platform memberi peran HCIS](HUB-IMPL-023-hcis-role-administration.md) | **ACCEPTED**, revisi 7, 2026-11-02 (di bawah keputusan berdiri owner 2026-10-27; lihat catatan status pada specification); kanal pemberian peran HCIS dari Admin SQ dan pengaman keanggotaan Admin Platform. |
| HUB-IMPL-024 | [Aktivasi pegawai diminta HCIS](HUB-IMPL-024-hcis-staff-activation-invite.md) | **ACCEPTED** 2026-11-04; `POST /internal/v1/staff-activation/invite` untuk machine client HCIS (`STAFF_ACTIVATION_ALLOWED_CLIENTS`): Akun SQ dari data HCIS, email Keycloak `VERIFY_EMAIL`+`UPDATE_PASSWORD`, akses `hcis` bila belum ada catatan. |
| KIRIM-IMPL-001 | [Kirim SQ R1: nomor dan kirim](KIRIM-IMPL-001-r1-nomor-dan-kirim.md) | **ACCEPTED** (PO, 2026-10-17); R1 diimplementasikan di repository (bawaan `KIRIM_ENABLED=false`); flag menyala di production per pemeriksaan 2026-11-16 (STRUKTUR-001 §10). |
| KIRIM-IMPL-002 | [Kirim SQ R2: API percakapan, grup, dan impor riwayat](KIRIM-IMPL-002-r2-api-percakapan.md) | **ACCEPTED** (PO, 2026-10-19); T-1…T-6 disetujui. Langkah production §15 butuh persetujuan owner; J-1 di JalurPesan adalah gate kerja harian SPMB. |
| KIRIM-IMPL-003 | [Kirim SQ: kartu WhatsApp per modul dan akses otomatis](KIRIM-IMPL-003-kartu-modul.md) | **ACCEPTED** (permintaan PO 2026-11-03). Kartu per aplikasi registry, nomor bersama, akses aplikasi pemakai tanpa salin kredensial; HCIS konsumen pertama. (Judul specification memakai kata "modul" untuk aplikasi pemakai; itu istilah lama.) |
| ORGAN-IMPL-001 | [Portal Organ Yayasan](ORGAN-IMPL-001-portal-organ.md) | **ACCEPTED** (PO, 2026-11-12) bersama ADR-0012. `organ.sabilulquran.or.id` menggantikan Ringkasan Yayasan sebagai pintu organ; R1 dasbor, R2 keputusan, R3 laporan bulanan dengan analisis Claude. **R1 diimplementasikan** di repository (PR #210, #213) dan `PORTAL_ORGAN_ENABLED` menyala di production per pemeriksaan 2026-11-16 (STRUKTUR-001 §5.2, §10); R2 dan R3 belum dimulai. |
| KIRIM-IMPL-004 | [Kirim SQ K3.2: aksi pesan, panggilan, foto profil, grup bersama, dan API grup R3](KIRIM-IMPL-004-k3-2-aksi-pesan-panggilan-grup.md) | **Dibangun** di repository (2026-11-05) untuk SPMB-IMPL-005 K3.2/K3.4; batas edit/hapus/tambah anggota `DRAFT` sampai diukur. |
| SEK-IMPL-001 | [Sekretariat R1: buku nomor, arsip surat, kotak masuk](SEK-IMPL-001-r1-buku-nomor-arsip-kotak-masuk.md) | **ACCEPTED** (PO, 2026-11-13); keputusan §16 dikunci sesuai usulan. Buku nomor pedoman tata naskah + migrasi DOC-003 dari HCIS, arsip PDF surat, kotak masuk email `sekretariat@` (IMAP baca-saja) + disposisi, akses berlapis. Sekretariat SQ adalah aplikasi yang berjalan di proses Hub (folder kode `sekretariat`, pola ADR-0011; ADR-0014 D6 alasan 3); **dibangun** di repository (PR #212), bawaan `SEKRETARIAT_ENABLED=false` dan belum dinyalakan. Langkah production §14 mengikuti aturan rilis owner 2026-10-27. |
| KERJA-IMPL-001 | [Kerja SQ R1: papan kerja](KERJA-IMPL-001-r1-papan-kerja.md) | **ACCEPTED** (PO, 2026-11-10); keputusan §16 dikunci (kuota ruang 1 GB, nama tampilan "Kerja", pengingat WhatsApp di R2). Kerja SQ adalah aplikasi yang berjalan di proses Hub (folder kode `kerja`, pola ADR-0011; ADR-0014 D6 alasan 3); **dibangun** di repository 2026-11-10, bawaan `KERJA_ENABLED=false`; flag menyala di production per pemeriksaan 2026-11-16 (STRUKTUR-001 §10). |

## ID proposal aktif yang belum berada di `main`

Tidak ada per 2026-11-16. HUB-IMPL-013, -021, -022, -023, dan -024, yang dahulu tercatat di sini, sudah berada di `main` dan dipindahkan ke tabel di atas. Nomor berikutnya yang bebas: HUB-IMPL-025.

## Proposal yang disupersede

- **HUB-IMPL-014 / PR #43 — Organizational Unit master foundation** adalah proposal historis yang bertentangan dengan keputusan Product Owner 18 September 2026. ADR-0007 menetapkan HCIS sebagai workforce organization authoring/system of authority dan platform SQ Hub hanya sebagai Organization Directory projection/distribution. Proposal #43 tidak boleh dijadikan merge/cutover path; discovery penggantinya adalah HUB-IMPL-018.
- PR gabungan historis #45 masih memuat nomor proposal lama HUB-IMPL-011/012 pada branch-nya dan tetap superseded. Branch historis tidak mengubah pemetaan ID aktif di atas.

## Bukti staging historis

Bukti staging Wave 1 tanggal 6 September 2026 dipertahankan di [`docs/operations/HUB-IMPL-003-production-readiness-2026-09-06.md`](../operations/HUB-IMPL-003-production-readiness-2026-09-06.md), dan ledger persiapan production dipertahankan di [`docs/operations/HUB-IMPL-003-production-cutover.md`](../operations/HUB-IMPL-003-production-cutover.md). Keduanya adalah **rekaman historis/superseded sesuai tanggalnya**, bukan status runtime terkini. Status Foundation terbaru berada di [`docs/operations/project-status-2026-09-23.md`](../operations/project-status-2026-09-23.md). Organization Directory adalah fase pasca-Foundation yang juga sudah ditutup; ledger terbarunya berada di [`docs/operations/HUB-IMPL-018-production-acceptance-2026-09-25.md`](../operations/HUB-IMPL-018-production-acceptance-2026-09-25.md).
