# HUB-IMPL-016 — SQ Hub production launcher runbook

**Status:** SOURCE-OF-TRUTH CLOSURE  
**Repository-ready state:** determined by reviewed PR + green CI  
**Production deployed state:** OPERATOR-VERIFIED on 2026-09-18; not re-verified by this PR  
**Browser verified state:** OPERATOR-VERIFIED on 2026-09-18; not re-verified by this PR  
**Target:** `https://hub.sabilulquran.or.id`

This runbook is the operator handoff for launching the already-implemented SQ Hub authenticated workspace. It deliberately separates repository evidence, VPS/runtime work, DNS/Cloudflare work, and browser UAT.

The existence of this file, a merged PR, or green CI may establish **REPOSITORY_READY** only. The **DEPLOYED** and **BROWSER_VERIFIED** statements below are carried from explicit operator evidence dated 18 September 2026; this GitHub task did not access production and must not be cited as independent runtime verification.

## Scope boundary

This launch may:

- reconcile only the production SQ Hub browser OIDC client `sq-hub`;
- deploy/reconfigure SQ Hub API and web using reviewed immutable images;
- when explicitly selected, roll only the reviewed Akun SQ/Keycloak image on the existing production Keycloak Compose service without changing realm data/configuration;
- add the production Hub Caddy route;
- add DNS/Cloudflare for `hub.sabilulquran.or.id`;
- run health and browser UAT.

This launch must not:

- replace Keycloak database/configuration, change Keycloak major/minor version, or mutate realm behavior merely as a side effect of image rollout;
- recreate/modify HCIS;
- create, recreate, migrate, or replace databases owned by other services;
- alter production realm issuer/key;
- alter HCIS clients/mappers/audience;
- alter trusted-device flow, Google provider, MFA, or login theme;
- change the already operator-verified production `accountTheme=sq-hub` or `loginTheme=sq-hub` except through an explicit future change;
- add provisioning/offboarding, Organizational Unit, external identity, universal Person Registry, or domain permissions;
- copy runtime secrets into Git, terminal transcripts, tickets, or chat.

Production operator evidence dated 18 September 2026 states that both login and Account Console themes are already `sq-hub`, the realm display name is **Akun SQ**, the permanent master-realm administrator is `admin@sabilulquran.or.id`, and bootstrap account `cutover-bootstrap` is disabled. These are operator attestations, not observations made by this PR.

## Evidence rules

Allowed evidence:

- repository/source SHA;
- immutable image name + digest;
- sanitized Compose/Caddy validation result;
- service/container name and health status;
- HTTP status;
- exact public issuer URL;
- exact non-secret OIDC client settings;
- DNS resolution result;
- redacted synthetic persona handle;
- timestamp;
- PASS/FAIL/ROLLBACK markers.

Never record:

- client secret;
- password;
- OTP/TOTP value or seed;
- recovery code;
- access token, refresh token, ID token;
- authorization code;
- cookie value;
- raw OIDC `sub`;
- employee/production personal data;
- full environment files;
- raw database rows/dumps.

## Phase 0 — repository gate

Owner: GitHub reviewer / release owner.

Required before live work:

1. PR for HUB-IMPL-016 is reviewed and merged.
2. Main CI is green.
3. Hub Production Launcher Contract is green.
4. Existing application typecheck, lint, tests, builds, Compose validation, and browser-storage guard are green.
5. Record the exact merged source SHA.
6. Publish/resolve approved component images. The GitHub deployment workflow resolves the latest source commit independently for API, web, and identity, pulls the corresponding exact-SHA GHCR tag, then converts it to an immutable **digest** before writing production runtime state:
   - `ghcr.io/sabilulquran/sq-hub-api@sha256:<64hex>`;
   - `ghcr.io/sabilulquran/sq-hub-web@sha256:<64hex>`;
   - `ghcr.io/sabilulquran/sq-hub-keycloak@sha256:<64hex>` when identity scope is selected.
