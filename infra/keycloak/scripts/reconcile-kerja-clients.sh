#!/usr/bin/env bash
set -euo pipefail

# Idempotent convergence of the Kerja client in the staff realm sq-staff (KERJA-IMPL-001 §7.1, §15 langkah 1):
#   kerja-sq   staff sign-in to https://kerja.sabilulquran.or.id (confidential, code flow + PKCE S256)
# No machine client: R1 has no module calling Kerja (KERJA-IMPL-001 §2 "Audience mesin").
#
# The script only ever touches the realm named sq-staff and only this client. It never creates the realm.
# Run it twice; the second run must create nothing.
#
# KEYCLOAK_EXEC_MODE selects how kcadm runs (as in reconcile-spmb-staff-clients.sh):
#   compose (default) - inside the Docker Compose `keycloak` service (KEYCLOAK_ENV_FILE, KEYCLOAK_COMPOSE_FILE).
#   host              - a host-native kcadm.sh (Mi8, no Docker). Set KEYCLOAK_KCADM_BIN.
#   container         - `docker exec` into KEYCLOAK_CONTAINER (integration tests).
# In every mode KEYCLOAK_KCADM_CONFIG must already be authenticated (kcadm.sh config credentials).
#
# Optional:
#   KERJA_CLIENT_SECRET[_FILE]   kerja-sq secret; Keycloak keeps its own when unset. A *_FILE must be mode 600/400;
#                                the value never reaches argv.
#   KERJA_PUBLIC_BASE_URL        overrides https://kerja.sabilulquran.or.id in redirect URIs (tests only)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYCLOAK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DESIRED_STATE="${KERJA_CLIENTS_DESIRED_STATE:-${KEYCLOAK_DIR}/clients/kerja-sq.json}"
EXEC_MODE="${KEYCLOAK_EXEC_MODE:-compose}"
REALM="${KEYCLOAK_REALM:-sq-staff}"
KCADM_CONFIG="${KEYCLOAK_KCADM_CONFIG:-/tmp/kerja-clients.kcadm}"
KERJA_BASE_URL="${KERJA_PUBLIC_BASE_URL:-https://kerja.sabilulquran.or.id}"

fail() {
  echo "KERJA_CLIENTS_RECONCILE_FAIL: $1" >&2
  exit 1
}

[[ "${REALM}" == "sq-staff" ]] || fail "this script only manages clients in the realm sq-staff"
command -v jq >/dev/null 2>&1 || fail "jq is required"
[[ -f "${DESIRED_STATE}" ]] || fail "desired-state file not found"
jq -e '.realm == "sq-staff" and (.clients | keys == ["kerja-sq"])' "${DESIRED_STATE}" >/dev/null \
  || fail "desired state must hold exactly kerja-sq for sq-staff"
jq -e '[.clients[] | has("secret")] | any | not' "${DESIRED_STATE}" >/dev/null || fail "desired state must not hold secrets"
[[ "${KERJA_BASE_URL}" =~ ^https?://[A-Za-z0-9.:-]+$ ]] || fail "KERJA_PUBLIC_BASE_URL must be a bare origin"

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

CLIENT_SECRET_VALUE="$(read_secret KERJA_CLIENT_SECRET)"
unset KERJA_CLIENT_SECRET

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

spec="$(jq -c --arg base "${KERJA_BASE_URL}" '
  def rebase: sub("^https://kerja\\.sabilulquran\\.or\\.id"; $base);
  .clients["kerja-sq"]
  | .redirectUris |= map(rebase)
  | .attributes["post.logout.redirect.uris"] |= rebase' "${DESIRED_STATE}")"
payload="$(CLIENT_SECRET="${CLIENT_SECRET_VALUE}" jq -c 'del(.defaultClientScopes, .optionalClientScopes)
  | if env.CLIENT_SECRET != "" then .secret = env.CLIENT_SECRET else . end' <<<"${spec}")"
unset CLIENT_SECRET_VALUE

existing="$(kcadm get clients -r "${REALM}" -q "clientId=kerja-sq")"
case "$(jq '[.[] | select(.clientId == "kerja-sq")] | length' <<<"${existing}")" in
  0) printf '%s' "${payload}" | kcadm create clients -r "${REALM}" -f - >/dev/null || fail "unable to create kerja-sq"
     echo "KERJA_CLIENT_CREATED client=kerja-sq" ;;
  1) client_uuid="$(jq -er '[.[] | select(.clientId == "kerja-sq")][0].id' <<<"${existing}")"
     printf '%s' "${payload}" | kcadm update "clients/${client_uuid}" -r "${REALM}" -f - >/dev/null || fail "unable to update kerja-sq" ;;
  *) fail "client kerja-sq is ambiguous" ;;
esac
unset payload

client_uuid="$(kcadm get clients -r "${REALM}" -q "clientId=kerja-sq" \
  | jq -er '[.[] | select(.clientId == "kerja-sq")] | if length == 1 then .[0].id else error("ambiguous") end')" \
  || fail "client kerja-sq is missing or ambiguous"
reconcile_client_scopes "${client_uuid}" default "$(jq -c '.defaultClientScopes' <<<"${spec}")"
reconcile_client_scopes "${client_uuid}" optional "$(jq -c '.optionalClientScopes' <<<"${spec}")"

# No client-level mappers: the display name comes from the profile scope.
while read -r mapper_id; do
  [[ -n "${mapper_id}" ]] || continue
  kcadm delete "clients/${client_uuid}/protocol-mappers/models/${mapper_id}" -r "${REALM}" >/dev/null || fail "unable to remove a mapper from kerja-sq"
done < <(kcadm get "clients/${client_uuid}/protocol-mappers/models" -r "${REALM}" | jq -r '.[].id')

kcadm get "clients/${client_uuid}" -r "${REALM}" | jq -e --argjson spec "${spec}" '
  . as $live
  | ($spec | del(.defaultClientScopes, .optionalClientScopes, .attributes, .name) | to_entries | all(.value == $live[.key]))
  and ($spec.attributes | to_entries | all(.value == $live.attributes[.key]))
' >/dev/null || fail "client kerja-sq did not converge"
[[ "$(kcadm get "clients/${client_uuid}/default-client-scopes" -r "${REALM}" | jq -c 'map(.name) | sort')" == "$(jq -c '.defaultClientScopes | sort' <<<"${spec}")" ]] \
  || fail "client kerja-sq default scopes did not converge"
[[ "$(kcadm get "clients/${client_uuid}/optional-client-scopes" -r "${REALM}" | jq -c 'map(.name) | sort')" == "$(jq -c '.optionalClientScopes | sort' <<<"${spec}")" ]] \
  || fail "client kerja-sq optional scopes did not converge"
[[ "$(kcadm get "clients/${client_uuid}/protocol-mappers/models" -r "${REALM}" | jq 'length')" == "0" ]] \
  || fail "kerja-sq kept client-level mappers"

unset client_scopes
echo "KERJA_CLIENTS_RECONCILE_IDEMPOTENT_PASS realm=${REALM} client=kerja-sq"
echo "The client secret is never printed. Hand it to the SQ Hub API env (KERJA_OIDC_CLIENT_SECRET) only through the approved secret path."
