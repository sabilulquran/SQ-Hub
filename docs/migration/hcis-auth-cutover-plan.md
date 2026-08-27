# HCIS Authentication -> SQ Identity Cutover Plan

**Status:** DRAFT RUNBOOK
**Decision source:** ADR-0003, ADR-0005, `docs/security/staff-authentication-policy.md`
**Current upstream validation candidate:** Keycloak 26.7.2 (released 2026-08-19). Production version is pinned only after staging verification; never follow `latest` automatically.

## Purpose
Menerjemahkan keputusan arsitektur menjadi urutan implementation/cutover yang dapat diuji dan di-rollback tanpa menjalankan development langsung pada production.

## Phase 0 - Preconditions
Sebelum mengubah HCIS login:
- Keycloak staging berjalan dengan PostgreSQL staging dan SQ-branded theme;
- production dan staging realm/database/config terpisah secara logis;
- SQ Hub minimum Application Registry + Application Access untuk HCIS tersedia;
- HCIS memiliki OIDC client configuration di staging;
- secret/client credential tidak berada di repository;
- backup/restore Keycloak staging sudah diuji minimal sekali.

## Phase 1 - Inventory HCIS principals
Buat migration preview yang **read-only** terhadap data HCIS dan menghasilkan report sintetis/metadata tanpa mengekspor password/MFA secret.

Untuk setiap `accounts` record, resolve:
- local `accounts.id`;
- `principal_type`;
- `status`;
- linked `employee_id` jika ada;
- Employee `employee_number`/NIP jika ada;
- `accounts.email`;
- `employees.email` sebagai comparison/profile source bila ada;
- target username;
- target HCIS Application Access state;
- global identity lifecycle decision jika memang tersedia dari owner yang berwenang;
- warning/error.

### Validation blockers
Jangan lanjutkan account jika:
- Employee account tidak memiliki employee link yang valid;
- employee number/NIP duplikat atau kosong untuk account yang seharusnya Employee;
- email target duplikat pada realm policy yang membutuhkan uniqueness;
- `accounts.email` untuk activation/recovery kosong/tidak valid;
- `accounts.email` dan `employees.email` berbeda secara material dan belum di-resolve;
- satu HCIS account terpetakan ke lebih dari satu Keycloak identity;
- satu Keycloak identity terpetakan ke lebih dari satu HCIS local account tanpa keputusan eksplisit.

Tidak boleh ada auto-guess berdasarkan kemiripan nama.

## Phase 2 - HCIS identity-link schema
Tambahkan mapping identity eksternal ke HCIS local principal.

Conceptual migration:
```sql
ALTER TABLE accounts ADD COLUMN identity_issuer text NULL;
ALTER TABLE accounts ADD COLUMN identity_subject text NULL;

CREATE UNIQUE INDEX ...
  ON accounts(identity_issuer, identity_subject)
  WHERE identity_issuer IS NOT NULL AND identity_subject IS NOT NULL;
```

Nama kolom final ditetapkan di implementation spec HCIS, tetapi semantic contract harus tetap `issuer + sub`.

Jangan mengganti primary key `accounts.id` pada migration ini.

## Phase 3 - Provision identities in Keycloak staging
Provision dengan Admin API menggunakan least-privilege service account.

### Employee
- username = `employee_number`/NIP;
- email = validated `accounts.email`;
- compare `employees.email`; mismatch harus menjadi warning/blocker sampai resolved, bukan dipilih otomatis;
- display/profile name dari employee master bila diperlukan;
- temporary/activation-required credential flow;
- no imported password hash;
- no imported MFA secret;
- capture resulting Keycloak user ID/subject and store mapping to HCIS local `accounts.id`.

### Staff non-Employee
- username = verified unique email;
- map local principal explicitly;
- do not invent Staff number.

### Lifecycle boundary
HCIS lifecycle tidak boleh otomatis mengubah global Keycloak identity lifecycle.

Initial migration behavior:
- HCIS `active` + eligible -> candidate for HCIS Application Access after activation;
- HCIS `suspended` / `inactive` -> deny/revoke HCIS Application Access and local HCIS use, **do not automatically disable Keycloak identity**;
- HCIS `invited` -> activation required or held pending according to the migration batch policy;
- disable global Keycloak identity only when the global Staff identity owner explicitly determines the person should no longer authenticate to any SQ application.

This preserves cases where a person may legitimately lose HCIS access but still need SPMB Admin or another SQ application.

## Phase 4 - OIDC integration in HCIS staging
Implement server-side Authorization Code flow.

