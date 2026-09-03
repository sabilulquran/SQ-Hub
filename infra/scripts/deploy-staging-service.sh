#!/usr/bin/env bash
set -Eeuo pipefail

TARGET_SERVICE="${1:-}"
TARGET_IMAGE="${2:-}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HUB_ENV_FILE="${SQ_HUB_STAGING_ENV_FILE:-$REPO_ROOT/infra/.env.staging}"
KEYCLOAK_ENV_FILE="${KEYCLOAK_STAGING_ENV_FILE:-$REPO_ROOT/infra/keycloak/.env.staging}"
HEALTH_TIMEOUT_SECONDS="${STAGING_DEPLOY_HEALTH_TIMEOUT_SECONDS:-240}"
EXPECTED_ISSUER="https://login.sabilulquran.or.id/realms/sq-staff-staging"
OIDC_DISCOVERY_URL="$EXPECTED_ISSUER/.well-known/openid-configuration"
HUB_HEALTH_URL="https://hub-staging.sabilulquran.or.id/healthz"
DOCKER_HOME="${HOME:-/tmp}"
DOCKER_CONFIG_DIR="${DOCKER_CONFIG:-$DOCKER_HOME/.docker}"

ROLLBACK_ARMED=0
ORIGINAL_IMAGE=""
SERVICE=""
PROJECT=""
ENV_FILE=""
COMPOSE_FILE=""
IMAGE_VAR=""
EXPECTED_IMAGE_REGEX=""
declare -a REQUIRED_ENV_KEYS=()
declare -a NON_TARGET_SERVICES=()
declare -A NON_TARGET_IDS=()

log() {
  printf '%s\n' "$*"
}

die() {
  printf 'STAGING_DEPLOY_FAIL: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
Usage:
  deploy-staging-service.sh web ghcr.io/sabilulquran/sq-hub-web:sha-<40-hex-sha>
  deploy-staging-service.sh keycloak ghcr.io/sabilulquran/sq-hub-keycloak:sha-<40-hex-sha>
USAGE
}

configure_target() {
  case "$TARGET_SERVICE" in
    web)
      SERVICE="web"
      PROJECT="sq-hub-staging"
      ENV_FILE="$HUB_ENV_FILE"
      COMPOSE_FILE="$REPO_ROOT/infra/docker-compose.staging.yml"
      IMAGE_VAR="SQ_HUB_WEB_IMAGE"
      EXPECTED_IMAGE_REGEX='^ghcr\.io/sabilulquran/sq-hub-web:sha-[0-9a-f]{40}$'
      REQUIRED_ENV_KEYS=(
        SQ_HUB_DB_NAME
        SQ_HUB_DB_USER
        SQ_HUB_DB_PASSWORD
        SQ_HUB_OIDC_CLIENT_SECRET
        KEYCLOAK_DIRECTORY_CLIENT_SECRET
        SQ_HUB_API_IMAGE
        SQ_HUB_WEB_IMAGE
      )
      NON_TARGET_SERVICES=(postgres api)
      ;;
    keycloak)
      SERVICE="keycloak"
      PROJECT="sq-hub-keycloak-staging"
      ENV_FILE="$KEYCLOAK_ENV_FILE"
      COMPOSE_FILE="$REPO_ROOT/infra/keycloak/docker-compose.staging.yml"
      IMAGE_VAR="SQ_HUB_KEYCLOAK_IMAGE"
      EXPECTED_IMAGE_REGEX='^ghcr\.io/sabilulquran/sq-hub-keycloak:sha-[0-9a-f]{40}$'
      REQUIRED_ENV_KEYS=(
        KEYCLOAK_DB_NAME
        KEYCLOAK_DB_USERNAME
        KEYCLOAK_DB_PASSWORD
        KEYCLOAK_HOSTNAME
        SQ_HUB_KEYCLOAK_IMAGE
      )
      NON_TARGET_SERVICES=(keycloak-db)
      ;;
    *)
      usage >&2
      die "target service must be exactly web or keycloak"
      ;;
  esac
}

