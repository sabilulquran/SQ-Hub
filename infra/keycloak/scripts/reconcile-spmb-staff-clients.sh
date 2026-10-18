#!/usr/bin/env bash
set -euo pipefail

# Idempotent convergence of the SPMB SQ clients in the staff realm sq-staff (SPMB-IMPL-001 §4, §14 no. 1):
#   spmb-sq   staff sign-in to https://spmb.sabilulquran.or.id/staf (confidential, code flow + PKCE S256)
#   spmb-api  client credentials for SQ Hub (Application Access, Organization Directory) and the Keluarga SQ
#             internal API, with one audience mapper per target and the optional scope organization-directory.read
# spmb-keluarga (realm sq-keluarga) is converged by reconcile-keluarga-realm.sh, not here.
#
# The script only ever touches the realm named sq-staff and only these two clients. It never creates the realm
# or the organization-directory.read scope; both must already exist. On spmb-api it manages only mappers named
# "spmb-api-audience-*", so mappers other runbooks add (e.g. Kirim SQ's sq-hub-kirim audience) stay.
# Production runs need explicit owner approval.
#
# KEYCLOAK_EXEC_MODE selects how kcadm runs (as in reconcile-keluarga-realm.sh):
#   compose (default) - inside the Docker Compose `keycloak` service (KEYCLOAK_ENV_FILE, KEYCLOAK_COMPOSE_FILE).
#   host              - a host-native kcadm.sh (Mi8, no Docker). Set KEYCLOAK_KCADM_BIN.
#   container         - `docker exec` into KEYCLOAK_CONTAINER (integration tests).
# In every mode KEYCLOAK_KCADM_CONFIG must already be authenticated (kcadm.sh config credentials).
#
# Required:
#   SPMB_HUB_MACHINE_AUDIENCE        the audience SQ Hub Application Access verifies (SQ Hub MACHINE_TOKEN_AUDIENCE)
# Optional:
#   SPMB_DIRECTORY_AUDIENCE          SQ Hub ORG_DIRECTORY_READ_AUDIENCE, default sq-hub-organization-directory
#   KELUARGA_API_AUDIENCE            Keluarga SQ INTERNAL_AUDIENCE, default keluarga-api
#   SPMB_STAFF_CLIENT_SECRET[_FILE]  spmb-sq secret; Keycloak keeps its own when unset
#   SPMB_API_CLIENT_SECRET[_FILE]    spmb-api secret; same. A *_FILE must be mode 600/400; values never reach argv.
#   SPMB_PUBLIC_BASE_URL             overrides https://spmb.sabilulquran.or.id in redirect URIs (tests only)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYCLOAK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DESIRED_STATE="${SPMB_STAFF_CLIENTS_DESIRED_STATE:-${KEYCLOAK_DIR}/clients/spmb-sq-staff.json}"
EXEC_MODE="${KEYCLOAK_EXEC_MODE:-compose}"
REALM="${KEYCLOAK_REALM:-sq-staff}"
KCADM_CONFIG="${KEYCLOAK_KCADM_CONFIG:-/tmp/spmb-staff-clients.kcadm}"
SPMB_BASE_URL="${SPMB_PUBLIC_BASE_URL:-https://spmb.sabilulquran.or.id}"
HUB_AUDIENCE="${SPMB_HUB_MACHINE_AUDIENCE:-}"
DIRECTORY_AUDIENCE="${SPMB_DIRECTORY_AUDIENCE:-sq-hub-organization-directory}"
KELUARGA_AUDIENCE="${KELUARGA_API_AUDIENCE:-keluarga-api}"
MAPPER_PREFIX="spmb-api-audience-"

fail() {
  echo "SPMB_STAFF_CLIENTS_RECONCILE_FAIL: $1" >&2
  exit 1
}

[[ "${REALM}" == "sq-staff" ]] || fail "this script only manages clients in the realm sq-staff"
command -v jq >/dev/null 2>&1 || fail "jq is required"
[[ -f "${DESIRED_STATE}" ]] || fail "desired-state file not found"
jq -e '.realm == "sq-staff" and (.clients | keys == ["spmb-api", "spmb-sq"])' "${DESIRED_STATE}" >/dev/null \
  || fail "desired state must hold exactly spmb-sq and spmb-api for sq-staff"
