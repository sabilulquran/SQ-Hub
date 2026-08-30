# HUB-IMPL-005 authenticated workspace staging UAT evidence

**Status:** ACCEPTED — staging UAT
**Scope:** SQ Hub authenticated workspace on staging only
**Specification:** `HUB-IMPL-005`
**Recorded:** 2026-08-30 (Asia/Jakarta)

## Scope and evidence handling

This report records the staging acceptance evidence for the authenticated SQ Hub workspace implemented by PR #20. It distinguishes repository/CI evidence from controlled live-staging execution and does not authorize production cutover.

The synthetic UAT identity is `uat.hcis.staging@sabilulquran.or.id`. No password, Keycloak administrative credential, OIDC subject, access token, refresh token, ID token, authorization code, PKCE verifier, session cookie, client secret, or production personal data is recorded here.

The live runtime tested in staging was built from implementation commit:

`d46b4a6cecf5b39d97e978d49c86ee3afc32f0ba`

The UAT-evidence commit itself is documentation-only and therefore may move the final PR head beyond that deployed implementation SHA without changing the tested runtime bits.

## Immutable deployed artifacts

| Component | Immutable image | Digest | Publish evidence |
| --- | --- | --- | --- |
| SQ Hub API | `ghcr.io/imadjinasi/sq-hub-api:sha-d46b4a6cecf5b39d97e978d49c86ee3afc32f0ba` | `sha256:0bf907c0a3e5b680368ef4a6ef94356f5164f039a0778792e4e9b3ca56c1a7ff` | GitHub Actions run 33204879521 — PASS |
| SQ Hub Web | `ghcr.io/imadjinasi/sq-hub-web:sha-d46b4a6cecf5b39d97e978d49c86ee3afc32f0ba` | `sha256:9989ae7de76d3afa43f95637968cc6c4f45c9580d651a97534e9f809ffc414e8` | GitHub Actions run 33204882822 — PASS |

Both staging services were deployed with immutable images using `--no-build --no-deps`. The existing SQ Hub PostgreSQL container/volume was preserved.

## Repository and CI evidence

For the deployed implementation SHA `d46b4a6cecf5b39d97e978d49c86ee3afc32f0ba`:

- CI run #63 / Actions run 33203614522: **SUCCESS**;
- Keycloak Infra run #29 / Actions run 33203614497: **SUCCESS**;
- API/web typecheck, lint, tests, builds, PostgreSQL-backed workspace integration coverage, compose validation, container builds, and visual smoke were green;
- the web source guard asserts that the runtime shell does not implement OIDC access/refresh/ID-token persistence in `localStorage` or `sessionStorage`.

## Live staging evidence matrix

