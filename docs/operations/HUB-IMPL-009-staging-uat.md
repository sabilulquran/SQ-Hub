# HUB-IMPL-009 staging UAT

**Scope:** SQ Admin Center Go 5B on staging only.

Use only synthetic staging identities and applications. Do not place passwords, client secrets, tokens, cookies, TOTP values, recovery codes, or raw OIDC subjects in evidence.

## Required checks

1. Ordinary Staff cannot discover or use Go 5B admin routes; direct `/admin` browser behavior remains generic and admin API denial remains explicit.
2. Current fresh Platform Administrator session opens Administrasi SQ and shows Aplikasi, Akses Aplikasi, and Audit Platform.
3. Staff lookup returns only bounded human-facing matches and MFA readiness booleans. Raw subject is not rendered in the UI.
4. Create/update one synthetic application; changing normal metadata is audited and the application key cannot be renamed through the UI.
5. Grant Application Access to a synthetic Staff identity with a reason; launcher/domain entry behavior follows the existing Application Access contract.
6. Revoke the same access with a reason; new access check denies it while unrelated application/domain permissions remain untouched.
7. Audit Platform can find the registry and access events and does not display raw OIDC subjects or credential/token material.
8. Revoking Platform Administrator still immediately removes Administrasi SQ capability and all Go 5B admin API access.
9. Identity-directory client is internal/least privilege and no browser request contains its token or secret.
10. Production remains untouched.

## Sanitized evidence

Suitable markers:

- `GO5B_STAFF_LOOKUP_PASS`
- `GO5B_REGISTRY_MUTATION_PASS`
- `GO5B_ACCESS_GRANT_REVOKE_PASS`
- `GO5B_AUDIT_SANITIZATION_PASS`
- `GO5B_ADMIN_REVOCATION_PASS`
- `GO5B_DIRECTORY_BOUNDARY_PASS`
- `GO5B_STAGING_ONLY_PASS`
