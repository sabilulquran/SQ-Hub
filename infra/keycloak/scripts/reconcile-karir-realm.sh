#!/usr/bin/env bash
set -euo pipefail

# Idempotent convergence of the candidate realm sq-karir (REC-IMPL-001 §4, ADR-0008):
# realm settings, declarative user profile, required actions, the three flows bound to the
# sq-karir-identity provider, brute-force protection, events (90 days), the karir-portal and
# karir-identity-admin clients, and the fine-grained admin permission of karir-identity-admin.
#
# The script only ever touches the realm named sq-karir. It needs the provider JAR and the
# sq-karir theme in the running Keycloak. Production runs need explicit owner approval.
#
# KEYCLOAK_EXEC_MODE selects how kcadm runs:
#   compose (default) - inside the Docker Compose `keycloak` service (KEYCLOAK_ENV_FILE, KEYCLOAK_COMPOSE_FILE).
#   host              - a host-native kcadm.sh (Mi8, no Docker). Set KEYCLOAK_KCADM_BIN.
#   container         - `docker exec` into KEYCLOAK_CONTAINER (integration tests).
# In every mode KEYCLOAK_KCADM_CONFIG must already be authenticated (kcadm.sh config credentials).
#
# Optional secrets (a *_FILE must be mode 600/400; the value never reaches argv):
#   KARIR_PORTAL_CLIENT_SECRET[_FILE]          karir-portal secret; Keycloak keeps its own when unset
#   KARIR_IDENTITY_ADMIN_CLIENT_SECRET[_FILE]  karir-identity-admin secret; same
#   KARIR_SMTP_HOST, KARIR_SMTP_PORT, KARIR_SMTP_FROM, KARIR_SMTP_FROM_DISPLAY_NAME,
#   KARIR_SMTP_STARTTLS, KARIR_SMTP_SSL, KARIR_SMTP_USER, KARIR_SMTP_PASSWORD[_FILE]
#                                              realm SMTP for email codes; untouched when KARIR_SMTP_HOST is unset
# KARIR_PUBLIC_BASE_URL overrides https://karir.sabilulquran.or.id for the portal redirect URIs (tests only).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYCLOAK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DESIRED_STATE="${KARIR_REALM_DESIRED_STATE:-${KEYCLOAK_DIR}/realm/sq-karir-desired-state.json}"
EXEC_MODE="${KEYCLOAK_EXEC_MODE:-compose}"
REALM="${KEYCLOAK_REALM:-sq-karir}"
KCADM_CONFIG="${KEYCLOAK_KCADM_CONFIG:-/tmp/sq-karir-realm.kcadm}"
PUBLIC_BASE_URL="${KARIR_PUBLIC_BASE_URL:-https://karir.sabilulquran.or.id}"

fail() {
  echo "KARIR_REALM_RECONCILE_FAIL: $1" >&2
  exit 1
}

