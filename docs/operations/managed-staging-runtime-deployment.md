# Managed staging runtime deployment

**Status:** ACCEPTED operational rule  
**Applies to:** the managed SQ Hub staging runtime bundle on the shared VPS  
**Production:** not authorized by this procedure

## Runtime model

The shared staging VPS does not run from a Git checkout. Its managed runtime root is `/var/www/sq-hub`, identified by `/var/www/sq-hub/.sq-hub-managed`.

Persistent secret-bearing environment sources are host files, not reconstructed container environment values:

- Hub: `/var/www/sq-hub/secrets/hub.env`;
- Keycloak: `/var/www/sq-hub/secrets/keycloak.env`;
- directory integration values used as a Compose `env_file`: `/var/www/sq-hub/.env.go5b-directory`.

Do not copy secret values into commands, logs, temporary evidence, or deployment documentation. Do not use `docker inspect .Config.Env` to rebuild these files.

## Active managed Compose stacks

Routine Web deployment uses the persistent stack:

1. `/var/www/sq-hub/docker-compose.hub.yml`;
2. `/var/www/sq-hub/docker-compose.hub.edge.yml`;
3. `/var/www/sq-hub/docker-compose.hub.go5b.yml`;
4. `/var/www/sq-hub/docker-compose.hub.hubimpl010.yml`.

Routine Keycloak deployment uses:

1. `/var/www/sq-hub/docker-compose.keycloak.yml`;
2. `/var/www/sq-hub/docker-compose.keycloak.go5b.yml`;
3. `/var/www/sq-hub/docker-compose.keycloak.hubimpl010.yml`.

Historical temporary rollback overlays under `/tmp` are not part of the persistent routine deployment contract. A successful managed deployment recreates the target service from the persistent stack so future Compose labels no longer depend on a temporary rollback file.

## Deployment command

Use `infra/scripts/deploy-managed-staging-service.sh` for the managed VPS bundle:

```bash
SQ_HUB_STAGING_RUNTIME_ROOT=/var/www/sq-hub \
  infra/scripts/deploy-managed-staging-service.sh \
  web \
  ghcr.io/sabilulquran/sq-hub-web:sha-<40-hex-sha>
```

or:

```bash
SQ_HUB_STAGING_RUNTIME_ROOT=/var/www/sq-hub \
  infra/scripts/deploy-managed-staging-service.sh \
  keycloak \
  ghcr.io/sabilulquran/sq-hub-keycloak:sha-<40-hex-sha>
```

Only organization-owned immutable SHA tags are accepted as forward deployment targets.

## Guardrails

Before any recreation, the wrapper:

- requires the managed-runtime marker;
- requires the persistent env source and rejects group/world-readable env files;
- checks mandatory env keys without printing values;
- renders both the current stack and target-image preview;
- verifies the current target image is cached for rollback;
- snapshots non-target container IDs;
- verifies public Hub health and OIDC discovery;
- pulls the target image before changing persistent Compose state.

Mutation is service-scoped with `--no-deps --no-build --pull never --force-recreate`.

For Web, `api` and `postgres` are non-target services and their container IDs must remain unchanged. For Keycloak, `keycloak-db` must remain unchanged.

The target image is persisted through the corresponding `*.hubimpl010.yml` override. If a post-mutation check fails, the wrapper restores the prior override and recreates only the failed target service with the previously cached image, then repeats health, non-target, and public checks.

## Retry behavior

Re-running the same immutable target is safe. If the service is already healthy on the requested image, the wrapper verifies public surfaces and non-target stability and exits successfully. If necessary, it also repairs the persistent override to match the already-running target image without recreating unrelated services.

## Production separation

This procedure is staging-only. It does not authorize production image changes, production Compose mutation, database migration, or production cutover. Production requires a separate reviewed procedure and explicit operator authorization.
