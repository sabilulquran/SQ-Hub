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

## Feature-parity contract

Native Akun SQ **tidak boleh menjadi subset read-only** dari Account Console yang digantikannya. Setiap capability self-service yang aktif dan diberikan kepada Staff oleh realm/Account API harus tetap tersedia melalui native Akun SQ, dengan bahasa dan visual SQ.

Baseline parity untuk Foundation:

### 1. Profil Saya
- tampilkan metadata profil yang diizinkan Account API;
- field read-only tetap read-only;
- field editable dapat disimpan dari native Akun SQ;
- NIP/username tidak boleh dibuat editable bila metadata provider menandainya read-only;
- validasi provider tetap menjadi source of truth.

### 2. Keamanan
- tampilkan seluruh credential container yang diberikan Account API;
- password, TOTP/authenticator, dan recovery code tetap dapat dibuat/diperbarui sesuai metadata/action provider;
- credential yang memang removable dapat dihapus melalui required action resmi;
- jangan menyembunyikan credential type aktif hanya karena native UI tidak mengenal labelnya.

### 3. Sesi & Perangkat
- tampilkan device/session activity yang benar dari Account API;
- tandai current device/current session;
- user dapat mengakhiri sesi lain secara individual;
- user dapat mengakhiri semua sesi lain;
- current session tidak diberi tombol single-session logout yang menipu; logout current identity tetap menggunakan flow logout Akun SQ.

### 4. Aplikasi
Dua konsep wajib dipisahkan:
- **Aplikasi SQ yang dapat Anda buka** berasal dari SQ Hub Application Access;
- **Aplikasi yang terhubung ke Akun SQ** berasal dari identity Account API dan dapat memiliki consent/offline access.

Bila provider mengizinkan, user dapat mencabut consent melalui native Akun SQ. Mencabut consent tidak boleh dimaknai sebagai mencabut Application Access.

### 5. Akun Terhubung
- tampilkan identity provider yang terhubung, termasuk Google bila dikonfigurasi;
- tampilkan provider yang tersedia untuk dihubungkan;
- link menggunakan Application Initiated Action resmi dan kontrak Google existing-account-link-only;
- unlink hanya dilakukan terhadap provider yang server verifikasi memang terhubung pada user tersebut.

### 6. Capability kondisional
Capability provider lain seperti group membership hanya muncul bila Account API/realm benar-benar mengaktifkan dan mengembalikan capability tersebut.

Organizations, verifiable credentials, resources/UMA, atau delete-account **tidak dianggap baseline aktif** hanya karena Keycloak mendukungnya secara umum. Jika capability tersebut diaktifkan kemudian, spec/CI native harus diperluas sebelum Account Console provider dinonaktifkan untuk capability itu.

Jangan menampilkan `issuer`, `sub`, realm UUID, credential secret, raw token, atau identifier internal yang tidak membantu user.

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

## Native account BFF and delegated Account API

Browser Akun SQ menggunakan opaque server-side Hub session yang sudah ada. Browser **tidak** menjadi OIDC client untuk Account API.

Backend:
- memvalidasi `sq_hub_session`;
- menerima refresh token hanya dari server-side Authorization Code + PKCE exchange;
- mengenkripsi refresh token at-rest dengan authenticated encryption sebelum disimpan bersama Hub session;
- tidak menyimpan access token jangka panjang;
- saat self-service dibutuhkan, menukar refresh token server-side untuk short-lived access token lalu memanggil **official Keycloak Account REST API sebagai user yang sama**;
- menyimpan rotated refresh token kembali dalam bentuk terenkripsi;
- tidak memakai service account/admin credential untuk bertindak sebagai semua pegawai;
- memetakan response provider menjadi DTO browser-safe dan tidak meneruskan payload mentah provider;
- bila delegated account capability belum tersedia pada session lama, mengembalikan `ACCOUNT_REAUTH_REQUIRED`, bukan membuka scope atau fallback admin;
- bila identity directory gagal, profil dasar + Application Access tetap dapat dirender; directory bukan authority self-service credential/session;
- fail closed bila Hub session invalid.

Browser response tidak boleh berisi raw `sub`, issuer, access token, refresh token, ID token, credential secret, OTP secret, recovery code, client secret, atau admin metadata.

## Security actions and mutation boundary

Untuk action sensitif yang memang dimiliki identity engine, SQ Hub memulai Application Initiated Action (AIA) berdasarkan metadata Account API dan **validasi server-side**. Tidak ada arbitrary `kc_action` dari query browser.

Baseline action yang diterima:
- `UPDATE_PASSWORD`;
- `UPDATE_EMAIL` hanya bila metadata profil provider menandai email mendukung required action tersebut;
- `CONFIGURE_TOTP`;
- `CONFIGURE_RECOVERY_AUTHN_CODES`;
- `idp_link:<provider>` hanya setelah provider diverifikasi tersedia bagi user;
- `delete_credential:<credentialId>` hanya setelah credential diverifikasi milik user dan removable.

Mutation profil, session logout, consent revoke, dan unlink account dilakukan lewat Account API sebagai user yang sama. Semua mutation endpoint native:
- same-origin only;
- mengambil target resource server-side sebelum mutation untuk bounded ownership;
- tidak menerima actor/subject/issuer dari browser;
- tidak mengubah Application Access atau domain role.

Hasil AIA kembali ke native Akun SQ dan status dibaca ulang server-side. Redirect sukses bukan bukti sendiri bahwa action berhasil.

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

## Least-privilege token contract

Client Hub tetap confidential Authorization Code + PKCE, `fullScopeAllowed=false`, tanpa direct access grant dan tanpa service account.

