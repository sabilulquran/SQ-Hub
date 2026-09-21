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

Ledger historis tetap **27 PASS / 28 NOT_RUN / 3 BLOCKED**, bukan persentase keseluruhan Foundation. Terdapat gate administratif dan staging reuse di dalam angka PASS tersebut.

NOT_RUN yang harus ditelusuri, bukan dihapus dari scope secara diam-diam:

- Identity/persona/domain continuity: `1.4`, `1.5`, `2.2`–`2.4`, `6.2`, `6.3`, `6.5`, serta fixture assignment `10.2`.
- Privileged MFA/recovery: `3.1`, `3.2`, `3.6`.
- Google: `4.1`–`4.5`.
- Trusted-device remainder: `5.6`–`5.12`.
- Browser storage/cookie: `7.1`–`7.4`.

Keycloak outage `9.1`–`9.3` tetap BLOCKED sampai target terisolasi/production-like tersedia. Jangan menghentikan Keycloak production. Accepted staging SQ Hub outage/revoke/logout evidence tetap dapat dipakai untuk perilaku yang benar-benar sama sesuai no-repeat rule; bukan pengganti Keycloak-outage matrix yang berbeda.

Delta closure di luar ID historis dicatat dengan prefix `F-`: password baru/lama sesudah reset, browser Hub, Administrasi SQ boundary, global logout lintas Hub/HCIS, operational evidence reconciliation, dan persetujuan akhir. Prefix baru mencegah mengubah jumlah 58 baris atau menghitung satu pengujian dua kali.

## Keputusan rilis bukan keputusan selesai

PR #67 pada 17 September merekam izin rilis walaupun beberapa UAT tertunda. Keputusan itu tetap sah sebagai catatan rilis historis, tetapi tidak menaikkan NOT_RUN/BLOCKED ke PASS. Instruksi pemilik produk 21 September menetapkan acceptance penting sebagai syarat **closure Foundation**. Tidak ada acceptance owner yang menandatangani final Foundation closure dalam audit ini.

Dokumen cutover lama tetap menyimpan histori `CUTOVER_BLOCKED` dan gap rekonsiliasi. Audit ini tidak mengarang izin cutover masa lalu, jadwal, backup database, custody attestations, atau hasil rollback yang belum tersedia. Kondisi runtime yang sudah hidup tidak perlu dicutover ulang untuk merapikan catatan.

## Audit PR #84

PR #84 dibuat dari `42031c6d1bbe85b79de9d010cf9fa7f7e679f621`, head `fec71076e312b573ccd5ee28bf56dbd4cd246980`; metadata audit melaporkan `mergeable=false`. Main sudah maju 16 commit dari baseline tersebut, dengan perubahan deployment contract/runtime bundle.

Selain baseline lama, PR #84 memiliki masalah isi: bahasa ACCEPTED terlalu luas, browser checks disebut opsional, beberapa matrix security terlewat, dan bukti recovery/trust 17 September tidak dibawa secara tepat. Karena itu paket ini dibangun ulang dari current main, bukan membawa branch lama secara buta. PR #84 harus ditutup sebagai superseded dengan tautan replacement setelah replacement berhasil dibuat; tidak di-merge. State cleanup dicatat pada [ledger closure](foundation-v1-closure.md).

## Langkah aktif

Gunakan [panduan UAT delta](akun-sq-production-uat-checklist-2026-09-21.md) dan [ledger closure](foundation-v1-closure.md). Jalankan baseline browser sebelum invalidation, siapkan Google fixture yang email assertion-nya benar-benar cocok, lalu selesaikan matrix melalui approved synthetic identities. Catat hasil per ID, bukan satu pesan PASS untuk semua.

Tidak ada source code, workflow, Compose, image, secret, DNS, database, Keycloak realm, user, role, Application Access, atau runtime production yang diubah oleh paket dokumentasi ini. Merge dan production deployment memerlukan persetujuan terpisah.
