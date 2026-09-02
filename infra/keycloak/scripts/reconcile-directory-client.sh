#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYCLOAK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${KEYCLOAK_ENV_FILE:-${KEYCLOAK_DIR}/.env.staging}"
COMPOSE_FILE="${KEYCLOAK_DIR}/docker-compose.staging.yml"
REALM="${KEYCLOAK_REALM:-sq-staff-staging}"
CLIENT_ID="${KEYCLOAK_DIRECTORY_CLIENT_ID:-sq-hub-directory-staging}"
KCADM_CONFIG="${KEYCLOAK_KCADM_CONFIG:-/tmp/sq-hub-directory.kcadm}"
DIRECTORY_SECRET="${KEYCLOAK_DIRECTORY_CLIENT_SECRET:-}"

fail() {
  echo "Directory-client reconciliation failed: $1" >&2
  exit 1
}

[[ "${REALM}" == "sq-staff-staging" ]] || fail "target realm must be exactly sq-staff-staging"
[[ -n "${DIRECTORY_SECRET}" ]] || fail "KEYCLOAK_DIRECTORY_CLIENT_SECRET is required"
[[ -f "${ENV_FILE}" ]] || fail "environment file not found"
command -v docker >/dev/null 2>&1 || fail "docker is required"
command -v jq >/dev/null 2>&1 || fail "jq is required"

compose_exec() {
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T keycloak "$@"
}

kcadm() {
  compose_exec /opt/keycloak/bin/kcadm.sh "$@" --config "${KCADM_CONFIG}"
}

compose_exec test -f "${KCADM_CONFIG}" >/dev/null 2>&1 \
  || fail "pre-authenticated kcadm config is not available inside the Keycloak container"

client_json="$(kcadm get clients -r "${REALM}" -q "clientId=${CLIENT_ID}")" \
  || fail "unable to query directory client"
client_count="$(jq 'length' <<<"${client_json}")"

client_payload="$(jq -n \
  --arg clientId "${CLIENT_ID}" \
  --arg secret "${DIRECTORY_SECRET}" \
  '{
    clientId: $clientId,
    name: "SQ Hub Identity Directory Staging",
    enabled: true,
    protocol: "openid-connect",
    publicClient: false,
    bearerOnly: false,
    standardFlowEnabled: false,
    implicitFlowEnabled: false,
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: true,
    fullScopeAllowed: false,
    secret: $secret
  }')"

if [[ "${client_count}" == "0" ]]; then
  printf '%s' "${client_payload}" | kcadm create clients -r "${REALM}" -f - >/dev/null
elif [[ "${client_count}" == "1" ]]; then
  client_uuid="$(jq -er '.[0].id' <<<"${client_json}")"
  printf '%s' "${client_payload}" | kcadm update "clients/${client_uuid}" -r "${REALM}" -f - >/dev/null
else
  fail "directory client is ambiguous"
fi

client_json="$(kcadm get clients -r "${REALM}" -q "clientId=${CLIENT_ID}")"
client_uuid="$(jq -er '.[0].id' <<<"${client_json}")"
service_user="$(kcadm get "clients/${client_uuid}/service-account-user" -r "${REALM}")"
service_user_id="$(jq -er '.id' <<<"${service_user}")"
realm_management="$(kcadm get clients -r "${REALM}" -q clientId=realm-management)"
rm_uuid="$(jq -er 'if length == 1 then .[0].id else error("realm-management ambiguous") end' <<<"${realm_management}")"

roles_payload="$(
  kcadm get "clients/${rm_uuid}/roles" -r "${REALM}" \
    | jq '[.[] | select(.name == "query-users" or .name == "view-users")]'
)" || fail "unable to resolve least-privilege realm-management roles"
[[ "$(jq 'length' <<<"${roles_payload}")" == "2" ]] || fail "query-users/view-users roles were not both found"

current_roles="$(kcadm get "users/${service_user_id}/role-mappings/clients/${rm_uuid}" -r "${REALM}")" \
  || fail "unable to inspect service-account realm-management roles"
extra_roles="$(jq '[.[] | select(.name != "query-users" and .name != "view-users")] | length' <<<"${current_roles}")"
[[ "${extra_roles}" == "0" ]] || fail "service account has broader direct realm-management roles"

missing_roles="$(jq --argjson current "${current_roles}" '[.[] | select(.name as $name | ($current | map(.name) | index($name) | not))]' <<<"${roles_payload}")"
if [[ "$(jq 'length' <<<"${missing_roles}")" != "0" ]]; then
  printf '%s' "${missing_roles}" \
    | kcadm create "users/${service_user_id}/role-mappings/clients/${rm_uuid}" -r "${REALM}" -f - >/dev/null
fi

verify_client="$(kcadm get "clients/${client_uuid}" -r "${REALM}")"
verify_roles="$(kcadm get "users/${service_user_id}/role-mappings/clients/${rm_uuid}" -r "${REALM}")"

jq -e '
  .enabled == true and
  .publicClient == false and
  .bearerOnly == false and
  .standardFlowEnabled == false and
  .implicitFlowEnabled == false and
  .directAccessGrantsEnabled == false and
  .serviceAccountsEnabled == true and
  .fullScopeAllowed == false
' >/dev/null <<<"${verify_client}" || fail "directory client did not converge"

[[ "$(jq '[.[] | select(.name == "query-users" or .name == "view-users")] | length' <<<"${verify_roles}")" == "2" ]] \
  || fail "least-privilege roles did not converge"
[[ "$(jq '[.[] | select(.name != "query-users" and .name != "view-users")] | length' <<<"${verify_roles}")" == "0" ]] \
  || fail "unexpected direct realm-management role remains"

unset DIRECTORY_SECRET client_payload client_json service_user roles_payload current_roles missing_roles verify_client verify_roles

echo "DIRECTORY_CLIENT_CONFIGURATION_PASS"
echo "DIRECTORY_CLIENT_LEAST_PRIVILEGE_PASS"
