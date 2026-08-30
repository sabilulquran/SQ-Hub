# HUB-IMPL-007 — SQ Admin Center access foundation

**Status:** ACCEPTED
**Product:** SQ Hub
**Area:** Platform administration
**Delivery:** Go 5A
**Depends on:** `docs/product/admin-center-foundation.md`, Foundation PRD, HUB-IMPL-002, HUB-IMPL-005, staff authentication policy, security baseline

## Outcome

Provide the minimum secure foundation for **Administrasi SQ** inside the existing authenticated SQ Hub without yet implementing Staff provisioning or Application Access management UI.

The implementation must prove four things before broader administration work begins:
1. platform-administrator privilege has an explicit platform-owned source of truth;
2. ordinary Hub authentication alone is insufficient for admin APIs;
3. privilege grant/revoke is auditable and revocation takes effect immediately on the admin surface;
4. the UI exposes Administrasi SQ only when the current server-authorized identity may use it.

## Scope

Go 5A implements:
- persistent `SQ Platform Administrator` membership keyed by exact OIDC `issuer + sub`;
- reviewed CLI/operator commands to inspect, grant, and revoke that membership;
- platform audit events for privilege mutations;
- admin authorization service using the current Hub server-side session;
- protected admin API context/overview endpoint(s);
- `Administrasi SQ` navigation capability in the authenticated workspace response;
- protected `/admin` landing surface in the existing SQ Hub web application;
- desktop and 390x844 responsive behavior following the HCIS-aligned SQ Hub shell;
- automated authorization/regression coverage;
- staging-only UAT.

## Explicit non-scope

Go 5A does not implement:
- Keycloak user search or Admin REST integration;
- Staff provisioning, password reset, account disable, required actions, or MFA configuration;
- Application Registry mutation UI;
- Application Access grant/revoke UI;
- HCIS permission/role administration;
- HCIS `SUPER_ADMIN` migration;
- Organizational Unit administration;
- production deployment.

Those require later specifications.

## Authorization model

### Platform administrator membership

Add a platform-owned table conceptually named `platform_administrators` with minimum fields:
- `id uuid primary key`;
- `identity_issuer text not null`;
- `identity_subject text not null`;
- `status text not null` — `active` or `revoked`;
- `reason text null`;
- `actor_kind text not null` — reuse the existing `human | service | system` vocabulary;
- `actor_ref text not null`;
- `granted_at timestamptz null`;
- `revoked_at timestamptz null`;
- `updated_at timestamptz not null`;
- unique exact `(identity_issuer, identity_subject)` membership.

State constraints mirror the Application Access foundation:
- active membership has `granted_at` and no `revoked_at`;
- revoked membership has `revoked_at`;
- grant/revoke is idempotent from the operator perspective;
- re-grant updates `granted_at` to the new privilege-elevation time.

Do not create a generic universal role engine in this task.

### Exact identity matching

Authorization compares the current Hub session's exact `identity_issuer + identity_subject` against active platform-administrator membership.

Never authorize by:
- display name;
- username;
- NIP;
- email;
- NIK;
- HCIS account ID;
- same `sub` under a different issuer.

### Server-side checks

Every `/api/admin/*` request must:
1. resolve a valid current Hub session using the existing opaque server-side session cookie;
2. resolve exact platform-administrator membership;
3. fail closed when session, membership, or datastore verification fails;
4. reject non-admin requests without returning admin data.

The browser must never be trusted simply because `Administrasi SQ` is visible or because a client-side flag says the user is an admin.

### Session freshness after privilege grant

A Hub session may use the admin surface only when:
- membership is active; and
- the Hub session `created_at` is equal to or later than the membership's latest `granted_at`.

Consequences:
- an identity that is granted Platform Administrator while already logged in cannot immediately inherit the new privilege through that older session;
- the user must establish a new Hub session after the latest grant/re-grant;
- this provides a deliberate privilege-elevation boundary and supports the required fresh privileged login/MFA UAT;
- revocation is still checked on every admin request and therefore immediately denies the admin surface even when the ordinary Hub session remains valid.

