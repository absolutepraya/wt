# wt

A universal git worktree CLI for fast, parallel feature work.

`wt` lets you spin up multiple isolated checkouts of the same repo with one command. Each worktree gets a unique name, a numbered slot, an optional port offset for local services, and runs your project's setup script automatically. Removing a worktree runs teardown, cleans up the branch, and frees the slot.

Single-file Python script. Stdlib only. No runtime dependencies beyond `git` and Python 3.11+.

## Why

If you're juggling several feature branches, you've probably hit the friction of `git stash`, `git checkout`, re-running migrations, restarting your dev server, dealing with port conflicts between branches. Worktrees solve the "one checkout per branch" half of this. `wt` solves the other half: per-branch infra setup/teardown, port allocation, and a discoverable interface.

## Install

### One-liner (macOS / Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/absolutepraya/wt/main/install.sh | bash
```

This installs:

- `~/.local/bin/wt` — the script
- `~/.config/wt/wt.sh` — the shell wrapper (sourced from your `~/.zshrc` / `~/.bashrc`)

Open a new shell or `source ~/.zshrc` to pick up the wrapper.

### From source

```bash
git clone https://github.com/absolutepraya/wt ~/Documents/Projects/wt
cd ~/Documents/Projects/wt
./install.sh
```

### Fish shell

Add to `~/.config/fish/config.fish`:

```fish
source ~/.config/wt/wt.fish
```

Then download the fish wrapper:

```bash
curl -fsSL https://raw.githubusercontent.com/absolutepraya/wt/main/shell/wt.fish -o ~/.config/wt/wt.fish
```

### Requirements

- Python 3.11 or newer (uses `tomllib`)
- `git` 2.5+ (worktree support)
- bash, zsh, or fish

## Quick start

In a git repo:

```bash
# Drop a minimal config (one-time)
mkdir -p .wt && cat > .wt/config.toml <<'EOF'
worktree_path = ".worktrees"
port_offset_interval = 100
max_slots = 9
EOF

# Create your first worktree
wt new
```

## Commands

```
wt new                          # auto-named worktree off origin/main, runs setup, auto-cd
wt new my-fix                   # explicit worktree name
wt new -b you/feat/X-123        # explicit branch (auto dir name)
wt new my-fix -b you/feat/X-123 # explicit name + branch
wt new --from feature-x         # check out an existing remote branch (review workflow)
wt new --skip-setup             # create the worktree but skip the project's setup script

wt ls                           # list worktrees with slot/name/branch/path/ports
wt cd                           # cd to the main worktree
wt cd <name>                    # cd to an existing worktree

wt rm <name>                    # teardown + remove + free slot + delete branch
wt rm <name> --force            # bypass dirty / unmerged checks
wt rm <name> --keep-branch      # keep the branch when removing the worktree
```

Run `wt <command> -h` for full per-command help.

## What it looks like

### `wt ls`

The worktree you're currently inside is marked with a green `✓` next to its slot number. Worktrees git knows about but `wt` doesn't manage are listed in a separate section.

```
╔══════╤═════════════╤═══════════════════════╤════════════════════════╤═══════╗
║ SLOT │ NAME        │ BRANCH                │ PATH                   │ PORTS ║
╟──────┼─────────────┼───────────────────────┼────────────────────────┼───────╢
║ 0    │ (main)      │ main                  │ .                      │ base  ║
║ 1    │ paris       │ you/eng-415-runtime   │ .worktrees/paris       │ +100  ║
║ 2 ✓  │ strasbourg  │ you/merchant-mgmt     │ .worktrees/strasbourg  │ +200  ║
║ 3    │ new-orleans │ you/mobile-ui-polish  │ .worktrees/new-orleans │ +300  ║
╠══════╧═════════════╧═══════════════════════╧════════════════════════╧═══════╣
║                              Unmanaged worktrees                            ║
╠══════╤═════════════╤═══════════════════════╤════════════════════════╤═══════╣
║      │             │ you/old-experiment    │ .worktrees/auckland    │       ║
╚══════╧═════════════╧═══════════════════════╧════════════════════════╧═══════╝
```

### `wt new`

Creates the worktree, prints a status block, then runs each `setup` command from `.wt/config.toml` in order — every step gets its own divider and `[i/N]` label so you can tell which one's running.

```
$ wt new
══════════════════════════════════════════════════════════════════
Creating worktree
  name    rotterdam
  branch  you/rotterdam
  base    origin/main
  path    /home/you/code/myrepo/.worktrees/rotterdam
  slot    3
