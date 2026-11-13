#!/usr/bin/env bash
set -euo pipefail

# Idempotent convergence of the Sekretariat clients in the staff realm sq-staff (SEK-IMPL-001 §14 langkah 1):
#   sekretariat-sq    staff sign-in to https://sekretariat.sabilulquran.or.id (confidential, code flow + PKCE S256)
#   hcis-sekretariat  HCIS machine caller of /internal/sekretariat (client credentials, service account),
#                     with one audience mapper to the SQ Hub machine audience (MACHINE_TOKEN_AUDIENCE).
#
# The script only ever touches the realm named sq-staff and only these clients. It never creates the realm.
# Run it twice; the second run must create nothing.
#
# KEYCLOAK_EXEC_MODE selects how kcadm runs (as in reconcile-kerja-clients.sh):
#   compose (default) - inside the Docker Compose `keycloak` service (KEYCLOAK_ENV_FILE, KEYCLOAK_COMPOSE_FILE).
#   host              - a host-native kcadm.sh (Mi8, no Docker). Set KEYCLOAK_KCADM_BIN.
#   container         - `docker exec` into KEYCLOAK_CONTAINER (integration tests).
# In every mode KEYCLOAK_KCADM_CONFIG must already be authenticated (kcadm.sh config credentials).
#
# Required:
#   SEKRETARIAT_HUB_MACHINE_AUDIENCE          the audience SQ Hub verifies (SQ Hub MACHINE_TOKEN_AUDIENCE)
# Optional:
#   SEKRETARIAT_CLIENT_SECRET[_FILE]          sekretariat-sq secret; Keycloak keeps its own when unset
#   HCIS_SEKRETARIAT_CLIENT_SECRET[_FILE]     hcis-sekretariat secret; Keycloak keeps its own when unset
#   SEKRETARIAT_PUBLIC_BASE_URL               overrides https://sekretariat.sabilulquran.or.id (tests only)
# A *_FILE must be mode 600/400; the value never reaches argv.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYCLOAK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DESIRED_STATE="${SEKRETARIAT_CLIENTS_DESIRED_STATE:-${KEYCLOAK_DIR}/clients/sekretariat-sq.json}"
EXEC_MODE="${KEYCLOAK_EXEC_MODE:-compose}"
REALM="${KEYCLOAK_REALM:-sq-staff}"
KCADM_CONFIG="${KEYCLOAK_KCADM_CONFIG:-/tmp/sekretariat-clients.kcadm}"
SEKRETARIAT_BASE_URL="${SEKRETARIAT_PUBLIC_BASE_URL:-https://sekretariat.sabilulquran.or.id}"
HUB_AUDIENCE="${SEKRETARIAT_HUB_MACHINE_AUDIENCE:-}"
MAPPER_NAME="sekretariat-audience-hub"

fail() {
  echo "SEKRETARIAT_CLIENTS_RECONCILE_FAIL: $1" >&2
  exit 1
}

[[ "${REALM}" == "sq-staff" ]] || fail "this script only manages clients in the realm sq-staff"
command -v jq >/dev/null 2>&1 || fail "jq is required"
[[ -f "${DESIRED_STATE}" ]] || fail "desired-state file not found"
jq -e '.realm == "sq-staff" and (.clients | keys | sort == ["hcis-sekretariat", "sekretariat-sq"])' "${DESIRED_STATE}" >/dev/null \
  || fail "desired state must hold exactly sekretariat-sq and hcis-sekretariat for sq-staff"
