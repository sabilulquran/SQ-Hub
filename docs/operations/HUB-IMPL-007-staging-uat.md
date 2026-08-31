# HUB-IMPL-007 staging UAT

**Scope:** Go 5A — SQ Admin Center access foundation  
**Environment:** staging only  
**Production:** not authorized

## Safety rules

- Use synthetic Staff identities only.
- Do not record passwords, TOTP seeds, recovery codes, raw OIDC subjects, session cookies, tokens, authorization codes, PKCE material, or administrative credentials in UAT evidence.
- Resolve the target identity through the accepted Staff identity provisioning/operator process and keep the exact subject only in the controlled operator terminal.
- Do not grant or change HCIS/domain roles for this UAT.
- Do not represent Platform Administrator as Application Access or as a Keycloak role.
- Do not use raw SQL as the normal grant/revoke path.

## Preconditions

Before granting Platform Administrator:

1. SQ Hub staging and SQ Identity staging are healthy.
2. The synthetic privileged target is an existing Staff identity with complete staging profile.
3. TOTP is enrolled and a recovery path exists for the target identity as required by the Staff Authentication Policy.
4. The target has an ordinary Hub session created **before** the platform-admin grant so the reauthentication boundary can be proven.
5. Record the exact candidate API/web image refs and commit SHA in evidence, but never credentials or the raw subject.

## Supported operator path

Run the platform-admin CLI inside the staging API container or another controlled environment with the same staging database configuration.

Conceptual commands:

```bash
node apps/api/dist/cli/platform-admin.js show \
  --issuer <STAFF_ISSUER> \
  --subject <CONTROLLED_SYNTHETIC_SUBJECT>

node apps/api/dist/cli/platform-admin.js grant \
  --issuer <STAFF_ISSUER> \
  --subject <CONTROLLED_SYNTHETIC_SUBJECT> \
  --reason "HUB-IMPL-007 synthetic staging UAT" \
  --actor <OPERATOR_REF> \
  --actor-kind human

node apps/api/dist/cli/platform-admin.js revoke \
  --issuer <STAFF_ISSUER> \
  --subject <CONTROLLED_SYNTHETIC_SUBJECT> \
  --reason "HUB-IMPL-007 synthetic staging UAT cleanup" \
  --actor <OPERATOR_REF> \
  --actor-kind human

node apps/api/dist/cli/platform-admin.js audit \
  --issuer <STAFF_ISSUER> \
  --subject <CONTROLLED_SYNTHETIC_SUBJECT> \
  --limit 20
```

The subject placeholder above must not be copied into committed evidence after execution.

## UAT matrix

### A. Ordinary user boundary

With an ordinary synthetic Staff identity that is not Platform Administrator:

- normal SQ Hub workspace opens;
- no actionable `Administrasi SQ` navigation is shown;
- direct `/api/admin/context` or `/api/admin/applications` request is denied;
- direct `/admin` navigation does not expose registry/admin data;
- HCIS launcher behavior remains based only on Application Access.

### B. Grant and stale-session boundary

Using the synthetic privileged target whose Hub session predates the grant:

1. verify TOTP + recovery precondition through the accepted SQ Identity operational process;
2. grant Platform Administrator through the supported CLI with actor and non-empty reason;
3. verify the pre-grant Hub session does not inherit the new privilege;
4. `/api/admin/context` returns `403 ADMIN_REAUTH_REQUIRED` for that stale session;
5. ordinary Hub workspace remains usable.

### C. Fresh privileged login

1. End the stale Hub/SSO session using the normal logout path.
2. Establish a fresh Hub login after the grant.
3. Confirm SQ Identity challenges the privileged synthetic identity for MFA.
4. After successful MFA, verify:
   - `Administrasi SQ` navigation is available;
   - `/admin` opens;
   - read-only Application Registry is staging-local;
   - no Application Access/user/domain mutation controls are active;
   - no raw subject or secret is rendered in the browser.

### D. Immediate revocation

While the privileged Hub session remains otherwise valid:

1. revoke Platform Administrator through the supported CLI;
2. the next `/api/admin/*` request is denied with `403 ADMIN_FORBIDDEN`;
3. `Administrasi SQ` capability disappears on the next workspace refresh;
4. ordinary SQ Hub workspace remains usable;
5. HCIS Application Access and HCIS domain authorization are unchanged;
6. the global SQ Identity account remains enabled.

### E. Audit

Verify the platform audit contains grant and revoke events with:

- actor;
- stable platform-admin action;
- opaque target reference;
- outcome;
- supplied reason;
- timestamp.

Evidence must not contain the raw synthetic subject, password, MFA material, cookies, tokens, or client/admin secrets.

### F. Visual / responsive

Verify both SQ Hub and `/admin` at minimum:

- desktop approximately 1440x900;
- mobile approximately 390x844;
- HCIS-aligned YSQ branding remains intact;
- account trigger remains usable;
- no horizontal overflow;
- Admin Center clearly communicates that platform administration does not grant domain business authority.

## Cleanup

- Leave the synthetic Platform Administrator membership revoked after UAT unless another reviewed staging test explicitly requires it.
- Do not disable the synthetic global identity merely to clean up the platform role.
- Do not revoke unrelated Application Access.
- Preserve audit evidence.

## Acceptance evidence

Record only:

- tested commit SHA and immutable image references/digests;
- CI status;
- ordinary-user denial result;
- stale-session `ADMIN_REAUTH_REQUIRED` result;
- fresh-login MFA challenge result;
- authorized read-only Admin Center result;
- immediate revocation result;
- ordinary Hub/HCIS continuity result;
- audit safety result;
- desktop/mobile visual result;
- confirmation that production was untouched.