══════════════════════════════════════════════════════════════════
[1/3] setup: pnpm install --frozen-lockfile

Lockfile is up to date, resolution step is skipped
Packages: +1247
...
Done in 12.3s

══════════════════════════════════════════════════════════════════
[2/3] setup: cp .env.example .env.local

══════════════════════════════════════════════════════════════════
[3/3] setup: bash scripts/start-infra.sh

🐳 Starting Postgres on port 5732 (base 5432 + offset 300)…
🐳 Starting Redis on port 6679 (base 6379 + offset 300)…
✓ Infra ready

══════════════════════════════════════════════════════════════════
Created worktree: rotterdam
  branch  you/rotterdam
  base    origin/main
  path    /home/you/code/myrepo/.worktrees/rotterdam
  slot    3 (port offset +300 to +399)
══════════════════════════════════════════════════════════════════
```

After this, your shell is `cd`'d into `.worktrees/rotterdam` automatically.

### `wt rm`

Symmetric to `wt new`: runs every `teardown` command, then removes the worktree, deletes the branch, and frees the slot.

```
$ wt rm rotterdam
══════════════════════════════════════════════════════════════════
Removing worktree
  name    rotterdam
  branch  you/rotterdam
  path    /home/you/code/myrepo/.worktrees/rotterdam
  slot    3
══════════════════════════════════════════════════════════════════
[1/2] teardown: docker compose -p rotterdam down

[+] Running 3/3
 ✔ Container rotterdam-redis-1     Removed
 ✔ Container rotterdam-postgres-1  Removed
 ✔ Network  rotterdam_default      Removed

══════════════════════════════════════════════════════════════════
[2/2] teardown: docker network prune -f

Deleted Networks:
rotterdam_default

══════════════════════════════════════════════════════════════════
Removed worktree: rotterdam
  branch  you/rotterdam
  path    /home/you/code/myrepo/.worktrees/rotterdam
  slot    3 (freed)
══════════════════════════════════════════════════════════════════
```

If the branch has unmerged commits not in `origin/main` and not pushed anywhere, `wt rm` prompts before deleting — pass `--force` to skip the prompt or `--keep-branch` to remove the worktree but keep the branch.

## Configuration

Per-project config lives at `<repo>/.wt/config.toml`:

```toml
# Where worktrees go (relative to repo root).
worktree_path = ".worktrees"

# Each non-main worktree gets a slot 1..max_slots and a port offset
# of `slot * port_offset_interval`. Slot 1 → +100, slot 2 → +200, etc.
# Pick an interval larger than the number of ports any single worktree
# needs — 100 is a sensible default.
port_offset_interval = 100
max_slots = 9

# Optional: auto-naming strategy. Defaults to "cities".
#   "cities"     → paris, strasbourg, new-orleans, kyoto, ...
#   "word_pairs" → curious-otter, brave-spruce, ...
name_strategy = "cities"

# Optional: branch name template for `wt new` (no -b given).
# Placeholders: {name} (worktree dir name), {user} ($USER), {date} (YYYY-MM-DD).
branch_template = "{user}/{name}"

# Optional: base ref for new branches. Default "origin/main".
default_base = "origin/main"

