# SQ Admin Center Foundation

**Status:** ACCEPTED
**Date:** 2026-08-30
**Product:** SQ Hub
**Scope:** Internal platform administration after Foundation v1

## Purpose

Define the first accepted product boundary for cross-application administration in SQ Hub without turning platform administration into universal domain authorization.

This document promotes only the internal administration subset previously explored in the ecosystem experience discovery. It does not promote the broader SQ Account, SQ Portal, external identity, or universal-person concepts from that discovery.

## Product decision

The architectural capability is called **SQ Admin Center**. The user-facing navigation label in SQ Hub is **Administrasi SQ**.

For the first implementation, SQ Admin Center is a protected surface inside the existing SQ Hub deployment at `/admin`. It is not a separate application, hostname, OIDC client, or deployment unit yet.

Reasons:
- the initial audience is the same internal Staff population already authenticated by SQ Hub;
- the surface administers platform-owned data already stored by SQ Hub;
- a separate deployment would add identity, session, reverse-proxy, and operational complexity before there is an independent scaling/security need;
- the boundary remains conceptual and authorization-enforced, so it can be extracted later if evidence justifies it.

## Administration boundary

### SQ Platform Administrator

`SQ Platform Administrator` is a platform-level privilege owned by SQ Hub.

It may authorize platform concerns such as:
- Application Registry administration;
- Application Access administration;
- platform audit inspection;
- future Organization Directory operational inspection/reconciliation after a dedicated implementation contract is accepted; this does not authorize HCIS-owned organization authoring in Hub;
- future identity provisioning/offboarding workflows that coordinate platform-owned responsibilities.

It does **not** automatically authorize domain business capabilities.

A Platform Administrator is not automatically allowed to:
- administer HCIS employee/payroll/leave/attendance data;
- approve Finance transactions;
- administer SPMB selection results;
- administer Recruitment business workflow;
- read or administer Work/project content;
- inherit every domain administrator role.

Domain authorization remains owned by each domain application.

### No implicit HCIS SUPER_ADMIN mapping

Existing HCIS `SUPER_ADMIN` is not automatically converted into `SQ Platform Administrator`, and the inverse is also false.

Any later migration of mixed HCIS account/platform concerns requires a separate reviewed migration specification and UAT.

### Not Application Access

Platform-administrator privilege is not represented as an `application_access` grant. Application Access answers which application a Staff identity may enter; platform-administrator privilege answers whether the identity may perform protected SQ Hub platform administration.

The two concepts remain separate even though both are keyed by OIDC `issuer + sub`.

### Not a Keycloak role source of truth

The authoritative assignment of `SQ Platform Administrator` lives in SQ Hub, not in a Keycloak realm/client role and not in a domain application.

Keycloak remains the authentication/MFA engine. SQ Hub remains the authorization owner for its platform administration surface.

## Identity key

Platform-administrator membership uses exact OIDC `issuer + sub` as the technical identity key.

NIP, email, username, NIK, display name, and HCIS account ID are not authorization keys.

Human-friendly identifiers may be used by future operator/search tooling to resolve an identity, but persisted authorization remains keyed by `issuer + sub`.

## MFA and privilege elevation

The accepted staff authentication policy already requires MFA for SQ Hub platform administrators and Application Access administrators.

Foundation rules:
- a Platform Administrator identity must have TOTP + recovery path configured before the privilege is granted;
- privilege assignment does not bypass Akun SQ authentication policy;
- granting or re-granting the privilege invalidates eligibility of an older Hub session for the admin surface; the user must establish a Hub session after the latest grant before using Administrasi SQ;
- revocation is checked on every protected admin request and takes effect immediately for the admin surface, while the ordinary SQ Hub workspace session may remain valid;
- initial staging UAT must demonstrate a fresh privileged login with MFA before Admin Center acceptance.

Go 5A does not introduce a new credential protocol or duplicate MFA state in SQ Hub.

## Phased delivery

### Go 5A — access boundary and admin shell

Implement first:
- platform-administrator membership and auditable bootstrap/revoke operator path;
- server-side authorization for protected `/api/admin/*` endpoints;
- `Administrasi SQ` navigation only for an authorized current user;
- protected `/admin` landing surface;
- read-only platform overview sufficient to prove the authorization boundary;
- immediate admin-surface revocation behavior;
- staging-only privileged UAT.

### Go 5B — Application Registry and Application Access administration

After Go 5A is accepted:
- human-friendly Staff identity lookup through a least-privilege identity-directory integration;
- Application Registry management UI;
- Application Access grant/revoke UI;
- searchable platform audit UI;
- stronger automated precondition checks around privileged identity/MFA enrollment where practical.

Go 5B must reuse the existing Application Registry/Application Access source of truth. It must not introduce parallel access tables.

### Go 5C — provisioning and offboarding

Later specification may add:
- Staff identity provisioning workflow;
- reset/required-action operations without revealing permanent passwords;
- global identity disable/enable under explicit policy;
- coordinated offboarding across Application Access and domain integrations;
- lifecycle audit/recovery procedures.

Employee `resigned` state remains an HCIS fact and must not be silently equated with global identity disable.

## Security principles

- Hiding the `Administrasi SQ` navigation is UX only; every admin API request requires server-side authorization.
- No self-grant of Platform Administrator through the web UI in Go 5A.
- Initial privilege bootstrap/revoke uses a reviewed CLI/operator path with actor and reason and writes platform audit events.
- No raw token, credential, password, recovery code, or secret is stored in platform-admin membership or audit payloads.
- Admin data is never returned to a non-admin simply because the user has a valid ordinary Hub session.
- Privilege checks use exact `issuer + sub` and fail closed on datastore/auth errors.
- Production deployment/cutover is not authorized by Go 5A.

## Non-goals of Go 5A

- Keycloak Admin Console replacement;
- Staff account creation/edit/disable UI;
- password/MFA/recovery management UI;
- HCIS role or permission administration;
- migration of HCIS `SUPER_ADMIN`;
- workforce organization authoring/master atau ownership cutover dari HCIS ke Hub;
- Application Registry mutation UI;
- Application Access mutation UI;
- universal Person Registry;
- external account administration;
- production rollout.

## Implementation contract

Go 5A implementation is defined by `HUB-IMPL-007 — SQ Admin Center access foundation`.