jq -e '[.clients[] | has("secret")] | any | not' "${DESIRED_STATE}" >/dev/null || fail "desired state must not hold secrets"
[[ "${SPMB_BASE_URL}" =~ ^https?://[A-Za-z0-9.:-]+$ ]] || fail "SPMB_PUBLIC_BASE_URL must be a bare origin"
[[ -n "${HUB_AUDIENCE}" ]] || fail "SPMB_HUB_MACHINE_AUDIENCE is required (SQ Hub MACHINE_TOKEN_AUDIENCE)"
for audience in "${HUB_AUDIENCE}" "${DIRECTORY_AUDIENCE}" "${KELUARGA_AUDIENCE}"; do
  [[ "${audience}" =~ ^[A-Za-z0-9._-]+$ ]] || fail "audiences may hold only letters, digits, dot, dash and underscore"
done

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

STAFF_SECRET="$(read_secret SPMB_STAFF_CLIENT_SECRET)"
API_SECRET="$(read_secret SPMB_API_CLIENT_SECRET)"
unset SPMB_STAFF_CLIENT_SECRET SPMB_API_CLIENT_SECRET

# `docker exec -i` and `docker compose exec` read stdin. Only a call that sends a payload (-f -) may read it;
# every other call reads /dev/null, so it cannot swallow the input of a surrounding `while read` loop.
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

# The realm must already exist; this script never creates sq-staff.
kcadm get "realms/${REALM}" 2>/dev/null | jq -e --arg realm "${REALM}" '.realm == $realm' >/dev/null \
  || fail "realm ${REALM} not found"

client_scopes="$(kcadm get client-scopes -r "${REALM}")" || fail "unable to read client scopes"
scope_id() {
  jq -er --arg name "$1" '[.[] | select(.name == $name)] | if length == 1 then .[0].id else error("missing") end' <<<"${client_scopes}" \
    || fail "client scope $1 not found in ${REALM}; create it through its own runbook first"
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

client_uuid_of() {
  kcadm get clients -r "${REALM}" -q "clientId=$1" \
    | jq -er --arg id "$1" '[.[] | select(.clientId == $id)] | if length == 1 then .[0].id else error("ambiguous") end' \
    || fail "client $1 is missing or ambiguous"
}

upsert_client() {
  local client_id="$1" secret="$2" spec payload existing count client_uuid
  spec="$(jq -c --arg id "${client_id}" --arg spmb "${SPMB_BASE_URL}" '
    def rebase: sub("^https://spmb\\.sabilulquran\\.or\\.id"; $spmb);
    .clients[$id]
    | .redirectUris |= map(rebase)
    | if .attributes["post.logout.redirect.uris"] then .attributes["post.logout.redirect.uris"] |= rebase else . end' "${DESIRED_STATE}")"
  payload="$(CLIENT_SECRET="${secret}" jq -c 'del(.defaultClientScopes, .optionalClientScopes)
    | if env.CLIENT_SECRET != "" then .secret = env.CLIENT_SECRET else . end' <<<"${spec}")"
  existing="$(kcadm get clients -r "${REALM}" -q "clientId=${client_id}")"
  count="$(jq --arg id "${client_id}" '[.[] | select(.clientId == $id)] | length' <<<"${existing}")"
  case "${count}" in
    0) printf '%s' "${payload}" | kcadm create clients -r "${REALM}" -f - >/dev/null || fail "unable to create ${client_id}"
       echo "SPMB_CLIENT_CREATED client=${client_id}" ;;
    1) client_uuid="$(jq -er --arg id "${client_id}" '[.[] | select(.clientId == $id)][0].id' <<<"${existing}")"
       printf '%s' "${payload}" | kcadm update "clients/${client_uuid}" -r "${REALM}" -f - >/dev/null || fail "unable to update ${client_id}" ;;
    *) fail "client ${client_id} is ambiguous" ;;
  esac
  unset payload
  client_uuid="$(client_uuid_of "${client_id}")"
  reconcile_client_scopes "${client_uuid}" default "$(jq -c '.defaultClientScopes' <<<"${spec}")"
  reconcile_client_scopes "${client_uuid}" optional "$(jq -c '.optionalClientScopes' <<<"${spec}")"
  SPEC="${spec}"
  CLIENT_UUID="${client_uuid}"
}

verify_client() {
  local client_id="$1" spec="$2" client_uuid="$3" wanted_default wanted_optional
  kcadm get "clients/${client_uuid}" -r "${REALM}" | jq -e --argjson spec "${spec}" '
    . as $live
    | ($spec | del(.defaultClientScopes, .optionalClientScopes, .attributes, .name) | to_entries | all(.value == $live[.key]))
    and ($spec.attributes | to_entries | all(.value == $live.attributes[.key]))
  ' >/dev/null || fail "client ${client_id} did not converge"
  wanted_default="$(jq -c '.defaultClientScopes | sort' <<<"${spec}")"
  wanted_optional="$(jq -c '.optionalClientScopes | sort' <<<"${spec}")"
  [[ "$(kcadm get "clients/${client_uuid}/default-client-scopes" -r "${REALM}" | jq -c 'map(.name) | sort')" == "${wanted_default}" ]] \
    || fail "client ${client_id} default scopes did not converge"
  [[ "$(kcadm get "clients/${client_uuid}/optional-client-scopes" -r "${REALM}" | jq -c 'map(.name) | sort')" == "${wanted_optional}" ]] \
    || fail "client ${client_id} optional scopes did not converge"
}

