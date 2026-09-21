# SQ Hub Foundation PRD

**Status:** DRAFT — dokumen konsolidasi; status ini tidak mengubah ADR/specification yang sudah ACCEPTED.  
**Product:** SQ Hub / Akun SQ  
**Scope:** Foundation v1  
**Delivery acceptance:** OPEN; lihat [ledger closure](../operations/foundation-v1-closure.md).

## Keputusan scope closure — 21 September 2026

Pemilik produk menginstruksikan penutupan Akun SQ + SQ Hub Foundation sebelum implementasi fase berikutnya. Pekerjaan mencakup core identity/SSO, launcher/Application Access, Administrasi SQ foundation, Account Console, recovery, Google existing-account linking, MFA/trusted device, browser security, deployment/rollback operations, dan dokumentasi acceptance berdasarkan evidence.

Instruksi tersebut tidak otomatis menyetujui seluruh aspirasi PRD konsolidasi ini, tidak mengubah NOT_RUN menjadi PASS, dan tidak mengizinkan merge/deployment tanpa persetujuan eksplisit. Accepted ADR/specification yang dirujuk tetap merupakan kontrak teknis yang berlaku. Persetujuan PRD keseluruhan harus dicatat secara eksplisit, bukan disimpulkan dari keberadaan implementasi.

HUB-FND-003 di bawah mempertahankan **boundary desain**; Organization Directory runtime/HUB-IMPL-018 bukan deliverable closure ini. Identity Lifecycle/HUB-IMPL-013, Application Platform lanjutan, SPMB integration, universal person/SQ Portal, dan external identity adalah fase berikutnya. Jangan memperluas pekerjaan Foundation ke sana.

## Problem

Sistem Sabilul Qur'an akan berkembang menjadi beberapa aplikasi domain. Jika setiap aplikasi membangun identity, integrasi organisasi sendiri, app access, dan UI foundation sendiri, staf akan mengalami login berulang, data unit yang tidak konsisten, akses yang sulit dikelola, dan pengalaman pengguna yang berbeda-beda.

## Goal

Menyediakan foundation lintas aplikasi yang cukup untuk menghubungkan HCIS dan, pada fase berikutnya, aplikasi kedua seperti SPMB tanpa menjadikan SQ Hub sebagai ERP monolith. Closure aktif membuktikan Akun SQ, SQ Hub, dan integrasi HCIS yang sudah memiliki contract; tidak mengimplementasikan SPMB atau directory runtime.

## Foundation v1 capabilities

### HUB-FND-001 Staff Identity

- Staff memiliki satu identity global Akun SQ.
- Aplikasi domain memperlakukan OIDC `issuer + sub` sebagai opaque stable identity key; pengguna tidak perlu mengetahui identifier teknis tersebut.
- Untuk Employee, NIP/`employee_number` menjadi username utama agar tidak menciptakan nomor identitas paralel.
- Email unik yang diverifikasi boleh menjadi alternatif login Employee.
- Staff tanpa NIP menggunakan email unik yang diverifikasi sebagai username pada Foundation v1.
- NIK tidak digunakan sebagai login identifier.
- Akun SQ menggunakan Keycloak sebagai self-hosted Identity Provider engine sesuai ADR-0003.
- Detail policy terdapat di `docs/security/staff-authentication-policy.md`.

### HUB-FND-002 Single Sign-On

- Staff yang telah login melalui Akun SQ dapat membuka aplikasi lain yang diizinkan tanpa memasukkan credential kembali.
- Aplikasi domain tidak menerima atau menyimpan password Staff setelah migration cutover.
- Internal applications integrate to Akun SQ through standard OIDC Authorization Code flows supported by Keycloak.
- Keycloak owns authentication protocol/session concerns; SQ Hub and domain applications retain their authorization ownership boundaries.
- Aplikasi yang memiliki backend menangani token/code exchange server-side dan tidak menyimpan access/refresh token di browser storage.
- Session baseline Foundation v1: SSO idle 8 jam, SSO max 12 jam, Remember Me nonaktif, access token baseline 5 menit.

### HUB-FND-003 Shared Organization Directory — boundary accepted, runtime discovery

- HCIS adalah system of authority dan tempat authoring workforce organization: unit organisasi, posisi/jabatan, penempatan pegawai, hubungan atasan, effective dates, dan data ketenagakerjaan terkait.
- SQ Hub menyediakan Organization Directory sebagai read model/distribution layer lintas aplikasi; Hub tidak mengedit fakta organisasi milik HCIS.
- HCIS -> Hub menggunakan authenticated controlled integration contract dengan dedicated service identity.
- Aplikasi domain seperti Finance dan Workspace membaca shared Organization Directory dari Hub sebagai default cross-application read path, bukan direct database coupling ke HCIS.
- Hub dapat melayani last-known-good projection saat HCIS sementara tidak tersedia dengan metadata source/version/synchronized_at atau as_of/staleness.
- Hub bukan central approval engine. Approval policy/workflow/delegation/escalation/domain authorization/audit keputusan tetap di aplikasi domain.
- Domain app yang me-resolve approver dari fakta organisasi menyimpan resolved-approver snapshot beserta organization version/effective time ketika transaksi diajukan.
- SLA, global identifier, snapshot/delta, conflict handling, dan retention tetap DISCOVERY/TBD di HUB-IMPL-018. Daftar ini bukan pernyataan runtime sudah diimplementasikan dan bukan instruksi implementasi dalam closure Foundation.

