# HUB-IMPL-007 — Platform Admin authorization foundation

**Status:** ACCEPTED
**Product:** SQ Hub
**Area:** SQ Admin Center / platform administration
**Environment:** development + staging only
**Production gate:** BLOCKED until privileged MFA/step-up acceptance is implemented and reviewed
**Depends on:** `docs/product/sq-admin-center-v1.md`, `HUB-IMPL-002`, `HUB-IMPL-005`, Staff Authentication Policy, ADR-0006, HCIS/SQ visual baseline

## Outcome

Establish the first enforceable SQ Admin Center boundary without exposing sensitive mutation workflows yet.

This slice provides:

- a SQ Hub-owned `SQ Platform Administrator` authorization assignment;
- audited supported operator grant/revoke/show commands;
- server-side authorization for every Admin Center API request;
- a protected `/admin` surface in the existing SQ Hub web app;
- a read-only Application Registry view sufficient to prove the boundary end-to-end.

It deliberately does not add Application Access mutation UI, Keycloak user administration, provisioning/offboarding, Organizational Unit administration, or domain permissions.

## Authorization source of truth

Platform authorization belongs to SQ Hub.

Introduce a dedicated platform role assignment model with one v1 role:

```text
platform_admin
```

The stored principal key is the exact OIDC pair:

```text
identity_issuer + identity_subject
```

Do not authorize by email, NIP, username, HCIS account id, job title, organizational unit, HCIS `SUPER_ADMIN`, Application Access grant, or Keycloak realm/client role.

Keycloak remains the authentication engine. `platform_admin` is an SQ Hub authorization concept and must not become a second copy of domain permissions.

## Data model

Add a migration for `platform_role_assignments` with minimum conceptual fields:

- `id uuid primary key`;
- `identity_issuer text not null`;
- `identity_subject text not null`;
- `role_key text not null` — only `platform_admin` in this contract;
- `status text not null` — `active` or `revoked`;
- `reason text null`;
- `actor_kind text not null` — consistent with existing platform audit actor kinds;
- `actor_ref text not null`;
- `granted_at timestamptz null`;
- `revoked_at timestamptz null`;
- `updated_at timestamptz not null`;
- unique logical assignment for `(issuer, subject, role_key)`.

The mutation and its `platform_audit_events` record must succeed atomically or fail together.

Do not create a universal users/person table.

## Operator bootstrap path

Provide a supported CLI/equivalent operator path, not ad-hoc SQL, for:

- show current platform role state for an exact resolved identity;
- grant `platform_admin`;
- revoke `platform_admin`;
- inspect relevant audit history.

Mutation requires explicit actor reference and reason.

Grant/revoke must be idempotent from the operator perspective and must emit `succeeded` or `noop` audit outcomes as appropriate.

The CLI must never print credential material, raw OIDC tokens, cookies, password values, MFA seeds/recovery codes, or Keycloak administrative credentials.

## Admin authorization behavior

### Session

Authentication continues to use the accepted `HUB-IMPL-005` Hub server-side session. No second Admin Center login system is introduced.

### Request authorization

Every `/api/admin/*` request performs server-side authorization using the current Hub session's exact `issuer + sub` against active `platform_admin` state.

This check is performed on every Admin Center API request. Platform-role revocation therefore takes effect without waiting for the ordinary Hub session to expire.

Expected outcomes:

- no valid Hub session -> `401`;
- valid Hub session without active platform role -> `403` with generic response;
- active exact platform role -> authorized request may proceed.

The 403 response must not reveal other identities, role-assignment metadata, audit rows, or hidden application data.

Browser navigation visibility is convenience only; it is not an authorization control.

## Admin API scope in HUB-IMPL-007

Expose only the minimum read-only endpoints needed by the shell, conceptually:

### `GET /api/admin/context`

Returns only current-admin-safe context such as:

```json
{
  "authorized": true,
  "capabilities": {
    "applicationRegistryRead": true,
    "applicationAccessWrite": false,
    "identityAdmin": false
  }
}
```

Do not return the raw OIDC subject to the browser unless a later contract demonstrates a concrete need.

### `GET /api/admin/applications`

Returns the environment-local Application Registry fields already owned by SQ Hub:

- application key;
- name;
- canonical URL;
- active/inactive status.

This endpoint is read-only in HUB-IMPL-007.

No user directory, Application Access target list, access grant/revoke, audit payload browser, identity enable/disable, password reset, or domain administration API is added by this contract.

