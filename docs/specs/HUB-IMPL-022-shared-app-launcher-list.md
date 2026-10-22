# HUB-IMPL-022 — Shared app launcher list

**Status:** ACCEPTED (owner-approved launcher contract, 2026-10-23). Repository implementation only; production activation (setting `ALLOWED_MACHINE_CLIENTS` for app clients, deploying) needs separate owner approval.

**Related:** [`docs/design/sq-core-app-shell.md`](../design/sq-core-app-shell.md) item 4 ("the same in every app"), HUB-IMPL-002 (Application Access), HUB-IMPL-005 (Hub workspace), KIRIM-IMPL-001 §8.

## 1. Goal

The header launcher shows the same list in every SQ Core app: the SQ Hub row first ("Beranda semua aplikasi Anda"), then every application the signed-in staff member may open, with the current app marked "Di sini", and the footer "Lihat semua aplikasi".

The list is the one SQ Hub already shows in its own launcher and on `/apps`: an `applications` row with `status = 'active'` joined to an `application_access` grant with `status = 'active'` for the identity's OIDC `issuer + sub`, ordered by name, then key (`PgHubWorkspaceRepository.listAuthorizedApplications`).

Out of scope: shared or wildcard cookies across subdomains (AGENTS.md §5), browser calls from an app to Hub across origins, Keycloak changes, notifications, and any per-app permission data.

## 2. Flow

1. The app's backend reads the signed-in user's stored `issuer` and `subject`.
2. It calls Hub server-to-server with its existing machine client (the one it uses for `POST /internal/v1/application-access/check`).
3. It caches the answer per session for 5 minutes and returns it to its own browser on a same-origin route. Tokens never reach the browser.
4. On any Hub error or timeout (5 s) the app shows only its own tile, as before.

Kirim SQ runs inside the Hub API process, so it reads the same repository directly (§5) instead of calling step 2.

## 3. Endpoint

`POST /internal/v1/application-access/launcher`

| Item | Behaviour |
| --- | --- |
| Auth | `Authorization: Bearer <machine access token>` from client credentials. Verified by the same verifier as `/check`: issuer `KEYCLOAK_ISSUER`, audience `MACHINE_TOKEN_AUDIENCE`, client (`azp` or `client_id`) in `ALLOWED_MACHINE_CLIENTS`. The token is checked before the body is read. |
| Body | Strict: `{"identity": {"issuer": "<OIDC issuer URL>", "subject": "<OIDC sub>"}}`. Any other key, at the top level or inside `identity`, is rejected. |
| 200 | `{"applications": [{"key": "<application_key>", "name": "<registry name>", "canonicalUrl": "<registry canonical_url>"}, ...]}`. Keys, names and URLs come from the `applications` table as stored. |
| Unknown identity | `200 {"applications": []}`. No hint whether the identity exists. |
| SQ Hub itself | Never in the list: rows with key `sq-hub`, or whose `canonical_url` origin equals Hub's public origin (from `SQ_HUB_OIDC_REDIRECT_URI`), are dropped. Apps render the SQ Hub row themselves. |
| 400 | `{"error": "INVALID_REQUEST", "fields": [<rejected paths>]}`. Paths only, never the submitted values. |
| 401 | `{"error": "UNAUTHENTICATED"}` without a bearer token; `{"error": "INVALID_TOKEN"}` for a bad, expired or unverifiable token. |
| 403 | `{"error": "FORBIDDEN_CLIENT"}` for a valid token from a client outside the allowlist. |
| Headers | `Cache-Control: no-store` on every answer. |
| Logging | Request logs carry only method and path. A rejected body logs issue paths and codes only. Identity values are never logged. |

