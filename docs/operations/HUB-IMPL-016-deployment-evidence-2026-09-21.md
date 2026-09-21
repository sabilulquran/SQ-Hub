# HUB-IMPL-016 — GitHub production deployment evidence, 21 September 2026

**Result:** PASS untuk execution path NO-OP.
**Evidence source:** GitHub Actions run metadata, job steps, dan decoded job log yang dibaca melalui GitHub connector.
**Independent live VPS/browser inspection by this documentation task:** NONE.

## Provenance

- Target main: `d2de4411760c963df542a540c6e3e63eee37283e` — merge PR #87.
- PR #86 merge: `f0ba16e9766b8789e0e938c4c50c52741bf03b16`.
- Workflow: `.github/workflows/deploy-production.yml`, **Deploy SQ Hub Production**.
- Run: [35581490721](https://github.com/sabilulquran/SQ-Hub/actions/runs/35581490721).
- Job: [106275169815](https://github.com/sabilulquran/SQ-Hub/actions/runs/35581490721/job/106275169815).
- Run started: `2026-09-21T09:07:19Z`; completed status updated `2026-09-21T09:08:03Z` (16:07–16:08 WIB).
- Scope: `auto`; confirmations supplied: `DEPLOY_PRODUCTION` and `BACKUP_VERIFIED`.
- Main CI: run [35580989736](https://github.com/sabilulquran/SQ-Hub/actions/runs/35580989736), SUCCESS.
- Launcher contract: run [35580989547](https://github.com/sabilulquran/SQ-Hub/actions/runs/35580989547), SUCCESS.

## Actual sanitized log markers

```text
PRODUCTION_RUNTIME_BUNDLE_PREFLIGHT_PASS
api_source_sha=6f5f5e9db40644ee104c303e9f9f0d6786243819 change=0
web_source_sha=6f5f5e9db40644ee104c303e9f9f0d6786243819 change=0
identity_source_sha=92ab28c7226b6835fdf29a98cb4ec5d77ac42539 change=0
API_DEPLOY_NOOP source=6f5f5e9db40644ee104c303e9f9f0d6786243819
WEB_DEPLOY_NOOP source=6f5f5e9db40644ee104c303e9f9f0d6786243819
IDENTITY_IMAGE_DEPLOY_NOOP source=92ab28c7226b6835fdf29a98cb4ec5d77ac42539
SQ_HUB_PRODUCTION_DEPLOY_PASS
runtime_scope=auto
```

No component recreate occurred in this run. Main/source-of-truth SHA and component-source SHAs are intentionally different; this is not evidence that production has the wrong application image.

## Runtime bundle and database boundary

Operator-provided topology, reconciled by PR #86/#87 and validated by the run preflight:

| Bundle | Project | Existing services | Allowed deployment targets |
| --- | --- | --- | --- |
| `/var/www/sq-hub-production/compose.hub.json` | `sq-hub-production` | `postgres`, `api`, `web` | `api`, `web` only |
| `/var/www/sq-hub-production/compose.identity.json` | `sq-hub-keycloak-production` | `keycloak-db`, `keycloak` | `keycloak` only |

The root-owned runtime directory is **not a Git checkout**. Deployment uses the approved SSH user with non-interactive sudo. Neither `postgres` nor `keycloak-db` may be recreated, modified, migrated, or replaced by the image deployment workflow. No whole-stack `docker compose up` is permitted.

## Backups emitted by the run

```text
/var/www/sq-hub-production/compose.hub.json.before-gha-20260921T090754Z
/var/www/sq-hub-production/compose.identity.json.before-gha-20260921T090754Z
```

These are operator-host file references, not repository artifacts and not files held by this documentation task. They are Compose configuration copies, **not database backups**. The literal BACKUP_VERIFIED is an operator attestation; it is not independent proof of database backup integrity or restore execution.

## What PASS proves and does not prove

PASS proves this run validated the target, resolved components, reached the sudo/runtime bundle path, authenticated to GHCR, accepted the verified topology, recognized unchanged component images, created Compose backup references, and passed the workflow health path. The GHCR logout step completed, but its best-effort command does not independently attest the final credential-store contents.

PASS does not prove a component recreate, failure-triggered rollback, database restore, authenticated browser journey, recovery email, Google linking, MFA/trusted-device matrix, or complete cookie/storage security. Do not manufacture a production restart merely to change NO-OP into a changed deployment.

The image/config rollback and operator escalation path is documented in [the production launcher runbook](HUB-IMPL-016-production-launcher.md#failure-and-rollback). Failed rollback remains an incident. Database rollback is never implicit. Backup/restore or outage rehearsal, where still required by an accepted gate, must use an approved isolated target and retain its own evidence.

## Production connection configuration

GitHub Environment `production` uses only `SQ_HUB_PROD_HOST`, `SQ_HUB_PROD_USER`, `SQ_HUB_PROD_SSH_PRIVATE_KEY`, and `SQ_HUB_PROD_SSH_KNOWN_HOSTS`. No secret value or runtime Compose content is retained here. The successful run proves those inputs were usable for this execution; it does not independently audit all environment reviewer-protection settings.

See [Foundation closure ledger](foundation-v1-closure.md) for the remaining acceptance gates.
