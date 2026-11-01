# HUB-IMPL-023 — HCIS role administration in SQ Hub: implementation and rollout

Spec: `docs/specs/HUB-IMPL-023-hcis-role-administration.md` (revision 3). This page records what the Hub side
implements, how to switch it on, and how to undo it. It does not change Keycloak or HCIS.

## What the Hub does

| Spec | Implementation |
| --- | --- |
| H-0 | `RoleAdministrationService` calls `PlatformAdminService.authorize` as the first statement of `catalog`, `grant` and `revoke`, before the user token is refreshed or exchanged. The routes under `/admin/hcis-roles/*` also authorize before reading params or body. A log line `role_administration.exchange` is written **before** every exchange, so its absence proves none was tried. |
| H-1 | `GET /admin/hcis-roles/catalog` returns HCIS `GET /catalog` as it comes (validated, no role list in Hub code). |
| H-1b | The operator picks a person from the Akun SQ directory. `GET /admin/hcis-roles/staff/:subject` asks HCIS `GET /accounts?issuer&subject&page&pageSize` for that person's account and assignments. Grant and revoke take the **subject**, never an HCIS id: the Hub resolves `accountId` from HCIS inside the same action, and revokes only an assignment that HCIS lists for that person with `revocableViaHub: true`. A pasted id can therefore never put a role on the wrong person. |
| H-2 / H-2c | Machine token: client credentials of `HCIS_ROLE_ADMIN_CLIENT_ID` with `scope=role-administration.manage`. Actor assertion: token exchange by `sq-hub` (`SQ_HUB_OIDC_CLIENT_ID`) with `audience=hcis-role-administration-actor` and `scope=role-administration.actor`, issued right before the one call that spends it. Neither token is logged, stored, or returned. |
| H-2b | `DELETE /admin/hcis-roles/assignments/:assignmentId` with `{ requestId }` in the body; 204 on success. |
| AC 4 | On `409 ROLE_ADMIN_ACTOR_ASSERTION_SPENT` the Hub exchanges a new assertion once, with the same `requestId`. |
| AC 3 | Granting to or revoking from oneself is refused by the Hub (`ROLE_ADMIN_SELF_FORBIDDEN`) before any exchange; HCIS refuses it as well. |
| Errors | HCIS domain refusals (well-formed code, 4xx, not a credential problem) reach the operator as 422 with HCIS's fixed message. A change whose answer never arrives is `504 ROLE_ADMIN_OUTCOME_UNKNOWN`: resending the same form is safe because the requestId is kept. The channel log line carries HCIS's error code. |
| AC 5 | The browser chooses `requestId` once per submitted form, so a double submit is a replay HCIS refuses, not a second assignment. |
| H-9 | Migration `0012_platform_admin_proposals.sql`. Through the Hub, an identity becomes active only by `confirm` of a pending proposal, by an active administrator who is neither the proposer nor the target, while the proposer is still active. Checked in the activating transaction with locked rows and backed by CHECK constraints. Revocation is one person. Proposals lapse after 7 days (`DRAFT`). |
| H-10 | `password-initialization` is refused with `PLATFORM_ADMIN_CREDENTIAL_FORBIDDEN` for an active Platform Administrator, pointing to the Keycloak console. |
| H-11 | `GET /admin/platform-administrators` and `/audit` list administrators, proposals and every `platform_admin.*` event, resolving the stored hashes to names for a Platform Administrator reader. |
| H-5 (AUTH-014) | Each grant/revoke attempt is recorded in `platform_audit_events` (`hcis_role.assignment.create/remove`) with the same `requestId` HCIS audits. |

Not changed: the CLI `npm run platform:admin -- grant` stays the bootstrap/break-glass path. It needs shell access to
the Hub host and its database, which is outside the Hub's own threat model; H-9 governs the Hub.

## H-1b — decided 2026-11-01

Decided by the spec owner session: a new HCIS route, not ids copied from the HCIS screen (that screen is scheduled
for removal under AUTH-014 §8, and a hand-copied id is a silent wrong-person grant). Contract:

```
GET /internal/v1/role-administration/accounts?issuer=<iss>&subject=<sub>&page=1&pageSize=25
Authorization: Bearer <machine token>
X-SQ-Actor-Assertion: <assertion>        (not spent, like /catalog)

200 { account: { accountId, principalType, status, employeeStatus },
      assignments: { page, pageSize, total, items: [ { assignmentId, roleId, roleKey, roleName, scopeType,
        organizationalUnitId, organizationalUnitName, startsOn, endsOn, createdAt, revocableViaHub } ] } }
404 ROLE_ADMIN_ACCOUNT_NOT_FOUND   the person has no HCIS account (not a refusal)
400 INVALID_REQUEST                empty issuer/subject, pageSize outside 1..100
```

No name, e-mail or NIK in the answer. The route is built in HCIS by the spec owner session; until it is on HCIS
`main` and deployed, the Hub screen shows the channel's own state (the channel is switched off anyway).

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