### HUB-FND-004 Application Registry

SQ Hub menyimpan registry aplikasi yang bergabung dalam ekosistem, minimum application ID, stable application key, name, canonical URL, dan status.

### HUB-FND-005 Application Access

- SQ Hub menentukan aplikasi apa yang dapat diakses sebuah Staff identity.
- Application Access tidak menggantikan role/permission bisnis di aplikasi domain.
- HCIS tetap menentukan permission HCIS; SPMB tetap menentukan permission SPMB.
- Jangan menjadikan Keycloak role/authorization configuration sebagai source of truth alternatif untuk Application Access atau domain permission.
- Wave 1 menyediakan operator/CLI path dan server-to-server access check; full admin UI bukan blocker Wave 1 historis. Administrasi SQ foundation berikutnya mengikuti HUB-IMPL-007/009/016, bukan universal domain administration.

### HUB-FND-006 Hub Launcher

- Staff dapat melihat aplikasi yang diizinkan dari SQ Hub.
- Launcher tidak menampilkan aplikasi yang tidak dapat diakses Staff.
- Initial target URL: `hub.sabilulquran.or.id`.

### HUB-FND-007 Shared Design Foundation

- HCIS frontend yang telah sesuai brand menjadi baseline awal SQ Design System sesuai ADR-0004 dan `docs/design/hcis-baseline.md`.
- SQ Hub mengekstrak/menormalisasi design principles, tokens, app-shell conventions, shared components/patterns, dan accessibility baseline dari baseline tersebut.
- Akun SQ/Keycloak login theme harus senada dengan baseline SQ.
- Shared implementation hanya dibuat ketika kebutuhan reuse sudah nyata.

### HUB-FND-008 Audit Foundation

Perubahan sensitif pada identity/application access dan tindakan administrasi penting harus dapat diaudit: actor, action, target, time, dan outcome minimum. Audit tidak menyimpan password, token, OTP, atau data pribadi yang tidak diperlukan.

### HUB-FND-009 Staff MFA

- MFA wajib untuk privileged/platform/application administrators dan identity yang dapat melihat atau mengubah data berisiko tinggi milik orang lain, termasuk payroll organisasi, finance administration, employee-master administration, credential, security, dan access control sesuai `staff-authentication-policy.md`.
- Staff biasa tanpa akses sensitif/privileged belum diwajibkan MFA pada Foundation v1, tetapi boleh enroll secara sukarela.
- Baseline initial factor adalah TOTP + recovery codes; passkey/WebAuthn boleh digunakan setelah UAT.
- Recovery/Google mengikuti HUB-IMPL-011 dan trusted device mengikuti HUB-IMPL-012; keberadaan source/provider bukan bukti browser acceptance.

### HUB-FND-010 HCIS Identity Migration

- HCIS bermigrasi dari application-owned password authentication ke Akun SQ sesuai ADR-0005.
- Existing HCIS `accounts.id` dipertahankan sebagai local authorization principal agar role/permission/scope tidak perlu direwrite.
- HCIS menyimpan mapping `identity_issuer + identity_subject` terhadap local principal.
- Password hash, MFA secret, recovery codes, dan session lama HCIS tidak dimigrasikan ke Keycloak.
- Staff membuat credential baru pada Akun SQ.
- HCIS account status adalah domain-local state; suspension/inactive HCIS tidak otomatis men-disable global Akun SQ.
- Production cutover menggunakan controlled switch, bukan dua login publik paralel.
- Credential lama boleh dipertahankan maksimum 14 hari hanya sebagai rollback window, kemudian wajib dihapus setelah cutover diterima. Penutupan ini tidak mengotorisasi destructive cleanup atau cutover ulang.

## Delivery snapshot — 21 September 2026

