# Organization Directory runtime — HUB-IMPL-018

Repository implementation only. No merge, deployment, production export activation,
Keycloak provisioning, or Aset SQ endpoint connection is performed by this change.

## Reviewed dependency heads

| Dependency | Reviewed head | Evidence |
| --- | --- | --- |
| SQ Hub contract PR #97 | `523a8f913fa4f7a3bd5b95a20f2e184fb3bc5ed1` | [PR](https://github.com/sabilulquran/SQ-Hub/pull/97), [CI](https://github.com/sabilulquran/SQ-Hub/actions/runs/35945235492) |
| HCIS producer PR #86 | `f66fe8597b16c36af98cc1bf56230cbe5bef221e` | [PR](https://github.com/sabilulquran/hcisysq/pull/86), [CI](https://github.com/sabilulquran/hcisysq/actions/runs/35945479950) |

Review confirmed full-snapshot endpoint, Jakarta date, stable namespaces, explicit
person deactivation, inclusive membership/incumbency resolution, export default OFF,
dedicated audience/client/scope verification, strict privacy projection, and digest
order. HCIS's exact person shape carries `active` and `employmentStatus`, not a
separate employee `status` field; Hub does not invent one. HCIS validates references
but Hub additionally rejects duplicates, invalid calendar dates, hierarchy cycles,
ambiguous identity mappings, mismatched counts/digest, and source regression.

HCIS loads employee/identity facts after selecting the organization snapshot.
The Hub validates the complete returned payload before apply; this does not claim
a transactionally frozen HCIS source export across concurrent authoring. Re-pull
reconciles later source changes. No producer edits are included here.

Golden fixture was generated using the pinned producer's actual build function
and synthetic test source, not the Hub digest implementation:
`node tools/organization-directory-fixture.mjs`. Generation requires `gh` access to
the repository, not a running HCIS endpoint. Tests use the committed fixture offline.
Its digest is `sha256:3b14cbf84ed7634068053692288620675da8b3d16e6b458823cf3f696eaeca39`.
Recheck both PR heads before review/activation; if either changes, re-review schema,
producer canonicalization and fixture before claiming compatibility.

## Configuration and provisioning still required

All environments keep Hub sync/read gates and HCIS export OFF initially. Compose
passes optional variables without requiring credentials while disabled.

| Hub variable | Provisioned value when enabled |
| --- | --- |
| `ORG_DIRECTORY_SYNC_ENABLED` | `1` only after source and credentials are accepted; default `0` |
| `ORG_DIRECTORY_READ_ENABLED` | `1` only after reader provisioning/bootstrap verification; default `0` |
| `KEYCLOAK_ISSUER` | Exact environment realm HTTPS issuer |
| `ORG_DIRECTORY_HCIS_BASE_URL` | Environment's HCIS HTTPS origin; no query/userinfo/fragment |
| `ORG_DIRECTORY_CLIENT_ID` | Dedicated `sq-hub-organization-directory` (environment-specific registration) |
| `ORG_DIRECTORY_CLIENT_SECRET` | Secret-manager injection, never browser/log/source control |
| `ORG_DIRECTORY_READ_AUDIENCE` | Recommended `sq-hub-organization-directory`, distinct from producer audience |
| `ORG_DIRECTORY_READ_CLIENTS` | Explicit comma-separated allowlist, e.g. `aset-sq-directory`; no browser clients |

Operator provisioning checklist (not executed):
1. Create separate confidential Keycloak clients per environment for Hub pull and
   each approved reader. Enable service accounts/client credentials only; disable
   standard, implicit, direct-access/password grants. Do not grant realm-admin,
   manage-users, profile-directory Admin API roles, or human sessions.
2. Hub pull identity gets only `organization-directory.read` and audience
   `hcis-organization-directory`; configure the same issuer/client/scope on HCIS.
   HCIS export remains `ORG_DIRECTORY_EXPORT_ENABLED=0` until Human Capital accepts
   the real ORG-004 structure. Hub never toggles that gate.
3. Reader identity gets only scope `organization-directory.read` and Hub read
   audience. Keep it separate from `aset-sq` user-login and from Hub pull identity.
   Do not enable an Aset adapter until this API is deployed, bootstrapped, and verified.
4. Inject credentials through the established environment secret mechanism and
   test rotation in staging. Verify HTTPS/DNS/egress to HCIS/token/JWKS endpoints.
5. Apply Hub migration with the existing migration owner. Runtime directory needs
   SELECT/INSERT/UPDATE on `organization_directory_projection`, SELECT/INSERT on
   `organization_directory_sync_attempts`, and no DDL, HCIS database access, or DELETE.
   Existing Hub runtime permissions for its other modules are unchanged. Consumers
   get HTTP access only, never a Hub DB credential. Migration revokes PUBLIC access.
6. Confirm trusted clock/NTP, resource limits, alerting, and restricted backups.

