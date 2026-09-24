# SQ Hub Foundation PRD

**Status:** DRAFT
**Product:** SQ Hub
**Scope:** Foundation v1

## Problem
Sistem Sabilul Qur'an akan berkembang menjadi beberapa aplikasi domain. Jika setiap aplikasi membangun identity, integrasi organisasi sendiri, app access, dan UI foundation sendiri, staf akan mengalami login berulang, data unit yang tidak konsisten, akses yang sulit dikelola, dan pengalaman pengguna yang berbeda-beda.

## Goal
Menyediakan foundation lintas aplikasi yang cukup untuk menghubungkan HCIS dan aplikasi kedua (SPMB) tanpa menjadikan SQ Hub sebagai ERP monolith.

## Foundation v1 capabilities
### HUB-FND-001 Staff Identity
- Staff memiliki satu identity global SQ Hub.
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

### HUB-FND-003 Shared Organization Directory
- HCIS adalah system of authority dan tempat authoring workforce organization: unit organisasi, posisi/jabatan, penempatan pegawai, hubungan atasan, effective dates, dan data ketenagakerjaan terkait.
- SQ Hub menyediakan Organization Directory sebagai read model/distribution layer lintas aplikasi; Hub tidak mengedit fakta organisasi milik HCIS.
- HCIS -> Hub menggunakan authenticated controlled integration contract dengan dedicated service identity.
- Aplikasi domain seperti Finance dan Workspace membaca shared Organization Directory dari Hub sebagai default cross-application read path, bukan direct database coupling ke HCIS.
- Hub dapat melayani last-known-good projection saat HCIS sementara tidak tersedia dengan metadata source/version/synchronized_at atau as_of/staleness.
- Hub bukan central approval engine. Approval policy/workflow/delegation/escalation/domain authorization/audit keputusan tetap di aplikasi domain.
- Domain app yang me-resolve approver dari fakta organisasi menyimpan resolved-approver snapshot beserta organization version/effective time ketika transaksi diajukan.
- Kontrak v1 identifier, full snapshot, reconciliation, dan freshness mengikuti HUB-IMPL-018 **ACCEPTED**. Retention/history serta SLA deployment tetap TBD.

### HUB-FND-004 Application Registry
SQ Hub menyimpan registry aplikasi yang bergabung dalam ekosistem, minimum:
- application ID;
- stable application key;
- name;
- canonical URL;
- status.

### HUB-FND-005 Application Access
- SQ Hub menentukan aplikasi apa yang dapat diakses sebuah Staff identity.
- Application Access tidak menggantikan role/permission bisnis di aplikasi domain.
- HCIS tetap menentukan permission HCIS; SPMB tetap menentukan permission SPMB.
- Jangan menjadikan Keycloak role/authorization configuration sebagai source of truth alternatif untuk Application Access atau domain permission.
- Wave 1 menyediakan operator/CLI path dan server-to-server access check; full admin UI bukan blocker foundation.

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
Perubahan sensitif pada identity/application access dan tindakan administrasi penting harus dapat diaudit: actor, action, target, time, dan outcome minimum.

### HUB-FND-009 Staff MFA
- MFA wajib untuk privileged/platform/application administrators dan identity yang dapat melihat atau mengubah data berisiko tinggi milik orang lain, termasuk payroll organisasi, finance administration, employee-master administration, credential, security, dan access control sesuai `staff-authentication-policy.md`.
- Staff biasa tanpa akses sensitif/privileged belum diwajibkan MFA pada Foundation v1, tetapi boleh enroll secara sukarela.
- Baseline initial factor adalah TOTP + recovery codes; passkey/WebAuthn boleh digunakan setelah UAT.

### HUB-FND-010 HCIS Identity Migration
- HCIS bermigrasi dari application-owned password authentication ke Akun SQ sesuai ADR-0005.
- Existing HCIS `accounts.id` dipertahankan sebagai local authorization principal agar role/permission/scope tidak perlu direwrite.
- HCIS menyimpan mapping `identity_issuer + identity_subject` terhadap local principal.
- Password hash, MFA secret, recovery codes, dan session lama HCIS **tidak** dimigrasikan ke Keycloak.
- Staff membuat credential baru pada Akun SQ.
- HCIS account status adalah domain-local state; suspension/inactive HCIS tidak otomatis men-disable global Akun SQ.
- Production cutover menggunakan controlled switch, bukan dua login publik paralel.
- Credential lama boleh dipertahankan maksimum 14 hari hanya sebagai rollback window, kemudian wajib dihapus setelah cutover diterima.

## Integration principle
Aplikasi boleh sangat terintegrasi tetapi ownership data harus jelas. Sebagai default, cross-domain write dilakukan melalui contract/API yang dimiliki domain target, bukan dengan menulis tabel domain lain secara langsung.

Contoh ownership:
- Workforce organization authoring/system of authority -> HCIS
- Shared Organization Directory projection/distribution -> SQ Hub
- Approval/workflow policy -> masing-masing aplikasi domain
- Employee/leave/attendance/payroll -> HCIS
- Applicant/admission/selection -> SPMB
- Invoice/payment -> Finance (future)
- Work item/project -> Workspace (future)

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
Staff masuk menggunakan NIP atau email yang sesuai policy melalui Akun SQ, membuka SQ Hub, melihat aplikasi yang memang dimiliki aksesnya, lalu berpindah antara HCIS dan SPMB tanpa login ulang. Akun SQ dan seluruh aplikasi mengikuti bahasa visual SQ yang diturunkan dari baseline HCIS, sambil tetap memiliki karakter domain masing-masing.

## Implementation Wave 1
Implementation pertama mengikuti `docs/product/implementation-wave-1.md` dan tiga contract:
- `HUB-IMPL-001` Keycloak staging;
- `HUB-IMPL-002` Application Registry + Application Access;
- `HUB-IMPL-003` HCIS OIDC consumer.

Engineering stack mengikuti ADR-0006 dan staging naming untuk Wave 1 menggunakan `login-staging.`, `hub-staging.`, dan `hcis-staging.sabilulquran.or.id`.

## Open decisions
- Organization Directory SLA deployment dan retention/history (kontrak v1 identifier, full snapshot, reconciliation, target cadence 5 menit/stale 15 menit sudah ditetapkan HUB-IMPL-018);
- Keycloak production version pin setelah staging verification dan operational sizing;
- exact implementation technology and versioning strategy for distributable shared design packages;
- full Application Access administration UI/workflow beyond the Wave 1 operator path.

## Closed decisions references
- IdP: ADR-0003 Keycloak.
- Design baseline: ADR-0004 HCIS visual baseline.
- Staff login/MFA/session policy: `docs/security/staff-authentication-policy.md`.
- HCIS authentication migration: ADR-0005 + `docs/migration/hcis-auth-cutover-plan.md`.
- SQ Hub engineering stack: ADR-0006.
- Wave 1 scope/contracts: `docs/product/implementation-wave-1.md` + `docs/specs/HUB-IMPL-00*.md`.
- Organization ownership/directory boundary: ADR-0007 + `HUB-IMPL-018` (ACCEPTED v1; activation/deployment memerlukan acceptance terpisah).

Open decisions harus ditutup melalui domain/security specification atau ADR sebelum implementasi terkait dimulai.
