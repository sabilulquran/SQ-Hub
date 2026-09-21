# Status proyek SQ Hub — 21 September 2026

**Foundation v1: OPEN.** Dokumen ini mencatat audit GitHub dan evidence operator yang sudah tersedia, bukan pengujian live baru oleh penulis. Pemilik produk meminta Foundation ditutup berdasarkan evidence sebelum fase berikutnya.

## Bahasa pengguna

Pintu masuk Akun SQ, workspace SQ Hub, akses ke HCIS, tampilan Administrasi SQ, dan Account Console sudah tersedia di production. Jalur deployment GitHub juga berhasil dijalankan. Yang belum selesai adalah pembuktian lengkap keamanan akun dan akses, serta penutupan catatan acceptance.

Sebagian pengujian sebenarnya sudah dikerjakan: recovery pernah mengirim email yang diterima, reset berhasil, tautan sekali pakai dan kedaluwarsa ditolak; lima pengujian dasar perangkat tepercaya juga sudah PASS. Bukti ini tidak dibuang hanya karena ringkasan yang lebih baru menyebut semuanya pending.

## GitHub yang diverifikasi ulang

| Item | Hasil |
| --- | --- |
| Main audit | `d2de4411760c963df542a540c6e3e63eee37283e` |
| PR #86 | Merged sebagai `f0ba16e9766b8789e0e938c4c50c52741bf03b16`; deployment memakai runtime bundle, bukan Git checkout |
| PR #87 | Merged sebagai main audit; existing `postgres` diterima sebagai runtime infrastructure |
| CI | [35580989736](https://github.com/sabilulquran/SQ-Hub/actions/runs/35580989736), SUCCESS |
| Hub Production Launcher Contract | [35580989547](https://github.com/sabilulquran/SQ-Hub/actions/runs/35580989547), SUCCESS |
| Deploy SQ Hub Production | [35581490721](https://github.com/sabilulquran/SQ-Hub/actions/runs/35581490721), SUCCESS; target exact main audit, scope auto |
| Open PR saat audit awal | #84 documentation; #42 proposal lifecycle; #12 discovery account/portal |

Log job `106275169815` benar-benar dibaca melalui GitHub. Ia memuat preflight PASS, tiga NO-OP, backup Compose, dan `SQ_HUB_PRODUCTION_DEPLOY_PASS`. [Deployment evidence](HUB-IMPL-016-deployment-evidence-2026-09-21.md) memisahkan hasil tersebut dari fakta yang belum diuji.

## Status per lapisan

| Area | Implemented / deployed | Verified / acceptance |
| --- | --- | --- |
| Core Akun SQ + Hub | Ya, operator evidence 18 September dan deployment health path 21 September | Core login/workspace accepted pada journey yang diuji |
| HCIS launch / Application Access | Ya | Ordinary launch dan beberapa deny/outage/session behaviors memiliki production atau accepted staging evidence; bukan semua persona |
| Administrasi SQ foundation | Ya, surface sesuai akun berwenang dilaporkan operator | Jangan menyamakan surface visibility dengan seluruh authorization matrix |
| Account Console | PR #81 image deployed | Desktop dan mobile 390×844 browser-verified 18 September |
| Recovery | Ya | Legacy 3.3–3.5 PASS; detail new/old password login dan disabled-user recovery masih perlu evidence terpisah |
| Google | Source/configuration tersedia | 4.1–4.5 NOT_RUN: unknown account, local-proof linking, MFA, same mapping, no privilege change |
| Trusted device / MFA | Provider/flow tersedia | 5.1–5.5 PASS; 5.6–5.12 dan privileged/recovery-code matrix belum selesai |
| Browser storage/cookie | Kontrak source tersedia | Legacy 7.1–7.4 NOT_RUN; pemeriksaan Hub juga wajib sesuai HUB-IMPL-016 |
| GitHub deployment | Source merged dan run berhasil | NO-OP path PASS, bukan bukti recreate atau rollback rehearsal |
| Directory / lifecycle / portal | Boundary/design/proposal ada | Bukan runtime implementasi Foundation |

Sumber core production: [status 18 September](project-status-2026-09-18.md). Sumber identity UAT: [matrix HUB-IMPL-003](HUB-IMPL-003-production-cutover.md#execution-matrix--58-scenarios), [status 17 September](project-status-2026-09-17.md), dan [issue #9](https://github.com/sabilulquran/SQ-Hub/issues/9).

## Exact gap yang tersisa

Ledger historis tetap **27 PASS / 28 NOT_RUN / 3 BLOCKED**, tetapi tidak semua baris yang belum dijalankan adalah blocker Foundation saat ini. Definisi selesai 21 September menaikkan hanya acceptance yang secara eksplisit dibutuhkan untuk penutupan Foundation.

Mandatory closure gaps:

- **Recovery E2E:** pertahankan 3.3–3.5 PASS; buktikan fresh login dengan password baru berhasil, password lama ditolak, dan identity/access tidak berubah (F-REC).
- **Google existing-account / mapping:** 4.1–4.5, ditambah wrong/unknown mapping fail-closed (1.5/6.5) dan regression login NIP/email biasa yang relevan.
- **MFA / trusted device:** pertahankan 5.1–5.5 PASS; selesaikan privileged MFA/recovery dan contract-defined expiry/invalidation/security remainder. Non-browser crypto invariants boleh memakai exact automated evidence bila benar-benar menutup invariant yang sama.
- **Browser security:** 7.1–7.4 dan pemeriksaan Hub sesuai HUB-IMPL-016.
- **Documentation closure:** PR #88 harus review/CI/merge dengan approval; final owner sign-off setelah mandatory acceptance di atas selesai.

Historical issue #9 rows yang tidak memetakan langsung ke checklist closure—misalnya ekspansi persona non-Employee/manager/HC-admin, fixture bookkeeping, dan Keycloak outage 9.1–9.3—tetap backlog yang jujur, bukan PASS dan bukan blocker Foundation. Keycloak outage tetap hanya boleh dijalankan pada target terisolasi/production-like; jangan menghentikan Keycloak production.

## Keputusan rilis bukan keputusan selesai

PR #67 pada 17 September merekam izin rilis walaupun beberapa UAT tertunda. Keputusan itu tetap sah sebagai catatan rilis historis, tetapi tidak menaikkan NOT_RUN/BLOCKED ke PASS. Instruksi pemilik produk 21 September menetapkan acceptance penting sebagai syarat **closure Foundation**. Tidak ada acceptance owner yang menandatangani final Foundation closure dalam audit ini.

Dokumen cutover lama tetap menyimpan histori `CUTOVER_BLOCKED` dan gap rekonsiliasi. Audit ini tidak mengarang izin cutover masa lalu, jadwal, backup database, custody attestations, atau hasil rollback yang belum tersedia. Kondisi runtime yang sudah hidup tidak perlu dicutover ulang untuk merapikan catatan.

## Audit PR #84

PR #84 dibuat dari `42031c6d1bbe85b79de9d010cf9fa7f7e679f621`, head `fec71076e312b573ccd5ee28bf56dbd4cd246980`; metadata audit melaporkan `mergeable=false`. Main sudah maju 16 commit dari baseline tersebut, dengan perubahan deployment contract/runtime bundle.

Selain baseline lama, PR #84 memiliki masalah isi: bahasa ACCEPTED terlalu luas, browser checks disebut opsional, beberapa matrix security terlewat, dan bukti recovery/trust 17 September tidak dibawa secara tepat. Karena itu paket ini dibangun ulang dari current main, bukan membawa branch lama secara buta. Replacement PR #88 sudah dibuat dari current main; PR #84 kemudian ditutup sebagai superseded dengan tautan ke #88 dan tidak di-merge. State cleanup dicatat pada [ledger closure](foundation-v1-closure.md).

## Langkah aktif

Gunakan [panduan UAT delta](akun-sq-production-uat-checklist-2026-09-21.md) dan [ledger closure](foundation-v1-closure.md). Mulai dari browser baseline, lalu recovery + password invalidation, Google existing-account/mapping matrix, dan sisa MFA/trusted-device. Catat hasil per ID, bukan satu pesan PASS untuk semua. Persona tambahan dan outage rehearsal yang tidak memetakan ke checklist closure tetap backlog issue #9.

Tidak ada source code, workflow, Compose, image, secret, DNS, database, Keycloak realm, user, role, Application Access, atau runtime production yang diubah oleh paket dokumentasi ini. Merge dan production deployment memerlukan persetujuan terpisah.
