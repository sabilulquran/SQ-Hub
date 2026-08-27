# SQ Identity / Keycloak Staging

Implementation target: `HUB-IMPL-001`.

This directory contains the reproducible, non-secret staging foundation for SQ Identity. It does **not** contain real Staff accounts, client secrets, bootstrap passwords, database passwords, or production data.

## Topology

```text
Internet
  -> HTTPS reverse proxy
  -> login-staging.sabilulquran.or.id
  -> 127.0.0.1:8080
  -> Keycloak 26.7.2 (production mode / optimized image)
       -> dedicated PostgreSQL staging database

127.0.0.1:9000
  -> Keycloak health/metrics management interface
  -> never proxied publicly
```

The public reverse-proxy example blocks `/admin/` and `/realms/master/`. Administrative work must use a controlled local/VPS path rather than exposing the administration surface through the public login hostname.

## Files

- `Containerfile` — pinned, optimized Keycloak image with health/metrics and SQ theme.
- `docker-compose.staging.yml` — normal staging runtime; contains no bootstrap-admin requirement.
- `docker-compose.bootstrap.yml` — first-bootstrap-only admin override.
- `realm/sq-staff-staging-realm.json` — non-secret realm/client baseline.
- `reverse-proxy.nginx.example.conf` — public login-host Nginx example.
- `themes/sq-hub/` — SQ login theme derived from the accepted HCIS design baseline; no font files are bundled.
- `scripts/backup.sh` — PostgreSQL custom-format backup.
- `scripts/restore-check.sh` — restores a backup to a disposable verification database and checks that the staging realm exists.

## Prepare staging secrets

Create a local VPS-only file from `.env.example`:

```bash
cp infra/keycloak/.env.example infra/keycloak/.env.staging
chmod 600 infra/keycloak/.env.staging
```

Set strong values for:
- `KEYCLOAK_DB_PASSWORD`;
- `KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME`;
- `KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD`.

`.env.staging` must never be committed.

## First bootstrap only

The bootstrap administrator is injected only when the bootstrap override is explicitly included:

```bash
docker compose \
  --env-file infra/keycloak/.env.staging \
  -f infra/keycloak/docker-compose.staging.yml \
  -f infra/keycloak/docker-compose.bootstrap.yml \
  up -d --build
```

Verify readiness from the VPS:

```bash
curl --fail http://127.0.0.1:9000/health/ready
```

Verify the issuer after DNS/TLS/reverse proxy is active:

```bash
curl --fail \
  https://login-staging.sabilulquran.or.id/realms/sq-staff-staging/.well-known/openid-configuration
```

Before removing bootstrap credentials, establish and verify the named administrative/recovery path required by the security baseline. Do not reuse a daily Staff identity as the bootstrap/emergency administrator.

After that path is verified, restart using **only** the normal staging compose file:

```bash
docker compose \
  --env-file infra/keycloak/.env.staging \
  -f infra/keycloak/docker-compose.staging.yml \
  up -d
```

Then remove/rotate the bootstrap-admin values from operational secret storage. The normal compose file does not require them for subsequent restarts.

## Realm baseline

The imported staging realm is `sq-staff-staging` and currently establishes:
- self-registration disabled;
- NIP/username login with unique email alternate capability;
- no duplicate email;
- Remember Me disabled;
- SSO idle 8 hours;
- SSO max 12 hours;
- access token 5 minutes;
- minimum password length 12 and password != username;
- brute-force protection baseline around 5 failures / temporary wait;
- TOTP policy;
- HCIS browser client, SQ Hub API audience, and dedicated HCIS service client;
- SQ login theme.

Email login is only acceptable for identities provisioned with a verified/controlled email according to the Staff Authentication Policy. Self-registration is disabled, so provisioning must enforce that invariant.

### Recovery codes

Keycloak 26.7 supports recovery authentication codes. `CONFIGURE_TOTP` is configured to add recovery-code setup when the recovery-code required action/browser-flow option is enabled. The runtime operator must verify the following in staging before `HUB-IMPL-001` is declared complete:

1. Recovery Authentication Codes required action is enabled.
2. `Recovery Authentication Code Form` in the conditional 2FA browser flow is `Alternative` rather than `Disabled`.
3. A privileged synthetic user that enrolls TOTP is also required to save recovery codes.
4. A saved recovery code can be used through `Try Another Way` when TOTP is unavailable.

Do not claim this acceptance item from the realm JSON alone; verify it in running staging.

## Public reverse proxy

`reverse-proxy.nginx.example.conf` is intentionally an example rather than an assumption about the VPS TLS/ACME layout. Required invariants:
- TLS terminates at the supported reverse proxy;
- only the public login/OIDC surface is exposed;
- `/admin/` and `/realms/master/` are not exposed on the public login host;
- management port `9000` is not proxied externally;
- forwarded headers are overwritten by the trusted proxy;
- Keycloak runs with explicit hostname and `xforwarded` proxy-header handling.

## Backup and restore rehearsal

Create a backup:

```bash
KEYCLOAK_ENV_FILE=infra/keycloak/.env.staging \
  bash infra/keycloak/scripts/backup.sh
```

Restore-check a selected dump into a disposable database:

```bash
KEYCLOAK_ENV_FILE=infra/keycloak/.env.staging \
  bash infra/keycloak/scripts/restore-check.sh infra/keycloak/backup/<file>.dump
```

The restore check never overwrites the live staging database.

A backup is not considered proven until restore-check succeeds. Staging rollout must record the executed backup/restore evidence.

## CI vs shared staging

GitHub CI is allowed to run Keycloak with an explicit `http://127.0.0.1` hostname only as an isolated smoke environment. That test proves image build, realm import, health, policy/client configuration, and backup/restore mechanics.

CI success does **not** prove:
- the real VPS DNS/TLS/reverse proxy;
- resource headroom on the YSQ VPS;
- real staging MFA/recovery-code UX;
- actual administrative ingress restrictions;
- production readiness.

Those items require the shared staging deployment and recorded runtime verification.

## Production guardrail

This configuration is staging-only. Do not point production HCIS at `sq-staff-staging`, copy synthetic credentials into production, or promote the staging database as production data. Production identity configuration/version pinning remains a separate reviewed change after Wave 1 staging evidence.
