# HUB-IMPL-016 — SQ Hub production launcher release package

**Status:** ACCEPTED  
**Date:** 2026-09-18  
**Product capabilities:** HUB-FND-006 Hub Launcher, HUB-FND-005 Application Access administration  
**Promotes:** HUB-IMPL-004, HUB-IMPL-005, HUB-IMPL-007, HUB-IMPL-009  
**Environment:** production  
**Execution:** repository preparation plus an operator-authorized GitHub Actions deployment path; PR merge alone never mutates production

## Objective

Provide one explicit, reviewable repository path for launching the existing SQ Hub authenticated workspace and Admin Center at `https://hub.sabilulquran.or.id` without inventing new identity, authorization, or domain behavior.

This specification authorizes the repository artifacts needed for a production launcher release and a manually dispatched, production-environment-gated GitHub Actions workflow that can roll reviewed images to the existing production VPS. Creating or merging a PR does **not** itself authorize or trigger production mutation. A live run still requires the explicit `workflow_dispatch` confirmation, GitHub `production` environment approval, production backup attestation, and configured SSH/runtime secrets. Repository readiness never converts itself into deployment or browser acceptance.

## Existing behavior promoted unchanged

Production uses the already accepted behavior from HUB-IMPL-005/007/009:

- internal Staff workspace only;
- server-side OIDC Authorization Code flow through `openid-client`;
- PKCE S256, state, and nonce handled server-side;
- opaque server-side Hub session;
- workspace visibility derived from active SQ Hub Application Access;
- Platform Administrator and Admin Center authorization remain SQ Hub-owned and server-side;
- domain roles/permissions remain owned by each domain application;
- logout revokes the Hub session and continues through Akun SQ;
- no custom OAuth/OIDC implementation;
- no browser bearer-token storage.

No provisioning/offboarding, Organizational Unit, universal Person Registry, external identity, or domain business logic is added by this production promotion.

## Production OIDC relying-party contract

The production browser client is distinct from staging.

| Setting | Production value |
| --- | --- |
| Issuer | `https://login.sabilulquran.or.id/realms/sq-staff` |
| Hub origin | `https://hub.sabilulquran.or.id` |
| Client ID | `sq-hub` |
| Client type | confidential |
| Standard flow | enabled |
| Authorization Code | enabled through the standard OIDC client library |
| PKCE | `S256` |
| Implicit flow | disabled |
| Direct access grants | disabled |
| Service account | disabled |
| Redirect URI | `https://hub.sabilulquran.or.id/auth/callback` |
| Web origin | `https://hub.sabilulquran.or.id` |
| Post-logout redirect | `https://hub.sabilulquran.or.id/` |
| Scopes | `openid profile` |

The client secret is runtime secret material. It must not be committed, printed into evidence, copied into browser configuration, or placed in the desired-state JSON.

The production client reconciliation must target realm `sq-staff` only. It must not mutate `sq-staff-staging`, HCIS clients, HCIS mappers/audience, trusted-device flow, Google provider, MFA, realm issuer/key, login theme, or Account Console theme.

## Session and browser contract

Both the OIDC transaction cookie and the Hub application-session cookie are:

- host-only: no `Domain` attribute;
- `HttpOnly`;
- `Secure`;
- `SameSite=Lax`;
- `Path=/`.

Hub session limits remain idle 8 hours and absolute 12 hours. OIDC transaction TTL remains 10 minutes.

The browser must not persist any of the following in `localStorage`, `sessionStorage`, IndexedDB, application-managed browser cache, or other browser-managed bearer-token stores:

- access token;
- refresh token;
- ID token;
- authorization code;
- OIDC state;
- OIDC nonce;
- PKCE verifier;
- client secret.

The browser receives only opaque Hub cookies and browser-facing workspace/admin data already allowed by the accepted contracts.

## Production runtime boundary

The launcher release owns only SQ Hub API/web runtime changes required to expose the existing Hub workspace.

Repository production Compose:

- contains SQ Hub API and web services only;
- does not define, create, recreate, or upgrade Keycloak, HCIS, or any unrelated database/service;
- references the existing SQ Hub production database through `DATABASE_URL`;
- joins only the operator-declared existing production network required by the current SQ Hub API integration;
- publishes API and web smoke ports on loopback only;
- makes the web container the public edge target;
- never exposes a database port;
- uses immutable organization-owned API/web image **digests**, not `latest`, `staging`, or moving SHA tags;
- makes web readiness depend on API health;
- retains the existing additive migration/seed startup path for the API.

The operator must reconcile the current production API/database topology before applying Compose. The operator-verified runtime bundle currently includes an existing `postgres` service alongside `api` and `web`; that database service is runtime infrastructure, not a deployment target. A launcher release must never recreate, replace, or mutate the already-running SQ Hub database merely to deploy API/web.

