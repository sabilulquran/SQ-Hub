#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYCLOAK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${KEYCLOAK_ENV_FILE:-${KEYCLOAK_DIR}/.env.staging}"
COMPOSE_FILE="${KEYCLOAK_COMPOSE_FILE:-${KEYCLOAK_DIR}/docker-compose.staging.yml}"
REALM="${KEYCLOAK_REALM:?set KEYCLOAK_REALM to sq-staff or sq-staff-staging}"
KCADM_CONFIG="${KEYCLOAK_KCADM_CONFIG:-/tmp/sq-hub-trusted-device.kcadm}"
TRUSTED_PROVIDER="sq-trusted-device-otp"
COPIED_BROWSER_FLOW="akun-sq-browser-trusted-device"

fail() {
  echo "Trusted-device reconciliation failed: $1" >&2
  exit 1
}

case "${REALM}" in
  sq-staff|sq-staff-staging) ;;
  *) fail "target realm must be exactly sq-staff or sq-staff-staging" ;;
esac

[[ -f "${ENV_FILE}" ]] || fail "environment file not found: ${ENV_FILE}"
command -v docker >/dev/null 2>&1 || fail "docker is required"
command -v jq >/dev/null 2>&1 || fail "jq is required"

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

[[ -n "${SQ_TRUSTED_DEVICE_SIGNING_KEY:-}" ]] \
  || fail "SQ_TRUSTED_DEVICE_SIGNING_KEY is required before activating the provider"

compose_exec() {
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T keycloak "$@"
}

kcadm() {
  compose_exec /opt/keycloak/bin/kcadm.sh "$@" --config "${KCADM_CONFIG}"
}

compose_exec test -f "${KCADM_CONFIG}" >/dev/null 2>&1 \
  || fail "pre-authenticated kcadm config is not available inside the Keycloak container"

realm_json="$(kcadm get "realms/${REALM}")" || fail "unable to read target realm"
jq -e --arg realm "${REALM}" '.realm == $realm' >/dev/null <<<"${realm_json}" \
  || fail "authenticated endpoint did not return the expected realm"

browser_flow="$(jq -er '.browserFlow | select(type == "string" and length > 0)' <<<"${realm_json}")"
browser_model="$(kcadm get authentication/flows -r "${REALM}" \
  | jq -er --arg alias "${browser_flow}" '.[] | select(.alias == $alias)')"

if jq -e '.builtIn == true' >/dev/null <<<"${browser_model}"; then
  copied_count="$(kcadm get authentication/flows -r "${REALM}" \
    | jq --arg alias "${COPIED_BROWSER_FLOW}" '[.[] | select(.alias == $alias)] | length')"
  [[ "${copied_count}" == "0" || "${copied_count}" == "1" ]] \
    || fail "ambiguous copied Browser flow"
  if [[ "${copied_count}" == "0" ]]; then
    kcadm create "authentication/flows/${browser_flow}/copy" -r "${REALM}" \
      -s "newName=${COPIED_BROWSER_FLOW}" >/dev/null
  fi
  realm_update="$(jq --arg flow "${COPIED_BROWSER_FLOW}" '.browserFlow = $flow' <<<"${realm_json}")"
  printf '%s' "${realm_update}" | kcadm update "realms/${REALM}" -n -f - >/dev/null
  browser_flow="${COPIED_BROWSER_FLOW}"
fi

