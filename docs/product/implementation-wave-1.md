# SQ Hub Implementation Wave 1

**Status:** ACCEPTED
**Date:** 2026-08-27

## Outcome
Membuktikan fondasi SQ Hub end-to-end dengan satu aplikasi consumer nyata (HCIS) tanpa sekaligus membangun seluruh launcher, organization integration, atau SPMB.

Wave 1 dianggap berhasil ketika Staff test dapat:
1. login melalui Akun SQ/Keycloak staging;
2. memiliki HCIS Application Access yang dikelola SQ Hub;
3. membuka HCIS staging melalui OIDC;
4. tetap mendapatkan role/permission/scope HCIS yang sama;
5. tidak dapat membuka HCIS bila Application Access dicabut pada sesi login berikutnya.

## Scope
### HUB-IMPL-001 — Keycloak staging foundation
- Keycloak staging yang production-like;
- PostgreSQL staging terpisah;
- SQ Staff realm;
- policy login/password/session/MFA sesuai source of truth;
- SQ-branded theme minimum;
- OIDC clients untuk HCIS staging dan kebutuhan machine/service integration;
- health, backup/restore, secret handling, dan deployment docs.

### HUB-IMPL-002 — Application Registry + Application Access
- SQ Hub API foundation;
- PostgreSQL schema untuk application registry/access/audit;
- `hcis` sebagai application pertama;
- grant/revoke secara auditable tanpa membutuhkan admin UI penuh;
- server-to-server access-check contract;
- no domain permission storage.

### HUB-IMPL-003 — HCIS OIDC consumer
- identity link `issuer + sub` ke existing local `accounts.id`;
- Authorization Code flow melalui Akun SQ;
- Application Access check ketika membuat HCIS session;
- HCIS local roles/permissions/scopes tetap dipakai;
- staging-only migration rehearsal dan tests;
- local password login tetap default production sampai cutover plan disetujui/dieksekusi.

## Explicit non-goals
- production cutover;
- Organization Directory integration; Wave 1 tidak memindahkan authoring organisasi dari HCIS. Keputusan target lama untuk memindahkan master ke Hub kemudian disupersede oleh ADR-0007;
- full SQ Hub launcher/admin UI;
- SPMB implementation;
- shared `@sq/ui` package extraction;
- universal Person Registry;
- event bus;
- Keycloak Authorization Services untuk domain permission;
- password/MFA credential import dari HCIS.

## Dependency order
```text
HUB-IMPL-001 Keycloak staging
        |
        +------> HUB-IMPL-002 Registry/Access
        |                    |
        +--------------------+
                             v
                 HUB-IMPL-003 HCIS OIDC
```

HUB-IMPL-001 dan sebagian HUB-IMPL-002 boleh dikerjakan paralel setelah spec accepted. HCIS integration tidak boleh dianggap selesai sebelum keduanya menyediakan contract yang diuji.

## Delivery strategy
Setiap spec dibuat sebagai PR terpisah atau rangkaian PR kecil. Jangan membuat satu PR "implement SQ Hub Wave 1".

Recommended implementation order:
1. scaffold SQ Hub API + migrations/tests;
2. Keycloak staging infrastructure/config/theme skeleton;
3. Application Registry/Access API + CLI + audit;
4. synthetic Keycloak identities + access grants;
5. HCIS identity-link migration + OIDC adapter in staging mode;
6. end-to-end staging verification;
7. only then prepare production cutover PRs.

## Definition of done for Wave 1
- all three implementation specs meet acceptance criteria;
- actual commands/tests are recorded, not inferred;
- staging uses synthetic/test identities only;
- backup/restore for Keycloak staging tested;
- no production secret/data in repository;
- no direct local-password/OIDC dual-auth exposed in production;
- access/refresh tokens absent from browser storage;
- HCIS domain authorization regression tests remain green;
- failure of SQ Hub after an already-created HCIS application session does not terminate that existing session merely because the Hub is under maintenance;
- new HCIS login fails closed if its required Application Access check cannot be completed.