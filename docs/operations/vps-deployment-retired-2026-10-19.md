# The VPS deployment path was retired on 2026-10-19

SQ Hub used to be deployed to a VPS by the GitHub Actions workflow `deploy-production.yml`, which signed in over
SSH and swapped Docker Compose containers under `/var/www/sq-hub-production`. That stopped being true when SQ
Core moved to the Mi8 host: there SQ Hub runs as a plain Node process started by `sq-core-worker.sh` from
`/srv/sq-hub`, with no containers and no registry.

The last successful run of that workflow was on 2026-10-02. On 2026-10-19 a release attempt failed at SSH host
key verification, because the address no longer answers with the key the repository secret pins — the VPS had
been shut down after the move. Nothing was exposed: SSH verifies the host before it authenticates, so the
deploy key was never offered, no command ran on any host, and the registry token was never sent.

Removed in that cleanup:

- `.github/workflows/deploy-production.yml`
- `.github/workflows/backup-hub-production.yml`
- `.github/workflows/verify-production-backup.yml`
- `.github/workflows/hub-production-launcher-contract.yml` (it only guarded the three above)
- `tools/production/` (`deploy_from_github.sh`, `verify_hub_launcher_contract.py`)

Kept on purpose: `infra/docker-compose.production.yml`, `infra/production.env.example` and
`infra/reverse-proxy.caddy.production.example`, because other specs still cite them as the reference for which
environment variables production expects, and the staging workflows are untouched.

The repository secrets `SQ_HUB_PROD_HOST`, `SQ_HUB_PROD_USER`, `SQ_HUB_PROD_SSH_PRIVATE_KEY` and
`SQ_HUB_PROD_SSH_KNOWN_HOSTS` are deleted by the owner in repository settings. They open nothing — their
counterpart lived on the VPS that no longer exists — but an unused key is better gone.

Earlier documents under `docs/operations/` that describe the VPS deployment (HUB-IMPL-013, HUB-IMPL-016,
HUB-IMPL-018, `project-status-2026-09-23.md`) are kept as they are. They are a record of what happened then,
not instructions for now.

**Releasing SQ Hub today** happens on the Mi8 host with the scripts in the `sq-core-ops` repository, the same
way the other SQ Core applications are released, and each step needs the owner's approval. There is no
automated deployment pipeline, which is the real state of things rather than something this cleanup took away.
