#!/usr/bin/env bash
# Standalone wt installer for macOS and Linux.
# curl -fsSL https://github.com/absolutepraya/wt/releases/latest/download/install.sh | bash

set -euo pipefail

readonly WT_REPOSITORY="absolutepraya/wt"
readonly PREFIX="${PREFIX:-${HOME}/.local}"
readonly WT_CONFIG_DIR="${WT_CONFIG_DIR:-${HOME}/.config/wt}"
readonly WT_RELEASE_API_URL="${WT_RELEASE_API_URL:-https://api.github.com/repos/absolutepraya/wt/releases/latest}"
readonly WT_RELEASE_DOWNLOAD_BASE_URL="${WT_RELEASE_DOWNLOAD_BASE_URL:-https://github.com/absolutepraya/wt/releases/download}"

fail() { echo "wt installer: $*" >&2; exit 1; }

script_dir=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
fi
local_source=0
if [[ -n "$script_dir" && -f "$script_dir/package.json" ]]; then
  local_source=1
  if [[ ! -f "$script_dir/dist/wt.cjs" ]]; then
    echo "wt installer: dist/wt.cjs is missing; run npm ci && npm run build first." >&2
    exit 1
  fi
fi

platform="$(uname -s)"
[[ "$platform" == Darwin || "$platform" == Linux ]] || fail "standalone installation supports macOS and Linux only. Use npm install -g @absolutepraya/wt on Windows."
command -v node >/dev/null 2>&1 || fail "Node.js 18 or newer is required. Install Node.js 18+ from https://nodejs.org/ and rerun this installer."
node_version="$(node -p 'process.versions.node' 2>/dev/null || true)"
[[ "$node_version" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || fail "could not determine the installed Node.js version; Node.js 18 or newer is required."
(( BASH_REMATCH[1] >= 18 )) || fail "Node.js $node_version found; wt requires Node.js 18 or newer. Install a supported Node.js release and rerun this installer."
if ! command -v git >/dev/null 2>&1 || ! git --version >/dev/null 2>&1; then
  fail "Git is required. Install Git with Xcode Command Line Tools on macOS or your Linux package manager, then rerun this installer."
fi

umask 077
temporary_directory="$(mktemp -d "${TMPDIR:-/tmp}/wt-install.XXXXXX")" || fail "could not create a private temporary directory."
trap 'rm -rf "$temporary_directory"' EXIT

download_with_redirects() {
  node - "$1" "$2" "$3" <<'NODE'
const http = require("node:http");
const https = require("node:https");
const { unlinkSync, writeFileSync } = require("node:fs");

const [startUrl, destination, kind] = process.argv.slice(2);
const maxBytes = kind === "api" ? 1024 * 1024 : 10 * 1024 * 1024;
const cdnHosts = new Set(["objects.githubusercontent.com", "release-assets.githubusercontent.com", "github-releases.githubusercontent.com"]);
const initial = new URL(startUrl);
const isHttp = (url) => url.protocol === "http:" || url.protocol === "https:";
if (!isHttp(initial) || initial.username || initial.password || initial.hash) throw new Error("download URL is not a safe HTTP(S) URL");
if (kind === "api" && initial.hostname === "api.github.com" && initial.pathname !== "/repos/absolutepraya/wt/releases/latest") throw new Error("API URL is outside the expected wt release endpoint");
if (kind === "asset" && initial.hostname === "github.com" && !/^\/absolutepraya\/wt\/releases\/download\/v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\/(?:wt|wt\.sh|wt\.fish|checksums\.txt)$/.test(initial.pathname)) throw new Error("asset URL is outside the expected wt release path");
const loopbackHost = ["127.0.0.1", "localhost", "[::1]"].includes(initial.hostname);
const officialApi = initial.protocol === "https:" && !initial.port && initial.hostname === "api.github.com" && initial.pathname === "/repos/absolutepraya/wt/releases/latest" && !initial.search;
const officialAsset = initial.protocol === "https:" && !initial.port && initial.hostname === "github.com" && /^\/absolutepraya\/wt\/releases\/download\/v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\/(?:wt|wt\.sh|wt\.fish|checksums\.txt)$/.test(initial.pathname) && !initial.search;
if (!loopbackHost && !(kind === "api" ? officialApi : officialAsset)) throw new Error("initial download URL is not an approved GitHub endpoint or loopback fixture");
const sameReleaseUrl = (url) => url.protocol === initial.protocol && url.hostname === initial.hostname && url.port === initial.port && url.pathname === initial.pathname && url.search === initial.search;
const approvedCdnUrl = (url) => {
  const fixtureCdn = ["127.0.0.1", "localhost"].includes(initial.hostname) && url.protocol === initial.protocol && url.hostname === initial.hostname && url.port === initial.port;
  const officialCdn = url.protocol === "https:" && !url.port && cdnHosts.has(url.hostname);
  return (fixtureCdn || officialCdn) && url.pathname.startsWith("/github-production-release-asset/") && Boolean(url.searchParams.get("sig"));
};
function validateRedirect(url) {
  if (!isHttp(url) || url.username || url.password || url.hash) throw new Error("redirect has unsafe URL components");
  if (kind === "api") {
    if (!sameReleaseUrl(url)) throw new Error("API redirect left the expected release endpoint");
  } else if (!sameReleaseUrl(url) && !approvedCdnUrl(url)) {
    throw new Error("asset redirect left the expected release or approved CDN host");
  }
}
function request(url, redirectCount) {
  if (redirectCount > 5) return Promise.reject(new Error("redirect limit exceeded"));
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const pending = client.get(url, { headers: { "User-Agent": "wt-installer" } }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400) {
        const location = response.headers.location;
        response.resume();
        if (!location) { reject(new Error("redirect has no location")); return; }
        let next;
        try { next = new URL(location, url); validateRedirect(next); } catch (error) { reject(error); return; }
        request(next, redirectCount + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) { response.resume(); reject(new Error("HTTP " + response.statusCode)); return; }
      const chunks = [];
      let length = 0;
      response.on("data", (chunk) => {
        length += chunk.length;
        if (length > maxBytes) { response.destroy(new Error("response exceeds safety limit")); return; }
        chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => resolve(Buffer.concat(chunks)));
    });
    pending.on("error", reject);
  });
}
request(initial, 0).then((contents) => {
  writeFileSync(destination, contents, { flag: "wx", mode: 0o600 });
}, (error) => {
  try { unlinkSync(destination); } catch {}
  process.stderr.write("wt installer: " + (error instanceof Error ? error.message : "download failed") + "\n");
  process.exitCode = 1;
});
NODE
}

