#!/usr/bin/env bash
set -Eeuo pipefail

repo_path=$1
target_sha=$2
scope=$3
hub_env=$4
kc_env=$5
kc_compose_file=$6
api_repo=$7
web_repo=$8
kc_repo=$9
api_sha=${10}
web_sha=${11}
kc_sha=${12}

if [ -z "$hub_env" ]; then
  hub_env="$repo_path/infra/.env.production"
fi

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

cd "$repo_path"
if [ -n "$(git status --porcelain)" ]; then
  echo "STOP: production working tree is not clean" >&2
  git status --short
  exit 1
fi

previous_sha="$(git rev-parse HEAD)"
git remote set-url origin https://github.com/sabilulquran/SQ-Hub.git
git fetch origin main
remote_sha="$(git rev-parse origin/main)"
test "$remote_sha" = "$target_sha" || {
  echo "STOP: VPS origin/main does not match requested target" >&2
  exit 1
}

test -f "$hub_env" || {
  echo "STOP: Hub production env file is missing" >&2
  exit 1
}
test -r "$hub_env" || {
  echo "STOP: Hub production env file is not readable" >&2
  exit 1
}
grep -q '^SQ_HUB_API_IMAGE=' "$hub_env"
grep -q '^SQ_HUB_WEB_IMAGE=' "$hub_env"

if [ "$need_kc" = 1 ]; then
  test -n "$kc_env" || {
    echo "STOP: SQ_HUB_PROD_KEYCLOAK_ENV_FILE is required for identity deployment" >&2
    exit 1
  }
  test -n "$kc_compose_file" || {
    echo "STOP: SQ_HUB_PROD_KEYCLOAK_COMPOSE_FILE is required for identity deployment" >&2
    exit 1
  }
  test -f "$kc_env"
  test -f "$kc_compose_file"
  test -r "$kc_env"
  test -r "$kc_compose_file"
  grep -q '^SQ_HUB_KEYCLOAK_IMAGE=' "$kc_env" || {
    echo "STOP: production Keycloak env must contain SQ_HUB_KEYCLOAK_IMAGE" >&2
    exit 1
  }
fi

pull_digest() {
  image_repo=$1
  source_sha=$2
  tag="$image_repo:sha-$source_sha"
  docker pull "$tag" >/dev/null
  digest="$(
    docker image inspect "$tag" --format '{{range .RepoDigests}}{{println .}}{{end}}' |
      grep -F "$image_repo@sha256:" |
      head -n 1
  )"
  test -n "$digest"
  printf '%s' "$digest"
}

set_env_value() {
  file=$1
  key=$2
  value=$3
  tmp="$(mktemp)"
  if ! awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    index($0, key "=") == 1 { print key "=" value; found = 1; next }
    { print }
    END { if (!found) exit 42 }
  ' "$file" > "$tmp"; then
    rm -f "$tmp"
    echo "STOP: required key $key is missing from runtime env" >&2
    return 1
  fi
  chmod 600 "$tmp"
  mv "$tmp" "$file"
}

compose_container() {
  service=$1
  docker ps -q     --filter label=com.docker.compose.project=sq-hub-production     --filter label=com.docker.compose.service="$service" |
    head -n 1
}

image_id_for_ref() {
  docker image inspect "$1" --format '{{.Id}}'
}

running_image_id() {
  container_id=$1
  docker inspect "$container_id" --format '{{.Image}}'
}

