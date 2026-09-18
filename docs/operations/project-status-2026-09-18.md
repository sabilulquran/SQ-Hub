# Status proyek SQ Hub — 2026-09-18

Dokumen ini memisahkan **evidence repository** dari **evidence runtime/browser operator**. Pekerjaan GitHub tidak mengakses VPS, DNS, Cloudflare, database production, Keycloak production, browser production, atau credential.

## Ringkasan non-engineer

SQ Hub production launcher telah berhasil diverifikasi operator pada 18 September 2026. Portal **SQ Hub** aktif di `https://hub.sabilulquran.or.id`; sistem akun/login tetap bernama **Akun SQ**. Browser production berhasil login dengan Authorization Code + PKCE S256, kembali ke workspace, menampilkan HCIS sesuai Application Access, dan menampilkan Administrasi SQ untuk pengguna yang berwenang.

Deployment launcher yang sebelumnya diverifikasi operator memakai source commit `6f5f5e9db40644ee104c303e9f9f0d6786243819` (PR #80). Koreksi Account Console dari PR #81 kemudian merged sebagai `92ab28c7226b6835fdf29a98cb4ec5d77ac42539`, dideploy oleh operator dengan image Keycloak `ghcr.io/sabilulquran/sq-hub-keycloak@sha256:be63a077dd0df833a44264087c5238bc147734602c2dda6c15c4c5cb8f088987`, dan telah diverifikasi ulang melalui browser production desktop serta viewport 390×844. Dengan evidence operator tersebut, gap masthead/toolbar Account Console yang sebelumnya berstatus **belum diverifikasi fixed** sekarang berstatus **deployed dan browser-verified**.

Deployment PR #81 hanya merecreate container Keycloak. Operator melaporkan Keycloak kembali healthy; database Keycloak, SQ Hub API, dan SQ Hub web mempertahankan container identity serta waktu mulai sebelumnya. OIDC discovery production tetap sehat. Tidak ada perubahan database, migration, credential, authorization, Application Access, atau data pengguna dalam deployment ini. Catatan ini merekam evidence operator yang diberikan; pekerjaan dokumentasi di repository tidak mengakses atau mengubah runtime production.

## Matriks status

| Area | Status 18 September 2026 | Sumber evidence |
| --- | --- | --- |
| SQ Hub source/config | HUB-IMPL-016 source-of-truth closure dalam PR | repository + CI |
| Hub public TLS/HTTP | DEPLOYED; TLS valid, HTTP 200 | operator runtime |
| DNS Hub | A -> `103.89.5.4`, DNS only | operator runtime |
| Production OIDC client | `sq-hub` aktif pada `sq-staff` | operator runtime |
| Callback | `https://hub.sabilulquran.or.id/auth/callback` | operator runtime |
| Post logout | `https://hub.sabilulquran.or.id/` | operator runtime |
| OIDC flow | Authorization Code + PKCE S256 berhasil | operator/browser |
| OIDC transaction cookie | Secure, HttpOnly, SameSite=Lax | operator/browser |
| Workspace | workspace, HCIS Application Access, Administrasi SQ tampil sesuai akun yang diuji | operator/browser |
| API/web/Keycloak | healthy, restart count 0 | operator runtime |
| Public Admin Console | blocked; HTTP 404 | operator runtime |
| Bootstrap `cutover-bootstrap` | disabled | operator runtime |
| Realm display name | Akun SQ | operator runtime |
| login/account theme | `sq-hub` / `sq-hub` | operator runtime |
| SQ Hub + login Akun SQ | browser-verified setelah deployment launcher commit `6f5f5e9` | operator/browser |
| Account Console Akun SQ | PR #81 commit `92ab28c7…42539` deployed; desktop dan viewport 390×844 browser-verified | operator runtime + browser production |
| Account Console stylesheet | `akun-sq-account-148467199d0b.css` aktif pada browser production | browser production |
| Production image evidence | API/web tetap pada container sebelumnya; Keycloak PR #81 `be63a077…088987` | operator runtime |
| Database | deployment PR #81 tidak mengubah database atau migration | operator runtime |

## Topologi production yang menjadi kontrak

- SQ Hub API + web berada pada private `sq-hub-production_backend`;
- web juga berada pada dedicated `sq-hub-production_web_edge`;
- Caddy tetap merupakan container pada shared `edge_proxy`, lalu **bergabung** ke `sq-hub-production_web_edge`;
- Caddy menargetkan Hub web melalui DNS container yang unik, `sq-hub-production-web:80`;
- Hub web **tidak boleh** bergabung ke shared `edge_proxy`;
- nginx Hub tetap menggunakan alias `api:3100` hanya pada private backend network;
- menggunakan `127.0.0.1:18201` dari dalam containerized Caddy adalah konfigurasi salah.

Topologi Hub-web-ke-`edge_proxy` pernah menghasilkan collision alias generik `api` dengan aplikasi lain dan endpoint login 502. Karena itu contract test sekarang harus menolak pola tersebut.

## Insiden secret dan aturan setelah rotasi

Public OIDC login sempat gagal dengan `invalid_client_credentials` walaupun secret Keycloak dan file secret VPS sudah cocok. Penyebabnya adalah container API yang masih memuat environment lama. Setelah API di-force-recreate dari env file terbaru, login browser berhasil.

Mulai sekarang, setelah client secret berubah:

1. secret tidak boleh dicetak;
2. secret store/env file diperbarui;
3. API wajib di-force-recreate;
4. fingerprint SHA-256 non-secret Keycloak, secret file, dan environment container dibandingkan;
5. login baru boleh dianggap ready bila ketiganya cocok.

## Branding dan recovery

- **Akun SQ** adalah nama sistem akun/login.
- **SQ Hub** adalah nama portal aplikasi.
- Login dan Account Console menggunakan theme `sq-hub` serta logo/favicon organisasi.
- Public Keycloak Admin Console tetap diblokir; Admin Console adalah permukaan operator internal.
- Login master realm perlu branding Akun SQ, tetapi tidak ada fork besar Admin Console dalam scope ini.
- Repository menyiapkan bentuk konfigurasi non-secret SMTP master realm dan Forgot Password. Email recovery **belum boleh diklaim aktif** sampai operator memasukkan credential SMTP dan menguji pengiriman nyata.

## Batas klaim

CI dapat membuktikan source/configuration contract, typecheck, lint, test, build, Compose validation, secret scan, serta regression guard. CI tidak membuktikan kondisi VPS/browser saat ini. Status runtime/browser di atas berasal dari evidence operator 18 September 2026 yang diberikan untuk source-of-truth closure ini.


## Penutupan koreksi Account Console production

### Repository dan CI evidence

- PR #81, **fix(HUB-IMPL-017): correct Akun SQ Account Console runtime responsiveness**, merged ke `main` sebagai commit `92ab28c7226b6835fdf29a98cb4ec5d77ac42539`.
- Repository correction mempertahankan Account Console native `keycloak.v3` dan memperbaiki containment masthead/toolbar, organization mark, branding **Akun SQ**, responsive drawer, dan runtime assertions.
- Evidence repository/CI PR #81 membuktikan source, disposable Keycloak runtime, serta regression contract. Evidence ini tidak sendirinya membuktikan kondisi production.

### Operator runtime evidence — 18 September 2026

Operator melaporkan deployment PR #81 dengan batas bukti berikut:

- image Keycloak production: `ghcr.io/sabilulquran/sq-hub-keycloak@sha256:be63a077dd0df833a44264087c5238bc147734602c2dda6c15c4c5cb8f088987`;
- backup konfigurasi rollback: `compose.identity.json.before-pr81-20260918T114558Z`;
- container Keycloak direcreate dan kembali healthy;
- database Keycloak, SQ Hub API, dan SQ Hub web mempertahankan container identity serta waktu mulai sebelumnya;
- OIDC discovery production tetap sehat;
- tidak ada perubahan database, migration, credential, authorization, Application Access, atau data pengguna.

Backup rollback di atas adalah referensi nama artefak operator, bukan file yang disimpan di repository.

### Browser production evidence — 18 September 2026

Browser production desktop berhasil menampilkan:

- organization mark;
- brand **Akun SQ**;
- masthead putih;
- toolbar transparan;
- halaman **Informasi pribadi**;
- navigasi **Keamanan akun** dan **Aplikasi**.

Pada viewport **390×844**, operator mengukur:

- masthead tinggi **64 px**;
- masthead content berada pada top **8 px**, bottom **56 px**, tinggi **48 px**;
- judul mulai pada top **80 px**, sehingga terdapat gap **16 px** setelah masthead;
- tidak ada horizontal overflow;
- stylesheet aktif adalah `akun-sq-account-148467199d0b.css`;
- drawer navigasi membuka selebar **290 px** dan seluruh isinya berada dalam viewport.

Dengan evidence runtime dan browser tersebut, status koreksi Account Console berubah dari **belum diverifikasi fixed** menjadi **deployed dan browser-verified**.

### Batas klaim

Pemisahan evidence tetap wajib:

- **repository/CI evidence** membuktikan source/configuration dan regression contract;
- **operator runtime evidence** membuktikan deployment/container/discovery sesuai observasi operator pada 18 September 2026;
- **browser production evidence** membuktikan hasil rendering dan responsive behavior pada browser/viewport yang diuji operator.

Catatan ini tidak menyimpan password, token, cookie value, OTP, raw OIDC subject, secret, email pengguna, atau data pribadi lain. PR dokumentasi penutupan ini sendiri tidak mengubah source code, theme, workflow, Compose, image reference runtime, database, Keycloak production, DNS, secret, authorization, Application Access, atau data pengguna.
