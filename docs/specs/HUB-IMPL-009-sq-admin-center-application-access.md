# HUB-IMPL-009 — SQ Admin Center Application Registry and Access administration

**Status:** ACCEPTED  
**Product:** SQ Hub  
**Area:** SQ Admin Center / platform access administration  
**Delivery:** Go 5B, staging first  
**Depends on:** `docs/product/admin-center-foundation.md`, `HUB-IMPL-002`, `HUB-IMPL-007`, ADR-0003, ADR-0006, `docs/security/staff-authentication-policy.md`

## Outcome

Extend the accepted SQ Admin Center from the Go 5A read-only boundary into the first supported web administration surface for SQ Hub-owned Application Registry and Application Access, while preserving the separation between authentication, platform entry access, and domain authorization.

Go 5B reuses the existing `applications`, `application_access`, and `platform_audit_events` source of truth. It must not introduce parallel application/access tables or move domain roles into SQ Hub or Keycloak.

## Authorized users and authorization boundary

Every `/api/admin/*` Go 5B endpoint remains protected by the existing SQ Hub Platform Administrator authorization from HUB-IMPL-007. Browser navigation visibility is not an authorization control.

Platform Administrator still does not imply HCIS, Finance, SPMB, Recruitment, Academic, payroll, employee-master, or other domain permissions.

Browser-triggered mutations derive the audit actor from the authenticated Hub session on the server. The browser must not be allowed to forge the actor identity. Because Hub sessions use cookies and sibling subdomains are same-site, privileged browser mutations must also require the exact trusted SQ Hub `Origin`; missing or sibling-site origins fail closed.

## Staff identity lookup

Provide a human-friendly Staff lookup inside Administrasi SQ so an administrator can search by Staff login-facing identifiers such as NIP/username, verified email, or display name and then administer Application Access for the resolved identity.

Requirements:
- lookup is server-side only; the browser never receives a Keycloak admin token or client secret;
- integration uses a dedicated least-privilege Keycloak service account limited to user query/view operations in the exact `sq-staff-staging` realm;
- persisted authorization remains keyed by exact OIDC `issuer + sub`;
- search results may expose safe human-facing profile fields needed for disambiguation, but the UI must not display raw OIDC subjects;
- the API may return the opaque subject only as an internal mutation handle to the protected browser session;
- credentials, password hashes, TOTP seeds, recovery codes, credential values, tokens, or admin secrets must never be returned or logged;
- lookup is bounded and requires a non-empty query; it is not a bulk identity export.

Safe readiness metadata is derived only from fields available under the least-privilege user representation. `totpConfigured` may be true/false/unknown. A pending recovery-code required action may safely prove `recoveryCodesConfigured=false`; otherwise recovery enrollment is reported as unknown rather than escalating the directory client to credential-read/user-management authority.

## Least-privilege identity-directory integration

Create a dedicated staging client/service identity for SQ Hub directory reads. It must:
- use client credentials server-to-server only;
- have no standard browser flow and no direct-access password grant;
- receive only the minimum direct realm-management roles required for bounded user query/view (`query-users` and `view-users` in the accepted staging implementation);
- not receive `manage-users`, impersonation, client-management, realm-management, or broad administrator authority;
- not call arbitrary-user credential-list endpoints when those require broader privileges;
- keep its client secret only in runtime secret/environment configuration;
- communicate through an explicitly controlled internal staging network/endpoint rather than exposing browser access to the Keycloak Admin API.

Because the staging realm is persistent and import does not update an existing realm, repository-controlled reconciliation must converge this client/role state idempotently.

## Application Registry administration

Administrasi SQ provides UI/API to:
- list applications;
- register a new application with a stable `application_key`, human name, environment-local canonical URL, and `active|inactive` status;
- update name, canonical URL, and status for an existing application.

After creation, the application key is treated as immutable by normal Go 5B UI/API operations. Renaming a key requires an explicit migration-quality change, consistent with HUB-IMPL-002.

All mutations use `ApplicationAccessService` / its existing repository source of truth and produce the existing platform audit records. No direct ad-hoc SQL is an administration path.

## Application Access administration

For a selected Staff identity, Administrasi SQ provides current access status for registered applications and allows:
- grant Application Access;
- revoke Application Access;
- supply an operator reason for the mutation.

The admin HTTP boundary requires a non-empty reason for grant/revoke so browser-triggered privileged changes leave useful audit evidence. Existing operator/CLI contracts may remain backward compatible.

Granting Application Access grants application entry only. It does not grant a domain role or permission. Revocation semantics remain those defined by HUB-IMPL-002: new application sessions fail after revocation; existing domain-app session propagation follows the existing bounded session contract unless a separate domain/session action exists.

