#!/usr/bin/env bash
set -Eeuo pipefail

TARGET_SERVICE="${1:-}"
TARGET_IMAGE="${2:-}"
RUNTIME_ROOT="${SQ_HUB_STAGING_RUNTIME_ROOT:-/var/www/sq-hub}"
HEALTH_TIMEOUT_SECONDS="${STAGING_DEPLOY_HEALTH_TIMEOUT_SECONDS:-240}"
EXPECTED_ISSUER="https://login.sabilulquran.or.id/realms/sq-staff-staging"
OIDC_DISCOVERY_URL="$EXPECTED_ISSUER/.well-known/openid-configuration"
HUB_HEALTH_URL="https://hub-staging.sabilulquran.or.id/healthz"
DOCKER_HOME="${HOME:-/tmp}"
DOCKER_CONFIG_DIR="${DOCKER_CONFIG:-$DOCKER_HOME/.docker}"

SERVICE=""
PROJECT=""
ENV_FILE=""
OVERRIDE_FILE=""
EXPECTED_IMAGE_REGEX=""
ORIGINAL_IMAGE=""
ORIGINAL_CID=""
BACKUP_OVERRIDE=""
FILE_MUTATED=0
CONTAINER_MUTATED=0

declare -a REQUIRED_ENV_KEYS=()
declare -a COMPOSE_FILES=()
declare -a NON_TARGET_SERVICES=()
declare -A NON_TARGET_IDS=()

log() { printf '%s\n' "$*"; }
die() { printf 'MANAGED_STAGING_DEPLOY_FAIL: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'USAGE'
Usage:
  deploy-managed-staging-service.sh web ghcr.io/sabilulquran/sq-hub-web:sha-<40-hex-sha>
  deploy-managed-staging-service.sh keycloak ghcr.io/sabilulquran/sq-hub-keycloak:sha-<40-hex-sha>
USAGE
}

configure_target() {
  case "$TARGET_SERVICE" in
    web)
      SERVICE="web"
      PROJECT="sq-hub-staging"
      ENV_FILE="${SQ_HUB_STAGING_ENV_FILE:-$RUNTIME_ROOT/secrets/hub.env}"
      OVERRIDE_FILE="$RUNTIME_ROOT/docker-compose.hub.hubimpl010.yml"
      EXPECTED_IMAGE_REGEX='^ghcr\.io/sabilulquran/sq-hub-web:sha-[0-9a-f]{40}$'
      COMPOSE_FILES=(
        "$RUNTIME_ROOT/docker-compose.hub.yml"
        "$RUNTIME_ROOT/docker-compose.hub.edge.yml"
        "$RUNTIME_ROOT/docker-compose.hub.go5b.yml"
        "$OVERRIDE_FILE"
      )
      REQUIRED_ENV_KEYS=(
        SQ_HUB_DB_NAME
        SQ_HUB_DB_USER
        SQ_HUB_DB_PASSWORD
        SQ_HUB_OIDC_CLIENT_SECRET
        SQ_HUB_API_IMAGE
        SQ_HUB_WEB_IMAGE
      )
      NON_TARGET_SERVICES=(postgres api)
      ;;
    keycloak)
      SERVICE="keycloak"
      PROJECT="sq-hub-keycloak-staging"
      ENV_FILE="${KEYCLOAK_STAGING_ENV_FILE:-$RUNTIME_ROOT/secrets/keycloak.env}"
      OVERRIDE_FILE="$RUNTIME_ROOT/docker-compose.keycloak.hubimpl010.yml"
      EXPECTED_IMAGE_REGEX='^ghcr\.io/sabilulquran/sq-hub-keycloak:sha-[0-9a-f]{40}$'
      COMPOSE_FILES=(
        "$RUNTIME_ROOT/docker-compose.keycloak.yml"
        "$RUNTIME_ROOT/docker-compose.keycloak.go5b.yml"
        "$OVERRIDE_FILE"
      )
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

