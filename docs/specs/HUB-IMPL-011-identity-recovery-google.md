# HUB-IMPL-011 — Akun SQ recovery and Google sign-in

**Status:** ACCEPTED
**Product:** Akun SQ
**Area:** Staff authentication UX / identity brokering
**Depends on:** ADR-0003, ADR-0005, `HUB-IMPL-010`, `docs/security/staff-authentication-policy.md`, `docs/security/security-baseline.md`

## Outcome

Add Keycloak-native self-service password recovery and Google sign-in to the existing Akun SQ Staff realm without changing the OIDC issuer/subject identity key, Application Access, Platform Administrator, or domain authorization.

## Password recovery

- The login page displays **Lupa password?**.
- Recovery uses Keycloak Reset Credentials and the realm SMTP configuration.
- Keycloak owns expiry, one-time action-token handling, password policy, and credential replacement.
- No application-owned reset endpoint, browser token storage, credential logging, or committed SMTP secret is introduced.

## Google sign-in

- The login page displays **Masuk dengan Google** through Keycloak's native Google identity provider renderer.
- Provider alias is exactly `google`; the production redirect URI is `https://login.sabilulquran.or.id/realms/sq-staff/broker/google/endpoint`.
- Client ID and client secret are runtime-only operator inputs. The secret is never committed or copied into review evidence.
- First broker login accepts only a unique existing Akun SQ account, asks the user to confirm linking, and requires local username/password re-authentication. Automatic user creation is absent from the flow.
- Google email is used only to locate a candidate existing account. A successful Google assertion alone cannot link the identity; local account ownership must be proven.
- The provider uses import sync, stores no Google token, exposes no stored token, and has no role/group/attribute-to-role mapper.
- A conditional post-broker MFA flow applies the accepted Staff policy: users who already have TOTP configured are challenged. Privileged identities remain subject to the existing provisioning/enforcement policy; ordinary Staff are not silently assigned privilege or forced into a new policy.

## Email alternate login

`loginWithEmailAllowed=true` and `duplicateEmailsAllowed=false` are converged explicitly for the persistent realm. Provisioning remains responsible for controlled, unique, verified email. Applications continue to bind identities only by exact `issuer + sub`.

## Deployment boundary

Repository changes provide an immutable theme/image and idempotent realm reconciliation. Applying the reconciliation to production, entering Google credentials, and validating SMTP are separate authorized operations. This implementation task performs no production mutation and does not use staging as a release gate.

## Acceptance

1. Fresh realm configuration and persistent-realm reconciliation enable native password reset and email alternate login.
2. Login rendering contains `Lupa password?` while retaining the Akun SQ theme.
3. Google configuration contains no committed secret and renders `Masuk dengan Google` only after runtime provider configuration.
4. The Google first-login flow has no create-user or automatic-link authenticator and requires detect-existing, confirm-link, and local password re-authentication.
5. The Google post-login flow conditionally requires the user's configured TOTP.
6. Google configuration stores no upstream token and creates no privilege mapper.
7. Existing issuer, client, HCIS mapping, Application Access, Platform Administrator, and domain-role semantics remain unchanged.

## Non-goals

- production mutation or deployment;
- automatic Google-account provisioning;
- Google claims as authorization data;
- HCIS authorization or account remapping;
- trusted-device TOTP behavior, which is specified separately by `HUB-IMPL-012`.
