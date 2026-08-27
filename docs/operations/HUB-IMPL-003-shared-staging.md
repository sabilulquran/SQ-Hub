# HUB-IMPL-003 shared staging runbook

**Scope:** shared staging only  
**Production cutover:** not authorized

This runbook connects the accepted SQ Identity/Keycloak staging foundation, SQ Hub Application Access API, and the HCIS OIDC consumer on one VPS without exposing the SQ Hub internal API publicly.

## Target topology

```text
Internet
  -> login-staging.sabilulquran.or.id
       -> Keycloak staging

Internet
  -> hcis-staging.sabilulquran.or.id
       -> Caddy / edge_proxy
       -> hcis-staging-web
       -> HCIS API
            -> public Keycloak issuer over HTTPS
            -> sq-hub-api-staging:3100 over sq_platform_staging
                 -> SQ Hub staging PostgreSQL
                 -> public Keycloak JWKS over HTTPS
```

The `sq_platform_staging` Docker network is a private service-discovery boundary. The SQ Hub API also binds `127.0.0.1:18100` only for VPS-local smoke checks; it is not a public application endpoint.

The current shared YSQ staging VPS is memory-constrained. CI publishes optimized runtime images to GHCR; the VPS deployment path must use `docker compose pull` and `up --no-build` rather than building Node/Keycloak images on the server.

## 1. Create shared service network

Create once on the staging VPS:

```bash
docker network inspect sq_platform_staging >/dev/null 2>&1 \
  || docker network create sq_platform_staging
```

Do not publish this network through the reverse proxy.

## 2. Bring up SQ Identity / Keycloak

Follow `infra/keycloak/README.md` for bootstrap, normal runtime, DNS/TLS, recovery-code verification, and backup/restore rehearsal.

The canonical issuer required by both SQ Hub and HCIS is:

```text
https://login-staging.sabilulquran.or.id/realms/sq-staff-staging
```

Verify discovery before starting OIDC UAT:

```bash
curl --fail \
  https://login-staging.sabilulquran.or.id/realms/sq-staff-staging/.well-known/openid-configuration
```

## 3. Bring up SQ Hub Application Access

Prepare a VPS-only environment file:

```bash
cp infra/staging.env.example infra/.env.staging
chmod 600 infra/.env.staging
```

Replace the database password and review all non-secret staging values.

Validate configuration:

```bash
docker compose \
  --env-file infra/.env.staging \
  -f infra/docker-compose.staging.yml \
  config -q
```

Pull the prebuilt staging image and start with an isolated Compose project name:

```bash
docker compose \
  -p sq-hub-staging \
  --env-file infra/.env.staging \
  -f infra/docker-compose.staging.yml \
  pull

docker compose \
  -p sq-hub-staging \
  --env-file infra/.env.staging \
  -f infra/docker-compose.staging.yml \
  up -d --no-build
```

The API startup command applies migrations and idempotently seeds the `hcis` application registry entry.

Local smoke checks:

```bash
curl --fail http://127.0.0.1:18100/health

docker compose \
  -p sq-hub-staging \
  --env-file infra/.env.staging \
  -f infra/docker-compose.staging.yml \
  ps
```

## 4. Provision Keycloak client secrets

The accepted realm baseline contains:
- browser client `hcis-staging`;
- bearer audience `sq-hub-api-staging`;
- service client `hcis-api-staging`.

Runtime client secrets are not stored in Git. Obtain/generate the staging-only confidential client secrets through the controlled Keycloak admin path and place them only in the HCIS staging secret file.

Do not reuse production secrets.

## 5. Prepare HCIS staging

Use the HCIS repository's dedicated staging compose and env template from the HUB-IMPL-003 staging deployment change.

The HCIS staging Application Access URL is intentionally private:

```text
http://sq-hub-api-staging:3100/internal/v1/application-access/check
```

The HCIS API and SQ Hub API must both be attached to `sq_platform_staging`.

## 6. Provision synthetic identities and access

For each synthetic UAT persona:
1. create/provision the Keycloak staging identity through the accepted provisioning path;
2. obtain its exact OIDC `issuer + sub`;
3. map that pair to the intended existing HCIS staging `accounts.id`;
4. create an active SQ Hub Application Access grant for `applicationKey=hcis`;
5. verify both mappings before browser UAT;
6. record only synthetic staging identifiers in UAT evidence.

Email or NIP may help an operator locate a candidate account before this flow, but persisted binding is only `issuer + sub`.

