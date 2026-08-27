# ADR-0003: Select Keycloak for SQ Identity

**Status:** ACCEPTED
**Date:** 2026-08-27

## Context
SQ Hub membutuhkan Identity Provider self-hosted untuk Staff SSO. Foundation v1 membutuhkan OIDC/OAuth2, MFA, account/session lifecycle, recovery, branding, automation/API, dan operation yang dapat dijalankan tanpa subscription identity SaaS.

Karena SQ Identity adalah security-critical shared dependency untuk HCIS, SPMB, dan aplikasi berikutnya, kematangan protocol implementation dan operational documentation lebih penting daripada membangun login stack sendiri atau memilih solusi hanya berdasarkan kemudahan UI awal.

## Candidates reviewed
### Keycloak
- Open-source Apache-2.0.
- OIDC/OAuth2 dan SAML.
- TOTP/OTP, WebAuthn/passkeys, recovery codes, dan configurable authentication flows.
- Login/admin themes dan server-side customization.
- Administration REST API.
- Official container image dan production configuration/upgrade documentation.
- Official container guidance recommends a 2 GB memory limit for smaller production-ready deployments, although lower limits can be used for constrained/test setups with explicit tuning.

### authentik
- Self-hosted and supports OAuth2/OIDC.
- Strong branding/custom-CSS support, MFA stages, REST/OpenAPI API, and configuration blueprints.
- Docker Compose is documented for test and small-scale production with at least 2 CPU cores and 2 GB RAM.
- Remains a viable fallback if future operational experience shows Keycloak is unnecessarily complex for YSQ.

### ZITADEL
- Self-hosted, standards-based OIDC/SAML/OAuth2, MFA/passkeys, audit, and comprehensive APIs.
- Attractive resource profile for test environments.
- Current self-hosted Login V2 documentation still lists limitations for some login capabilities/customizations; adopting it would add more login-client decisions than SQ Hub currently needs.

## Decision
Use **Keycloak** as the Identity Provider engine behind **SQ Identity**.

The decision is based on:
1. security/protocol maturity and widespread production adoption;
2. strong upstream documentation for authentication flows, MFA/WebAuthn, production hardening, upgrades, and Admin REST API;
3. open-source licensing with no required identity SaaS subscription;
4. standard OIDC integration for independently deployed domain applications;
5. sufficient theming capability to align the login experience with the SQ Design System;
6. lower architecture risk for a long-lived shared dependency than implementing or heavily customizing identity protocol internals ourselves.

## Boundary
Keycloak is **not** the owner of all SQ Hub authorization.

Keycloak owns identity-provider concerns:
- credentials/passwords;
- authentication flows;
- MFA/passkeys/recovery;
- IdP session and SSO protocol behavior;
- OIDC client trust and token issuance.

SQ Hub remains the source of truth for:
- Application Registry;
- Application Access;
- Organizational Unit master;
- platform audit/business administration related to those capabilities.

Each domain application remains the source of truth for its domain roles and permissions.

Do not move HCIS/SPMB domain permissions into Keycloak Authorization Services merely because Keycloak supports fine-grained authorization.

## Integration direction
- HCIS, SPMB Admin, and future internal applications become OIDC clients/relying parties of SQ Identity.
- Applications treat the authenticated subject (`sub`) as an opaque stable identifier and do not infer meaning from its format.
- Application Access may later be represented in token claims as derived/cached information, but SQ Hub remains its source of truth; avoid dual ownership.
- Staff credentials and MFA material are not stored in domain applications after migration.

## Operational requirements
Before production cutover:
- pin a tested Keycloak release; never deploy an unpinned `latest` image;
- run behind HTTPS/reverse proxy according to supported production configuration;
- set an explicit container memory limit and observe actual usage on the YSQ VPS;
- use PostgreSQL with production/staging separation;
- document backup/restore for Keycloak data/configuration;
- create least-privilege automation credentials/service accounts for Admin API use;
- test upgrade and rollback procedure;
- test HCIS OIDC login, SSO, logout, account disable, recovery, and MFA behavior;
- create and test an SQ-branded login theme against the selected Keycloak version.

This ADR chooses the provider; it does not by itself declare the deployment production-ready.

## Consequences
- SQ Hub does not implement OAuth/OIDC/MFA cryptographic protocol internals.
- Initial infrastructure has an additional shared service that requires monitoring, backup, and upgrade discipline.
- Keycloak's Java runtime has a non-trivial memory footprint; VPS capacity must be verified before production cutover.
- HCIS application-owned authentication requires an explicit migration plan.
- Login branding will be implemented as an SQ theme derived from the accepted HCIS/SQ design baseline.

## Evidence reviewed
Official/current documentation reviewed on 2026-08-27:
- https://www.keycloak.org/docs/
- https://www.keycloak.org/server/containers
- https://www.keycloak.org/server/configuration-production
- https://www.keycloak.org/docs/latest/server_admin/
- https://docs.goauthentik.io/install-config/install/docker-compose/
- https://docs.goauthentik.io/add-secure-apps/providers/oauth2/
- https://docs.goauthentik.io/customize/branding/
- https://zitadel.com/docs/self-hosting/deploy/overview
- https://zitadel.com/docs/guides/integrate/login/hosted-login
