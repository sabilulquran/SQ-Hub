#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYCLOAK_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${KEYCLOAK_ENV_FILE-${KEYCLOAK_DIR}/.env.staging}"
COMPOSE_FILE="${KEYCLOAK_COMPOSE_FILE:-${KEYCLOAK_DIR}/docker-compose.staging.yml}"
REALM="${KEYCLOAK_REALM:-sq-staff-staging}"
case "$REALM" in
  sq-staff)
    DEFAULT_CLIENT_ID="sq-hub"
    ;;
  sq-staff-staging)
    DEFAULT_CLIENT_ID="sq-hub-staging"
    ;;
  *)
    echo "NATIVE_ACCOUNT_SCOPE_RECONCILE_FAIL: unsupported realm" >&2
    exit 1
    ;;
esac

CLIENT_ID="${SQ_HUB_CLIENT_ID:-$DEFAULT_CLIENT_ID}"
KCADM="${KCADM_BIN:-/opt/keycloak/bin/kcadm.sh}"
KCADM_CONFIG="${KEYCLOAK_KCADM_CONFIG:-/tmp/native-account.kcadm}"
MAPPER_NAME="sq-hub-account-audience"

fail() {
  printf 'NATIVE_ACCOUNT_SCOPE_RECONCILE_FAIL: %s\n' "$1" >&2
  exit 1
}

[[ "$CLIENT_ID" == "$DEFAULT_CLIENT_ID" ]] || fail "client does not match realm contract"
command -v docker >/dev/null 2>&1 || fail "docker is required"
command -v jq >/dev/null 2>&1 || fail "jq is required"
[[ -f "$COMPOSE_FILE" ]] || fail "compose file not found"
if [[ -n "$ENV_FILE" ]]; then
  [[ -f "$ENV_FILE" ]] || fail "environment file not found"
fi

compose_exec() {
  if [[ -n "$ENV_FILE" ]]; then
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T keycloak "$@"
  else
    docker compose -f "$COMPOSE_FILE" exec -T keycloak "$@"
  fi
}

compose_exec test -x "$KCADM" >/dev/null 2>&1 ||
  fail "kcadm executable not found in Keycloak container"
compose_exec test -f "$KCADM_CONFIG" >/dev/null 2>&1 ||
  fail "pre-authenticated kcadm config is required in Keycloak container"

kcadm() {
  compose_exec "$KCADM" "$@" --config "$KCADM_CONFIG"
}

realm_json="$(kcadm get "realms/$REALM")" ||
  fail "unable to inspect realm capability baseline"