assert_runtime_contract() {
  [[ -d "$RUNTIME_ROOT" ]] || die "runtime root not found: $RUNTIME_ROOT"
  [[ -f "$RUNTIME_ROOT/.sq-hub-managed" ]] || die "managed-runtime marker missing: $RUNTIME_ROOT/.sq-hub-managed"
  [[ -f "$ENV_FILE" && -r "$ENV_FILE" ]] || die "required env file missing or unreadable: $ENV_FILE"

  local mode
  mode="$(stat -c '%a' "$ENV_FILE")" || die "cannot read env-file permissions"
  mode="${mode: -3}"
  if (( (8#$mode & 077) != 0 )); then
    die "env file permissions are too broad: $ENV_FILE"
  fi

  local key
  for key in "${REQUIRED_ENV_KEYS[@]}"; do
    grep -Eq "^[[:space:]]*${key}=.+$" "$ENV_FILE" \
      || die "mandatory env key missing or empty: $key"
  done

  local file
  for file in "${COMPOSE_FILES[@]}"; do
    [[ -f "$file" && -r "$file" ]] || die "compose file missing or unreadable: $file"
  done
}

assert_target_image() {
  [[ -n "$TARGET_IMAGE" ]] || { usage >&2; die "target image is required"; }
  [[ "$TARGET_IMAGE" =~ $EXPECTED_IMAGE_REGEX ]] \
    || die "target image must be an immutable organization-owned SHA tag for $SERVICE"
}

base_compose_cmd() {
  local -n out=$1
  out=(
    env -i
    "PATH=$PATH"
    "HOME=$DOCKER_HOME"
    "DOCKER_CONFIG=$DOCKER_CONFIG_DIR"
  )

  local transport_var
  for transport_var in DOCKER_HOST DOCKER_CONTEXT DOCKER_TLS_VERIFY DOCKER_CERT_PATH; do
    if [[ -n "${!transport_var:-}" ]]; then
      out+=("${transport_var}=${!transport_var}")
    fi
  done

  out+=(
    docker compose
    --project-directory "$RUNTIME_ROOT"
    -p "$PROJECT"
    --env-file "$ENV_FILE"
  )

  local file
  for file in "${COMPOSE_FILES[@]}"; do
    out+=(-f "$file")
  done
}

stable_compose() {
  local -a cmd
  base_compose_cmd cmd
  "${cmd[@]}" "$@"
}

write_preview_override() {
  local image="$1"
  local output="$2"
  umask 077
  cat > "$output" <<EOF2
services:
  $SERVICE:
    image: $image
EOF2
}

preview_compose() {
  local image="$1"
  shift
  local preview rc
  preview="$(mktemp)"
  write_preview_override "$image" "$preview"
  local -a cmd
  base_compose_cmd cmd
  set +e
  "${cmd[@]}" -f "$preview" "$@"
  rc=$?
  set -e
  rm -f "$preview"
  return "$rc"
}

container_health() {
  docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null
}

wait_for_healthy() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
  local cid status
  while (( SECONDS < deadline )); do
    cid="$(stable_compose ps -q "$SERVICE" 2>/dev/null || true)"
    if [[ -n "$cid" ]]; then
      status="$(container_health "$cid" || true)"
      case "$status" in
        healthy) return 0 ;;
        exited|dead|unhealthy) return 1 ;;
      esac
    fi
    sleep 3
  done
  return 1
}

snapshot_non_targets() {
  local target cid
  for target in "${NON_TARGET_SERVICES[@]}"; do
    cid="$(stable_compose ps -q "$target" 2>/dev/null || true)"
    [[ -n "$cid" ]] || die "non-target service is not running: $target"
    NON_TARGET_IDS["$target"]="$cid"
  done
}

assert_non_targets_unchanged() {
  local target cid
  for target in "${NON_TARGET_SERVICES[@]}"; do
    cid="$(stable_compose ps -q "$target" 2>/dev/null || true)"
    [[ -n "$cid" && "$cid" == "${NON_TARGET_IDS[$target]}" ]] || return 1
  done
  return 0
}

verify_public_surfaces() {
  local discovery
  discovery="$(mktemp)"
  if ! curl --fail --silent --show-error --max-time 15 "$HUB_HEALTH_URL" >/dev/null; then
    rm -f "$discovery"
    return 1
  fi
  if ! curl --fail --silent --show-error --max-time 15 "$OIDC_DISCOVERY_URL" > "$discovery"; then
    rm -f "$discovery"
    return 1
  fi
  if ! grep -Fq '"issuer"' "$discovery" || ! grep -Fq "$EXPECTED_ISSUER" "$discovery"; then
    rm -f "$discovery"
    return 1
  fi
  rm -f "$discovery"
}

persist_override() {
  local image="$1"
  local temp
  temp="$(mktemp "$RUNTIME_ROOT/.hubimpl010-${SERVICE}.XXXXXX")"
  write_preview_override "$image" "$temp"
  chmod 640 "$temp"
  mv -f "$temp" "$OVERRIDE_FILE"
}

restore_override() {
  [[ -n "$BACKUP_OVERRIDE" && -f "$BACKUP_OVERRIDE" ]] || return 1
  cp -p "$BACKUP_OVERRIDE" "$OVERRIDE_FILE"
}

rollback() {
  log "MANAGED_STAGING_ROLLBACK_BEGIN service=$SERVICE image=$ORIGINAL_IMAGE"

  if (( FILE_MUTATED == 1 )); then
    restore_override || return 1
  fi

  if (( CONTAINER_MUTATED == 1 )); then
    stable_compose config -q >/dev/null || return 1
    stable_compose up -d --no-deps --no-build --pull never --force-recreate "$SERVICE" >/dev/null || return 1
    wait_for_healthy || return 1

    local cid
    cid="$(stable_compose ps -q "$SERVICE" 2>/dev/null || true)"
    [[ -n "$cid" ]] || return 1
    [[ "$(docker inspect --format '{{.Config.Image}}' "$cid")" == "$ORIGINAL_IMAGE" ]] || return 1
    assert_non_targets_unchanged || return 1
    verify_public_surfaces || return 1
  fi

  FILE_MUTATED=0
  CONTAINER_MUTATED=0
  log "MANAGED_STAGING_ROLLBACK_PASS"
}