jq -e '[.clients[] | has("secret")] | any | not' "${DESIRED_STATE}" >/dev/null || fail "desired state must not hold secrets"
[[ "${SEKRETARIAT_BASE_URL}" =~ ^https?://[A-Za-z0-9.:-]+$ ]] || fail "SEKRETARIAT_PUBLIC_BASE_URL must be a bare origin"
[[ -n "${HUB_AUDIENCE}" ]] || fail "SEKRETARIAT_HUB_MACHINE_AUDIENCE is required (SQ Hub MACHINE_TOKEN_AUDIENCE)"
[[ "${HUB_AUDIENCE}" =~ ^[A-Za-z0-9._-]+$ ]] || fail "the audience may hold only letters, digits, dot, dash and underscore"

read_secret() {
  local name="$1" file_var="$1_FILE" value file
  value="${!name:-}"
  file="${!file_var:-}"
  if [[ -n "${file}" ]]; then
    [[ -z "${value}" ]] || fail "set ${name} or ${file_var}, not both"
    [[ -f "${file}" && -r "${file}" ]] || fail "${file_var} is not readable"
    if stat -c '%a' "${file}" >/dev/null 2>&1; then
      [[ "$(stat -c '%a' "${file}")" =~ ^[0-7]00$ ]] || fail "${file_var} must not be group or world accessible"
    fi
    value="$(<"${file}")"
  fi
  printf '%s' "${value}"
}

SEKRETARIAT_SECRET_VALUE="$(read_secret SEKRETARIAT_CLIENT_SECRET)"
HCIS_SECRET_VALUE="$(read_secret HCIS_SEKRETARIAT_CLIENT_SECRET)"
unset SEKRETARIAT_CLIENT_SECRET HCIS_SEKRETARIAT_CLIENT_SECRET

# Only a call that sends a payload (-f -) may read stdin; every other call reads /dev/null.
exec {DEV_NULL_FD}</dev/null
stdin_for_kcadm() {
  KCADM_STDIN="${DEV_NULL_FD}"
  local previous=""
  for arg in "$@"; do
    if [[ "${previous}" == "-f" && "${arg}" == "-" ]]; then
      KCADM_STDIN=0
    fi
    previous="${arg}"
  done
}

case "${EXEC_MODE}" in
  compose)
    ENV_FILE="${KEYCLOAK_ENV_FILE:-}"
    COMPOSE_FILE="${KEYCLOAK_COMPOSE_FILE:-${KEYCLOAK_DIR}/docker-compose.ci.yml}"
    [[ -n "${ENV_FILE}" && -f "${ENV_FILE}" ]] || fail "KEYCLOAK_ENV_FILE is required in compose mode"
    [[ -f "${COMPOSE_FILE}" ]] || fail "compose file not found"
    command -v docker >/dev/null 2>&1 || fail "docker is required"
    kc_exec() { docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T keycloak "$@"; }
    kcadm() { stdin_for_kcadm "$@"; kc_exec /opt/keycloak/bin/kcadm.sh "$@" --config "${KCADM_CONFIG}" <&"${KCADM_STDIN}"; }
    kc_exec test -f "${KCADM_CONFIG}" >/dev/null 2>&1 || fail "pre-authenticated kcadm config is missing in the container"
    ;;
  container)
    CONTAINER="${KEYCLOAK_CONTAINER:-}"
    [[ -n "${CONTAINER}" ]] || fail "KEYCLOAK_CONTAINER is required in container mode"
    command -v docker >/dev/null 2>&1 || fail "docker is required"
    kcadm() { stdin_for_kcadm "$@"; docker exec -i "${CONTAINER}" /opt/keycloak/bin/kcadm.sh "$@" --config "${KCADM_CONFIG}" <&"${KCADM_STDIN}"; }
    docker exec "${CONTAINER}" test -f "${KCADM_CONFIG}" >/dev/null 2>&1 || fail "pre-authenticated kcadm config is missing in the container"
    ;;
  host)
    KCADM_BIN="${KEYCLOAK_KCADM_BIN:-}"
    [[ -n "${KCADM_BIN}" && -x "${KCADM_BIN}" ]] || fail "KEYCLOAK_KCADM_BIN must be an executable kcadm.sh in host mode"
    kcadm() { stdin_for_kcadm "$@"; "${KCADM_BIN}" "$@" --config "${KCADM_CONFIG}" <&"${KCADM_STDIN}"; }
    [[ -f "${KCADM_CONFIG}" ]] || fail "pre-authenticated kcadm config is missing on this host"
    ;;
  *)
    fail "KEYCLOAK_EXEC_MODE must be compose, host or container"
    ;;
esac

kcadm get "realms/${REALM}" 2>/dev/null | jq -e --arg realm "${REALM}" '.realm == $realm' >/dev/null \
  || fail "realm ${REALM} not found"

