# HUB-IMPL-017 — SQ Hub + Akun SQ navigation experience

**Status:** ACCEPTED
**Date:** 2026-09-18
**Owner:** Product Owner SQ Hub/HCIS — Human Capital YSQ
**Products:** SQ Hub + Akun SQ
**Depends on:** HUB-IMPL-004, HUB-IMPL-005, HUB-IMPL-007, HUB-IMPL-009, HUB-IMPL-015, HUB-IMPL-016, HUB-IMPL-019, ADR-0003, ADR-0004, ADR-0006, staff authentication policy, security baseline

## Tujuan

Menyederhanakan SQ Hub menjadi portal aplikasi internal yang matang dan mudah dikenali, serta menjadikan Akun SQ sebagai permukaan akun/login/credential/security/session yang konsisten. Pola interaksi boleh familiar seperti ekosistem akun dan launcher aplikasi modern, tetapi identitas visual, copy, asset, dan implementasi tetap milik Yayasan Sabilul Qur'an.

Specification ini menggantikan struktur shell SQ Hub yang mengharuskan sidebar permanen pada HUB-IMPL-004/010. Semantic token, brand family, accessibility, Application Access, server-side session, dan authorization boundary dari specification sebelumnya tetap berlaku.

## Model produk

### SQ Hub

SQ Hub adalah portal authenticated untuk membuka aplikasi internal yang memang dikirim oleh server melalui `WorkspaceSnapshot.applications`.

SQ Hub:
- bukan dashboard KPI;
- bukan pemilik business UI HCIS;
- bukan identity provider;
- bukan sumber role/permission domain;
- tidak menghitung Application Access di browser.

### Akun SQ

Akun SQ adalah nama produk yang terlihat pengguna untuk:
- login;
- credential/password;
- MFA/TOTP;
- recovery;
- session;
- linked account;
- account settings yang disediakan Keycloak.

Keycloak tetap menjadi identity engine sesuai ADR-0003. Istilah teknis Keycloak tidak perlu muncul pada journey pengguna biasa. Nama lama `SQ Identity` tidak boleh muncul pada UI aktif SQ Hub atau theme Akun SQ.

Keycloak Admin Console tetap permukaan operator teknis dan tidak termasuk redesign ini.

## Information architecture

### `/` — Beranda

Halaman pertama setelah login.

Berisi:
- global header SQ Hub;
- sapaan singkat berdasarkan `workspace.user.displayName`;
- section `Aplikasi Anda`;
- jumlah aplikasi yang tersedia;
- grid aplikasi dari `WorkspaceSnapshot.applications` saja;
- empty state bila tidak ada aplikasi;
- tautan jelas ke `/apps`.

Beranda tidak memuat KPI, statistik palsu, berita, tugas, notifikasi, recent activity, atau data HCIS. Penjelasan teknis Application Access tidak ditampilkan sebagai panel besar pada penggunaan sehari-hari.

### `/apps` — Semua aplikasi

Menampilkan seluruh aplikasi yang sudah diotorisasi server untuk sesi tersebut.

Perilaku:
- source daftar tetap `WorkspaceSnapshot.applications`;
- pencarian hanya memfilter nama/deskripsi dari array yang sudah diterima browser;
- browser tidak meminta registry aplikasi global;
- field pencarian memiliki label aksesibel;
- empty workspace dan no-result search adalah state berbeda;
- kartu aplikasi membuka `canonicalUrl`;
- icon generik konsisten dipakai sampai registry memiliki kontrak asset icon.

Tidak ada route `/apps/:slug` pada specification ini.

### `/admin`

Mempertahankan Go 5A/5B yang sudah diterima.

- Navigation hanya ditawarkan ketika `workspace.capabilities.platformAdministration === true`.
- UI visibility bukan authorization control.
- Existing server-side `/api/admin/*` authorization, fresh-session behavior, registry, Application Access, directory, audit, mutation origin guard, dan fail-closed behavior tetap berlaku.
- Global header, app launcher, account menu, spacing, dan mobile navigation mengikuti shell baru.
- Platform Administrator source of truth tidak berubah.

### `/account`

Route web stabil dan ramah pengguna untuk Akun SQ.

