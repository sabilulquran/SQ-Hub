# HUB-IMPL-003 privileged MFA and recovery UAT

**Status:** PREPARED — HUMAN_BROWSER_UAT REQUIRED  
**Scope:** synthetic staging identities only

This runbook proves the privileged-persona TOTP and recovery-authentication acceptance gates without exporting or recording credential material from Keycloak.

## Safety rules

- Use only a synthetic privileged staging identity.
- Never commit or paste the password, TOTP seed/QR payload, recovery authentication code, client secret, access token, refresh token, ID token, session cookie, or raw live OIDC subject.
- Do not use Keycloak Admin API/CLI to read or export credential values for evidence.
- Evidence records boolean outcomes and a redacted synthetic persona handle only.
- A configured authentication flow is prerequisite evidence, not proof that the human flow was actually exercised.

## Preconditions

- exact issuer is `https://login.sabilulquran.or.id/realms/sq-staff-staging`;
- privileged synthetic identity is mapped explicitly to the intended HCIS staging local principal;
- HCIS Application Access is active for the persona;
- Keycloak recovery-code required action/browser-flow prerequisites are green in the existing Keycloak Infra CI;
- operator has custody of the synthetic user's credential material through the normal secure flow.

## TOTP-required acceptance

1. Start a fresh/private browser context and enter HCIS staging through `Masuk dengan SQ Identity`.
2. Authenticate the privileged synthetic identity up to the second-factor stage.
3. Verify the privileged flow cannot complete to an HCIS session without satisfying the configured TOTP requirement.
4. Complete TOTP using the operator-held authenticator through the normal browser UI.
5. Verify HCIS receives the expected local privileged principal and existing HCIS-local authorization remains intact.
6. Record only:

```text
PRIVILEGED_TOTP_REQUIRED_PASS
PRIVILEGED_HCIS_LOCAL_AUTHORIZATION_PASS
```

If the browser can create the privileged HCIS session without required MFA, record `FAIL` and stop Wave 1 closure.

## Recovery-authentication acceptance

1. Use a fresh authentication attempt for the same synthetic privileged identity.
2. Select the supported recovery authentication path presented by Keycloak.
3. Exercise exactly one operator-held recovery authentication code through the browser UI.
4. Verify authentication succeeds and the expected HCIS local principal is reached.
5. Verify the exercised code cannot be reused if the Keycloak flow promises one-time use.
6. Record only:

```text
RECOVERY_AUTHENTICATION_AVAILABLE_PASS
RECOVERY_AUTHENTICATION_EXERCISED_PASS
RECOVERY_CODE_REUSE_DENIED_PASS
```

Do not copy the code into terminal history, screenshots intended for the repository, GitHub issues, PR comments, or evidence files.

## Sanitized evidence record

Use a record shaped like:

```text
persona=privileged_super_admin
synthetic_identifier=<synthetic non-production identifier or redacted handle>
totp_required=PASS
hcis_local_authorization=PASS
recovery_path_available=PASS
recovery_exercised=PASS
recovery_reuse_denied=PASS
credential_material_recorded=NO
```

The result may be added to Wave 1 evidence only after the browser flow has actually been executed. CI cannot produce these PASS markers on behalf of the operator.
