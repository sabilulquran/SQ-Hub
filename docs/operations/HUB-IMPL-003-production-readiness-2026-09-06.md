# Wave 1 staging readiness evidence — 2026-09-06

**Status:** IN PROGRESS — technical acceptance incomplete; production untouched.
**Specifications:** HUB-IMPL-002, HUB-IMPL-003, HUB-IMPL-010.
**Scope:** staging only. This record does not authorize production cutover.

## Source and image identity

SQ Hub starting main was fetched and verified as
`dac633b440d095cd323f85b724a8ec81b6d75511`. HCIS main was fetched read-only as
`b17fd11a63152a5a021a8fd49f238bf3f84152ef`; its staging runtime remains the older
`e452a5c85d98cf0bdda41efdf57bd48902ff2508` source. HCIS source was not modified.

| Component | Deployed immutable image | Digest |
| --- | --- | --- |
| SQ Hub API | `ghcr.io/sabilulquran/sq-hub-api:sha-bbd2f35c1cc121ac443c6eb5b4dd9cd901bbb39e` | `sha256:e59a199dbda17d1404b7616773d13ed7090ecc3e7c2b3a9b591aba3566b842ce` |
| SQ Hub Web | `ghcr.io/sabilulquran/sq-hub-web:sha-c6f9175f5a0a410e1c8b2859f7cba921f1eefd14` | `sha256:8cb81395249e7424b42e429b9485178272377516beeede1251992266b72bf652` |
| Keycloak | `ghcr.io/sabilulquran/sq-hub-keycloak:sha-dac633b440d095cd323f85b724a8ec81b6d75511` | `sha256:dfddb16a73604f7c731aa0bf169047ed98842ebb2a8d7f004c7f82b026dcd973` |
| HCIS API | `ghcr.io/imadjinasi/hcisysq-api:sha-e452a5c85d98cf0bdda41efdf57bd48902ff2508` | `sha256:06f2ea712c8e5d70c9bbb488d98c3bda0285f48f7476a8c7861ea56b48d4e121` |

Issuer: `https://login.sabilulquran.or.id/realms/sq-staff-staging`.
The deployed realm import has SHA-256
`d1d1a2c85f1b17ad3a68f93df9fc0e334307884b1c3051f4705ae4687f5d0572`, matching the
Git blob at the deployed Keycloak source baseline. This is an import-artifact
checksum, not a claim that every live realm setting equals the import file.
Read-only live metadata confirms the staging realm is enabled with external SSL
required. Public discovery advertises the exact staging issuer.

## Verifier hardening and validation

The confirmed incident is a process-local stall: authenticated Application
Access requests waited over 15 seconds before successful body validation or
observed SQL activity. The exact verifier in a fresh process completed in about
190 ms, and a single controlled API restart restored responses and Employee
SSO. **The exact historical JOSE trigger remains unknown.**

