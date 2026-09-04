#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
installer="$root/install.sh"

bash -n "$installer"
rg -q 'WT_RELEASE_API_URL' "$installer"
rg -q 'WT_RELEASE_DOWNLOAD_BASE_URL' "$installer"
rg -q 'absolutepraya/wt' "$installer"
rg -q 'dist/wt\.cjs is missing; run npm ci && npm run build first\.' "$installer"
rg -q 'curl or wget is required' "$installer"
rg -q 'Node\.js 18 or newer is required' "$installer"
rg -q 'Git is required' "$installer"
rg -q 'wt-managed: BEGIN' "$installer"
if rg -q 'WT_REF|python3' "$installer"; then
  echo "installer still contains a legacy Python/ref contract" >&2
  exit 1
fi