7. Confirm actual production runtime references are immutable digests, never `latest`, `main`, `staging`, or a moving SHA tag.

Safe evidence:

```text
REPOSITORY_READY source=<sha>
API_IMAGE_DIGEST=<image@sha256:...>
WEB_IMAGE_DIGEST=<image@sha256:...>
```

Do not proceed if CI is red or an image digest cannot be resolved.

## Phase 0A — GitHub Actions deployment path

The preferred repeatable rollout path is **Actions → Deploy SQ Hub Production** (`.github/workflows/deploy-production.yml`).

### One-time protected configuration

Configure the GitHub Environment **production** with reviewer protection and only these connection secrets:

- `SQ_HUB_PROD_HOST` — production VPS hostname/IP;
- `SQ_HUB_PROD_USER` — SSH deployment user; current operator-verified user path supports non-interactive sudo;
- `SQ_HUB_PROD_SSH_PRIVATE_KEY`;
- `SQ_HUB_PROD_SSH_KNOWN_HOSTS`.

Production runtime paths are not secret and are fixed by the verified topology:

- runtime directory: `/var/www/sq-hub-production`;
- Hub Compose: `/var/www/sq-hub-production/compose.hub.json`;
- identity Compose: `/var/www/sq-hub-production/compose.identity.json`;
- Hub project/services: `sq-hub-production` → `postgres`, `api`, `web`;
- identity project/services: `sq-hub-keycloak-production` → `keycloak-db`, `keycloak`.

The runtime directory is root-owned and intentionally not readable as an ordinary SSH checkout. The workflow therefore does not require or assume a Git working tree on the VPS. It verifies `sudo -n`, validates the exact Compose service sets and running-container ownership labels, and uses sudo only for the root-owned runtime bundle and Docker operations.

GitHub stores no production application env, Keycloak env, database credential, OIDC secret, SMTP secret, or Compose content.

### Dispatch

Provide:

- `target_sha` — exact current 40-character `main` SHA;
- `scope` — `auto`, `hub`, `api`, `web`, `identity`, or `all`;
- `confirmation=DEPLOY_PRODUCTION`;
- `backup_confirmation=BACKUP_VERIFIED`.

`BACKUP_VERIFIED` is an operator attestation that the approved database/runtime backup or snapshot required for the selected change exists. The workflow does not fabricate backup evidence.

### Component-aware image resolution

The workflow intentionally does not assume the latest documentation commit has fresh images. It resolves:

- API source SHA from the latest target-main change touching `apps/api` or root Node lock/package files;
- web source SHA from the latest target-main change touching `apps/web` or root Node lock/package files;
- identity source SHA from the latest target-main change touching `infra/keycloak`.

The existing publishers provide exact `sha-<source-sha>` images. Production deployment pulls those tags, resolves `@sha256:` digests, compares the desired image ID with the running container, and recreates only changed services. A docs-only release is therefore a runtime no-op.

When the API image changes, the launcher runs the migration runner from the **target API image** against the existing production database before recreating the API container. Migrations remain checksum-protected and idempotent; a migration failure stops rollout before the new API becomes the running service. The mandatory backup gate remains the rollback boundary for database changes.

For recreated API/web services, the automated workflow verifies readiness **inside the recreated container** using the service-local health endpoint. It intentionally does not require host loopback ports `18200`/`18201`, because those are optional runtime conveniences rather than a stable invariant of the root-owned production bundle. Public `https://hub.sabilulquran.or.id/healthz` is still verified before PASS.

### Failure and rollback

During a run, the workflow creates root-owned `.before-gha-<timestamp>` copies of the two production Compose JSON files and keeps previous container images local. It atomically changes only the image field for a selected service. If a recreated service or public health check fails, it restores the previous Compose file(s) and attempts image/config rollback for only services already recreated.

This rollback never performs a destructive database rollback. A failed rollback attempt remains an incident requiring operator intervention.

The manual Phase 1+ sequence below remains the fallback path when GitHub Actions is unavailable or the production runtime has not yet been reconciled to the automation prerequisites.

