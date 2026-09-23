#!/usr/bin/env bash
# Shared web gate. Production callers may set PAIRFOB_PACK_DL=1 to pack once.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

step() {
  local label="$1" start=$SECONDS
  shift
  echo "verify: starting $label"
  "$@"
  echo "verify: $label passed in $((SECONDS - start))s"
}

cd "$ROOT/pwa"
step "PWA tests" bun test src
step "PWA QA" bun run test:qa
step "PWA types" bun run typecheck
step "PWA QA types" bun run typecheck:qa
step "PWA build" bun run build
step "origin pack (includes docs build)" bash "$ROOT/scripts/pack-origin-assets.sh"
test -f "$ROOT/workers/pairfob-origin/public-dist/install.sh"
test -f "$ROOT/workers/pairfob-origin/public-dist/doc/index.html"

cd "$ROOT/workers/pairfob-origin"
step "Worker tests" bun test src
step "Worker harness" bun test e2e
step "Worker types" bun run typecheck
step "Worker integration" bun run e2e:wrangler
