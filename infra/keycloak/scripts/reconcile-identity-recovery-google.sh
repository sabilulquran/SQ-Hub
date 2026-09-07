#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYCLOAK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${KEYCLOAK_ENV_FILE:-${KEYCLOAK_DIR}/.env.staging}"
COMPOSE_FILE="${KEYCLOAK_COMPOSE_FILE:-${KEYCLOAK_DIR}/docker-compose.staging.yml}"
REALM="${KEYCLOAK_REALM:?set KEYCLOAK_REALM to sq-staff or sq-staff-staging}"
KCADM_CONFIG="${KEYCLOAK_KCADM_CONFIG:-/tmp/sq-hub-identity-ux.kcadm}"
FIRST_FLOW="akun-sq-google-existing-account-link"
POST_FLOW="akun-sq-google-conditional-mfa"
POST_SUBFLOW="akun-sq-google-user-configured-totp"

fail() {
  echo "Identity UX reconciliation failed: $1" >&2
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

GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:?set GOOGLE_CLIENT_ID in controlled runtime configuration}"
GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET:?set GOOGLE_CLIENT_SECRET in controlled runtime configuration}"

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

realm_update="$(jq '
  .resetPasswordAllowed = true |
  .loginWithEmailAllowed = true |
  .duplicateEmailsAllowed = false
' <<<"${realm_json}")"
printf '%s' "${realm_update}" | kcadm update "realms/${REALM}" -n -f - >/dev/null

flow_exists() {
  kcadm get "authentication/flows/$1" -r "${REALM}" >/dev/null 2>&1
}

create_top_flow() {
  local alias="$1"
  local description="$2"
  flow_exists "${alias}" && return
  kcadm create authentication/flows -r "${REALM}" \
    -s "alias=${alias}" -s providerId=basic-flow -s topLevel=true -s builtIn=false \
    -s "description=${description}" >/dev/null
}

add_execution_if_missing() {
  local flow="$1"
  local provider="$2"
  local requirement="$3"
  local executions count update
  executions="$(kcadm get "authentication/flows/${flow}/executions" -r "${REALM}")"
  count="$(jq --arg provider "${provider}" '[.[] | select(.providerId == $provider)] | length' <<<"${executions}")"
  [[ "${count}" == "0" || "${count}" == "1" ]] || fail "ambiguous ${provider} execution in ${flow}"
  if [[ "${count}" == "0" ]]; then
    kcadm create "authentication/flows/${flow}/executions/execution" -r "${REALM}" \
      -s "provider=${provider}" >/dev/null
    executions="$(kcadm get "authentication/flows/${flow}/executions" -r "${REALM}")"
  fi
  update="$(jq --arg provider "${provider}" --arg requirement "${requirement}" \
    '.[] | select(.providerId == $provider) | .requirement = $requirement' <<<"${executions}")"
  printf '%s' "${update}" | kcadm update "authentication/flows/${flow}/executions" \
    -r "${REALM}" -n -f - >/dev/null
}

create_top_flow "${FIRST_FLOW}" "Link a verified Google identity only after existing Akun SQ ownership is proven"
add_execution_if_missing "${FIRST_FLOW}" idp-detect-existing-broker-user REQUIRED
add_execution_if_missing "${FIRST_FLOW}" idp-confirm-link REQUIRED
add_execution_if_missing "${FIRST_FLOW}" idp-username-password-form REQUIRED

first_executions="$(kcadm get "authentication/flows/${FIRST_FLOW}/executions" -r "${REALM}")"
jq -e '
  length == 3 and
  ([.[] | select(.providerId == "idp-detect-existing-broker-user" and .requirement == "REQUIRED")] | length) == 1 and
  ([.[] | select(.providerId == "idp-confirm-link" and .requirement == "REQUIRED")] | length) == 1 and
  ([.[] | select(.providerId == "idp-username-password-form" and .requirement == "REQUIRED")] | length) == 1 and
  ([.[] | select(.providerId == "idp-create-user-if-unique" or .providerId == "idp-auto-link")] | length) == 0
' >/dev/null <<<"${first_executions}" || fail "first broker flow is not fail-closed"

create_top_flow "${POST_FLOW}" "Apply the existing user-configured TOTP policy after Google authentication"