## Phase 1 — VPS preflight and backup/snapshot

Owner: Codex local / production operator.

No mutation until the current production topology is inventoried.

### 1.0 Operator-verified runtime bundle — 2026-09-19

Current production evidence supplied by the operator:

- `/var/www/sq-hub-production` is a root-owned runtime bundle, **not** a Git checkout;
- directory mode is `700`;
- `compose.hub.json` is root-owned and defines exactly `postgres` + `api` + `web`; `postgres` is existing runtime infrastructure and is never recreated by the GitHub deployment workflow;
- `compose.identity.json` is root-owned and defines exactly `keycloak-db` + `keycloak`;
- running API/web containers report Compose project `sq-hub-production` and config file `/var/www/sq-hub-production/compose.hub.json`;
- running Keycloak reports project `sq-hub-keycloak-production` and config file `/var/www/sq-hub-production/compose.identity.json`;
- the deployment SSH user can execute `sudo -n` successfully.

Automation must preserve this ownership model rather than making the runtime directory readable/writable to the ordinary SSH user.

### 1.1 Record current SQ Hub ownership

Read-only inspect:

- current SQ Hub API container/service;
- current SQ Hub API immutable image;
- current Compose project/config path if managed by Compose;
- current SQ Hub database host/service **name only**, not credentials;
- Docker networks attached to the API;
- current loopback port, if any;
- available memory/disk;
- current Caddy configuration backup location.

The repository intentionally does not guess the existing production network or database hostname. Set `SQ_HUB_PRODUCTION_NETWORK`, `DATABASE_URL`, machine-token values, and identity-directory values from the **existing approved production configuration**, not from staging examples.

The production topology is now explicit and reproducible:

- Compose project/name is `sq-hub-production`;
- API and web share private network `sq-hub-production_backend`;
- web additionally joins `sq-hub-production_web_edge`;
- containerized Caddy joins `sq-hub-production_web_edge`;
- Caddy targets unique DNS alias `sq-hub-production-web:80`;
- web must **not** join shared `edge_proxy`;
- the generic nginx upstream `api:3100` exists only on `sq-hub-production_backend`.

The loopback web port remains useful for host-local smoke checks only. A Caddy container must never use `127.0.0.1:18201` because that address refers to the Caddy container itself, not the Hub web container.

If the current API is managed by a different Compose project/topology than `infra/docker-compose.production.yml`, stop and reconcile that ownership before using the new Compose file. Do not start a duplicate production API.

### 1.2 Snapshot before change

Required order:

1. capture a dated copy/checksum of the current SQ Hub runtime configuration without printing its secret values;
2. create/verify the approved SQ Hub database backup/snapshot using the existing production backup procedure;
3. record current API image digest/reference;
4. record current Caddy config checksum/copy;
5. confirm rollback can restore the current API/web image/config;
6. confirm the current image(s) remain locally available or pullable by immutable digest.

Safe evidence:

```text
HUB_PRODUCTION_PREFLIGHT_PASS
HUB_DB_BACKUP_REF=<redacted-safe-id>
PREVIOUS_API_IMAGE=<immutable-ref>
CADDY_BACKUP_REF=<safe-path-or-checksum>
```

A backup file existing is not proof of successful restore. Do not claim restore-tested unless it was actually restored in an approved isolated target.

## Phase 2 — prepare production env without leaking secrets

Owner: production operator / secret custodian.

Use `infra/production.env.example` only as a key/shape template. Create VPS-only `infra/.env.production` (or the approved canonical runtime path), owner-readable only.

Required values must come from existing production state or the explicit HUB-IMPL-016 contract:

- existing production `DATABASE_URL`;
- existing production machine-token audience and allowlist;
- exact new `sq-hub` client secret after Phase 3;
- existing production identity-directory URL/client/secret;
- exact API/web image digests;
- existing production integration network;
- reviewed memory limits.

Production-fixed values are already hard-coded in Compose:

- HCIS URL `https://hcis.sabilulquran.or.id`;
- issuer `https://login.sabilulquran.or.id/realms/sq-staff`;
- client ID `sq-hub`;
- callback `https://hub.sabilulquran.or.id/auth/callback`;
- logout redirect `https://hub.sabilulquran.or.id/`;
- secure cookie `true`.

Before mutation, render configuration only:

```bash
docker compose   --env-file infra/.env.production   -f infra/docker-compose.production.yml   config -q
```

Never run `docker compose config` without `-q` in shared evidence because rendered output may contain interpolated secrets.

## Phase 3 — provision/reconcile OIDC client and secret safely

Owner: authorized Keycloak production operator.

Preconditions:

- exact realm is `sq-staff`;
- operator has an approved authenticated `kcadm` configuration or equivalent Admin Console/API session;
- no staging admin context is reused;
- backup/change record is active.

The desired non-secret client shape is:

`infra/keycloak/clients/sq-hub-production.json`

The guarded reconciliation helper:

`infra/keycloak/scripts/reconcile-hub-production-client.sh`

It must be executed only from an authorized production administration context. It:

- refuses a realm other than exact `sq-staff`;
- queries exact client ID `sq-hub`;
- creates it if absent or reconciles it if unique;
- contains no secret;
- verifies exact callback/origin/PKCE/flow settings;
- outputs only sanitized PASS markers;
- stops at `HUB_PRODUCTION_CLIENT_SECRET_HANDOFF_REQUIRED`.

### Secret custody and reconciliation

After non-secret settings converge:

1. obtain or rotate the `sq-hub` client secret through the approved Keycloak/secret-management path;
2. put it directly into the production runtime secret/env store;
3. do not echo it;
4. do not paste it into GitHub/chat/change evidence;
5. do not save it in the repository desired-state file;
6. **force-recreate the API container** after any client-secret change; an env-file edit alone does not update an already-running container;
7. run `infra/keycloak/scripts/verify-hub-production-secret-fingerprint.sh` to compare truncated SHA-256 fingerprints for the Keycloak client secret, the production env/secret file value, and the running API container environment;
8. proceed only when all three fingerprints match.

The verifier prints fingerprints only and never prints the secret value. A mismatch means the API is stale or custody is inconsistent and login must be treated as not ready.

Safe evidence:

```text
HUB_PRODUCTION_CLIENT_CONFIGURATION_PASS action=<created|updated> realm=sq-staff client=sq-hub
HUB_PRODUCTION_CLIENT_SECRET_HANDOFF_COMPLETE
```

The second marker is a custodian attestation only; it must contain no value.

## Phase 4 — deploy SQ Hub API

Owner: production operator.

Why API first: the web launcher depends on the API for OIDC callback, session creation, workspace, logout, and Admin Center APIs.

Before recreating API:

1. verify exact target API digest is already reviewed;
2. verify the current API rollback image/config;
3. verify the existing SQ Hub database and production integration network are not defined as owned services by this launcher Compose;
4. verify `docker compose ... config -q` succeeds;
5. confirm the command targets only `api`.

Deployment shape:

```bash
docker compose   --env-file infra/.env.production   -f infra/docker-compose.production.yml   up -d --no-deps --no-build --pull never --force-recreate api
```

Use `docker pull <exact-image@sha256:...>` beforehand if the digest is not local.

Do **not** run unqualified `docker compose up -d`.

API acceptance before web:

- container health is healthy;
- container-local `/health` returns success; if the current runtime explicitly publishes the optional loopback smoke port, that host-local check may be recorded as additional evidence;
- running image equals the recorded digest;
- existing database service/container was not recreated by this action;
- Keycloak and HCIS were not part of this Compose operation.

If API fails, go directly to rollback; do not continue to web/Caddy/DNS.

## Phase 5 — deploy SQ Hub web

Owner: production operator.

The web container is the only public application upstream.

```bash
docker compose   --env-file infra/.env.production   -f infra/docker-compose.production.yml   up -d --no-deps --no-build --pull never --force-recreate web
```