## Reverse-proxy boundary

TLS remains the responsibility of the existing containerized Caddy edge.

For `hub.sabilulquran.or.id`:

- Caddy joins the dedicated external-facing Hub web network `sq-hub-production_web_edge`;
- Caddy targets the unique Hub web DNS alias `sq-hub-production-web:80`;
- Caddy must not target `127.0.0.1:18201` or any other loopback address from inside its own container;
- the Hub web service stays on `sq-hub-production_backend` and `sq-hub-production_web_edge` only;
- the Hub web service must not join the shared `edge_proxy` network, because its nginx upstream name `api` must remain isolated from generic aliases owned by unrelated applications;
- exact `/auth/callback` reaches the web reverse proxy and is then proxied server-side to the Hub API;
- `/api/*` reaches the web reverse proxy and is then proxied server-side to the Hub API;
- `/healthz` is an explicit web health route;
- static/SPA routes remain web-owned;
- the internal API port and database are not published to the internet.

The existing `apps/web/nginx.conf` remains the application boundary that prevents the OIDC callback from falling through to the SPA.

## Production configuration separation

Production runtime configuration must be supplied from a production-only, Git-ignored env file. Production configuration must not inherit staging defaults for:

- realm/issuer;
- Hub client ID;
- redirect/logout origins;
- HCIS canonical URL;
- machine-token audience/client allowlist;
- identity-directory realm/client;
- Docker network names;
- images.

Secret-bearing values remain secret-store/VPS values only. Repository examples contain placeholders, never live credentials.

## OIDC client desired state

`infra/keycloak/clients/sq-hub-production.json` is the non-secret desired state for the single production Hub browser client.

Operator reconciliation rules:

1. authenticate through the approved production Keycloak administration path;
2. select exact realm `sq-staff`;
3. query exact client ID `sq-hub`;
4. create it if absent, or update only the fields represented by the desired-state artifact if exactly one client exists;
5. fail closed if the client is ambiguous or the realm is not exact;
6. verify the resulting non-secret settings;
7. stop before printing or persisting the client secret;
8. create/reset/retrieve the secret only through the approved secret-custody path and inject it into the Hub runtime separately.

Repeated reconciliation of the represented non-secret settings must converge to the same state without changing unrelated clients or realm settings.

## GitHub Actions production deployment contract

The canonical automated path is `.github/workflows/deploy-production.yml`.

The workflow must:

- run only through `workflow_dispatch`;
- require an exact 40-character SHA that equals current `origin/main`;
- require the literal confirmations `DEPLOY_PRODUCTION` and `BACKUP_VERIFIED`;
- run behind GitHub Environment `production`;
- use only SSH connection material from GitHub Environment secrets; production runtime paths are explicit verified source-of-truth paths, not secret values;
- target the operator-verified root-owned runtime bundle at `/var/www/sq-hub-production`, using `compose.hub.json` whose exact service set is `api`, `postgres`, `web`, and `compose.identity.json` for Keycloak;
- require the SSH deployment user to pass `sudo -n true`; file and Compose mutation is performed only through non-interactive sudo;
- resolve API, web, and Akun SQ/Keycloak source SHAs independently from the requested main SHA;
- pull only organization-owned exact-SHA GHCR tags, then resolve and persist immutable `@sha256:` digests for production;
- compare desired image IDs with the currently running containers and make documentation-only releases a runtime no-op;
- deploy API, web, and identity as independent scopes; an unqualified whole-stack `docker compose up` is forbidden;
- preserve the existing production Compose JSON files through root-owned rollback copies before mutation;
- mutate only the `services.api.image`, `services.web.image`, and `services.keycloak.image` JSON fields; all environment, network, command, volume, database, and proxy settings remain untouched;
- fail closed when non-interactive sudo is unavailable, the verified runtime bundle/files or expected service/project labels do not match, component images are absent, Compose validation fails, or public health checks fail;
- automatically attempt image/config rollback for services recreated during a failed run without destructively rolling back databases;
- verify recreated API/web readiness from inside the actual containers, then verify Hub public health, exact production OIDC issuer discovery, and HCIS public reachability before reporting PASS;
- logout the production VPS from GHCR when the workflow finishes.

The workflow intentionally derives component SHAs instead of assuming every `main` commit has three newly built images. The API/web/Keycloak publisher workflows already produce immutable `sha-<component-source-sha>` tags when their respective source paths change. A documentation-only merge therefore advances repository source of truth without manufacturing or redeploying identical runtime images.

Identity image rollout targets only the existing root-owned `/var/www/sq-hub-production/compose.identity.json` service `keycloak` in Compose project `sq-hub-keycloak-production`. The workflow changes only its image field and recreates only `keycloak`; `keycloak-db` is never recreated by this path. It does not reconcile realm settings, Google credentials, SMTP credentials, users, roles, Application Access, or domain authorization.