if [[ "$local_source" == 1 ]]; then
  release_version="$(node -p 'require(process.argv[1]).version' "$script_dir/package.json" 2>/dev/null)" || fail "could not read the local package version."
  [[ "$release_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "local package version is not a stable X.Y.Z version."
  release_tag="v$release_version"
else
  download_with_redirects "$WT_RELEASE_API_URL" "$temporary_directory/release.json" api || fail "could not fetch a stable wt release from $WT_RELEASE_API_URL."
  release_tag="$(
    node - "$temporary_directory/release.json" "$WT_RELEASE_DOWNLOAD_BASE_URL" <<'NODE'
const { readFileSync } = require("node:fs");
const [file, base] = process.argv.slice(2);
const payload = JSON.parse(readFileSync(file, "utf8"));
const releases = Array.isArray(payload) ? payload : [payload];
const required = new Set(["wt", "wt.sh", "wt.fish", "checksums.txt"]);
const stable = releases
  .filter((item) => item && typeof item === "object" && item.draft === false && item.prerelease === false && typeof item.tag_name === "string")
  .map((item) => ({ item, tag: item.tag_name, parts: /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(item.tag_name) }))
  .filter((item) => item.parts)
  .sort((a, b) => Number(b.parts[1]) - Number(a.parts[1]) || Number(b.parts[2]) - Number(a.parts[2]) || Number(b.parts[3]) - Number(a.parts[3]));
if (!stable[0] || !Array.isArray(stable[0].item.assets)) process.exit(2);
const assets = stable[0].item.assets;
const baseUrl = new URL(base.endsWith("/") ? base.slice(0, -1) : base);
for (const name of required) {
  const matches = assets.filter((asset) => asset && asset.name === name);
  if (matches.length !== 1 || typeof matches[0].browser_download_url !== "string") process.exit(3);
  const expected = new URL(baseUrl.href + "/" + stable[0].tag + "/" + name);
  if (matches[0].browser_download_url !== expected.href) process.exit(4);
}
process.stdout.write(stable[0].tag);
NODE
  )" || fail "could not resolve a stable wt release from $WT_RELEASE_API_URL."
  [[ "$release_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "release API did not return a stable vX.Y.Z tag."
  release_version="${release_tag#v}"
fi

for asset in wt wt.sh wt.fish checksums.txt; do
  target="$temporary_directory/$asset"
  if [[ "$local_source" == 1 ]]; then
    case "$asset" in
      wt) cp "$script_dir/dist/wt.cjs" "$target" ;;
      wt.sh) cp "$script_dir/shell/wt.sh" "$target" ;;
      wt.fish) cp "$script_dir/shell/wt.fish" "$target" ;;
      checksums.txt)
        node - "$temporary_directory" <<'NODE'
