# Status proyek SQ Hub — 2026-09-16

> Dokumen ini adalah snapshot audit 16 September 2026. Status UAT terbaru dan aturan agar pengujian yang sudah diterima tidak diulang tersedia di [`project-status-2026-09-17.md`](./project-status-2026-09-17.md).

Dokumen ini menyelaraskan keadaan checkout lokal, GitHub, dan audit langsung VPS pada 16 September 2026 sekitar 10:36 WIB. Pemeriksaan VPS bersifat read-only: tidak ada container, database, DNS, secret, atau konfigurasi production yang diubah.

## Ringkasan untuk pembaca non-engineer

Fondasi login terpusat sudah berjalan di production. Pengguna HCIS diarahkan ke Akun SQ/Keycloak, dan server HCIS, Akun SQ, serta API SQ Hub terpantau sehat. Fitur lupa password, login alternatif melalui email, Google sign-in, dan trusted device juga sudah terpasang pada konfigurasi production.

Proyek belum dapat disebut selesai. Yang sudah berjalan belum seluruhnya memiliki bukti pengujian pengguna dan prosedur operasi yang diwajibkan. Launcher publik `hub.sabilulquran.or.id` belum tersedia, staging sedang berhenti, backup belum ditemukan berjalan terjadwal, restore production belum dibuktikan, audit event Keycloak belum aktif, dan log Docker belum memiliki rotasi.

Source code lokal dan GitHub sudah sinkron. `main` berada di `a09886a6e02a699bb77fd18bf9262a07f48dbda4` dan CI berhasil. Commit setelah versi runtime utama hanya mengubah dokumentasi; tidak ada alasan teknis untuk mengganti image production pada audit ini.

## Status per lapisan

| Lapisan | Status | Bukti langsung | Makna praktis |
| --- | --- | --- | --- |
| Checkout lokal | Sinkron | Worktree bersih; `main` sama dengan `origin/main` di `a09886a` | Tidak ada code lokal yang tertinggal atau belum terkirim. |
| GitHub `main` | Sehat | CI dan Wave 1 Acceptance Contract sukses untuk `a09886a` | Pemeriksaan otomatis source code lulus. Ini bukan pengganti UAT browser. |
| HCIS production | Berjalan | Web dan API healthy; image `sha-9e9098c...`; API melaporkan `AUTH_MODE=oidc`; endpoint publik HTTP 200 | Login production sudah memakai Akun SQ dan tidak berjalan sebagai local-password mode. |
| SQ Identity production | Berjalan | Keycloak healthy; discovery issuer production HTTP 200; Google provider aktif; reset password dan email login aktif; trusted-device provider, signing key, dan flow terpasang | Kemampuan identity utama tersedia, tetapi alur pengguna lengkap masih membutuhkan UAT. |
| SQ Hub API production | Berjalan | API dan PostgreSQL healthy; API memakai image `sha-0796114...` | Backend registry/access tersedia. Tidak ada perubahan `apps/api` antara commit image itu dan current `main`. |
| SQ Hub web production | Belum tersedia publik | Tidak ada container web production; Caddy tidak memiliki route Hub; DNS `hub.sabilulquran.or.id` tidak ditemukan | Pengguna belum mempunyai launcher SQ Hub publik. API yang sehat tidak sama dengan portal yang dapat dibuka. |
| Staging | Tidak tersedia | Container SQ Hub, Keycloak, dan HCIS staging berhenti; Hub/HCIS mengembalikan 502 dan realm staging 404 | Staging lama tidak dapat dipakai untuk acceptance atau rehearsal sampai dipulihkan. Exit state tidak menunjukkan Docker OOM. |
| Backup/recovery | Parsial | Backup cutover 7 September tersedia dan checksum dump yang diperiksa cocok | Belum ditemukan jadwal backup SQ Hub/HCIS/Keycloak, offsite copy, atau bukti restore production. |
| Audit/logging | Belum memenuhi baseline | Keycloak `events_enabled=false` dan `admin_events_enabled=false`; Docker memakai `json-file` tanpa opsi rotasi | Investigasi insiden dan kontrol pertumbuhan log belum memadai. |

## Kesesuaian source dan runtime

