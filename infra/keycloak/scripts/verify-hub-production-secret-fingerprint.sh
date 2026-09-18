#!/usr/bin/env bash
set -euo pipefail

REALM="${KEYCLOAK_REALM:-sq-staff}"
CLIENT_ID="sq-hub"
KCADM="${KCADM_BIN:-/opt/keycloak/bin/kcadm.sh}"
KCADM_CONFIG="${KEYCLOAK_KCADM_CONFIG:-/tmp/sq-hub-production.kcadm}"
ENV_FILE="${SQ_HUB_PRODUCTION_ENV_FILE:?set SQ_HUB_PRODUCTION_ENV_FILE}"
API_CONTAINER="${SQ_HUB_API_CONTAINER:?set SQ_HUB_API_CONTAINER to the running API container name}"

fail() {
  printf 'HUB_PRODUCTION_SECRET_FINGERPRINT_FAIL: %s\n' "$1" >&2
  exit 1
}

hash_value() {
  local value="$1"
  [[ -n "$value" ]] || fail "refusing to hash an empty secret"
  printf '%s' "$value" | sha256sum | cut -c1-16
}

[[ "$REALM" == "sq-staff" ]] || fail "target realm must be exactly sq-staff"
[[ -f "$ENV_FILE" ]] || fail "production env file not found"
[[ -f "$KCADM_CONFIG" ]] || fail "pre-authenticated kcadm config is required"
[[ -x "$KCADM" ]] || fail "kcadm executable not found"
command -v jq >/dev/null 2>&1 || fail "jq is required"
command -v docker >/dev/null 2>&1 || fail "docker is required"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"

kcadm() {
  "$KCADM" "$@" --config "$KCADM_CONFIG"
}

client_json="$(kcadm get clients -r "$REALM" -q "clientId=$CLIENT_ID")" || fail "unable to query client"
[[ "$(jq 'length' <<<"$client_json")" == "1" ]] || fail "expected exactly one sq-hub client"
client_uuid="$(jq -er '.[0].id' <<<"$client_json")"
keycloak_secret="$(kcadm get "clients/$client_uuid/client-secret" -r "$REALM" | jq -er '.value')" || fail "unable to read client secret"

file_secret="$(
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  printf '%s' "${SQ_HUB_OIDC_CLIENT_SECRET:-}"
)"
[[ -n "$file_secret" ]] || fail "SQ_HUB_OIDC_CLIENT_SECRET missing from env file"

container_secret="$(
  docker inspect "$API_CONTAINER"     --format '{{range .Config.Env}}{{println .}}{{end}}'     | sed -n 's/^SQ_HUB_OIDC_CLIENT_SECRET=//p'     | head -n 1
)"
[[ -n "$container_secret" ]] || fail "SQ_HUB_OIDC_CLIENT_SECRET missing from running API container"

keycloak_fp="$(hash_value "$keycloak_secret")"
file_fp="$(hash_value "$file_secret")"
container_fp="$(hash_value "$container_secret")"

unset keycloak_secret file_secret container_secret client_json

printf 'KEYCLOAK_SECRET_FINGERPRINT=%s\n' "$keycloak_fp"
printf 'SECRET_FILE_FINGERPRINT=%s\n' "$file_fp"
printf 'API_CONTAINER_SECRET_FINGERPRINT=%s\n' "$container_fp"

[[ "$keycloak_fp" == "$file_fp" ]] || fail "Keycloak and secret file fingerprints differ"
[[ "$file_fp" == "$container_fp" ]] || fail "secret file and API container fingerprints differ"

printf 'HUB_PRODUCTION_SECRET_FINGERPRINT_PASS\n'