post_executions="$(kcadm get "authentication/flows/${POST_FLOW}/executions" -r "${REALM}")"
subflow_count="$(jq --arg alias "${POST_SUBFLOW}" '[.[] | select(.displayName == $alias and .authenticationFlow == true)] | length' <<<"${post_executions}")"
[[ "${subflow_count}" == "0" || "${subflow_count}" == "1" ]] || fail "ambiguous Google MFA subflow"
if [[ "${subflow_count}" == "0" ]]; then
  kcadm create "authentication/flows/${POST_FLOW}/executions/flow" -r "${REALM}" \
    -s "alias=${POST_SUBFLOW}" -s type=basic-flow -s provider=registration-page-form \
    -s "description=Require TOTP only when the existing Akun SQ user has configured it" >/dev/null
  post_executions="$(kcadm get "authentication/flows/${POST_FLOW}/executions" -r "${REALM}")"
fi

subflow_update="$(jq --arg alias "${POST_SUBFLOW}" \
  '.[] | select(.displayName == $alias and .authenticationFlow == true) | .requirement = "CONDITIONAL"' \
  <<<"${post_executions}")"
printf '%s' "${subflow_update}" | kcadm update "authentication/flows/${POST_FLOW}/executions" \
  -r "${REALM}" -n -f - >/dev/null

add_execution_if_missing "${POST_SUBFLOW}" conditional-user-configured REQUIRED
add_execution_if_missing "${POST_SUBFLOW}" auth-otp-form REQUIRED

google_json="$(jq -n \
  --arg client_id "${GOOGLE_CLIENT_ID}" \
  --arg client_secret "${GOOGLE_CLIENT_SECRET}" \
  --arg first_flow "${FIRST_FLOW}" \
  --arg post_flow "${POST_FLOW}" '
  {
    alias: "google",
    displayName: "Masuk dengan Google",
    providerId: "google",
    enabled: true,
    trustEmail: true,
    storeToken: false,
    addReadTokenRoleOnCreate: false,
    authenticateByDefault: false,
    linkOnly: false,
    hideOnLogin: false,
    firstBrokerLoginFlowAlias: $first_flow,
    postBrokerLoginFlowAlias: $post_flow,
    config: {
      clientId: $client_id,
      clientSecret: $client_secret,
      defaultScope: "openid profile email",
      syncMode: "IMPORT",
      useJwksUrl: "true"
    }
  }
')"

if kcadm get identity-provider/instances/google -r "${REALM}" >/dev/null 2>&1; then
  printf '%s' "${google_json}" | kcadm update identity-provider/instances/google \
    -r "${REALM}" -n -f - >/dev/null
else
  printf '%s' "${google_json}" | kcadm create identity-provider/instances \
    -r "${REALM}" -f - >/dev/null
fi

realm_verify="$(kcadm get "realms/${REALM}")"
google_verify="$(kcadm get identity-provider/instances/google -r "${REALM}")"
post_verify="$(kcadm get "authentication/flows/${POST_SUBFLOW}/executions" -r "${REALM}")"

jq -e '.resetPasswordAllowed == true and .loginWithEmailAllowed == true and .duplicateEmailsAllowed == false' \
  >/dev/null <<<"${realm_verify}" || fail "recovery/email-login settings did not converge"
jq -e --arg first "${FIRST_FLOW}" --arg post "${POST_FLOW}" '
  .alias == "google" and .providerId == "google" and .enabled == true and
  .displayName == "Masuk dengan Google" and .trustEmail == true and
  .storeToken == false and .addReadTokenRoleOnCreate == false and
  .linkOnly == false and .hideOnLogin == false and
  .firstBrokerLoginFlowAlias == $first and .postBrokerLoginFlowAlias == $post and
  .config.syncMode == "IMPORT"
' >/dev/null <<<"${google_verify}" || fail "Google provider did not converge"
jq -e '
  length == 2 and
  ([.[] | select(.providerId == "conditional-user-configured" and .requirement == "REQUIRED")] | length) == 1 and
  ([.[] | select(.providerId == "auth-otp-form" and .requirement == "REQUIRED")] | length) == 1
' >/dev/null <<<"${post_verify}" || fail "Google post-login MFA flow did not converge"

echo "FORGOT_PASSWORD_CONFIGURATION_PASS"
echo "EMAIL_ALTERNATE_LOGIN_CONFIGURATION_PASS"
echo "GOOGLE_EXISTING_ACCOUNT_LINK_ONLY_PASS"
echo "GOOGLE_CONDITIONAL_MFA_PASS"
echo "GOOGLE_PROVIDER_CONFIGURATION_PASS"
