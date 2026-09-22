# HUB-IMPL-013 — Go 5C Staff Provisioning and Offboarding

**Status:** DRAFT / PROPOSED  
**Scope:** Administrasi SQ platform lifecycle proposal  
**Base:** SQ Hub Foundation v1 + accepted Go 5A/5B boundaries  
**Not authorized by this document:** merge, staging deployment, production deployment, live Keycloak mutation, HCIS mutation

## 1. Intent

Propose the first platform-owned Staff provisioning and offboarding workflow in Administrasi SQ without turning SQ Hub into a Keycloak Admin Console and without collapsing identity, platform access, or HCIS business state into one permission model.

The accepted ownership boundaries remain authoritative:

- Akun SQ / Keycloak owns authentication and credential lifecycle.
- SQ Hub owns Application Access, Platform Administrator membership, and shared platform administration.
- HCIS owns employee/HR state and HCIS domain authorization.
- Application Access is not domain permission.
- Platform Administrator is not a universal domain superuser.

## 2. Proposed capability

### 2.1 Dedicated identity-management principal

Go 5B `IdentityDirectory` remains bounded to read/query. Go 5C introduces a distinct `IdentityManagement` integration and requires a different confidential service principal.

Runtime inputs proposed for later central integration:

- `KEYCLOAK_IDENTITY_MANAGEMENT_CLIENT_ID`
- `KEYCLOAK_IDENTITY_MANAGEMENT_CLIENT_SECRET`

Both are optional in repository runtime. When absent, Go 5C mutation routes are not registered. Configuration rejects using the same client id as the Go 5B directory client.

The service principal must be limited to the exact Staff-user operations exercised by this proposal: exact username/email collision lookup, create Staff user with complete profile, inspect one Staff user, update `enabled`, and trigger `UPDATE_PASSWORD` execute-actions email. It must not receive realm-admin, client management, role/domain administration, impersonation, or unrelated realm-management capability. The exact fine-grained Keycloak permission composition remains an open implementation decision and must be accepted before deployment.

No management token or secret is returned to the browser or written to platform audit payloads.

### 2.2 Staff provisioning policy

Provisioning input is strict and profile-complete.

For `employee`: `employeeNumber` is required, `username` must equal `employeeNumber`, and first name, last name, verified unique email, enabled state, and reason are required.

For `staff_without_nip`: `employeeNumber` must be absent, verified unique email is required, and username must equal that verified email for Foundation v1.

`NIK` is not a supported field and strict validation rejects unrecognized fields. This proposal intentionally does not call HCIS tables to prove employee number ownership. Whether provisioning must require a future HCIS-owned employee-reference contract before creation is an open decision.

Provisioning does not create an incomplete normal Staff identity. Akun SQ receives first name, last name, email, email-verified state, enabled state, and required action `UPDATE_PASSWORD` in the initial create request.

### 2.3 Credential initialization

Permanent passwords are never accepted, generated, persisted, logged, or displayed by SQ Hub.

Akun SQ owns initialization through Keycloak required actions. Go 5C only requests `UPDATE_PASSWORD`. A failure to dispatch the execute-actions email does not reveal or invent a fallback password: the identity remains created with the required action pending and Administrasi SQ surfaces a safe retry action.

The Admin UI never displays password values/hashes, TOTP seeds, recovery codes, access tokens, or client secrets.

### 2.4 Global identity enable/disable

Enable/disable is protected by current Platform Administrator membership, fresh-session enforcement inherited from `PlatformAdminService.authorize`, trusted same-Origin mutation checks, required reason, explicit `confirm: true`, server-derived actor, audit before/after external identity mutation, and idempotent no-op behavior.

The current administrator cannot disable their own identity through this route. HCIS `employee.status` is never read or inferred and is not automatically mapped to Akun SQ `enabled`.

### 2.5 Platform offboarding

Offboarding coordinates only platform-owned/global-identity actions:

1. revoke every active SQ Hub Application Access grant;
2. revoke active Platform Administrator membership;
3. optionally disable the global Akun SQ identity when explicitly selected;
4. emit audit records and return step-level sanitized results.

The workflow does not update HCIS, infer resignation/termination, or grant/revoke HCIS domain permissions.

Each step is state-idempotent or explicitly no-op on retry. Failure of one step does not silently mark the run successful: the response is `succeeded`, `partial_failure`, or `failed` with safe human-readable step results. Retrying is safe. The current administrator cannot offboard themselves from their active session.

## 3. Proposed API

All routes are under the existing protected Admin Center surface:

- `POST /admin/staff-lifecycle/provision`
- `POST /admin/staff-lifecycle/status`
- `POST /admin/staff-lifecycle/password-initialization`
- `GET /admin/staff-lifecycle/:subject/offboarding-preview`
- `POST /admin/staff-lifecycle/offboard`

The server uses opaque subject identifiers for mutation targets. Browser responses contain only operational profile fields and sanitized step results.

## 4. Admin Center UX

`/admin/lifecycle` extends Administrasi SQ instead of creating a second product. It reuses the existing visual family and authenticated `/admin/*` authorization gate. It provides profile-complete Staff provisioning, Staff lookup via Go 5B directory, explicit enable/disable, password required action, platform offboarding preview, optional global disable, and explicit copy that HCIS employee status is not read/inferred.

The existing shell and Akun SQ theme are not redesigned.

## 5. Audit and privacy

Platform audit uses opaque hashed target references. Sensitive identity-management credentials and tokens are never audit payload fields. Application Access and Platform Administrator mutations continue to use their existing transactional audit mechanisms; identity changes receive Go 5C lifecycle audit events.

## 6. Failure semantics

- authorization/origin/validation failure: no external mutation;
- duplicate username/email: `409`, no fallback username invented;
- identity-management unavailable: fail closed;
- offboarding step failure: surfaced as a failed step and retry-safe;
- required-action email failure after identity creation: surface `required_action_pending`, never create/reveal a temporary password.

## 7. Explicitly out of scope

Keycloak realm/client administration, impersonation, administrator-selected password reset values, TOTP/recovery secret viewing, HCIS employee-state mutation, HCIS role/domain authorization mutation, universal Person Registry, guardian/applicant/public registration/SQ Portal identities, and staging/production deployment.

## 8. Open decisions before acceptance

1. Exact least-privilege Keycloak fine-grained admin policy for the dedicated Go 5C principal.
2. Whether employee provisioning must validate `employeeNumber` through a future HCIS-owned read contract before identity creation.
3. Organizational policy for when global identity disable is mandatory, optional, delayed, or prohibited during employee offboarding.
4. Notification delivery requirements and expiry policy for password-initialization links.
5. Whether re-enable requires additional HR/platform approval beyond current Platform Administrator + reason + fresh session.
6. Whether self-offboarding remains prohibited absolutely or is replaced with a two-person privileged operation.
7. Operational ownership and break-glass procedure for partial offboarding failures.

Until these are accepted, this implementation remains a repository proposal only.

## 9. Security acceptance targets

Automated coverage targets Platform Administrator authorization/fresh-session rejection, trusted Origin/CSRF rejection, strict validation/profile completeness, duplicate username/email handling, NIP/email username policies, distinct management principal configuration, required-action initialization without credential values, no secrets in API responses, enable/disable reason+confirmation, Application Access/Platform Administrator revocation, offboarding idempotence/partial failure, audit invocation, and ordinary Staff denial.

Repository CI must remain green before audit. No live acceptance mutation is performed by this PR.
