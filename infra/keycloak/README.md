# Akun SQ / Keycloak Staging

Implementation target: `HUB-IMPL-001`.

This directory contains the reproducible, non-secret staging foundation for Akun SQ. It does **not** contain real Staff accounts, client secrets, bootstrap passwords, database passwords, or production data.

## Topology

```text
Internet
  -> HTTPS reverse proxy
  -> login.sabilulquran.or.id (`sq-staff-staging` realm)
  -> shared Caddy edge network (`edge_proxy`)
  -> sq-identity-staging:8080
  -> Keycloak 26.7.2 (production mode / optimized image)
       -> dedicated PostgreSQL staging database

127.0.0.1:8080
  -> VPS-local HTTP smoke/debug binding only

127.0.0.1:9000
  -> Keycloak health/metrics management interface
  -> never proxied publicly
```

The YSQ VPS topology uses the shared Caddy Docker network. A host-Nginx example is retained as an alternative reference. Both public proxy examples block `/admin/` and `/realms/master/`. Administrative work must use a controlled local/VPS path rather than exposing the administration surface through the public login hostname.

## Files

- `Containerfile` — pinned, optimized Keycloak image with health/metrics and SQ theme.
- `docker-compose.staging.yml` — normal staging runtime; contains no bootstrap-admin requirement.
- `docker-compose.bootstrap.yml` — first-bootstrap-only admin override.
- `realm/sq-staff-staging-realm.json` — non-secret realm/client baseline.
- `reverse-proxy.caddy.example` — shared-Caddy configuration for the YSQ VPS edge network.
- `reverse-proxy.nginx.example.conf` — host-Nginx alternative reference.
- `themes/sq-hub/` — SQ login theme derived from the accepted HCIS design baseline; no font files are bundled.
- `scripts/backup.sh` — PostgreSQL custom-format backup.
- `scripts/reconcile-recovery-codes.sh` — idempotent staging-only recovery-code convergence through authenticated `kcadm`.
- `scripts/reconcile-identity-recovery-google.sh` — idempotent, secret-injected Forgot Password, email-login, and safe existing-account Google broker convergence for an explicitly selected Staff realm.
- `scripts/restore-check.sh` — restores a backup to a disposable verification database and checks that the staging realm exists.
- `../../docs/operations/staff-identity-provisioning.md` — minimum profile-complete provisioning contract for manual staging and future automation.
- `providers/karir-identity/`, `themes/sq-karir/`, `realm/sq-karir-desired-state.json`, `scripts/reconcile-karir-realm.sh` — Karir SQ candidate realm; see below.
- `themes/sq-keluarga/`, `realm/sq-keluarga-desired-state.json`, `scripts/reconcile-keluarga-realm.sh` — family realm for SPMB SQ and Keluarga SQ (ADR-0010); same provider; see below.

## Karir SQ candidate realm (`sq-karir`)

Implementation target: `sabilulquran/karir-sq` REC-IMPL-001 §4, SQ Hub ADR-0008. Nothing here is applied to production without explicit owner approval for each step (realm, provider, client, migration).

- **Provider** `providers/karir-identity/` builds `sq-external-identity-1.0.0.jar` (Keycloak 26.7.2, Java 21), shared with `sq-keluarga` (below): `karir-nik-password-form` (NIK + kata sandi), `karir-nik-registration` (registration form action), `karir-verify-whatsapp` (required action), `karir-reset-by-code` (reset by WhatsApp or email code, followed by the built-in `reset-password`), and `karir-event-listener`. Keycloak stores only `nik_hmac`; the NIK is never stored, logged, put in an event, a token or a URL. The username is a random `k_…` ID.
- **Theme** `themes/sq-karir/login` (parent `sq-hub`): the Akun SQ look with the app name "Karir", light and dark.
- **Realm** `scripts/reconcile-karir-realm.sh` converges `realm/sq-karir-desired-state.json` with authenticated `kcadm` (`KEYCLOAK_EXEC_MODE=compose|host|container`) and refuses every realm except `sq-karir`. Run it twice; the second run must create nothing.
- **Staff clients** (`karir-sq` in `sq-staff`) are created with the Karir SQ Mi8 release, not here.

Provider environment (Keycloak process; missing values fail closed):