- `main` saat audit: `a09886a6e02a699bb77fd18bf9262a07f48dbda4`.
- Keycloak production menjalankan digest `sha256:38405c96...`, tersedia lokal dengan tag source `sha-347bc06...`. Commit `347bc06` sudah mencakup recovery/Google sign-in dan trusted-device TOTP. Commit dari `347bc06` sampai `a09886a` hanya mengubah dokumentasi.
- Label OCI `org.opencontainers.image.revision` pada image Keycloak masih menunjuk `df15afa...`, tidak sama dengan tag source `347bc06...`. Fungsinya teramati terpasang, tetapi provenance image tetap perlu diperbaiki pada build berikutnya.
- SQ Hub API production memakai source tag `0796114...`. Tidak ada perubahan pada `apps/api` atau `apps/web` dari commit itu ke `main`; perubahan runtime berikutnya berada pada Keycloak.
- Karena tidak ada perubahan fungsi yang hilang dari runtime, audit ini tidak melakukan redeploy production hanya untuk menyamakan nomor commit dokumentasi.

## GitHub backlog aktif

| Item | Posisi saat ini | Keputusan berikutnya |
| --- | --- | --- |
| Issue #9 | Open; acceptance Wave 1 masih belum lengkap | Jadikan tempat bukti UAT production/staging yang benar-benar dieksekusi. |
| Issue #17 | Open; visual identity desktop | Selesaikan setelah render/viewport UAT tersedia. |
| PR #12 | Discovery model SQ Account/Hub/Portal | Pemilik produk perlu memutuskan apakah discovery dinaikkan menjadi requirement dan ADR. |
| PR #42 | Draft proposal Go 5C provisioning/offboarding (`HUB-IMPL-013`) | Jangan merge sebagai fitur accepted sebelum keputusan kebijakan dan security review selesai. |
| PR #43 | Draft proposal Organizational Unit (`HUB-IMPL-014`) | Jangan melakukan cutover/import production sebelum governance dan migration contract diterima. |
| PR #52 | Housekeeping dokumentasi, ready for review | Dapat direview/merge terpisah dari keputusan fitur. |

## Risiko operasi yang terkonfirmasi

- VPS hanya memiliki sekitar 2 GiB RAM; saat snapshot sekitar 1.2 GiB sedang dipakai. Menyalakan seluruh staging pada host yang sama perlu rencana kapasitas agar tidak mengganggu production.
- Root filesystem terpakai 65%, masih memiliki ruang tetapi perlu dipantau karena Docker log belum dibatasi rotasinya.
- Secret file production yang diperiksa dimiliki `root` dan mode `600`, sesuai least-privilege minimum.
- Backup cutover terakhir yang ditemukan berumur sembilan hari saat audit. Checksum membuktikan file tidak berubah, bukan bahwa database dapat dipulihkan.
- Production telah bergerak melampaui dokumen cutover, tetapi approval, maintenance window, rollback rehearsal, dan acceptance owner belum dapat direkonstruksi dari repository. Status `CUTOVER_BLOCKED` tetap dipertahankan sebagai gap governance, bukan klaim bahwa layanan production sedang mati.

## Langkah berikutnya yang disarankan

1. **Tutup penerimaan login production.** Gunakan akun uji yang disetujui untuk membuktikan login Employee/manager/HC admin, MFA, recovery email, Google account linking, trusted device, disabled/revoked access, logout, dan ketiadaan token di browser storage. Catat hasil tanpa merekam token, cookie, atau data pribadi.
2. **Amankan operasi harian.** Buat jadwal backup untuk HCIS, SQ Hub, dan Keycloak; simpan salinan offsite; uji restore ke lingkungan terisolasi; aktifkan audit trail yang sesuai; dan pasang rotasi log Docker.
3. **Putuskan nasib staging.** Pulihkan secara terjadwal dengan capacity plan bila masih menjadi release gate, atau ubah dokumen acceptance agar tidak terus bergantung pada environment yang dimatikan. Jangan menyalakan seluruh staging sekaligus tanpa menghitung memori.
4. **Putuskan apakah Hub launcher akan diluncurkan sekarang.** Jika ya, pekerjaan terpisah diperlukan untuk web image production, DNS, route Caddy, health check, dan UAT pengguna. Jika belum, dokumentasikan bahwa foundation saat ini hanya menyediakan Identity, HCIS SSO, dan backend access.
5. **Rapikan provenance dan change record.** Rekonstruksi siapa/operator/waktu/image/backup yang benar-benar dipakai pada cutover, lalu perbaiki label revision image Keycloak pada build berikutnya.
6. **Baru lanjutkan proposal fitur berikutnya.** Setelah risiko foundation ditutup, review PR #42 dan #43 sebagai keputusan produk terpisah; keduanya masih draft dan bukan pekerjaan production yang sudah disetujui.

## Batas bukti

Health check membuktikan service merespons, bukan bahwa seluruh skenario pengguna benar. Konfigurasi realm membuktikan fitur diaktifkan, bukan bahwa email, Google, trusted device, logout, dan authorization telah lulus dari ujung ke ujung. Tidak ada secret, token, cookie value, raw identity subject, atau data pribadi yang disalin ke dokumen ini.