## Migration and synthetic verification

`0006_organization_directory.sql` adds two new Hub tables and an attempt-time index.
No existing HCIS or Hub authoritative data is modified. Empty projection is normal;
enabled authorized reads return `503 DIRECTORY_UNAVAILABLE` until first success.
Existing checksum migration runner ensures repeat application is a no-op.

Use a disposable **local synthetic database**, explicitly setting `DATABASE_URL`.
Never run the integration tests against staging/production business data (tests truncate tables).

```sh
npm ci
npm run migrate
npm run migrate
npm run typecheck
npm run lint
npm run test
npm run build
```

The directory integration suite verifies actual PostgreSQL commit/rollback,
concurrent lock-before-fetch, old projection visibility during pull, invalid payload
rejection, deactivation/tombstones/reappearance, idempotent retry, revision regression,
and a synthetic DB trigger that forces failure after the projection write. It removes
that trigger in `finally` and proves the subsequent full pull succeeds.

## Operator reconciliation and status

Source checkout commands (environment injected, do not place credentials in shell history):

```sh
npm --workspace @sq-hub/api run directory:admin -- status
npm --workspace @sq-hub/api run directory:admin -- reconcile
```

Built-image equivalents:

```sh
node apps/api/dist/cli/organization-directory.js status
node apps/api/dist/cli/organization-directory.js reconcile
```

Reconcile requires the sync gate and always requests the current Asia/Jakarta date.
It cannot write HCIS or backdate the current directory. A concurrent run reports
`BUSY` with nonzero exit; retry later. Success returns safe attempt metadata.
Status emits only freshness/counts/latest attempt; it never prints person rows.
Disabling sync while keeping read enabled preserves LKG and honestly becomes stale.

## Observability and incident response

Persisted attempts contain correlation ID, start/finish, outcome, validated source
revision/version/asOf/counts where available, error category and last-success time.
Rejected unvalidated source metadata is nullable. Logs never contain source response
body, schema error values, token, credential, names, NIP, or identity subjects.
API request serialization suppresses directory URL query and identifier path segments.
Reverse proxy/APM operators must also disable/redact directory query/path logging;
application redaction cannot sanitize an upstream proxy's access logs.

Alert when no LKG exists after bootstrap, status becomes stale at 15 minutes, or
attempts report auth/contract/storage errors. At exact 15 minutes `stale=true` and
`staleForSeconds=0`; it then counts time beyond the threshold. `/health` remains
process health, not a false claim of directory freshness. An unavailable HCIS does
not stop read service. No hard expiry deletes LKG.

| Category | Operator response |
| --- | --- |
| `source_unavailable` | Check network/export gate/producer; next full pull in 5 minutes |
| `source_auth` | Fix issuer/audience/client/scope/secret, no aggressive retry |
| `source_request` | Scheduler stops; fix request/config, manually reconcile and restart scheduler |
| `contract_validation` | Compare pinned contracts, repair source through HCIS authoring; never bypass validator |
| `source_regression` | Check source restore/revision or clock/date regression; preserve LKG and investigate |
| `storage` | Check Hub DB availability/capacity/permissions; preserve projection and reconcile after repair |

Attempt/history retention remains TBD. No automatic purge policy is invented.
Monitor storage and establish an approved retention/access policy before production.

## Recovery and rollback plan

Before activation, rehearse on synthetic staging data:
1. Bootstrap, confirm digest/counts, retry UNCHANGED, and verify read auth and identity
   exact match. Stop source access and verify LKG plus 15-minute staleness.
2. Back up the two directory tables together with the established Hub backup policy.
   Backup contains minimum directory personal data; restrict access and encryption.
   Restore into an isolated test database and verify status/digest before reconnecting.
3. Force invalid snapshot or apply failure: projection/version/synchronizedAt must
   remain unchanged. Correct source/config and reconcile; never write HCIS from Hub.

Routine rollback: set sync OFF, preserve directory tables, roll back runtime release.
Readers can continue with LKG if runtime stays enabled. If the code release removes
read routes, disable consumer feature paths explicitly; never fall back to live HCIS.
Leave the additive migration and its history record in place. Do not drop tables as
part of rollback and do not reset `synchronized_at` to disguise restored stale data.

If Hub projection storage is lost, restore the verified backup to preserve tombstone
continuity, then full reconcile. Fresh HCIS bootstrap rebuilds present facts but
cannot recover historical source-absent tombstones without a backup; consumers must
handle that limitation explicitly. If HCIS is restored to an older revision, publish
an accepted newer correction or obtain a separately reviewed paired recovery plan;
the automatic regression guard is not disabled by this runbook.

Activation acceptance is separate work: merge approvals, migration/backup evidence,
service identities, approved HCIS source, live authenticated bootstrap, monitoring,
and only then consumer onboarding. This PR stops review-ready.
