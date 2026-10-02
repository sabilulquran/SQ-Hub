# HUB-IMPL-013 — Identity Lifecycle pegawai

**Status:** ACCEPTED — implementation contract, 2026-10-02
**Environment amendment:** Product Owner directed controlled production UAT instead of staging UAT on 2026-10-02; production safety gates below still apply.
**Product:** SQ Hub / Administrasi SQ
**Depends on:** Admin Center Foundation, HUB-IMPL-007/009/018, ADR-0003/0005/0007, Staff Authentication Policy, Security Baseline

## Outcome and ownership

An authorized SQ Platform Administrator can provision, offboard, and re-enable an employee's Akun SQ. HCIS remains the employee and organization authority. Keycloak owns credentials, required actions and authentication. Hub owns Application Access, Platform Administrator membership, operation state and platform audit. A unit, position or employment-status change never implicitly changes Hub access or domain permissions. Hub never edits HCIS employee records or domain roles.

## Employee verification contract

Before every new employee identity creation, Hub calls the HCIS-owned authenticated read contract `POST /internal/v1/staff-identity/verify-employee` with exact `employeeNumber` in its JSON body. The contract returns exactly one current employee reference: `employeeId` (`hcis:employee:<uuid>`), `employeeNumber`, `displayName`, `email` (nullable), `status` (`active|inactive|resigned`), and `verifiedAt` (source read time). It returns 404 when absent, 409 for ambiguous records, and fails closed on auth/unavailability. The response is not a permission or offboarding instruction. Hub requires an exact employee-number match and active status for new provisioning; later status changes do not automatically disable identity. Email used for activation must equal the current HCIS contact email and be unique in Keycloak. Keycloak initially stores `emailVerified=false`; the employee proves mailbox control through `VERIFY_EMAIL` before `UPDATE_PASSWORD`. An absent or invalid contact email is corrected in HCIS before provisioning. Hub does not invent or mark contact verification on an administrator's assertion.

The HCIS endpoint is a dedicated machine contract with client credentials, audience `hcis-staff-identity`, scope `staff-identity.verify`, allowlisted service client `sq-hub-staff-lifecycle`, and issuer/signature/expiry checks. It returns only the fields above, `Cache-Control: no-store`, and no NIK, credential or payroll data. Hub uses a distinct service identity and never accesses HCIS tables. Producer and consumer contract tests must pass before enabling provisioning in the target environment. Organization Directory is not substituted for this live verification contract.

## Keycloak authority and account creation

Hub uses a dedicated confidential service client `sq-hub-identity-management`, separate from the read-only identity-directory and HCIS-verification clients. Browser flows and password grants are disabled. It has only Keycloak fine-grained permissions required to query users, create Staff users, view/manage those Staff users and send execute-actions email in the target staff realm. It receives no `realm-admin`, broad `manage-users`, client/realm/role/group management or impersonation role. Provisioning stays disabled until a controlled production permission probe demonstrates accepted operations and denial of forbidden ones; configuration alone is insufficient evidence. Tokens and secrets stay server-side and outside source control.

Create an employee with username equal to HCIS `employeeNumber`, source employee reference recorded for retry/correlation, administrator-entered first and last name and HCIS current contact email, `emailVerified=false`, `enabled=true`, and pending `VERIFY_EMAIL` and `UPDATE_PASSWORD`. Hub never accepts, generates or displays a password. Exact username/email collisions are rejected with no guessed alternative. `issuer + sub` remains the identity key; NIP and email are lookup/profile fields only. Provisioning retries first reconcile by employee reference and exact username so a timeout cannot create another user. An existing unrelated or ambiguous account requires operator resolution, not automatic relinking.

Keycloak `execute-actions-email` sends `VERIFY_EMAIL` and `UPDATE_PASSWORD` with explicit `lifespan=43200` seconds. A send failure leaves both required actions pending, records `EMAIL_PENDING`, and offers an audited retry. Re-send checks the same identity/employee reference and pending actions. No application password or activation token is exposed to the Admin Center.

## Authorization and operation state

Every `/api/admin/staff-lifecycle/*` request requires current Platform Administrator membership, a session established after the latest admin grant, and server-derived actor identity. Mutations require exact trusted Hub Origin, a non-empty reason and explicit confirmation. The current administrator cannot offboard or disable their own identity. No second administrator approval is required.

Offboarding is one durable operation keyed by `issuer + sub` with generated operation id, actor, reason, timestamps, sanitized step outcomes and status `IN_PROGRESS|PARTIAL_FAILURE|COMPLETED`. A repeat request or retry resumes/reconciles that operation; concurrent execution for the same identity is serialized. The required ordered steps are: (1) revoke all active Hub Application Access; (2) revoke active SQ Platform Administrator membership; (3) disable global Keycloak identity. Each step reads back authoritative state before being marked verified. A failure or unverifiable result is recorded per step and leaves the operation `PARTIAL_FAILURE`; `COMPLETED` requires all three verified. Retrying is an explicit Admin action, is idempotent, and records its actor/reason/outcome. No HCIS mutation or domain permission change occurs. Revoked Application Access blocks new domain sessions under its existing timing contract; existing domain sessions are not claimed to be terminated by this workflow.

An Admin may re-enable the global identity with reason, confirmation and audit. Re-enable does not restore Application Access, Platform Administrator membership or domain permissions. HCIS employment status is displayed only as a source fact and is not silently mapped into identity state.

## UI and audit

`/admin/lifecycle` reuses the Administrasi SQ shell and SQ visual baseline. It offers employee verification/provisioning, safe lookup, email re-send, offboarding preview, per-step result/retry, and re-enable. It distinguishes pending email, partial failure and completion. It does not display raw subject, token, secret, password, NIK, or bulk personal data. Platform audit records actor, action, hashed target reference, operation id, reason, timestamp and outcome, without raw personal or credential material. Privileged routes fail closed on authorization, Origin, identity service, HCIS contract or storage errors.

## Recovery and release gates

The operator runbook describes retry after each possible failure, read-back of every step, stale/incomplete operations, deployment rollback, and escalation of unresolved cases to the Head of HCM. The Head of HCM coordinates closure; an authorized Admin executes and audits retries. Never label a partial operation completed to clear an alert.

Controlled production UAT uses synthetic identities only and proves employee found/absent/ambiguous, duplicate/timeout reconciliation, 12-hour action email and re-send failure, each offboarding partial-failure/retry, self-offboarding denial, re-enable without access restoration, audit and forbidden Keycloak actions. Typecheck, lint, tests, build, migration/recovery and secret/PII review must pass. Production activation requires reviewed deployment, isolated synthetic UAT, verified least-privilege service accounts, backup/recovery evidence, and separately recorded operator results. Unmet gates keep the feature disabled.
