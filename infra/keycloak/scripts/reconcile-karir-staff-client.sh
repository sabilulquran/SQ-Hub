#!/usr/bin/env bash
set -euo pipefail

# Idempotent convergence of the Karir SQ staff client `karir-sq` in the staff realm sq-staff
# (REC-IMPL-001 §4.1). Same pattern as reconcile-hub-production-client.sh: the desired state holds
# no secret, Keycloak generates it, and the operator stores it through the approved secret path.
# Which staff may open Karir SQ is decided by SQ Hub Application Access, not by Keycloak roles.
# Production runs need explicit owner approval.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYCLOAK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DESIRED_STATE="${KARIR_STAFF_CLIENT_DESIRED_STATE:-${KEYCLOAK_DIR}/clients/karir-sq.json}"
REALM="${KEYCLOAK_REALM:-sq-staff}"
CLIENT_ID="karir-sq"
KCADM="${KCADM_BIN:-/opt/keycloak/bin/kcadm.sh}"
KCADM_CONFIG="${KEYCLOAK_KCADM_CONFIG:-/tmp/karir-sq-staff-client.kcadm}"

fail() {
  printf 'KARIR_STAFF_CLIENT_RECONCILE_FAIL: %s\n' "$1" >&2
  exit 1
}

[[ "$REALM" == "sq-staff" ]] || fail "target realm must be exactly sq-staff"
[[ -f "$DESIRED_STATE" ]] || fail "desired-state file not found"
command -v jq >/dev/null 2>&1 || fail "jq is required"
[[ -x "$KCADM" ]] || fail "kcadm executable not found"
[[ -f "$KCADM_CONFIG" ]] || fail "pre-authenticated kcadm config is required"

CONTRACT='
  .clientId == "karir-sq" and
  .enabled == true and
  .protocol == "openid-connect" and
  .publicClient == false and
  .bearerOnly == false and
  .standardFlowEnabled == true and
  .implicitFlowEnabled == false and
  .directAccessGrantsEnabled == false and
  .serviceAccountsEnabled == false and
  .fullScopeAllowed == false and
  .redirectUris == ["https://karir.sabilulquran.or.id/api/staf/auth/callback"] and
  .webOrigins == ["https://karir.sabilulquran.or.id"] and
  .attributes["pkce.code.challenge.method"] == "S256" and
  .attributes["post.logout.redirect.uris"] == "https://karir.sabilulquran.or.id/staf"
'

jq -e "${CONTRACT} and (has(\"secret\") | not)" "$DESIRED_STATE" >/dev/null || fail "desired-state contract is invalid"

kcadm() {
  "$KCADM" "$@" --config "$KCADM_CONFIG"
}

kcadm get "realms/$REALM" | jq -e --arg realm "$REALM" '.realm == $realm' >/dev/null \
  || fail "authenticated endpoint did not return the staff realm"

client_json="$(kcadm get clients -r "$REALM" -q "clientId=$CLIENT_ID")" || fail "unable to query the Karir staff client"
case "$(jq --arg id "$CLIENT_ID" '[.[] | select(.clientId == $id)] | length' <<<"$client_json")" in
  0)
    kcadm create clients -r "$REALM" -f "$DESIRED_STATE" >/dev/null || fail "unable to create the Karir staff client"
    action="created"
    ;;
  1)
    client_uuid="$(jq -er --arg id "$CLIENT_ID" '.[] | select(.clientId == $id) | .id' <<<"$client_json")"
    kcadm update "clients/$client_uuid" -r "$REALM" -f "$DESIRED_STATE" >/dev/null || fail "unable to update the Karir staff client"
    action="updated"
    ;;
  *)
    fail "Karir staff client is ambiguous"
    ;;
esac

verify_json="$(kcadm get clients -r "$REALM" -q "clientId=$CLIENT_ID")" || fail "unable to verify the Karir staff client"
[[ "$(jq --arg id "$CLIENT_ID" '[.[] | select(.clientId == $id)] | length' <<<"$verify_json")" == "1" ]] \
  || fail "verification returned an ambiguous client"
jq -e --arg id "$CLIENT_ID" "[.[] | select(.clientId == \$id)][0] | ${CONTRACT}" >/dev/null <<<"$verify_json" \
  || fail "Karir staff client did not converge"

unset client_json verify_json
printf 'KARIR_STAFF_CLIENT_CONFIGURATION_PASS action=%s realm=%s client=%s\n' "$action" "$REALM" "$CLIENT_ID"
printf 'KARIR_STAFF_CLIENT_SECRET_HANDOFF_REQUIRED\n'
printf 'Store the client secret for Karir SQ final.env only through the approved operator secret-custody path; do not print it here.\n'
