#!/usr/bin/env bash

set -euo pipefail

package_dir="$(mktemp -d)"
consumer_dir="$(mktemp -d)"

cleanup() {
  rm -rf "$package_dir" "$consumer_dir"
}
trap cleanup EXIT

npm pack --silent --pack-destination "$package_dir" >/dev/null
package_tarball="$(find "$package_dir" -type f -name '*.tgz' -print -quit)"
test -n "$package_tarball"

cd "$consumer_dir"
npm init --yes >/dev/null
npm install --save-dev "$package_tarball" >/dev/null
test -f package-lock.json
npx --no-install wt --help