Delegated Account API memerlukan:
- access-token audience `account`;
- scope mapping hanya untuk baseline account roles:
  - `manage-account`;
  - `view-profile`;
  - `manage-account-links`;
  - `view-applications`;
  - `view-consent`;
  - `manage-consent`;
  - `view-groups`.

`delete-account`, verifiable-credential roles, realm-management, dan broad admin roles tidak boleh ditambahkan untuk HUB-IMPL-019.

Repository menyediakan idempotent reconciliation untuk scope/audience dan CI harus membuktikan tidak ada account-role scope yang lebih luas dari allowlist.

### Production reconciliation handoff

Production **tidak** mengubah scope/audience sebagai side effect dari rollout image Keycloak. Perubahan realm tetap menjadi aksi operator berizin yang terpisah.

Sebelum native self-service dinyatakan siap di production, operator wajib menjalankan:

`infra/keycloak/scripts/reconcile-native-account-self-service.sh`

terhadap exact realm `sq-staff`, client `sq-hub`, dan Compose identity production yang sudah dirender. Untuk root-owned runtime bundle saat ini, helper mendukung `KEYCLOAK_COMPOSE_FILE=/var/www/sq-hub-production/compose.identity.json` dan `KEYCLOAK_ENV_FILE=""` agar tidak mengasumsikan file env staging. Helper tetap mensyaratkan authenticated `kcadm` config yang sudah tersedia **di dalam** container Keycloak dan tidak mengelola credential administrator.

Aksi production harus:
- dijalankan dari reviewed source SHA yang sama dengan release;
- fail closed bila Organizations, user-managed resources/UMA, Verifiable Credentials, atau Delete Account ternyata aktif; capability tersebut harus dipetakan native lebih dulu sebelum rollout dilanjutkan;
- hanya menambah/menjaga tujuh role account-client allowlist dan audience `account`;
- fail closed bila ada role account-client lain yang sudah terscope ke `sq-hub`;
- tidak mengubah HCIS client, Google provider, trusted-device flow, MFA, realm key/issuer, theme, atau client secret;
- merekam hanya marker `NATIVE_ACCOUNT_CAPABILITY_BASELINE_PASS`, `NATIVE_ACCOUNT_SCOPE_MAPPING_PASS`, dan `NATIVE_ACCOUNT_AUDIENCE_PASS`, tanpa token/secret/raw user data.

Green CI membuktikan helper dan disposable Keycloak behavior, tetapi **bukan** bukti bahwa reconciliation production sudah dijalankan.

## Out of scope

HUB-IMPL-019 tidak:
- mengganti Keycloak sebagai IdP;
- membuat custom password/TOTP/recovery verifier;
- memindahkan credential secret atau MFA secret ke SQ Hub;
- menggunakan Keycloak Admin API/service account sebagai mekanisme self-service pegawai;
- menjadikan SQ Hub pemilik role HCIS;
- mengimplementasikan Organization Directory;
- mengubah Identity Lifecycle;
- menyatukan external identity/SQ Portal;
- mengaktifkan capability Account Console yang sebelumnya tidak aktif hanya demi mengejar jumlah menu.

## Acceptance criteria

1. Mengklik **Kelola Akun SQ** dari Hub membuka native `/account`, tidak redirect ke provider Account Console.
2. Native navigation baseline memuat Profil Saya, Keamanan, Sesi & Perangkat, Aplikasi, dan Akun Terhubung; Keanggotaan muncul bila data group tersedia.
3. Profil editable mengikuti metadata read-only/required/multivalued provider; field biasa disimpan melalui Account API, sedangkan email memakai `UPDATE_EMAIL` bila provider menandainya sebagai required-action-managed.
4. Credential container aktif tidak dihilangkan; password/TOTP/recovery memakai provider action yang sudah diverifikasi server-side.
5. Device/session inventory berasal dari provider; non-current session dapat diakhiri dan semua sesi lain dapat diakhiri.
6. SQ Application Access dan identity-connected applications/consents ditampilkan sebagai dua konsep berbeda.
7. Linked provider dapat dihubungkan/diputus hanya setelah ownership/availability diverifikasi server-side.
8. Hub access token untuk self-service memiliki audience `account` dan account-role scope tepat sesuai allowlist, dengan `fullScopeAllowed=false`.
9. Refresh token delegated disimpan terenkripsi at-rest; access/refresh/ID token tidak pernah dikirim ke browser atau disimpan di browser storage.
10. Account mutation endpoints same-origin dan tidak menerima arbitrary subject/issuer/action/redirect dari browser.
11. Authentication/required-action pages tetap berwajah Akun SQ tanpa brand/copy Keycloak pada active UI.
12. Layout setiap baseline section lulus visual smoke desktop dan 390×844 tanpa horizontal overflow.
13. Existing Hub launcher, Application Access, Admin Center, logout, dan domain authorization tidak berubah semantik.
14. Unit/integration tests mencakup encryption/rotation, resource ownership validation, read-only profile enforcement, account reauth fallback, and parity navigation.
15. Production rollout memerlukan reconciliation scope/audience + runtime evidence terpisah; CI tidak boleh dinyatakan sebagai production acceptance.

## Rollback

Jika native account mengalami regression:
- Hub account route dapat dikembalikan ke implementasi sebelumnya melalui rollback image;
- Keycloak identity data/credentials tidak dimigrasikan oleh perubahan ini, sehingga tidak ada credential rollback;
- jangan membuka Account Console bawaan sebagai silent fallback tanpa keputusan operator karena itu akan mengembalikan product experience yang secara eksplisit digantikan oleh spec ini.