| Variable | Value |
| --- | --- |
| `SQ_KARIR_NIK_PEPPER` | Same value as Karir SQ `NIK_HMAC_PEPPER`, at least 32 characters |
| `SQ_KARIR_OTP_RELAY_SECRET` | Same value as Karir SQ `OTP_RELAY_SECRET`, at least 32 characters |
| `SQ_KARIR_OTP_RELAY_URL` | Default `http://127.0.0.1:3304/internal/otp-deliveries` |
| `SQ_KARIR_TURNSTILE_SITE_KEY`, `SQ_KARIR_TURNSTILE_SECRET` | Cloudflare Turnstile keys of the foundation account |
| `SQ_KARIR_TURNSTILE_VERIFY_URL` | Default Cloudflare `siteverify`; tests only |

Rate limits are kept in the Keycloak process memory (one node), so a restart resets them. They rely on Keycloak seeing the real client IP (`KC_PROXY_HEADERS=xforwarded` behind an edge that overwrites `X-Forwarded-For` from `CF-Connecting-IP`).

Known Keycloak 26.7.2 limitation: the fine-grained permission `manage` that `karir-identity-admin` needs also allows `reset-password`, and no deny can be layered on top. Karir SQ never calls it; admin events (without representations) record every such call.

## Family realm (`sq-keluarga`)

Implementation target: `sabilulquran/keluarga-sq` KEL-IMPL-001 §4, `sabilulquran/spmb-sq` SPMB-IMPL-001 §4, SQ Hub ADR-0010. Production steps need explicit owner approval, as for `sq-karir`.

- **Same provider.** It picks an identity profile from the realm name: `sq-karir` keeps NIK and everything above; `sq-keluarga` uses the nomor KK (`kk_hmac` with prefix `kk:v1:`), several WhatsApp numbers (`wa_numbers`; `wa_verified` lists the verified ones), `keluarga_source` (`self`, `ppdb`, `staff_broker`) and `f_…` usernames. Any other realm fails closed. Reset offers one channel per number (`whatsapp`, `whatsapp-2`, …); events in `sq-keluarga` carry `wa_hash` = HMAC(`"wa:v1:+628…"`) so Keluarga SQ can tell which parent's number was used.
- **Theme** `themes/sq-keluarga/login` (parent `sq-karir`): field `kk`, title "SPMB" for client `spmb-keluarga` and "Keluarga" otherwise, and "Masuk dengan Akun SQ" when the staff identity provider is configured.
- **Realm** `scripts/reconcile-keluarga-realm.sh` converges `realm/sq-keluarga-desired-state.json`: clients `keluarga-web`, `spmb-keluarga`, `keluarga-identity-admin`, and, when `KELUARGA_STAFF_BROKER_ISSUER` and `KELUARGA_STAFF_BROKER_CLIENT_SECRET` are set, the `sq-staff` identity provider with first-broker flow `keluarga-staff-first-broker` (username `s_<staff sub>`). It refuses every realm except `sq-keluarga`. The broker client `sq-keluarga-broker` in `sq-staff` is created separately.

| Variable | Value |
| --- | --- |
| `SQ_KELUARGA_KK_PEPPER` | Same value as Keluarga SQ's KK pepper, at least 32 characters |
| `SQ_KELUARGA_OTP_RELAY_SECRET` | Same value as Keluarga SQ's relay secret, at least 32 characters |
| `SQ_KELUARGA_OTP_RELAY_URL` | Default `http://127.0.0.1:3306/internal/otp-deliveries` (Keluarga SQ; it sends through Kirim SQ) |
| `SQ_KELUARGA_TURNSTILE_SITE_KEY`, `SQ_KELUARGA_TURNSTILE_SECRET`, `SQ_KELUARGA_TURNSTILE_VERIFY_URL` | As for `sq-karir` |

Rate limits are counted separately per realm. The JAR is now named `sq-external-identity.jar`; a Mi8 release must remove the old `sq-karir-identity.jar` from the providers directory so Keycloak does not load two copies.

## Runtime image and shared-VPS sizing

GitHub-hosted CI builds and publishes the optimized staging image to GHCR. The shared YSQ staging VPS should **pull** that image and start it with `--no-build`; do not compile the Keycloak image on the memory-constrained shared host.

The current staging default is `KEYCLOAK_MEMORY_LIMIT=768m` plus `KEYCLOAK_DB_MEMORY_LIMIT=192m`. This is intentionally a staging compromise for the current shared VPS, not a production sizing recommendation. Reassess memory before production or meaningful load testing.

## Prepare staging secrets

Create a local VPS-only file from `.env.example`:

```bash
cp infra/keycloak/.env.example infra/keycloak/.env.staging
chmod 600 infra/keycloak/.env.staging
```

Set strong values for:
- `KEYCLOAK_DB_PASSWORD`;
- `KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME`;
- `KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD`.