# ---------------------------------------------------------------------------------------------
# spmb-sq: staff sign-in. No client-level mappers; the name comes from the profile scope.
# ---------------------------------------------------------------------------------------------
upsert_client spmb-sq "${STAFF_SECRET}"
staff_spec="${SPEC}"
staff_uuid="${CLIENT_UUID}"
while read -r mapper_id; do
  [[ -n "${mapper_id}" ]] || continue
  kcadm delete "clients/${staff_uuid}/protocol-mappers/models/${mapper_id}" -r "${REALM}" >/dev/null || fail "unable to remove a mapper from spmb-sq"
done < <(kcadm get "clients/${staff_uuid}/protocol-mappers/models" -r "${REALM}" | jq -r '.[].id')
verify_client spmb-sq "${staff_spec}" "${staff_uuid}"
[[ "$(kcadm get "clients/${staff_uuid}/protocol-mappers/models" -r "${REALM}" | jq 'length')" == "0" ]] \
  || fail "spmb-sq kept client-level mappers"
echo "SPMB_CLIENT_PASS client=spmb-sq"

# ---------------------------------------------------------------------------------------------
# spmb-api: client credentials, one audience mapper per target.
# ---------------------------------------------------------------------------------------------
upsert_client spmb-api "${API_SECRET}"
api_spec="${SPEC}"
api_uuid="${CLIENT_UUID}"
unset STAFF_SECRET API_SECRET

wanted_mappers="$(jq -nc \
  --arg prefix "${MAPPER_PREFIX}" --arg hub "${HUB_AUDIENCE}" --arg directory "${DIRECTORY_AUDIENCE}" --arg keluarga "${KELUARGA_AUDIENCE}" '
  [["sq-hub", $hub], ["organization-directory", $directory], ["keluarga-api", $keluarga]]
  | map({
      name: ($prefix + .[0]),
      protocol: "openid-connect",
      protocolMapper: "oidc-audience-mapper",
      consentRequired: false,
      config: {
        "included.custom.audience": .[1],
        "id.token.claim": "false",
        "access.token.claim": "true",
        "introspection.token.claim": "true"
      }
    })')"

mappers="$(kcadm get "clients/${api_uuid}/protocol-mappers/models" -r "${REALM}")"
# Managed mappers that are no longer wanted go; mappers outside the prefix are left alone.
while read -r mapper_id; do
  [[ -n "${mapper_id}" ]] || continue
  kcadm delete "clients/${api_uuid}/protocol-mappers/models/${mapper_id}" -r "${REALM}" >/dev/null || fail "unable to remove a stale spmb-api mapper"
done < <(jq -r --arg prefix "${MAPPER_PREFIX}" --argjson wanted "${wanted_mappers}" '
  .[] | select((.name | startswith($prefix)) and ((.name) as $n | $wanted | map(.name) | index($n) | not)) | .id' <<<"${mappers}")

while read -r wanted; do
  name="$(jq -r '.name' <<<"${wanted}")"
  matches="$(jq --arg name "${name}" '[.[] | select(.name == $name)]' <<<"${mappers}")"
  case "$(jq 'length' <<<"${matches}")" in
    0) printf '%s' "${wanted}" | kcadm create "clients/${api_uuid}/protocol-mappers/models" -r "${REALM}" -f - >/dev/null \
         || fail "unable to create mapper ${name}"
       echo "SPMB_MAPPER_CREATED mapper=${name}" ;;
    1) if ! jq -e --argjson wanted "${wanted}" '.[0] | .protocolMapper == $wanted.protocolMapper
           and (.config | to_entries | sort) == ($wanted.config | to_entries | sort)' >/dev/null <<<"${matches}"; then
         mapper_id="$(jq -er '.[0].id' <<<"${matches}")"
         jq -c --arg id "${mapper_id}" '. + {id: $id}' <<<"${wanted}" \
           | kcadm update "clients/${api_uuid}/protocol-mappers/models/${mapper_id}" -r "${REALM}" -f - >/dev/null \
           || fail "unable to update mapper ${name}"
       fi ;;
    *) fail "mapper ${name} is ambiguous" ;;
  esac
done < <(jq -c '.[]' <<<"${wanted_mappers}")

verify_client spmb-api "${api_spec}" "${api_uuid}"
kcadm get "clients/${api_uuid}/protocol-mappers/models" -r "${REALM}" | jq -e --arg prefix "${MAPPER_PREFIX}" --argjson wanted "${wanted_mappers}" '
  [.[] | select(.name | startswith($prefix)) | {name, protocolMapper, config: (.config | to_entries | sort)}] | sort_by(.name)
  == ($wanted | map({name, protocolMapper, config: (.config | to_entries | sort)}) | sort_by(.name))
' >/dev/null || fail "spmb-api audience mappers did not converge"
echo "SPMB_CLIENT_PASS client=spmb-api"

unset client_scopes mappers wanted_mappers
echo "SPMB_STAFF_CLIENTS_RECONCILE_IDEMPOTENT_PASS realm=${REALM}"
echo "Client secrets are never printed. Hand them to the SPMB SQ final.env only through the approved secret path."
