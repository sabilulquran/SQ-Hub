# HUB-IMPL-013 — production activation and recovery

**Status:** repository implementation; production deployment pending. Product Owner waived UAT on 2026-10-02. UAT status is WAIVED, not PASS.

## Activation gates

Obtain a reviewed production change, backup/restore evidence, and rollback images/configuration before any mutation. Use isolated synthetic identities only; do not repurpose real employee identities.

For the Hub deployment, run `.github/workflows/backup-hub-production.yml` against the exact current `main` SHA. It creates a root-owned database archive on the production VPS, checks that the archive is non-empty and its PostgreSQL archive table of contents is readable, and records only a safe filename/byte count in Actions. This is backup-archive evidence, not a claim that a disposable restore was performed. Use `backup_confirmation=BACKUP_VERIFIED` in the deployment workflow only after that backup succeeds and the recovery owner accepts the available restore procedure.

1. Deploy the reviewed HCIS-ID-001 producer to production with its gate OFF. Provision a dedicated client-credentials identity `sq-hub-staff-lifecycle` with audience `hcis-staff-identity` and only `staff-identity.verify`. Enable HCIS verification only after signature, issuer, audience, expiry, allowed client and scope denial tests pass. Do not use a human token or HCIS database credential.
2. Create a separate Keycloak `sq-hub-identity-management` confidential service client in production realm `sq-staff`. Disable standard, implicit and direct-access flows. Run `infra/keycloak/scripts/reconcile-identity-management-client.sh` with explicit production environment, compose file and realm. It grants only direct `query-users` and reports FGAP proof pending. Configure Keycloak fine-grained admin permissions for only Staff user query, create, view/manage and execute-actions-email. Do not assign `realm-admin`, broad `manage-users`, role/group/client/realm management or impersonation. Verify actual allowed operations and explicit 403 denial of forbidden operations with a synthetic disposable Staff identity. Stop activation if the pinned Keycloak version cannot enforce this boundary.
3. Inject service secrets through production secret management. Set `KEYCLOAK_IDENTITY_MANAGEMENT_CLIENT_ID/SECRET` and `HCIS_STAFF_VERIFY_BASE_URL/CLIENT_ID/CLIENT_SECRET` together. The Hub lifecycle routes remain disabled when the management pair is absent. Do not print values or put them in shell history.

`HCIS_STAFF_VERIFY_BASE_URL` is the HCIS **API base URL**, including any reverse-proxy prefix such as `/api/`. Verify the final resolved endpoint path before activation.
4. Apply migration `0007_staff_lifecycle_operations.sql` to the production Hub database. It adds a new operation-state table and does not modify existing access/identity rows. Ensure runtime has SELECT/INSERT/UPDATE for this table and no HCIS database access.
5. Use synthetic employee/contact data only. Confirm HCIS verification happens before any Keycloak create, Keycloak sends `VERIFY_EMAIL` plus `UPDATE_PASSWORD` with 43,200-second lifetime, and failed delivery leaves required actions pending. Verify UI re-send and audit without exposing the action link.

## Offboarding operator procedure

The Admin enters a reason, reviews the target, confirms, and records the returned operation ID and each step result without copying employee data into tickets. The server checks every registered Application Access record, revokes active grants, verifies read-back, revokes Platform Administrator membership and verifies read-back, then disables the Keycloak identity and verifies read-back. `COMPLETED` requires all checks. A failed or unverified step produces `PARTIAL_FAILURE`.

For a partial operation, the Admin checks the listed failed step and repeats the same offboarding action with a reason. The operation lock serializes retries per identity; already-revoked steps are no-ops. A timeout can leave `IN_PROGRESS`; read back Application Access, membership and Keycloak state before retry. Do not manually mark completion. If repeated retries cannot close the case, escalate to the Head of HCM for coordination; an authorized Admin performs technical retries through the audited interface. HCIS employment status and domain permissions are handled by their owners.

Re-enable is an explicit Admin action with reason. It changes only the global Keycloak account. Application Access and Admin membership remain revoked; any future grant is a separate decision under the existing access process.

## Recovery and rollback

If a deployment fails, remove the management client configuration from Hub and restore the previous immutable Hub image. Leave operation rows and platform audit intact. Disable the HCIS verification gate if needed. Do not roll back `0007` destructively while any operation exists. Restore Keycloak/Hub from tested environment backups only under the existing operational baseline; reconcile every in-progress or partial operation against the authoritative stores afterward.

## Evidence status

| Gate | Status |
| --- | --- |
| Repository typecheck/lint/build | PASS locally on 2026-10-02; lint has one pre-existing warning |
| API tests without PostgreSQL integration | 17 files / 134 tests PASS locally |
| Web tests | 6 files / 23 tests PASS locally after current main merge |
| PostgreSQL integration and migration | CI [foundation run 37022032376](https://github.com/sabilulquran/SQ-Hub/actions/runs/37022032376) PASS: migration from empty database, idempotence, full API/web tests; local PostgreSQL unavailable |
| Dependency audit | 0 vulnerabilities locally and CI PASS |
| Backup/restore and rollback rehearsal | NOT RUN |
| Synthetic HCIS producer contract | Local test passed; production connection pending |
| Keycloak least-privilege permission probe | NOT RUN |
| Email 12-hour action and send-failure retry in production | WAIVED; not executed |
| Per-step offboarding failure/retry and re-enable in production | WAIVED; not executed |
| Migration and recovery rehearsal in production | NOT RUN |

Do not infer production UAT success from local unit tests or this waiver. Keep the feature gate OFF until the remaining least-privilege and operational activation gates are evidenced.