compose_with_image() {
  local image="$1"
  shift

  local -a clean_env=(
    env -i
    "PATH=$PATH"
    "HOME=$DOCKER_HOME"
    "DOCKER_CONFIG=$DOCKER_CONFIG_DIR"
    "${IMAGE_VAR}=${image}"
  )

  local transport_var
  for transport_var in DOCKER_HOST DOCKER_CONTEXT DOCKER_TLS_VERIFY DOCKER_CERT_PATH; do
    if [[ -n "${!transport_var:-}" ]]; then
      clean_env+=("${transport_var}=${!transport_var}")
    fi
  done

  "${clean_env[@]}" docker compose \
    -p "$PROJECT" \
    --env-file "$ENV_FILE" \
    -f "$COMPOSE_FILE" \
    "$@"
}

assert_env_file() {
  [[ -f "$ENV_FILE" ]] || die "required env file not found: $ENV_FILE"
  [[ -r "$ENV_FILE" ]] || die "required env file is not readable: $ENV_FILE"

  local mode
  mode="$(stat -c '%a' "$ENV_FILE")" || die "cannot read permissions for env file"
  mode="${mode: -3}"
  if (( (8#$mode & 077) != 0 )); then
    die "env file permissions are too broad; require no group/world permissions: $ENV_FILE"
  fi

  local key
  for key in "${REQUIRED_ENV_KEYS[@]}"; do
    if ! grep -Eq "^[[:space:]]*${key}=.+$" "$ENV_FILE"; then
      die "mandatory env key is missing or empty: $key"
    fi
  done
}

assert_target_image() {
  [[ -n "$TARGET_IMAGE" ]] || {
    usage >&2
    die "target image is required"
  }
  [[ "$TARGET_IMAGE" =~ $EXPECTED_IMAGE_REGEX ]] \
    || die "target image must be an immutable ghcr.io/sabilulquran SHA tag for $SERVICE"
}

container_health() {
  local cid="$1"
  docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null
}

wait_for_healthy() {
  local image="$1"
  local deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
  local cid status

  while (( SECONDS < deadline )); do
    cid="$(compose_with_image "$image" ps -q "$SERVICE" 2>/dev/null || true)"
    if [[ -n "$cid" ]]; then
      status="$(container_health "$cid" || true)"
      case "$status" in
        healthy)
          return 0
          ;;
        exited|dead|unhealthy)
          return 1
          ;;
      esac
    fi
    sleep 3
  done
  return 1
}

snapshot_non_targets() {
  local image="$1"
  local service cid
  for service in "${NON_TARGET_SERVICES[@]}"; do
    cid="$(compose_with_image "$image" ps -q "$service" 2>/dev/null || true)"
    [[ -n "$cid" ]] || die "non-target service is not running: $service"
    NON_TARGET_IDS["$service"]="$cid"
  done
}

assert_non_targets_unchanged() {
  local image="$1"
  local service cid
  for service in "${NON_TARGET_SERVICES[@]}"; do
    cid="$(compose_with_image "$image" ps -q "$service" 2>/dev/null || true)"
    if [[ -z "$cid" || "$cid" != "${NON_TARGET_IDS[$service]}" ]]; then
      return 1
    fi
  done
  return 0
}

verify_public_surfaces() {
  local discovery_file
  discovery_file="$(mktemp)"
  if ! curl --fail --silent --show-error --max-time 15 "$HUB_HEALTH_URL" >/dev/null; then
    rm -f "$discovery_file"
    return 1
  fi
  if ! curl --fail --silent --show-error --max-time 15 "$OIDC_DISCOVERY_URL" > "$discovery_file"; then
    rm -f "$discovery_file"
    return 1
  fi
  if ! grep -Fq '"issuer"' "$discovery_file" || ! grep -Fq "$EXPECTED_ISSUER" "$discovery_file"; then
    rm -f "$discovery_file"
    return 1
  fi
  rm -f "$discovery_file"
  return 0
}

rollback() {
  log "STAGING_DEPLOY_ROLLBACK_BEGIN service=$SERVICE image=$ORIGINAL_IMAGE"

  compose_with_image "$ORIGINAL_IMAGE" up -d \
    --no-deps \
    --no-build \
    --pull never \
    --force-recreate \
    "$SERVICE" >/dev/null || return 1

  wait_for_healthy "$ORIGINAL_IMAGE" || return 1
  assert_non_targets_unchanged "$ORIGINAL_IMAGE" || return 1
  verify_public_surfaces || return 1

  log "STAGING_DEPLOY_ROLLBACK_PASS"
  return 0
}

on_exit() {
  local rc=$?
  trap - EXIT

  if (( rc != 0 && ROLLBACK_ARMED == 1 )); then
    set +e
    log "STAGING_DEPLOY_POST_MUTATION_FAIL"
    if ! rollback; then
      log "STAGING_DEPLOY_ROLLBACK_FAIL"
    fi
  fi

  exit "$rc"
}
trap on_exit EXIT

configure_target
assert_target_image
assert_env_file

command -v docker >/dev/null 2>&1 || die "docker is required"
docker compose version >/dev/null 2>&1 || die "docker compose plugin is required"
command -v curl >/dev/null 2>&1 || die "curl is required"
command -v flock >/dev/null 2>&1 || die "flock is required"

exec 9>"/tmp/sq-hub-staging-deploy-${SERVICE}.lock"
flock -n 9 || die "another staging deployment for $SERVICE is already running"

log "STAGING_DEPLOY_PREFLIGHT_BEGIN service=$SERVICE"
compose_with_image "$TARGET_IMAGE" config -q >/dev/null
log "STAGING_DEPLOY_COMPOSE_CONFIG_PASS"

CURRENT_CID="$(compose_with_image "$TARGET_IMAGE" ps -q "$SERVICE" 2>/dev/null || true)"
[[ -n "$CURRENT_CID" ]] || die "target service is not currently running: $SERVICE"
ORIGINAL_IMAGE="$(docker inspect --format '{{.Config.Image}}' "$CURRENT_CID")"
[[ -n "$ORIGINAL_IMAGE" ]] || die "cannot determine current target image"

docker image inspect "$ORIGINAL_IMAGE" >/dev/null 2>&1 \
  || die "current image is not cached locally; rollback would be unsafe"

snapshot_non_targets "$TARGET_IMAGE"

if [[ "$ORIGINAL_IMAGE" == "$TARGET_IMAGE" ]] && [[ "$(container_health "$CURRENT_CID" || true)" == "healthy" ]]; then
  assert_non_targets_unchanged "$TARGET_IMAGE" || die "non-target service changed during preflight"
  verify_public_surfaces || die "public health/OIDC verification failed for already-current deployment"
  log "STAGING_DEPLOY_ALREADY_CURRENT_PASS"
  log "STAGING_DEPLOY_PASS service=$SERVICE image=$TARGET_IMAGE"
  exit 0
fi

log "STAGING_DEPLOY_PULL_BEGIN image=$TARGET_IMAGE"
docker pull "$TARGET_IMAGE" >/dev/null
log "STAGING_DEPLOY_IMAGE_PULL_PASS"

docker image inspect "$TARGET_IMAGE" >/dev/null 2>&1 \
  || die "target image is not available locally after pull"

ROLLBACK_ARMED=1
log "STAGING_DEPLOY_MUTATION_BEGIN service=$SERVICE image=$TARGET_IMAGE"
compose_with_image "$TARGET_IMAGE" up -d \
  --no-deps \
  --no-build \
  --pull never \
  --force-recreate \
  "$SERVICE" >/dev/null

wait_for_healthy "$TARGET_IMAGE" || die "target service failed health verification"
NEW_CID="$(compose_with_image "$TARGET_IMAGE" ps -q "$SERVICE")"
[[ -n "$NEW_CID" ]] || die "target service container missing after recreate"
[[ "$NEW_CID" != "$CURRENT_CID" ]] || die "target service was not recreated as expected"
[[ "$(docker inspect --format '{{.Config.Image}}' "$NEW_CID")" == "$TARGET_IMAGE" ]] \
  || die "running target image does not match requested immutable image"
assert_non_targets_unchanged "$TARGET_IMAGE" || die "a non-target service was recreated or removed"
verify_public_surfaces || die "public health/OIDC verification failed"

ROLLBACK_ARMED=0
log "STAGING_DEPLOY_TARGET_HEALTH_PASS"
log "STAGING_DEPLOY_NON_TARGET_UNTOUCHED_PASS"
log "STAGING_DEPLOY_PUBLIC_HEALTH_PASS"
log "STAGING_DEPLOY_OIDC_PASS"
log "STAGING_DEPLOY_PASS service=$SERVICE image=$TARGET_IMAGE"
