# Status UAT identity SQ Hub — 2026-09-17

Dokumen ini merekonsiliasi bukti UAT identity agar skenario yang sudah dilaksanakan dan diterima tidak kembali dijadwalkan hanya karena dipindahkan ke matriks production. Ledger rinci tetap berada di [`HUB-IMPL-003-production-cutover.md`](./HUB-IMPL-003-production-cutover.md), sedangkan bukti live staging yang diterima berada di [`HUB-IMPL-003-staging-uat-evidence.md`](./HUB-IMPL-003-staging-uat-evidence.md).

## Ringkasan untuk pembaca non-engineer

Pengujian inti login HCIS melalui Akun SQ sebenarnya sudah selesai dan diterima di staging pada 28 Agustus 2026. Pengujian itu mencakup login OIDC ke akun HCIS yang benar, pencabutan dan pemulihan Application Access, penolakan login baru ketika layanan pemeriksaan akses SQ Hub berhenti, perilaku sesi yang sudah aktif, logout, login ulang, dan tidak adanya jalan kembali diam-diam ke password lokal HCIS.

Pada 16–17 September 2026, production hanya diuji untuk perbedaan yang memang khusus production menggunakan persona sintetis `UAT-HCIS-001`. Login dengan NIP dan email terverifikasi berhasil menuju akun HCIS yang sama. Akun HCIS yang dibuat `suspended` ditolak dengan benar, identitas Akun SQ tetap aktif, dan akun HCIS berhasil dikembalikan ke keadaan normal. Semua perubahan sementara sudah dipulihkan.

Karena itu, pekerjaan berikutnya bukan mengulang seluruh UAT. Permintaan Forgot Password baru pada 17 September 2026 pukul 11.33 WIB berhasil dicocokkan dari layar sukses Akun SQ, cPanel Track Delivery berstatus `Accepted`, hingga pesan baru di Inbox Gmail. Tester kemudian menyelesaikan reset dan penggunaan ulang tautan yang sama langsung ditolak, sehingga pengiriman serta sifat sekali pakai sudah terbukti.

## Keputusan rilis pemilik produk — 17 September 2026

Pemilik produk memutuskan untuk tidak menjadikan sisa UAT Google, trusted-device, persona tambahan, serta browser storage/cookie sebagai penghambat rilis saat ini. Skenario tersebut tetap berstatus `NOT_RUN`, bukan `PASS`, dan dipindahkan sebagai backlog acceptance yang harus diselesaikan dengan identitas sintetis yang benar.

Tiga rehearsal Keycloak outage (`9.1`-`9.3`) juga dipindahkan ke lingkungan terisolasi/production-like. Production tidak akan dihentikan atau diisolasi untuk mengejar bukti tersebut.

Keputusan ini menerima risiko bahwa bukti live untuk skenario yang tertunda belum tersedia. Ia tidak mengubah kontrak keamanan, tidak mengklaim fitur telah lolos, dan tidak mengizinkan penggunaan akun nyata sebagai data UAT.

## Status yang telah direkonsiliasi

| Hasil | Jumlah | Makna |
| --- | ---: | --- |
| `PASS` | 27 | Memiliki bukti yang memenuhi gate, termasuk continuity akses pegawai biasa tanpa hak Human Capital, penolakan OTP salah, penerbitan trusted state setelah centang + OTP valid, bypass TOTP hanya pada browser yang sama setelah first factor, dan kewajiban TOTP pada profil browser lain. |
| `FAIL` | 0 | Tidak ada kegagalan aktif yang sudah dibuktikan pada ledger. |
| `NOT_RUN` | 28 | Skenario berbeda yang belum dijalankan, terutama persona/otorisasi, recovery lain dan Google, sisa trusted device, serta pemeriksaan browser storage/cookie. Ini bukan pengulangan otomatis dari UAT inti. |
| `BLOCKED` | 3 | Rehearsal gangguan Keycloak yang hanya boleh dilakukan di lingkungan terisolasi atau production-like. |
| **Total** | **58** | Seluruh baris pada ledger production-cutover. |

## Bukti yang tidak perlu diulang

Selama implementation contract yang diuji tidak berubah secara material, bukti live staging yang sudah diterima tetap memenuhi gate yang sama:

- Application Access revoke, penolakan login baru, perilaku sesi aktif, dan restore;
- SQ Hub access-check outage yang fail closed, sesi aktif tetap berjalan, dan recovery;
- logout HCIS, Keycloak RP-initiated logout, dan kewajiban autentikasi ulang;
- tidak adanya fallback diam-diam ke login lokal HCIS.

