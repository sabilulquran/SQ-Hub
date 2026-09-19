# Status proyek SQ Hub — 2026-09-19

Dokumen ini adalah ringkasan source of truth setelah merge PR #82 dan PR #83. Ia membedakan **produk/source**, **deployment/runtime**, dan **acceptance pengguna**. Pekerjaan repository tidak mengakses atau mengubah VPS, DNS, browser production, database production, Keycloak production, SMTP credential, Google OAuth secret, atau secret store.

## Ringkasan non-engineer

Versi inti **Akun SQ + SQ Hub sudah jadi dan sudah dipakai di production**.

Pengguna Staff sudah memiliki satu Akun SQ untuk login, dapat masuk ke SQ Hub, melihat aplikasi yang diberi akses, membuka HCIS melalui SSO, membuka Account Console, dan menggunakan tampilan desktop/mobile yang sudah diverifikasi. Administrator platform sudah memiliki Administrasi SQ foundation dan pengelolaan Application Access.

Yang tersisa bukan membangun ulang login/launcher. Pekerjaan aktif berikutnya adalah menutup acceptance beberapa fitur keamanan/akun dan menambah workflow platform yang belum accepted.

## Status kemampuan

| Area | Status | Evidence / batas klaim |
| --- | --- | --- |
| Akun SQ login + Staff SSO | **PRODUCTION** | OIDC Authorization Code + PKCE dan login production telah diverifikasi operator/browser |
| SQ Hub launcher | **PRODUCTION** | `https://hub.sabilulquran.or.id` TLS/HTTP dan workspace production telah diverifikasi |
| HCIS launcher + Application Access | **PRODUCTION** | HCIS muncul sesuai Application Access pada akun yang diuji; authorization domain tetap milik HCIS |
| Administrasi SQ foundation | **PRODUCTION FOUNDATION** | surface admin dan Application Access administration tersedia; bukan universal domain admin |
| Account Console Akun SQ | **PRODUCTION / BROWSER-VERIFIED** | PR #81 merged, deployed, desktop + 390×844 diverifikasi; closure dicatat melalui PR #82 |
| Password recovery | **IMPLEMENTED / RUNTIME ACCEPTANCE PENDING** | HUB-IMPL-011 Accepted; production reset-password pernah teramati aktif, tetapi SMTP email E2E + expiry/single-use belum mempunyai evidence penutupan terbaru |
| Google sign-in | **IMPLEMENTED / RUNTIME ACCEPTANCE PENDING** | HUB-IMPL-011 Accepted; provider pernah teramati aktif, tetapi existing-account link, no-user negative case, MFA, exact mapping, dan authorization regression masih memerlukan evidence |
| Trusted-device TOTP | **IMPLEMENTED / RUNTIME ACCEPTANCE PENDING** | HUB-IMPL-012 Accepted; provider/flow pernah teramati aktif, tetapi full browser scenario matrix belum ditutup |
| Staff provisioning/offboarding | **PROPOSED** | PR #42 / HUB-IMPL-013 masih draft dan memiliki policy/security decisions yang belum accepted |
| Organization Directory | **BOUNDARY ACCEPTED / IMPLEMENTATION DISCOVERY** | ADR-0007 Accepted dan PR #83 merged; HUB-IMPL-018 masih DISCOVERY dan belum mengotorisasi runtime implementation |
| SQ Portal / universal account eksternal | **DISCOVERY / LATER** | PR #12 tetap discovery dan tidak menjadi scope Foundation v1 |

## Foundation PRD

`docs/product/foundation-prd.md` sekarang berstatus **ACCEPTED**. Perubahan status ini menyelaraskan dokumen produk dengan keputusan dan delivery yang sudah terjadi; ia **tidak** menyatakan seluruh capability lanjutan otomatis production-accepted.

Foundation v1 yang sudah nyata mencakup identity/SSO Staff, Application Registry/Access, launcher, audit/admin foundation, MFA policy, dan HCIS identity migration. Organization Directory tetap menjadi capability Foundation secara arsitektur, tetapi implementation contract-nya belum accepted.

## Repository baseline

Baseline yang diaudit untuk status ini adalah `main` commit:

`42031c6d1bbe85b79de9d010cf9fa7f7e679f621`

Commit tersebut sudah mencakup:
- PR #82 — pencatatan production verification Account Console PR #81;
- PR #83 — ADR-0007 + HUB-IMPL-018 untuk boundary Organization Directory.

PR lama yang tidak boleh diperlakukan sebagai jalur implementasi aktif:
- PR #43 organization-master proposal — superseded oleh ADR-0007/HUB-IMPL-018;
- PR #12 SQ Account/Portal broader discovery — tetap discovery, bukan Foundation v1 implementation.

## Yang benar-benar perlu ditutup berikutnya

### 1. Runtime acceptance Akun SQ

Repository sudah menyediakan runbook dan checklist pengujian:
- `docs/operations/HUB-IMPL-011-production-handoff.md`;
- `docs/operations/HUB-IMPL-012-production-handoff.md`;
- `docs/operations/akun-sq-production-uat-checklist-2026-09-19.md`.

Penutupan memerlukan tindakan operator pada production karena membutuhkan secret/runtime/browser nyata. Evidence minimum:
- recovery email benar-benar terkirim, action link single-use/expiry sesuai policy;
- Google hanya menautkan existing account setelah local proof, tidak auto-create, mapping tetap sama, tidak menambah privilege;
- trusted-device checked/unchecked, browser lain, expiry, tamper/replay, password/TOTP reset, disabled user, Google path, serta cookie attributes tanpa merekam cookie value.

Tanpa evidence itu, status tetap **runtime acceptance pending** walaupun source dan provider sudah ada.

### 2. HUB-IMPL-013 Staff provisioning/offboarding

PR #42 berisi implementasi proposal lama yang tertinggal dari current main dan masih mempunyai open decisions. Jangan merge proposal lama secara langsung. Jalur yang benar:
1. tutup policy/security decisions;
2. rebase/re-implement secara clean terhadap current main;
3. jalankan CI/security regression;
4. baru siapkan runtime handoff terpisah.

### 3. HUB-IMPL-018 Organization Directory

ADR boundary sudah selesai, tetapi implementation belum boleh dimulai sebelum discovery decisions ditutup: freshness, identifier/mapping, snapshot-vs-delta, ordering/effective-date semantics, retention/replay, reconciliation, service identity, read authorization, stale behavior, dan capacity.

HCIS tetap authoring/system of authority. Hub hanya projection/distribution layer dan bukan central approval engine.

## Bukan pekerjaan aktif sekarang

- memindahkan workforce organization authoring ke Hub;
- menjadikan Keycloak organization master;
- membuat universal domain permission engine;
- membangun SQ Portal/universal Person Registry hanya untuk “melengkapi” backlog;
- menambah aplikasi kedua tanpa owner/consumer readiness dari domain tersebut.

## Definition of closure

SQ Hub/Akun SQ **core** dapat dianggap selesai ketika source-of-truth produk konsisten dengan production evidence. Extension berikutnya ditutup per capability, bukan dengan satu label proyek global yang menyamarkan gap:

- runtime acceptance Akun SQ ditutup dengan evidence operator;
- provisioning/offboarding ditutup setelah spec accepted + clean implementation + runtime acceptance;
- Organization Directory ditutup setelah discovery → accepted implementation → producer/Hub/consumer evidence.
