# ADR-0002: Staff Identity Strategy

**Status:** ACCEPTED
**Date:** 2026-08-27

## Context
HCIS currently has application-owned authentication. SQ Hub must support additional applications without forcing staff to maintain separate credentials for each application.

Building OAuth/OIDC/MFA/session protocol internals from scratch would create unnecessary security risk, especially in an AI-assisted development model.

## Decision
- Staff authentication will be centralized as SQ Identity.
- Domain applications will become clients/relying parties of SQ Identity.
- Use a mature self-hosted Identity Provider capable of standard SSO (OIDC/OAuth2-compatible approach) rather than implementing identity protocol internals from scratch.
- Exact provider selection (for example Keycloak vs authentik or another suitable self-hosted option) is deferred to a dedicated evaluation ADR.
- Identity uses an opaque technical UUID.
- NIP/nomor pegawai is the preferred human staff identifier. NIK must not be used as the login username.
- Staff passwords and MFA material must not be stored by HCIS, SPMB, or other domain applications after migration.

## Authorization boundary
SQ Identity authenticates the staff identity. SQ Hub may determine Application Access. Domain permissions remain owned by each application.

## Consequences
- Existing HCIS authentication will need a migration/cutover plan.
- Provider configuration and lifecycle become security-critical infrastructure.
- SQ Hub does not need to create a custom authentication protocol implementation.
