#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYCLOAK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${KEYCLOAK_ENV_FILE:-${KEYCLOAK_DIR}/.env.staging}"
COMPOSE_FILE="${KEYCLOAK_DIR}/docker-compose.staging.yml"
REALM="${KEYCLOAK_REALM:-sq-staff-staging}"
KCADM_CONFIG="${KEYCLOAK_KCADM_CONFIG:-/tmp/sq-hub-organization-directory.kcadm}"
PULL_CLIENT_ID="${ORG_DIRECTORY_PULL_CLIENT_ID:-sq-hub-organization-directory-staging}"
PULL_CLIENT_SECRET="${ORG_DIRECTORY_PULL_CLIENT_SECRET:-}"
READER_CLIENT_ID="${ORG_DIRECTORY_READER_CLIENT_ID:-aset-sq-directory-staging}"
READER_CLIENT_SECRET="${ORG_DIRECTORY_READER_CLIENT_SECRET:-}"
SCOPE_NAME="organization-directory.read"

fail() {
  echo "Organization Directory client reconciliation failed: $1" >&2
  exit 1
}

[[ "${REALM}" == "sq-staff-staging" ]] || fail "target realm must be exactly sq-staff-staging"
[[ -n "${PULL_CLIENT_SECRET}" ]] || fail "ORG_DIRECTORY_PULL_CLIENT_SECRET is required"
[[ -n "${READER_CLIENT_SECRET}" ]] || fail "ORG_DIRECTORY_READER_CLIENT_SECRET is required"
[[ "${PULL_CLIENT_ID}" != "${READER_CLIENT_ID}" ]] || fail "producer and reader clients must be separate"
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

scope_json="$(kcadm get client-scopes -r "${REALM}")" \
  || fail "unable to query client scopes"
scope_matches="$(jq --arg name "${SCOPE_NAME}" '[.[] | select(.name == $name)]' <<<"${scope_json}")"
scope_count="$(jq 'length' <<<"${scope_matches}")"

scope_payload="$(jq -n --arg name "${SCOPE_NAME}" '{
  name: $name,
  description: "Least-privilege scope for Organization Directory producer and reader calls.",
  protocol: "openid-connect",
  attributes: {
    "include.in.token.scope": "true",
    "display.on.consent.screen": "false"
  }
}')"

if [[ "${scope_count}" == "0" ]]; then
  printf '%s' "${scope_payload}" | kcadm create client-scopes -r "${REALM}" -f - >/dev/null
elif [[ "${scope_count}" == "1" ]]; then
  scope_uuid="$(jq -er '.[0].id' <<<"${scope_matches}")"
  printf '%s' "${scope_payload}" | kcadm update "client-scopes/${scope_uuid}" -r "${REALM}" -f - >/dev/null
else
  fail "Organization Directory client scope is ambiguous"
fi

scope_json="$(kcadm get client-scopes -r "${REALM}")"
scope_uuid="$(jq -er --arg name "${SCOPE_NAME}" \
  '[.[] | select(.name == $name)] | if length == 1 then .[0].id else error("scope ambiguous") end' \
  <<<"${scope_json}")"

