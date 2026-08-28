# Staging image publishing

**Status:** ACCEPTED operational rule
**Applies to:** SQ Hub API and SQ Identity / Keycloak staging images
**Related specs:** HUB-IMPL-001, HUB-IMPL-002, HUB-IMPL-003

## Purpose

Staging images must be publishable and deployable independently. A Keycloak-only change must not rebuild or move the SQ Hub API staging image, and an API-only change must not rebuild or move the Keycloak staging image.

This separation is especially important for pre-merge UAT: a candidate image may be published for one exact commit without moving the shared staging alias or mutating another service.

## Workflows

- `.github/workflows/publish-keycloak-staging-image.yml` owns `ghcr.io/imadjinasi/sq-hub-keycloak`.
- `.github/workflows/publish-api-staging-image.yml` owns `ghcr.io/imadjinasi/sq-hub-api`.

The former combined `publish-staging-images.yml` workflow is intentionally removed to eliminate cross-service publishing coupling.

## Immutable candidate images

For pre-merge validation, manually dispatch only the workflow for the service being tested and provide the exact source commit SHA in `source_ref`.

The workflow checks out that source ref, resolves the actual commit SHA, and publishes only:

```text
ghcr.io/imadjinasi/<image>:sha-<resolved-commit-sha>
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

The moving staging aliases are therefore main-branch outputs, not pre-merge candidate aliases.

## Deployment guardrails

- Deploy immutable `sha-...` tags for controlled UAT whenever practical.
- Do not build source on the constrained shared staging VPS.
- Do not use a Keycloak candidate publish to move or rebuild the SQ Hub API image.
- Do not use an API candidate publish to move or rebuild the Keycloak image.
- Publishing an image is not permission to deploy it to production.
- Production images/cutover remain a separate reviewed activity.
- Do not print registry credentials, application secrets, tokens, or Keycloak credentials in operational evidence.

## Verification

Before using a manually published candidate image:

1. confirm the workflow resolved the expected source commit SHA;
2. confirm the package exists with the matching immutable `sha-...` tag;
3. deploy only the intended service;
4. record the exact deployed image/tag and affected container;
5. verify unrelated services were not restarted or retagged.
