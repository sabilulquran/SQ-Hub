# ORGAN-IMPL-001 R1 — Keycloak, DNS, and configuration for the Portal Organ Yayasan (operator preparation)

**Status:** PREPARED, NOT APPLIED. Nothing here has been applied to Mi8VPS or the realm. Each step follows the SQ Core release rules (dry run first, report afterwards, never at 19 UTC). The DNS step is the owner's.

**Scope:** realm `sq-staff`, new client `sq-organ`, Keycloak as pinned in `infra/keycloak/Containerfile`. The token-exchange part follows [HUB-IMPL-021-token-exchange.md](HUB-IMPL-021-token-exchange.md). The only differences are that the requester is `sq-organ`, not `sq-hub`, and that the second step, the audience of its own access token, now applies to `sq-organ` as well.

## 1. DNS (owner)

In the Yayasan's Cloudflare account, add a record `organ` with the same target and proxy setting as `kerja` and `kirim`. Wrangler and the MCP tools do not reach this zone.

## 2. Edge on Mi8VPS

Route host `organ.sabilulquran.or.id` exactly like `kerja.sabilulquran.or.id`:

- `/api/*` goes to the SQ Hub API with the `/api` prefix stripped and the original `Host` kept;
- everything else goes to the SQ Hub web build, which picks the portal by `location.host`.

No new process is added.

## 3. Client `sq-organ`

1. Create an OpenID Connect client `sq-organ` with these settings:
   - Client authentication On (confidential), Standard flow On, PKCE S256;
   - Direct access grants Off, Implicit Off;
   - Service accounts **Off**, because the portal has no machine identity (ADR-0012 D5).
2. Valid redirect URI: `https://organ.sabilulquran.or.id/api/auth/callback`. Post-logout redirect URI: `https://organ.sabilulquran.or.id/`. Web origin: `https://organ.sabilulquran.or.id`.
3. Use the same browser flow as `sq-hub`, so TOTP is required for organ members as HUB-IMPL-021 §1 already sets.
4. Turn on standard token exchange on `sq-organ` (`standard.token.exchange.enabled = true`). Leave refresh tokens in exchange Off.
5. In `sq-organ-dedicated`, add an Audience mapper with included client audience `sq-organ`, add to access token On.
6. Assign the existing governance scopes (`sq-governance-hcis`, and `sq-governance-aset-sq` when Aset SQ publishes) to `sq-organ` as **Optional** scopes, never Default.
7. Store the client secret only in the SQ Hub production env as `ORGAN_OIDC_CLIENT_SECRET`.

## 4. Registry and access

- **Registry aplikasi.** In Admin Center, add application `organ` (name "Portal Organ Yayasan", canonical URL `https://organ.sabilulquran.or.id/`), status active, with no governance summary path.
- **Application Access.** Grant Application Access `organ` to every effective member. New memberships created through the Organ Yayasan form list it with the other governance applications.

## 5. HCIS

- In the HCIS production env, set `GOVERNANCE_SUMMARY_ALLOWED_CLIENTS=sq-hub,sq-organ` (ORG-010-N, hcisysq#335).
- Release HCIS with the `decisions` block (ORG-010-O) before or together with the portal. A Hub without v1.1 ignores the block.

## 6. SQ Hub env

```text
PORTAL_ORGAN_ENABLED=true
ORGAN_OIDC_CLIENT_ID=sq-organ
ORGAN_OIDC_CLIENT_SECRET=<secret>
ORGAN_PUBLIC_ORIGIN=https://organ.sabilulquran.or.id
ORGAN_APPLICATION_KEY=organ
```

With `PORTAL_ORGAN_ENABLED=false` (the default), no portal route exists and `/yayasan` stays the Hub page.

## 7. Probes before switching on

| Probe | Expected |
|---|---|
| Exchange from a member's `sq-organ` token to `hcis` with scope `sq-governance-hcis` | `200`; the decoded token has `azp = sq-organ` and `aud` contains `hcis` |
| Same exchange without the scope, or to an audience that is not registered | Refused, or `aud` without the target |
| `GET https://organ…/api/organ/session` without a cookie | `401` |
| Login as a non-member | Redirect to `/?authError=organ_membership_required`; no `sq_organ_session` cookie |
| The `sq_hub_session` value sent as `sq_organ_session` | `401` |
| `127.0.0.1:3302/internal/kirim/...` and the other loopback routes | Unchanged |
| Login as a member | Ringkasan with the HCIS card. "Menunggu keputusan Anda" appears only when that account has pending steps |

## 8. Rollback

1. Set `PORTAL_ORGAN_ENABLED=false` and restart SQ Hub. `/yayasan` serves the Hub page again.
2. The `sq-organ` client and the DNS record can stay. Removing `sq-organ` from the HCIS allowlist is optional.
3. Migration `0020_hub_session_client.sql` is additive; the column stays.