A stale pre-grant session receives a stable admin-specific denial such as `ADMIN_REAUTH_REQUIRED`. It must not be silently treated as an authorized admin session.

## MFA requirement

`docs/security/staff-authentication-policy.md` requires MFA for SQ Hub platform administrators.

Go 5A rules:
- before granting platform-administrator membership in staging, the operator must verify the target synthetic identity has TOTP and recovery path configured through the accepted SQ Identity operational process;
- UAT must use a fresh post-grant login and confirm MFA is challenged before Administrasi SQ is accepted;
- SQ Hub does not store TOTP secret, recovery codes, password, or duplicate credential state;
- Go 5A does not invent a custom MFA protocol or replace Keycloak authentication;
- production remains blocked until the privileged enrollment/control path is accepted for production.

A later identity-directory/admin specification may automate more of the enrollment precondition, but it must not weaken this requirement.

## Operator path

Provide a CLI or equivalent reviewed operator interface, separate in behavior from Application Access even if implementation utilities are shared.

Minimum commands:
- inspect exact identity membership;
- grant Platform Administrator;
- revoke Platform Administrator.

Mutation input requires:
- exact issuer;
- exact subject resolved through the accepted operator process;
- actor reference;
- non-empty reason for grant/revoke.

Requirements:
- no direct ad-hoc SQL as the normal path;
- no self-grant from the web UI;
- no secret/credential values accepted or printed;
- idempotent repeated grant/revoke;
- mutation and audit write occur transactionally or otherwise cannot silently diverge.

### Audit events

Reuse `platform_audit_events`.

Suggested stable actions:
- `platform_admin.grant`;
- `platform_admin.revoke`.

Audit target:
- `target_type = platform_administrator`;
- `target_ref` must be an opaque/non-secret representation sufficient for operational correlation without putting tokens or credentials in payloads.

Audit payload may include status transition and reason but must not contain passwords, tokens, OIDC codes, cookies, TOTP material, recovery codes, or client secrets.

## Admin API contract

### Current admin context

Provide an authenticated endpoint conceptually:

```http
GET /api/admin/context
```

Authorized response minimum:

```json
{
  "authorized": true,
  "displayName": "Synthetic Admin",
  "capabilities": {
    "platformAdministration": true
  }
}
```

Do not return `identity_subject` to the browser merely for rendering the admin shell.

Denial behavior:
- no/invalid Hub session -> existing authenticated-session failure behavior (`401`);
- valid Hub session, no active admin membership -> `403` with stable `ADMIN_FORBIDDEN`;
- valid Hub session created before latest grant -> `403` with stable `ADMIN_REAUTH_REQUIRED`;
- verification failure -> fail closed; do not return overview data.

### Read-only overview

The Go 5A landing surface may expose a small read-only overview derived only from existing platform-owned data, for example:
- number of registered applications by current state;
- number of active/revoked Application Access rows;
- recent platform audit-event count or a small redacted recent-action summary.

This is validation/operational context, not a management interface.

Do not expose:
- full identity subjects;
- token/session hashes;
- Hub session inventory;
- secrets;
- unrelated PII;
- HCIS domain data.

## Workspace contract

Extend the authenticated workspace response with a server-computed current-user capability, for example:

```json
{
  "capabilities": {
    "platformAdministration": true
  }
}
```

Rules:
- `true` only when the current session meets the same active-membership + session-freshness rule used by admin APIs;
- false/absent for ordinary users;
- capability is for navigation UX only and does not replace API authorization;
- no technical subject or unauthorized admin metadata is sent to the browser.

## Web experience

### Navigation

The existing reserved `Administrasi SQ` navigation becomes actionable only for a current authorized platform administrator.

For a non-admin:
- do not show an enabled admin navigation entry;
- direct navigation to `/admin` must still fail through server authorization; hiding the link is not the security boundary.

### `/admin` landing surface

Use the existing SQ Hub/HCIS-aligned shell and responsive primitives.

