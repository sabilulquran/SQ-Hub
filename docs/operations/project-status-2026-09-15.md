# Status proyek SQ Hub — 2026-09-15

Dokumen ini merangkum kondisi proyek berdasarkan dua kelompok bukti yang harus dibaca terpisah:

1. **Bukti GitHub** yang diperiksa pada 15 September 2026: repository `sabilulquran/SQ-Hub`, `main`, PR, issue, specification, runbook, dan GitHub Actions.
2. **Hasil audit VPS read-only yang diberikan pengguna**, juga bertanggal 15 September 2026. Audit tersebut bukan pemeriksaan VPS langsung oleh agent yang membuat dokumen ini.

Tujuannya adalah membedakan dengan jelas antara **sudah dibuat di source code**, **sudah terlihat terpasang di production**, **sudah diuji dengan bukti**, dan **masih perlu verifikasi**.

## Ringkasan untuk pembaca non-engineer

- Source code utama saat audit masih berada di commit `347bc06cfe3af96b12106e7737fe7aa7cd799e4b` tanggal 8 September 2026. Commit ini sudah mencakup recovery/Google login dari PR #49 dan trusted-device TOTP dari PR #50.
- CI pada `main` untuk commit tersebut berhasil. Ini membuktikan pemeriksaan otomatis repository lulus, tetapi **tidak sama dengan bukti bahwa seluruh alur pengguna production sudah lulus UAT**.
- Hasil audit VPS yang diberikan pengguna menunjukkan HCIS production aktif dengan OIDC, SQ Identity/Keycloak production sehat, Google provider dan reset password aktif, trusted-device provider terpasang dan browser flow aktif, serta SQ Hub API production sehat.
- Meski production terlihat berjalan, dokumen cutover repository masih berstatus `CUTOVER_BLOCKED`. Tidak ada bukti GitHub yang diperiksa bahwa seluruh acceptance gate, persetujuan cutover, maintenance window, dan acceptance pasca-cutover sudah dilengkapi. Karena itu status tersebut **tidak diubah menjadi accepted secara retrospektif**.
- Staging yang dahulu menjadi sumber utama UAT saat audit pengguna justru sedang berhenti/502. Artinya bukti historis staging tetap sah untuk tanggal saat diuji, tetapi tidak boleh dianggap sebagai kondisi staging saat ini.
- Beberapa kebutuhan operasional masih belum terverifikasi: backup terjadwal/offsite dan restore, audit logging alternatif, rotasi Docker log, provenance image Keycloak, DNS/route `hub.sabilulquran.or.id`, serta sejumlah UAT pengguna dan rollback rehearsal.

## Status kemampuan utama

