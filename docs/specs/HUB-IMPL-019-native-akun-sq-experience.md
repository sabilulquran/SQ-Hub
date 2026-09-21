# HUB-IMPL-019 — Native Akun SQ experience

**Status:** ACCEPTED
**Owner:** Product Owner SQ Hub/HCIS — Human Capital YSQ
**Decision date:** 21 September 2026
**Scope:** SQ Hub account surface + Akun SQ authentication presentation
**Identity engine:** Keycloak remains the backend identity provider per ADR-0003

## Tujuan

Akun SQ harus terasa sebagai satu produk milik Yayasan Sabilul Qur'an, bukan sebagai Keycloak yang diberi logo.

Pengguna boleh berpindah dari `hub.sabilulquran.or.id` ke `login.sabilulquran.or.id` ketika proses autentikasi memang memerlukannya, tetapi seluruh pengalaman yang terlihat harus tetap konsisten sebagai **Akun SQ**. Nama, brand, navigasi, istilah, layout, dan responsive behavior bawaan Keycloak tidak boleh menjadi product experience akhir.

## Keputusan produk

1. `/account` pada SQ Hub menjadi **Akun SQ native UI** dan tidak lagi me-redirect pengguna ke Keycloak Account Console.
2. Keycloak tetap menjadi pemilik password, MFA/TOTP, recovery code, identity brokering, SSO, session IdP, dan protokol OIDC.
3. SQ Hub tidak membuat ulang password store, OTP verifier, recovery-code engine, atau protokol login.
4. Aksi keamanan yang memang harus diproses Keycloak menggunakan flow resmi Keycloak/OIDC, tetapi seluruh layar user-facing wajib memakai theme Akun SQ.
5. Account Console bawaan Keycloak tidak menjadi jalur navigasi pengguna Foundation. Ia boleh tetap tersedia secara teknis hanya untuk compatibility/operator fallback sampai dinyatakan aman untuk dinonaktifkan.
6. Istilah **Keycloak**, realm key, client ID, issuer internals, PatternFly naming, dan copy teknis provider tidak boleh muncul pada UI pengguna normal.
7. Responsive mobile adalah acceptance requirement, bukan enhancement setelah desktop.

## User-facing information architecture

Akun SQ native menyediakan empat area yang mudah dipahami:

### 1. Profil Saya
Menampilkan informasi akun yang relevan bagi pengguna:
- nama;
- NIP/username login;
- email;
- status verifikasi email.

Jangan menampilkan `issuer`, `sub`, realm, client ID, UUID, atau identifier teknis.

### 2. Keamanan
Menampilkan status sederhana:
- verifikasi dua langkah aktif / belum aktif / status belum dapat diverifikasi;
- kode pemulihan tersedia / belum tersedia / status belum dapat diverifikasi;
- entry point untuk tindakan keamanan yang didukung.

Tindakan sensitif tetap diproses oleh identity engine melalui flow resmi. Native UI hanya menjadi launcher dan presentation layer.

### 3. Login & perangkat
Foundation boleh menampilkan penjelasan kebijakan login/perangkat terpercaya dan status yang memang tersedia dengan aman. Jangan mengarang daftar device/session jika backend belum memiliki data yang dapat dipercaya.

### 4. Aplikasi Saya
Menampilkan aplikasi yang saat ini dapat dibuka berdasarkan SQ Hub Application Access. Ini bukan daftar role/permission domain.

## Authentication presentation contract

Semua flow berikut harus terlihat sebagai Akun SQ:
- login NIP/email + password;
- Google sign-in/brokering;
- invalid credential/error state;
- forgot password;
- reset/update password;
- TOTP challenge;
- TOTP enrollment;
- recovery code;
- account-link confirmation;
- logout;
- required actions lain yang termasuk Foundation.

Theme boleh mewarisi template provider untuk menjaga keamanan/protocol ownership, tetapi inheritance tersebut tidak boleh terlihat sebagai Keycloak/PatternFly product UI.

## Native account API

Browser Akun SQ menggunakan server-side Hub session yang sudah ada. API self-service:
- memvalidasi `sq_hub_session`;
- mengambil identity berdasarkan opaque `issuer + sub` server-side;
- hanya mengembalikan browser-safe profile/security summary;
- tidak mengembalikan raw `sub`, access token, refresh token, credential, OTP secret, recovery code, service credential, atau Keycloak admin metadata;
- fail closed bila session invalid;
- tidak mengubah Application Access atau domain authorization.

## Security actions