### 6.1 Map the identity in HCIS

From the HCIS checkout, preview first:

```bash
docker compose \
  -p hcis-staging \
  --env-file infra/.env.staging \
  -f infra/docker-compose.staging.yml \
  exec -e HCIS_ALLOW_OIDC_IDENTITY_MAPPING=1 api \
  node apps/api/dist/modules/auth/cli/map-oidc-identity.js \
  --account-id <HCIS_ACCOUNT_UUID> \
  --issuer https://login-staging.sabilulquran.or.id/realms/sq-staff-staging \
  --subject <KEYCLOAK_SUB>
```

Only after verifying the preview, append `--apply`. A replacement of a different existing binding additionally requires `--replace`.

The HCIS repository contains the full mapping/unmapping procedure in `docs/migration/HUB-IMPL-003-identity-mapping-cli.md`.

### 6.2 Inspect and grant SQ Hub Application Access

From the SQ Hub checkout, inspect current access first:

```bash
docker compose \
  -p sq-hub-staging \
  --env-file infra/.env.staging \
  -f infra/docker-compose.staging.yml \
  exec api \
  node apps/api/dist/cli/access-admin.js \
  access show \
  --issuer https://login-staging.sabilulquran.or.id/realms/sq-staff-staging \
  --subject <KEYCLOAK_SUB> \
  --app hcis
```

Grant access:

```bash
docker compose \
  -p sq-hub-staging \
  --env-file infra/.env.staging \
  -f infra/docker-compose.staging.yml \
  exec api \
  node apps/api/dist/cli/access-admin.js \
  access grant \
  --issuer https://login-staging.sabilulquran.or.id/realms/sq-staff-staging \
  --subject <KEYCLOAK_SUB> \
  --app hcis \
  --reason "HUB-IMPL-003 synthetic staging UAT" \
  --actor <OPERATOR_REF> \
  --actor-kind human
```

The command records the actor, reason, target, and resulting access state in SQ Hub audit history.

### 6.3 Revoke for deny/rollback tests

To exercise the required Application Access deny case or to remove the synthetic grant after UAT:

```bash
docker compose \
  -p sq-hub-staging \
  --env-file infra/.env.staging \
  -f infra/docker-compose.staging.yml \
  exec api \
  node apps/api/dist/cli/access-admin.js \
  access revoke \
  --issuer https://login-staging.sabilulquran.or.id/realms/sq-staff-staging \
  --subject <KEYCLOAK_SUB> \
  --app hcis \
  --reason "HUB-IMPL-003 deny or cleanup rehearsal" \
  --actor <OPERATOR_REF> \
  --actor-kind human
```

Revoking HCIS Application Access must not disable the global Keycloak identity and must not remove access to unrelated applications.

## 7. Browser UAT matrix

Verify at minimum:
- ordinary Employee successful SSO;
- manager/local authorization remains unchanged after SSO;
- Human Capital administrator access;
- privileged/Super Admin MFA with TOTP and recovery path;
- non-Employee Staff behavior;
- HCIS-local suspended user denied while Keycloak identity remains enabled;
- globally disabled Keycloak identity denied;
- authenticated identity without HCIS Application Access denied;
- wrong/unknown `issuer + sub` denied;
- SQ Hub outage during new login fails closed;
- existing HCIS session continues during SQ Hub maintenance until normal expiry;
- logout revokes HCIS session and initiates SQ Identity logout;
- browser localStorage/sessionStorage contains no OIDC tokens;
- local password route is unreachable while HCIS runs in OIDC mode.

## 8. Rollback rehearsal

Rollback is configuration-first and staging-only:
1. record the current staging state and synthetic account mappings;
2. stop HCIS OIDC staging;
3. restore the isolated HCIS target to local-auth mode according to the HCIS recovery note;
4. verify local login and existing authorization behavior;
5. keep OIDC identity mapping columns intact during the rollback window;
6. restore OIDC staging and repeat a successful synthetic SSO.

Do not repoint the production HCIS hostname or production database during this rehearsal.

## Evidence to record

A staging rehearsal is not complete until evidence includes:
- deployed commit SHAs for SQ Hub and HCIS;
- Keycloak image/realm version used;
- DNS/TLS checks for both staging hostnames;
- SQ Hub and HCIS container health;
- migration output;
- synthetic persona matrix results;
- MFA/recovery-code result;
- Application Access deny/outage results;
- logout and browser-storage checks;
- rollback and restore result.
