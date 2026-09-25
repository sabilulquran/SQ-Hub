# HUB-IMPL-018 production acceptance — 2026-09-25

## Status

**CLOSED — SQ Hub Organization Directory runtime accepted on 25 September
2026.**

This ledger collects sanitized evidence for HCIS -> SQ Hub -> Aset SQ production
acceptance. It must not contain tokens, secrets, person rows, names, NIP, email,
or raw production response bodies.

## Evidence already verified

### Contract, implementation, and deployment

- SQ Hub PR #97 merged the accepted HUB-IMPL-018 contract as merge commit
  `9c0e19e5cd478c582859d07695cb819fb98805f3`.
- SQ Hub PR #98 merged the Directory runtime/read API as merge commit
  `7f94bcdfc28df417cba7122bd58baecfccaaeea8`; reviewed API source is
  `623b81525a02ae1803012945e2941fbc285c7b51`.
- Deploy SQ Hub Production run `35956645261` completed successfully on
  24 September 2026. Its sanitized log records:
  - `applied 0006_organization_directory.sql`;
  - `API_MIGRATION_PASS source=623b81525a02ae1803012945e2941fbc285c7b51`;
  - API image digest
    `sha256:a09fa81621c85e5548e5753e378e63753a4beb453e6f0c63280d953ca82a675f`;
  - `API_DEPLOY_PASS source=623b81525a02ae1803012945e2941fbc285c7b51`;
  - terminal `SQ_HUB_PRODUCTION_DEPLOY_PASS`.
- Post-merge `main` CI run `35956308762` passed.
- Acceptance-ledger exact-head CI run `36087933188` passed on 25 September
  2026, including migration/idempotency, typecheck, lint, tests, builds,
  staging Compose validation, image builds, and desktop/mobile visual smoke.
- The subsequent documentation-only acceptance head `f33d3a4` passed CI run
  `36088096836` with the same Foundation quality gate.
- PR #99 merged the completed acceptance ledger, staging rehearsal, Keycloak
  client reconciliation, and scheduler hardening into `main` as
  `1d6ce622bb619adee6c09ca24ac80d0adbad1f71`. Its exact PR head passed the
  contract, Foundation, and full Keycloak smoke gates; post-merge CI run
  `36114483358` and Keycloak Infra run `36114483398` also passed.
- Deploy SQ Hub Production run `36114627666` deployed API source
  `38d13cf88bfc726bc10d83aec9d0229f53946080` as immutable image digest
  `sha256:252e0d725da205fc7199716345cfcf2d21a6358e7c0f70e1336e9a42a36db7db`,
  recorded `API_MIGRATION_PASS`, `API_DEPLOY_PASS`, and terminal
  `SQ_HUB_PRODUCTION_DEPLOY_PASS`. Web deployment was a no-op. An immediately
  preceding attempt stopped safely before mutation because the immutable image
  publication had not yet completed; the guarded retry ran only after the image
  publisher verified that component tag.

### Public runtime boundary

Read-only probes on 25 September 2026 verified:

- `GET https://hub.sabilulquran.or.id/api/health` returned `200 OK`;
- an unauthenticated request to
  `/api/internal/v1/organization-directory/units?limit=1` returned
  `401 UNAUTHENTICATED`;
- the unauthorized response included `Cache-Control: no-store`;
- both responses included HTTPS security headers including HSTS,
  `X-Content-Type-Options: nosniff`, and `X-Frame-Options: SAMEORIGIN`.

This proves the deployed process and unauthenticated denial boundary. It does
not prove that sync/read gates are enabled or that a valid machine reader can
read a fresh projection.

### Browser security and consumer evidence

- An authenticated SQ Hub Account session was observed on 25 September 2026.
  Browser inspection found no localStorage keys, no sessionStorage keys, and no
  cookies readable through JavaScript. This is consistent with the server-side,
  HttpOnly session contract; it does not independently inspect the HttpOnly
  cookie flags.
- An authenticated Aset SQ dashboard was observed before session renewal. It
  reported integration installed and identified SQ Hub as the Organization
  Directory source with HCIS as workforce source.
- Aset SQ PR #20 merged as `e1aa698346f1153fba23674c8d8917f8f651eb44`
  and records `ASQ-002_DIRECTORY_CONSUMER_CLOSED` for initial production use.
  Its exact closure head passed local typecheck, lint, 136 API tests, 11 web
  tests, and API/web builds. GitHub Actions was infrastructure-blocked before
  executing steps by account billing/spending-limit enforcement.
