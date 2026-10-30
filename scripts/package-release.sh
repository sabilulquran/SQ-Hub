#!/usr/bin/env bash
# Builds a Mi8 release bundle from a clean checkout of HEAD (hub-release.sh in sq-core-ops expects this layout).
# Output: dist-release/hub-<sha8>-<yyyymmdd>.tar.gz with the compiled API, its migrations,
# production node_modules (pure JavaScript, so it runs on the arm64 host), and the built web app.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHA="$(git -C "$ROOT" rev-parse --short=8 HEAD)"
NAME="hub-${SHA}-$(date -u +%Y%m%d)"
OUT="$ROOT/dist-release"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  echo "Working tree is not clean; commit first so the bundle matches a commit." >&2
  exit 1
fi

git -C "$ROOT" -c core.autocrlf=false archive HEAD | tar -x -C "$STAGE"
cd "$STAGE"
npm ci --no-audit --no-fund
npm run build
rm -rf node_modules
npm ci --omit=dev --no-audit --no-fund
# Workspace links point back into the checkout; the host runs from apps/api directly.
rm -rf node_modules/@sq-hub

mkdir -p "$OUT"
tar -czf "$OUT/$NAME.tar.gz" package.json node_modules apps/api/package.json apps/api/dist apps/api/migrations apps/web/dist
echo "$OUT/$NAME.tar.gz"
sha256sum "$OUT/$NAME.tar.gz"
