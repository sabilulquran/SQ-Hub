#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYCLOAK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${KEYCLOAK_ENV_FILE:-${KEYCLOAK_DIR}/.env.staging}"
COMPOSE_FILE="${KEYCLOAK_DIR}/docker-compose.staging.yml"
REALM="${KEYCLOAK_REALM:-sq-staff-staging}"
KCADM_CONFIG="${KEYCLOAK_KCADM_CONFIG:-/tmp/sq-hub-recovery-codes.kcadm}"
REQUIRED_ACTION="CONFIGURE_RECOVERY_AUTHN_CODES"
RECOVERY_PROVIDER="auth-recovery-authn-code-form"
OTP_PROVIDER="auth-otp-form"

fail() {
  echo "Recovery-code reconciliation failed: $1" >&2
  exit 1
}

if [[ "${REALM}" != "sq-staff-staging" ]]; then
  fail "target realm must be exactly sq-staff-staging"
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  fail "environment file not found: ${ENV_FILE}"
fi

command -v docker >/dev/null 2>&1 || fail "docker is required"
command -v jq >/dev/null 2>&1 || fail "jq is required"

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

compose_exec() {
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T keycloak "$@"
}

kcadm() {
  compose_exec /opt/keycloak/bin/kcadm.sh "$@" --config "${KCADM_CONFIG}"
}

compose_exec test -f "${KCADM_CONFIG}" >/dev/null 2>&1 \
  || fail "pre-authenticated kcadm config is not available inside the Keycloak container"

realm_json="$(kcadm get "realms/${REALM}")" \
  || fail "unable to read the target realm"

if ! jq -e --arg realm "${REALM}" '.realm == $realm' >/dev/null <<<"${realm_json}"; then
  fail "authenticated Keycloak endpoint did not return the expected staging realm"
fi

browser_flow="$(jq -er '.browserFlow | select(type == "string" and length > 0)' <<<"${realm_json}")" \
  || fail "target realm has no unambiguous Browser flow binding"

required_action_json="$(kcadm get "authentication/required-actions/${REQUIRED_ACTION}" -r "${REALM}")" \
  || fail "required action ${REQUIRED_ACTION} is missing"

if ! jq -e --arg alias "${REQUIRED_ACTION}" \
  '.alias == $alias and .providerId == $alias' >/dev/null <<<"${required_action_json}"; then
  fail "required action ${REQUIRED_ACTION} is ambiguous or has an unexpected provider"
fi

executions_json="$(kcadm get "authentication/flows/${browser_flow}/executions" -r "${REALM}")" \
  || fail "unable to read executions for the bound Browser flow"

recovery_count="$(jq --arg provider "${RECOVERY_PROVIDER}" \
  '[.[] | select(.providerId == $provider)] | length' <<<"${executions_json}")"
otp_count="$(jq --arg provider "${OTP_PROVIDER}" \
  '[.[] | select(.providerId == $provider)] | length' <<<"${executions_json}")"

[[ "${recovery_count}" == "1" ]] \
  || fail "expected exactly one recovery-code execution in the bound Browser flow"
[[ "${otp_count}" == "1" ]] \
  || fail "expected exactly one OTP execution in the bound Browser flow"

otp_requirement="$(jq -r --arg provider "${OTP_PROVIDER}" \
  '.[] | select(.providerId == $provider) | .requirement' <<<"${executions_json}")"
[[ "${otp_requirement}" == "ALTERNATIVE" ]] \
  || fail "OTP execution must already be ALTERNATIVE; no changes were applied"

changes=0

if ! jq -e '.enabled == true and .defaultAction == false' >/dev/null <<<"${required_action_json}"; then
  required_action_update="$(jq '.enabled = true | .defaultAction = false' <<<"${required_action_json}")"
  printf '%s' "${required_action_update}" \
    | kcadm update "authentication/required-actions/${REQUIRED_ACTION}" \
      -r "${REALM}" -n -f - >/dev/null
  changes=$((changes + 1))
fi

recovery_requirement="$(jq -r --arg provider "${RECOVERY_PROVIDER}" \
  '.[] | select(.providerId == $provider) | .requirement' <<<"${executions_json}")"

if [[ "${recovery_requirement}" != "ALTERNATIVE" ]]; then
  recovery_update="$(jq --arg provider "${RECOVERY_PROVIDER}" \
    '.[] | select(.providerId == $provider) | .requirement = "ALTERNATIVE"' \
    <<<"${executions_json}")"
  printf '%s' "${recovery_update}" \
    | kcadm update "authentication/flows/${browser_flow}/executions" \
      -r "${REALM}" -n -f - >/dev/null
  changes=$((changes + 1))
fi

required_action_verify="$(kcadm get "authentication/required-actions/${REQUIRED_ACTION}" -r "${REALM}")" \
  || fail "unable to verify the recovery required action"
executions_verify="$(kcadm get "authentication/flows/${browser_flow}/executions" -r "${REALM}")" \
  || fail "unable to verify the bound Browser flow"

if ! jq -e --arg alias "${REQUIRED_ACTION}" \
  '.alias == $alias and .providerId == $alias and .enabled == true and .defaultAction == false' \
  >/dev/null <<<"${required_action_verify}"; then
  fail "recovery required action did not converge to the accepted state"
fi

if [[ "$(jq --arg provider "${RECOVERY_PROVIDER}" \
  '[.[] | select(.providerId == $provider and .requirement == "ALTERNATIVE")] | length' \
  <<<"${executions_verify}")" != "1" ]]; then
  fail "recovery-code Browser execution did not converge to ALTERNATIVE"
fi

if [[ "$(jq --arg provider "${OTP_PROVIDER}" \
  '[.[] | select(.providerId == $provider and .requirement == "ALTERNATIVE")] | length' \
  <<<"${executions_verify}")" != "1" ]]; then
  fail "OTP Browser execution is no longer ALTERNATIVE"
fi

echo "RECOVERY_REQUIRED_ACTION_ENABLED_PASS"
echo "RECOVERY_BROWSER_FLOW_ALTERNATIVE_PASS"
echo "OTP_BROWSER_FLOW_ALTERNATIVE_PASS"
if [[ "${changes}" == "0" ]]; then
  echo "RECOVERY_RECONCILE_IDEMPOTENT_PASS"
fi
