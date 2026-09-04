#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <backup.dump>" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYCLOAK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${KEYCLOAK_ENV_FILE:-${KEYCLOAK_DIR}/.env.staging}"
COMPOSE_FILE="${KEYCLOAK_DIR}/docker-compose.staging.yml"
BACKUP_FILE="$1"
RESTORE_DB="${KEYCLOAK_RESTORE_CHECK_DB:-keycloak_restore_check}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Environment file not found: ${ENV_FILE}" >&2
  exit 1
fi
if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "Backup file not found: ${BACKUP_FILE}" >&2
  exit 1
fi

# Restore only into a disposable verification database, never over the live staging DB.
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T keycloak-db \
  sh -ceu 'dropdb --username "$POSTGRES_USER" --if-exists "$1"' sh "${RESTORE_DB}"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T keycloak-db \
  sh -ceu 'createdb --username "$POSTGRES_USER" "$1"' sh "${RESTORE_DB}"

cat "${BACKUP_FILE}" | docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T keycloak-db \
  sh -ceu '
    pg_restore \
      --username "$POSTGRES_USER" \
      --dbname "$1" \
      --no-owner \
      --no-privileges
  ' sh "${RESTORE_DB}"

REALM_COUNT="$(docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T keycloak-db \
  sh -ceu 'psql --username "$POSTGRES_USER" --dbname "$1" --tuples-only --no-align \
    --command "SELECT count(*) FROM realm WHERE name = '\''sq-staff-staging'\'';"' sh "${RESTORE_DB}")"

if [[ "${REALM_COUNT}" != "1" ]]; then
  echo "Restore verification failed: expected one sq-staff-staging realm, found ${REALM_COUNT}" >&2
  exit 1
fi

echo "Restore verification succeeded in disposable database: ${RESTORE_DB}"
