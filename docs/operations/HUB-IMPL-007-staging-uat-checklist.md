# HUB-IMPL-007 staging UAT checklist

**Scope:** Go 5A / SQ Admin Center access foundation  
**Environment:** shared staging only  
**Production:** not authorized

## Preconditions

- use synthetic staging identities only;
- use the immutable API + web images from the exact candidate commit;
- deploy through the existing `sq-hub-staging` Compose project without building source on the VPS;
- do not change HCIS authorization, HCIS Application Access, production, or Keycloak realm/client security configuration;
- before granting Platform Administrator, verify the synthetic privileged identity has TOTP and recovery path configured through the accepted SQ Identity operational process;
- never record a password, TOTP secret, recovery code, OIDC subject, session cookie, token, or client secret in UAT evidence.

## Operator path

Normal platform-admin mutation uses the compiled CLI, never ad-hoc SQL:

```text
node apps/api/dist/cli/platform-admin.js show ...
node apps/api/dist/cli/platform-admin.js grant ... --reason <non-empty> --actor <operator-ref>
node apps/api/dist/cli/platform-admin.js revoke ... --reason <non-empty> --actor <operator-ref>
```

Supply the exact staging issuer and subject only inside the controlled operator session. Do not paste the subject into tickets, PR comments, or UAT evidence.

## Required live cases

1. Ordinary synthetic Staff fresh login: Hub works; `Administrasi SQ` is not enabled; direct `/admin` is denied.
2. Verify TOTP + recovery enrollment for the privileged synthetic identity before grant.
3. Establish an ordinary Hub session for that identity, then grant Platform Administrator through the supported CLI with actor + reason.
4. The existing pre-grant session remains unable to use Admin Center and receives the privileged reauthentication state.
5. Sign out and sign in again through SQ Identity; confirm MFA challenge occurs.
6. Fresh privileged session shows `Administrasi SQ`; `/admin` loads the read-only application/access/audit overview.
7. HCIS launcher/access remains exactly as separately controlled by Application Access.
8. With the privileged Hub session still active, revoke Platform Administrator through the CLI.
9. The next protected admin request is denied immediately; ordinary Hub workspace remains usable.
10. Grant/revoke audit events exist and contain no credentials/secrets.
11. Desktop and approximately 390x844 Admin Center layouts are usable with no horizontal overflow.
12. Production remains untouched.

## Evidence labels

Record only PASS/FAIL and non-secret operational references for:
- candidate commit and immutable image digests;
- migration/health checks;
- ordinary-user denial;
- pre-grant-session reauthentication requirement;
- fresh privileged MFA login;
- authorized Admin Center overview;
- HCIS/Application Access separation;
- immediate platform-admin revocation;
- ordinary Hub continuity;
- audit presence/redaction;
- desktop/mobile visual check;
- production isolation.
