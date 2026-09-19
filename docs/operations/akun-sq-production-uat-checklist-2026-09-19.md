# Checklist UAT production Akun SQ — 2026-09-19

Checklist ini untuk Product Owner/penguji browser setelah runtime production siap. Jangan menyalin password, OTP, token, cookie value, client secret, recovery code, atau data pribadi ke evidence. Gunakan akun uji yang aman bila sebuah skenario mengubah password/MFA.

Target:
- SQ Hub: `https://hub.sabilulquran.or.id`
- Akun SQ: `https://login.sabilulquran.or.id/realms/sq-staff`

## A. Smoke utama

- [ ] Buka SQ Hub dari browser fresh/incognito.
- [ ] Hub mengarahkan ke **Akun SQ**.
- [ ] Logo organisasi dan nama **Akun SQ** tampil benar.
- [ ] Login dengan NIP atau email yang sah berhasil.
- [ ] Setelah login kembali ke SQ Hub.
- [ ] Hanya aplikasi yang memang dimiliki aksesnya yang muncul.
- [ ] HCIS dapat dibuka dari SQ Hub tanpa meminta password Akun SQ lagi.
- [ ] Menu **Akun SQ** membuka Account Console.
- [ ] Account Console menampilkan **Informasi pribadi**, **Keamanan akun**, dan **Aplikasi**.
- [ ] Tidak ada layout terpotong/overflow pada desktop.
- [ ] Tidak ada layout terpotong/overflow pada mobile sekitar 390×844.

## B. Lupa password / recovery

Gunakan akun uji yang emailnya benar-benar dapat diterima.

- [ ] Pada login Akun SQ, pilih **Lupa password?**.
- [ ] Masukkan NIP/email akun uji.
- [ ] Email pemulihan benar-benar diterima.
- [ ] Tautan pemulihan membuka halaman Akun SQ yang benar.
- [ ] Password baru dapat dibuat sesuai policy.
- [ ] Password lama tidak dapat dipakai lagi.
- [ ] Password baru berhasil dipakai login.
- [ ] Tautan recovery yang sudah dipakai tidak dapat digunakan kedua kali.
- [ ] Tidak ada password/OTP/token yang tampil di URL atau pesan error.

**PASS recovery** hanya jika email nyata diterima dan reset berhasil end-to-end.

## C. Masuk dengan Google — existing account

Gunakan Google account yang emailnya sudah cocok dengan existing Akun SQ.

### Pertama kali

- [ ] Pilih **Masuk dengan Google**.
- [ ] Google authentication berhasil.
- [ ] Akun SQ tidak otomatis membuat akun Staff baru.
- [ ] Sistem meminta konfirmasi linking existing Akun SQ.
- [ ] Sistem meminta pembuktian kepemilikan akun lokal sesuai flow.
- [ ] Bila akun memakai TOTP, challenge TOTP muncul sesuai policy.
- [ ] Setelah selesai, pengguna kembali sebagai **akun Akun SQ yang sama**, bukan akun duplikat.
- [ ] Application Access dan role HCIS tetap sama.

### Login Google berikutnya

- [ ] Logout.
- [ ] Login lagi dengan Google yang sama.
- [ ] Login kembali ke identity Akun SQ yang sama.
- [ ] Tidak muncul account/profile duplikat.
- [ ] Tidak mendapat aplikasi atau privilege baru.

## D. Google negative case — operator-assisted

Gunakan Google identity yang **tidak memiliki existing Akun SQ**.

- [ ] Pilih **Masuk dengan Google**.
- [ ] Login **ditolak secara aman**.
- [ ] Tidak dibuat Akun SQ baru otomatis.
- [ ] Tidak muncul Application Access atau role baru.

Jangan memakai akun produksi orang lain untuk skenario ini.

## E. Trusted device TOTP — 30 hari

Gunakan akun uji yang TOTP-nya sudah aktif.

### Tanpa mencentang trust

- [ ] Login dan biarkan **Percayai perangkat ini selama 30 hari** tidak dicentang.
- [ ] Masukkan OTP benar.
- [ ] Login berhasil.
- [ ] Setelah logout penuh dan login ulang, TOTP diminta lagi.

### Dengan mencentang trust

- [ ] Login lagi.
- [ ] Masukkan OTP benar dan centang **Percayai perangkat ini selama 30 hari**.
- [ ] Login berhasil.
- [ ] Logout penuh.
- [ ] Login ulang pada browser/profile yang sama.
- [ ] Setelah first factor berhasil, TOTP dapat dilewati sesuai trusted-device policy.

### Browser lain

- [ ] Buka browser/profile/incognito lain.
- [ ] Login dengan akun yang sama.
- [ ] TOTP tetap diminta.
- [ ] Trusted state dari browser pertama tidak berlaku di browser lain.

## F. Trusted-device invalidation

Lakukan hanya pada akun uji.

- [ ] Setelah browser dipercaya, lakukan reset/ganti password.
- [ ] Login ulang.
- [ ] Trusted-device lama tidak lagi melewati TOTP.
- [ ] Setelah TOTP berhasil dan perangkat dipercaya ulang, flow kembali normal.

Penggantian TOTP/disabled-user/tamper-replay adalah skenario security/operator dan tidak perlu dilakukan pada akun harian Product Owner bila tidak ada test identity khusus.

## G. Logout

- [ ] Dari SQ Hub pilih **Keluar**.
- [ ] Hub session berakhir.
- [ ] Akun SQ SSO session ikut diakhiri.
- [ ] Membuka ulang SQ Hub tidak langsung masuk sebagai sesi lama.
- [ ] Tidak ada loop redirect atau error 5xx.

## H. Pemeriksaan browser opsional

Di DevTools, catat hanya atribut, **jangan copy value**.

- [ ] `localStorage` tidak berisi access token, refresh token, atau ID token.
- [ ] `sessionStorage` tidak berisi access token, refresh token, atau ID token.
- [ ] Hub session cookie: HttpOnly, Secure, SameSite=Lax, Path=/.
- [ ] Trusted-device cookie bila ada: HttpOnly, Secure, SameSite=Lax dan scope realm yang sesuai.
- [ ] Tidak ada authorization code/state/nonce/PKCE verifier yang tertinggal di browser storage.

## Hasil yang cukup untuk closure

### HUB-IMPL-011 — Recovery + Google

- [ ] Recovery E2E PASS.
- [ ] Google existing-account link PASS.
- [ ] Google subsequent login PASS.
- [ ] Google no-existing-account negative case PASS atau diverifikasi operator.
- [ ] Tidak ada perubahan identity mapping/Application Access/domain role yang tidak diharapkan.

### HUB-IMPL-012 — Trusted device

- [ ] Unchecked → TOTP tetap diminta pada login berikutnya.
- [ ] Checked + valid OTP → same browser dapat dipercaya.
- [ ] Browser lain → TOTP tetap diminta.
- [ ] Password reset → trust lama invalid.
- [ ] Cookie/storage checks tidak menemukan exposure material credential/token.

## Format laporan singkat

Cukup kirim hasil seperti ini tanpa credential:

```text
A. Smoke: PASS / FAIL
B. Recovery: PASS / FAIL / SKIP
C. Google existing: PASS / FAIL / SKIP
D. Google negative: PASS / FAIL / SKIP
E. Trusted device: PASS / FAIL / SKIP
F. Invalidation: PASS / FAIL / SKIP
G. Logout: PASS / FAIL
H. Browser storage/cookie: PASS / FAIL / SKIP

Catatan:
- langkah:
- yang terlihat:
- screenshot bila perlu, tanpa token/cookie/OTP/password.
```