| Scenario | Expected | Actual | Result |
| --- | --- | --- | --- |
| Dedicated Hub OIDC client | `sq-hub-staging` is confidential, Authorization Code only, PKCE S256, with exact staging redirect/origin/logout URLs; existing HCIS clients/audience/mappers remain unchanged. | Client was created in the staging realm with the accepted settings. Existing `hcis-staging`, `hcis-api-staging`, and `sq-hub-api-staging` configuration hashes remained unchanged. | VERIFIED (live) |
| Staging deployment | API and web use the exact immutable candidate and remain healthy. | API health on loopback `18100` passed; web `/healthz` on loopback `18101` passed. | VERIFIED (live) |
| Public edge | `hub-staging.sabilulquran.or.id` resolves to the staging edge, serves TLS through the existing single Caddy edge, and routes public traffic to the Hub web container rather than directly exposing the API. | Public DNS resolved to `103.89.5.4` from both 1.1.1.1 and 8.8.8.8; HTTPS/Caddy passed. | VERIFIED (live) |
| Anonymous entry | Unauthenticated Hub access enters the branded SQ Identity flow. | Opening the Hub without a local session redirected to the staging SQ Identity authorization flow. | VERIFIED (live) |
| Synthetic profile completeness | The existing synthetic identity remains the same identity and its standard profile claim produces the accepted presentation name. | Existing UAT identity was retained; non-secret profile name attributes were corrected to produce `SQ Hub UAT`. No identity recreation was performed. | VERIFIED (live) |
| Fresh authenticated Hub session | Existing synthetic UAT identity can create a fresh Hub session through SQ Identity. | Fresh login completed successfully. | VERIFIED (live) |
| Visible identity | Hub displays `SQ Hub UAT`, derived from standard OIDC profile claims. | Desktop and mobile surfaces displayed exactly `SQ Hub UAT`. | VERIFIED (live) |
| Granted launcher visibility | With final `hcis` Application Access active, only authorized applications are returned/rendered. | HCIS was visible; no unauthorized application was exposed. | VERIFIED (live) |
| Revoke without Hub-session invalidation | Revoking HCIS access removes the launcher on subsequent workspace refresh without ending the Hub identity session. | Hub remained authenticated while HCIS disappeared and the workspace became empty. | VERIFIED (live) |
| Restore on same Hub session | Restoring HCIS access makes the launcher return without requiring a new Hub login. | HCIS reappeared after access restoration on the existing Hub session. | VERIFIED (live) |
| Hub to HCIS SSO | After access restoration, launcher navigation reaches HCIS using the existing SQ Identity SSO session without credential re-entry. | Navigation from Hub to HCIS succeeded without another credential prompt; domain authorization behavior remained HCIS-owned. | VERIFIED (live) |
| Desktop shell | Authenticated live shell remains usable at desktop size. | Desktop sanity check passed. | VERIFIED (live) |
| Mobile shell | Authenticated shell remains usable at approximately 390x844 without horizontal overflow; account affordance, launcher, and bottom navigation remain usable. | Exact narrow viewport check passed. | VERIFIED (live) |
| Browser token storage | Browser implementation must not persist OIDC tokens/codes/verifiers in local/session storage. | Runtime storage inspection was unavailable in the browser-control surface. Automated/static source guard remained green and no browser token-storage implementation exists in the runtime shell source. | VERIFIED BY IMPLEMENTATION / STATIC EVIDENCE |
| Local logout | Account-menu `Keluar` revokes the Hub local session and clears local session state. | Local Hub logout completed successfully. | VERIFIED (live) |
| SQ Identity SSO termination | Logout continues through the provider end-session flow; branded confirmation may remain. | SQ Identity logout confirmation was shown and completed. | VERIFIED (live) |
| Same-browser reopen | After completed SSO logout, reopening the Hub requires authentication. | Same browser required authentication again. | VERIFIED (live) |
| Final Application Access | The controlled revoke test leaves `hcis` restored active. | Final `hcis` Application Access state was active. | VERIFIED (live) |
| Final health/isolation | SQ Hub, Keycloak, and HCIS staging remain healthy; issuer and unrelated configuration remain unchanged; production is untouched. | SQ Hub API/web/PostgreSQL, Keycloak/PostgreSQL, and HCIS API/web/PostgreSQL were healthy. Staging issuer remained unchanged. Production was not operated on. | VERIFIED (live) |
| Cleanup | Temporary security/operator files do not remain after controlled operations. | Temporary subject/security/admin CLI material was removed. | VERIFIED (live) |

## Security and operational notes

1. The staging administrative credential that had been exposed during operator troubleshooting was rotated before final acceptance, prior administrative sessions were invalidated, and temporary recovery/admin material was removed. No credential value is recorded here.
2. The synthetic UAT password was reset through the staging administration path solely to unblock the final fresh-login test. The password value is not recorded here and the account remains synthetic/staging-only.
3. Browser-storage runtime inspection was not available in the controlled browser surface. This is explicitly not represented as live runtime proof; acceptance for that item is based on the automated/static implementation guard that passed on the tested implementation SHA.
4. The Keycloak logout confirmation step remains an accepted non-blocking UX characteristic. The implementation does not bypass provider logout semantics.

## Acceptance decision

**ACCEPT `HUB-IMPL-005` for staging and allow PR #20 to merge once the documentation-only evidence commit passes the normal PR CI/Keycloak gates and the PR head remains unchanged during the guarded merge.**

The acceptance is based on the exact deployed implementation SHA above plus the successful controlled staging UAT covering authentication, presentation identity, server-side Application Access refresh behavior, HCIS SSO navigation, logout/SSO termination, desktop/mobile shell behavior, final access restoration, health/isolation, and production non-interference.

This decision does **not** authorize a production cutover. Production remains a separate explicit approval and deployment activity.