reconcile_client() {
  local client_id="$1"
  local client_name="$2"
  local client_secret="$3"
  local mapper_name="$4"
  local audience="$5"
  local clients client_count client_uuid client_payload mapper_payload mappers mapper_matches mapper_count mapper_uuid
  local default_scopes optional_scopes stored_secret verify_client verify_mapper existing_client

  clients="$(kcadm get clients -r "${REALM}" -q "clientId=${client_id}")" \
    || fail "unable to query ${client_id}"
  client_count="$(jq 'length' <<<"${clients}")"
  client_payload="$(jq -n \
    --arg clientId "${client_id}" \
    --arg name "${client_name}" \
    --arg secret "${client_secret}" \
    '{
      clientId: $clientId,
      name: $name,
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
    printf '%s' "${client_payload}" \
      | jq '. + {defaultClientScopes: [], optionalClientScopes: []}' \
      | kcadm create clients -r "${REALM}" -f - >/dev/null
  elif [[ "${client_count}" == "1" ]]; then
    client_uuid="$(jq -er '.[0].id' <<<"${clients}")"
    existing_client="$(jq -er '.[0]' <<<"${clients}")"
    stored_secret="$(kcadm get "clients/${client_uuid}/client-secret" -r "${REALM}" | jq -er '.value')"
    if ! jq -e '
      .enabled == true and .publicClient == false and .bearerOnly == false and
      .standardFlowEnabled == false and .implicitFlowEnabled == false and
      .directAccessGrantsEnabled == false and .serviceAccountsEnabled == true and
      .fullScopeAllowed == false
    ' >/dev/null <<<"${existing_client}" || [[ "${stored_secret}" != "${client_secret}" ]]; then
      printf '%s' "${client_payload}" | kcadm update "clients/${client_uuid}" -r "${REALM}" -f - >/dev/null
    fi
  else
    fail "${client_id} is ambiguous"
  fi

  clients="$(kcadm get clients -r "${REALM}" -q "clientId=${client_id}")"
  client_uuid="$(jq -er 'if length == 1 then .[0].id else error("client ambiguous") end' <<<"${clients}")"

  # Machine clients receive no realm defaults. The single Directory scope is
  # optional and appears only when explicitly requested by client_credentials.
  default_scopes="$(kcadm get "clients/${client_uuid}/default-client-scopes" -r "${REALM}")"
  while IFS= read -r default_scope_uuid; do
    [[ -z "${default_scope_uuid}" ]] && continue
    kcadm delete "clients/${client_uuid}/default-client-scopes/${default_scope_uuid}" -r "${REALM}" >/dev/null
  done < <(jq -r '.[].id' <<<"${default_scopes}")

  optional_scopes="$(kcadm get "clients/${client_uuid}/optional-client-scopes" -r "${REALM}")"
  while IFS= read -r optional_scope_uuid; do
    [[ -z "${optional_scope_uuid}" || "${optional_scope_uuid}" == "${scope_uuid}" ]] && continue
    kcadm delete "clients/${client_uuid}/optional-client-scopes/${optional_scope_uuid}" -r "${REALM}" >/dev/null
  done < <(jq -r '.[].id' <<<"${optional_scopes}")
  optional_scopes="$(kcadm get "clients/${client_uuid}/optional-client-scopes" -r "${REALM}")"
  if ! jq -e --arg id "${scope_uuid}" 'any(.[]; .id == $id)' >/dev/null <<<"${optional_scopes}"; then
    kcadm update "clients/${client_uuid}/optional-client-scopes/${scope_uuid}" -r "${REALM}" >/dev/null
  fi

  mapper_payload="$(jq -n \
    --arg name "${mapper_name}" \
    --arg audience "${audience}" \
    '{
      name: $name,
      protocol: "openid-connect",
      protocolMapper: "oidc-audience-mapper",
      consentRequired: false,
      config: {
        "included.client.audience": $audience,
        "id.token.claim": "false",
        "access.token.claim": "true",
        "introspection.token.claim": "true"
      }
    }')"
  mappers="$(kcadm get "clients/${client_uuid}/protocol-mappers/models" -r "${REALM}")"
  mapper_matches="$(jq --arg name "${mapper_name}" '[.[] | select(.name == $name)]' <<<"${mappers}")"
  mapper_count="$(jq 'length' <<<"${mapper_matches}")"
  if [[ "${mapper_count}" == "0" ]]; then
    printf '%s' "${mapper_payload}" \
      | kcadm create "clients/${client_uuid}/protocol-mappers/models" -r "${REALM}" -f - >/dev/null
  elif [[ "${mapper_count}" == "1" ]]; then
    mapper_uuid="$(jq -er '.[0].id' <<<"${mapper_matches}")"
    if ! jq -e --arg audience "${audience}" '
      .[0].protocolMapper == "oidc-audience-mapper" and
      .[0].config["included.client.audience"] == $audience and
      .[0].config["id.token.claim"] == "false" and
      .[0].config["access.token.claim"] == "true" and
      .[0].config["introspection.token.claim"] == "true"
    ' >/dev/null <<<"${mapper_matches}"; then
      printf '%s' "${mapper_payload}" \
        | kcadm update "clients/${client_uuid}/protocol-mappers/models/${mapper_uuid}" -r "${REALM}" -f - >/dev/null
    fi
  else
    fail "${client_id} audience mapper is ambiguous"
  fi

  # Keycloak may attach realm defaults while creating/updating a client. Run
  # the removal after every client mutation as well, so verification observes
  # the final least-privilege state on both the first and subsequent runs.
  default_scopes="$(kcadm get "clients/${client_uuid}/default-client-scopes" -r "${REALM}")"
  while IFS= read -r default_scope_uuid; do
    [[ -z "${default_scope_uuid}" ]] && continue
    kcadm delete "clients/${client_uuid}/default-client-scopes/${default_scope_uuid}" -r "${REALM}" >/dev/null
  done < <(jq -r '.[].id' <<<"${default_scopes}")

  verify_client="$(kcadm get "clients/${client_uuid}" -r "${REALM}")"
  verify_mapper="$(kcadm get "clients/${client_uuid}/protocol-mappers/models" -r "${REALM}")"
  default_scopes="$(kcadm get "clients/${client_uuid}/default-client-scopes" -r "${REALM}")"
  optional_scopes="$(kcadm get "clients/${client_uuid}/optional-client-scopes" -r "${REALM}")"
  stored_secret="$(kcadm get "clients/${client_uuid}/client-secret" -r "${REALM}" | jq -er '.value')"

  jq -e '
    .enabled == true and .publicClient == false and .bearerOnly == false and
    .standardFlowEnabled == false and .implicitFlowEnabled == false and
    .directAccessGrantsEnabled == false and .serviceAccountsEnabled == true and
    .fullScopeAllowed == false
  ' >/dev/null <<<"${verify_client}" || fail "${client_id} did not converge"
  [[ "${stored_secret}" == "${client_secret}" ]] || fail "${client_id} secret did not converge"
  [[ "$(jq 'length' <<<"${default_scopes}")" == "0" ]] || fail "${client_id} retained default scopes"
  jq -e --arg id "${scope_uuid}" 'length == 1 and .[0].id == $id' >/dev/null <<<"${optional_scopes}" \
    || fail "${client_id} optional scope did not converge"
  jq -e --arg name "${mapper_name}" --arg audience "${audience}" '
    [.[] | select(.name == $name)] | length == 1 and
    .[0].protocolMapper == "oidc-audience-mapper" and
    .[0].config["included.client.audience"] == $audience and
    .[0].config["access.token.claim"] == "true"
  ' >/dev/null <<<"${verify_mapper}" || fail "${client_id} audience mapper did not converge"
}

reconcile_client \
  "${PULL_CLIENT_ID}" \
  "SQ Hub Organization Directory Staging Pull" \
  "${PULL_CLIENT_SECRET}" \
  "hcis-organization-directory-audience" \
  "hcis-organization-directory"

reconcile_client \
  "${READER_CLIENT_ID}" \
  "Aset SQ Organization Directory Staging Reader" \
  "${READER_CLIENT_SECRET}" \
  "sq-hub-organization-directory-audience" \
  "sq-hub-organization-directory-staging"

unset PULL_CLIENT_SECRET READER_CLIENT_SECRET scope_payload scope_json scope_matches

echo "ORGANIZATION_DIRECTORY_SCOPE_PASS"
echo "ORGANIZATION_DIRECTORY_CLIENTS_PASS"
echo "ORGANIZATION_DIRECTORY_LEAST_PRIVILEGE_PASS"