Untuk action yang didukung Keycloak Application Initiated Actions (AIA), SQ Hub boleh memulai OIDC authorization request dengan allowlist action eksplisit. Tidak ada arbitrary `kc_action` dari query user.

Allowlist Foundation:
- update password;
- configure TOTP;
- configure recovery authentication codes.

Hasil action harus kembali ke Akun SQ. Browser tidak boleh menyimpan token OIDC di `localStorage` / `sessionStorage`.

AIA bukan bukti bahwa action benar-benar selesai. Native page harus membaca ulang status server-side setelah kembali dan tidak boleh menganggap sukses hanya karena redirect.

## Google account boundary

Google tetap identity provider eksternal di belakang Akun SQ. Product copy menyebut "Google" bila memang pilihan pengguna, tetapi tidak menyebut Keycloak.

Existing-account linking wajib mempertahankan kontrak recovery/Google Foundation:
- tidak auto-create Staff yang tidak dikenal;
- tidak auto-link hanya berdasarkan email tanpa flow yang telah diterima;
- tidak menambah Application Access atau role domain;
- identity akhir tetap principal Akun SQ yang sama.

Native Account page tidak boleh mengimplementasikan linking Google melalui Admin API tanpa specification lanjutan dan proof keamanan.

## Mobile-first acceptance

Wajib diverifikasi setidaknya pada:
- 390×844;
- desktop 1280×720;
- desktop 1440×900.

Pada 390×844:
- tidak ada horizontal overflow;
- header tidak menabrak identitas pengguna;
- kartu account menjadi single-column;
- action target minimal nyaman disentuh;
- teks identifier panjang wrap/truncate secara aman;
- mobile bottom navigation tetap dapat digunakan;
- konten tidak tertutup bottom navigation;
- modal/required-action Akun SQ tetap scrollable;
- tidak ada sidebar desktop Keycloak/PatternFly yang muncul.

## Visual language

Native Akun SQ mengikuti SQ Design System/HCIS baseline:
- warm light background;
- turquoise semantic primary;
- rounded card geometry;
- subtle borders/elevation;
- Inter/LT Museum hierarchy sesuai aset yang memang tersedia;
- Bahasa Indonesia yang umum bagi pegawai.

Copy yang disarankan:
- "Profil Saya", bukan "Informasi pribadi" bila konteksnya halaman utama account;
- "NIP", bukan "Nama pengguna" untuk employee;
- "Email", bukan "Surel";
- "Keamanan", bukan terminology provider;
- "Aplikasi Saya", bukan technical client/session vocabulary.

## Out of scope

HUB-IMPL-019 tidak:
- mengganti Keycloak sebagai IdP;
- membuat custom OAuth/OIDC implementation;
- memindahkan password/MFA secrets ke SQ Hub;
- menjadikan SQ Hub pemilik role HCIS;
- mengimplementasikan Organization Directory;
- mengubah Identity Lifecycle;
- menyatukan external identity/SQ Portal;
- membuat session/device inventory palsu jika API belum mendukung data yang benar.

## Acceptance criteria

1. Mengklik **Kelola Akun SQ** dari Hub membuka native `/account`, tidak redirect ke `/realms/.../account/`.
2. Native page menampilkan Profil Saya, ringkasan Keamanan, dan Aplikasi Saya dari data server-side yang sah.
3. Response account browser tidak mengandung `subject`, issuer, token, credential, OTP secret, recovery code, atau client secret.
4. Password/TOTP/recovery launcher hanya menggunakan action allowlist dan tidak menerima arbitrary redirect/action dari browser.
5. Authentication/required-action pages tidak menampilkan brand/copy Keycloak pada active UI.
6. Browser auth/session contract HUB Foundation tetap berlaku: server-side code exchange, opaque HttpOnly Hub cookie, no token storage.
7. Layout Akun SQ lulus visual smoke desktop dan 390×844 tanpa overflow.
8. Existing Hub launcher, Application Access, Admin Center, logout, and domain authorization tidak berubah secara semantik.
9. Unit/integration tests mencakup account session enforcement, safe account response, action allowlist, dan native route rendering.
10. Production rollout memerlukan evidence runtime terpisah; CI tidak boleh dinyatakan sebagai production acceptance.

## Rollback

Jika native account mengalami regression:
- Hub account route dapat dikembalikan ke implementasi sebelumnya melalui rollback image;
- Keycloak identity data/credentials tidak dimigrasikan oleh perubahan ini, sehingga tidak ada credential rollback;
- jangan membuka Account Console bawaan sebagai silent fallback tanpa keputusan operator karena itu akan mengembalikan product experience yang secara eksplisit digantikan oleh spec ini.
