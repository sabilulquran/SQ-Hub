# HUB-IMPL-023 — HCIS role administration in SQ Hub: implementation and rollout

Spec: `docs/specs/HUB-IMPL-023-hcis-role-administration.md` (revision 3). This page records what the Hub side
implements, how to switch it on, and how to undo it. It does not change Keycloak or HCIS.

## What the Hub does

| Spec | Implementation |
| --- | --- |
| H-0 | `RoleAdministrationService` calls `PlatformAdminService.authorize` as the first statement of `catalog`, `grant` and `revoke`, before the user token is refreshed or exchanged. The routes under `/admin/hcis-roles/*` also authorize before reading params or body. A log line `role_administration.exchange` is written **before** every exchange, so its absence proves none was tried. |
| H-1 | `GET /admin/hcis-roles/catalog` returns HCIS `GET /catalog` as it comes (validated, no role list in Hub code). |
| H-2 / H-2c | Machine token: client credentials of `HCIS_ROLE_ADMIN_CLIENT_ID` with `scope=role-administration.manage`. Actor assertion: token exchange by `sq-hub` (`SQ_HUB_OIDC_CLIENT_ID`) with `audience=hcis-role-administration-actor` and `scope=role-administration.actor`, issued right before the one call that spends it. Neither token is logged, stored, or returned. |
| H-2b | `DELETE /admin/hcis-roles/assignments/:assignmentId` with `{ requestId }` in the body; 204 on success. |
| AC 4 | On `409 ROLE_ADMIN_ACTOR_ASSERTION_SPENT` the Hub exchanges a new assertion once, with the same `requestId`. |
| AC 5 | The browser chooses `requestId` once per submitted form, so a double submit is a replay HCIS refuses, not a second assignment. |
| H-9 | Migration `0012_platform_admin_proposals.sql`. Through the Hub, an identity becomes active only by `confirm` of a pending proposal, by an active administrator who is neither the proposer nor the target, while the proposer is still active. Checked in the activating transaction with locked rows and backed by CHECK constraints. Revocation is one person. Proposals lapse after 7 days (`DRAFT`). |
| H-10 | `password-initialization` is refused with `PLATFORM_ADMIN_CREDENTIAL_FORBIDDEN` for an active Platform Administrator, pointing to the Keycloak console. |
| H-11 | `GET /admin/platform-administrators` and `/audit` list administrators, proposals and every `platform_admin.*` event, resolving the stored hashes to names for a Platform Administrator reader. |
| H-5 (AUTH-014) | Each grant/revoke attempt is recorded in `platform_audit_events` (`hcis_role.assignment.create/remove`) with the same `requestId` HCIS audits. |

Not changed: the CLI `npm run platform:admin -- grant` stays the bootstrap/break-glass path. It needs shell access to
the Hub host and its database, which is outside the Hub's own threat model; H-9 governs the Hub.

## Open item (`DRAFT`)

The HCIS channel has no route that tells the Hub a person's HCIS `accountId` or their existing `assignmentId`s. Until
that is decided, the operator copies both from HCIS "Account & Akses" (read-only there). Question sent to the
spec owner session on 2026-11-01.

## Configuration

Set all three together, or none (the screen then shows "Belum dipasang"; H-0 still guards every route):

```
HCIS_ROLE_ADMIN_BASE_URL=<HCIS API base, including any proxy prefix such as /api/>
HCIS_ROLE_ADMIN_CLIENT_ID=sq-hub-role-administration
HCIS_ROLE_ADMIN_CLIENT_SECRET=<from secret management; never in shell history>
```

The Hub refuses to start if the client id equals the Hub OIDC, directory, identity-management, or HCIS-verify client.

Switching the channel on is outside this release and stays with the owner: K-4/K-5 on `sq-hub` (shared with
Ringkasan Yayasan), then `HCIS_ROLE_ADMIN_ENABLED=1` in HCIS (never on a payroll release day). Until then the screen
shows "Belum aktif".

## Release and recovery

- Migration 0012 is additive. Back up the Hub database before `migrate`.
- Recovery: deploy the previous build, then `DROP TABLE platform_admin_proposals;` and
  `DELETE FROM schema_migrations WHERE filename = '0012_platform_admin_proposals.sql';`.
  No other table is touched, and the Hub stores no HCIS role data.

## Production verification of H-0

Two Hub sessions whose identities are **not** in `platform_administrators` call
`POST /api/admin/hcis-roles/accounts/<the other's id>/assignments`. Pass when both answer `403 ADMIN_FORBIDDEN`
and the API log for that window has no `role_administration.exchange` line.