| Kemampuan | Implementasi di `main` | Deployment yang teramati | Bukti pengujian | Pekerjaan tersisa / belum terverifikasi |
| --- | --- | --- | --- | --- |
| SQ Identity / Keycloak foundation | Sudah ada. Wave 1 specs dan infrastruktur terkait telah lama berada di repository. | Audit VPS pengguna: production sehat, Keycloak 26.7.2, issuer `https://login.sabilulquran.or.id/realms/sq-staff`. | CI repository dan bukti staging historis tersedia. | Provenance image production belum sepenuhnya terverifikasi karena tag mengacu ke `347bc06` tetapi label revision image menunjukkan `df15afa5a3a8a2b10021f879ffa93b30fb36c73a`. |
| HCIS OIDC | Implementasi `HUB-IMPL-003` tersedia di repository; issue #9 menyimpan bukti staging dan gate yang tersisa. | Audit VPS pengguna: HCIS production sehat, `AUTH_MODE=oidc`, HTTP 200. | Core staging OIDC UAT pernah diterima; beberapa failure/session/logout checks sudah tercatat di issue #9 dan dokumen evidence. | Acceptance lengkap, persona matrix, browser storage, Keycloak-outage case, rollback rehearsal, dan bukti persetujuan production cutover belum lengkap di sumber GitHub yang diperiksa. |
| Application Registry / Application Access | Sudah diimplementasikan pada foundation API (`HUB-IMPL-002`). | Audit VPS pengguna: SQ Hub API production sehat. Image mengacu ke `07961141815e5f0c0f3818ad10ae454d3477fce4`; audit Git pengguna melaporkan tidak ada perubahan `apps/api` atau `apps/web` dari commit itu ke `347bc06`. | CI `main` sukses; historical staging Application Access checks tersedia. | Perlu snapshot production yang menghubungkan source/image/runtime secara eksplisit bila ingin menyatakan provenance penuh. |
| Password recovery | PR #49 / `HUB-IMPL-011` sudah merge ke `main`. | Audit VPS pengguna: reset password aktif pada realm production. | PR #49 memiliki CI untuk reconciliation/configuration dan rendering. | UAT production end-to-end (email terkirim, link single-use/expiry, disabled user/regression) belum dibuktikan oleh audit konfigurasi saja. |
| Google sign-in | PR #49 / `HUB-IMPL-011` sudah merge ke `main`. | Audit VPS pengguna: Google provider aktif pada realm production. | PR #49 memverifikasi struktur broker yang tidak auto-create user, local re-auth, conditional TOTP, no stored upstream token. | UAT production existing-account link, negative no-user case, MFA, exact identity mapping, dan authorization regression masih perlu bukti. |
| Trusted device TOTP | PR #50 / `HUB-IMPL-012` sudah merge ke `main`. | Audit VPS pengguna: provider terpasang, signing key tersedia, browser flow `akun-sq-browser-trusted-device` aktif. | Unit/infrastructure CI pada PR #50 memverifikasi expiry/tamper/replay/user/realm/credential reset dan flow reconciliation. | Audit konfigurasi bukan bukti semua browser scenarios production sudah lulus. Perlu UAT checked/unchecked, other browser, expiry, tamper, reset password/TOTP, disabled user, Google path, dan cookie attributes tanpa merekam nilainya. |
| SQ Hub launcher production (`hub.sabilulquran.or.id`) | Repository memiliki Hub web/application implementation. | Audit pengguna: DNS `hub.sabilulquran.or.id` tidak ditemukan dari VPS maupun komputer lokal; route Caddy juga belum ditemukan. API production sehat tidak membuktikan launcher publik tersedia. | CI source tersedia. | DNS, reverse-proxy route, public health/UX dan deployment web production belum terverifikasi. |
| Staging Hub / HCIS / Keycloak | Source dan runbook staging tersedia; bukti historis tercatat. | Audit pengguna: container staging yang diperiksa berhenti; `hub-staging` dan `hcis-staging` HTTP 502. | Bukti UAT historis tetap dipertahankan sesuai tanggalnya. | Jika staging masih dibutuhkan sebagai acceptance/rehearsal environment, perlu dipulihkan dan snapshot baru diambil sebelum memakai staging sebagai bukti kondisi saat ini. |
| Backup / restore | Scripts/runbook dan beberapa bukti historis tersedia. | Audit pengguna menemukan backup production bertanggal 7–8 September. | Keycloak staging disposable restore pernah dibuktikan; CI juga memiliki mekanisme backup/restore. | Backup terjadwal khusus HCIS/Hub/Keycloak, offsite copy, retention, keberhasilan restore production, dan keberadaan backup lain belum terverifikasi. Jangan menyimpulkan backup tersebut tidak ada. |
| Audit / logging | Baseline dan aplikasi memiliki logging tertentu. | Audit pengguna: Keycloak `events_enabled=false`, `admin_events_enabled=false`; Docker json-file digunakan tanpa opsi rotasi yang terlihat. | Belum ada bukti cukup untuk menyatakan pencatatan alternatif memenuhi requirement. | Verifikasi logging alternatif/audit trail, retention, akses, dan rotasi log. |

## Sumber bukti dan tanggal

### GitHub — diperiksa 15 September 2026

- `main`: `347bc06cfe3af96b12106e7737fe7aa7cd799e4b`, merge PR #50 pada 8 September 2026.
- PR #49: recovery dan Google sign-in, merged.
- PR #50: trusted-device TOTP, merged.
- CI `main`: GitHub Actions run `34176707895`, conclusion `success`, untuk SHA `347bc06cfe3af96b12106e7737fe7aa7cd799e4b`.
- Issue #9: tetap open dan masih memiliki gate runtime secret, persona, browser UAT, rollback rehearsal, dan exit evidence yang belum lengkap.
- Issue #17: tetap open sebagai visual-polish task yang membutuhkan bukti render/viewport; tidak dapat ditutup hanya dari code test.
- Draft PR #48: bukti staging tanggal 6 September 2026, parsial dan eksplisit menyatakan technical acceptance belum lengkap serta production saat itu belum disentuh. Informasi di sana dipakai hanya sebagai bukti historis sesuai tanggalnya.
- `docs/operations/HUB-IMPL-003-production-cutover.md`: tetap `PREPARATION ONLY — CUTOVER_BLOCKED`.

### Audit VPS yang diberikan pengguna — 15 September 2026

Audit pengguna melaporkan production HCIS, SQ Identity/Keycloak, dan SQ Hub API dalam keadaan sehat, serta menemukan konfigurasi production untuk OIDC, Google recovery, dan trusted device. Audit juga melaporkan staging berhenti/502, status DNS/route Hub production belum tersedia, keterbatasan backup/logging, dan ketidakcocokan metadata provenance Keycloak image.

