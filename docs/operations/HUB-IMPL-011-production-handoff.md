# HUB-IMPL-011 production handoff

**Scope:** operator steps after reviewed artifacts are merged. This document does not authorize production mutation or rollback.

## Immutable inputs

- Production realm: `sq-staff`
- Issuer: `https://login.sabilulquran.or.id/realms/sq-staff`
- Google provider alias: `google`
- Google OAuth redirect URI: `https://login.sabilulquran.or.id/realms/sq-staff/broker/google/endpoint`
- Google OAuth application type: Web application

Verify the merged source SHA and immutable Keycloak image digest before any realm change. Back up Keycloak and retain the existing SMTP configuration. Never use the staging realm/database as a production input.

## Google Cloud Console owner steps

1. In the owner-controlled Google Cloud project, configure the OAuth consent screen for the intended Sabilul Qur'an Staff audience.
2. Create an OAuth 2.0 Client ID of type **Web application**.
3. Add exactly `https://login.sabilulquran.or.id/realms/sq-staff/broker/google/endpoint` as an authorized redirect URI.
4. Record the client ID and secret only in the approved production secret store. Do not paste the secret into chat, tickets, Git, screenshots, or shell history.

## Controlled realm reconciliation

Authenticate `kcadm` from the controlled production host using the approved administrator path and a short-lived config file. Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` into a root-readable runtime environment file or inject them from the secret store. Run `infra/keycloak/scripts/reconcile-identity-recovery-google.sh` twice with `KEYCLOAK_REALM=sq-staff`; the second result must be identical and contain only the five `*_PASS` markers.

The script converges only:

- native Forgot Password;
- unique email alternate login;
- the link-only-existing Google first-login flow;
- conditional post-Google TOTP;
- the native Google provider.

It does not change SMTP, issuer, clients, users, credentials, roles, Application Access, Platform Administrator, or HCIS mapping.

## Controlled acceptance

Use approved production test identities and do not capture secrets/tokens/cookies:

1. NIP login succeeds.
2. Verified unique email alternate login succeeds.
3. **Lupa password?** sends through the existing SMTP sender and the link is single-use/expired according to Keycloak policy.
4. A Google identity matching no existing Akun SQ user is rejected and no user is created.
5. First link requires confirmation and local password proof; a configured TOTP user is challenged.
6. Future Google login resolves to the same Keycloak user ID and exact HCIS `issuer + sub` mapping.
7. Google does not add realm/client roles, Application Access, Platform Administrator, or HCIS roles.
8. Disabled users cannot create a session, and HCIS OIDC regression remains **NO**.

Remove the short-lived `kcadm` configuration and runtime secret material after acceptance. Rollback decisions remain owner-only.
