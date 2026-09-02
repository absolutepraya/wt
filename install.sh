#!/usr/bin/env bash
# install.sh — bootstrap `wt` on macOS or Linux.
#
# Two usage modes:
#   1. Remote (curl|sh):
#        curl -sSL https://raw.githubusercontent.com/absolutepraya/wt/main/install.sh | sh
#      Downloads bin/wt and all shell wrappers from the main branch (override with
#      WT_REF=<branch|tag|sha>).
#
#   2. Local: run from a checked-out repo:
#        ./install.sh
#      Uses files from the current checkout, no network needed.
#
# What it does:
#   - Installs the `wt` script to $PREFIX/bin/wt (default ~/.local/bin/wt).
#   - Installs shell wrappers to $WT_CONFIG_DIR (default ~/.config/wt/).
#   - Idempotently appends a `source` line to ~/.zshrc and ~/.bashrc between
#     "# wt-managed: BEGIN" / "# wt-managed: END" markers.
#
# Override anything via env vars: PREFIX, WT_CONFIG_DIR, WT_REPO, WT_REF.

set -euo pipefail

PREFIX="${PREFIX:-$HOME/.local}"
WT_CONFIG_DIR="${WT_CONFIG_DIR:-$HOME/.config/wt}"
WT_REPO="${WT_REPO:-absolutepraya/wt}"
WT_REF="${WT_REF:-main}"

BIN_DEST="$PREFIX/bin/wt"
SHELL_DEST="$WT_CONFIG_DIR/wt.sh"
FISH_DEST="$WT_CONFIG_DIR/wt.fish"

# Detect whether we're running from a checked-out repo or a piped curl.
script_dir=""
if [ -n "${BASH_SOURCE-}" ] && [ -f "${BASH_SOURCE[0]-}" ]; then
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
elif [ -n "${0-}" ] && [ -f "$0" ]; then
  script_dir="$(cd "$(dirname "$0")" && pwd)"
fi

is_local=0
if [ -n "$script_dir" ] && [ -f "$script_dir/bin/wt" ] \
  && [ -f "$script_dir/shell/wt.sh" ] && [ -f "$script_dir/shell/wt.fish" ]; then
  is_local=1
fi

fetch() {
  # fetch <relative-path> <dest>
  local rel="$1" dest="$2"
  if [ "$is_local" = "1" ]; then
    cp "$script_dir/$rel" "$dest"
    return
  fi
  local url="https://raw.githubusercontent.com/$WT_REPO/$WT_REF/$rel"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$dest"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$dest" "$url"
  else
    echo "error: neither curl nor wget is available" >&2
    exit 1
  fi
}

# Python check (the script needs 3.11+ for tomllib).
if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 is required (3.11 or newer)" >&2
  exit 1
fi
py_ver="$(python3 -c 'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")')"
py_major="${py_ver%.*}"
py_minor="${py_ver#*.}"
if [ "$py_major" -lt 3 ] || { [ "$py_major" -eq 3 ] && [ "$py_minor" -lt 11 ]; }; then
  echo "error: python3 $py_ver found; wt needs 3.11 or newer (uses tomllib)" >&2
  exit 1
fi

mkdir -p "$(dirname "$BIN_DEST")" "$WT_CONFIG_DIR"

fetch bin/wt "$BIN_DEST"
chmod +x "$BIN_DEST"
echo "Installed: $BIN_DEST"

fetch shell/wt.sh "$SHELL_DEST"
echo "Installed: $SHELL_DEST"

fetch shell/wt.fish "$FISH_DEST"
echo "Installed: $FISH_DEST"

# Record the installed paths so `wt update` can update the same standalone
# installation later, including installations that use a custom prefix.
INSTALL_METADATA="$WT_CONFIG_DIR/install.json"
python3 - "$INSTALL_METADATA" "$BIN_DEST" "$SHELL_DEST" "$FISH_DEST" <<'PY'
import json
import os
import sys
from pathlib import Path

metadata_path = Path(sys.argv[1])
metadata_path.parent.mkdir(parents=True, exist_ok=True)
temporary_path = metadata_path.with_name(
    f".{metadata_path.name}.tmp.{os.getpid()}"
)
temporary_path.write_text(
    json.dumps(
        {
            "channel": "standalone",
            "binary": str(Path(sys.argv[2]).expanduser().resolve()),
            "shell_wrapper": str(Path(sys.argv[3]).expanduser().resolve()),
            "fish_wrapper": str(Path(sys.argv[4]).expanduser().resolve()),
        },
        indent=2,
    )
    + "\n"
)
os.replace(temporary_path, metadata_path)
PY
echo "Recorded install metadata: $INSTALL_METADATA"

# Inject `source` line between markers in shell rc files.
inject_source_line() {
  local rc="$1"
  [ -f "$rc" ] || touch "$rc"
  local begin="# wt-managed: BEGIN"
  local end="# wt-managed: END"
  local block
  block=$(printf '%s\n[ -f "%s" ] && source "%s"\n%s\n' "$begin" "$SHELL_DEST" "$SHELL_DEST" "$end")
  if grep -q "^$begin\$" "$rc"; then
    python3 - "$rc" "$block" <<'PY'
import re, sys
rc_path, block = sys.argv[1], sys.argv[2]
with open(rc_path) as f: text = f.read()
new = re.sub(
    r"# wt-managed: BEGIN.*?# wt-managed: END",
    lambda _m: block,
    text,
    flags=re.DOTALL,
)
with open(rc_path, "w") as f: f.write(new)
PY
    echo "Updated wt-managed block in $rc"
  else
    printf '\n%s\n' "$block" >> "$rc"
    echo "Appended wt-managed block to $rc"
  fi
}

for rc in "$HOME/.zshrc" "$HOME/.bashrc"; do
  inject_source_line "$rc"
done

cat <<EOF

✓ wt installed.

  Binary:        $BIN_DEST
  Shell wrapper: $SHELL_DEST
  Fish wrapper:  $FISH_DEST

Make sure $PREFIX/bin is on your PATH, then open a new shell or run:
  source ~/.zshrc       # zsh
  source ~/.bashrc      # bash

For fish, add this line to your fish config:
  source $FISH_DEST

Get started:
  cd ~/your-repo
  wt --help
EOF