Required local checks before edge change:

- web container healthy;
- container-local `/healthz` succeeds; an optional host loopback check may be used only when that runtime actually publishes the smoke port;
- API remains healthy;
- exact callback path sent through the web boundary does not return SPA `index.html`;
- running web image equals the target digest.

Do not publish container port 80 or API 3100 directly to the internet.

## Phase 6 — Caddy edge

Owner: production edge operator.

Use `infra/reverse-proxy.caddy.production.example` as the reviewed route shape and adapt only to the existing Caddy file organization.

Rules:

- Caddy owns TLS;
- Caddy joins `sq-hub-production_web_edge`;
- upstream is exactly `sq-hub-production-web:80`;
- do not use `127.0.0.1:18201` from containerized Caddy;
- do not attach Hub web to shared `edge_proxy`;
- `/healthz`, exact `/auth/callback`, and `/api/*` are explicit;
- no public upstream points to API port `18200`;
- no DB port is exposed;
- do not modify login/HCIS routes as part of this change.

Required sequence:

1. back up current Caddy config;
2. add only the Hub site block;
3. validate Caddy configuration;
4. reload Caddy;
5. verify existing Akun SQ and HCIS hosts remain healthy.

Do not change DNS until Caddy validation/reload succeeds.

## Phase 7 — DNS / Cloudflare

Owner: DNS/Cloudflare operator.

Create the production record for:

`hub.sabilulquran.or.id`

It must target the existing approved production edge. Follow the current organization policy for proxying/TLS; do not copy a staging record blindly.

Record only:

- record type;
- hostname;
- redacted/expected public target if operationally safe;
- DNS resolver result;
- timestamp.

Do not record Cloudflare API tokens or account credentials.

## Phase 8 — public health and protocol smoke

Owner: production operator.

After DNS resolves:

1. `https://hub.sabilulquran.or.id/healthz` returns 200;
2. `https://login.sabilulquran.or.id/realms/sq-staff/.well-known/openid-configuration` returns exact issuer `https://login.sabilulquran.or.id/realms/sq-staff`;
3. anonymous Hub navigation redirects into Akun SQ authorization flow for client `sq-hub`;
4. callback registration is exact `https://hub.sabilulquran.or.id/auth/callback`;
5. no direct public API/database port is reachable by design;
6. HCIS and Akun SQ public health remain unchanged.

Health success permits moving to browser UAT. It does not establish **BROWSER_VERIFIED**.

## Phase 9 — browser UAT

Owner: product owner / approved tester.

Use only approved synthetic production persona(s). Existing accepted staging UAT remains valid evidence for unchanged behavior and is not deleted or relabeled. Production launch still needs a small production delta proving the new hostname/client/edge path.

Minimum production launcher delta:

- anonymous `https://hub.sabilulquran.or.id/` enters Akun SQ;
- synthetic Staff login returns to the Hub;
- user identity presentation is correct and contains no raw OIDC subject;
- only applications with active Application Access appear;
- HCIS launcher opens the canonical production HCIS URL;
- if the persona is an authorized Platform Administrator with accepted prerequisites, Administrasi SQ remains server-authorized; ordinary Staff must not gain admin access;
- Hub logout clears the Hub session and continues through Akun SQ logout;
- same-browser revisit after completed logout requires authentication;
- desktop and approximately 390x844 mobile launcher remain usable;
- browser localStorage/sessionStorage inspection shows no access token, refresh token, ID token, authorization code, state, nonce, or PKCE verifier;
- Hub session cookie metadata shows host-only, HttpOnly, Secure, SameSite=Lax, Path=/; record attributes only, never value.

Do not mutate production Application Access solely to repeat the already-accepted staging revoke/restore scenario unless a separate approved test explicitly requires it.

If all required launch delta checks pass, record:

```text
DEPLOYED
BROWSER_VERIFIED
```

with timestamp and redacted persona handle.

## Phase 10 — rollback

Rollback is a deliberate operator action, not an automatic auth fallback.

Trigger rollback for:

