# HUB-IMPL-002 — Application Registry and Application Access

**Status:** ACCEPTED
**Product:** SQ Hub
**Area:** Platform access foundation
**Depends on:** Foundation PRD, ADR-0003, ADR-0006, staff authentication policy

## Outcome
Menyediakan source of truth minimal untuk daftar aplikasi SQ Hub dan siapa yang boleh masuk ke aplikasi tersebut, tanpa memindahkan role/permission domain ke platform.

## Scope
Wave 1 implements:
- SQ Hub API scaffold;
- PostgreSQL migrations;
- Application Registry;
- Application Access grant/revoke;
- auditable mutation;
- server-to-server access check for HCIS login;
- CLI or equivalent operator path so admin UI is not required yet.

## Data model
### `applications`
Minimum conceptual fields:
- `id uuid primary key`;
- `application_key text unique not null` — stable machine key, e.g. `hcis`;
- `name text not null`;
- `canonical_url text not null`;
- `status text not null` — `active` or `inactive` for Foundation v1;
- `created_at`, `updated_at`.

`application_key` is immutable after first production use except through explicit migration/ADR-quality change.

### `application_access`
Minimum conceptual fields:
- `id uuid primary key`;
- `identity_issuer text not null`;
- `identity_subject text not null`;
- `application_id uuid not null`;
- `status text not null` — `active` or `revoked`;
- `reason text null`;
- actor identity reference for last grant/revoke when human-triggered;
- `granted_at`;
- `revoked_at` nullable;
- `updated_at`.

A unique constraint prevents multiple simultaneously competing records for the same `(issuer, subject, application)` logical grant. Implementation may use one mutable row or immutable grant history plus current-state projection, but the API must expose one unambiguous current state.

### Audit
Platform audit records for grant/revoke/application mutation contain minimum:
- actor;
- action;
- target identity/app;
- timestamp;
- outcome;
- reason when supplied.

Do not put raw tokens or credentials in audit payloads.

## Identity reference
Application Access stores OIDC `issuer + sub` as the technical identity reference.

Do not use NIP/email as the key. NIP/email may be used by provisioning/operator tooling to locate an identity through Keycloak, but the resolved grant is stored against `issuer + sub`.

No universal Person table is introduced.

## Initial application seed
Wave 1 seeds:
```text
application_key: hcis
name: HCIS
canonical_url: https://hcis.sabilulquran.or.id
status: active
```

Staging configuration may override the effective consumer URL to `https://hcis-staging.sabilulquran.or.id` without changing the stable `application_key`.

## Operator path
Before an admin UI exists, provide reviewed operator commands or CLI workflows for:
- list applications;
- register/update non-key application metadata;
- grant access by explicitly resolved identity;
- revoke access;
- inspect current access;
- show audit trail for a target.

CLI must have dry-run/preview behavior for batch migration where destructive/large changes are possible.

Do not require direct ad-hoc SQL as the normal administration interface.

## Access-check contract
HCIS uses a server-to-server endpoint when creating a new OIDC-derived application session.

Conceptual contract:
```http
POST /internal/v1/application-access/check
Authorization: Bearer <machine token>
Content-Type: application/json

{
  "identity": {
    "issuer": "https://login-staging.sabilulquran.or.id/...",
    "subject": "opaque-sub"
  },
  "applicationKey": "hcis"
}
```

Response:
```json
{
  "allowed": true,
  "applicationKey": "hcis",
  "decision": "active_grant"
}
```

Denied requests return a stable machine-readable reason such as:
- `NO_GRANT`;
- `GRANT_REVOKED`;
- `APPLICATION_INACTIVE`;
- `UNKNOWN_APPLICATION`.

Do not leak unrelated identity/application metadata in denial responses.

## Machine authentication
For Wave 1, prefer Keycloak-issued client-credentials tokens for application-to-SQ-Hub API calls.

Requirements:
- HCIS service identity is separate from human identities;
- token audience/resource validation is explicit;
- caller identity/client is allowlisted for the internal access-check endpoint;
- client secret is runtime secret, not committed;
- machine identity does not receive broad Keycloak admin rights;
- using Keycloak for machine authentication does not move Application Access ownership into Keycloak.

## Runtime dependency rule
Application Access is checked when HCIS creates a **new** authenticated application session.

Wave 1 deliberately does **not** require HCIS to call SQ Hub on every protected request. An existing valid HCIS application session may continue if SQ Hub API is temporarily under maintenance.

Consequences:
- new login/session issuance fails closed when access cannot be verified;
- revocation is guaranteed for new sessions immediately after current-state update;
- existing-session revocation propagation is bounded by the HCIS application-session lifetime unless an explicit local session revocation operation is performed;
- faster cross-app revocation propagation is future work and must not be solved by making every domain request synchronously depend on SQ Hub.

This preserves the goal that maintenance of one application does not unnecessarily take down already-running sessions in another.

## API behavior
- all write endpoints validate input with explicit schemas;
- domain role/permission fields are rejected/not accepted;
- no endpoint grants HCIS permissions such as leave/payroll/employee access;
- inactive applications cannot be newly accessed even if a grant exists;
- grant/revoke is idempotent from the operator perspective;
- concurrent mutations produce deterministic current state;
- audit write is part of the mutation transaction or otherwise cannot silently disappear.

## Tests
Minimum automated coverage:
- application key uniqueness;
- grant + check allow;
- no grant -> deny;
- revoked grant -> deny;
- inactive app -> deny;
- identity lookup uses exact issuer+sub;
- same `sub` from different issuer does not collide;
- unauthorized machine client denied;
- malformed token/audience denied;
- grant/revoke idempotence;
- audit produced for mutations;
- attempted domain-permission payload is not accepted as platform access data.

## Acceptance criteria
- API typecheck/lint/test/build pass;
- migration applies from empty database and has a documented recovery/down strategy;
- `hcis` application exists with stable key;
- synthetic identity can be granted/revoked access via supported operator path;
- HCIS-authorized machine client can check an access decision;
- other/invalid clients cannot call internal access check;
- no role/permission tables for HCIS/SPMB business capabilities are introduced;
- audit behavior verified;
- no production credentials/data committed.

## Non-goals
- full admin UI;
- launcher UI;
- domain permissions;
- Organizational Unit authorization scope;
- continuous per-request dependency from HCIS to SQ Hub;
- event-driven revocation propagation;
- external user/application access model.