# Optional: commands run on `wt new`, in order. Each one gets a
# divider and a "[i/N] setup: <cmd>" label in the output.
setup = [
  "pnpm install --frozen-lockfile",
  "cp .env.example .env.local",
  "bash scripts/start-infra.sh",
]

# Optional: commands run on `wt rm`, in order.
teardown = [
  "docker compose -p ${WT_WORKSPACE_NAME} down",
  "docker network prune -f",
]
```

### Per-worktree environment variables

Every `setup` and `teardown` command runs with these env vars set, so your scripts can derive ports, project names, etc. without hardcoding:

| Variable             | Example                                  |
| -------------------- | ---------------------------------------- |
| `WT_ROOT_PATH`       | `/home/you/code/myrepo`                  |
| `WT_WORKSPACE_NAME`  | `rotterdam`                              |
| `WT_WORKSPACE_PATH`  | `/home/you/code/myrepo/.worktrees/rotterdam` |
| `WT_BRANCH`          | `you/rotterdam`                          |
| `WT_SLOT`            | `3`                                      |
| `WT_PORT_BASE`       | `300` (= slot × `port_offset_interval`)  |

Example: bind your Postgres to `$((5432 + WT_PORT_BASE))` in your start-infra script and every worktree gets its own non-colliding port.

## Safety

- **Dirty worktree**: `wt rm` prompts unless `--force` is given.
- **Unmerged commits**: `wt rm` prompts if the branch has commits not in `origin/main` and not pushed to a remote.
- **cwd inside target**: `wt rm` refuses if you're sitting in the worktree you're trying to remove (so your shell doesn't end up in a phantom directory).
- **Partial setup failure**: if a `setup` command fails (or you Ctrl-C mid-setup), the worktree is rolled back automatically — no half-baked directories.
- **Concurrent `wt new`**: name + slot allocation happens under an `flock`, so two parallel calls can't pick the same slot or name.
- **Live branch detection**: `wt rm` checks the branch actually checked out in the worktree right now, not whatever `wt new` originally created — so checking out a different branch into a worktree and then removing it still cleans up the right ref.

## How it works (one paragraph)

`wt` is a thin layer over `git worktree`. It keeps a per-project state file under `~/.wt/<project-id>/state.json` mapping slots to worktrees, and uses `flock` for concurrency. `wt new` does `git fetch` → reserve a slot → `git worktree add` → run setup. `wt rm` runs teardown → safety checks → `git worktree remove` → `git branch -D` → free the slot. `wt cd` and `wt new` print a `__cd__:<path>` sentinel line that the shell wrapper consumes to actually `cd` your shell.

## For AI coding agents

If you use Claude Code, Codex, Cursor, OpenCode, or a similar agent, this repo ships an Agent Skill at `skills/wt/SKILL.md` that teaches the agent how and when to use `wt` instead of raw `git worktree add`.

To install it:

```bash
# Pick one — wherever your agent reads skills from
mkdir -p ~/.claude/skills && ln -s "$PWD/skills/wt" ~/.claude/skills/wt              # Claude Code
mkdir -p ~/.config/opencode/skills && ln -s "$PWD/skills/wt" ~/.config/opencode/skills/wt   # OpenCode
mkdir -p ~/.codex/skills && ln -s "$PWD/skills/wt" ~/.codex/skills/wt                # Codex
mkdir -p ~/.cursor/skills && ln -s "$PWD/skills/wt" ~/.cursor/skills/wt              # Cursor
```

Or just copy the directory into your agent's skill folder. After that, ask your agent "create a worktree for X" — it'll invoke the `wt` skill and use the CLI correctly (config check, safety prompts, env vars passed to setup scripts, etc.).

## Development

```bash
git clone https://github.com/absolutepraya/wt
cd wt
pip install pytest pytest-mock
pytest tests/
```

Tests use real git repos (no mocks for `git`) and run on Python 3.11, 3.12, and 3.13 across macOS and Linux in CI.

## License

[MIT](LICENSE)
