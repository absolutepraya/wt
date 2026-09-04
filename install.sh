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
if command -v curl >/dev/null 2>&1; then downloader=curl
elif command -v wget >/dev/null 2>&1; then downloader=wget
else fail "curl or wget is required to download release assets. Install curl with your macOS/Linux package manager."; fi
command -v node >/dev/null 2>&1 || fail "Node.js 18 or newer is required. Install Node.js 18+ from https://nodejs.org/ and rerun this installer."
node_version="$(node -p 'process.versions.node' 2>/dev/null || true)"
[[ "$node_version" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || fail "could not determine the installed Node.js version; Node.js 18 or newer is required."
(( BASH_REMATCH[1] >= 18 )) || fail "Node.js $node_version found; wt requires Node.js 18 or newer. Install a supported Node.js release and rerun this installer."
command -v git >/dev/null 2>&1 && git --version >/dev/null 2>&1 || fail "Git is required. Install Git with Xcode Command Line Tools on macOS or your Linux package manager, then rerun this installer."

fetch_to() {
  if [[ "$downloader" == curl ]]; then curl -fsSL "$1" -o "$2"
  else wget -qO "$2" "$1"; fi
}

if [[ "$local_source" == 1 ]]; then
  release_version="$(node -p 'require(process.argv[1]).version' "$script_dir/package.json" 2>/dev/null)" || fail "could not read the local package version."
  [[ "$release_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "local package version is not a stable X.Y.Z version."
  release_tag="v$release_version"
else
  release_tag="$(
    if [[ "$downloader" == curl ]]; then curl -fsSL "$WT_RELEASE_API_URL"; else wget -qO- "$WT_RELEASE_API_URL"; fi |
      node -e '
        let input = ""; process.stdin.setEncoding("utf8");
        process.stdin.on("data", part => input += part);
        process.stdin.on("end", () => {
          let payload; try { payload = JSON.parse(input); } catch { process.exit(2); }
          const all = Array.isArray(payload) ? payload : [payload];
          const stable = all.filter(item => item && typeof item === "object" && item.draft === false && item.prerelease === false && typeof item.tag_name === "string")
            .map(item => ({ tag: item.tag_name, parts: /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(item.tag_name) }))
            .filter(item => item.parts)
            .sort((a,b) => Number(b.parts[1])-Number(a.parts[1]) || Number(b.parts[2])-Number(a.parts[2]) || Number(b.parts[3])-Number(a.parts[3]));
          if (!stable[0]) process.exit(3);
          process.stdout.write(stable[0].tag);
        });
      '
  )" || fail "could not resolve a stable wt release from $WT_RELEASE_API_URL."
  [[ "$release_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "release API did not return a stable vX.Y.Z tag."
  release_version="${release_tag#v}"
fi

# All prerequisites and release selection are complete before final directories,
# files, or profiles are changed.
umask 077
temporary_directory="$(mktemp -d "${TMPDIR:-/tmp}/wt-install.XXXXXX")" || fail "could not create a private temporary directory."
trap 'rm -rf "$temporary_directory"' EXIT

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
    fetch_to "${WT_RELEASE_DOWNLOAD_BASE_URL%/}/$release_tag/$asset" "$target" || fail "could not download $asset for $release_tag."
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

stages=(); backups=(); installed=()
rollback() {
  local i
  for ((i=${#destinations[@]}-1; i>=0; i--)); do
    [[ "${installed[i]:-0}" == 1 && -e "${destinations[i]}" ]] && rm -f "${destinations[i]}" || true
    [[ -n "${backups[i]:-}" && -e "${backups[i]}" ]] && mv "${backups[i]}" "${destinations[i]}" || true
    [[ -n "${stages[i]:-}" && -e "${stages[i]}" ]] && rm -f "${stages[i]}" || true
  done
}
for i in "${!destinations[@]}"; do
  stage="$(mktemp "$(dirname "${destinations[i]}")/.wt-stage.$(basename "${destinations[i]}").XXXXXX")"
  cp "${sources[i]}" "$stage"
  [[ "$i" == 0 ]] && chmod 0755 "$stage" || chmod 0644 "$stage"
  stages[i]="$stage"
done
if ! {
  for i in "${!destinations[@]}"; do
    if [[ -e "${destinations[i]}" ]]; then
      backups[i]="$(dirname "${destinations[i]}")/.wt-backup.$(basename "${destinations[i]}").$$.$i"
      mv "${destinations[i]}" "${backups[i]}"
    fi
    mv "${stages[i]}" "${destinations[i]}"
    stages[i]=""; installed[i]=1
  done
}; then
  rollback
  fail "could not install release files atomically; the previous installation was restored."
fi
for backup in "${backups[@]:-}"; do [[ -z "$backup" || ! -e "$backup" ]] || rm -f "$backup"; done

managed_block() {
  local profile="$1" body="$2"
  mkdir -p "$(dirname "$profile")"
  node - "$profile" "$body" <<'NODE'
const { existsSync, readFileSync, renameSync, writeFileSync } = require("node:fs");
const { basename, dirname, join } = require("node:path");
const [profile, body] = process.argv.slice(2);
const begin = "# wt-managed: BEGIN", end = "# wt-managed: END", block = begin + "\n" + body + "\n" + end + "\n";
const text = existsSync(profile) ? readFileSync(profile, "utf8") : "";
const start = text.indexOf(begin), finish = start < 0 ? -1 : text.indexOf(end, start);
const next = start < 0 ? text + (text && !text.endsWith("\n") ? "\n" : "") + "\n" + block : text.slice(0, start) + block + text.slice(finish < 0 ? text.length : finish + end.length).replace(/^\n/, "");
const temporary = join(dirname(profile), "." + basename(profile) + ".wt-managed-" + process.pid);
writeFileSync(temporary, next, { mode: 0o600 }); renameSync(temporary, profile);
NODE
}

# npm does not call this installer. This installer never edits a PowerShell profile.
shell_wrapper="${destinations[1]}"
if ! managed_block "$HOME/.bashrc" "[ -f \"$shell_wrapper\" ] && source \"$shell_wrapper\""; then echo "wt installer: warning: could not update $HOME/.bashrc" >&2; fi
if ! managed_block "$HOME/.zshrc" "[ -f \"$shell_wrapper\" ] && source \"$shell_wrapper\""; then echo "wt installer: warning: could not update $HOME/.zshrc" >&2; fi
fish_root="${XDG_CONFIG_HOME:-${HOME}/.config}"
if ! managed_block "$fish_root/fish/conf.d/wt.fish" "source \"${destinations[2]}\""; then echo "wt installer: warning: could not update Fish integration" >&2; fi

cat <<EOF

wt installed from $WT_REPOSITORY $release_tag.

Immediate use:       ${destinations[0]} --version
PATH:                add $bin_directory to PATH, then open a new shell if needed.
Future Bash/Zsh:     managed wrapper blocks were added to ~/.bashrc and ~/.zshrc.
Future Fish:         managed wrapper block was added to $fish_root/fish/conf.d/wt.fish.
Current shell cd:    eval "\$(wt shell-init bash)" (or "wt shell-init fish | source" in Fish).
PowerShell:          add 'Invoke-Expression (& wt shell-init powershell)' to your profile yourself; this installer never edits it.
EOF