const { createHash } = require("node:crypto");
const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const dir = process.argv[2];
const lines = ["wt", "wt.sh", "wt.fish"].map(name => createHash("sha256").update(readFileSync(join(dir, name))).digest("hex") + "  " + name);
writeFileSync(join(dir, "checksums.txt"), lines.join("\n") + "\n", { mode: 0o600 });
NODE
        ;;
    esac
  else
    download_with_redirects "${WT_RELEASE_DOWNLOAD_BASE_URL%/}/$release_tag/$asset" "$target" asset || fail "could not download $asset for $release_tag."
  fi
done

node - "$temporary_directory" "$release_version" <<'NODE' || fail "downloaded release assets did not pass validation."
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const [dir, version] = process.argv.slice(2);
const sums = new Map();
for (const line of readFileSync(join(dir, "checksums.txt"), "utf8").split(/\r?\n/)) {
  if (!line.trim()) continue;
  const match = /^([a-fA-F0-9]{64})[ \t]+\*?([^\s\\/]+)$/.exec(line);
  if (!match || sums.has(match[2])) process.exit(2);
  sums.set(match[2], match[1].toLowerCase());
}
for (const name of ["wt", "wt.sh", "wt.fish"]) {
  const digest = createHash("sha256").update(readFileSync(join(dir, name))).digest("hex");
  if (sums.get(name) !== digest) process.exit(3);
}
const cli = readFileSync(join(dir, "wt"), "utf8");
if (!cli.startsWith("#!/usr/bin/env node\n") && !cli.startsWith("#!/usr/bin/env node\r\n")) process.exit(4);
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
if (!new RegExp("\\b(?:const|let|var)\\s+VERSION\\s*=\\s*[\\s\\S]{0,240}?[\"']" + escaped + "[\"']").test(cli)) process.exit(5);
NODE

mkdir -p "$PREFIX/bin" "$WT_CONFIG_DIR"
bin_directory="$(cd "$PREFIX/bin" && pwd -P)"
config_directory="$(cd "$WT_CONFIG_DIR" && pwd -P)"
destinations=("$bin_directory/wt" "$config_directory/wt.sh" "$config_directory/wt.fish" "$config_directory/install.json")
sources=("$temporary_directory/wt" "$temporary_directory/wt.sh" "$temporary_directory/wt.fish" "$temporary_directory/install.json")
node - "$temporary_directory/install.json" "${destinations[0]}" "${destinations[1]}" "${destinations[2]}" "$release_tag" <<'NODE'
const { writeFileSync } = require("node:fs");
const [file, binary, shell, fish, tag] = process.argv.slice(2);
const metadata = { channel: "standalone", binary, shell_wrapper: shell, fish_wrapper: fish, repository: "absolutepraya/wt", tag, installed_at: new Date().toISOString() };
writeFileSync(file, JSON.stringify(metadata, null, 2) + "\n", { mode: 0o600 });
NODE

