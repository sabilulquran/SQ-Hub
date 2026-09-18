# Status proyek SQ Hub — 2026-09-18

Dokumen ini memisahkan **evidence repository** dari **evidence runtime/browser operator**. Pekerjaan GitHub tidak mengakses VPS, DNS, Cloudflare, database production, Keycloak production, browser production, atau credential.

## Ringkasan non-engineer

SQ Hub production launcher telah berhasil diverifikasi operator pada 18 September 2026. Portal **SQ Hub** aktif di `https://hub.sabilulquran.or.id`; sistem akun/login tetap bernama **Akun SQ**. Browser production berhasil login dengan Authorization Code + PKCE S256, kembali ke workspace, menampilkan HCIS sesuai Application Access, dan menampilkan Administrasi SQ untuk pengguna yang berwenang.

Deployment yang diverifikasi operator memakai source commit `6f5f5e9db40644ee104c303e9f9f0d6786243819` (PR #80). Image runtime yang dilaporkan operator adalah API `ghcr.io/sabilulquran/sq-hub-api@sha256:4015f029c3559edb0165fe20cc7b4bde05d6504acf51883a4fd668b6f7f56ec5`, web `ghcr.io/sabilulquran/sq-hub-web@sha256:f43ac77cc6d2b3acc3d27a92b265e860d5570128d8612ea3c921f31e61df6944`, dan Keycloak `ghcr.io/sabilulquran/sq-hub-keycloak@sha256:1e9ec16edc38d6ac470bf2c92b31425895946f11330eb8882f90c8897b285adc`. SQ Hub dan halaman login Akun SQ sudah browser-verified oleh operator. Setelah deployment tersebut, operator menemukan gap responsive pada Account Console: toolbar masthead native `keycloak.v3` membentuk baris/permukaan gelap dan pada mobile menimpa judul halaman. Koreksi gap itu sedang dikerjakan di repository dan belum boleh dianggap fixed di production sebelum deployment serta browser verification operator berikutnya.

Pekerjaan source-of-truth dan koreksi repository ini tidak melakukan deployment ulang. Tujuannya adalah membuat repository mencerminkan topologi yang terbukti bekerja, menutup penyebab insiden secret lama, menjaga branding Akun SQ, serta menambah contract test agar konfigurasi dan layout yang diketahui gagal tidak dapat masuk kembali.

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
| Master administrator | `admin@sabilulquran.or.id` | operator runtime |
| Bootstrap `cutover-bootstrap` | disabled | operator runtime |
| Realm display name | Akun SQ | operator runtime |
| login/account theme | `sq-hub` / `sq-hub` | operator runtime |
| SQ Hub + login Akun SQ | browser-verified setelah deployment commit `6f5f5e9` | operator/browser |
| Account Console mobile | operator menemukan masthead/toolbar overlap; koreksi repository sedang berjalan, production belum diverifikasi fixed | operator/browser + repository work |
| Production image digests | API `4015f029…f56ec5`; web `f43ac77c…df6944`; Keycloak `1e9ec16e…285adc` | operator runtime |
| Database | tidak ada migration/perubahan destruktif dalam cutover ini | operator runtime |

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


## Koreksi pascadeployment Account Console

Temuan operator sesudah deployment commit `6f5f5e9` menunjukkan bahwa stylesheet child theme Account Console memang termuat dan organization mark berhasil dimuat, tetapi fixture CI sebelumnya tidak merepresentasikan DOM masthead runtime `keycloak.v3`. Karena itu fixture dapat lulus walaupun `.pf-v5-c-masthead__content` dan toolbar native keluar dari tinggi masthead pada viewport mobile.

Repository correction setelah temuan ini harus dibuktikan pada disposable Keycloak 26.7.2 yang menjalankan child theme `sq-hub`, dengan persona sintetis dan screenshot runtime aktual. Evidence tersebut hanya membuktikan repository/disposable-runtime readiness. Production tetap berstatus **belum diverifikasi fixed** sampai operator mendeploy image/theme hasil PR dan melakukan browser verification pada production.
