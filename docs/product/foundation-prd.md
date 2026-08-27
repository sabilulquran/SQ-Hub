# SQ Hub Foundation PRD

**Status:** DRAFT
**Product:** SQ Hub
**Scope:** Foundation v1

## Problem
Sistem Sabilul Qur'an akan berkembang menjadi beberapa aplikasi domain. Jika setiap aplikasi membangun identity, organization master, app access, dan UI foundation sendiri, staf akan mengalami login berulang, data unit yang tidak konsisten, akses yang sulit dikelola, dan pengalaman pengguna yang berbeda-beda.

## Goal
Menyediakan foundation lintas aplikasi yang cukup untuk menghubungkan HCIS dan aplikasi kedua (SPMB) tanpa menjadikan SQ Hub sebagai ERP monolith.

## Foundation v1 capabilities
### HUB-FND-001 Staff Identity
- Staff memiliki satu identity global SQ Hub.
- Aplikasi domain memperlakukan technical identity identifier sebagai opaque stable identifier; pengguna tidak perlu mengetahui identifier teknis tersebut.
- Untuk Employee, NIP/nomor pegawai menjadi kandidat utama human login identifier agar tidak menciptakan nomor identitas paralel.
- Staff tanpa NIP harus memiliki fallback identifier policy yang diputuskan secara eksplisit; email dapat menjadi kandidat sesuai keputusan identity implementation.
- NIK tidak digunakan sebagai login identifier.
- SQ Identity menggunakan Keycloak sebagai self-hosted Identity Provider engine sesuai ADR-0003.

### HUB-FND-002 Single Sign-On
- Staff yang telah login melalui SQ Identity dapat membuka aplikasi lain yang diizinkan tanpa memasukkan credential kembali.
- Aplikasi domain tidak menerima atau menyimpan password staff.
- Internal applications integrate to SQ Identity through standard OIDC/OAuth2 flows supported by Keycloak.
- Keycloak owns authentication protocol/session concerns; SQ Hub and domain applications retain their authorization ownership boundaries.

### HUB-FND-003 Organizational Unit Master
- Target system of record Organizational Unit adalah SQ Hub.
- Aplikasi domain mereferensikan unit resmi SQ Hub setelah cutover.
- HCIS yang saat ini telah memiliki organizational unit harus dimigrasikan melalui mapping dan cutover plan; jangan mengasumsikan ownership berpindah hanya dengan deploy SQ Hub.
- Master unit paralel tidak boleh dibuat tanpa keputusan arsitektur eksplisit.

### HUB-FND-004 Application Registry
SQ Hub menyimpan registry aplikasi yang bergabung dalam ekosistem, minimum:
- application ID;
- stable application key;
- name;
- canonical URL;
- status.

### HUB-FND-005 Application Access
- SQ Hub menentukan aplikasi apa yang dapat diakses sebuah staff identity.
- Application Access tidak menggantikan role/permission bisnis di aplikasi domain.
- HCIS tetap menentukan permission HCIS; SPMB tetap menentukan permission SPMB.
- Jangan menjadikan Keycloak role/authorization configuration sebagai source of truth alternatif untuk Application Access atau domain permission.

### HUB-FND-006 Hub Launcher
- Staff dapat melihat aplikasi yang diizinkan dari SQ Hub.
- Launcher tidak menampilkan aplikasi yang tidak dapat diakses staff.
- Initial target URL: `hub.sabilulquran.or.id`.

### HUB-FND-007 Shared Design Foundation
- HCIS frontend yang telah sesuai brand menjadi baseline awal SQ Design System sesuai ADR-0004 dan `docs/design/hcis-baseline.md`.
- SQ Hub mengekstrak/menormalisasi design principles, tokens, app-shell conventions, shared components/patterns, dan accessibility baseline dari baseline tersebut.
- SQ Identity/Keycloak login theme harus senada dengan baseline SQ.
- Shared implementation hanya dibuat ketika kebutuhan reuse sudah nyata.

### HUB-FND-008 Audit Foundation
Perubahan sensitif pada identity/application access dan tindakan administrasi penting harus dapat diaudit: actor, action, target, time, dan outcome minimum.

## Integration principle
Aplikasi boleh sangat terintegrasi tetapi ownership data harus jelas. Sebagai default, cross-domain write dilakukan melalui contract/API yang dimiliki domain target, bukan dengan menulis tabel domain lain secara langsung.

Contoh target ownership awal:
- Organizational Unit -> SQ Hub
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
- Keycloak Authorization Services sebagai universal permission engine;
- event bus/message broker sebelum ada kebutuhan;
- single database requirement untuk semua aplikasi;
- production application coding sebelum architecture/security foundation disetujui.

## Experience target
Staff dapat masuk melalui SQ Identity, membuka SQ Hub, melihat aplikasi yang memang dimiliki aksesnya, lalu berpindah antara HCIS dan SPMB tanpa login ulang. SQ Identity dan seluruh aplikasi mengikuti bahasa visual SQ yang diturunkan dari baseline HCIS, sambil tetap memiliki karakter domain masing-masing.

## Open decisions
- exact login identifier policy untuk Employee dan Staff tanpa NIP;
- session/MFA policy;
- application-access administration workflow;
- Organizational Unit migration/cutover plan from HCIS;
- HCIS authentication migration/cutover plan to Keycloak;
- Keycloak production configuration/version pin and operational sizing;
- staging hostname convention;
- exact implementation technology and versioning strategy for shared design packages.

Open decisions harus ditutup melalui domain/security specification atau ADR sebelum implementasi terkait dimulai.
