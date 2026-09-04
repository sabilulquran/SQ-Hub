#!/usr/bin/env bash
set -euo pipefail

SQ_HUB_DIR="${WAVE1_SQ_HUB_DIR:-$PWD}"
KEYCLOAK_DIR="$SQ_HUB_DIR/infra/keycloak"
ENV_FILE="${WAVE1_KEYCLOAK_ENV_FILE:-$KEYCLOAK_DIR/.env.staging}"
COMPOSE_FILE="$KEYCLOAK_DIR/docker-compose.staging.yml"
RESTORE_DB="keycloak_wave1_restore_check"
ISSUER="${WAVE1_ISSUER:-https://login.sabilulquran.or.id/realms/sq-staff-staging}"
EXPECTED_ISSUER="https://login.sabilulquran.or.id/realms/sq-staff-staging"

fail() {
  echo "WAVE1_KEYCLOAK_BACKUP_RESTORE_FAIL reason=$1"
  exit 1
}

[[ "$ISSUER" == "$EXPECTED_ISSUER" ]] || fail STAGING_ISSUER_REQUIRED
[[ -f "$ENV_FILE" ]] || fail STAGING_ENV_FILE_REQUIRED
[[ -f "$COMPOSE_FILE" ]] || fail STAGING_COMPOSE_REQUIRED
[[ -x "$KEYCLOAK_DIR/scripts/backup.sh" ]] || fail BACKUP_SCRIPT_REQUIRED
[[ -x "$KEYCLOAK_DIR/scripts/restore-check.sh" ]] || fail RESTORE_SCRIPT_REQUIRED
case "$ENV_FILE" in
  *production*|*prod.env*|*.env.prod*) fail PRODUCTION_ENV_REFUSED ;;
esac
if [[ -n "${WAVE1_KEYCLOAK_RESTORE_DB:-}" && "$WAVE1_KEYCLOAK_RESTORE_DB" != "$RESTORE_DB" ]]; then
  fail RESTORE_DB_OVERRIDE_REFUSED
fi

# The lower-level restore check drops/recreates its target. Refuse to call it
# unless the fixed disposable name differs from the active database name.
if ! docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T keycloak-db \
  sh -ceu 'test "$POSTGRES_DB" != "$1"' sh "$RESTORE_DB"; then
  fail RESTORE_DB_COLLIDES_WITH_ACTIVE_DB
fi

backup_file="$(mktemp /tmp/keycloak-wave1-backup.XXXXXX.dump)"
cleanup() {
  rm -f "$backup_file"
}
trap cleanup EXIT

# Existing scripts own the backup/restore mechanics. Suppress their path-bearing output;
# this wrapper emits only sanitized acceptance markers.
if ! KEYCLOAK_ENV_FILE="$ENV_FILE" \
  "$KEYCLOAK_DIR/scripts/backup.sh" "$backup_file" >/dev/null; then
  fail BACKUP_FAILED
fi
[[ -s "$backup_file" ]] || fail BACKUP_EMPTY
echo "WAVE1_KEYCLOAK_BACKUP_PASS"

if ! KEYCLOAK_ENV_FILE="$ENV_FILE" \
  KEYCLOAK_RESTORE_CHECK_DB="$RESTORE_DB" \
  "$KEYCLOAK_DIR/scripts/restore-check.sh" "$backup_file" >/dev/null; then
  fail DISPOSABLE_RESTORE_FAILED
fi
echo "WAVE1_KEYCLOAK_DISPOSABLE_RESTORE_PASS"

# Verify public discovery after the disposable DB restore check. The live staging DB
# was never replaced by restore-check.sh.
curl --fail --silent --show-error --connect-timeout 10 --max-time 30 \
  "$ISSUER/.well-known/openid-configuration" \
  | jq -e --arg issuer "$EXPECTED_ISSUER" '.issuer == $issuer' >/dev/null
echo "WAVE1_KEYCLOAK_POST_RESTORE_DISCOVERY_PASS"

echo "WAVE1_KEYCLOAK_BACKUP_RESTORE_PASS"
