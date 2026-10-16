#!/usr/bin/env bash
set -euo pipefail

# KEYCLOAK_EXEC_MODE selects how kcadm runs:
#   compose (default) - inside the Docker Compose `keycloak` service.
#   host              - a host-native kcadm.sh (Mi8, no Docker). Set KEYCLOAK_KCADM_BIN
#                       and run where its JAVA_HOME and the Keycloak loopback are reachable.
EXEC_MODE="${KEYCLOAK_EXEC_MODE:-compose}"
ENV_FILE="${KEYCLOAK_ENV_FILE:-}"
COMPOSE_FILE="${KEYCLOAK_COMPOSE_FILE:-}"
KCADM_BIN="${KEYCLOAK_KCADM_BIN:-}"
REALM="${KEYCLOAK_REALM:-}"
CLIENT_ID="${KEYCLOAK_IDENTITY_MANAGEMENT_CLIENT_ID:-}"
KCADM_CONFIG="${KEYCLOAK_KCADM_CONFIG:-/tmp/sq-hub-identity-management.kcadm}"
MANAGEMENT_SECRET="${KEYCLOAK_IDENTITY_MANAGEMENT_CLIENT_SECRET:-}"
MANAGEMENT_SECRET_FILE="${KEYCLOAK_IDENTITY_MANAGEMENT_CLIENT_SECRET_FILE:-}"

fail() {
  echo "Identity-management-client reconciliation failed: $1" >&2
  exit 1
}

[[ "${REALM}" == "sq-staff" || "${REALM}" == "sq-staff-staging" ]] || fail "explicit supported realm is required"
[[ -n "${CLIENT_ID}" ]] || fail "KEYCLOAK_IDENTITY_MANAGEMENT_CLIENT_ID is required"

# A secret file keeps the value out of the environment of every child process.
if [[ -n "${MANAGEMENT_SECRET_FILE}" ]]; then
  [[ -z "${MANAGEMENT_SECRET}" ]] || fail "set the client secret or the secret file, not both"
  [[ -f "${MANAGEMENT_SECRET_FILE}" && -r "${MANAGEMENT_SECRET_FILE}" ]] || fail "client secret file is not readable"
  [[ "$(stat -c '%a' "${MANAGEMENT_SECRET_FILE}")" =~ ^[0-7]00$ ]] || fail "client secret file must not be group or world accessible"
  MANAGEMENT_SECRET="$(<"${MANAGEMENT_SECRET_FILE}")"
fi
unset KEYCLOAK_IDENTITY_MANAGEMENT_CLIENT_SECRET
[[ -n "${MANAGEMENT_SECRET}" ]] || fail "KEYCLOAK_IDENTITY_MANAGEMENT_CLIENT_SECRET or _SECRET_FILE is required"
command -v jq >/dev/null 2>&1 || fail "jq is required"

case "${EXEC_MODE}" in
  compose)
    [[ -n "${ENV_FILE}" && -n "${COMPOSE_FILE}" ]] || fail "explicit environment and compose files are required"
    [[ -f "${ENV_FILE}" ]] || fail "environment file not found"
    [[ -f "${COMPOSE_FILE}" ]] || fail "compose file not found"
    command -v docker >/dev/null 2>&1 || fail "docker is required"

    compose_exec() {
      docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T keycloak "$@"
    }

    kcadm() {
      compose_exec /opt/keycloak/bin/kcadm.sh "$@" --config "${KCADM_CONFIG}"
    }

    compose_exec test -f "${KCADM_CONFIG}" >/dev/null 2>&1 \
      || fail "pre-authenticated kcadm config is not available inside the Keycloak container"
    ;;
  host)
    [[ -n "${KCADM_BIN}" ]] || fail "KEYCLOAK_KCADM_BIN is required in host mode"
    [[ -x "${KCADM_BIN}" ]] || fail "kcadm binary is not executable"

    kcadm() {
      "${KCADM_BIN}" "$@" --config "${KCADM_CONFIG}"
    }

    [[ -f "${KCADM_CONFIG}" ]] || fail "pre-authenticated kcadm config is not available on this host"
    ;;
  *)
    fail "KEYCLOAK_EXEC_MODE must be compose or host"
    ;;
esac

client_json="$(kcadm get clients -r "${REALM}" -q "clientId=${CLIENT_ID}")" \
  || fail "unable to query identity-management client"
client_count="$(jq 'length' <<<"${client_json}")"

# Pass the secret through jq's environment, not argv, so it never appears in a process listing.
client_payload="$(MANAGEMENT_SECRET="${MANAGEMENT_SECRET}" jq -n \
  --arg clientId "${CLIENT_ID}" \
  '{
    clientId: $clientId,
    name: "SQ Hub Identity Management",
    enabled: true,
    protocol: "openid-connect",
    publicClient: false,
    bearerOnly: false,
    standardFlowEnabled: false,
    implicitFlowEnabled: false,
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: true,
    fullScopeAllowed: false,
    secret: env.MANAGEMENT_SECRET
  }')"

if [[ "${client_count}" == "0" ]]; then
  printf '%s' "${client_payload}" | kcadm create clients -r "${REALM}" -f - >/dev/null