| Capability | Repository / runtime | Acceptance |
| --- | --- | --- |
| Akun SQ, SQ Hub, HCIS launch/Application Access, Administrasi SQ surface | Implemented; operator-observed production | Core evidence 18 September; detail invariant/persona coverage tetap dirujuk ke ledger |
| Account Console desktop/mobile | PR #81 deployed; production browser evidence | Accepted untuk koreksi/rendering yang diuji, bukan seluruh fitur keamanan akun |
| Recovery | Implemented; email/reset/single-use/expiry production evidence 17 September | Bukti lama dipertahankan; fresh new-password login/old-password rejection dan disabled-user coverage ditutup melalui UAT delta |
| Google existing-account linking | Implemented/configured menurut evidence runtime sebelumnya | Matrix 4.1–4.5 NOT_RUN |
| Trusted-device/TOTP/MFA | Implemented; 5.1–5.5 production PASS | Sisa 5.6–5.12, privileged/recovery code, dan browser checks belum lengkap |
| GitHub production deployment | Run 35581490721 SUCCESS; semua komponen NO-OP | Jalur NO-OP terbukti; bukan recreate/rollback rehearsal |
| Identity Lifecycle / Organization Directory runtime / SQ Portal | PROPOSED / DISCOVERY | Bukan implementasi closure Foundation |

Snapshot ini tidak menggantikan [ledger evidence](../operations/foundation-v1-closure.md), [status terkini](../operations/project-status-2026-09-21.md), atau approval pemilik produk.

## Integration principle

Aplikasi boleh sangat terintegrasi tetapi ownership data harus jelas. Sebagai default, cross-domain write dilakukan melalui contract/API yang dimiliki domain target, bukan dengan menulis tabel domain lain secara langsung.

Workforce organization authoring adalah milik HCIS; shared directory projection/distribution milik Hub; approval/workflow milik masing-masing domain. Employee/leave/attendance/payroll adalah HCIS, applicant/admission/selection adalah SPMB, invoice/payment adalah Finance (future), dan work item/project adalah Workspace (future).

## Non-goals v1

- universal Person Registry;
- central authentication untuk applicant, guardian, student, vendor, atau external user lain; kebutuhan external identity diputuskan oleh domain terkait dan ADR terpisah bila kelak perlu disatukan;
- Finance, Workspace, Academic, Asset business logic;
- universal domain permission engine;
- custom OAuth/OIDC protocol implementation;
- custom Keycloak password-hash compatibility plugin untuk mempertahankan password HCIS;
- Keycloak Authorization Services sebagai universal permission engine;
- event bus/message broker sebelum ada kebutuhan;
- single database requirement untuk semua aplikasi;
- production application coding sebelum architecture/security foundation disetujui.

## Experience target

Staff masuk menggunakan NIP atau email yang sesuai policy melalui Akun SQ, membuka SQ Hub, dan melihat aplikasi yang memang dimiliki aksesnya. Integrasi HCIS sudah menjadi bagian closure aktif. Berpindah ke aplikasi domain berikutnya seperti SPMB tanpa login ulang adalah arah lanjutan, bukan klaim SPMB sudah production. Akun SQ dan seluruh aplikasi mengikuti bahasa visual SQ yang diturunkan dari baseline HCIS, sambil tetap memiliki karakter domain masing-masing.

## Implementation Wave 1

Implementation pertama mengikuti `docs/product/implementation-wave-1.md` dan HUB-IMPL-001 Keycloak staging, HUB-IMPL-002 Application Registry/Access, serta HUB-IMPL-003 HCIS OIDC. Engineering stack mengikuti ADR-0006.

Issuer staging adalah `https://login.sabilulquran.or.id/realms/sq-staff-staging`; application hosts adalah `hub-staging.sabilulquran.or.id` dan `hcis-staging.sabilulquran.or.id`. Jangan memakai hostname `login-staging` yang sudah tidak menjadi source of truth.

## Open decisions dan batas implementasi

Organization Directory SLA/freshness, global identifier/mapping, snapshot/delta, conflict handling, dan retention tetap HUB-IMPL-018 DISCOVERY. Distributable shared design packages menunggu kebutuhan reuse nyata. Staff provisioning/offboarding tetap HUB-IMPL-013 PROPOSED. Basic Application Access administration sudah memiliki contract; advanced lifecycle bukan backlog yang boleh diimplementasikan sekarang.

Production Keycloak bukan target unpinned: evidence deployed merujuk immutable component image. Upgrade/version change berikutnya memerlukan review tersendiri; jangan mengubah image demi mengisi keputusan historis. Approval PRD konsolidasi dan final Foundation acceptance dicatat terpisah dari approval specification.

## Closed decisions references

- IdP: ADR-0003 Keycloak.
- Design baseline: ADR-0004 HCIS visual baseline.
- Staff login/MFA/session policy: `docs/security/staff-authentication-policy.md`.
- HCIS authentication migration: ADR-0005 + `docs/migration/hcis-auth-cutover-plan.md`.
- SQ Hub engineering stack: ADR-0006.
- Wave 1 scope/contracts: `docs/product/implementation-wave-1.md` + `docs/specs/HUB-IMPL-00*.md`.
- Organization ownership/directory boundary: ADR-0007 + HUB-IMPL-018 (DISCOVERY).

Open decisions harus ditutup melalui domain/security specification atau ADR sebelum implementasi terkait dimulai.