client_scopes="$(kcadm get client-scopes -r "${REALM}")" || fail "unable to read client scopes"
scope_id() {
  jq -er --arg name "$1" '[.[] | select(.name == $name)] | if length == 1 then .[0].id else error("missing") end' <<<"${client_scopes}" \
    || fail "client scope $1 not found in ${REALM}"
}

reconcile_client_scopes() {
  local client_uuid="$1" kind="$2" wanted="$3" current wanted_ids
  current="$(kcadm get "clients/${client_uuid}/${kind}-client-scopes" -r "${REALM}")"
  wanted_ids="$(jq -r '.[]' <<<"${wanted}" | while read -r name; do scope_id "${name}"; done | jq -R . | jq -sc .)"
  while read -r id; do
    [[ -n "${id}" ]] || continue
    kcadm delete "clients/${client_uuid}/${kind}-client-scopes/${id}" -r "${REALM}" >/dev/null || fail "unable to remove a ${kind} scope"
  done < <(jq -r --argjson wanted "${wanted_ids}" '.[] | select(.id as $id | $wanted | index($id) | not) | .id' <<<"${current}")
  while read -r id; do
    [[ -n "${id}" ]] || continue
    kcadm update "clients/${client_uuid}/${kind}-client-scopes/${id}" -r "${REALM}" -n -b '{}' >/dev/null || fail "unable to add a ${kind} scope"
  done < <(jq -r --argjson current "${current}" '.[] | select(. as $id | $current | map(.id) | index($id) | not)' <<<"${wanted_ids}")
}

reconcile_client() {
  local client_id="$1" secret="$2" spec payload existing client_uuid
  spec="$(jq -c --arg base "${SEKRETARIAT_BASE_URL}" --arg id "${client_id}" '
    def rebase: sub("^https://sekretariat\\.sabilulquran\\.or\\.id"; $base);
    .clients[$id]
    | .redirectUris |= map(rebase)
    | (if .attributes["post.logout.redirect.uris"] then .attributes["post.logout.redirect.uris"] |= rebase else . end)' "${DESIRED_STATE}")"
  payload="$(CLIENT_SECRET="${secret}" jq -c 'del(.defaultClientScopes, .optionalClientScopes)
    | if env.CLIENT_SECRET != "" then .secret = env.CLIENT_SECRET else . end' <<<"${spec}")"
  existing="$(kcadm get clients -r "${REALM}" -q "clientId=${client_id}")"
  case "$(jq --arg id "${client_id}" '[.[] | select(.clientId == $id)] | length' <<<"${existing}")" in
    0) printf '%s' "${payload}" | kcadm create clients -r "${REALM}" -f - >/dev/null || fail "unable to create ${client_id}"
       echo "SEKRETARIAT_CLIENT_CREATED client=${client_id}" ;;
    1) client_uuid="$(jq -er --arg id "${client_id}" '[.[] | select(.clientId == $id)][0].id' <<<"${existing}")"
       printf '%s' "${payload}" | kcadm update "clients/${client_uuid}" -r "${REALM}" -f - >/dev/null || fail "unable to update ${client_id}" ;;
    *) fail "client ${client_id} is ambiguous" ;;
  esac
  unset payload
  client_uuid="$(kcadm get clients -r "${REALM}" -q "clientId=${client_id}" \
    | jq -er --arg id "${client_id}" '[.[] | select(.clientId == $id)] | if length == 1 then .[0].id else error("ambiguous") end')" \
    || fail "client ${client_id} is missing or ambiguous"
  reconcile_client_scopes "${client_uuid}" default "$(jq -c '.defaultClientScopes' <<<"${spec}")"
  reconcile_client_scopes "${client_uuid}" optional "$(jq -c '.optionalClientScopes' <<<"${spec}")"
  kcadm get "clients/${client_uuid}" -r "${REALM}" | jq -e --argjson spec "${spec}" '
    . as $live
    | ($spec | del(.defaultClientScopes, .optionalClientScopes, .attributes, .name) | to_entries | all(.value == $live[.key]))
    and ($spec.attributes | to_entries | all(.value == $live.attributes[.key]))
  ' >/dev/null || fail "client ${client_id} did not converge"
  CLIENT_UUID="${client_uuid}"
}

