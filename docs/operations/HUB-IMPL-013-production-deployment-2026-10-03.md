# HUB-IMPL-013 — production deployment record

**Recorded:** 2026-10-03 Asia/Jakarta

**Specification:** HUB-IMPL-013 ACCEPTED

**UAT:** WAIVED by Product Owner; no UAT result is labeled PASS.

## Deployment result

| Component | Source | Evidence | Result |
| --- | --- | --- | --- |
| HCIS producer | `main` `1f482549f2644b32620a127d79bb59ba3ca25c8f` | [production workflow](https://github.com/sabilulquran/hcisysq/actions/runs/37035780658) | PASS: preflight, database backup, deployment, service verification |
| SQ Hub API and web | `main` `9ae115993d14d637ba82fece741919f243493b6a`, component source `6c894188e788a2596439b499501f4f9968814d6c` | [production workflow](https://github.com/sabilulquran/SQ-Hub/actions/runs/37038100099) | PASS: migration, API/web cutover, internal and public health |
| SQ Hub database archive | `sq-hub-before-identity-lifecycle-20261002T170237Z.dump` (100,962 bytes) | [backup workflow](https://github.com/sabilulquran/SQ-Hub/actions/runs/37037999749) | PASS: nonempty archive, PostgreSQL archive listing readable, checksum stored on VPS |
| Public health | `hub.sabilulquran.or.id/healthz`; `hcis.sabilulquran.or.id/api/health` | Read-only HTTP checks after deployment | Both HTTP 200 |

The SQ Hub deployment selected `scope=hub`, so it did not redeploy Keycloak. The deployment helper reported `API_MIGRATION_PASS` and `SQ_HUB_PRODUCTION_DEPLOY_PASS`. The HCIS producer endpoint and Hub lifecycle routes require separate runtime service-identity configuration; image deployment does not activate them.

A read-only unauthenticated route probe after deployment returned HTTP 404 for `/api/admin/staff-lifecycle/synthetic/offboarding-preview`, while the existing `/api/admin/staff?q=synthetic` route returned HTTP 401. This is consistent with lifecycle route registration remaining disabled, rather than a general Admin API outage.

## Remaining activation state

- **Lifecycle feature activation: PENDING.** Configure and verify the HCIS verifier service identity and Keycloak identity-management fine-grained permissions. The Keycloak service must not receive broad administrator roles. Apply only the approved secrets/configuration through the production operator path.
- **Production permission probe: NOT RUN.** Confirm required Keycloak actions succeed and forbidden realm/client/role/impersonation actions fail before enabling lifecycle routes.
- **Backup restore rehearsal: NOT RUN.** The backup archive was validated for format and checksum, but no disposable restore was claimed.
- **UAT: WAIVED.** Local/CI simulation evidence remains separate from production UAT.

**Conclusion:** deployment of the HCIS and SQ Hub code is PASS; employee Identity Lifecycle is not marked fully active or accepted until the remaining service-identity and permission gates are verified. No employee data, credential, token, or secret is included in this record.