wait_compose_healthy() {
  service=$1
  for attempt in $(seq 1 60); do
    cid="$(compose_container "$service")"
    if [ -n "$cid" ]; then
      status="$(docker inspect "$cid" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}')"
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

kc_compose() {
  docker compose --env-file "$kc_env" -f "$kc_compose_file" "$@"
}

wait_keycloak_running() {
  for attempt in $(seq 1 60); do
    cid="$(kc_compose ps -q keycloak 2>/dev/null | head -n 1)"
    if [ -n "$cid" ]; then
      state="$(docker inspect "$cid" --format '{{.State.Status}}')"
      [ "$state" = "running" ] && return 0
      case "$state" in
        exited|dead) return 1 ;;
      esac
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
  api_digest="$(pull_digest "$api_repo" "$api_sha")"
  api_cid="$(compose_container api)"
  test -n "$api_cid" || {
    echo "STOP: production API container not found" >&2
    exit 1
  }
  if [ "$(running_image_id "$api_cid")" != "$(image_id_for_ref "$api_digest")" ]; then
    api_change=1
  fi
fi

if [ "$need_web" = 1 ]; then
  web_digest="$(pull_digest "$web_repo" "$web_sha")"
  web_cid="$(compose_container web)"
  test -n "$web_cid" || {
    echo "STOP: production web container not found" >&2
    exit 1
  }
  if [ "$(running_image_id "$web_cid")" != "$(image_id_for_ref "$web_digest")" ]; then
    web_change=1
  fi
fi

if [ "$need_kc" = 1 ]; then
  kc_digest="$(pull_digest "$kc_repo" "$kc_sha")"
  kc_cid="$(kc_compose ps -q keycloak 2>/dev/null | head -n 1)"
  test -n "$kc_cid" || {
    echo "STOP: production Keycloak container not found" >&2
    exit 1
  }
  if [ "$(running_image_id "$kc_cid")" != "$(image_id_for_ref "$kc_digest")" ]; then
    kc_change=1
  fi
fi

echo "PRODUCTION_PREFLIGHT_PASS"
echo "target_sha=$target_sha"
echo "api_source_sha=$api_sha change=$api_change"
echo "web_source_sha=$web_sha change=$web_change"
echo "identity_source_sha=$kc_sha change=$kc_change"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
hub_env_backup="$hub_env.before-gha-$stamp"
cp -p "$hub_env" "$hub_env_backup"
chmod 600 "$hub_env_backup"

kc_env_backup=""
if [ "$need_kc" = 1 ]; then
  kc_env_backup="$kc_env.before-gha-$stamp"
  cp -p "$kc_env" "$kc_env_backup"
  chmod 600 "$kc_env_backup"
fi

deployed_api=0
deployed_web=0
deployed_kc=0

rollback() {
  rc=$?
  trap - EXIT ERR
  if [ "$rc" -eq 0 ]; then
    return 0
  fi

  echo "PRODUCTION_ROLLBACK_BEGIN"

  git checkout --detach "$previous_sha" >/dev/null 2>&1 || true
  cp -p "$hub_env_backup" "$hub_env" || true
  if [ -n "$kc_env_backup" ]; then
    cp -p "$kc_env_backup" "$kc_env" || true
  fi

  if [ "$deployed_api" = 1 ]; then
    docker compose --env-file "$hub_env" -f "$repo_path/infra/docker-compose.production.yml"       up -d --no-deps --no-build --pull never --force-recreate api || true
  fi
  if [ "$deployed_web" = 1 ]; then
    docker compose --env-file "$hub_env" -f "$repo_path/infra/docker-compose.production.yml"       up -d --no-deps --no-build --pull never --force-recreate web || true
  fi
  if [ "$deployed_kc" = 1 ]; then
    kc_compose up -d --no-deps --no-build --pull never --force-recreate keycloak || true
  fi

  echo "PRODUCTION_ROLLBACK_ATTEMPTED"
  exit "$rc"
}
trap rollback ERR EXIT

git checkout --detach "$target_sha" >/dev/null

if [ "$api_change" = 1 ]; then
  set_env_value "$hub_env" SQ_HUB_API_IMAGE "$api_digest"
fi
if [ "$web_change" = 1 ]; then
  set_env_value "$hub_env" SQ_HUB_WEB_IMAGE "$web_digest"
fi

docker compose --env-file "$hub_env" -f "$repo_path/infra/docker-compose.production.yml" config -q

if [ "$api_change" = 1 ]; then
  deployed_api=1
  docker compose --env-file "$hub_env" -f "$repo_path/infra/docker-compose.production.yml"     up -d --no-deps --no-build --pull never --force-recreate api
  wait_compose_healthy api
  curl --fail --silent http://127.0.0.1:18200/health >/dev/null
  echo "API_DEPLOY_PASS source=$api_sha image=$api_digest"
else
  echo "API_DEPLOY_NOOP source=$api_sha"
fi

if [ "$web_change" = 1 ]; then
  deployed_web=1
  docker compose --env-file "$hub_env" -f "$repo_path/infra/docker-compose.production.yml"     up -d --no-deps --no-build --pull never --force-recreate web
  wait_compose_healthy web
  curl --fail --silent http://127.0.0.1:18201/healthz >/dev/null
  echo "WEB_DEPLOY_PASS source=$web_sha image=$web_digest"
else
  echo "WEB_DEPLOY_NOOP source=$web_sha"
fi

if [ "$kc_change" = 1 ]; then
  set_env_value "$kc_env" SQ_HUB_KEYCLOAK_IMAGE "$kc_digest"
  kc_compose config -q
  rendered_kc_image="$(kc_compose config --images | grep -F "$kc_repo@sha256:" | head -n 1)"
  test "$rendered_kc_image" = "$kc_digest" || {
    echo "STOP: rendered Keycloak image does not match requested digest" >&2
    exit 1
  }
  deployed_kc=1
  kc_compose up -d --no-deps --no-build --pull never --force-recreate keycloak
  wait_keycloak_running
  echo "IDENTITY_IMAGE_DEPLOY_PASS source=$kc_sha image=$kc_digest"
elif [ "$need_kc" = 1 ]; then
  echo "IDENTITY_IMAGE_DEPLOY_NOOP source=$kc_sha"
fi

curl --fail --silent https://hub.sabilulquran.or.id/healthz >/dev/null
curl --fail --silent   https://login.sabilulquran.or.id/realms/sq-staff/.well-known/openid-configuration |
  grep -Fq '"issuer":"https://login.sabilulquran.or.id/realms/sq-staff"'
curl --fail --silent --output /dev/null https://hcis.sabilulquran.or.id/

if [ "$need_api" = 1 ]; then
  cid="$(compose_container api)"
  test "$(running_image_id "$cid")" = "$(image_id_for_ref "$api_digest")"
fi
if [ "$need_web" = 1 ]; then
  cid="$(compose_container web)"
  test "$(running_image_id "$cid")" = "$(image_id_for_ref "$web_digest")"
fi
if [ "$need_kc" = 1 ]; then
  cid="$(kc_compose ps -q keycloak | head -n 1)"
  test "$(running_image_id "$cid")" = "$(image_id_for_ref "$kc_digest")"
fi

trap - ERR EXIT
rm -f "$hub_env_backup"
if [ -n "$kc_env_backup" ]; then
  rm -f "$kc_env_backup"
fi

echo "SQ_HUB_PRODUCTION_DEPLOY_PASS"
echo "runtime_scope=$scope"
