# HUB-IMPL-013 — Mi8 activation plan

**Status:** PLAN — no production change made or authorized by this document.

**Updated:** 2026-10-16

**Related:** [HUB-IMPL-013 activation and recovery](HUB-IMPL-013-identity-lifecycle.md), [production deployment record](HUB-IMPL-013-production-deployment-2026-10-03.md), HCIS `docs/specs/HCIS-ID-001-staff-identity-verification.md`

## Why a Mi8 plan is needed

The activation procedure in `HUB-IMPL-013-identity-lifecycle.md` was written for the old Docker-based production VPS. SQ Core moved to Mi8 on 6 October 2026 and that VPS has since been terminated. Mi8 runs Keycloak 26.7.2, HCIS, and SQ Hub as native processes under the SQ Core supervisor, without Docker. Steps that call `docker compose exec`, including `infra/keycloak/scripts/reconcile-identity-management-client.sh`, cannot run there unchanged.

The 2026-10-03 deployment record also predates the move. Its backup and deployment evidence describe the old VPS, not Mi8.

## Current Mi8 state (read-only check, 2026-10-16)

| Item | State |
| --- | --- |
| Hub migration `0007_staff_lifecycle_operations` | Applied: `staff_lifecycle_operations` exists in `sqcore_hub` |
| Hub lifecycle env pair `KEYCLOAK_IDENTITY_MANAGEMENT_CLIENT_ID/SECRET` | Absent, so lifecycle routes are not registered (public probe returns 404) |
| Hub `HCIS_STAFF_VERIFY_BASE_URL/CLIENT_ID/CLIENT_SECRET` | Absent |
| HCIS `STAFF_IDENTITY_VERIFY_ENABLED` | Not set (defaults to `0`); issuer/audience/allowed-client keys absent |
| Keycloak client `sq-hub-identity-management` (realm `sq-staff`) | Does not exist |
| Keycloak client `sq-hub-staff-lifecycle` (realm `sq-staff`) | Does not exist |
| Realm `sq-staff` `adminPermissionsEnabled` | `false` (fine-grained admin permissions off) |
| Realm `sq-staff` SMTP | Configured (host, port, from, auth, ssl, starttls keys present); delivery not tested |
| `kcadm.sh` on host | Available in the Keycloak release directory |
| Docker on host | Not available |

## Activation gates

Each gate needs its own owner approval at execution time. Run them in order and stop at the first failure.

### G0 — Preconditions

- The Keycloak readiness-restart observation (OPS-MI8-KC-001 Part A, applied 2026-10-16 07:24 WIB) has completed its 48-hour window without unplanned restarts.
- The daily SQ Core backup has a fresh verified set for `sqcore_keycloak`, `sqcore_hcis`, and `sqcore_hub`, plus an off-host copy, taken immediately before the change.
- Synthetic test data is agreed: one disposable HCIS employee record with a mailbox the operator controls, and a disposable non-staff Keycloak user for denial probes. No real employee identity is used.

### G1 — Mi8-compatible Keycloak reconciliation

- Add a host-native mode to `reconcile-identity-management-client.sh` (or a Mi8 wrapper) that calls `kcadm.sh` directly instead of `docker compose exec`, with the same convergence checks and the same direct-role ceiling (`query-users` only).
- Secrets are read from a root-only file or standard input, never from arguments or shell history.
- Rehearse against a restored copy of `sqcore_keycloak` on a non-public Keycloak before touching production.

### G2 — HCIS verification producer (HCIS-ID-001)

- Create confidential client `sq-hub-staff-lifecycle` in `sq-staff`: client-credentials only, audience `hcis-staff-identity`, scope `staff-identity.verify`, no other roles.
- In HCIS `final.env`, set `STAFF_IDENTITY_TOKEN_ISSUER`, `STAFF_IDENTITY_TOKEN_AUDIENCE=hcis-staff-identity`, and `STAFF_IDENTITY_ALLOWED_CLIENTS=sq-hub-staff-lifecycle` while the gate stays `0`. Then set `STAFF_IDENTITY_VERIFY_ENABLED=1` and restart only HCIS through the supervisor.
- Probe `POST /internal/v1/staff-identity/verify-employee`: the synthetic employee resolves; a missing token, wrong audience, wrong client, missing scope, and an expired token are each rejected; the response carries `Cache-Control: no-store` and no NIK or payroll fields.

### G3 — Identity-management client and least privilege

- Run the G1 reconciliation for `sq-hub-identity-management` in `sq-staff`.
- Enable fine-grained admin permissions for `sq-staff` and grant only: query users, create users, view/manage Staff users, and execute-actions-email.
- Permission probe with the client's own token. Allowed: query, create the synthetic Staff user, read it back, send execute-actions-email. Denied with 403: realm settings, client and role management, group management, impersonation, and managing a non-Staff user.
- Stop activation if Keycloak 26.7.2 cannot enforce this boundary.

### G4 — Enable Hub lifecycle

- Add `KEYCLOAK_IDENTITY_MANAGEMENT_CLIENT_ID/SECRET` and `HCIS_STAFF_VERIFY_BASE_URL/CLIENT_ID/CLIENT_SECRET` to Hub `final.env` in one change. Hub refuses to start if the set is incomplete.
- Restart only the Hub API through the supervisor. Confirm the lifecycle routes now return 401 without a session instead of 404, and that the rest of the Admin API is unchanged.

### G5 — Synthetic end-to-end check

- Provision the synthetic employee from the Admin Center. Confirm HCIS verification runs before any Keycloak create, the user is created with `emailVerified=false`, and an email with `VERIFY_EMAIL` and `UPDATE_PASSWORD` arrives with a 12-hour (43,200-second) lifespan.
- Offboard: all Application Access grants and Platform Administrator membership are revoked, the identity is disabled, and the operation reaches `COMPLETED`.
- Re-enable: only the Keycloak account is re-enabled; access stays revoked.
- Remove the synthetic data afterwards and record the result as a dated evidence record. UAT remains WAIVED unless the Product Owner runs it.

## Rollback

- Hub: remove the five lifecycle variables from `final.env` and restart the Hub API. Routes return to 404; `staff_lifecycle_operations` rows and audit stay intact.
- HCIS: set `STAFF_IDENTITY_VERIFY_ENABLED=0` and restart HCIS.
- Keycloak: disable `sq-hub-identity-management` and `sq-hub-staff-lifecycle`. Export the fine-grained permission configuration before G3. Confirm during the G1 rehearsal what happens to those permissions in 26.7.2 when the realm setting is turned off, before relying on that as a rollback step.
- Reconcile any `IN_PROGRESS` or `PARTIAL_FAILURE` operation against Keycloak and Hub before closing the rollback.

## Open questions for the owner

1. Who runs and approves each gate, and in which maintenance window?
2. Which synthetic employee number and mailbox are used for G2 and G5?
3. Should OPS-MI8-KC-001 Part B (prepared, held by the owner) be decided before G3 changes realm configuration?
