# SQ Hub Staff Authentication Policy

**Status:** ACCEPTED
**Date:** 2026-08-27
**Applies to:** internal Staff identities using Akun SQ / Keycloak

## Goal
Memberikan pengalaman login yang sederhana untuk Staff sekaligus menetapkan baseline keamanan yang konsisten untuk HCIS, SPMB Admin, SQ Hub, dan aplikasi internal berikutnya.

## 1. Identity key vs login identifier
Aplikasi tidak boleh memakai NIP, email, atau username sebagai technical foreign key identitas.

Technical identity key adalah pasangan OIDC `issuer` + `subject (sub)` yang diperlakukan sebagai opaque stable identifier.

Human login identifier:
- **Employee:** NIP/`employee_number` adalah username utama ketika tersedia.
- **Employee:** email yang unik dan sudah diverifikasi boleh diterima sebagai alternatif login.
- **Staff tanpa NIP:** email yang unik dan sudah diverifikasi menjadi username utama sampai ada identifier bisnis lain yang benar-benar dibutuhkan.
- **NIK tidak boleh digunakan sebagai username/login identifier.**
- Jangan membuat nomor Staff paralel hanya untuk kebutuhan authentication.

Username/email boleh berubah sesuai lifecycle bisnis; aplikasi domain tetap mengikat principal berdasarkan `issuer + sub`, bukan string login.

## 2. Account provisioning
- Akun SQ/Keycloak adalah pemilik credential dan authentication lifecycle.
- SQ Hub adalah pemilik Application Access.
- Domain application tidak membuat password Staff sendiri.
- Account baru harus memiliki email yang dapat digunakan untuk activation/recovery sebelum self-service recovery diaktifkan.
- Employee identity menggunakan NIP dari Employee master sebagai kandidat username; jangan menduplikasi NIP ke identifier bisnis baru.

## 3. Password policy
Baseline awal:
- minimum 12 karakter;
- password tidak boleh sama dengan username/NIP;
- gunakan password blacklist/common-password protection yang tersedia pada provider bila operasionalnya terkelola dengan baik;
- tidak mewajibkan kombinasi artifisial huruf besar + kecil + angka + simbol jika panjang sudah memenuhi baseline;
- tidak ada rotasi password periodik hanya berdasarkan umur;
- password wajib diganti setelah reset administratif, indikasi compromise, atau perubahan security policy yang memang membutuhkan reset.

Password lama HCIS tidak menjadi credential Akun SQ setelah migration cutover.

## 4. MFA policy
### Wajib MFA sejak Foundation v1
MFA wajib untuk identity yang memiliki salah satu kategori akses berikut:
- Keycloak/Akun SQ administrator;
- SQ Hub platform administrator atau pengelola Application Access;
- HCIS Super Admin;
- administrator aplikasi/domain;
- role yang dapat melihat atau mengubah data berisiko tinggi milik orang lain, termasuk payroll/payslip organisasi, finance administration, credential, security policy, access-control configuration, atau personal-data administration yang sensitif;
- Human Capital/Employee-master administrator yang dapat melakukan perubahan terhadap data pegawai lintas unit/organisasi.

Domain boleh mewajibkan MFA untuk role tambahan berdasarkan risiko.

### Staff biasa
Untuk Staff tanpa akses sensitif/privileged, MFA boleh diaktifkan secara sukarela pada Foundation v1. Enforcement untuk seluruh Staff dapat diputuskan kemudian setelah enrollment/support experience terbukti baik.

### Faktor awal
- TOTP authenticator adalah faktor kedua baseline awal.
- Recovery codes wajib tersedia untuk akun yang diwajibkan MFA.
- Passkey/WebAuthn boleh digunakan dan didorong setelah UAT perangkat/browser; belum menjadi satu-satunya metode recovery pada Foundation v1.
- SMS OTP bukan baseline MFA SQ Hub.

## 5. Login failure / brute-force protection
- Keycloak brute-force protection wajib diaktifkan.
- Baseline operasional awal: setelah 5 kegagalan berurutan, berikan temporary lock/wait sekitar 15 menit; konfigurasi final divalidasi pada staging agar tidak mudah menimbulkan denial-of-service terhadap akun Staff.
- Permanent lock otomatis tidak digunakan sebagai default.
- Security events yang relevan harus dapat diaudit tanpa menyimpan password/token.

## 6. Session policy
Baseline Foundation v1:
- **SSO Session Idle:** 8 jam.
- **SSO Session Max:** 12 jam.
- **Remember Me:** nonaktif pada rollout awal.
- **Access token lifespan:** 5 menit sebagai baseline; aplikasi tidak menggunakan access-token lifetime sebagai UX session lifetime.
- Aplikasi boleh mempunyai server-side application session, tetapi lifetime absolutnya tidak boleh melampaui SSO max tanpa reauthentication.

Tujuannya adalah satu login untuk satu hari kerja normal, bukan login permanen lintas hari.

## 7. Browser/OIDC session handling
Internal web application menggunakan standard OIDC Authorization Code flow. Untuk aplikasi yang memiliki backend:
- authorization-code exchange dan refresh-token handling dilakukan server-side;
- gunakan PKCE bila library/client flow mendukung dan sesuai konfigurasi;
- browser menyimpan hanya application session cookie yang `HttpOnly`, `Secure` di production, dan scoped ke application origin;
- jangan simpan access token atau refresh token di `localStorage`/`sessionStorage`;
- jangan memakai satu shared cookie untuk semua `*.sabilulquran.or.id`.

SSO terjadi karena aplikasi mempercayai session Akun SQ, bukan karena semua aplikasi berbagi cookie yang sama.

## 8. Logout
- Tombol **Keluar** harus mengakhiri application session dan Akun SQ SSO session.
- Sebelum aplikasi internal kedua production, global logout antar aplikasi harus diuji menggunakan mekanisme OIDC/Keycloak yang sesuai (termasuk back-channel logout bila dipakai oleh client implementation).
- Menutup tab/browser bukan pengganti logout.

## 9. Recovery
- Self-service password recovery hanya melalui channel/flow yang telah diverifikasi.
- Admin tidak boleh mengetahui atau mengirimkan permanent password pengguna.
- Admin boleh memicu reset/required action yang memaksa pengguna membuat credential sendiri.
- Privileged account recovery harus menghasilkan audit event.
- Emergency/break-glass administration harus didokumentasikan sebelum production dan dilindungi MFA/credential custody yang terpisah dari akun harian.

## 10. Status and access
Authentication sukses tidak otomatis berarti semua aplikasi dapat dibuka.

Alur konseptual:
```text
Keycloak authenticates identity
        -> SQ Hub checks Application Access
        -> domain app resolves local principal
        -> domain app checks local role/permission/scope
```

Akun yang disabled pada **global identity lifecycle** tidak boleh memperoleh session baru. Domain-local suspension/application-access revocation tetap mengikuti owner masing-masing dan tidak boleh otomatis men-disable global identity.

Contoh: Staff dapat kehilangan akses HCIS tetapi tetap memiliki akses sah ke SPMB Admin. HCIS tidak berwenang mematikan Akun SQ global hanya karena status lokal HCIS berubah.

## 11. Review triggers
Policy ini harus direview jika:
- seluruh Staff akan diwajibkan MFA;
- passkey menjadi primary/passwordless login;
- mobile/native app diperkenalkan;
- session duration diubah signifikan;
- external identity (wali/siswa/applicant) disatukan dengan Staff realm;
- threat model atau compliance requirement berubah.