## Platform audit inspection

Provide a protected, searchable audit view over existing `platform_audit_events` for platform administration events.

Requirements:
- allow bounded search/filter of recent events by safe fields such as action, target type, actor reference, outcome, application key, and reason;
- do not expose raw access tokens, credentials, client secrets, password/MFA material, or unnecessary profile data;
- do not display raw OIDC subjects in the UI;
- preserve the existing audit records/source of truth rather than copying them into a new table.

Foundation-scale implementation may bound the query to the most recent records and filter server-side without introducing a search service or event pipeline.

## Privileged identity / MFA precondition checks

Where practical under least privilege, Go 5B surfaces automated safe readiness signals from the identity-directory integration. It must distinguish **unknown** from **not configured** instead of requesting broad Keycloak user-management privileges merely to inspect credential types.

Go 5B does not create or reset credentials and does not change Keycloak authentication policy. Platform Administrator bootstrap/revoke remains the reviewed Go 5A operator path unless a later accepted specification explicitly adds web self-service for that privilege.

## API behavior

All Go 5B admin endpoints:
- require a valid Hub session and current Platform Administrator authorization;
- return `401` for missing/invalid Hub session;
- retain HUB-IMPL-007 `403 ADMIN_FORBIDDEN` / `ADMIN_REAUTH_REQUIRED` behavior;
- use explicit input validation and bounded query/result sizes;
- fail closed when authorization or required identity-directory verification is unavailable;
- derive mutation actor server-side;
- require the exact trusted Hub `Origin` for browser `PUT`/`POST` mutations and reject missing/sibling origins;
- reject domain-role/permission fields and unrelated Keycloak administration fields.

Protected contracts:
- `GET /admin/staff?q=...`
- `GET /admin/staff/:subject/access`
- `PUT /admin/applications/:applicationKey`
- `POST /admin/application-access/grant`
- `POST /admin/application-access/revoke`
- `GET /admin/audit?q=...&limit=...`

## UI

Extend `/admin` with three clear platform-owned areas:
- **Aplikasi** — Application Registry management;
- **Akses Aplikasi** — Staff lookup plus grant/revoke status/actions;
- **Audit Platform** — searchable recent platform audit.

Follow the accepted SQ/HCIS design baseline and reuse the existing Admin Center shell. Destructive/revocation actions require a clear confirmation state and reason. UI must not imply that Application Access is a domain permission. Unknown MFA readiness must not be rendered as a positive enrollment claim.

## Tests and verification

Minimum automated coverage:
- every new admin route enforces current Platform Administrator authorization;
- stale pre-grant session still fails with `ADMIN_REAUTH_REQUIRED`;
- staff lookup requires a non-empty bounded query;
- directory client credentials never reach API responses/log fixtures;
- identity lookup preserves exact issuer+subject and same subject from another issuer does not collide;
- directory service account remains limited to direct `query-users` + `view-users`, and CI proves required user lookup/detail endpoints with those roles;
- registry create/update uses existing source of truth and cannot change an existing key;
- grant/revoke uses existing source of truth, is deterministic/idempotent, and writes audit;
- browser mutation actor is derived server-side and cannot be supplied by request payload;
- grant/revoke reason is required at the admin HTTP boundary;
- privileged browser mutations reject missing or non-Hub `Origin`;
- domain-role/permission payloads are rejected;
- audit API/UI sanitizes raw OIDC subjects and secret/credential material;
- TOTP/recovery readiness is represented without escalating to credential-read authority and preserves unknown state;
- desktop/mobile Admin Center smoke remains usable.

## Staging deployment and recovery

Go 5B is staging-first. Deployment must:
- create/verify any dedicated internal identity-directory network without attaching unrelated production services;
- reconcile the least-privilege Keycloak directory client idempotently;
- inject its secret through runtime configuration without printing or committing it;
- deploy immutable Hub API/web images;
- preserve existing SQ Hub/PostgreSQL data and Go 5A authorization/audit history;
- provide a rollback path that restores previous Hub images/config and disables/removes the staging directory integration without destructive database rollback.

Production rollout is not authorized by this specification.

## Non-goals

- Staff account provisioning, password reset, identity enable/disable, or offboarding (Go 5C);
- Platform Administrator self-grant/self-revoke UI;
- Keycloak Admin Console replacement;
- HCIS/domain role or permission management;
- Organizational Unit master/cutover;
- universal Person Registry;
- exposing Keycloak Admin REST credentials or tokens to the browser;
- broad Keycloak `manage-users` authority solely for MFA-readiness display;
- production deployment.