Sejak HUB-IMPL-019:
1. web merender native Akun SQ di SQ Hub;
2. browser mengambil browser-safe account snapshot dari endpoint Hub internal;
3. endpoint mensyaratkan Hub session valid dan membaca identity server-side;
4. response tidak mengekspos issuer, subject, token, credential, OTP secret, atau recovery code;
5. Profil Saya, Keamanan, Login & perangkat, dan Aplikasi Saya memakai bahasa SQ yang umum;
6. action password/TOTP/recovery hanya dapat dimulai melalui allowlist server-side;
7. Keycloak Account Console tidak lagi menjadi destination normal pengguna.

Authentication required-action tetap diproses identity engine dan kembali ke native `/account`.

### Route yang sengaja tidak dibuat

- `/help`;
- `/apps/:slug`;
- notification center;
- recent activity;
- favorites persistence;
- multi-account switching;
- profile editing milik HCIS;
- organisasi/unit pegawai;
- account security API buatan SQ Hub.

Route lain yang tidak dikenal menampilkan state not-found generik tanpa membocorkan Admin Center.

## Route contract

Web menggunakan typed pathname resolver sederhana; dependency router baru tidak diperlukan untuk empat route ini.

| Path | Surface | Authorization |
| --- | --- | --- |
| `/` | Beranda SQ Hub | valid Hub session |
| `/apps` | Semua aplikasi | valid Hub session |
| `/account` | native Akun SQ | valid Hub session + browser-safe identity lookup |
| `/admin` dan child path yang sudah dimiliki Admin Center | Administrasi SQ | valid Hub session + existing Platform Administrator authorization |

Exact `/auth/callback` tetap server-side pada nginx dan bukan SPA route.

## Global header

Desktop:
- sticky, ringan, dan tidak terlalu tinggi;
- kiri: organization mark yang sudah disetujui + `SQ Hub`;
- kanan: app launcher lalu avatar/account menu;
- tidak ada permanent sidebar untuk Beranda atau Semua aplikasi;
- content memakai max-width yang nyaman dan whitespace cukup.

App launcher:
- trigger memakai icon grid/9-dot dengan accessible name;
- `aria-haspopup` dan `aria-expanded` mengikuti state;
- hanya menampilkan aplikasi dari authorized workspace snapshot;
- dapat memuat `Beranda`, `Semua aplikasi`, dan `Administrasi SQ` bila capability server true;
- Escape dan outside click menutup launcher;
- focus kembali ke trigger setelah Escape;
- mobile memakai sheet/panel yang cukup lebar dan dapat di-scroll, bukan popover sempit.

Tidak ada help icon, notification bell, atau kontrol dekoratif tanpa tindakan nyata.

## Menu avatar

Berisi:
- display name;
- context label bila tersedia;
- `Kelola Akun SQ` -> `/account`;
- `Buka semua aplikasi` -> `/apps`;
- `Administrasi SQ` hanya bila server capability true;
- `Keluar`.

Logout tetap menggunakan `POST /api/auth/logout`, revokasi server-side Hub session, lalu official OIDC end-session flow. Tidak ada switch account.

## Desktop behavior

Pada desktop:
- header global selalu menjadi navigasi utama;
- Beranda dan Semua aplikasi tidak memiliki sidebar permanen;
- application grid memakai ruang horizontal secara efisien tanpa menjadi dashboard padat;
- card, border, radius, shadow, typography, dan focus state tetap memakai semantic SQ tokens;
- Admin Center memakai header global yang sama sambil mempertahankan tab/section administrasi yang sudah ada.

## Mobile behavior

Acceptance viewport minimum:
- 320 px;
- 360 px;
- 390×844;
- 412 px;
- tablet 768 px;
- desktop 1280×720;
- desktop 1440×900.

Pada mobile:
- header ringkas dan organization mark tetap jelas;
- app launcher dan avatar selalu dapat dijangkau;
- bottom navigation berisi Beranda, Aplikasi, Akun, dan Admin hanya bila authorized;
- jumlah item menyesuaikan capability;
- `aria-current` mengikuti pathname aktif;
- safe-area bottom padding digunakan;
- target sentuh utama minimum sekitar 44×44 px;
- app grid menjadi dua kolom saat ruang cukup dan satu kolom pada layar sempit;
- menu/sheet tidak terpotong viewport dan dapat di-scroll;
- main content memiliki bottom padding sehingga kartu terakhir tidak tertutup bottom navigation;
- tidak ada horizontal overflow pada 390×844;
- login Akun SQ tetap usable saat mobile keyboard/autofill aktif.

## Visual direction

