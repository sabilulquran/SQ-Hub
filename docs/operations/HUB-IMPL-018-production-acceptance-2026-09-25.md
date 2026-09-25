# HUB-IMPL-018 production acceptance — 2026-09-25

## Status

**IN PROGRESS — evidence ledger; Organization Directory runtime is not yet
declared operationally CLOSED by this document.**

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

These probes establish current consumer configuration and denial behavior. They
do not replace an authenticated Directory read or exact-identity browser smoke.

## Evidence still required

### Operator: HCIS source acceptance

- [ ] Human Capital records acceptance of the real ORG-004 production snapshot.
- [ ] Confirm `ORG_DIRECTORY_EXPORT_ENABLED=1` without printing secret values.
- [ ] Record one sanitized authenticated producer probe with source revision,
      `asOf`, counts, and digest only.
- [ ] Record invalid/missing producer credentials being denied.
- [ ] Confirm production has no legacy or synthetic fallback.

### Operator: Hub activation and reconciliation

- [ ] Confirm `ORG_DIRECTORY_SYNC_ENABLED=1` and
      `ORG_DIRECTORY_READ_ENABLED=1` without printing secret values.
- [ ] Record sanitized `directory:admin status` output.
- [ ] Run `directory:admin reconcile` and record success metadata only.
- [ ] Run it again and record the idempotent `UNCHANGED` outcome.
- [ ] Confirm Hub counts/digest match the accepted HCIS snapshot.
- [ ] Confirm `source=hcis`, valid SHA-256 version, current `asOf`,
      `synchronizedAt`, and `stale=false`.

Built-image commands:

```sh
node apps/api/dist/cli/organization-directory.js status
node apps/api/dist/cli/organization-directory.js reconcile
```

Do not paste environment variables, tokens, secrets, URLs containing userinfo,
or any person row into this ledger.

### Browser handoff: Aset SQ

- [ ] User renews the Aset SQ login session in the existing browser tab.
- [ ] Verify Aset Saya loads through exact OIDC identity relation.
- [ ] Verify Directory-dependent unit and person selectors load without a
      synthetic/unconfigured warning.
- [ ] Verify browser storage remains free of access/refresh/machine tokens.
- [ ] Verify logout clears the local application session and returns through
      the Akun SQ end-session flow.

### Staging rehearsal

- [ ] Source unavailable preserves the previous LKG projection.
- [ ] At the 15-minute boundary the projection reports `stale=true`.
- [ ] Invalid payload, digest/count mismatch, hierarchy cycle, identity
      ambiguity, source regression, and storage failure do not replace LKG.
- [ ] Corrected source/config permits the next full reconciliation.
- [ ] Concurrent reconciliation returns `BUSY` rather than writing in parallel.

Deliberate failure injection belongs in staging, not production.

### Backup, restore, and monitoring

- [ ] Back up `organization_directory_projection` and
      `organization_directory_sync_attempts` together.
- [ ] Restore them into an isolated non-production database and verify
      version/digest/counts/status.
- [ ] Record monitoring for no-LKG, stale, source auth/unavailable, contract
      validation, source regression, and storage failures.
- [ ] Demonstrate one safe alert delivery test.

## Closure gate

Only after every required item above has accepted evidence may this status be
changed to:

> **SQ Hub Organization Directory runtime = CLOSED**

The final closure change must link the accepted HCIS source record, sanitized
Hub status/reconcile evidence, staging resilience rehearsal, backup/restore,
monitoring, and the existing Aset SQ consumer acceptance.