Bukti tersebut tetap dilabeli sebagai staging evidence. Dokumen tidak mengklaim skenario itu dijalankan di production. Pengulangan hanya diperlukan setelah perubahan material pada implementasi terkait atau bila ada perbedaan production yang benar-benar memengaruhi hasil.

## Delta production yang sudah selesai

- Login menggunakan NIP: `PASS`.
- Login menggunakan verified unique email: `PASS`.
- Kedua cara login menuju principal HCIS lokal yang sama: `PASS`.
- Expired reset/action link ditolak tanpa membuat sesi: `PASS`.
- HCIS-local suspended ditolak tanpa menonaktifkan identity global, kemudian berhasil dipulihkan: `PASS`.
- Persona pegawai biasa dapat membuka modul Kehadiran dan ditolak dari antrean administrasi Human Capital: `PASS`.
- Profil browser kedua tetap meminta TOTP dan tidak memperoleh trusted state ketika opsi trust dibiarkan kosong: `PASS`.
- Keycloak identity sempat dinonaktifkan untuk persiapan skenario, tetapi browser denial tidak dijalankan; state sudah dipulihkan sehingga baris ini tetap `NOT_RUN`.

Keadaan akhir persona sintetis telah diverifikasi aman: akun HCIS dan Employee aktif, Keycloak enabled dan email verified, exact OIDC mapping tersedia, serta Application Access aktif. Tidak ada mutation yang masih tertinggal.

## Implementasi dan rollout pengalaman Akun SQ

**Status: LOGIN PRODUCTION DEPLOYED; ACCOUNT CONSOLE RUNTIME ACTIVATION PENDING.** Redesign dilaksanakan melalui `HUB-IMPL-015` dan PR #69, lalu di-merge sebagai commit `ada8a0b952effe7ec228f0b4072f15551ec3d0bc` pada 17 September 2026.

Hasil repository dan CI:

- login memakai satu kartu Akun SQ yang terpusat dan responsif; komposisi HCIS, Nilai Utsman, dan stylesheet bernama produk lama dihapus;
- Account Console child theme berbasis `keycloak.v3` tersedia di image yang sama;
- issuer, realm key, client, form action, MFA, recovery, trusted device, dan kebijakan akses tidak diubah;
- contract, application CI, dan full Keycloak smoke lulus.

Rollout production menggunakan image immutable `sha256:7b2117eb25cbc121b99b35812eec7886be13a827a8fc36e10446f0f649a87149`. Verifikasi sesudah rollout membuktikan Keycloak `healthy`, restart count 0, issuer production tetap `https://login.sabilulquran.or.id/realms/sq-staff`, halaman login publik memuat stylesheet `akun-sq-login-b24d22d27e5a.css` dan teks `Masuk ke Akun SQ`, serta container/database PostgreSQL tidak direcreate atau restart.

Compose sebelum rollout disimpan pada VPS sebagai `compose.identity.json.before-akun-sq-20260917T141945Z`; image sebelumnya adalah `sha256:38405c96e88ba2f9779bbcdd50780dd02a393ebe15c34425ddd51dd327a5afee`.

Realm production masih melaporkan `loginTheme=sq-hub` dan `accountTheme` kosong. Theme Account Console sudah berada di image, tetapi belum diaktifkan karena tidak tersedia sesi Keycloak administrator yang aman pada saat rollout. Jangan mengubah database Keycloak secara langsung untuk menutup gap ini. Tindak lanjut yang tepat adalah menetapkan `accountTheme=sq-hub` melalui Admin Console/Admin API yang terautentikasi, lalu menjalankan visual smoke untuk Info pribadi, Keamanan, Sesi, dan tampilan mobile.

Inventaris halaman dan batas penamaan tetap tersedia di [`akun-sq-gui-inventory-2026-09-17.md`](./akun-sq-gui-inventory-2026-09-17.md). Bukti deployment ini tidak menggantikan visual UAT manusia untuk recovery, Google, TOTP, trusted device, atau Account Console.

## Backlog setelah rilis

