# Staff identity provisioning profile

**Status:** ACCEPTED OPERATIONAL BASELINE  
**Related:** `HUB-IMPL-001`, `docs/security/staff-authentication-policy.md`

This runbook defines the minimum profile data that must be present when a Staff identity is provisioned into SQ Identity. It applies to current manual staging provisioning and becomes a hard requirement for future automated provisioning/Admin Center flows.

## Purpose

Prevent incomplete Staff identities from falling into an unexpected Keycloak profile-completion required action on their first application login, while preserving SQ Identity as the owner of authentication and credential lifecycle.

The staging UAT finding that motivated this baseline was a synthetic employee whose account had a valid username/email but no `firstName`/`lastName`; Keycloak therefore asked the user to complete profile data before the normal OIDC journey could continue.

## Required provisioning fields

A new Staff identity must be created with all of the following before Application Access is granted:

- `username`: NIP when an authoritative NIP exists; otherwise the verified unique Staff email according to the Staff Authentication Policy;
- `email`: controlled, unique Staff email when email is available for the identity;
- `emailVerified`: `true` only after the operational process has actually verified/controlled that address;
- `firstName`: non-empty person given/display-name component suitable for the shared account experience;
- `lastName`: non-empty family/remaining-name component suitable for the shared account experience;
- `enabled`: according to the intended identity lifecycle state;
- no NIK as username or authentication identifier.

For Indonesian names that do not naturally split into Western given/family-name semantics, provisioning must still populate both Keycloak fields without inventing a different legal identity. Use a stable operational split of the person's accepted display name and preserve the full authoritative name in the owning domain system. The exact future shared-person profile model remains a separate platform decision.

## Provisioning order

For current staging/manual provisioning:

1. resolve the intended Staff identity and authoritative login identifier;
2. create/update the Keycloak user with `username`, controlled email where applicable, `firstName`, and `lastName` in the same provisioning step;
3. configure the intended credential/MFA state through the approved Keycloak administrative path without putting credentials in repository files, shell history, screenshots, or reports;
4. read the user representation back and verify `username`, `firstName`, `lastName`, enabled state, and controlled email state;
5. only then persist the exact OIDC `issuer + sub` mapping in the consuming application;
6. only then grant the required SQ Hub Application Access;
7. execute browser UAT.

A user missing either name field is **not provisioned-complete** and must not be used as evidence for normal first-login UX unless the test intentionally targets the profile-completion required action.

## Synthetic staging identities

Synthetic users must:

- be clearly identifiable as synthetic/UAT accounts;
- use non-real credentials stored only through approved secret handling;
- have both `firstName` and `lastName` populated before ordinary login UAT;
- not be used to represent production identity data;
- be removed/disabled when no longer required by the staging test plan.

The existing HCIS UAT account should be treated under this rule on its next controlled maintenance/provisioning action. Do not recreate the identity merely to satisfy this documentation change if its current subject mapping is already in use; preserve `issuer + sub` continuity and update only the missing non-secret profile attributes through the approved admin path.

## Future automation / Admin Center requirement

Any future SQ Hub/SQ Admin Center provisioning UI, sync worker, SCIM-like integration, or account-promotion flow must enforce this profile completeness **before** reporting provisioning success.

The provisioning contract must reject or hold incomplete records rather than silently creating a usable identity that immediately asks the end user to repair administrator-owned profile gaps.

At minimum automated verification must assert:

```text
username present
firstName present
lastName present
identity enabled/disabled as intended
email uniqueness/verification invariant satisfied when email is used
```

Application Access is a separate state and must not be used as a substitute for profile completeness.

## Required-action boundary

Keycloak required actions remain valid for intentional security/user workflows such as MFA enrollment, password update, or an explicitly designed profile-change journey.

This baseline only says that **administrator/provisioner omission of required Staff name attributes is not an acceptable reason** to interrupt a normal first login.

Do not disable profile validation globally merely to hide incomplete provisioning.

## Audit and evidence

Operational evidence may record:

- synthetic account identifier/email;
- whether required profile fields were present;
- provisioning timestamp/operator where appropriate;
- resulting enabled/Application Access state.

Do not record passwords, TOTP secrets, recovery codes, client secrets, tokens, or full administrative credential material.

## Acceptance

A normal newly provisioned synthetic Staff user can enter an allowed application through SQ Identity without an unexpected profile-completion screen caused by missing `firstName` or `lastName`.
