#!/usr/bin/env bash
set -euo pipefail

ISSUER="${WAVE1_ISSUER:-https://login.sabilulquran.or.id/realms/sq-staff-staging}"
HCIS_ORIGIN="${WAVE1_HCIS_ORIGIN:-https://hcis-staging.sabilulquran.or.id}"
EXPECTED_ISSUER="https://login.sabilulquran.or.id/realms/sq-staff-staging"
EXPECTED_HCIS_ORIGIN="https://hcis-staging.sabilulquran.or.id"

if [[ "$ISSUER" != "$EXPECTED_ISSUER" ]]; then
  echo "WAVE1_EXACT_ISSUER_FAIL"
  exit 1
fi
if [[ "$HCIS_ORIGIN" != "$EXPECTED_HCIS_ORIGIN" ]]; then
  echo "WAVE1_STAGING_ORIGIN_FAIL"
  exit 1
fi

work_dir="$(mktemp -d)"
cleanup() {
  rm -rf -- "$work_dir"
}
trap cleanup EXIT

curl --fail --silent --show-error \
  "$ISSUER/.well-known/openid-configuration" > "$work_dir/discovery.json"
jq -e --arg issuer "$EXPECTED_ISSUER" '.issuer == $issuer' "$work_dir/discovery.json" >/dev/null
echo "WAVE1_EXACT_ISSUER_PASS"

jq -e '.end_session_endpoint | type == "string" and length > 0' "$work_dir/discovery.json" >/dev/null
echo "WAVE1_LOGOUT_METADATA_PASS"

status="$(curl --silent --show-error --output "$work_dir/hcis-root.html" --write-out '%{http_code}' "$HCIS_ORIGIN/")"
test "$status" = "200"
grep -Fq 'SQ Identity' "$work_dir/hcis-root.html"
echo "WAVE1_HCIS_OIDC_ENTRY_PASS"

# These are the public aliases currently known to have historically exposed local auth.
# A 404/405/410 is acceptable. A successful local-password response is not.
paths=(
  "/api/auth/login"
  "/auth/login"
)
for path in "${paths[@]}"; do
  status="$(curl --silent --show-error \
    --output "$work_dir/local-auth-response" \
    --write-out '%{http_code}' \
    --header 'Content-Type: application/json' \
    --request POST \
    --data '{"email":"synthetic.invalid@example.org","password":"invalid"}' \
    "$HCIS_ORIGIN$path" || true)"

  case "$status" in
    404|405|410)
      ;;
    *)
      # The API contract may return 404 with LOCAL_AUTH_DISABLED through /api/auth/login.
      if grep -Fq 'LOCAL_AUTH_DISABLED' "$work_dir/local-auth-response"; then
        :
      else
        echo "WAVE1_LOCAL_AUTH_PUBLIC_EXCLUSION_FAIL path=$path status=$status"
        exit 1
      fi
      ;;
  esac
done
echo "WAVE1_LOCAL_AUTH_PUBLIC_EXCLUSION_PASS"