replace_otp_in_flow() {
  local top_flow="$1"
  local expected_requirement="$2"
  local executions otp_count otp_id otp_detail parent_id parent_alias parent_path otp_position otp_level parent_executions trusted_count trusted_update otp_update

  executions="$(kcadm get "authentication/flows/${top_flow}/executions" -r "${REALM}")"
  otp_count="$(jq '[.[] | select(.providerId == "auth-otp-form")] | length' <<<"${executions}")"
  [[ "${otp_count}" == "1" ]] || fail "expected exactly one built-in OTP execution under ${top_flow}"
  otp_id="$(jq -er '.[] | select(.providerId == "auth-otp-form") | .id' <<<"${executions}")"
  otp_detail="$(kcadm get "authentication/executions/${otp_id}" -r "${REALM}")"
  parent_id="$(jq -r '.parentFlow // empty' <<<"${otp_detail}")"
  if [[ -n "${parent_id}" ]]; then
    parent_alias="$(kcadm get authentication/flows -r "${REALM}" \
      | jq -er --arg id "${parent_id}" '.[] | select(.id == $id) | .alias')"
  else
    otp_position="$(jq -er 'to_entries[] | select(.value.providerId == "auth-otp-form") | .key' <<<"${executions}")"
    otp_level="$(jq -er '.[] | select(.providerId == "auth-otp-form") | .level' <<<"${executions}")"
    if [[ "${otp_level}" == "0" ]]; then
      parent_alias="${top_flow}"
    else
      parent_id="$(jq -er --argjson position "${otp_position}" --argjson level "${otp_level}" '
        [to_entries[] |
          select(.key < $position and .value.authenticationFlow == true and .value.level == ($level - 1))] |
        last.value.flowId
      ' <<<"${executions}")"
      parent_alias="$(kcadm get authentication/flows -r "${REALM}" \
        | jq -er --arg id "${parent_id}" '.[] | select(.id == $id) | .alias')"
    fi
  fi
  parent_path="${parent_alias// /%20}"

  parent_executions="$(kcadm get "authentication/flows/${parent_path}/executions" -r "${REALM}")"
  trusted_count="$(jq --arg provider "${TRUSTED_PROVIDER}" '[.[] | select(.providerId == $provider)] | length' <<<"${parent_executions}")"
  [[ "${trusted_count}" == "0" || "${trusted_count}" == "1" ]] \
    || fail "ambiguous trusted-device execution under ${parent_alias}"

  if [[ "${trusted_count}" == "0" ]]; then
    kcadm create "authentication/flows/${parent_path}/executions/execution" -r "${REALM}" \
      -s "provider=${TRUSTED_PROVIDER}" >/dev/null
    parent_executions="$(kcadm get "authentication/flows/${parent_path}/executions" -r "${REALM}")"
  fi

  trusted_update="$(jq --arg provider "${TRUSTED_PROVIDER}" --arg requirement "${expected_requirement}" \
    '.[] | select(.providerId == $provider) | .requirement = $requirement' <<<"${parent_executions}")"
  printf '%s' "${trusted_update}" | kcadm update "authentication/flows/${parent_path}/executions" \
    -r "${REALM}" -n -f - >/dev/null

  parent_executions="$(kcadm get "authentication/flows/${parent_path}/executions" -r "${REALM}")"
  otp_update="$(jq '.[] | select(.providerId == "auth-otp-form") | .requirement = "DISABLED"' <<<"${parent_executions}")"
  printf '%s' "${otp_update}" | kcadm update "authentication/flows/${parent_path}/executions" \
    -r "${REALM}" -n -f - >/dev/null

  parent_executions="$(kcadm get "authentication/flows/${parent_path}/executions" -r "${REALM}")"
  jq -e --arg provider "${TRUSTED_PROVIDER}" --arg requirement "${expected_requirement}" '
    ([.[] | select(.providerId == $provider and .requirement == $requirement)] | length) == 1 and
    ([.[] | select(.providerId == "auth-otp-form" and .requirement == "DISABLED")] | length) == 1
  ' >/dev/null <<<"${parent_executions}" || fail "OTP replacement did not converge under ${parent_alias}"
}

replace_otp_in_flow "${browser_flow}" ALTERNATIVE
echo "TRUSTED_DEVICE_BROWSER_FLOW_PASS"

google_post_flow="${KEYCLOAK_GOOGLE_POST_FLOW_ALIAS:-}"
if [[ -z "${google_post_flow}" ]] && kcadm get identity-provider/instances/google -r "${REALM}" >/dev/null 2>&1; then
  google_json="$(kcadm get identity-provider/instances/google -r "${REALM}")"
  google_post_flow="$(jq -r '.postBrokerLoginFlowAlias // empty' <<<"${google_json}")"
fi

if [[ -n "${google_post_flow}" ]]; then
  replace_otp_in_flow "${google_post_flow}" REQUIRED
  echo "TRUSTED_DEVICE_GOOGLE_POST_FLOW_PASS"
else
  echo "TRUSTED_DEVICE_GOOGLE_POST_FLOW_NOT_CONFIGURED"
fi

realm_verify="$(kcadm get "realms/${REALM}")"
jq -e --arg flow "${browser_flow}" '.browserFlow == $flow' >/dev/null <<<"${realm_verify}" \
  || fail "trusted-device Browser flow is not bound"
echo "TRUSTED_DEVICE_RECONCILE_IDEMPOTENT_PASS"