- Read-only Aset SQ production probes on 25 September 2026 verified:
  - `/healthz` returned `200 OK`;
  - `/api/v1/foundation/status` returned
    `implementation=production-directory-consumer` and
    `productionIntegrationConfigured=true`;
  - its integration modes were `identity=oidc`,
    `applicationAccess=sq-hub`, and `organizationDirectory=sq-hub`;
  - unauthenticated `/api/v1/session` returned `401 UNAUTHENTICATED`.
- A sanitized authenticated browser acceptance on 25 September 2026 verified:
  - Aset Saya loaded successfully for the current OIDC identity without an
    identity-mapping, synthetic-data, or unconfigured warning;
  - the asset registration form loaded a non-empty owning-unit selector from
    the production Directory;
  - the custody form loaded a non-empty person selector from the production
    Directory;
  - no asset or custody record was created or changed during the checks;
  - localStorage and sessionStorage contained no keys, and JavaScript could
    read no cookie names;
  - logout traversed the Akun SQ end-session confirmation, cleared the local
    application session, and returned to the Akun SQ login page.

### Human Capital source acceptance

- Production Organization Designer was inspected for business date
  `2026-09-25`. It identified the current source as the published snapshot
  `Restrukturisasi 2026-08-27`, effective `2026-08-27`.
- On 25 September 2026, the authorized Human Capital/operator explicitly gave
  interim acceptance for that effective ORG-004 structure to be used by SQ Hub
  Organization Directory. The acceptance is limited to Directory publication
  and explicitly does **not** activate ORG-004 approval rollout `STRUCTURE`.
- This acceptance applies to the inspected current snapshot only. A later
  structure revision requires its normal HCIS authoring/publication governance
  and does not inherit this evidence automatically.
- A read-only unauthenticated probe of the exact production ORG-006 snapshot
  route returned JSON `401 INVALID_TOKEN` with `Cache-Control: no-store`. The
  reviewed producer checks its export gate before authentication and would
  return `503 ORGANIZATION_DIRECTORY_EXPORT_DISABLED` while disabled. This
  therefore confirms the export gate is enabled without exposing environment
  values, and confirms a missing/invalid machine credential is denied.
- The production Hub runtime gates were inspected by key only and both reported
  enabled: `ORG_DIRECTORY_SYNC_ENABLED=1` and
  `ORG_DIRECTORY_READ_ENABLED=1`; no credential value was printed.
- A sanitized production `directory:admin status` followed by two manual full
  reconciliations verified:
  - source `hcis`, source snapshot ID
    `0280b609-d26e-490e-a9cc-2338af6f3154`, business date `2026-09-25`;
  - version
    `sha256:ac9dc1d021640671f0ca31a2e7fc4b81d0f01b97dc89e9276988a2cc3b1e940f`;
  - counts `units=51`, `positions=28`, `people=329`;
  - both manual results were `UNCHANGED`, with the final successful
    synchronization at `2026-09-25T03:29:35.190Z`;
  - `stale=false`, `staleForSeconds=0`, and no error category.
- The authenticated full pull selected the accepted published ORG-004 snapshot
  and returned the exact HCIS content-addressed metadata. The reviewed producer
  has no legacy or synthetic fallback path, and none was observed in production.
- A focused custom-format PostgreSQL backup captured
  `organization_directory_projection` and
  `organization_directory_sync_attempts` together at
  `/var/backups/sq-hub/database/organization-directory-20260925T033211Z/organization-directory.dump`.
  The root-owned file is mode `600`, size `38940` bytes, with SHA-256
  `1d6a28ecfc1a0c34eda071df6a4cbc4d139391ce2d7cc93c836c949912b37424`.
- The backup was restored with `--no-owner --no-privileges` into a temporary
  PostgreSQL 17 container with no network and tmpfs storage. Restored source,
  version, business date, counts, synchronization time, and all 255 attempt rows
  matched the backup; the temporary container was removed after
  `ISOLATED_RESTORE_PASS`.

The unauthenticated probes establish current consumer configuration and denial
behavior. The subsequent browser acceptance supplies the consumer-side
authenticated smoke; it does not replace the operator's direct Hub
status/reconciliation evidence.

### Staging readiness recovery

- Before changing staging, the stopped Hub PostgreSQL volume, stopped HCIS
  PostgreSQL volume, and both service configurations were copied into the
  root-only directory
  `/var/backups/sq-hub/staging-recovery-20260925T034243Z`. The volume archive
  SHA-256 values are respectively
  `b2adc9d8bb9d6d477dba32d61b4fdd604b2352492ae9dffa9082051f5a3162b6`
  and
  `5a312a6bd69a33734ad123a4f7eb6e60a393166af6305ec4c4dec2e51d64eb63`.
