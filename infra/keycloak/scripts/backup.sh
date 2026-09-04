#!/usr/bin/env bash
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYCLOAK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${KEYCLOAK_ENV_FILE:-${KEYCLOAK_DIR}/.env.staging}"
COMPOSE_FILE="${KEYCLOAK_DIR}/docker-compose.staging.yml"
OUTPUT="${1:-${KEYCLOAK_DIR}/backup/keycloak-$(date -u +%Y%m%dT%H%M%SZ).dump}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Environment file not found: ${ENV_FILE}" >&2
  exit 1
fi

mkdir -p "$(dirname "${OUTPUT}")"

docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T keycloak-db \
  sh -ceu '
    pg_dump \
      --username "$POSTGRES_USER" \
      --dbname "$POSTGRES_DB" \
      --format custom \
      --no-owner \
      --no-privileges
  ' > "${OUTPUT}"

chmod 600 "${OUTPUT}"
echo "Backup written: ${OUTPUT}"
