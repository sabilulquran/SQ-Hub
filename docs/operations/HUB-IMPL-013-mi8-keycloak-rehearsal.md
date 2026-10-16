# HUB-IMPL-013 — Keycloak copy rehearsal for Mi8 activation (G1/G3)

**Status:** PLAN — not executed.

**Updated:** 2026-10-16

**Parent:** [Mi8 activation plan](HUB-IMPL-013-mi8-activation-plan.md), gates G1 and G3

## Purpose

Run the identity-management reconciliation and the fine-grained admin permission probe against a disposable copy of production `sqcore_keycloak` before touching production. The rehearsal answers three questions:

1. Does `reconcile-identity-management-client.sh` in host mode converge, and stay idempotent, against the real `sq-staff` realm configuration?
2. Can Keycloak 26.7.2 enforce the least-privilege boundary for `sq-hub-identity-management`: allowed Staff-user operations succeed and everything else returns 403?
3. What happens to the fine-grained permissions when realm `adminPermissionsEnabled` is turned off? This determines the rollback step.

Repository CI already covers the script itself in both modes against a synthetic realm (`keycloak-infra.yml`, "Reconcile identity-management client in compose and host modes"). This rehearsal adds the real realm data, which never enters CI or GitHub.

## Where to run it

| Option | Assessment |
| --- | --- |
| **A. Operator laptop (recommended)** | No load on production. Needs portable PostgreSQL 18, Java 21 (x64), the Keycloak 26.7.2 distribution, and the production provider and theme jars. The copy holds real realm data, so it stays on the operator's encrypted disk and is deleted afterwards, as with the earlier off-host backup copies. |
| B. Mi8, isolated second instance | Fallback only. On 2026-10-16 Mi8 showed 3.7 GB RAM with about 75 MB free, while production Keycloak is already under restart observation (OPS-MI8-KC-001). Use only in an approved quiet window, with a hard heap cap and a measured free-memory check before start. Abort on any production health change. |
| CI or GitHub runner | Not allowed: production realm data must not leave operator-controlled storage. |

## Safety rules for the copy

- **No cluster join.** Start the copy with `KC_CACHE=local`. A clustered cache could discover and join production.
- **Loopback only.** Bind HTTP and management to `127.0.0.1` on ports that differ from production (for example 18080 and 19000). Set `KC_HOSTNAME=http://127.0.0.1:18080`, so its issuer can never match a production token.
- **No outgoing email.** Before any user operation, clear the `sq-staff` SMTP settings in the copy so `execute-actions-email` cannot reach a real mailbox. Email delivery is verified only in production gate G5, with the synthetic mailbox.
- **Temporary admin only.** Create a temporary master-realm admin in the copy with `kc.sh bootstrap-admin`. Never reuse a production administrator credential, and never point the script at production.
- **Same extensions.** Copy the provider and theme jars from the Mi8 release directory, because the realm references the trusted-device authenticator. The jars contain no secrets.
- **Synthetic users only.** Create one disposable Staff test user and one disposable non-Staff user in the copy. Do not read, modify or export real user records.

## Steps

### R0 — Approval and source

- The owner approves the rehearsal window and the host (A or B).
- Take the newest verified `sqcore_keycloak` dump from the latest `sq-core-daily` set and check it against the set manifest before restoring.

### R1 — Restore

- Create a disposable database, for example `sqcore_keycloak_rehearsal_<YYYYMMDD>`, with its own temporary role, and `pg_restore --no-owner` the dump into it.
- Confirm the table counts match the dump's table of contents.

### R2 — Start the copy

- Start Keycloak 26.7.2 with the safety settings above and the production build options. If the optimized build bakes in options that differ (for example the cache mode), rebuild in a scratch copy of the distribution, never in the production release directory.
- Wait for `/health/ready` on the copy's management port. Create the temporary admin and an authenticated `kcadm` config.
- Clear the `sq-staff` SMTP host in the copy.

### R3 — Reconcile in host mode (G1)

- Write a rehearsal-only client secret to a mode-600 file.
- Run the script twice with `KEYCLOAK_EXEC_MODE=host`, `KEYCLOAK_KCADM_BIN=<copy>/bin/kcadm.sh`, `KEYCLOAK_REALM=sq-staff`, `KEYCLOAK_IDENTITY_MANAGEMENT_CLIENT_ID=sq-hub-identity-management`, `KEYCLOAK_IDENTITY_MANAGEMENT_CLIENT_SECRET_FILE=<file>`, and `KEYCLOAK_KCADM_CONFIG=<config>`.
- Expected on both runs: `IDENTITY_MANAGEMENT_CLIENT_CONFIGURATION_PASS`, `IDENTITY_MANAGEMENT_CLIENT_DIRECT_ROLES_PASS`, `FGAP_PERMISSION_AND_API_PROBE_PENDING`.
- Confirm the client token carries only `realm-management` `query-users`, and that `GET /admin/realms/sq-staff/clients` returns 403.

### R4 — Fine-grained permissions (G3)

- Export the realm's current admin-permission state, then enable `adminPermissionsEnabled` for `sq-staff` in the copy.
- Grant the service account only: query users, create users, view and manage Staff users, and execute-actions-email. Record the exact policy and permission definitions so G3 can apply the same configuration.
- Probe with the client's own token. Allowed: search users, create the synthetic Staff user, read it back, update it, and call `execute-actions-email` with `VERIFY_EMAIL` and `UPDATE_PASSWORD` and `lifespan=43200` (accepted by the API; no mail leaves because SMTP is cleared). Denied with 403: realm settings, clients, roles, groups, impersonation, and managing the non-Staff user.
- Turn `adminPermissionsEnabled` off and on again, and record whether the permissions survive. This settles the rollback step in the activation plan.
- Stop and report if any denied operation succeeds or any required operation cannot be granted narrowly.

### R5 — Teardown

- Stop the copy, drop the rehearsal database and role, and delete the temporary admin config, the secret file, and any exports that contain realm data.
- On Mi8 (option B), confirm production still shows one supervisor, 8/8 processes, and healthy Keycloak, HCIS, Hub and Aset endpoints.
- Confirm production `sq-staff` still has no `sq-hub-identity-management` client and `adminPermissionsEnabled=false`, which proves the rehearsal did not touch production.

## Evidence to record

A dated record covering the R3 outputs, the R4 permission definitions, the allowed and denied probe matrix with HTTP status codes, the permission behaviour when the realm setting is toggled, and the R5 teardown and production checks. Record no secrets, tokens, or real user data.
