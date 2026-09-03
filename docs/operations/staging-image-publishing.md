# Staging image publishing

**Status:** ACCEPTED operational rule
**Applies to:** SQ Hub API, SQ Hub web, and Akun SQ / Keycloak staging images
**Related specs:** HUB-IMPL-001, HUB-IMPL-002, HUB-IMPL-003

## Purpose

Staging images must be publishable and deployable independently. A Keycloak-only change must not rebuild or move the SQ Hub API/web staging images, and an API/web-only change must not rebuild or move the Keycloak staging image.

This separation is especially important for pre-merge UAT: a candidate image may be published for one exact commit without moving the shared staging alias or mutating another service.

## Package ownership after repository transfer

The active repository is `sabilulquran/SQ-Hub`. Active Web and Keycloak publishers are deliberately pinned to the organization-owned package namespace and refuse to run from any other repository context:

- `ghcr.io/sabilulquran/sq-hub-web`;
- `ghcr.io/sabilulquran/sq-hub-keycloak`.

This is fail-safe transfer behavior: a stale/historical workflow event whose GitHub context still identifies `imadjinasi/SQ-Hub` must fail rather than publish a new personal-namespace artifact. Existing historical `ghcr.io/imadjinasi/...` packages are not migrated by repository transfer and do not count as organization-package evidence.

The API publisher continues to derive its namespace from the active repository owner. Its active Compose/default reference is organization-owned; API runtime deployment is outside the current visual deployment scope.

Each newly published image records `org.opencontainers.image.source=https://github.com/sabilulquran/SQ-Hub` for the pinned Web/Keycloak publishers.

## Workflows

- `.github/workflows/publish-keycloak-staging-image.yml` owns `sabilulquran/sq-hub-keycloak`.
- `.github/workflows/publish-api-staging-image.yml` owns the API image for the active repository owner.
- `.github/workflows/publish-web-staging-image.yml` owns `sabilulquran/sq-hub-web`.

The former combined `publish-staging-images.yml` workflow is intentionally removed to eliminate cross-service publishing coupling.

Web and Keycloak publisher workflow files include themselves in their `main` path filters. Therefore a reviewed publisher migration/fix can produce a fresh organization-owned immutable image after merge even when application/theme source is unchanged.

## Immutable candidate images

For pre-merge validation, manually dispatch only the workflow for the service being tested and provide the exact source commit SHA in `source_ref`.

The workflow checks out that source ref, resolves the actual commit SHA, and publishes only:

```text
ghcr.io/sabilulquran/<image>:sha-<resolved-commit-sha>
```

Manual dispatch does not move a shared staging alias.

## Main-branch staging aliases

A push to `main` publishes only the image whose source paths changed:

- Keycloak changes under `infra/keycloak/**`, or its publisher workflow, publish the immutable commit tag plus `26.7.2-staging`.
- API changes under `apps/api/**` or its root package lock inputs publish the immutable commit tag plus `staging`.
- Web changes under `apps/web/**`, root package lock inputs, or its publisher workflow publish the immutable commit tag plus `staging`.

The moving staging aliases are therefore main-branch outputs, not controlled deployment targets.

## Organization-package verification

Before a staging runtime change:

1. confirm the relevant publisher ran in `sabilulquran/SQ-Hub` context;
2. confirm its immutable `sha-...` tag exists under `ghcr.io/sabilulquran/...`;
3. confirm the publisher's post-build image inspection passed;
4. use that immutable tag with `docs/operations/staging-service-deployment.md`;
5. do not infer organization-package availability from a historical `imadjinasi/SQ-Hub` workflow run.

## Deployment guardrails

- Routine staging upgrades use `infra/scripts/deploy-staging-service.sh`; older full-project `pull`/`up` examples are initial-bootstrap references, not the routine deployment path.
- Deploy organization-owned immutable `sha-...` tags for controlled UAT.
- Do not build source on the constrained shared staging VPS.
- Do not use a Keycloak candidate publish to move or rebuild the SQ Hub API/web images.
- Do not use a Web candidate publish to move or rebuild the API/Keycloak images.
- Publishing an image is not permission to deploy it to production.
- Repository transfer is not permission to mutate the staging runtime.
- Production images/cutover remain a separate reviewed activity.
- Do not print registry credentials, application secrets, tokens, or Keycloak credentials in operational evidence.

## Verification

Before using a published candidate image:

1. confirm the workflow resolved the expected source commit SHA;
2. confirm the organization package exists with the matching immutable `sha-...` tag;
3. deploy only the intended service through the service-scoped wrapper;
4. record the exact deployed image/tag and affected container;
5. require automatic health/OIDC checks to pass;
6. verify unrelated services were not restarted or retagged;
7. complete the task-specific browser/UAT checklist before declaring acceptance.