Confirm `EDGE_NETWORK` points to the existing shared Caddy Docker network, normally `edge_proxy`.

`.env.staging` must never be committed.

## First bootstrap only

Pull the prebuilt image first:

```bash
docker compose \
  --env-file infra/keycloak/.env.staging \
  -f infra/keycloak/docker-compose.staging.yml \
  -f infra/keycloak/docker-compose.bootstrap.yml \
  pull
```

The bootstrap administrator is injected only when the bootstrap override is explicitly included:

```bash
docker compose \
  --env-file infra/keycloak/.env.staging \
  -f infra/keycloak/docker-compose.staging.yml \
  -f infra/keycloak/docker-compose.bootstrap.yml \
  up -d --no-build
```

Verify readiness from the VPS:

```bash
curl --fail http://127.0.0.1:9000/health/ready
```

Verify the issuer after DNS/TLS/reverse proxy is active:

```bash
curl --fail \
  https://login.sabilulquran.or.id/realms/sq-staff-staging/.well-known/openid-configuration
```

Before removing bootstrap credentials, establish and verify the named administrative/recovery path required by the security baseline. Do not reuse a daily Staff identity as the bootstrap/emergency administrator.

After that path is verified, restart using **only** the normal staging compose file:

```bash
docker compose \
  --env-file infra/keycloak/.env.staging \
  -f infra/keycloak/docker-compose.staging.yml \
  up -d --no-build
```

Then remove/rotate the bootstrap-admin values from operational secret storage. The normal compose file does not require them for subsequent restarts.

## Realm baseline

The imported staging realm is `sq-staff-staging` and currently establishes:
- self-registration disabled;
- NIP/username login with unique email alternate capability;
- no duplicate email;
- Remember Me disabled;
- SSO idle 8 hours;
- SSO max 12 hours;
- access token 5 minutes;
- minimum password length 12 and password != username;
- brute-force protection baseline around 5 failures / temporary wait;
- TOTP policy;
- HCIS browser client, SQ Hub API audience, and dedicated HCIS service client;
- SQ login theme.

Email login is only acceptable for identities provisioned with a verified/controlled email according to the Staff Authentication Policy. Self-registration is disabled, so provisioning must enforce that invariant.

Native Forgot Password is enabled in the reproducible realm baseline. Delivery still depends on the separately configured realm SMTP service; no SMTP credential is stored here. Google sign-in is intentionally absent from the import JSON because its client credentials are production-only runtime inputs. See `docs/operations/HUB-IMPL-011-production-handoff.md` for the controlled reconciliation and exact redirect URI.

## Staff profile completeness

Before a normal Staff identity is considered provisioned, both Keycloak `firstName` and `lastName` must be populated together with the accepted login identifier and controlled email state. Do not rely on the end user to repair administrator-owned omissions through an unexpected first-login profile-completion screen.

The exact operational sequence and synthetic-user guardrails are defined in `docs/operations/staff-identity-provisioning.md`. Future SQ Admin Center/provisioning automation must enforce the same rule before reporting provisioning success or granting application access.

Do not disable Keycloak profile validation globally to hide incomplete provisioning. Required actions remain valid when they are intentional security/user workflows.

### Recovery codes

Keycloak 26.7 supports recovery authentication codes. `CONFIGURE_TOTP` is configured to add recovery-code setup when the recovery-code required action/browser-flow option is enabled. The runtime operator must verify the following in staging before `HUB-IMPL-001` is declared complete:

1. Recovery Authentication Codes required action is enabled.
2. `Recovery Authentication Code Form` in the conditional 2FA browser flow is `Alternative` rather than `Disabled`.
3. A privileged synthetic user that enrolls TOTP is also required to save recovery codes.
4. A saved recovery code can be used through `Try Another Way` when TOTP is unavailable.

Do not claim this acceptance item from the realm JSON alone; verify it in running staging.

Startup `--import-realm` imports a realm only when it does not already exist. The shared staging realm uses persistent PostgreSQL state, so changing the imported JSON or restarting Keycloak does not converge these settings into that existing realm. Run the source-controlled reconciliation after initial bootstrap and whenever an existing staging realm must be converged.

The script accepts only the exact `sq-staff-staging` realm and uses a pre-authenticated `kcadm` configuration inside the Keycloak container. Create that short-lived configuration from the controlled VPS terminal. Omitting `--password` makes `kcadm` prompt locally; never put a password or token in the command line, shell history, repository, or evidence:

```bash
docker compose \
  --env-file infra/keycloak/.env.staging \
  -f infra/keycloak/docker-compose.staging.yml \
  exec keycloak \
  /opt/keycloak/bin/kcadm.sh config credentials \
  --config /tmp/sq-hub-recovery-codes.kcadm \
  --server http://127.0.0.1:8080 \
  --realm master \
  --user <REVIEWED_STAGING_ADMIN>
```

Run the reconciliation twice. The second run proves that the accepted state is idempotent:

```bash
KEYCLOAK_ENV_FILE=infra/keycloak/.env.staging \
KEYCLOAK_KCADM_CONFIG=/tmp/sq-hub-recovery-codes.kcadm \
  bash infra/keycloak/scripts/reconcile-recovery-codes.sh

KEYCLOAK_ENV_FILE=infra/keycloak/.env.staging \
KEYCLOAK_KCADM_CONFIG=/tmp/sq-hub-recovery-codes.kcadm \
  bash infra/keycloak/scripts/reconcile-recovery-codes.sh
```

Expected sanitized output from the second run is exactly:

```text
RECOVERY_REQUIRED_ACTION_ENABLED_PASS
RECOVERY_BROWSER_FLOW_ALTERNATIVE_PASS
OTP_BROWSER_FLOW_ALTERNATIVE_PASS
RECOVERY_RECONCILE_IDEMPOTENT_PASS
```

The script enables `CONFIGURE_RECOVERY_AUTHN_CODES` with `defaultAction=false`, changes only the bound Browser flow's `auth-recovery-authn-code-form` execution to `ALTERNATIVE`, and refuses to proceed unless the existing `auth-otp-form` execution is exactly `ALTERNATIVE`. It does not assign the required action to any user, modify TOTP/password policy, or touch clients, sessions, Application Access, HCIS roles, or another realm.

Remove the short-lived authenticated configuration after verification:

```bash
docker compose \
  --env-file infra/keycloak/.env.staging \
  -f infra/keycloak/docker-compose.staging.yml \
  exec -T keycloak \
  rm -f /tmp/sq-hub-recovery-codes.kcadm
```

Do not record `kcadm` configuration contents, administrator credentials, tokens, TOTP material, recovery codes, raw user subjects, or client secrets. Recovery-code enrollment and a separate-browser authentication check for the controlled synthetic privileged identity remain mandatory before granting Platform Administrator.

## Public reverse proxy

For the existing YSQ VPS Docker topology, use `reverse-proxy.caddy.example` and ensure both Caddy and Keycloak are attached to the same `edge_proxy` network. The Keycloak container publishes the alias `sq-identity-staging` for this purpose.

`reverse-proxy.nginx.example.conf` remains available for a host-Nginx deployment. The localhost `127.0.0.1:8080` binding is retained for VPS-local smoke/debug use and for that alternative topology; it is not the preferred Caddy data path.

Required invariants for either proxy:
- TLS terminates at the supported reverse proxy;
- only the public login/OIDC surface is exposed;
- `/admin/` and `/realms/master/` are not exposed on the public login host;
- management port `9000` is not proxied externally;
- forwarded headers are overwritten by the trusted proxy;
- Keycloak runs with explicit hostname and `xforwarded` proxy-header handling.

## Backup and restore rehearsal

Create a backup:

```bash
KEYCLOAK_ENV_FILE=infra/keycloak/.env.staging \
  bash infra/keycloak/scripts/backup.sh
```

Restore-check a selected dump into a disposable database:

```bash
KEYCLOAK_ENV_FILE=infra/keycloak/.env.staging \
  bash infra/keycloak/scripts/restore-check.sh infra/keycloak/backup/<file>.dump
```

The restore check never overwrites the live staging database.

A backup is not considered proven until restore-check succeeds. Staging rollout must record the executed backup/restore evidence.

## CI vs shared staging

GitHub CI is allowed to run Keycloak with an explicit `http://127.0.0.1` hostname only as an isolated smoke environment. CI creates a disposable `edge_proxy` network so the shared-Caddy attachment is exercised without exposing a public listener. That test proves image build, realm import, health, policy/client configuration, network attachment, and backup/restore mechanics.

CI success does **not** prove:
- the real VPS DNS/TLS/reverse proxy;
- resource headroom on the YSQ VPS;
- real staging MFA/recovery-code UX;
- actual administrative ingress restrictions;
- production readiness.

Those items require the shared staging deployment and recorded runtime verification.

## Production guardrail

This configuration is staging-only. Do not point production HCIS at `sq-staff-staging`, copy synthetic credentials into production, or promote the staging database as production data. Production identity configuration/version pinning remains a separate reviewed change after Wave 1 staging evidence.
