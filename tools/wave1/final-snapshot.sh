#!/usr/bin/env bash
set -euo pipefail

SQ_HUB_DIR="${WAVE1_SQ_HUB_DIR:-$PWD}"
HCIS_DIR="${WAVE1_HCIS_DIR:-}"
KEYCLOAK_COMPOSE="${WAVE1_KEYCLOAK_COMPOSE:-$SQ_HUB_DIR/infra/keycloak/docker-compose.staging.yml}"
KEYCLOAK_ENV_FILE="${WAVE1_KEYCLOAK_ENV_FILE:-$SQ_HUB_DIR/infra/keycloak/.env.staging}"
KEYCLOAK_PROJECT="${WAVE1_KEYCLOAK_PROJECT:-sq-hub-keycloak-staging}"
REALM_FILE="${WAVE1_REALM_FILE:-$SQ_HUB_DIR/infra/keycloak/realm/sq-staff-staging-realm.json}"
ISSUER="https://login.sabilulquran.or.id/realms/sq-staff-staging"

if [[ -z "$HCIS_DIR" || ! -d "$HCIS_DIR/.git" ]]; then
  echo "WAVE1_SNAPSHOT_FAIL reason=HCIS_DIR_REQUIRED"
  exit 1
fi
if [[ ! -d "$SQ_HUB_DIR/.git" ]]; then
  echo "WAVE1_SNAPSHOT_FAIL reason=SQ_HUB_GIT_REQUIRED"
  exit 1
fi
if [[ ! -f "$REALM_FILE" ]]; then
  echo "WAVE1_SNAPSHOT_FAIL reason=REALM_FILE_MISSING"
  exit 1
fi
if [[ ! -f "$KEYCLOAK_ENV_FILE" ]]; then
  echo "WAVE1_SNAPSHOT_FAIL reason=KEYCLOAK_ENV_FILE_MISSING"
  exit 1
fi
if [[ "$KEYCLOAK_PROJECT" != "sq-hub-keycloak-staging" ]]; then
  echo "WAVE1_SNAPSHOT_FAIL reason=STAGING_KEYCLOAK_PROJECT_REQUIRED"
  exit 1
fi
case "${KEYCLOAK_ENV_FILE,,}" in
  *production*|*prod.env*|*.env.prod*)
    echo "WAVE1_SNAPSHOT_FAIL reason=PRODUCTION_ENV_REFUSED"
    exit 1
    ;;
esac

# Do not report the configured constant as runtime evidence. Prove that the
# reachable provider advertises the exact accepted staging issuer first.
curl --fail --silent --show-error --connect-timeout 10 --max-time 30 \
  "$ISSUER/.well-known/openid-configuration" \
  | jq -e --arg issuer "$ISSUER" '.issuer == $issuer' >/dev/null

sq_hub_sha="$(git -C "$SQ_HUB_DIR" rev-parse HEAD)"
hcis_sha="$(git -C "$HCIS_DIR" rev-parse HEAD)"
realm_sha256="$(sha256sum "$REALM_FILE" | awk '{print $1}')"

# Runtime image reference and image ID are non-secret deployment facts.
keycloak_container="$(docker compose -p "$KEYCLOAK_PROJECT" --env-file "$KEYCLOAK_ENV_FILE" -f "$KEYCLOAK_COMPOSE" ps -q keycloak)"
if [[ -z "$keycloak_container" ]]; then
  echo "WAVE1_SNAPSHOT_FAIL reason=KEYCLOAK_NOT_RUNNING"
  exit 1
fi
keycloak_image_ref="$(docker inspect --format '{{.Config.Image}}' "$keycloak_container")"
keycloak_image_id="$(docker inspect --format '{{.Image}}' "$keycloak_container")"

printf '%s\n' \
  "WAVE1_SNAPSHOT_PASS" \
  "SQ_HUB_SHA=$sq_hub_sha" \
  "HCIS_SHA=$hcis_sha" \
  "OIDC_ISSUER=$ISSUER" \
  "KEYCLOAK_IMAGE_REF=$keycloak_image_ref" \
  "KEYCLOAK_IMAGE_ID=$keycloak_image_id" \
  "REALM_CONFIG_SHA256=$realm_sha256"