Required flow:
1. unauthenticated HCIS request redirects to `/auth/login`;
2. HCIS redirects browser to SQ Identity;
3. Keycloak authenticates user;
4. callback validates issuer/state/nonce/code flow using maintained OIDC library;
5. server exchanges code and validates identity;
6. HCIS resolves local account by `issuer + sub`;
7. HCIS checks HCIS Application Access and local account state;
8. HCIS creates app-scoped HttpOnly session;
9. current HCIS role/permission/scope resolver continues unchanged.

Do not authorize from email/NIP claim alone.

## Phase 5 - Credential activation rehearsal
Test with synthetic/test users representing:
- ordinary Employee;
- unit manager;
- Human Capital administrator;
- Foundation Board/non-Employee Staff;
- HCIS Super Admin;
- HCIS-suspended account whose global identity remains valid for another test application.

Expected:
- user creates new SQ Identity password;
- privileged user enrolls TOTP and receives recovery codes;
- old HCIS password is not accepted by SQ Identity unless user independently chooses the same value and policy permits it;
- SSO works to a second test OIDC client without credential re-entry;
- local HCIS role/scope is unchanged after login;
- HCIS suspension blocks HCIS without automatically breaking the second application's login.

## Phase 6 - Acceptance tests before production
Minimum:
- NIP login succeeds for eligible Employee;
- verified email alternative succeeds when enabled;
- wrong/unknown identity cannot bind itself to an HCIS account;
- `issuer + sub` mapping is unique;
- HCIS suspended/inactive account cannot gain HCIS access;
- HCIS local suspension does not automatically disable unrelated application access;
- privileged account cannot complete login without required MFA;
- ordinary Staff behavior matches MFA policy;
- Application Access denial blocks HCIS even if Keycloak authentication succeeds;
- HCIS role/permission/scope tests remain green;
- logout terminates current app session + SQ Identity session;
- tokens are absent from browser localStorage/sessionStorage;
- cookies have expected `HttpOnly`, `Secure` production behavior and appropriate SameSite/scope;
- Keycloak temporary outage fails closed; HCIS does not silently fall back to local password login;
- staging rollback from OIDC mode to local mode is rehearsed;
- Keycloak backup restore is rehearsed.

## Phase 7 - Production cutover
Execute within explicit maintenance/change window even if no full application downtime is expected.

Order:
1. backup HCIS + Keycloak production data/config;
2. verify Keycloak health and pinned version;
3. run migration preview; require zero unresolved blockers;
4. provision production identities and record `issuer + sub` mappings;
5. create HCIS Application Access grants only for eligible HCIS users;
6. send/perform credential activation according to rollout plan;
7. verify representative accounts;
8. switch HCIS production auth mode from local -> OIDC;
9. disable public/direct local login endpoints;
10. monitor login failures, mapping errors, Keycloak health, Application Access, and HCIS authorization outcomes.

No production dual-login period.

## Phase 8 - 14-day rollback window
For maximum 14 days after cutover:
- old HCIS credential material may remain stored only for emergency rollback;
- direct local login remains disabled externally;
- no new password/MFA changes are written to the old HCIS auth path;
- every day of retention is temporary technical debt with an explicit expiry date.

Rollback requires explicit human approval and a critical incident; never automatic fallback.

## Phase 9 - Irreversible cleanup
After acceptance + rollback window:
- clear/drop `password_hash` and password-change credential semantics no longer needed;
- clear/drop MFA secret ciphertext/IV/tag and `mfa_enabled_at` if no longer domain-relevant;
- delete/retire `auth_recovery_codes`;
- retire local password/TOTP/recovery implementation and related endpoints;
- remove obsolete auth encryption key requirement after verifying no remaining encrypted data depends on it;
- retain only the local principal, OIDC mapping, domain authorization, app session data that is still needed, and policy-compliant audit history;
- update HCIS documentation/source of truth in the same change.

## Operational metrics during rollout
Minimum watch:
- Keycloak health/readiness;
- login success/failure rate;
- MFA enrollment/failure rate for privileged users;
- unmapped `issuer + sub` attempts;
- Application Access denials;
- HCIS authorization failures after successful authentication;
- callback/token exchange errors;
- memory/CPU behavior on the shared VPS.

## Rollback criteria examples
Rollback may be considered if:
- widespread eligible users cannot authenticate because of migration/config defect;
- Keycloak is unstable and cannot be restored promptly;
- OIDC mapping causes incorrect authorization identity resolution;
- a security defect makes continuing the new flow unsafe.

Minor user-support issues, forgotten passwords, or isolated activation problems are not by themselves reasons to revert the platform to local authentication.