Minimum content:
- title `Administrasi SQ`;
- concise explanation that this area manages cross-application platform concerns;
- read-only Go 5A overview;
- clearly separated future sections such as `Aplikasi`, `Akses Aplikasi`, and `Audit Platform` only when presentation does not imply unfinished mutation controls are already active.

Do not copy HCIS business navigation into Admin Center.

### Reauthentication state

If the API returns `ADMIN_REAUTH_REQUIRED`, show a clear privileged-session message. The experience may instruct the user to sign out and sign in again through SQ Identity; it must not accept a password inside SQ Hub.

## Runtime coupling rules

- Ordinary Hub workspace remains usable when the user is not a Platform Administrator.
- Revoking Platform Administrator does not revoke HCIS Application Access, disable Keycloak identity, or end an otherwise valid ordinary Hub session.
- Granting Platform Administrator does not grant any Application Access or domain role.
- Admin API authorization reads SQ Hub's own platform-administrator state; it must not call HCIS for authorization.
- No per-request Keycloak Admin API dependency is introduced in Go 5A.

## Migration and recovery

Migration must:
- apply cleanly from an empty database after existing migrations;
- be idempotent under the project's migration runner expectations;
- add only platform-admin authorization state, with no production identity seed;
- not modify existing Application Access or Hub session rows.

Recovery/rollback:
- code rollback may leave the additive table/audit rows in place during staging rollback;
- do not destructively drop platform-admin/audit evidence as part of routine rollback;
- if the feature is disabled, no admin route is exposed while ordinary Hub behavior continues.

## Automated tests

Minimum API/domain coverage:
- exact issuer+sub active membership allows admin context;
- same subject under different issuer denied;
- no membership denied;
- revoked membership denied immediately;
- stale pre-grant Hub session -> `ADMIN_REAUTH_REQUIRED`;
- fresh post-grant Hub session allowed;
- re-grant makes an older session stale again;
- grant/revoke idempotence;
- grant/revoke produce platform audit events;
- audit mutation cannot silently disappear;
- admin denial does not leak overview/admin data;
- ordinary workspace still works for non-admin;
- platform-admin grant/revoke does not alter Application Access.

Minimum web coverage:
- authorized workspace exposes Administrasi SQ capability/navigation;
- non-admin workspace does not expose an enabled admin entry;
- `/admin` renders authorized overview;
- forbidden and reauth-required states are handled safely;
- no OIDC token/browser-storage regression;
- desktop and approximately 390x844 remain usable with no horizontal overflow.

## Staging UAT

Use synthetic staging identities only.

Required cases:
1. ordinary Staff fresh login -> Hub works, Administrasi SQ unavailable, direct admin request denied;
2. verify synthetic privileged identity has TOTP/recovery configured before grant;
3. grant Platform Administrator via supported operator path with actor + reason;
4. existing pre-grant Hub session remains unable to enter Admin Center (`ADMIN_REAUTH_REQUIRED`);
5. sign out and establish a fresh Hub login; confirm MFA challenge;
6. fresh privileged session sees `Administrasi SQ` and `/admin` overview;
7. HCIS launcher/domain access remains exactly as separately granted by Application Access;
8. revoke Platform Administrator while privileged Hub session remains active;
9. the next admin request is denied immediately, while ordinary Hub workspace remains usable;
10. grant/revoke audit events are present without secrets;
11. desktop and 390x844 visual checks pass;
12. production untouched.

## Acceptance criteria

- source-of-truth product decision exists in `docs/product/admin-center-foundation.md`;
- migration, repository/service, CLI/operator path, API, and web implementation satisfy this contract;
- CI typecheck/lint/test/build pass;
- no domain permission engine or generic universal role engine introduced;
- no Keycloak role becomes source of truth for Platform Administrator;
- no automatic HCIS `SUPER_ADMIN` mapping introduced;
- no production identity/data/secret committed;
- staging UAT demonstrates non-admin denial, fresh privileged MFA login, authorized admin surface, immediate privilege revocation, and ordinary Hub continuity;
- production remains untouched.
