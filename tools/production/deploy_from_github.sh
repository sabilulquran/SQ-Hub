#!/usr/bin/env bash
set -Eeuo pipefail

target_sha=$1
scope=$2
api_repo=$3
web_repo=$4
kc_repo=$5
api_sha=$6
web_sha=$7
kc_sha=$8

runtime_dir=/var/www/sq-hub-production
hub_compose="$runtime_dir/compose.hub.json"
identity_compose="$runtime_dir/compose.identity.json"
hub_project=sq-hub-production
identity_project=sq-hub-keycloak-production

need_api=0
need_web=0
need_kc=0
case "$scope" in
  auto|all) need_api=1; need_web=1; need_kc=1 ;;
  hub) need_api=1; need_web=1 ;;
  api) need_api=1 ;;
  web) need_web=1 ;;
  identity) need_kc=1 ;;
  *) echo "STOP: unsupported deployment scope: $scope" >&2; exit 1 ;;
esac

sudo -n true

sudo -n test -d "$runtime_dir"
sudo -n test -r "$hub_compose"
sudo -n test -r "$identity_compose"

hub_services="$(sudo -n docker compose -f "$hub_compose" config --services | sort)"
identity_services="$(sudo -n docker compose -f "$identity_compose" config --services | sort)"
test "$hub_services" = $'api\npostgres\nweb' || {
  echo "STOP: unexpected Hub production service set" >&2
  exit 1
}
test "$identity_services" = $'keycloak\nkeycloak-db' || {
  echo "STOP: unexpected Keycloak production service set" >&2
  exit 1
}

compose_container() {
  project=$1
  service=$2
  sudo -n docker ps -q     --filter "label=com.docker.compose.project=$project"     --filter "label=com.docker.compose.service=$service" |
    head -n 1
}

assert_runtime_container() {
  project=$1
  service=$2
  expected_config=$3

  cid="$(compose_container "$project" "$service")"
  test -n "$cid" || {
    echo "STOP: running container not found for $project/$service" >&2
    exit 1
  }

  actual_config="$(
    sudo -n docker inspect "$cid"       --format '{{ index .Config.Labels "com.docker.compose.project.config_files" }}'
  )"
  test "$actual_config" = "$expected_config" || {
    echo "STOP: $project/$service is not owned by expected production Compose file" >&2
    echo "expected_config=$expected_config" >&2
    echo "actual_config=$actual_config" >&2
    exit 1
  }
}

assert_runtime_container "$hub_project" api "$hub_compose"
assert_runtime_container "$hub_project" web "$hub_compose"
assert_runtime_container "$identity_project" keycloak "$identity_compose"

pull_digest() {
  image_repo=$1
  source_sha=$2
  tag="$image_repo:sha-$source_sha"

  if ! sudo -n docker pull "$tag" >/dev/null; then
    echo "STOP: required immutable image is unavailable: $tag" >&2
    return 1
  fi

  digest="$(
    sudo -n docker image inspect "$tag" --format '{{range .RepoDigests}}{{println .}}{{end}}' |
      grep -F "$image_repo@sha256:" |
      head -n 1
  )"
  if [ -z "$digest" ]; then
    echo "STOP: pulled image has no repository digest: $tag" >&2
    return 1
  fi

  printf '%s' "$digest"
}

image_id_for_ref() {
  sudo -n docker image inspect "$1" --format '{{.Id}}'
}

running_image_id() {
  container_id=$1
  sudo -n docker inspect "$container_id" --format '{{.Image}}'
}

compose_image() {
  file=$1
  service=$2
  sudo -n python3 - "$file" "$service" <<'PY'
import json
import sys

path, service = sys.argv[1:]
with open(path, encoding="utf-8") as handle:
    data = json.load(handle)
try:
    image = data["services"][service]["image"]
except (KeyError, TypeError):
    raise SystemExit(2)
if not isinstance(image, str) or not image:
    raise SystemExit(3)
print(image)
PY
}

set_compose_image() {
  file=$1
  service=$2
  image=$3

  case "$image" in
    *@sha256:*) ;;
    *)
      echo "STOP: refusing non-digest or empty image for $service" >&2
      return 1
      ;;
  esac

  sudo -n python3 - "$file" "$service" "$image" <<'PY'