1. **Siapkan fixture Google yang benar-benar terpisah.** Akun Google tanpa pasangan dapat dipakai untuk membuktikan penolakan `4.1`. Untuk linking `4.2`-`4.5`, email yang diklaim Google harus sama dengan verified unique email Akun SQ yang memang dimiliki persona sintetis. Alias Gmail bertanda `+` tidak cukup bila Google mengklaim alamat dasar. Credential tetap dipegang tester dan tidak dicatat.
2. **Gunakan TOTP persona sintetis yang sudah didaftarkan.** Pada 17 September 2026, read-only production inventory memverifikasi `UAT-HCIS-001` memiliki credential `otp` dan `password`. Persona ini dapat dipakai untuk sebagian besar matriks trusted-device. Persona privileged terpisah tetap diperlukan untuk policy comparison, TOTP wajib, dan recovery authentication code. Secret, QR, OTP, dan recovery code tidak boleh dicatat.
3. **Eksekusi sisa skenario dalam urutan yang menjaga state.** Skenario unchecked, wrong OTP, checked+valid, same browser, dan other browser sudah selesai. Berikutnya jalankan baseline storage/cookie, Google linking/login, password-reset invalidation, TOTP replacement invalidation, lalu disabled-user denial. Catat state awal dan rollback untuk setiap mutation.
4. **Jalankan hanya negative case lain yang masih berbeda bila diwajibkan.** Yang tersisa antara lain global Keycloak disable melalui browser, missing Application Access yang berbeda dari revoked access, dan unknown `issuer + sub` mapping. Pengujian revoke/restore dan tautan reset tidak perlu diulang.
5. **Jalankan Keycloak outage hanya di target terisolasi bila tetap menjadi gate.** Jangan menghentikan Keycloak production. Tiga baris outage ini tetap `BLOCKED` sampai target aman tersedia atau pemilik produk mengeluarkannya dari scope rilis.
6. **Tutup acceptance backlog setelah fixture dan lingkungan tersedia.** Issue #9 tetap terbuka sebagai pelacak pekerjaan tertunda; ia tidak lagi menjadi penghambat rilis berdasarkan keputusan pemilik produk di atas.

## Aturan pencatatan selanjutnya

Setiap hasil harus menyebutkan skenario, lingkungan asal bukti, waktu, persona sintetis/redacted, dan hasilnya. Source code, konfigurasi, atau health check saja tidak boleh menggantikan bukti browser. Sebaliknya, bukti live yang sudah diterima tidak boleh dihapus atau direset menjadi `NOT_RUN` tanpa alasan perubahan material yang terdokumentasi.

## Native browser visual refinement — 17 September 2026, 16:15 UTC

PR #71 and #72 are merged. Native Edge review identified the provider header line, oversized composition, raster logo, mismatched autofill surface, and Google option placement. The login theme now uses a crisp Akun SQ SVG mark, Google before the form, neutral autofill, and a centered responsive card. A follow-up review caught and corrected a social-divider style leaking into recovery instructions.

Verification: layout preview at 1440x900, 1280x720, and 390x844 showed no normal-state overflow; native Edge production review confirmed the refined login and recovery page. No login submission or reset email was required for this visual inspection. Both PRs passed contract, foundation, and full Keycloak smoke checks.

Current production image: `ghcr.io/sabilulquran/sq-hub-keycloak@sha256:9dd0d098fc192780246bbb20c44312afaa85e8c7d53d5347afa3fd63f8e5189a`, built from reviewed PR head `07404d9fc745c00a79f8107736e686d5ff3443de` (merged as `71d289d`). Current stylesheet: `akun-sq-login-2629a2861483.css`. Runtime is healthy, restart count 0, and database container ID/start time were unchanged across rollout.

Rollback configuration: `/var/www/sq-hub-production/compose.identity.json.before-divider-fix-20260917T161418Z`; previous image digest `80bf6f4c8d72be49018a2f74f2e6fac2dcf4099c2a3547214953676f45353fe7`. The earlier full-polish backup is `compose.identity.json.before-polish-20260917T160254Z`.

Remaining: activate the Account Console theme through authenticated administrator access and inspect its pages. This visual review does not claim completion of authenticated MFA, linking, recovery execution, or all UAT scenarios. Do not repeat the completed login/recovery visual checks unless the theme changes materially.

## Official brand asset correction — 18 September 2026

PR #74 restored the existing organization logo and favicon instead of the generic SQ placeholder. Native Edge verification then found that the historical `ysq-mark.svg` wrapper contained invalid embedded image data, so PR #75 changed the compact login and Account Console logo reference to the valid existing `favicon.svg` organization mark. Both PRs passed the experience contract, application CI, and full Keycloak smoke test.

Production now runs `ghcr.io/sabilulquran/sq-hub-keycloak@sha256:dcccc600d2e61c6bb8f667f7c1ede5651f5314504e8f9ec60e0075023231866f`. Runtime verification showed Keycloak `healthy`, restart count 0, issuer discovery HTTP 200, and the database container retained its original start time (`2026-09-17T04:42:58Z`). The rollback configuration is `/var/www/sq-hub-production/compose.identity.json.before-valid-mark-20260917T234346Z`.

Native Edge visual verification confirmed the official Sabilul Qur'an mark is visible on the production login card. The canonical user entry remains `https://login.sabilulquran.or.id/realms/sq-staff/account/`; route details are recorded in [`akun-sq-gui-inventory-2026-09-17.md`](./akun-sq-gui-inventory-2026-09-17.md).
