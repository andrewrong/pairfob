#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/internal/tailnet/ui/generated"
BUN="${BUN:-bun}"

(cd "$ROOT/pwa" && "$BUN" run build)
rm -rf "$OUT"
mkdir -p "$OUT"
cp -R "$ROOT/pwa/dist/." "$OUT/"
