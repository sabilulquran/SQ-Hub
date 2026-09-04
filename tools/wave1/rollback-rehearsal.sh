#!/usr/bin/env bash
set -euo pipefail

HCIS_DIR="${WAVE1_HCIS_DIR:-}"
HCIS_ENV_FILE="${WAVE1_HCIS_ENV_FILE:-}"
PROJECT="${WAVE1_HCIS_PROJECT:-hcis-staging}"
HCIS_ORIGIN="${WAVE1_HCIS_ORIGIN:-https://hcis-staging.sabilulquran.or.id}"
LOCAL_PROBE="${WAVE1_LOCAL_AUTH_PROBE:-}"
OIDC_PROBE="${WAVE1_OIDC_SSO_PROBE:-}"

fail() {
  echo "WAVE1_ROLLBACK_REHEARSAL_FAIL reason=$1"
  exit 1
}

[[ -n "$HCIS_DIR" && -d "$HCIS_DIR/.git" ]] || fail HCIS_DIR_REQUIRED
[[ -n "$HCIS_ENV_FILE" && -f "$HCIS_ENV_FILE" ]] || fail HCIS_ENV_FILE_REQUIRED
[[ "$PROJECT" == "hcis-staging" ]] || fail STAGING_PROJECT_REQUIRED
[[ "$HCIS_ORIGIN" == "https://hcis-staging.sabilulquran.or.id" ]] || fail STAGING_ORIGIN_REQUIRED
[[ -n "$LOCAL_PROBE" && -x "$LOCAL_PROBE" ]] || fail LOCAL_AUTH_PROBE_REQUIRED
[[ -n "$OIDC_PROBE" && -x "$OIDC_PROBE" ]] || fail OIDC_SSO_PROBE_REQUIRED

COMPOSE="$HCIS_DIR/infra/docker-compose.staging.yml"
[[ -f "$COMPOSE" ]] || fail STAGING_COMPOSE_MISSING

# Refuse common production artifacts even if the caller supplied a surprising path.
case "$HCIS_ENV_FILE" in
  *production*|*prod.env*|*.env.prod*) fail PRODUCTION_ENV_REFUSED ;;
esac

state_file="$(mktemp)"
override_file="$(mktemp)"
cleanup() {
  rm -f "$state_file" "$override_file"
}
trap cleanup EXIT

# Capture only non-secret container/image state. Environment values are never printed.
docker compose -p "$PROJECT" --env-file "$HCIS_ENV_FILE" -f "$COMPOSE" ps --format json > "$state_file"
echo "WAVE1_ROLLBACK_STATE_CAPTURE_PASS"

cat > "$override_file" <<'YAML'
services:
  api:
    environment:
      AUTH_MODE: local
YAML

restore_oidc() {
  docker compose -p "$PROJECT" --env-file "$HCIS_ENV_FILE" -f "$COMPOSE" up -d --no-build >/dev/null
}
trap 'restore_oidc >/dev/null 2>&1 || true; cleanup' EXIT

# Configuration-first rollback. The database volume and schema are preserved.
docker compose -p "$PROJECT" --env-file "$HCIS_ENV_FILE" -f "$COMPOSE" stop api web >/dev/null
docker compose -p "$PROJECT" --env-file "$HCIS_ENV_FILE" -f "$COMPOSE" -f "$override_file" up -d --no-build api web >/dev/null

echo "WAVE1_LOCAL_MODE_SWITCH_PASS"

# The probe owns any credential interaction and must emit no secrets. Its stdout/stderr are suppressed.
if ! "$LOCAL_PROBE" >/dev/null 2>&1; then
  fail LOCAL_AUTHORIZATION_PROBE_FAILED
fi
echo "WAVE1_LOCAL_AUTHORIZATION_PASS"

# Prove the external-identity schema survived the mode switch without destructive rollback.
if ! docker compose -p "$PROJECT" --env-file "$HCIS_ENV_FILE" -f "$COMPOSE" exec -T postgres \
  sh -ceu 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) FROM information_schema.columns WHERE table_name = '\''accounts'\'' AND column_name IN ('\''identity_issuer'\'', '\''identity_subject'\'');"' \
  | grep -qx '2'; then
  fail IDENTITY_SCHEMA_NOT_PRESERVED
fi
echo "WAVE1_SCHEMA_PRESERVED_PASS"

# Restore the source-controlled OIDC staging configuration.
docker compose -p "$PROJECT" --env-file "$HCIS_ENV_FILE" -f "$COMPOSE" stop api web >/dev/null
restore_oidc

echo "WAVE1_OIDC_RESTORE_PASS"

if ! "$OIDC_PROBE" >/dev/null 2>&1; then
  fail OIDC_SSO_PROBE_FAILED
fi
echo "WAVE1_SYNTHETIC_SSO_AFTER_RESTORE_PASS"
echo "WAVE1_ROLLBACK_REHEARSAL_PASS"

trap cleanup EXIT