import json
import os
import stat
import sys
import tempfile

path, service, image = sys.argv[1:]
with open(path, encoding="utf-8") as handle:
    data = json.load(handle)

services = data.get("services")
if not isinstance(services, dict) or service not in services:
    raise SystemExit(f"missing service {service}")
service_config = services[service]
if not isinstance(service_config, dict):
    raise SystemExit(f"invalid service {service}")
old_image = service_config.get("image")
if not isinstance(old_image, str) or not old_image:
    raise SystemExit(f"service {service} has no image")
service_config["image"] = image

st = os.stat(path)
directory = os.path.dirname(path)
fd, temp_path = tempfile.mkstemp(prefix=".deploy-", suffix=".json", dir=directory)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(temp_path, stat.S_IMODE(st.st_mode))
    os.chown(temp_path, st.st_uid, st.st_gid)
    os.replace(temp_path, path)
finally:
    if os.path.exists(temp_path):
        os.unlink(temp_path)
PY
}

wait_compose_healthy() {
  project=$1
  service=$2
  for attempt in $(seq 1 60); do
    cid="$(compose_container "$project" "$service")"
    if [ -n "$cid" ]; then
      status="$(
        sudo -n docker inspect "$cid"           --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}'
      )"
      if [ "$status" = "healthy" ] || [ "$status" = "running" ]; then
        return 0
      fi
      if [ "$status" = "unhealthy" ] || [ "$status" = "exited" ] || [ "$status" = "dead" ]; then
        return 1
      fi
    fi
    sleep 2
  done
  return 1
}

api_digest=""
web_digest=""
kc_digest=""
api_change=0
web_change=0
kc_change=0

if [ "$need_api" = 1 ]; then
  if ! api_digest="$(pull_digest "$api_repo" "$api_sha")"; then
    exit 1
  fi
  api_cid="$(compose_container "$hub_project" api)"
  if [ "$(running_image_id "$api_cid")" != "$(image_id_for_ref "$api_digest")" ]; then
    api_change=1
  fi
fi

if [ "$need_web" = 1 ]; then
  if ! web_digest="$(pull_digest "$web_repo" "$web_sha")"; then
    exit 1
  fi
  web_cid="$(compose_container "$hub_project" web)"
  if [ "$(running_image_id "$web_cid")" != "$(image_id_for_ref "$web_digest")" ]; then
    web_change=1
  fi
fi

if [ "$need_kc" = 1 ]; then
  if ! kc_digest="$(pull_digest "$kc_repo" "$kc_sha")"; then
    exit 1
  fi
  kc_cid="$(compose_container "$identity_project" keycloak)"
  if [ "$(running_image_id "$kc_cid")" != "$(image_id_for_ref "$kc_digest")" ]; then
    kc_change=1
  fi
fi

echo "PRODUCTION_RUNTIME_BUNDLE_PREFLIGHT_PASS"
echo "target_sha=$target_sha"
echo "runtime_dir=$runtime_dir"
echo "hub_compose=$hub_compose"
echo "identity_compose=$identity_compose"
echo "api_source_sha=$api_sha change=$api_change"
echo "web_source_sha=$web_sha change=$web_change"
echo "identity_source_sha=$kc_sha change=$kc_change"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
hub_backup="$runtime_dir/compose.hub.json.before-gha-$stamp"
identity_backup="$runtime_dir/compose.identity.json.before-gha-$stamp"

sudo -n cp -p "$hub_compose" "$hub_backup"
if [ "$need_kc" = 1 ]; then
  sudo -n cp -p "$identity_compose" "$identity_backup"
fi

deployed_api=0
deployed_web=0
deployed_kc=0

rollback() {
  rc=$?
  trap - ERR EXIT
  if [ "$rc" -eq 0 ]; then
    return 0
  fi

  echo "PRODUCTION_ROLLBACK_BEGIN"

  sudo -n cp -p "$hub_backup" "$hub_compose" || true
  if [ "$need_kc" = 1 ]; then
    sudo -n cp -p "$identity_backup" "$identity_compose" || true
  fi

  if [ "$deployed_api" = 1 ]; then
    sudo -n docker compose -f "$hub_compose"       up -d --no-deps --no-build --pull never --force-recreate api || true
  fi
  if [ "$deployed_web" = 1 ]; then
    sudo -n docker compose -f "$hub_compose"       up -d --no-deps --no-build --pull never --force-recreate web || true
  fi
  if [ "$deployed_kc" = 1 ]; then
    sudo -n docker compose -f "$identity_compose"       up -d --no-deps --no-build --pull never --force-recreate keycloak || true
  fi

  echo "PRODUCTION_ROLLBACK_ATTEMPTED"
  exit "$rc"
}
trap rollback ERR EXIT