- API/web cannot become healthy;
- OIDC callback/login fails because of launcher configuration;
- wrong issuer/client/redirect is observed;
- unexpected authorization exposure;
- Hub edge change disrupts existing services;
- security-relevant browser finding such as token persistence or incorrect cookie scope.

Rollback order:

1. disable/remove the Hub DNS record if public exposure itself is unsafe;
2. restore previous Caddy configuration and reload;
3. restore previous web image/config or remove the newly introduced web service if no previous production web existed;
4. restore previous API image/config if the API was changed;
5. verify previous SQ Hub API health;
6. verify Akun SQ and HCIS health;
7. retain the production `sq-hub` client disabled or remove it only if the change owner explicitly decides that is the safe rollback state; do not alter other clients;
8. do **not** destructively roll back database migrations as part of routine image rollback.

Record:

```text
HUB_PRODUCTION_ROLLBACK_BEGIN
HUB_PRODUCTION_ROLLBACK_PASS
```

or escalate if rollback verification fails.

## Operator-verified production evidence — 2026-09-18

The following facts were supplied by the production operator after successful live verification. They are intentionally recorded separately from repository/CI evidence:

- `https://hub.sabilulquran.or.id` served TLS-valid HTTP 200;
- DNS A resolved to `103.89.5.4` as DNS-only;
- production client `sq-hub` was active in realm `sq-staff`;
- callback was exactly `https://hub.sabilulquran.or.id/auth/callback`;
- post-logout redirect was exactly `https://hub.sabilulquran.or.id/`;
- Authorization Code + PKCE S256 succeeded;
- OIDC transaction cookie attributes included Secure, HttpOnly, SameSite=Lax;
- production browser reached the user workspace, HCIS Application Access, and Administrasi SQ;
- API, web, and Keycloak were healthy with restart count 0;
- public Admin Console returned HTTP 404;
- permanent master-realm administrator was `admin@sabilulquran.or.id`;
- bootstrap account `cutover-bootstrap` was disabled;
- production realm display name was **Akun SQ**;
- production login and Account Console themes were `sq-hub`;
- Keycloak client secret and VPS secret file matched; an earlier `invalid_client_credentials` incident was resolved only after the API container was force-recreated from the current env file;
- Caddy was containerized on `edge_proxy`, while Hub web remained on `sq-hub-production_backend` and `sq-hub-production_web_edge`; Caddy joined the Hub web-edge network and targeted the unique Hub web container DNS name;
- attaching Hub web to shared `edge_proxy` caused an `api` alias collision and login 502, so that topology is explicitly forbidden;
- no destructive database migration/change was performed.

Repository/CI evidence does not independently re-prove any item in this list.

## Master realm SMTP / Forgot Password preparation

Repository source includes:

- `infra/keycloak/realm/master-production-recovery.json` for non-secret master-realm Akun SQ branding, `sq-hub` login/account themes, and `resetPasswordAllowed=true`;
- `infra/keycloak/master-smtp.env.example` for the non-secret SMTP configuration shape;
- `infra/keycloak/scripts/reconcile-master-production-recovery.sh` for guarded operator reconciliation of the master realm only.

The reconciliation script consumes SMTP credentials only from the controlled runtime file, does not print them, and emits sanitized PASS markers. It does not prove delivery. Do not claim email recovery is operational until an authorized operator supplies SMTP credentials/configuration in the production secret store and successfully verifies an actual Forgot Password email. Keycloak Admin Console remains an internal operator surface; this package does not fork or redesign Admin Console.

## Final status record

Use three independent lines:

| State | Allowed value | Evidence |
| --- | --- | --- |
| Repository | `REPOSITORY_READY` / `NOT_READY` | merged SHA + CI |
| Runtime | `DEPLOYED` | operator evidence dated 2026-09-18; not independently re-verified by GitHub |
| Browser | `BROWSER_VERIFIED` | operator browser evidence dated 2026-09-18; not independently re-verified by GitHub |

Never infer one row from another.
