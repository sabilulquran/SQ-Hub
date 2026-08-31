# SQ Admin Center v1

**Status:** ACCEPTED
**Product:** SQ Hub
**Area:** Platform administration
**Environment target:** staging first; production is a separate reviewed activity

## Purpose

SQ Admin Center is the administrative surface for capabilities that are owned by the SQ platform rather than by one business domain.

It exists to centralize platform administration without turning SQ Hub into a universal ERP administration layer.

## Product boundary

SQ Admin Center owns only cross-application platform concerns:

- platform administrator authorization;
- Application Registry administration;
- Application Access grant/revoke and inspection;
- platform audit visibility;
- staff identity provisioning/offboarding orchestration where the action is truly identity/platform-owned;
- future shared Organizational Unit administration after the Organizational Unit migration/cutover is explicitly accepted.

SQ Admin Center does **not** own domain business authorization or domain data. In particular, Platform Administrator does not automatically receive HCIS, SPMB, Finance, Recruitment, Work, Academic, payroll, employee-master, approval, or other domain permissions.

Centralized administration is not centralized authorization.

## Platform administrator model

`SQ Platform Administrator` is a dedicated SQ Hub platform privilege. It is distinct from every domain administrator role.

A person may have both a platform role and one or more domain roles, but each assignment is explicit and independently revocable.

Platform role assignment is keyed by the canonical staff technical identity (`OIDC issuer + sub`). NIP, email, username, or HCIS account id may be used only as human/operator lookup aids; they are not the stored authorization key.

The source of truth for SQ Hub platform authorization is SQ Hub. Keycloak roles must not become a second authorization source of truth for Application Access or domain permissions.

## Privileged authentication

SQ Platform Administrator is a privileged role and therefore must satisfy the Staff Authentication Policy MFA requirement before a production-capable administrative surface is accepted.

The exact step-up/MFA transport mechanism belongs in an implementation contract. No implementation may weaken the policy by treating an ordinary password-only Hub session as sufficient for sensitive platform administration.

## v1 capability map

### 1. Platform access boundary

SQ Hub can determine whether the current authenticated identity is an active Platform Administrator and expose administrative UI/API only when authorized.

All privileged checks are server-side. Hiding navigation in the browser is not authorization.

### 2. Application Registry

Administrators can view applications and, in the later mutation slice, update allowed registry metadata and active/inactive state.

`application_key` remains the stable machine key defined by `HUB-IMPL-002`; it is not casually editable after use.

### 3. Application Access

Administrators can inspect, grant, and revoke an identity's access to registered applications through supported server-side workflows.

Application Access remains separate from permissions inside the target application.

### 4. Platform audit

Administrative actions expose audit information sufficient to answer who acted, what changed, which target was affected, when it occurred, the outcome, and the supplied reason where applicable.

Secrets, credentials, raw OIDC tokens, authorization codes, PKCE verifiers, session cookies, and other sensitive authentication material are never returned as audit payloads.

### 5. Staff identity operations

Provisioning/offboarding is a later Go 5 slice because it requires controlled integration with SQ Identity/Keycloak and must preserve the existing identity ownership boundary.

SQ Admin Center may orchestrate approved identity operations but does not store or reveal passwords. Administrative reset uses provider-native reset/required-action flows.

### 6. Organizational Unit

Organizational Unit administration is deliberately deferred until the HCIS-to-SQ-Hub ownership migration/cutover is specified and accepted. Go 5 must not create a parallel shared unit master or hidden dual-write.

## Delivery slices

Go 5 is intentionally split so privileged authorization is proven before sensitive mutation UI is exposed:

1. `HUB-IMPL-007` — Platform Admin authorization foundation and read-only Admin Center shell.
2. Future implementation contract — privileged MFA/step-up acceptance where needed for sensitive mutation.
3. Future implementation contract — Application Registry + Application Access administration UI/API.
4. Future implementation contract — staff identity provisioning/offboarding.
5. Future implementation contract — Organizational Unit administration after explicit migration/cutover acceptance.

The numbering/order of later contracts may be adjusted, but their boundaries may not be silently collapsed into `HUB-IMPL-007`.

## UX

For v1, SQ Admin Center is a protected administrative surface inside the SQ Hub product experience rather than a separate public product or second authentication system.

The shell follows the accepted SQ Hub/HCIS visual baseline. Ordinary staff must not see actionable Admin Center navigation when they lack platform authorization.

A direct request by an unauthorized authenticated user fails closed with a generic forbidden experience and does not disclose privileged data.

## Audit and safety requirements

- bootstrap/grant/revoke of Platform Administrator privilege must be auditable;
- no raw SQL is the normal operator interface;
- no platform mutation is authorized merely because a user has an HCIS `SUPER_ADMIN` role;
- no Platform Administrator privilege is inferred from email domain, username, employee position, or application access;
- production data/credentials are not used in development or staging evidence;
- staging first; production cutover/deployment requires separate explicit review.

## Non-goals

- universal domain permission engine;
- automatic migration of HCIS `SUPER_ADMIN`;
- reading or changing payroll/finance/admission/work data as Platform Administrator;
- public/external SQ Account administration;
- applicant/guardian/student identity administration;
- Organizational Unit cutover;
- universal Person Registry;
- direct Keycloak database manipulation;
- a second set of user passwords in SQ Hub.

## Acceptance of the product boundary

A Go 5 implementation is conformant only when a Platform Administrator can administer platform-owned capabilities while remaining unable to acquire domain business privileges solely by virtue of the platform role.