- The previous Hub staging outage was traced to host-port collision: the
  stopped staging definition still bound `18100/18101`, which are now occupied
  by production. Staging bindings were moved to unused `18110/18111`; public
  routing continues through the existing isolated Docker network alias.
- Hub staging was restored with the already-present, immutable production API
  digest
  `sha256:a09fa81621c85e5548e5753e378e63753a4beb453e6f0c63280d953ca82a675f`.
  PostgreSQL, API, and web all reported healthy and the public API health route
  returned `200`. The Directory CLI is present and returned
  `DIRECTORY_UNAVAILABLE`, confirming the migration/runtime exists but no
  staging LKG has been bootstrapped yet.
- HCIS staging was restored with the already-present producer-capable API image
  `sha-532b623e57acc837fb534719736d3a8442a2a9f8`. Its migration runner completed,
  PostgreSQL/API/web all reported healthy, and the public health route returned
  `200`.
- Directory gates were deliberately not activated during recovery. The HCIS
  staging producer route returned `503 ORGANIZATION_DIRECTORY_EXPORT_DISABLED`
  with `Cache-Control: no-store`; the Hub staging read route remained absent.
  This preserves fail-closed behavior until dedicated staging service
  identities are provisioned.
- A read-only Keycloak metadata audit found no Directory machine clients in
  realm `sq-staff-staging`. Staging activation therefore still requires the
  separate Hub-pull and consumer-reader clients defined by HUB-IMPL-018; an
  existing browser or unrelated machine identity will not be reused.

### Staging activation and resilience rehearsal

- The operator imported the dedicated `sq-staff-staging` realm through the
  authenticated Keycloak Admin Console. The Directory pull client
  `sq-hub-organization-directory-staging` and reader client
  `aset-sq-directory-staging` are separate confidential service-account
  clients. Browser, implicit, and password grants are disabled; full scope is
  disabled; both use only the explicitly requested
  `organization-directory.read` scope and distinct audience mappers.
- Sanitized client-credentials inspection verified the exact staging issuer,
  client identifier, required scope, and audiences
  `hcis-organization-directory` and
  `sq-hub-organization-directory-staging`. No credential or token value was
  recorded.
- Root-only activation configuration was backed up under
  `/var/backups/sq-hub/staging-directory-activation-20260925T042149Z`.
  Dedicated Compose overlays enabled only the staging producer, synchronization,
  and read gates. The edge routes for the two internal Directory prefixes were
  validated before reload; production Hub health remained `200`.
- Because the recovered HCIS staging database contained no organization change
  set, a staging-only synthetic fixture was published for business date
  `2026-09-25`. It contains two units and two positions, creates no `STRUCTURE`
  rollout row, and does not copy production organization or employee data.
- The initial full reconciliation returned `APPLIED` with counts
  `units=2`, `positions=2`, `people=1` and version
  `sha256:ab22489ef21552bc76ee10407972b6fe7cdfde2b0c3be2c860b0955f852ed963`.
  The immediate second reconciliation returned `UNCHANGED`; status reported
  `source=hcis`, `asOf=2026-09-25`, and `stale=false`.
- The public staging read boundary denied a missing token with `401`, denied a
  producer token carrying the HCIS audience with `401`, and returned `200` to
  the dedicated reader token. Only item count and Directory metadata were
  inspected; no person row or response body was recorded.
- With the HCIS export gate deliberately disabled in staging, reconciliation
  recorded `FAILED` with category `source_unavailable` while preserving the
  same version, counts, source date, and prior synchronization timestamp.
  A simultaneous manual reconciliation returned `BUSY`, proving the
  single-flight guard without a parallel write.
- The preserved staging projection crossed the exact 15-minute freshness
  boundary and reported `stale=true` while retaining the same version and
  counts. After the HCIS staging export gate was restored, a full
  reconciliation at `2026-09-25T08:10:26.013Z` returned `UNCHANGED` and status
  returned to `stale=false` without replacing the LKG.
- The PostgreSQL integration suite exercised invalid schema, digest/count
  mismatch, broken references, duplicate identifiers, hierarchy cycles,
  identity ambiguity, invalid/future dates, source regression, and an injected
  storage failure. Every rejected attempt preserved the exact prior projection
  and successful-sync timestamp; the storage-failure case then recovered with
  a valid full reconciliation. This suite passed in the recorded exact-head CI
  evidence above and uses only disposable synthetic test data.

