#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYCLOAK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DESIRED_STATE="${SQ_HUB_PRODUCTION_CLIENT_DESIRED_STATE:-${KEYCLOAK_DIR}/clients/sq-hub-production.json}"
REALM="${KEYCLOAK_REALM:-sq-staff}"
CLIENT_ID="sq-hub"
KCADM="${KCADM_BIN:-/opt/keycloak/bin/kcadm.sh}"
KCADM_CONFIG="${KEYCLOAK_KCADM_CONFIG:-/tmp/sq-hub-production.kcadm}"

fail() {
  printf 'HUB_PRODUCTION_CLIENT_RECONCILE_FAIL: %s\n' "$1" >&2
  exit 1
}

[[ "$REALM" == "sq-staff" ]] || fail "target realm must be exactly sq-staff"
[[ -f "$DESIRED_STATE" ]] || fail "desired-state file not found"
command -v jq >/dev/null 2>&1 || fail "jq is required"
[[ -x "$KCADM" ]] || fail "kcadm executable not found"
[[ -f "$KCADM_CONFIG" ]] || fail "pre-authenticated kcadm config is required"

jq -e '
  .clientId == "sq-hub" and
  .publicClient == false and
  .bearerOnly == false and
  .standardFlowEnabled == true and
  .implicitFlowEnabled == false and
  .directAccessGrantsEnabled == false and
  .serviceAccountsEnabled == false and
  .fullScopeAllowed == false and
  .redirectUris == ["https://hub.sabilulquran.or.id/auth/callback"] and
  .webOrigins == ["https://hub.sabilulquran.or.id"] and
  .attributes["pkce.code.challenge.method"] == "S256" and
  .attributes["post.logout.redirect.uris"] == "https://hub.sabilulquran.or.id/" and
  (has("secret") | not)
' "$DESIRED_STATE" >/dev/null || fail "desired-state contract is invalid"

kcadm() {
  "$KCADM" "$@" --config "$KCADM_CONFIG"
}

client_json="$(kcadm get clients -r "$REALM" -q "clientId=$CLIENT_ID")"   || fail "unable to query production Hub client"
client_count="$(jq 'length' <<<"$client_json")"

case "$client_count" in
  0)
    kcadm create clients -r "$REALM" -f "$DESIRED_STATE" >/dev/null       || fail "unable to create production Hub client"
    action="created"
    ;;
  1)
    client_uuid="$(jq -er '.[0].id' <<<"$client_json")"
    kcadm update "clients/$client_uuid" -r "$REALM" -f "$DESIRED_STATE" >/dev/null       || fail "unable to update production Hub client"
    action="updated"
    ;;
  *)
    fail "production Hub client is ambiguous"
    ;;
esac

verify_json="$(kcadm get clients -r "$REALM" -q "clientId=$CLIENT_ID")"   || fail "unable to verify production Hub client"
[[ "$(jq 'length' <<<"$verify_json")" == "1" ]] || fail "verification returned ambiguous client"
verify_client="$(jq '.[0]' <<<"$verify_json")"

jq -e '
  .clientId == "sq-hub" and
  .enabled == true and
  .protocol == "openid-connect" and
  .publicClient == false and
  .bearerOnly == false and
  .standardFlowEnabled == true and
  .implicitFlowEnabled == false and
  .directAccessGrantsEnabled == false and
  .serviceAccountsEnabled == false and
  .fullScopeAllowed == false and
  .redirectUris == ["https://hub.sabilulquran.or.id/auth/callback"] and
  .webOrigins == ["https://hub.sabilulquran.or.id"] and
  .attributes["pkce.code.challenge.method"] == "S256" and
  .attributes["post.logout.redirect.uris"] == "https://hub.sabilulquran.or.id/"
' >/dev/null <<<"$verify_client" || fail "production Hub client did not converge"

unset client_json verify_json verify_client
printf 'HUB_PRODUCTION_CLIENT_CONFIGURATION_PASS action=%s realm=%s client=%s\n' "$action" "$REALM" "$CLIENT_ID"
printf 'HUB_PRODUCTION_CLIENT_SECRET_HANDOFF_REQUIRED\n'
printf 'Obtain/store the client secret only through the approved operator secret-custody path; do not print it here.\n'