Tidak ada perubahan VPS yang dilakukan dalam audit tersebut.

## Perbedaan dokumentasi lama dengan kondisi runtime yang dilaporkan

1. **README lama** masih menyebut Keycloak staging sebagai pekerjaan berikutnya dan HCIS OIDC sebagai tahap setelahnya. Ini sudah tertinggal dari source code, bukti staging historis, dan audit production yang diberikan pengguna.
2. **Issue #9 dan dokumen Wave 1** secara historis menyebut production belum disentuh pada tanggal bukti terakhir mereka. Audit pengguna tanggal 15 September menunjukkan HCIS production sudah OIDC dan identity components sudah aktif. Catatan historis tersebut tidak dihapus; yang berubah adalah konteks bahwa kondisi runtime telah bergerak lebih jauh dari catatan terakhir.
3. **Runbook production cutover** masih `CUTOVER_BLOCKED`. Production yang teramati berjalan tidak otomatis membuktikan bahwa semua gate, approval, rollback evidence, dan post-cutover acceptance pernah diselesaikan. Status blocked tetap dipertahankan sampai bukti formal tersedia.
4. **Staging** dahulu aktif dan menjadi sumber UAT. Audit terbaru melaporkan staging berhenti dan aplikasi staging 502. Jadi hasil staging lama adalah bukti historis, bukan health check saat ini.

## Hal yang belum terverifikasi

- Bukti formal siapa yang menyetujui production cutover, maintenance window, waktu cutover, incident/rollback decision-maker, dan acceptance owner.
- Final production acceptance untuk ordinary Employee, manager/local authorization, Human Capital administrator, privileged MFA, non-Employee, suspended, globally disabled, revoked access, dan wrong/unknown mapping.
- Browser storage tidak menyimpan OIDC token pada production.
- Full logout/cookie behavior production, termasuk atribut trusted-device cookie tanpa merekam nilainya.
- End-to-end password recovery dan Google account-linking production.
- Trusted-device production UAT untuk seluruh negative/rotation/reset scenarios.
- Provenance penuh Keycloak production image karena perbedaan tag dan revision label.
- Public `hub.sabilulquran.or.id`: DNS, Caddy route, web deployment dan public response.
- Kondisi terbaru staging setelah ditemukan berhenti/502.
- Backup terjadwal/offsite/retention dan restore production yang berhasil.
- Apakah backup lain tersedia selain yang ditemukan audit.
- Apakah permission backup HCIS lama yang mode 664 sudah diremediasi.
- Audit logging alternatif ketika Keycloak events/admin events disabled.
- Docker log rotation dan retention.

## Prioritas berikutnya

1. **Rekonstruksi change record production** dari bukti yang benar-benar ada: source/image pins, waktu perubahan, approval, operator, backup identifier, dan hasil acceptance. Jangan memberikan approval secara retrospektif bila bukti tidak ada.
2. **Jalankan acceptance production yang aman** menggunakan identitas uji yang disetujui, terutama recovery, Google link, trusted device, persona/authorization, browser storage, logout, dan failure cases. Jangan merekam secret/token/cookie value.
3. **Tentukan status staging**: pulihkan bila masih dibutuhkan untuk rollback rehearsal/UAT, atau dokumentasikan bahwa environment tersebut tidak lagi menjadi release gate. Selama masih dirujuk oleh acceptance lama, 502 harus dianggap gap operasional.
4. **Tutup gap operasi**: verifikasi backup schedule/offsite/restore, audit logging, log rotation, serta permission backup lama.
5. **Verifikasi Hub launcher production** sebelum menyatakan SQ Hub publik lengkap: DNS, reverse proxy, web image, health dan akses pengguna.
6. **Selesaikan issue #9 berdasarkan bukti aktual**, bukan code test atau asumsi bahwa production yang sehat berarti semua acceptance gate pernah lulus.
7. **Issue #17 tetap berdiri sendiri** sampai visual UAT sesuai viewport scope tersedia.

## Aturan interpretasi status

- **Specification `ACCEPTED`** berarti requirement/contract disetujui, bukan deployment atau UAT selesai.
- **Merged ke `main`** berarti perubahan source sudah masuk branch utama, bukan berarti production sudah memakai perubahan tersebut.
- **Deployment teramati** berarti audit runtime melihat komponen/configuration berjalan; ini belum tentu membuktikan provenance atau seluruh acceptance criteria.
- **CI sukses** berarti pemeriksaan otomatis yang dijalankan workflow lulus; ini bukan pengganti browser/human UAT atau operator evidence.
- **Selesai** hanya boleh dinyatakan untuk gate yang memiliki bukti yang memang diminta oleh requirement terkait.