[Repair PR #47](https://github.com/sabilulquran/SQ-Hub/pull/47) is open and
unmerged at `bbd2f35c1cc121ac443c6eb5b4dd9cd901bbb39e`. It adds an application-owned
3000 ms deadline, a 2500 ms transport timeout, and resettable JWKS generations.
Late results/deadlines cannot invalidate a newer generation. Cryptographic
signature, public issuer, audience, allowlist and fail-closed validation remain
mandatory. Transport failure retains the existing `401 INVALID_TOKEN` contract;
that response is not evidence that the token itself was cryptographically bad.
The deadline bounds asynchronous verifier waiting with a responsive event loop,
not total SQL latency or an unresponsive process.

Local validation on Node 22.23.2 / JOSE 6.2.10:

- `npm ci`: PASS, zero reported vulnerabilities.
- API/web typecheck, lint, build: PASS; one existing web hook lint warning.
- API non-DB tests: 36 passed before adding the final staggered-caller case;
  final hardening suite: 10/10 passed. Three local integration suites could not
  run because a local `DATABASE_URL` was unavailable.
- Web: 8 tests passed. Wave 1 offline contracts: PASS.
- [PR CI](https://github.com/sabilulquran/SQ-Hub/actions/runs/34000581123):
  SUCCESS, including all 10 API suites with PostgreSQL, web tests, migrations,
  typecheck/lint/build, Compose checks, image builds and visual smoke.

Real local HTTP fixtures exercise healthy signature verification, wrong
issuer/audience/signature/client, header/body stalls, 503/invalid JSON recovery,
unknown-kid refresh, concurrent pending work, stale generations, and a bounded
route error followed by strict-schema 400 without DB access. A fetch that ignores
cancellation is explicit fault injection, not an asserted historical trigger.

[Immutable publisher](https://github.com/sabilulquran/SQ-Hub/actions/runs/34000655077)
succeeded with the full repair SHA as the sole `source_ref` value. The pulled
image's source label is `https://github.com/sabilulquran/SQ-Hub`; its digest matches
the publisher. An initial anonymous pull was unauthorized. An authenticated pull
used a temporary isolated Docker credential configuration, removed immediately
afterward; persistent daemon/login configuration was not changed.

## API-only deployment

At `2026-09-06T00:16:45.803800174Z`, only `sq-hub-staging/api` was recreated.
Its prior cached rollback image was
`ghcr.io/imadjinasi/sq-hub-api:sha-8b3f9b5023ed30f73f0b8a9002c0054c02c8f729`.
Managed-runtime marker, secret permissions, Compose rendering, exact labels,
image provenance, public health and discovery were checked first. The persistent
`docker-compose.hub.hubimpl010.yml` override now also pins the API repair image;
the existing Web image override remains intact. Parsed Compose comparison proved
that only the API image changed, and runtime environment comparison remained
equal before and after recreation.

| Target | Before | After |
| --- | --- | --- |
| SQ Hub API | `b2de245de47e` | `0a1fd74f0736` |
| SQ Hub Web | `a77f6b634f7e` | unchanged |
| SQ Hub Postgres | `30f6db63c26a` | unchanged |
| Keycloak app | `1f7a09327e48` | unchanged |
| Keycloak DB | `c68df919efe6` | unchanged |
| HCIS API | `b3a12936576b` | unchanged |

Postchecks: API healthy, restart count 0, public Hub health PASS, exact OIDC
discovery PASS. Automatic API-image-only rollback was armed but not required.

Live requests originated in the guarded existing HCIS staging API. Its own
machine credentials acquired a token in memory; tokens were never printed.

| Probe | Result | Elapsed ms |
| --- | --- | --- |
| Sequential 1–5 | Each 200, `allowed=false`, `NO_GRANT` | 554, 13, 11, 12, 14 |
| Concurrent burst of 4 | Each 200, `allowed=false`, `NO_GRANT` | 27, 50, 81, 80 |
| Authenticated extra schema field | 400 `INVALID_REQUEST` | 9 |

No verifier recurrence was observed in these probes. Sanitized HCIS audit reads
show no new `auth.oidc.application_access.unavailable` event. Fresh real Employee
SSO after this deployment remains pending; earlier password + OTP Employee SSO
was observed at `2026-09-05T22:22:52.662Z` before deployment.

## Backup and secret controls

The backup/disposable-restore mechanics follow
`tools/wave1/keycloak-backup-restore.sh` and the underlying Keycloak scripts,
adapted to exact managed-runtime container labels rather than a nonexistent VPS
Git checkout. Before each operation, the exact staging project/service/image
and health were guarded. `pg_dump` produced a nonempty custom-format backup in a
mode-0600 temporary file. SHA-256:
`54b5b6448025de2f15cd4eaf6ba9315d21a6558756cccb11fdb059dd5a9f4848`.

`keycloak_wave1_restore_check` was proven absent and different from the active
DB, created, restored with `pg_restore --exit-on-error`, and checked for exactly
one staging realm. The disposable DB was then removed and the temporary backup
closed/deleted. The active DB was never replaced. Both active container IDs
remained unchanged/healthy and public discovery passed afterward.

Verified without exposing values:

- Keycloak staging DB secret source, SQ Hub secrets and directory secret source:
  present, mode 0600.
- HCIS `staging.env` and its two observed historical backups: mode 0600.
- HCIS confidential-client secret, machine-client secret and encryption key:
  present in the running API and equal to the rendered controlled source.
- Normal Keycloak runtime has no bootstrap-only administrator credentials.
- Read-only metadata finds one enabled named master administrator; authenticated
  access and recovery custody have not yet been exercised.
- Eight live staging secret values were compared privately against 887 tracked
  files across SQ Hub repair and HCIS local/runtime source archives. No match was
  found; only counts and PASS were emitted. No production secret was read.
- Operator response explicitly leaves dedicated/non-reused production credential
  attestation `OPERATOR_ATTESTATION_REQUIRED`; it has not been provided.

## Persona and remaining UAT state

The existing ordinary Employee is represented only by identity handle
`d11dd0e7486f`. It is active, exactly mapped, has an active HCIS grant, and had
successful primary authentication + TOTP + HCIS landing before deployment.

The accepted one-time HCIS bootstrap CLI created `wave1.superadmin@example.invalid`
only after confirming no Super Admin existed. It is a synthetic non-Employee
technical principal, with mandatory local MFA. No employee record was invented.
Generated test credentials are temporarily stored in a mode-0600 file within a
mode-0700 staging-only directory while UAT is pending. They must be removed at
completion; the principal will be documented as a retained reusable synthetic
fixture. It is not yet a Keycloak-mapped/SSO-tested privileged persona.

| Persona/gate | Current evidence |
| --- | --- |
| ordinary Employee | Pre-deployment SSO/TOTP accepted; fresh repair SSO pending |
| manager/local authorization | Keycloak/admin provisioning and live UAT pending |
| Human Capital administrator | Keycloak/admin provisioning and live UAT pending |
| privileged/Super Admin | HCIS principal provisioned; Keycloak mapping/MFA/recovery UAT pending |
| non-Employee Staff | Distinct expected-principal acceptance pending |
| HCIS-local suspended | Live state transition/restoration pending |
| globally disabled | Live state transition/restoration pending |
| revoked access | Historical lifecycle accepted; current focused lifecycle pending |
| unknown mapping | Fresh live authentication negative case pending |
| browser token storage/cookie metadata | Pending; available automation does not expose storage APIs |
| local password exclusion | Current mode `oidc`; POST `/api/auth/login` 404 `LOCAL_AUTH_DISABLED`; POST `/auth/login` 405 |
| Keycloak outage | Pending valid existing session and post-restoration SSO probe |
| HCIS OIDC→local→OIDC | Managed configuration renders and matches runtime; credentialed synthetic probe preparation in progress |
| Keycloak backup/disposable restore | PASS; disposable artifacts removed; live staging intact |
| runtime/source identity snapshot | Captured; full final acceptance snapshot awaits remaining UAT |

No outage or HCIS mode switch has been initiated without its credentialed
pre/postconditions. No existing identity status, grant, or mapping has changed.
The repair API image is the intended retained deployment. Temporary registry
authentication and disposable restore artifacts are cleaned up; synthetic
credential cleanup remains pending completion of UAT.

## Readiness and operator boundary

One operator input batch requests an authenticated existing named Keycloak
staging admin session, fresh Employee browser login/storage results, and
custodian/governance answers. It requests no credential values in chat. Creating
test credentials does not remove the prerequisite of authenticating an existing
authorized administrator to provision Keycloak identities through supported APIs.

Technical blockers are the unexecuted persona/MFA/recovery, browser storage,
Keycloak outage and completed rollback/SSO gates. Secret-separation attestation
is separate from those technical tests. Production approval, maintenance window,
incident/rollback decision-maker and communications owner remain governance
inputs. The operator explicitly confirmed that the maintenance window,
incident/rollback decision-maker and communications owner are not yet set, and
that no production authorization is granted.

Issue #17's genuine long-state visual UAT remains open and is **not a production
cutover hard gate**. It does not determine either readiness decision.

```text
TECHNICALLY_READY_FOR_PRODUCTION_CUTOVER=NO
READY_FOR_PRODUCTION_CHANGE_APPROVAL=NO
PRODUCTION_AUTHORIZATION_PENDING=YES
PRODUCTION_CUTOVER_EXECUTED=NO
PRODUCTION_TOUCHED=NO
```

This in-progress record must not close issue #9 or mark pending tests PASS.