[[ "${REALM}" == "sq-karir" ]] || fail "this script only manages the realm sq-karir"
command -v jq >/dev/null 2>&1 || fail "jq is required"
[[ -f "${DESIRED_STATE}" ]] || fail "desired-state file not found"
jq -e '.realm.realm == "sq-karir"' "${DESIRED_STATE}" >/dev/null || fail "desired state is not for sq-karir"
[[ "${PUBLIC_BASE_URL}" =~ ^https?://[A-Za-z0-9.:-]+$ ]] || fail "KARIR_PUBLIC_BASE_URL must be a bare origin"

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

PORTAL_SECRET="$(read_secret KARIR_PORTAL_CLIENT_SECRET)"
ADMIN_SECRET="$(read_secret KARIR_IDENTITY_ADMIN_CLIENT_SECRET)"
SMTP_PASSWORD="$(read_secret KARIR_SMTP_PASSWORD)"
unset KARIR_PORTAL_CLIENT_SECRET KARIR_IDENTITY_ADMIN_CLIENT_SECRET KARIR_SMTP_PASSWORD

# `docker exec -i` and `docker compose exec` read stdin. Only a call that sends a payload (-f -)
# may read it; every other call reads /dev/null, so it cannot swallow the input of a
# surrounding `while read` loop.
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

desired() { jq "$@" "${DESIRED_STATE}"; }
urlencode() { jq -rn --arg v "$1" '$v | @uri'; }

# ---------------------------------------------------------------------------------------------
# 1. Realm
# ---------------------------------------------------------------------------------------------
if ! kcadm get "realms/${REALM}" >/dev/null 2>&1; then
  printf '{"realm":"%s","enabled":true}' "${REALM}" | kcadm create realms -f - >/dev/null || fail "unable to create realm"
  echo "KARIR_REALM_CREATED realm=${REALM}"
fi

realm_json="$(kcadm get "realms/${REALM}")" || fail "unable to read realm"
jq -e --arg realm "${REALM}" '.realm == $realm' >/dev/null <<<"${realm_json}" || fail "Keycloak returned another realm"

# Security headers and realm attributes are merged, not replaced, so Keycloak's other values stay.
realm_update="$(jq --argjson desired "$(desired '.realm')" '
  . as $current
  | $current + ($desired | del(.browserSecurityHeaders, .attributes))
  | .browserSecurityHeaders = (($current.browserSecurityHeaders // {}) + $desired.browserSecurityHeaders)
  | .attributes = (($current.attributes // {}) + $desired.attributes)
' <<<"${realm_json}")"

if [[ -n "${KARIR_SMTP_HOST:-}" ]]; then
  [[ -n "${KARIR_SMTP_FROM:-}" ]] || fail "KARIR_SMTP_FROM is required with KARIR_SMTP_HOST"
  realm_update="$(SMTP_PASSWORD="${SMTP_PASSWORD}" jq \
    --arg host "${KARIR_SMTP_HOST}" \
    --arg port "${KARIR_SMTP_PORT:-587}" \
    --arg from "${KARIR_SMTP_FROM}" \
    --arg fromDisplayName "${KARIR_SMTP_FROM_DISPLAY_NAME:-Karir SQ}" \
    --arg starttls "${KARIR_SMTP_STARTTLS:-true}" \
    --arg ssl "${KARIR_SMTP_SSL:-false}" \
    --arg user "${KARIR_SMTP_USER:-}" '
    .smtpServer = ({host: $host, port: $port, from: $from, fromDisplayName: $fromDisplayName,
                    starttls: $starttls, ssl: $ssl, auth: (if $user == "" then "false" else "true" end)}
                   + (if $user == "" then {} else {user: $user, password: env.SMTP_PASSWORD} end))
  ' <<<"${realm_update}")"
fi
printf '%s' "${realm_update}" | kcadm update "realms/${REALM}" -n -f - >/dev/null \
  || fail "unable to update realm settings (is the sq-karir-identity provider installed?)"
unset realm_update
echo "KARIR_REALM_SETTINGS_PASS"

# ---------------------------------------------------------------------------------------------
# 2. Declarative user profile
# ---------------------------------------------------------------------------------------------
desired '.userProfile' | kcadm update users/profile -r "${REALM}" -n -f - >/dev/null || fail "unable to update the user profile"
kcadm get users/profile -r "${REALM}" | jq -e '
  ([.attributes[].name] | sort) == (["email","firstName","karir_source","nik_hmac","username","wa_number","wa_verified"] | sort)
  and ([.attributes[] | select(.name | IN("nik_hmac","wa_number","wa_verified","karir_source")) | .permissions.view] | all(. == ["admin"]))
' >/dev/null || fail "user profile did not converge"
echo "KARIR_USER_PROFILE_PASS"

# ---------------------------------------------------------------------------------------------
# 3. Required actions
# ---------------------------------------------------------------------------------------------
required_actions="$(kcadm get authentication/required-actions -r "${REALM}")"
if ! jq -e '.[] | select(.alias == "karir-verify-whatsapp")' >/dev/null <<<"${required_actions}"; then
  kcadm create authentication/register-required-action -r "${REALM}" \
    -s providerId=karir-verify-whatsapp -s "name=Verifikasi WhatsApp" >/dev/null \
    || fail "unable to register karir-verify-whatsapp (is the provider installed?)"
  required_actions="$(kcadm get authentication/required-actions -r "${REALM}")"
fi
set_required_action() {
  local alias="$1" enabled="$2" current
  current="$(jq -c --arg alias "${alias}" '.[] | select(.alias == $alias)' <<<"${required_actions}")"
  [[ -n "${current}" ]] || return 0
  jq --argjson enabled "${enabled}" '.enabled = $enabled | .defaultAction = false' <<<"${current}" \
    | kcadm update "authentication/required-actions/$(urlencode "${alias}")" -r "${REALM}" -n -f - >/dev/null \
    || fail "unable to update required action ${alias}"
}
while read -r alias; do set_required_action "${alias}" true; done < <(desired -r '.requiredActions.enabled[]')
while read -r alias; do set_required_action "${alias}" false; done < <(desired -r '.requiredActions.disabled[]')
kcadm get authentication/required-actions -r "${REALM}" | jq -e '
  ([.[] | select(.alias == "karir-verify-whatsapp" and .enabled == true)] | length) == 1
  and ([.[] | select(.alias == "UPDATE_PASSWORD" and .enabled == true)] | length) == 1
  and ([.[] | select(.defaultAction == true)] | length) == 0
' >/dev/null || fail "required actions did not converge"
echo "KARIR_REQUIRED_ACTIONS_PASS"

# ---------------------------------------------------------------------------------------------
# 4. Flows. A missing flow is built; an existing flow must have exactly the desired shape,
#    otherwise the run stops for an operator to inspect it. Requirements are always re-applied.
# ---------------------------------------------------------------------------------------------
flow_shape() {
  # Flattened (level, provider or subflow alias) list, the same for desired and live flows.
  jq -c '[.[] | {level, key: (if .authenticationFlow == true then "flow:" + .displayName else .providerId end)}]'
}

desired_shape() {
  jq -c '[.executions[] | (
      if has("subflow") then
        ({level: 0, key: ("flow:" + .subflow)}, (.executions[] | {level: 1, key: .provider}))
      else {level: 0, key: .provider} end)]'
}

set_requirement() {
  local flow="$1" key="$2" requirement="$3" executions execution
  executions="$(kcadm get "authentication/flows/$(urlencode "${flow}")/executions" -r "${REALM}")"
  execution="$(jq -c --arg key "${key}" '
    [.[] | select((if .authenticationFlow == true then "flow:" + .displayName else .providerId end) == $key)]
    | if length == 1 then .[0] else error("ambiguous") end' <<<"${executions}")" \
    || fail "execution ${key} is missing or ambiguous in ${flow}"
  if [[ "$(jq -r '.requirement' <<<"${execution}")" != "${requirement}" ]]; then
    jq --arg requirement "${requirement}" '.requirement = $requirement' <<<"${execution}" \
      | kcadm update "authentication/flows/$(urlencode "${flow}")/executions" -r "${REALM}" -n -f - >/dev/null \
      || fail "unable to set ${key} to ${requirement} in ${flow}"
  fi
}

reconcile_flow() {
  local name="$1" spec alias flows count live
  spec="$(desired -c --arg name "${name}" '.flows[$name]')"
  alias="$(jq -r '.alias' <<<"${spec}")"
  flows="$(kcadm get authentication/flows -r "${REALM}")"
  count="$(jq --arg alias "${alias}" '[.[] | select(.alias == $alias)] | length' <<<"${flows}")"
  if [[ "${count}" == "0" ]]; then
    kcadm create authentication/flows -r "${REALM}" -s "alias=${alias}" -s providerId=basic-flow \
      -s topLevel=true -s builtIn=false -s "description=Karir SQ (REC-IMPL-001)" >/dev/null || fail "unable to create flow ${alias}"
    while read -r execution; do
      if jq -e 'has("subflow")' >/dev/null <<<"${execution}"; then
        local subflow type form_provider
        subflow="$(jq -r '.subflow' <<<"${execution}")"
        type="$(jq -r '.type' <<<"${execution}")"
        form_provider="$(jq -r '.formProvider // empty' <<<"${execution}")"
        if [[ -n "${form_provider}" ]]; then
          kcadm create "authentication/flows/$(urlencode "${alias}")/executions/flow" -r "${REALM}" \
            -s "alias=${subflow}" -s "type=${type}" -s "provider=${form_provider}" >/dev/null || fail "unable to add ${subflow}"
        else
          kcadm create "authentication/flows/$(urlencode "${alias}")/executions/flow" -r "${REALM}" \
            -s "alias=${subflow}" -s "type=${type}" >/dev/null || fail "unable to add ${subflow}"
        fi
        while read -r provider; do
          kcadm create "authentication/flows/$(urlencode "${subflow}")/executions/execution" -r "${REALM}" \
            -s "provider=${provider}" >/dev/null || fail "unable to add ${provider} to ${subflow} (is the provider installed?)"
        done < <(jq -r '.executions[].provider' <<<"${execution}")
      else
        kcadm create "authentication/flows/$(urlencode "${alias}")/executions/execution" -r "${REALM}" \
          -s "provider=$(jq -r '.provider' <<<"${execution}")" >/dev/null || fail "unable to add an execution to ${alias} (is the provider installed?)"
      fi
    done < <(jq -c '.executions[]' <<<"${spec}")
    echo "KARIR_FLOW_CREATED flow=${alias}"
  elif [[ "${count}" != "1" ]]; then
    fail "flow ${alias} is ambiguous"
  fi

  live="$(kcadm get "authentication/flows/$(urlencode "${alias}")/executions" -r "${REALM}" | flow_shape)"
  [[ "${live}" == "$(desired_shape <<<"${spec}")" ]] \
    || fail "flow ${alias} exists with a different shape; inspect it before re-running"

  while read -r execution; do
    if jq -e 'has("subflow")' >/dev/null <<<"${execution}"; then
      set_requirement "${alias}" "flow:$(jq -r '.subflow' <<<"${execution}")" "$(jq -r '.requirement' <<<"${execution}")"
      while read -r inner; do
        set_requirement "${alias}" "$(jq -r '.provider' <<<"${inner}")" "$(jq -r '.requirement' <<<"${inner}")"
      done < <(jq -c '.executions[]' <<<"${execution}")
    else
      set_requirement "${alias}" "$(jq -r '.provider' <<<"${execution}")" "$(jq -r '.requirement' <<<"${execution}")"
    fi
  done < <(jq -c '.executions[]' <<<"${spec}")
}

reconcile_flow browser
reconcile_flow registration
reconcile_flow resetCredentials

realm_json="$(kcadm get "realms/${REALM}")"
jq --arg browser "$(desired -r '.flows.browser.alias')" \
   --arg registration "$(desired -r '.flows.registration.alias')" \
   --arg reset "$(desired -r '.flows.resetCredentials.alias')" \
   '.browserFlow = $browser | .registrationFlow = $registration | .resetCredentialsFlow = $reset' <<<"${realm_json}" \
  | kcadm update "realms/${REALM}" -n -f - >/dev/null || fail "unable to bind flows"
echo "KARIR_FLOWS_PASS"

# ---------------------------------------------------------------------------------------------
# 5. Clients
# ---------------------------------------------------------------------------------------------
scope_id() {
  jq -er --arg name "$1" '[.[] | select(.name == $name)] | if length == 1 then .[0].id else error("missing") end' <<<"${client_scopes}" \
    || fail "client scope $1 not found"
}

reconcile_client_scopes() {
  local client_uuid="$1" kind="$2" wanted current wanted_ids
  wanted="$3"
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
  local client_id="$1" secret="$2" spec payload existing count client_uuid
  spec="$(desired -c --arg id "${client_id}" --arg base "${PUBLIC_BASE_URL}" '.clients[$id]
    | .redirectUris |= map(sub("^https://karir\\.sabilulquran\\.or\\.id"; $base))
    | if .attributes["post.logout.redirect.uris"] then
        .attributes["post.logout.redirect.uris"] |= sub("^https://karir\\.sabilulquran\\.or\\.id"; $base) else . end')"
  payload="$(CLIENT_SECRET="${secret}" jq -c 'del(.defaultClientScopes, .optionalClientScopes)
    | if env.CLIENT_SECRET != "" then .secret = env.CLIENT_SECRET else . end' <<<"${spec}")"
  existing="$(kcadm get clients -r "${REALM}" -q "clientId=${client_id}")"
  count="$(jq '[.[] | select(.clientId == "'"${client_id}"'")] | length' <<<"${existing}")"
  case "${count}" in
    0) printf '%s' "${payload}" | kcadm create clients -r "${REALM}" -f - >/dev/null || fail "unable to create ${client_id}" ;;
    1) client_uuid="$(jq -er '[.[] | select(.clientId == "'"${client_id}"'")][0].id' <<<"${existing}")"
       printf '%s' "${payload}" | kcadm update "clients/${client_uuid}" -r "${REALM}" -f - >/dev/null || fail "unable to update ${client_id}" ;;
    *) fail "client ${client_id} is ambiguous" ;;
  esac
  unset payload
  client_uuid="$(kcadm get clients -r "${REALM}" -q "clientId=${client_id}" | jq -er '[.[] | select(.clientId == "'"${client_id}"'")][0].id')"

  # No client-level mappers: the portal token carries no username, email, phone or NIK claims.
  while read -r mapper_id; do
    [[ -n "${mapper_id}" ]] || continue
    kcadm delete "clients/${client_uuid}/protocol-mappers/models/${mapper_id}" -r "${REALM}" >/dev/null || fail "unable to remove a mapper from ${client_id}"
  done < <(kcadm get "clients/${client_uuid}/protocol-mappers/models" -r "${REALM}" | jq -r '.[].id')

  reconcile_client_scopes "${client_uuid}" default "$(jq -c '.defaultClientScopes' <<<"${spec}")"
  reconcile_client_scopes "${client_uuid}" optional "$(jq -c '.optionalClientScopes' <<<"${spec}")"

  kcadm get "clients/${client_uuid}" -r "${REALM}" | jq -e --argjson spec "${spec}" '
    . as $live
    | ($spec | del(.defaultClientScopes, .optionalClientScopes, .attributes, .name) | to_entries | all(.value == $live[.key]))
    and ($spec.attributes | to_entries | all(.value == $live.attributes[.key]))
    and (($live.protocolMappers // []) | length) == 0
  ' >/dev/null || fail "client ${client_id} did not converge"
  echo "KARIR_CLIENT_PASS client=${client_id}"
}

client_scopes="$(kcadm get client-scopes -r "${REALM}")"
reconcile_client karir-portal "${PORTAL_SECRET}"
reconcile_client karir-identity-admin "${ADMIN_SECRET}"
unset PORTAL_SECRET ADMIN_SECRET

# ---------------------------------------------------------------------------------------------
# 6. karir-identity-admin: fine-grained admin permissions (v2), users view + manage only.
#    No realm-management roles, so no realm-admin, role mapping or impersonation.
#    Keycloak 26.7.2 limitation: FGAP v2 "manage" also allows reset-password, and a deny on
#    reset-password cannot be added (any evaluated deny blocks the whole Users resource under the
#    fixed UNANIMOUS strategy). Admin events are on, so every such call is recorded.
# ---------------------------------------------------------------------------------------------
admin_uuid="$(kcadm get clients -r "${REALM}" -q clientId=karir-identity-admin | jq -er '.[0].id')"
service_user_id="$(kcadm get "clients/${admin_uuid}/service-account-user" -r "${REALM}" | jq -er '.id')"
realm_management_uuid="$(kcadm get clients -r "${REALM}" -q clientId=realm-management \
  | jq -er 'if length == 1 then .[0].id else error("ambiguous") end')"
kcadm get "users/${service_user_id}/role-mappings/clients/${realm_management_uuid}" -r "${REALM}" | jq -e 'length == 0' >/dev/null \
  || fail "karir-identity-admin service account has realm-management roles; remove them before re-running"

permissions_uuid="$(kcadm get clients -r "${REALM}" -q clientId=admin-permissions \
  | jq -er 'if length == 1 then .[0].id else error("missing") end')" \
  || fail "admin-permissions client is missing; is adminPermissionsEnabled on?"
authz="clients/${permissions_uuid}/authz/resource-server"

# upsert_authz <policy|permission> <type> <payload>; prints the object id.
upsert_authz() {
  local kind="$1" type="$2" payload="$3" name existing id
  name="$(jq -r '.name' <<<"${payload}")"
  existing="$(kcadm get "${authz}/${kind}" -r "${REALM}" -q "name=${name}" -q exact=true)"
  case "$(jq --arg name "${name}" '[.[] | select(.name == $name)] | length' <<<"${existing}")" in
    0) printf '%s' "${payload}" | kcadm create "${authz}/${kind}/${type}" -r "${REALM}" -f - >/dev/null \
         || fail "unable to create ${kind} ${name}" ;;
    1) id="$(jq -er --arg name "${name}" '.[] | select(.name == $name) | .id' <<<"${existing}")"
       jq -c --arg id "${id}" '.id = $id' <<<"${payload}" \
         | kcadm update "${authz}/${kind}/${type}/${id}" -r "${REALM}" -n -f - >/dev/null \
         || fail "unable to update ${kind} ${name}" ;;
    *) fail "${kind} ${name} is ambiguous" ;;
  esac
  kcadm get "${authz}/${kind}" -r "${REALM}" -q "name=${name}" -q exact=true \
    | jq -er --arg name "${name}" '.[] | select(.name == $name) | .id'
}

