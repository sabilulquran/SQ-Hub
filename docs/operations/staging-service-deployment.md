# Staging service deployment

**Status:** ACCEPTED operational rule  
**Scope:** existing SQ Hub shared staging only  
**Production:** not authorized

This runbook is the authoritative path for routine staging image changes after the stack has already been bootstrapped. Initial environment creation remains documented in the older foundation runbooks, but routine upgrades must not use an unscoped `docker compose pull` or `docker compose up` across the whole project.

## Why this exists

Compose interpolation happens on the host before containers start. A running container is not a secret/configuration source-of-truth. Reconstructing missing database credentials, client secrets, hostnames, or image variables from a running container is prohibited.

The two deterministic staging interpolation sources are:

- SQ Hub stack: `infra/.env.staging`;
- Akun SQ / Keycloak stack: `infra/keycloak/.env.staging`.

Both files are VPS-only, Git-ignored, and must have no group/world permissions. Deploy and rollback use the same env file for the selected stack.

## Supported routine targets

The current service-scoped wrapper intentionally accepts only:

- `web` for SQ Hub visual/runtime web changes;
- `keycloak` for Akun SQ / Keycloak image changes.

It does not deploy the SQ Hub API. Extending the wrapper to API deployment requires a separate reviewed change because API startup performs migrations and has a different rollback risk profile.

## Immutable image requirement

Forward deployments must use one of these exact forms:

```text
ghcr.io/sabilulquran/sq-hub-web:sha-<40-hex-commit-sha>
ghcr.io/sabilulquran/sq-hub-keycloak:sha-<40-hex-commit-sha>
```

The deployment wrapper refuses personal namespaces, moving tags, and non-SHA tags. A previously running image may be used only as the automatic rollback target when it is already cached locally.

## Preflight contract

Before any container recreation, `infra/scripts/deploy-staging-service.sh`:

1. validates the exact supported target and organization-owned immutable image name;
2. requires the canonical env file to exist, be readable, and have no group/world permissions;
3. checks mandatory env keys by name without printing values;
4. renders the complete Compose model with `docker compose --env-file ... config -q` in a sanitized process environment, so exported application variables cannot silently override the env file;
5. verifies the selected service and its non-target dependencies are currently running;
6. records only container IDs and image references needed for scope/rollback checks, never container environment values;
7. requires the currently running image to remain cached locally for rollback;
8. pulls and verifies the requested organization-owned image before mutation;
9. uses a per-service `flock` to prevent concurrent staging deploys.

A preflight failure must exit before recreation.

## Mutation contract

The wrapper recreates exactly one service with:

```text
up -d --no-deps --no-build --pull never --force-recreate <service>
```

For a `web` deployment, `postgres` and `api` container IDs must remain unchanged. For a `keycloak` deployment, `keycloak-db` must remain unchanged. The two Compose projects remain isolated as `sq-hub-staging` and `sq-hub-keycloak-staging`.

## Verification

After recreation, the wrapper automatically requires:

- Docker health for the selected service;
- the running image reference to equal the requested immutable image;
- non-target container IDs to remain unchanged;
- `https://hub-staging.sabilulquran.or.id/healthz` to succeed;
- public OIDC discovery at `https://login.sabilulquran.or.id/realms/sq-staff-staging/.well-known/openid-configuration` to succeed and contain the expected issuer.

These checks do not replace HUB-IMPL-010 visual UAT.

## Automatic rollback

Any failure after mutation arms rollback. Rollback:

- uses the same Compose project, Compose file, and env file used for the forward deployment;
- recreates only the selected service;
- uses the exact previously running image reference, which was verified as locally cached before mutation;
- repeats container health, non-target identity, Hub public health, and OIDC verification;
- never derives secrets from a running container.

A successful rollback emits `STAGING_DEPLOY_ROLLBACK_PASS`. A failed rollback emits `STAGING_DEPLOY_ROLLBACK_FAIL` and requires operator recovery before another deployment attempt.

## Logging and secret safety

The wrapper never uses `set -x`, never prints env file contents, and never inspects `.Config.Env`. Logs contain only service names, image references, and PASS/FAIL markers. Do not paste Docker credentials or runtime secret files into evidence.

## Invocation

Run from the repository checkout. Use an outer hard timeout so a broken Docker/registry call cannot hang an operator session indefinitely:

```bash
timeout --signal=TERM --kill-after=90s 10m \
  bash infra/scripts/deploy-staging-service.sh \
  web \
  ghcr.io/sabilulquran/sq-hub-web:sha-<commit-sha>
```

Use `keycloak` and the matching Keycloak image for the identity service. Do not run the two targets concurrently.

## Repository-transfer guardrail

Publisher workflows are pinned to `sabilulquran/SQ-Hub` and `ghcr.io/sabilulquran/...` and refuse a mismatched GitHub repository context. Historical successful runs whose event payload still names `imadjinasi/SQ-Hub` are not evidence that an organization-owned image exists.

No hostname, realm, issuer, client ID, authentication policy, Application Access rule, or production runtime is changed by this deployment mechanism.
