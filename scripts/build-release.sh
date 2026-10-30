#!/usr/bin/env bash
# Build bin/pairfob, with the phone app embedded, from a clean checkout.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "build-release: bun is not on the PATH" >&2
  exit 1
fi
if ! command -v go >/dev/null 2>&1; then
  echo "build-release: go is not on the PATH" >&2
  exit 1
fi

(cd "$ROOT/pwa" && bun install --frozen-lockfile)
bash "$ROOT/scripts/embed-pwa.sh"
cd "$ROOT" && go build -trimpath -o bin/pairfob ./cmd/pairfob