policy_id="$(upsert_authz policy user "$(jq -nc --arg name "$(desired -r '.adminPermissions.policy')" --arg user "${service_user_id}" \
  '{name: $name, description: "Service account of karir-identity-admin", type: "user", logic: "POSITIVE", users: [$user]}')")"
permission_id="$(upsert_authz permission scope "$(desired -c --arg policy "${policy_id}" '.adminPermissions
  | {name: .permission, description: "Karir SQ may find, read, create and update candidate accounts", type: "scope",
     resourceType: .resourceType, resources: [], scopes: .scopes, policies: [$policy], decisionStrategy: "UNANIMOUS", logic: "POSITIVE"}')")"
kcadm get "${authz}/permission/${permission_id}/scopes" -r "${REALM}" \
  | jq -e --argjson wanted "$(desired -c '.adminPermissions.scopes | sort')" '[.[].name] | sort == $wanted' >/dev/null \
  || fail "admin permission scopes did not converge"
echo "KARIR_ADMIN_PERMISSIONS_PASS"

# ---------------------------------------------------------------------------------------------
# 7. Final verification
# ---------------------------------------------------------------------------------------------
kcadm get "realms/${REALM}" | jq -e --argjson desired "$(desired '.realm')" --slurpfile all "${DESIRED_STATE}" '
  def same(a; b): if (a | type) == "array" then (a | sort) == ((b // []) | sort) else a == b end;
  . as $live
  | ($desired | del(.browserSecurityHeaders, .attributes) | to_entries | all(same(.value; $live[.key])))
  and ($desired.attributes | to_entries | all(.value == $live.attributes[.key]))
  and $live.browserSecurityHeaders.contentSecurityPolicy == $desired.browserSecurityHeaders.contentSecurityPolicy
  and $live.browserFlow == $all[0].flows.browser.alias
  and $live.registrationFlow == $all[0].flows.registration.alias
  and $live.resetCredentialsFlow == $all[0].flows.resetCredentials.alias
' >/dev/null || fail "realm did not converge"
echo "KARIR_REALM_RECONCILE_IDEMPOTENT_PASS realm=${REALM}"
