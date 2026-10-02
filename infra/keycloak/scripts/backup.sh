#!/usr/bin/env bash

# Production-VPS staging is RETIRED. Synthetic staging realm is CI_ONLY.
if [[ "${KEYCLOAK_REALM:-sq-staff-staging}" == "sq-staff-staging" ]] && [[ "${GITHUB_ACTIONS:-}" != "true" || "${RUNNER_ENVIRONMENT:-}" != "github-hosted" || "${KEYCLOAK_HOSTNAME:-}" != "http://127.0.0.1:8080" ]]; then
  echo "STOP: staging retired. This fixture operation is allowed only in isolated localhost GitHub CI." >&2
  exit 78
fi
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYCLOAK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${KEYCLOAK_ENV_FILE:-${KEYCLOAK_DIR}/.env.staging}"
COMPOSE_FILE="${KEYCLOAK_DIR}/docker-compose.ci.yml"
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