## Deployment and rollback contract

The operator runbook must keep these phases distinct:

1. repository/CI readiness;
2. VPS/runtime preflight and backup/snapshot;
3. production Hub client reconciliation and secret custody;
4. API deployment;
5. web deployment;
6. Caddy route;
7. DNS/Cloudflare;
8. health/smoke;
9. browser UAT;
10. rollback when required.

API/web deployment is service-scoped. Do not run an unqualified `docker compose up` for this launch.

Rollback restores the previously recorded API/web image/configuration. Database migration rollback is not implicit; do not destructively roll back the SQ Hub database as part of routine image rollback.

## Evidence vocabulary

The release record must distinguish:

- **REPOSITORY_READY** — reviewed source/configuration/CI exists;
- **DEPLOYED** — operator evidence proves runtime API/web/edge/DNS state;
- **BROWSER_VERIFIED** — browser UAT actually ran against production.

`REPOSITORY_READY` alone must never be reported as `DEPLOYED` or `BROWSER_VERIFIED`.

Safe evidence may record source SHA, immutable image digest, service name, health result, HTTP status, DNS result, sanitized client settings, timestamp, and PASS/FAIL markers.

Never record passwords, OTPs, recovery codes, client secrets, access/refresh/ID tokens, authorization codes, cookie values, raw OIDC `sub`, or employee data.

## Akun SQ production account and recovery boundary

Akun SQ is the user-facing account/login product name; SQ Hub remains the application portal.

Production operator evidence dated 18 September 2026 establishes that the `sq-staff` realm display name is **Akun SQ** and both `loginTheme` and `accountTheme` are `sq-hub`. Repository source must preserve that state and use the existing Sabilul Qur'an organization mark/favicon rather than a generic logo.

The public Keycloak Admin Console remains blocked and is an internal operator surface. The master-realm login should use Akun SQ branding, but this specification does not authorize a custom Admin Console fork.

Repository source may prepare non-secret master-realm Forgot Password and SMTP configuration. Recovery email is not considered active until an authorized operator injects SMTP credentials and verifies real delivery.

## Acceptance criteria for this GitHub task

1. Production and staging Hub OIDC clients are explicit and distinct: `sq-hub` vs `sq-hub-staging`.
2. Production issuer/origin/redirect/logout values are exact and contract-tested.
3. Repository production Compose keeps database ownership external, while the operator-verified runtime bundle may retain its existing `postgres` service; deployment automation must mutate/recreate only `api` and `web`, never `postgres`.
4. API/web host ports bind to loopback; no database port is exposed.
5. Reverse-proxy example keeps callback/API server-side and routes the public host only to the web boundary.
6. Desired production OIDC client state contains no secret and disables implicit/direct grant/service-account flows.
7. Production env verification fails closed on staging values, placeholders, insecure cookie settings, or mutable images.
8. Browser token-storage prohibition remains covered across runtime web source.
9. CI runs production contract checks in addition to the existing typecheck, lint, test, and build gates.
10. Operations documentation separates repository readiness, deployment, browser verification, and rollback.
11. Contract checks reject shared-edge API alias collision, containerized-Caddy loopback upstreams, stale API secret state after rotation, and wrong production callback/logout URLs.
12. Akun SQ account/login/account-console source uses the approved organization logo/favicon and contains no active legacy identity-product branding.
13. Non-secret master-realm branding/Forgot Password/SMTP shape exists without credentials and without claiming recovery delivery is active.
14. Existing accepted staging UAT evidence is retained unchanged.
15. No production runtime, DNS, Keycloak, HCIS, database, or secret is changed by the PR itself.
16. A guarded manual GitHub Actions deployment workflow validates exact current-main SHA, production approval, backup attestation, component-specific immutable images, service-scoped recreation, public health, and rollback behavior.
17. Documentation-only main changes resolve to the existing component image SHAs and do not force API/web/Keycloak recreation.
18. Production automation matches the operator-verified root-owned runtime bundle `/var/www/sq-hub-production`; it does not require a Git checkout or production env file to be readable by the SSH user.
19. Runtime mutation is limited to image fields in `compose.hub.json` and `compose.identity.json`, with root-owned backup copies created before deployment; the existing `postgres` and `keycloak-db` services are never deployment targets.

## Non-goals

- redesigning Akun SQ login or Account Console;
- activating the production Account Console theme;
- Staff provisioning/offboarding;
- Organizational Unit;
- external identity or public portal;
- universal Person Registry;
- HCIS/SPMB/Finance business logic;
- universal Keycloak roles/permissions;
- automatic production execution on merge/push without explicit workflow dispatch and production approval.