Gunakan:
- `apps/web/src/assets/brand/ysq-mark.png`;
- favicon yang sudah disetujui;
- `ysq-mark.svg` dan favicon theme Akun SQ;
- warm-white/light-gray canvas;
- white surface;
- turquoise SQ sebagai primary/focus;
- heading gelap;
- border tipis;
- radius sedang;
- shadow ringan;
- motion kecil dan fungsional.

Hindari:
- logo SQ generik/provider logo;
- hero dekoratif besar;
- KPI/dashboard styling;
- gradient berlebihan;
- glassmorphism berat;
- business-specific HCIS navigation;
- istilah teknis identity/provider pada UI biasa.

HCIS tetap baseline semantic visual family, tetapi struktur sidebar HCIS tidak diwajibkan untuk portal SQ Hub setelah specification ini.

## Akun SQ login

Theme `sq-hub` tetap child `keycloak.v2` dan mempertahankan native Keycloak templates kecuali override TOTP trusted-device yang sudah diterima.

Semua supported flow harus memakai satu bahasa visual:
- identifier NIP/email;
- password;
- Google;
- invalid credential;
- TOTP;
- trusted-device;
- recovery code;
- forgot/reset password;
- required action;
- account linking;
- logout confirmation;
- expired action;
- general error.

Arah:
- centered account card;
- organization mark + `Akun SQ`;
- Indonesia-first;
- quiet canvas;
- hierarchy form jelas;
- error berdekatan dengan action/form;
- primary button turquoise;
- secondary action lebih tenang;
- mobile nyaman, autofill readable, konten panjang scrollable.

Native form action, field name, hidden input, OIDC parameter, OTP field, `trustDevice`, dan security behavior tidak boleh berubah.

## Akun SQ native account + legacy Account Console

HUB-IMPL-019 menggantikan Account Console sebagai experience pengguna normal. Native React `/account` adalah destination final di Hub.

Theme account `keycloak.v3` tetap dipaketkan sebagai compatibility/operator fallback selama transisi, bukan sebagai navigation target pengguna.

Presentation menggunakan mekanisme theme yang didukung:
- masthead Akun SQ + organization mark/favicon;
- concise navigation;
- overview dan security content berbasis surface/card/list yang tenang;
- password/authenticator/recovery/session/application/linked-account mengikuti native capability Keycloak;
- destructive action memiliki hierarchy yang berbeda dan tidak bergantung pada warna saja;
- list/table desktop tetap usable pada mobile melalui wrapping/stacking/overflow yang terkontrol;
- navigation mobile mengikuti behavior native PatternFly/Keycloak, dengan styling yang tidak merusak drawer/toggle bawaan;
- tidak ada generic Keycloak product branding pada journey yang dapat dikustom melalui theme.

Visual contract Account Console wajib memeriksa DOM runtime `keycloak.v3` yang benar-benar dirender oleh disposable Keycloak 26.7.2. Fixture statis tetap berguna sebagai fast contract, tetapi tidak boleh menjadi satu-satunya bukti karena fixture dapat berbeda dari struktur native `.pf-v5-c-masthead__toggle`, `.pf-v5-c-masthead__brand`, `.pf-v5-c-masthead__content`, dan `.pf-v5-c-toolbar`. Browser smoke runtime minimal harus menguji 320×844, 360×844, 390×844, 412×844, dan 1440×900; membuktikan masthead content tetap berada di dalam masthead, judul dimulai setelah masthead, toolbar tidak gelap, logo dan teks Akun SQ terlihat, tidak ada horizontal overflow, drawer/toggle native tetap bekerja, dan surface security/session tetap usable.

Jika CSS berubah, filename wajib memakai content-derived Git blob hash 12 karakter; `theme.properties`, `contentHashPattern`, dan contract test diperbarui pada commit yang sama. File hashed lama yang tidak lagi direferensikan dihapus.

## Accessibility

Wajib:
- semantic heading order;
- button/link memakai elemen native yang sesuai;
- visible focus;
- keyboard usable;
- Escape/outside click pada launcher/menu;
- focus restoration ke trigger setelah Escape;
- accessible name untuk icon-only control;
- `aria-current` sesuai route aktif;
- popover/sheet mempunyai label;
- contrast layak;
- decorative icon `aria-hidden`;
- `prefers-reduced-motion`;
- tidak mengandalkan warna saja untuk error/status;
- no horizontal overflow pada 390×844;
- konten tetap usable pada zoom 200%.

## Security boundaries