jq -e '
  (.organizationsEnabled // false) == false and
  (.userManagedAccessAllowed // false) == false and
  (.verifiableCredentialsEnabled // false) == false
' >/dev/null <<<"$realm_json" ||
  fail "realm enables Account Console capability outside native Foundation parity"

required_actions="$(kcadm get authentication/required-actions -r "$REALM")" ||
  fail "unable to inspect required actions"
jq -e '
  ([.[] | select(.alias == "delete_account" and .enabled == true)] | length) == 0
' >/dev/null <<<"$required_actions" ||
  fail "delete-account self-service is active outside native Foundation parity"

hub_json="$(kcadm get clients -r "$REALM" -q "clientId=$CLIENT_ID")" ||
  fail "unable to query Hub client"
account_json="$(kcadm get clients -r "$REALM" -q "clientId=account")" ||
  fail "unable to query account client"

[[ "$(jq 'length' <<<"$hub_json")" == "1" ]] || fail "Hub client is missing or ambiguous"
[[ "$(jq 'length' <<<"$account_json")" == "1" ]] || fail "account client is missing or ambiguous"

hub_uuid="$(jq -er '.[0].id' <<<"$hub_json")"
account_uuid="$(jq -er '.[0].id' <<<"$account_json")"

hub_client="$(kcadm get "clients/$hub_uuid" -r "$REALM")" ||
  fail "unable to inspect Hub client"
jq -e '
  .enabled == true and
  .protocol == "openid-connect" and
  .publicClient == false and
  .bearerOnly == false and
  .standardFlowEnabled == true and
  .implicitFlowEnabled == false and
  .directAccessGrantsEnabled == false and
  .serviceAccountsEnabled == false and
  .fullScopeAllowed == false
' >/dev/null <<<"$hub_client" || fail "Hub client security contract is not satisfied"

desired_role_names='[
  "manage-account",
  "view-profile",
  "manage-account-links",
  "view-applications",
  "view-consent",
  "manage-consent",
  "view-groups"
]'

account_roles="$(kcadm get "clients/$account_uuid/roles" -r "$REALM")" ||
  fail "unable to inspect account roles"
desired_roles="$(jq --argjson names "$desired_role_names" '
  [.[] | select(.name as $name | $names | index($name))]
' <<<"$account_roles")"

[[ "$(jq 'length' <<<"$desired_roles")" == "7" ]] ||
  fail "required account roles are not all available"

current_scope="$(kcadm get "clients/$hub_uuid/scope-mappings/clients/$account_uuid" -r "$REALM")" ||
  fail "unable to inspect Hub account role scope"

unexpected_scope="$(jq --argjson names "$desired_role_names" '
  [.[] | select(.name as $name | ($names | index($name) | not))] | length
' <<<"$current_scope")"
[[ "$unexpected_scope" == "0" ]] ||
  fail "Hub client has broader account-client scope mappings than allowed"

missing_scope="$(jq --argjson current "$current_scope" '
  [.[] | select(.name as $name | ($current | map(.name) | index($name) | not))]
' <<<"$desired_roles")"
if [[ "$(jq 'length' <<<"$missing_scope")" != "0" ]]; then
  printf '%s' "$missing_scope" |
    kcadm create "clients/$hub_uuid/scope-mappings/clients/$account_uuid"       -r "$REALM" -f - >/dev/null ||
    fail "unable to add account role scope mappings"
fi

mapper_payload="$(jq -n --arg name "$MAPPER_NAME" '{
  name: $name,
  protocol: "openid-connect",
  protocolMapper: "oidc-audience-mapper",
  consentRequired: false,
  config: {
    "included.client.audience": "account",
    "id.token.claim": "false",
    "access.token.claim": "true",
    "introspection.token.claim": "true"
  }
}')"

mappers="$(kcadm get "clients/$hub_uuid/protocol-mappers/models" -r "$REALM")" ||
  fail "unable to inspect Hub protocol mappers"
mapper_matches="$(jq --arg name "$MAPPER_NAME" '[.[] | select(.name == $name)]' <<<"$mappers")"
case "$(jq 'length' <<<"$mapper_matches")" in
  0)
    printf '%s' "$mapper_payload" |
      kcadm create "clients/$hub_uuid/protocol-mappers/models" -r "$REALM" -f - >/dev/null ||
      fail "unable to create account audience mapper"
    ;;
  1)
    mapper_id="$(jq -er '.[0].id' <<<"$mapper_matches")"
    mapper_update_payload="$(jq --arg id "$mapper_id" '. + {id: $id}' <<<"$mapper_payload")"
    printf '%s' "$mapper_update_payload" |
      kcadm update "clients/$hub_uuid/protocol-mappers/models/$mapper_id" -r "$REALM" -f - >/dev/null ||
      fail "unable to update account audience mapper"
    ;;
  *)
    fail "account audience mapper is ambiguous"
    ;;
esac

verify_scope="$(kcadm get "clients/$hub_uuid/scope-mappings/clients/$account_uuid" -r "$REALM")"
verify_mappers="$(kcadm get "clients/$hub_uuid/protocol-mappers/models" -r "$REALM")"

[[ "$(jq --argjson names "$desired_role_names" '
  [.[] | select(.name as $name | $names | index($name))] | length
' <<<"$verify_scope")" == "7" ]] || fail "account role scope verification failed"

[[ "$(jq --argjson names "$desired_role_names" '
  [.[] | select(.name as $name | ($names | index($name) | not))] | length
' <<<"$verify_scope")" == "0" ]] || fail "unexpected account scope remained"

jq -e --arg name "$MAPPER_NAME" '
  [.[] | select(
    .name == $name and
    .protocol == "openid-connect" and
    .protocolMapper == "oidc-audience-mapper" and
    .config["included.client.audience"] == "account" and
    .config["id.token.claim"] == "false" and
    .config["access.token.claim"] == "true"
  )] | length == 1
' >/dev/null <<<"$verify_mappers" || fail "account audience mapper verification failed"

unset realm_json required_actions hub_json account_json hub_client account_roles desired_roles \
  current_scope missing_scope mappers mapper_matches mapper_payload mapper_update_payload \
  verify_scope verify_mappers

printf 'NATIVE_ACCOUNT_CAPABILITY_BASELINE_PASS realm=%s\n' "$REALM"
printf 'NATIVE_ACCOUNT_SCOPE_MAPPING_PASS realm=%s client=%s\n' "$REALM" "$CLIENT_ID"
printf 'NATIVE_ACCOUNT_AUDIENCE_PASS realm=%s client=%s audience=account\n' "$REALM" "$CLIENT_ID"
