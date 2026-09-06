# HUB-IMPL-003 staging API image namespace migration

**Status:** PREPARED ONLY — DO NOT DEPLOY from this change  
**Scope:** SQ Hub API staging image provenance/verification

**Execution update — 2026-09-06:** a separately authorized API-only staging
deployment now runs the organization-owned immutable verifier repair image from
PR #47. Provenance, digest, preserved environment/non-target IDs and live access
probes are in the [execution evidence](HUB-IMPL-003-production-readiness-2026-09-06.md).
The prepared procedure below is retained as historical/runbook context; no
production deployment has occurred.

## Finding

The repository already has an organization-owned publisher in `.github/workflows/publish-api-staging-image.yml`.

Its immutable image contract is:

```text
ghcr.io/sabilulquran/sq-hub-api:sha-<FULL_SOURCE_SHA>
```

A push to `main` also publishes the mutable convenience tag `:staging`, but Wave 1 final evidence and migration should use the immutable SHA tag and resolved digest. No repository-side change to the API publisher is required for this closure branch.

This procedure exists because a currently running staging API may predate organization-owned publication and may still reference a historical personal namespace. This agent does not change the live staging deployment.

## Publish/verify the immutable organization image

For the exact approved SQ Hub source SHA, use the existing workflow dispatch input `source_ref=<FULL_SOURCE_SHA>`. Publishing is a repository operation and must complete successfully before a runtime migration is scheduled.

After publication, an authorized operator may verify the image without starting it:

```bash
IMAGE="ghcr.io/sabilulquran/sq-hub-api:sha-<FULL_SOURCE_SHA>"
docker pull "$IMAGE"
docker image inspect "$IMAGE" \
  --format 'image={{index .RepoDigests 0}} source={{index .Config.Labels "org.opencontainers.image.source"}}'
```

Expected source label:

```text
https://github.com/sabilulquran/SQ-Hub
```

Record the immutable image digest and source SHA. Do not use `:staging` as the final Wave 1 provenance record because that tag can move.

## Migration preconditions

Before an authorized staging migration:

- current SQ Hub API source/runtime identity is recorded without secrets;
- the target organization image corresponds to a reviewed/green commit;
- target digest is recorded;
- current staging database backup/recovery path is known;
- current staging env is preserved outside Git;
- the Compose change only replaces image provenance and does not change database identity, Application Access data, issuer, or secrets;
- HCIS/SQ Hub shared network assumptions remain unchanged;
- no production runtime is addressed by the command set.

## Authorized staging migration procedure

This is for a later authorized operator, not this Agent 2 execution:

1. set the SQ Hub staging API image input to the immutable organization-owned `sha-<FULL_SOURCE_SHA>` reference (preferably digest-pinned after verification);
2. validate Compose rendering with the staging env file;
3. `docker compose pull` the target image;
4. recreate only the SQ Hub staging API service with `--no-build`;
5. verify local `/health`, migrations/startup, and container image digest;
6. verify HCIS-to-SQ-Hub Application Access check over `sq_platform_staging`;
7. verify a fresh synthetic HCIS SSO only if runtime acceptance requires it;
8. record the new immutable image ref/digest in final Wave 1 evidence.

Do not rebuild the API on the staging VPS. Do not deploy or repoint production.

## Rollback

If the organization image migration itself causes a staging regression, restore the previously recorded staging image reference only. Do not roll back database schema merely to change image namespace unless a separate migration failure specifically requires an approved database recovery action.

## Closure status

Repository publisher capability: `READY` — organization-owned immutable API images can be published and verified.  
Live staging namespace migration: `MANUAL_STAGING_REQUIRED` — deliberately not executed by this agent.
