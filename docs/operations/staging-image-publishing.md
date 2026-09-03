# Staging image publishing

**Status:** ACCEPTED operational rule
**Applies to:** SQ Hub API, SQ Hub web, and SQ Identity / Keycloak staging images
**Related specs:** HUB-IMPL-001, HUB-IMPL-002, HUB-IMPL-003

## Purpose

Staging images must be publishable and deployable independently. A Keycloak-only change must not rebuild or move the SQ Hub API/web staging images, and an API/web-only change must not rebuild or move the Keycloak staging image.

This separation is especially important for pre-merge UAT: a candidate image may be published for one exact commit without moving the shared staging alias or mutating another service.

## Package ownership and repository transfer

The publisher workflows derive the GHCR namespace from `github.repository_owner` instead of hard-coding a personal account. While this repository remains under `imadjinasi`, the effective package names remain under `ghcr.io/imadjinasi/...`. After a reviewed repository transfer to `sabilulquran`, the same workflows will target `ghcr.io/sabilulquran/...`.

Each published image also records `org.opencontainers.image.source=https://github.com/${{ github.repository }}` so newly published packages can be associated with the repository that produced them.

Repository transfer does **not** itself migrate existing GHCR packages or authorize a staging deployment. Existing `ghcr.io/imadjinasi/...` packages and the currently deployed staging image references remain unchanged until a separate reviewed package/runtime migration is completed.

## Workflows

- `.github/workflows/publish-keycloak-staging-image.yml` owns `${repository_owner}/sq-hub-keycloak`.
- `.github/workflows/publish-api-staging-image.yml` owns `${repository_owner}/sq-hub-api`.
- `.github/workflows/publish-web-staging-image.yml` owns `${repository_owner}/sq-hub-web`.

The former combined `publish-staging-images.yml` workflow is intentionally removed to eliminate cross-service publishing coupling.

## Immutable candidate images

For pre-merge validation, manually dispatch only the workflow for the service being tested and provide the exact source commit SHA in `source_ref`.

The workflow checks out that source ref, resolves the actual commit SHA, and publishes only:

```text
ghcr.io/<repository-owner>/<image>:sha-<resolved-commit-sha>
```

Manual dispatch does **not** move a shared staging alias.

Example with GitHub CLI for an SQ Identity candidate:

```bash
gh workflow run publish-keycloak-staging-image.yml \
  --ref main \
  -f source_ref=<exact-commit-sha>
```

Use the resulting immutable `sha-...` tag explicitly for staging deployment and evidence capture.

## Main-branch staging aliases

A push to `main` publishes only the image whose source paths changed:

- Keycloak changes under `infra/keycloak/**` publish the immutable commit tag plus `26.7.2-staging`.
- API changes under `apps/api/**` or its root package lock inputs publish the immutable commit tag plus `staging`.
- web changes under `apps/web/**` or its root package lock inputs publish the immutable commit tag plus `staging`.

The moving staging aliases are therefore main-branch outputs, not pre-merge candidate aliases.

## Repository-transfer sequence

Before changing staging runtime references after a repository transfer:

1. confirm the transferred repository can publish all three images into the organization GHCR namespace;
2. confirm each organization package has the expected immutable source tag and repository source metadata;
3. verify GitHub Actions package permissions from the transferred repository;
4. change Compose/environment defaults to `ghcr.io/sabilulquran/...` in a separate reviewed change;
5. deploy the new immutable organization-owned tags through the normal controlled staging process;
6. verify health and rollback capability before retiring reliance on the old personal-package namespace.

## Deployment guardrails

- Deploy immutable `sha-...` tags for controlled UAT whenever practical.
- Do not build source on the constrained shared staging VPS.
- Do not use a Keycloak candidate publish to move or rebuild the SQ Hub API/web images.
- Do not use an API/web candidate publish to move or rebuild the Keycloak image.
- Publishing an image is not permission to deploy it to production.
- Repository transfer is not permission to mutate the staging runtime.
- Production images/cutover remain a separate reviewed activity.
- Do not print registry credentials, application secrets, tokens, or Keycloak credentials in operational evidence.

## Verification

Before using a manually published candidate image:

1. confirm the workflow resolved the expected source commit SHA;
2. confirm the package exists with the matching immutable `sha-...` tag;
3. deploy only the intended service;
4. record the exact deployed image/tag and affected container;
5. verify unrelated services were not restarted or retagged.
