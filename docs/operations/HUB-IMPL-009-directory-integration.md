# HUB-IMPL-009 identity-directory integration

This runbook covers the staging-only Keycloak directory client used by SQ Hub Go 5B. It is not a browser credential and is not a replacement for SQ Identity authentication.

## Boundary

- Target realm: `sq-staff-staging` only.
- Client: `sq-hub-directory-staging`.
- Grant type: client credentials through the Keycloak service account.
- Direct realm-management roles: exactly `query-users` and `view-users`.
- Browser/direct-password/implicit flows: disabled.
- `manage-users`, impersonation, client-management, and broad administrator authority are explicitly out of scope.
- Admin REST is reached from the SQ Hub API only through `sq_identity_directory_staging`, an internal Docker network created by the Keycloak staging Compose project.
- The client secret exists only in controlled runtime env files and must never be printed, committed, passed in browser configuration, or placed in command arguments.
- The directory integration reads bounded user representations only; it does not request arbitrary-user credential lists.

## Persistent-realm convergence

`--import-realm` does not modify an existing persistent realm. For shared staging, authenticate `kcadm` locally from the controlled VPS terminal, then run `infra/keycloak/scripts/reconcile-directory-client.sh` twice with the same runtime secret. The second pass proves idempotence.

The script fails closed if the service account has direct realm-management roles beyond `query-users` and `view-users`.

Expected sanitized output:

```text
DIRECTORY_CLIENT_CONFIGURATION_PASS
DIRECTORY_CLIENT_LEAST_PRIVILEGE_PASS
```

Remove the short-lived `kcadm` configuration after verification. Do not record its contents.

## Runtime smoke

After the Hub API and Keycloak share the internal network, verify from the Hub API container without printing the client secret or access token:

1. the internal Keycloak hostname resolves;
2. the realm OIDC endpoint is reachable over the internal network;
3. the service account can perform bounded user search and read a user representation with only `query-users` + `view-users`;
4. a server-side directory lookup for a controlled synthetic Staff identity returns bounded profile data and safe readiness values without reading credential material;
5. TOTP readiness may be true/false/unknown from the user representation; a pending recovery-code required action may prove recovery is not configured, otherwise recovery readiness remains unknown rather than escalating privilege;
6. the browser receives no directory client token/secret;
7. public Keycloak `/admin/` remains blocked by the public reverse proxy.

## Rollback

Rollback Go 5B by restoring the previous Hub API/web images and runtime env, then detaching the Hub API from the internal directory network. The dedicated Keycloak client can be disabled after evidence is retained. Do not delete SQ Hub Application Access or audit data as a routine rollback step.

Production remains unauthorized.
