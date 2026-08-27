# SQ Hub API — HUB-IMPL-002

Application Registry + Application Access foundation.

## Local setup

Requirements:
- Node.js 22+
- npm
- Docker / Docker Compose

From repository root:

```bash
cp infra/.env.example infra/.env.local
cp apps/api/.env.example apps/api/.env.local
npm install
npm run db:up
npm run migrate
npm run seed
npm run typecheck
npm run lint
npm run test
npm run build
```

`apps/api/.env.local` is local-only and must not be committed.

## API

Health:
```text
GET /health
```

Internal Application Access check:
```text
POST /internal/v1/application-access/check
Authorization: Bearer <Keycloak machine access token>
```

The machine token must:
- have the configured Keycloak issuer;
- contain the configured API audience;
- identify an allowlisted client (`azp` / `client_id`).

The endpoint decides only whether the identity may enter an application. It does not contain HCIS/SPMB business permissions.

## Operator CLI

Examples from repository root:

```bash
npm run access:admin -- application list

npm run access:admin -- application upsert \
  --key hcis \
  --name HCIS \
  --url https://hcis-staging.sabilulquran.or.id \
  --status active \
  --actor operator:local

npm run access:admin -- access grant \
  --issuer https://login-staging.sabilulquran.or.id/realms/sq-staff-staging \
  --subject synthetic-user-001 \
  --app hcis \
  --reason wave-1-test \
  --actor operator:local

npm run access:admin -- access revoke \
  --issuer https://login-staging.sabilulquran.or.id/realms/sq-staff-staging \
  --subject synthetic-user-001 \
  --app hcis \
  --reason wave-1-test-complete \
  --actor operator:local
```

Use synthetic identities only in Wave 1 development/staging.

## Migration recovery

SQL migrations are forward-only and recorded in `schema_migrations`.

For this initial foundation, do not improvise destructive down migrations against an environment containing accepted data. Recovery strategy:

### Local / disposable test database
1. stop API users of the database;
2. drop/recreate the local database or remove the Docker volume;
3. run `npm run migrate`;
4. run `npm run seed`.

### Shared staging / future production
Before applying a migration:
1. take the database backup required by the operational baseline;
2. apply migration;
3. verify health and acceptance checks.

If a migration must be reversed after it has modified shared data, restore from the verified backup or create a reviewed compensating migration. Do not edit an already-applied migration file and do not manually delete `schema_migrations` rows to make code appear rolled back.

## Security notes
- Do not commit database passwords, Keycloak client secrets, access tokens, or real Staff data.
- Do not put access/refresh tokens in browser storage.
- Application Access is checked when a new domain application session is created; domain apps do not call SQ Hub on every protected request.
- Failure to verify Application Access during new session creation must fail closed.