if [ "$api_change" = 1 ]; then
  set_compose_image "$hub_compose" api "$api_digest"
fi
if [ "$web_change" = 1 ]; then
  set_compose_image "$hub_compose" web "$web_digest"
fi
sudo -n docker compose -f "$hub_compose" config -q

if [ "$need_kc" = 1 ] && [ "$kc_change" = 1 ]; then
  set_compose_image "$identity_compose" keycloak "$kc_digest"
fi
if [ "$need_kc" = 1 ]; then
  sudo -n docker compose -f "$identity_compose" config -q
fi

if [ "$api_change" = 1 ]; then
  deployed_api=1
  sudo -n docker compose -f "$hub_compose"     up -d --no-deps --no-build --pull never --force-recreate api
  wait_compose_healthy "$hub_project" api
  curl --fail --silent http://127.0.0.1:18200/health >/dev/null
  echo "API_DEPLOY_PASS source=$api_sha image=$api_digest"
else
  echo "API_DEPLOY_NOOP source=$api_sha"
fi

if [ "$web_change" = 1 ]; then
  deployed_web=1
  sudo -n docker compose -f "$hub_compose"     up -d --no-deps --no-build --pull never --force-recreate web
  wait_compose_healthy "$hub_project" web
  curl --fail --silent http://127.0.0.1:18201/healthz >/dev/null
  echo "WEB_DEPLOY_PASS source=$web_sha image=$web_digest"
else
  echo "WEB_DEPLOY_NOOP source=$web_sha"
fi

if [ "$need_kc" = 1 ]; then
  if [ "$kc_change" = 1 ]; then
    deployed_kc=1
    sudo -n docker compose -f "$identity_compose"       up -d --no-deps --no-build --pull never --force-recreate keycloak
    wait_compose_healthy "$identity_project" keycloak
    echo "IDENTITY_IMAGE_DEPLOY_PASS source=$kc_sha image=$kc_digest"
  else
    echo "IDENTITY_IMAGE_DEPLOY_NOOP source=$kc_sha"
  fi
fi

curl --fail --silent https://hub.sabilulquran.or.id/healthz >/dev/null
curl --fail --silent   https://login.sabilulquran.or.id/realms/sq-staff/.well-known/openid-configuration |
  grep -Eq '"issuer"[[:space:]]*:[[:space:]]*"https://login[.]sabilulquran[.]or[.]id/realms/sq-staff"'
curl --fail --silent --output /dev/null https://hcis.sabilulquran.or.id/

if [ "$need_api" = 1 ]; then
  test "$(compose_image "$hub_compose" api)" = "$api_digest"
  cid="$(compose_container "$hub_project" api)"
  test "$(running_image_id "$cid")" = "$(image_id_for_ref "$api_digest")"
fi
if [ "$need_web" = 1 ]; then
  test "$(compose_image "$hub_compose" web)" = "$web_digest"
  cid="$(compose_container "$hub_project" web)"
  test "$(running_image_id "$cid")" = "$(image_id_for_ref "$web_digest")"
fi
if [ "$need_kc" = 1 ]; then
  test "$(compose_image "$identity_compose" keycloak)" = "$kc_digest"
  cid="$(compose_container "$identity_project" keycloak)"
  test "$(running_image_id "$cid")" = "$(image_id_for_ref "$kc_digest")"
fi

trap - ERR EXIT

echo "HUB_COMPOSE_BACKUP=$hub_backup"
if [ "$need_kc" = 1 ]; then
  echo "IDENTITY_COMPOSE_BACKUP=$identity_backup"
fi
echo "SQ_HUB_PRODUCTION_DEPLOY_PASS"
echo "runtime_scope=$scope"