Application keys known in this repository: `hcis` (HCIS, seeded), `aset-sq` (Aset SQ, HUB-IMPL-018), `kirim-sq` (Kirim SQ, KIRIM-IMPL-001 §7), `spmb-sq` (SPMB, `infra/keycloak/README.md`), `karir-sq` (Karir, used by the Karir app's access check). Display names are whatever the Registry holds in production; apps show them as they are.

## 4. Machine clients

The route uses the existing allowlist, `ALLOWED_MACHINE_CLIENTS`, with no separate list. The production value is set on the host and is not in this repository. Client ids named in the repository are `hcis-api-staging` (example and CI) and `spmb-api` (`infra/keycloak/README.md`, step 1). An app whose client is not in the allowlist gets `403 FORBIDDEN_CLIENT` and keeps its single-tile fallback. Adding a client to the allowlist is a production change for the owner.

## 5. Kirim SQ

- `GET /api/admin/kirim/launcher` (edge path; the API sees `/admin/kirim/launcher`) on the `kirim.` host, with `Cache-Control: no-store`.
- Needs only a valid Kirim SQ session (`sq_kirim_session`). It does **not** require the `kirim-sq` grant or a `kirim_admins` row, because the list is the person's own applications and a person who is refused Kirim SQ still needs the way back to SQ Hub.
- `401` with no session. `200 {"applications": [...]}` with the same rows and the same SQ Hub filtering as §3. On a failed read: `200 {"applications": null, "unavailable": true}`.
- The Kirim SQ OIDC runtime now uses the real workspace repository instead of an empty stub.
- `KirimShell` header, right side: theme toggle, then the launcher, then the name and Keluar (Notifications → Launcher → Account; Kirim SQ has no notifications). The SQ Hub row and "Lihat semua aplikasi" link to `https://hub.sabilulquran.or.id` and `/apps` there. The Kirim SQ tile is marked "Di sini". If the list is unavailable or leaves Kirim SQ out, the Kirim SQ tile is still shown.

## 6. Key → icon and category colour

Every app's launcher copies this table from `apps/web/src/components/applicationAppearance.ts`. Icons are `lucide-react` names. Tile classes use the category tokens in `apps/web/src/styles.css` (`--cat-*` / `--color-cat-*`; values in `sq-core-design-system-c.md`).

| Key | Icon | Tile classes | Category |
| --- | --- | --- | --- |
| `hcis` | `UsersRound` | `bg-cat-attendance-soft text-cat-attendance` | attendance |
| `aset-sq` | `Boxes` | `bg-cat-service-soft text-cat-service` | assets and services |
| `karir-sq` | `BriefcaseBusiness` | `bg-cat-task-soft text-cat-task` | tasks (kept from Karir's existing tile) |
| `spmb-sq` | `GraduationCap` | `bg-cat-leave-soft text-cat-leave` | leave colour (DRAFT: owner may change) |
| `kirim-sq` | `MessageCircle` | `bg-cat-pay-soft text-cat-pay` | pay colour (DRAFT: owner may change) |
| any other key | `PanelsTopLeft` | `bg-brand-primary-pale text-brand-primary-deep` | default |

The SQ Hub row uses the foundation mark image (`assets/brand/ysq-mark.png`), not a tile icon. The design system has five categories, so `spmb-sq` and `kirim-sq` reuse colours that HCIS, Aset SQ and Karir do not use; this choice is DRAFT until the owner picks.

## 7. Acceptance

- API tests: 401 without a token and with a bad token, 403 for a forbidden client (body not read), 400 for extra keys, a missing identity and a bad issuer without echoing values, `no-store`, SQ Hub removed, unknown identity `[]`, identity values absent from logs.
- Integration test over PostgreSQL: inactive application, revoked grant and SQ Hub row excluded, ordering by name, unknown identity and other issuer `[]`.
- Kirim SQ integration tests: 401 without a session, list returned without the admin role, Kirim SQ included, `unavailable` on a failed read.
- Web tests: Kirim SQ launcher order, "Di sini" on Kirim SQ only, SQ Hub links absolute, fallback tile, header order; SQ Hub launcher unchanged.

## 8. Rollback

Remove the route registration and the Kirim launcher route; apps already fall back to their own tile on any error. No migration or data change.