## Web UX

Activate the existing reserved `Administrasi SQ` affordance as a protected route/surface inside SQ Hub.

Required behavior:

- authorized Platform Administrator can open `/admin`;
- ordinary authenticated staff do not see actionable Admin Center navigation;
- direct `/admin` navigation by ordinary staff results in a generic forbidden state and no privileged data fetch succeeds;
- read-only Admin Center shows a clear `Administrasi SQ` heading and Application Registry list/status;
- mutation controls for Application Access, users, or applications are not shown as functional controls in this slice;
- shell remains visually consistent with the accepted SQ Hub/HCIS baseline on desktop and approximately 390x844 mobile;
- ordinary Hub launcher behavior is unchanged.

Do not add a separate Admin Center origin, auth cookie, or client-side token store.

## Privileged MFA gate

Staff Authentication Policy already requires MFA for SQ Platform Administrator.

HUB-IMPL-007 is intentionally staging-only and does not claim to solve the final privileged MFA/step-up mechanism. Therefore:

- no production Admin Center deployment/cutover is authorized by this contract;
- no sensitive mutation UI is introduced;
- staging role grants use synthetic identities only;
- the next privileged-administration contract must define and verify acceptable MFA/step-up evidence before production-capable administration is accepted.

Do not weaken the global authentication policy to make this slice easier to ship.

## Audit

At minimum record role grant/revoke attempts with:

- actor;
- action;
- target identity reference in the server-side audit record;
- role key;
- outcome;
- reason;
- timestamp.

Do not expose audit payloads to the browser in this slice.

## Tests

Minimum automated coverage:

- migration applies from empty database and is idempotent;
- exact issuer+sub role grant is recognized;
- same `sub` under another issuer is not recognized;
- ordinary valid Hub session -> admin API `403`;
- no Hub session -> `401`;
- active platform admin -> admin context/application read `200`;
- revoked platform admin with an otherwise valid existing Hub session -> next admin API request `403`;
- grant/revoke idempotence;
- audit event created for grant/revoke/noop;
- platform role is not inferred from HCIS Application Access;
- platform role is not inferred from application/domain data;
- admin endpoints expose no mutation method in this slice;
- browser source still contains no OIDC access/refresh/id token storage;
- responsive shell regression at desktop and ~390x844.

## Staging UAT

Use synthetic staff identities only.

Minimum matrix:

1. ordinary synthetic staff can use normal Hub but cannot see/open Admin Center data;
2. grant `platform_admin` through the supported operator path;
3. existing/fresh authenticated Hub identity can access the read-only Admin Center according to implementation session-refresh rules;
4. Application Registry displayed is staging-local and does not point to production;
5. revoke `platform_admin` while Hub session remains valid;
6. next Admin Center API request fails `403` while ordinary Hub session remains usable;
7. HCIS launcher and HCIS domain authorization remain unchanged;
8. production untouched;
9. restore/cleanup synthetic role state.

Do not perform Keycloak role mutation or HCIS domain-role mutation for this UAT.

## Acceptance criteria

- source-of-truth role assignment is stored in SQ Hub by exact issuer+sub;
- grant/revoke uses supported audited operator tooling;
- all Admin Center APIs enforce server-side authorization;
- revoked role is denied on the next admin API request without requiring global logout;
- read-only Application Registry works for authorized admin only;
- ordinary Hub behavior and HCIS behavior remain unchanged;
- no Application Access/domain permission mutation UI is introduced;
- no Keycloak role is used as the SQ Hub platform authorization source;
- typecheck/lint/test/build and visual smoke pass;
- staging UAT passes;
- no production deployment/cutover occurs.

## Recovery / rollback

Rollback consists of:

1. revoke any synthetic staging `platform_admin` assignment through supported tooling;
2. revert the feature deployment/code if required;
3. leave existing Hub identity sessions, Application Registry/Application Access, HCIS authorization, and Keycloak identity data intact.

The migration is additive. Do not drop role/audit data as part of routine rollback.

## Explicit non-goals

- production Admin Center authorization;
- final privileged MFA/step-up implementation;
- full user directory;
- creating/disabling Keycloak users;
- password/MFA/recovery administration;
- Application Access grant/revoke UI;
- Application Registry mutation UI;
- platform audit browser;
- Organizational Unit master/cutover;
- HCIS `SUPER_ADMIN` migration;
- domain role/permission administration;
- universal Person Registry;
- SQ Portal/external account administration.