elif [[ "${client_count}" == "1" ]]; then
  client_uuid="$(jq -er '.[0].id' <<<"${client_json}")"
  printf '%s' "${client_payload}" | kcadm update "clients/${client_uuid}" -r "${REALM}" -f - >/dev/null
else
  fail "identity-management client is ambiguous"
fi

client_json="$(kcadm get clients -r "${REALM}" -q "clientId=${CLIENT_ID}")"
client_uuid="$(jq -er '.[0].id' <<<"${client_json}")"
service_user="$(kcadm get "clients/${client_uuid}/service-account-user" -r "${REALM}")"
service_user_id="$(jq -er '.id' <<<"${service_user}")"
realm_management="$(kcadm get clients -r "${REALM}" -q clientId=realm-management)"
rm_uuid="$(jq -er 'if length == 1 then .[0].id else error("realm-management ambiguous") end' <<<"${realm_management}")"

roles_payload="$(
  kcadm get "clients/${rm_uuid}/roles" -r "${REALM}" \
    | jq '[.[] | select(.name == "query-users")]'
)" || fail "unable to resolve least-privilege realm-management roles"
[[ "$(jq 'length' <<<"${roles_payload}")" == "1" ]] || fail "query-users role was not found"

current_roles="$(kcadm get "users/${service_user_id}/role-mappings/clients/${rm_uuid}" -r "${REALM}")" \
  || fail "unable to inspect service-account realm-management roles"
extra_roles="$(jq '[.[] | select(.name != "query-users")] | length' <<<"${current_roles}")"
[[ "${extra_roles}" == "0" ]] || fail "service account has broader direct realm-management roles"

missing_roles="$(jq --argjson current "${current_roles}" '[.[] | select(.name as $name | ($current | map(.name) | index($name) | not))]' <<<"${roles_payload}")"
if [[ "$(jq 'length' <<<"${missing_roles}")" != "0" ]]; then
  printf '%s' "${missing_roles}" \
    | kcadm create "users/${service_user_id}/role-mappings/clients/${rm_uuid}" -r "${REALM}" -f - >/dev/null
fi

# fullScopeAllowed remains false, so explicitly scope the client token to the exact
# realm-management roles its service account owns. Without these scope mappings,
# client_credentials can authenticate but the access token cannot exercise the roles.
current_scope_roles="$(kcadm get "clients/${client_uuid}/scope-mappings/clients/${rm_uuid}" -r "${REALM}")" \
  || fail "unable to inspect identity-management-client realm-management scope mappings"
extra_scope_roles="$(jq '[.[] | select(.name != "query-users")] | length' <<<"${current_scope_roles}")"
[[ "${extra_scope_roles}" == "0" ]] || fail "identity-management client scope contains broader realm-management roles"

missing_scope_roles="$(jq --argjson current "${current_scope_roles}" '[.[] | select(.name as $name | ($current | map(.name) | index($name) | not))]' <<<"${roles_payload}")"
if [[ "$(jq 'length' <<<"${missing_scope_roles}")" != "0" ]]; then
  printf '%s' "${missing_scope_roles}" \
    | kcadm create "clients/${client_uuid}/scope-mappings/clients/${rm_uuid}" -r "${REALM}" -f - >/dev/null
fi

verify_client="$(kcadm get "clients/${client_uuid}" -r "${REALM}")"
verify_roles="$(kcadm get "users/${service_user_id}/role-mappings/clients/${rm_uuid}" -r "${REALM}")"
verify_scope_roles="$(kcadm get "clients/${client_uuid}/scope-mappings/clients/${rm_uuid}" -r "${REALM}")"

jq -e '
  .enabled == true and
  .publicClient == false and
  .bearerOnly == false and
  .standardFlowEnabled == false and
  .implicitFlowEnabled == false and
  .directAccessGrantsEnabled == false and
  .serviceAccountsEnabled == true and
  .fullScopeAllowed == false
' >/dev/null <<<"${verify_client}" || fail "identity-management client did not converge"

[[ "$(jq '[.[] | select(.name == "query-users")] | length' <<<"${verify_roles}")" == "1" ]] \
  || fail "least-privilege service-account roles did not converge"
[[ "$(jq '[.[] | select(.name != "query-users")] | length' <<<"${verify_roles}")" == "0" ]] \
  || fail "unexpected direct realm-management role remains"
[[ "$(jq '[.[] | select(.name == "query-users")] | length' <<<"${verify_scope_roles}")" == "1" ]] \
  || fail "least-privilege client scope mappings did not converge"
[[ "$(jq '[.[] | select(.name != "query-users")] | length' <<<"${verify_scope_roles}")" == "0" ]] \
  || fail "unexpected realm-management client scope mapping remains"

unset MANAGEMENT_SECRET client_payload client_json service_user roles_payload current_roles missing_roles \
  current_scope_roles missing_scope_roles verify_client verify_roles verify_scope_roles

echo "IDENTITY_MANAGEMENT_CLIENT_CONFIGURATION_PASS"
echo "IDENTITY_MANAGEMENT_CLIENT_DIRECT_ROLES_PASS"
echo "FGAP_PERMISSION_AND_API_PROBE_PENDING"