on_exit() {
  local rc=$?
  trap - EXIT
  if (( rc != 0 && (FILE_MUTATED == 1 || CONTAINER_MUTATED == 1) )); then
    set +e
    log "MANAGED_STAGING_POST_MUTATION_FAIL"
    rollback || log "MANAGED_STAGING_ROLLBACK_FAIL"
  fi
  [[ -z "$BACKUP_OVERRIDE" ]] || rm -f "$BACKUP_OVERRIDE"
  exit "$rc"
}
trap on_exit EXIT

configure_target
assert_target_image

command -v docker >/dev/null 2>&1 || die "docker is required"
docker compose version >/dev/null 2>&1 || die "docker compose plugin is required"
command -v curl >/dev/null 2>&1 || die "curl is required"
command -v flock >/dev/null 2>&1 || die "flock is required"

assert_runtime_contract

exec 9>"/tmp/sq-hub-managed-staging-${SERVICE}.lock"
flock -n 9 || die "another managed staging deployment for $SERVICE is running"

log "MANAGED_STAGING_PREFLIGHT_BEGIN service=$SERVICE"
stable_compose config -q >/dev/null || die "current managed Compose stack does not render with persistent env source"
preview_compose "$TARGET_IMAGE" config -q >/dev/null || die "target managed Compose stack does not render"
log "MANAGED_STAGING_COMPOSE_CONFIG_PASS"

ORIGINAL_CID="$(stable_compose ps -q "$SERVICE" 2>/dev/null || true)"
[[ -n "$ORIGINAL_CID" ]] || die "target service is not currently running: $SERVICE"
ORIGINAL_IMAGE="$(docker inspect --format '{{.Config.Image}}' "$ORIGINAL_CID")"
[[ -n "$ORIGINAL_IMAGE" ]] || die "cannot determine current target image"

docker image inspect "$ORIGINAL_IMAGE" >/dev/null 2>&1 \
  || die "current image is not cached locally; rollback would be unsafe"

snapshot_non_targets
verify_public_surfaces || die "public health/OIDC baseline failed"

if [[ "$ORIGINAL_IMAGE" == "$TARGET_IMAGE" ]] && [[ "$(container_health "$ORIGINAL_CID" || true)" == "healthy" ]]; then
  if ! grep -Fq "image: $TARGET_IMAGE" "$OVERRIDE_FILE"; then
    BACKUP_OVERRIDE="$(mktemp)"
    cp -p "$OVERRIDE_FILE" "$BACKUP_OVERRIDE"
    FILE_MUTATED=1
    persist_override "$TARGET_IMAGE"
    stable_compose config -q >/dev/null || die "persistent target override does not render"
    FILE_MUTATED=0
  fi
  assert_non_targets_unchanged || die "non-target service changed during preflight"
  verify_public_surfaces || die "public health/OIDC verification failed for already-current deployment"
  log "MANAGED_STAGING_ALREADY_CURRENT_PASS"
  log "MANAGED_STAGING_DEPLOY_PASS service=$SERVICE image=$TARGET_IMAGE"
  exit 0
fi

log "MANAGED_STAGING_PULL_BEGIN image=$TARGET_IMAGE"
docker pull "$TARGET_IMAGE" >/dev/null
log "MANAGED_STAGING_IMAGE_PULL_PASS"
docker image inspect "$TARGET_IMAGE" >/dev/null 2>&1 || die "target image unavailable locally after pull"

BACKUP_OVERRIDE="$(mktemp)"
cp -p "$OVERRIDE_FILE" "$BACKUP_OVERRIDE"
FILE_MUTATED=1
persist_override "$TARGET_IMAGE"
stable_compose config -q >/dev/null || die "persistent target override does not render"

log "MANAGED_STAGING_MUTATION_BEGIN service=$SERVICE image=$TARGET_IMAGE"
CONTAINER_MUTATED=1
stable_compose up -d --no-deps --no-build --pull never --force-recreate "$SERVICE" >/dev/null

wait_for_healthy || die "target service failed health verification"
NEW_CID="$(stable_compose ps -q "$SERVICE" 2>/dev/null || true)"
[[ -n "$NEW_CID" ]] || die "target service missing after recreate"
[[ "$NEW_CID" != "$ORIGINAL_CID" ]] || die "target service was not recreated"
[[ "$(docker inspect --format '{{.Config.Image}}' "$NEW_CID")" == "$TARGET_IMAGE" ]] \
  || die "running target image does not match requested immutable image"
assert_non_targets_unchanged || die "a non-target service was recreated or removed"
verify_public_surfaces || die "public health/OIDC verification failed"

FILE_MUTATED=0
CONTAINER_MUTATED=0
log "MANAGED_STAGING_TARGET_HEALTH_PASS"
log "MANAGED_STAGING_NON_TARGET_UNTOUCHED_PASS"
log "MANAGED_STAGING_PERSISTENT_OVERRIDE_PASS"
log "MANAGED_STAGING_PUBLIC_HEALTH_PASS"
log "MANAGED_STAGING_OIDC_PASS"
log "MANAGED_STAGING_DEPLOY_PASS service=$SERVICE image=$TARGET_IMAGE"