stages=(); backups=(); installed=(); rollback_failed=0
remove_stages() {
  local i
  for i in "${!stages[@]}"; do
    [[ -n "${stages[i]:-}" && -e "${stages[i]}" ]] && rm -f "${stages[i]}" || true
  done
}
rollback() {
  local i
  rollback_failed=0
  for ((i=${#destinations[@]}-1; i>=0; i--)); do
    if [[ "${installed[i]:-0}" == 1 && -e "${destinations[i]}" ]]; then
      if ! rm -f "${destinations[i]}"; then rollback_failed=1; fi
    fi
    if [[ -n "${backups[i]:-}" && -e "${backups[i]}" ]]; then
      if [[ -e "${destinations[i]}" ]]; then
        rollback_failed=1
      elif ! mv "${backups[i]}" "${destinations[i]}"; then
        rollback_failed=1
      fi
    fi
  done
  remove_stages
  return "$rollback_failed"
}
install_files() {
  local i stage backup
  stages=(); backups=(); installed=(); rollback_failed=0
  for i in "${!destinations[@]}"; do
    if ! stage="$(mktemp "$(dirname "${destinations[i]}")/.wt-stage.$(basename "${destinations[i]}").XXXXXX")"; then
      remove_stages
      return 1
    fi
    if ! cp "${sources[i]}" "$stage"; then
      rm -f "$stage" || true
      remove_stages
      return 1
    fi
    if [[ "$i" == 0 ]]; then
      if ! chmod 0755 "$stage"; then
        remove_stages
        return 1
      fi
    elif ! chmod 0644 "$stage"; then
      remove_stages
      return 1
    fi
    stages[i]="$stage"
  done
  for i in "${!destinations[@]}"; do
    if [[ -e "${destinations[i]}" ]]; then
      backup="$(dirname "${destinations[i]}")/.wt-backup.$(basename "${destinations[i]}").$$.$i"
      if ! mv "${destinations[i]}" "$backup"; then
        rollback
        return 1
      fi
      backups[i]="$backup"
    fi
    if ! mv "${stages[i]}" "${destinations[i]}"; then
      rollback
      return 1
    fi
    stages[i]=""
    installed[i]=1
  done
}
if ! install_files; then
  if (( rollback_failed )); then
    fail "could not install release files atomically; rollback artifacts were retained for recovery."
  fi
  fail "could not install release files atomically; the previous installation was restored."
fi

binary="${destinations[0]}"
if ! "$binary" --version >/dev/null 2>&1 || ! "$binary" --help >/dev/null 2>&1; then
  rollback || true
  if (( rollback_failed )); then
    fail "installed wt failed its version/help smoke; rollback artifacts were retained for recovery."
  fi
  fail "installed wt failed its version/help smoke; the previous installation was restored."
fi
for backup in "${backups[@]:-}"; do
  [[ -z "$backup" || ! -e "$backup" ]] || rm -f "$backup" || echo "wt installer: warning: could not remove rollback artifact $backup" >&2
done

managed_block() {
  local profile="$1" body="$2"
  mkdir -p "$(dirname "$profile")"
  node - "$profile" "$body" <<'NODE'
const { existsSync, lstatSync, mkdtempSync, readFileSync, renameSync, rmdirSync, writeFileSync } = require("node:fs");
const { basename, dirname, join } = require("node:path");
const [profile, body] = process.argv.slice(2);
const begin = "# wt-managed: BEGIN", end = "# wt-managed: END", block = begin + "\n" + body + "\n" + end + "\n";
const text = existsSync(profile) ? readFileSync(profile, "utf8") : "";
function removeStagingDirectory(stagingDirectory, ownership) {
  try {
    const current = lstatSync(stagingDirectory);
    if (!current.isDirectory() || current.dev !== ownership.dev || current.ino !== ownership.ino) return;
    rmdirSync(stagingDirectory);
  } catch (error) {
    if (!error || !["ENOENT", "ENOTDIR", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error;
  }
}
function replaceProfile(next) {
  const stagingDirectory = mkdtempSync(join(dirname(profile), "." + basename(profile) + ".wt-managed-"));
  const ownership = lstatSync(stagingDirectory);
  const temporary = join(stagingDirectory, "profile");
  try {
    writeFileSync(temporary, next, { flag: "wx", mode: 0o600 });
    renameSync(temporary, profile);
  } finally {
    removeStagingDirectory(stagingDirectory, ownership);
  }
}
const beginMatches = [...text.matchAll(/^# wt-managed: BEGIN$/gm)];
const endMatches = [...text.matchAll(/^# wt-managed: END$/gm)];
if (beginMatches.length === 0 && endMatches.length === 0) {
  const next = text + (text && !text.endsWith("\n") ? "\n" : "") + "\n" + block;
  replaceProfile(next);
  process.exit(0);
}
if (beginMatches.length !== 1 || endMatches.length !== 1 || beginMatches[0].index > endMatches[0].index) {
  process.stderr.write("wt installer: malformed managed block in " + profile + "\n");
  process.exit(1);
}
const start = beginMatches[0].index, finish = endMatches[0].index;
const next = text.slice(0, start) + block + text.slice(finish + end.length).replace(/^\n/, "");
replaceProfile(next);
NODE
}

quote_path() {
  node - "$1" "$2" <<'NODE'
const [style, value] = process.argv.slice(2);
if (style === "posix") {
  process.stdout.write("'" + value.split("'").join("'\\'" + "'") + "'");
} else if (style === "fish") {
  process.stdout.write("'" + value.split("\\").join("\\\\").split("'").join("\\'") + "'");
} else {
  process.exit(1);
}
NODE
}

# npm does not call this installer. This installer never edits a PowerShell profile.
fish_root="${XDG_CONFIG_HOME:-${HOME}/.config}"
fish_profile="$fish_root/fish/conf.d/wt.fish"
posix_wrapper="$(quote_path posix "${destinations[1]}")"
fish_wrapper="$(quote_path fish "${destinations[2]}")"
posix_binary="$(quote_path posix "${destinations[0]}")"
fish_binary="$(quote_path fish "${destinations[0]}")"
posix_bin_directory="$(quote_path posix "$bin_directory")"
posix_fish_profile="$(quote_path posix "$fish_profile")"
if ! managed_block "$HOME/.bashrc" "[ -f $posix_wrapper ] && source $posix_wrapper"; then echo "wt installer: warning: could not update $HOME/.bashrc" >&2; fi
if ! managed_block "$HOME/.zshrc" "[ -f $posix_wrapper ] && source $posix_wrapper"; then echo "wt installer: warning: could not update $HOME/.zshrc" >&2; fi
if ! managed_block "$fish_profile" "source $fish_wrapper"; then echo "wt installer: warning: could not update Fish integration" >&2; fi

cat <<EOF

wt installed from $WT_REPOSITORY $release_tag.

Immediate use:       $posix_binary --version
PATH:                add $posix_bin_directory to PATH, then open a new shell if needed.
Future Bash/Zsh:     managed wrapper blocks were added to ~/.bashrc and ~/.zshrc.
Future Fish:         managed wrapper block was added to $posix_fish_profile.
Current shell cd:    after PATH setup, eval "\$($posix_binary shell-init bash)" (or "$fish_binary shell-init fish | source" in Fish).
PowerShell:          add 'Invoke-Expression (& wt shell-init powershell)' to your profile yourself; this installer never edits it.
EOF