Specification ini tidak mengubah:
- production issuer `https://login.sabilulquran.or.id/realms/sq-staff`;
- staging realm/client separation;
- client ID;
- redirect URI;
- post-logout URI;
- Authorization Code flow;
- PKCE S256;
- state/nonce;
- `issuer + sub` identity mapping;
- secure server-side Hub session;
- Application Access source of truth;
- domain role ownership;
- Platform Administrator authorization;
- logout flow;
- cookie security;
- browser bearer-token storage prohibition;
- public Admin Console HTTP boundary.

Dilarang:
- localStorage/sessionStorage untuk access/refresh/ID token, auth code, state, nonce, PKCE verifier, password, OTP, atau recovery code;
- wildcard auth cookie;
- source secret;
- production identity data pada fixture/screenshot/test;
- local fallback login;
- custom OAuth/OIDC implementation;
- account page palsu yang tidak menuju Keycloak.

## Scope

In scope:
1. spec dan route contract baru;
2. global header/app launcher/account menu/mobile navigation;
3. Beranda dan Semua aplikasi;
4. account transition + authenticated server redirect;
5. Admin Center shell alignment tanpa mengubah business capability;
6. login/account theme presentation polish;
7. meaningful unit/contract/security tests;
8. synthetic preview dan visual smoke.

## Non-goals

- HCIS UI/business logic;
- production deployment;
- SMTP credential/delivery;
- DNS/Cloudflare/Caddy/VPS mutation;
- Keycloak Admin Console redesign;
- custom Keycloak protocol/credential database;
- account switching;
- notifications/recent activity/favorites;
- employee profile/Organizational Unit;
- domain roles/permissions;
- Application Access behavior change;
- legacy credential cleanup;
- database migration.

## Acceptance criteria

1. `/` merender Beranda dan hanya aplikasi authorized snapshot.
2. `/apps` merender seluruh authorized apps dan client-side search hanya memfilter snapshot.
3. Empty workspace dan no-result search berbeda dan usable.
4. App launcher hanya memakai authorized applications dan menutup via Escape/outside click dengan focus restoration.
5. Admin link hanya ada ketika `platformAdministration === true`.
6. Account menu memiliki `/account`, `/apps`, conditional `/admin`, dan official logout.
7. `/account` merender native Akun SQ dan tidak menerima arbitrary redirect/action target.
8. Server account API membutuhkan Hub session, hanya mengembalikan browser-safe data, dan action security memakai allowlist.
9. Desktop Beranda/Apps tidak memiliki permanent sidebar.
10. Mobile bottom navigation memiliki Beranda/Aplikasi/Akun + conditional Admin, safe-area, dan tidak menutup konten.
11. 320/360/390/412/768/1280×720/1440×900 layout tidak memerlukan horizontal page scroll.
12. Active navigation mempunyai `aria-current`.
13. Akun SQ login tetap memakai native Keycloak action/fields dan semua supported flow tetap ter-theme.
14. Native Akun SQ responsive; legacy Account Console `keycloak.v3` hanya compatibility fallback.
15. Active user-facing Hub/theme tidak menampilkan `SQ Identity` atau generic Keycloak branding yang dapat ditheme.
16. Organization mark/favicon tetap dipakai.
17. Browser source tetap bebas bearer-token/code/PKCE storage.
18. Nginx exact `/auth/callback` tetap server-side.
19. Theme stylesheet hash contract benar dan stale hashed file tidak aktif/tersisa.
20. Production/staging issuer, callback, client separation, dan Admin Console boundary tidak berubah.
21. API/web typecheck, lint, test, build dan repository contracts yang relevan lulus.
22. Visual smoke menyediakan synthetic structural evidence untuk Hub desktop/mobile, launcher/menu/empty/admin visibility, Akun SQ login states, dan Account Console desktop/mobile; Account Console wajib memiliki bukti tambahan dari disposable runtime Keycloak `keycloak.v3`, bukan hanya fixture statis.
23. Tidak ada secret atau production personal data di diff.

## Deployment dan rollback boundary

PR ini hanya mengubah source repository dan CI evidence. Ia tidak mengotorisasi perubahan VPS, DNS, Cloudflare, production database, production Keycloak, credential, secret, atau live browser state.

Deployment tetap mengikuti operational baseline/HUB-IMPL-016 dan harus memisahkan:
- repository readiness;
- operator deployment;
- browser verification.

Rollback runtime adalah kembali ke image/configuration SQ Hub/Keycloak theme release sebelumnya yang sudah tercatat. Perubahan ini tidak membutuhkan database rollback karena tidak menambah migration. Rollback tidak boleh mengubah issuer, realm, client, Application Access, atau domain data.