### Final production scheduler recovery

- Read-only status inspection found that the earlier scheduler instance had
  stopped scheduling after a completed attempt while the API process remained
  healthy. Its LKG projection stayed intact and correctly became stale.
- PR #99 hardened the scheduler so its sole future timer remains referenced and
  telemetry exceptions cannot terminate the loop. The regression test proves a
  throwing reporter still permits the next five-minute reconciliation.
- After the guarded API deployment, two automatic reconciliations completed at
  `2026-09-25T08:46:14.507Z` and `2026-09-25T08:51:16.523Z`. Both returned
  `UNCHANGED`, retained source `hcis`, business date `2026-09-25`, the accepted
  version and counts (`units=51`, `positions=28`, `people=329`), reported
  `stale=false`, and had no error category. This proves the fixed image reached
  production and the native scheduler advanced beyond its startup run.

## Acceptance checklist — complete

### Operator: HCIS source acceptance

- [x] Human Capital records acceptance of the real ORG-004 production snapshot.
- [x] Confirm `ORG_DIRECTORY_EXPORT_ENABLED=1` without printing secret values.
- [x] Record one sanitized authenticated producer probe with source revision,
      `asOf`, counts, and digest only.
- [x] Record invalid/missing producer credentials being denied.
- [x] Confirm production has no legacy or synthetic fallback.

### Operator: Hub activation and reconciliation

- [x] Confirm `ORG_DIRECTORY_SYNC_ENABLED=1` and
      `ORG_DIRECTORY_READ_ENABLED=1` without printing secret values.
- [x] Record sanitized `directory:admin status` output.
- [x] Run `directory:admin reconcile` and record success metadata only.
- [x] Run it again and record the idempotent `UNCHANGED` outcome.
- [x] Confirm Hub counts/digest match the accepted HCIS snapshot.
- [x] Confirm `source=hcis`, valid SHA-256 version, current `asOf`,
      `synchronizedAt`, and `stale=false`.

Built-image commands:

```sh
node apps/api/dist/cli/organization-directory.js status
node apps/api/dist/cli/organization-directory.js reconcile
```

Do not paste environment variables, tokens, secrets, URLs containing userinfo,
or any person row into this ledger.

### Browser handoff: Aset SQ

- [x] User renews the Aset SQ login session in the existing browser tab.
- [x] Verify Aset Saya loads through exact OIDC identity relation.
- [x] Verify Directory-dependent unit and person selectors load without a
      synthetic/unconfigured warning.
- [x] Verify browser storage remains free of access/refresh/machine tokens.
- [x] Verify logout clears the local application session and returns through
      the Akun SQ end-session flow.

### Staging rehearsal

- [x] Source unavailable preserves the previous LKG projection.
- [x] At the 15-minute boundary the projection reports `stale=true`.
- [x] Invalid payload, digest/count mismatch, hierarchy cycle, identity
      ambiguity, source regression, and storage failure do not replace LKG.
- [x] Corrected source/config permits the next full reconciliation.
- [x] Concurrent reconciliation returns `BUSY` rather than writing in parallel.

Deliberate failure injection belongs in staging, not production.

### Backup, restore, and monitoring

- [x] Back up `organization_directory_projection` and
      `organization_directory_sync_attempts` together.
- [x] Restore them into an isolated non-production database and verify
      version/digest/counts/status.
- [x] Record monitoring for no-LKG, stale, source auth/unavailable, contract
      validation, source regression, and storage failures.
- [x] Demonstrate one safe alert delivery test.

The monitoring procedure covers no-LKG, stale, `source_auth`,
`source_unavailable`, `source_request`, `contract_validation`,
`source_regression`, and `storage`. Its one-time safe alert delivery test passed.
The temporary 15-minute Codex polling automation used during acceptance was
then deleted at the operator's request; it is not a production dependency and
no recurring Codex-token-consuming task remains. Operational status remains
available through the sanitized read-only CLI and native five-minute scheduler
evidence above.

## Closure gate

> **SQ Hub Organization Directory runtime = CLOSED**

Every required item above now has accepted evidence: the HCIS source record,
sanitized Hub status/reconciliation, staging resilience rehearsal,
backup/restore, alert-delivery procedure, and Aset SQ consumer acceptance.

Foundation SQ Hub + Akun SQ remains independently **CLOSED since 23 September
2026**. Organization Directory is the completed post-Foundation phase and was
never a blocker for that Foundation closure.

> **Foundation SQ Hub + Akun SQ = 100% CLOSED**