# sekretariat-sq: staff sign-in. No client-level mappers; the display name comes from the profile scope.
reconcile_client sekretariat-sq "${SEKRETARIAT_SECRET_VALUE}"
browser_uuid="${CLIENT_UUID}"
unset SEKRETARIAT_SECRET_VALUE
while read -r mapper_id; do
  [[ -n "${mapper_id}" ]] || continue
  kcadm delete "clients/${browser_uuid}/protocol-mappers/models/${mapper_id}" -r "${REALM}" >/dev/null || fail "unable to remove a mapper from sekretariat-sq"
done < <(kcadm get "clients/${browser_uuid}/protocol-mappers/models" -r "${REALM}" | jq -r '.[].id')
[[ "$(kcadm get "clients/${browser_uuid}/protocol-mappers/models" -r "${REALM}" | jq 'length')" == "0" ]] \
  || fail "sekretariat-sq kept client-level mappers"

# hcis-sekretariat: client credentials with exactly one audience mapper to the Hub machine audience.
reconcile_client hcis-sekretariat "${HCIS_SECRET_VALUE}"
machine_uuid="${CLIENT_UUID}"
unset HCIS_SECRET_VALUE
mappers="$(kcadm get "clients/${machine_uuid}/protocol-mappers/models" -r "${REALM}")"
wanted_mapper="$(jq -nc --arg name "${MAPPER_NAME}" --arg audience "${HUB_AUDIENCE}" '{
  name: $name,
  protocol: "openid-connect",
  protocolMapper: "oidc-audience-mapper",
  config: { "included.custom.audience": $audience, "access.token.claim": "true", "id.token.claim": "false" }
}')"
while read -r mapper_id; do
  [[ -n "${mapper_id}" ]] || continue
  kcadm delete "clients/${machine_uuid}/protocol-mappers/models/${mapper_id}" -r "${REALM}" >/dev/null || fail "unable to remove a mapper from hcis-sekretariat"
done < <(jq -r --arg name "${MAPPER_NAME}" '.[] | select(.name != $name) | .id' <<<"${mappers}")
existing_mapper_id="$(jq -r --arg name "${MAPPER_NAME}" '[.[] | select(.name == $name)] | if length == 1 then .[0].id else "" end' <<<"${mappers}")"
if [[ -z "${existing_mapper_id}" ]]; then
  printf '%s' "${wanted_mapper}" | kcadm create "clients/${machine_uuid}/protocol-mappers/models" -r "${REALM}" -f - >/dev/null \
    || fail "unable to create the hcis-sekretariat audience mapper"
  echo "SEKRETARIAT_CLIENT_CREATED client=hcis-sekretariat mapper=${MAPPER_NAME}"
else
  merged="$(jq -c --argjson wanted "${wanted_mapper}" --arg id "${existing_mapper_id}" '$wanted + {id: $id}' <<<'{}')"
  printf '%s' "${merged}" | kcadm update "clients/${machine_uuid}/protocol-mappers/models/${existing_mapper_id}" -r "${REALM}" -f - >/dev/null \
    || fail "unable to update the hcis-sekretariat audience mapper"
fi
kcadm get "clients/${machine_uuid}/protocol-mappers/models" -r "${REALM}" | jq -e \
  --arg name "${MAPPER_NAME}" --arg audience "${HUB_AUDIENCE}" '
  length == 1 and .[0].name == $name and .[0].protocolMapper == "oidc-audience-mapper"
  and .[0].config["included.custom.audience"] == $audience
' >/dev/null || fail "hcis-sekretariat audience mapper did not converge"

unset client_scopes mappers wanted_mapper
echo "SEKRETARIAT_CLIENTS_RECONCILE_IDEMPOTENT_PASS realm=${REALM} clients=sekretariat-sq,hcis-sekretariat"
echo "Secrets are never printed. Hand them to the approved env paths only: SEKRETARIAT_OIDC_CLIENT_SECRET (SQ Hub) and the HCIS consumer env."
