# HUB-IMPL-001 — Keycloak Staging Foundation

**Status:** ACCEPTED
**Product:** SQ Hub
**Area:** SQ Identity
**Depends on:** ADR-0003, `docs/security/staff-authentication-policy.md`, `docs/operations/operational-baseline.md`

## Outcome
Menjalankan SQ Identity staging yang cukup production-like untuk menguji HCIS OIDC integration tanpa menyentuh production authentication.

## Staging naming
Use simple sibling hostnames under the existing DNS zone:
- `login-staging.sabilulquran.or.id` — public SQ Identity staging frontend/OIDC endpoints;
- `hub-staging.sabilulquran.or.id` — reserved for SQ Hub staging consumer/API surface when exposed;
- `hcis-staging.sabilulquran.or.id` — HCIS staging consumer.

Do not require nested `*.staging.sabilulquran.or.id` naming in Wave 1.

## Runtime baseline
- Keycloak 26.7.2 is the initial validation candidate; exact production pin remains separate from this staging result.
- Run Keycloak in production mode semantics, not `start-dev`, for shared staging.
- HTTPS is terminated/configured according to supported reverse-proxy production guidance.
- Keycloak public frontend uses the explicit staging hostname.
- Admin Console/Admin REST is not intentionally exposed as an unrestricted public internet surface. Prefer localhost/SSH tunnel or tightly restricted administrative ingress.
- Health/management endpoints remain internal to the VPS/container network and are used by deployment health checks.

## Database
- PostgreSQL staging data is logically separate from production.
- Keycloak staging must not reuse HCIS application schema/database as its own schema ownership.
- Credentials are injected at runtime and not committed.

## Realm
Create one Staff realm for Wave 1 with stable lowercase key:
`sq-staff-staging`

Realm name is part of the OIDC issuer URL and therefore must not be treated as cosmetic after identity mappings are created. Do not rename the realm after staging mappings exist without an explicit migration.

Realm behavior:
- self-registration disabled;
- username login enabled;
- Employee username is NIP/employee number when provisioned;
- verified unique email login may be allowed as alternate according to accepted policy;
- duplicate email is not allowed for Staff realm provisioning;
- Remember Me disabled;
- SSO Session Idle 8h;
- SSO Session Max 12h;
- access-token lifespan baseline 5m;
- password minimum 12 characters and username-equivalent password rejected;
- brute-force protection enabled and staging-tested around the accepted 5-failure/temporary-wait baseline;
- TOTP + recovery-code flow available;
- privileged synthetic accounts can be marked/enrolled as MFA-required without turning Keycloak roles into application/domain permission sources.

## Clients
Minimum staging clients:
1. `hcis-staging` — confidential web application client for HCIS server-side Authorization Code flow;
2. `sq-hub-api-staging` — API audience/resource target for machine-to-machine access-check calls if required by HUB-IMPL-002;
3. a dedicated service client for HCIS -> SQ Hub API client-credentials flow, with least privilege and no human login semantics.

Client IDs/names may be normalized during implementation, but each purpose remains separate.

## Theme
Create an SQ Identity theme skeleton derived from `docs/design/hcis-baseline.md`:
- SQ/Sabilul Qur'an brand mark;
- HCIS-derived typography/color/surface language;
- global wording such as `SQ Hub` / `Sabilul Qur'an`, not `Human Capital Information System`;
- login, error, OTP, reset/required-action pages at minimum;
- no font asset redistribution beyond the existing authorized deployment arrangement.

Pixel-perfect extraction is not required for the first infrastructure PR, but default Keycloak branding is not the accepted final staging UX.

## Configuration as code
Repository should contain non-secret, reviewable configuration needed to reproduce staging, for example:
- compose/deployment manifest;
- reverse-proxy example/config under the deployment model used by YSQ;
- realm bootstrap/import template where safe;
- theme source;
- `.env.example` containing names only, never credentials;
- operational README/runbook.

Do not commit exported user accounts, passwords, TOTP secrets, recovery codes, signing private keys, client secrets, or live database data.

## Initial admin bootstrap
- bootstrap admin credential is temporary operational secret;
- after initialization, create named least-privilege administrative/service identities as required;
- do not leave a well-known bootstrap password in configuration;
- document emergency admin recovery separately.

## Health and observability
Minimum:
- readiness check using supported Keycloak health behavior (internally `/health/ready` or equivalent management endpoint configuration);
- container/process restart policy;
- structured/container logs accessible to operator;
- no credential/token logging;
- record CPU/memory consumption during synthetic login/MFA tests.

## Backup/restore
Before HUB-IMPL-001 is complete:
- create staging database backup procedure;
- restore into a disposable/clean staging target at least once;
- prove realm/client/user configuration needed for test identities survives recovery;
- record executed commands and result.

## Synthetic users
Create only synthetic/test identities representing:
- ordinary Employee;
- HCIS manager;
- privileged HCIS admin requiring MFA;
- platform/service machine identity;
- disabled identity.

No production Staff credential/data is required for Wave 1.

## Acceptance criteria
- `login-staging.sabilulquran.or.id` serves SQ Identity over HTTPS;
- Keycloak version is explicitly pinned, not `latest`;
- readiness check reports healthy after full initialization;
- OIDC issuer contains the stable `sq-staff-staging` realm key;
- login with synthetic NIP username succeeds;
- alternate verified email login is verified if enabled;
- incorrect credentials trigger expected protection behavior;
- privileged synthetic account cannot complete the required flow without configured MFA;
- ordinary synthetic Staff can follow the non-mandatory-MFA policy;
- HCIS staging client can complete an Authorization Code flow in a test harness or subsequent HUB-IMPL-003 integration;
- admin interface is not left unrestricted to the public internet;
- no secrets committed;
- backup/restore rehearsal succeeds;
- actual CPU/memory observations are recorded;
- SQ theme covers login/error/OTP/reset-required-action flows at minimum.

## Non-goals
- production realm/cutover;
- real Staff import;
- HCIS password-hash import;
- full passkey/passwordless rollout;
- external applicant/guardian identity;
- universal Keycloak authorization model.