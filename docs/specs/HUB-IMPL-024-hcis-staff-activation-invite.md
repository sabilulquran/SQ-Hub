# HUB-IMPL-024 — Staff activation invite requested by HCIS

**Status:** ACCEPTED 2026-11-04 (Kepala HC request: one action in HCIS Account & Akses sends the employee's activation by WhatsApp and email).

**Related:** HCIS `docs/domain/account-activation.md` §AUTH-002-INVITE, [HUB-IMPL-013](HUB-IMPL-013-go5c-staff-provisioning-offboarding.md), HCIS `docs/specs/HCIS-ID-001-staff-identity-verification.md`, [HUB-IMPL-002](HUB-IMPL-002-application-registry-access.md).

## Purpose

HCIS production signs staff in with Akun SQ. Until now an employee became able to sign in only after an operator created the Akun SQ in the Admin Center (HUB-IMPL-013), granted HCIS Application Access, and mapped the identity in HCIS with a CLI. HUB-IMPL-024 lets HCIS ask SQ Hub to do the SQ Hub part in one machine call, so the Kepala HC can activate an employee from HCIS.

## Contract

`POST /internal/v1/staff-activation/invite`

- Caller: a client-credentials (service account) token from the issuer `KEYCLOAK_ISSUER` with audience `MACHINE_TOKEN_AUDIENCE`, whose client is listed in **`STAFF_ACTIVATION_ALLOWED_CLIENTS`**. This list is separate from `ALLOWED_MACHINE_CLIENTS`: other applications that may read access decisions (for example SPMB) cannot create staff identities. A human token is refused.
- The route exists only when Staff lifecycle is configured (HUB-IMPL-013 identity management + HCIS verification) **and** `STAFF_ACTIVATION_ALLOWED_CLIENTS` is not empty. Otherwise it answers 404 like any unknown route.
- Body (strict): `{ "employeeNumber": "<exact NIP>", "requestedBy": { "accountId": "<HCIS account uuid>" } }`. The caller sends no name, e-mail, phone or identity: SQ Hub reads the employee from HCIS (HCIS-ID-001) and uses only that answer.
- Response `200`, `Cache-Control: no-store`:

```json
{
  "identity": { "issuer": "...", "subject": "..." },
  "employeeId": "hcis:employee:<uuid>",
  "credentialInitialization": "sent | already_complete | required_action_pending",
  "applicationAccess": "granted | already_active | revoked"
}
```

## Behaviour

1. Verify the employee with HCIS (HCIS-ID-001): must exist, be `active`, and have an e-mail.
2. Provision as HUB-IMPL-013 does, with username = NIP, e-mail = HCIS e-mail, and the first/last name split of the HCIS display name (first word / remaining words; a one-word name uses the same word for both, `DRAFT`). An existing identity with this username must carry the same `hcisEmployeeId` and e-mail, otherwise `409 EMPLOYEE_IDENTITY_CONFLICT`. A Path B organ identity is linked as in HUB-IMPL-021. A **disabled** existing identity is refused with `409 STAFF_IDENTITY_DISABLED` (re-enable is an explicit Admin Center action), and no e-mail is sent.
3. Password initialization as HUB-IMPL-013: when `UPDATE_PASSWORD` is still pending, Keycloak e-mails `VERIFY_EMAIL` + `UPDATE_PASSWORD` with a 12-hour lifespan (`sent`). A Platform Administrator never gets this e-mail (H-10, `required_action_pending`). A send failure leaves the action pending (`required_action_pending`). An identity that already has a password gets no e-mail (`already_complete`).
4. HCIS Application Access (`hcis` only; the key is fixed by the route, not the caller): no record → grant (`granted`); active → unchanged (`already_active`); revoked → **not** re-granted (`revoked`), because a revocation is a Platform Administrator decision.

## Errors

| Status | `error` | When |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | Body fails the strict schema (field paths only, no values) |
| 401 / 403 | `UNAUTHENTICATED` / `INVALID_TOKEN` / `FORBIDDEN_CLIENT` | Missing or invalid token, client not in `STAFF_ACTIVATION_ALLOWED_CLIENTS`, not a service-account token |
| 404 | `HCIS_EMPLOYEE_NOT_FOUND` | HCIS has no such employee |
| 409 | `HCIS_EMPLOYEE_NOT_ACTIVE`, `HCIS_EMPLOYEE_INVALID_CONTACT`, `EMPLOYEE_IDENTITY_CONFLICT`, `DUPLICATE_USERNAME`, `DUPLICATE_EMAIL`, `STAFF_IDENTITY_DISABLED` | See behaviour |
| 503 | `HCIS_VERIFY_UNAVAILABLE`, `IDENTITY_MANAGEMENT_UNAVAILABLE`, `STAFF_LIFECYCLE_UNAVAILABLE` | Dependency unavailable; safe to retry |

## Audit and privacy

- Platform audit (`staff_lifecycle` writer): the existing `staff_identity.provision*` and `staff_identity.password_initialization` events, plus `staff_identity.hcis_invite` with outcome and payload `{ credentialInitialization, applicationAccess }`. Actor `{ kind: "service", ref: "<client id>:hcis-account:<accountId>" }`, so the HCIS account that asked is traceable without personal data.
- A grant writes the normal Application Access audit with reason `HCIS aktivasi akun (HUB-IMPL-024)`.
- Request logs carry no body. Invalid-body logs carry field paths only. No e-mail, NIP, token or action link is logged by this route.

## Configuration and rollout

- `STAFF_ACTIVATION_ALLOWED_CLIENTS`: comma-separated client ids. Production value: the HCIS machine client already used for `/internal/v1/application-access/check`. It must not name the Hub OIDC client, the directory client, the identity-management client or the HCIS verifier client (config refuses to start).
- Rollback: remove the variable and restart the Hub API; the route disappears. Identities, grants and audit stay.
