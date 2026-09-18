#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYCLOAK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DESIRED_STATE="${KEYCLOAK_MASTER_RECOVERY_DESIRED_STATE:-${KEYCLOAK_DIR}/realm/master-production-recovery.json}"
SMTP_ENV_FILE="${KEYCLOAK_MASTER_SMTP_ENV_FILE:?set KEYCLOAK_MASTER_SMTP_ENV_FILE to the controlled runtime SMTP file}"
KCADM="${KCADM_BIN:-/opt/keycloak/bin/kcadm.sh}"
KCADM_CONFIG="${KEYCLOAK_KCADM_CONFIG:-/tmp/akun-sq-master-production.kcadm}"

fail() {
  printf 'AKUN_SQ_MASTER_RECOVERY_RECONCILE_FAIL: %s\n' "$1" >&2
  exit 1
}

[[ -f "$DESIRED_STATE" ]] || fail "desired-state file not found"
[[ -f "$SMTP_ENV_FILE" ]] || fail "SMTP runtime file not found"
[[ -f "$KCADM_CONFIG" ]] || fail "pre-authenticated kcadm config is required"
[[ -x "$KCADM" ]] || fail "kcadm executable not found"
command -v jq >/dev/null 2>&1 || fail "jq is required"

set -a
# shellcheck disable=SC1090
source "$SMTP_ENV_FILE"
set +a

: "${KEYCLOAK_MASTER_SMTP_HOST:?missing SMTP host}"
: "${KEYCLOAK_MASTER_SMTP_PORT:?missing SMTP port}"
: "${KEYCLOAK_MASTER_SMTP_FROM:?missing SMTP sender}"
: "${KEYCLOAK_MASTER_SMTP_FROM_DISPLAY_NAME:?missing SMTP sender display name}"
: "${KEYCLOAK_MASTER_SMTP_REPLY_TO:?missing SMTP reply-to}"
: "${KEYCLOAK_MASTER_SMTP_STARTTLS:?missing SMTP STARTTLS flag}"
: "${KEYCLOAK_MASTER_SMTP_SSL:?missing SMTP SSL flag}"
: "${KEYCLOAK_MASTER_SMTP_AUTH:?missing SMTP auth flag}"
: "${KEYCLOAK_MASTER_SMTP_USER:?missing SMTP username}"
: "${KEYCLOAK_MASTER_SMTP_PASSWORD:?missing SMTP password in runtime secret store}"

jq -e '
  .realm == "master" and
  .displayName == "Akun SQ" and
  .loginTheme == "sq-hub" and
  .accountTheme == "sq-hub" and
  .resetPasswordAllowed == true and
  (has("smtpServer") | not)
' "$DESIRED_STATE" >/dev/null || fail "master desired-state contract is invalid"

kcadm() {
  "$KCADM" "$@" --config "$KCADM_CONFIG"
}

current="$(kcadm get realms/master)" || fail "unable to read master realm"

update="$(
  jq     --slurpfile desired "$DESIRED_STATE"     --arg host "$KEYCLOAK_MASTER_SMTP_HOST"     --arg port "$KEYCLOAK_MASTER_SMTP_PORT"     --arg from "$KEYCLOAK_MASTER_SMTP_FROM"     --arg from_display "$KEYCLOAK_MASTER_SMTP_FROM_DISPLAY_NAME"     --arg reply_to "$KEYCLOAK_MASTER_SMTP_REPLY_TO"     --arg starttls "$KEYCLOAK_MASTER_SMTP_STARTTLS"     --arg ssl "$KEYCLOAK_MASTER_SMTP_SSL"     --arg auth "$KEYCLOAK_MASTER_SMTP_AUTH"     --arg user "$KEYCLOAK_MASTER_SMTP_USER"     --arg password "$KEYCLOAK_MASTER_SMTP_PASSWORD" '
      .displayName = $desired[0].displayName |
      .loginTheme = $desired[0].loginTheme |
      .accountTheme = $desired[0].accountTheme |
      .resetPasswordAllowed = $desired[0].resetPasswordAllowed |
      .smtpServer = {
        host: $host,
        port: $port,
        from: $from,
        fromDisplayName: $from_display,
        replyTo: $reply_to,
        starttls: $starttls,
        ssl: $ssl,
        auth: $auth,
        user: $user,
        password: env.KEYCLOAK_MASTER_SMTP_PASSWORD
      }
    ' <<<"$current"
)"

printf '%s' "$update" | kcadm update realms/master -n -f - >/dev/null   || fail "unable to update master realm"

verify="$(kcadm get realms/master)" || fail "unable to verify master realm"
jq -e   --arg host "$KEYCLOAK_MASTER_SMTP_HOST"   --arg from "$KEYCLOAK_MASTER_SMTP_FROM" '
    .realm == "master" and
    .displayName == "Akun SQ" and
    .loginTheme == "sq-hub" and
    .accountTheme == "sq-hub" and
    .resetPasswordAllowed == true and
    .smtpServer.host == $host and
    .smtpServer.from == $from and
    (.smtpServer.password | type == "string" and length > 0)
  ' >/dev/null <<<"$verify" || fail "master recovery/SMTP configuration did not converge"

unset current update verify KEYCLOAK_MASTER_SMTP_PASSWORD
printf 'AKUN_SQ_MASTER_BRANDING_PASS\n'
printf 'AKUN_SQ_MASTER_FORGOT_PASSWORD_CONFIGURATION_PASS\n'
printf 'AKUN_SQ_MASTER_SMTP_CONFIGURATION_PASS\n'
printf 'SMTP delivery is not verified by configuration convergence; perform an operator-owned recovery email test.\n'
