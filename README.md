# wt

[![CI](https://github.com/absolutepraya/wt/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/absolutepraya/wt/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40absolutepraya%2Fwt?logo=npm)](https://www.npmjs.com/package/@absolutepraya/wt)
[![npm downloads](https://img.shields.io/npm/dm/%40absolutepraya%2Fwt?logo=npm)](https://www.npmjs.com/package/@absolutepraya/wt)
[![GitHub Release](https://img.shields.io/github/v/release/absolutepraya/wt?display_name=tag&sort=semver)](https://github.com/absolutepraya/wt/releases)
[![Node.js 18+](https://img.shields.io/badge/node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/github/license/absolutepraya/wt)](LICENSE)

WT is an agent-first Git worktree manager for LLM agents. It lets several agents work concurrently on the same project through one unified worktree manager, regardless of which coding agent you use. Switch between Claude Code, Codex, Cursor, OpenCode, or another agent without changing the project's worktree workflow.

Each agent gets a named, isolated worktree while WT handles branch creation, project setup and teardown, slot allocation, port offsets, and safe cleanup. WT also works well for human-led parallel feature work.

## Why WT

Git worktrees solve the one-checkout-per-branch problem. WT also gives each
worktree repeatable setup and teardown, a reserved slot, predictable port
offsets, and a discoverable list of managed and unmanaged worktrees. That
keeps several agents from competing over one checkout, one dependency setup,
or one development port.

## Install

WT has one Node.js CLI and three supported distribution modes. All modes require Node.js 18 or newer and Git.

### Standalone installer, macOS or Linux

```bash
curl -fsSL https://github.com/absolutepraya/wt/releases/latest/download/install.sh | bash
```

The release-based installer downloads the latest stable release, verifies the SHA-256 manifest and the embedded CLI version, then installs atomically. It installs:

- `~/.local/bin/wt`, the executable
- `~/.config/wt/wt.sh`, the Bash and Zsh wrapper
- `~/.config/wt/wt.fish`, the Fish wrapper
- `~/.config/wt/install.json`, standalone channel metadata

The installer adds managed wrapper blocks to Bash, Zsh, and Fish startup files. The executable is available immediately at `~/.local/bin/wt` even if that directory is not yet in `PATH`. Future interactive shells that source the relevant rc or config file will load the integration. Bash login shells may not source `~/.bashrc` automatically, so use your shell's normal login configuration or source the wrapper explicitly. For the current shell, add the directory to `PATH` and evaluate the shell initializer as shown below.

The installer checks the platform, Node.js, Git, and downloader prerequisites
before writing the destination files. If Node.js or Git is missing, it stops
with an actionable message and does not install a partial CLI.

The standalone installer supports macOS and Linux. Windows users should use the npm installation, which supports the CLI and shell initializer on Windows.

### Global npm install

```bash
npm install -g @absolutepraya/wt
wt --help
```

This puts the `wt` executable in npm's global bin directory. It does not edit Bash, Zsh, Fish, or PowerShell profiles. Use npm to update it:

```bash
npm update -g @absolutepraya/wt
```

### Project-local npm install

```bash
npm install -D @absolutepraya/wt
npx --no-install wt --help
```

The consuming project's lockfile pins WT for agents and npm scripts. The local package does not edit shell profiles. Use npm to update it:

```bash
npm update -D @absolutepraya/wt
```

The global and local npm packages use the same bundled `dist/wt.cjs` artifact as the standalone release. npm installs support macOS, Linux, and Windows for the core commands.

### From source

```bash
git clone https://github.com/absolutepraya/wt ~/Documents/Projects/wt
cd ~/Documents/Projects/wt
npm ci
npm run build
node dist/wt.cjs --help
```

Source checkouts are updated through Git, for example with `git pull --ff-only` after reviewing the incoming changes. `wt update` does not modify a source checkout.

### Requirements and paths

- Node.js 18 or newer
- Git 2.5 or newer, with worktree support
- macOS or Linux for the standalone installer
- macOS, Linux, or Windows for npm installations

Standalone files default to `~/.local/bin` and `~/.config/wt`. Set `PREFIX` or `WT_CONFIG_DIR` for a different standalone location. Project state is kept outside the repository at `~/.wt/<project-id>.json`, with a matching lock path. No npm package installation creates or changes a project's shell profile.

## Shell integration

`wt shell-init` prints the integration for the current shell. It does not edit any profile. The initializer is useful immediately after installation and when a shell uses a custom profile path.

### Bash

```bash
eval "$(~/.local/bin/wt shell-init bash)"
```

To load it in future shells, source the generated wrapper from a profile:

```bash
source ~/.config/wt/wt.sh
```

### Zsh

```zsh
eval "$(~/.local/bin/wt shell-init zsh)"
```

The Bash and Zsh initializer output is shell-compatible. A future Zsh can source the same wrapper:

```zsh
source ~/.config/wt/wt.sh
```

### Fish

```fish
~/.local/bin/wt shell-init fish | source
```

For future Fish shells:

```fish
source ~/.config/wt/wt.fish
```

### PowerShell

```powershell
Invoke-Expression (& wt shell-init powershell)
```

Add that line to the PowerShell profile yourself if it should load in future sessions. WT never edits a PowerShell profile automatically.

The shell wrapper consumes WT's `__cd__:<path>` navigation sentinel for `wt new --cd` and `wt cd`. A child process cannot change the working directory of its parent shell, so running a raw executable as a subprocess cannot navigate the calling shell. Coding agents should use `wt new` without `--cd`, then use the absolute worktree path printed by WT for subsequent commands.

## Quick start

In a Git repository, create `.wt/config.toml` once if the project is not already configured:

```bash
mkdir -p .wt
cat > .wt/config.toml <<'EOF'
worktree_path = ".worktrees"
port_offset_interval = 100
max_slots = 9
EOF

wt new
```

## Commands

```text
wt --version, -V                print the installed WT version
wt --help, -h                   show top-level help

wt new                          create a worktree from origin/main
wt new [name]                   choose a worktree name
wt new -b user/feature          choose the branch name
wt new --from feature-x         base on an existing remote branch
wt new --no-setup               skip configured setup commands
wt new --skip-setup             alias for --no-setup
wt new --cd                     navigate the interactive shell after creation

wt ls                           list managed and unmanaged Git worktrees
wt list                         alias for ls
wt cd                           print the current or main worktree path
wt cd <name>                    print a named worktree path

wt rm <name>                    run teardown and remove the worktree
wt remove <name>                alias for rm
wt rm <name> --force            bypass dirty, unmerged, and teardown failures
wt rm <name> --keep-branch      remove the worktree but preserve its branch

wt update                       update a standalone installation
wt update --check               check the latest stable release for standalone installs
wt shell-init bash              print Bash integration
wt shell-init zsh               print Zsh integration
wt shell-init fish              print Fish integration
wt shell-init powershell        print PowerShell integration
```

Run `wt <command> --help` or `wt <command> -h` for command-specific usage.
`wt new` stays in the current directory unless its shell wrapper receives
`--cd`. `wt update` is only a self-mutating command for a standalone
installation. For a standalone install, `wt update --check` checks the latest
stable release without changing files. For npm or source installs, it does not
check the release service. It only prints guidance to update through npm or
Git. Use `npm update` for npm installations and Git for a source checkout.

## Configuration

Configuration is discovered upward from the current directory at `<repo>/.wt/config.toml`:

```toml
worktree_path = ".worktrees"
port_offset_interval = 100
max_slots = 9
name_strategy = "cities"              # or "word_pairs"
branch_template = "{user}/{name}"
default_base = "origin/main"

setup = [
  "pnpm install --frozen-lockfile",
  "cp .env.example .env.local",
  "bash scripts/start-infra.sh",
]

teardown = [
  "docker compose -p ${WT_WORKSPACE_NAME} down",
  "docker network prune -f",
]
```

`worktree_path` must remain inside the repository. Each non-main worktree gets the first free slot from `1` through `max_slots` and a port base of `slot * port_offset_interval`. `default_base` defaults to `origin/main`. Setup and teardown arrays run in order from the worktree directory through the platform shell.

### Setup and teardown environment

Every configured setup and teardown command receives these values without modifying the parent process environment:

| Variable | Example | Purpose |
| --- | --- | --- |
| `WT_ROOT_PATH` | `/home/you/code/myrepo` | Main worktree root |
| `WT_WORKSPACE_NAME` | `rotterdam` | Worktree name |
| `WT_WORKSPACE_PATH` | `/home/you/code/myrepo/.worktrees/rotterdam` | Absolute worktree path |
| `WT_BRANCH` | `you/rotterdam` | Live branch name |
| `WT_SLOT` | `3` | Allocated slot |
| `WT_PORT_BASE` | `300` | Slot times `port_offset_interval` |

For example, a service using port `5432` can bind to `5432 + WT_PORT_BASE` in its setup script.

## State, concurrency, and safety

WT stores one JSON state file per project under `~/.wt`. It records the project root and managed slot entries, including the name, branch, relative path, base ref, remote tracking state, creation time, and a generation token. State writes are validated and replaced atomically. A project lock serializes slot allocation and destructive state changes.

- `wt new` fetches the configured base, allocates a slot, creates the Git worktree, persists state, and then runs setup.
- If setup fails or is interrupted, WT rolls back the newly created worktree and branch while preserving replacement state if another operation has taken ownership.
- `wt new` is safe to run concurrently. Slot and name allocation are protected by the project lock.
- `wt rm` refuses to remove the worktree containing the current directory.
- `wt rm` checks the live branch and worktree identity again after teardown, so a replacement cannot be removed accidentally.
- Dirty worktrees and branches with unmerged commits require confirmation. `--force` bypasses those checks. `--keep-branch` removes only the worktree.
- A worktree known to Git but not to WT appears as unmanaged in `wt ls`; remove it with Git rather than `wt rm`.
- A stale or incompatible state entry is reported and is not silently destroyed.

## Releases and updates

`package.json` is the release version source of truth. CI injects that version into `dist/wt.cjs`, then uses the same bytes for npm and standalone distribution. A stable release has the tag `vX.Y.Z` and these exact assets:

```text
wt
wt.sh
wt.fish
install.sh
absolutepraya-wt-X.Y.Z.tgz
checksums.txt
```

The checksum manifest covers the other five assets. The installer and `wt update` accept only stable `vX.Y.Z` releases, validate the expected release URLs, verify every downloaded checksum, and check the Node shebang and embedded version before replacement. The standalone installer stages its files, runs a direct `--version` and `--help` smoke on the installed executable, and rolls back if installation or that smoke fails. `wt update` uses its existing transactional replacement behavior for the standalone executable, wrappers, and metadata, with rollback on replacement failure; it does not currently run the post-install smoke. See [docs/RELEASING.md](docs/RELEASING.md) for Trusted Publishing and release recovery.

### One-time migration from Python standalone 0.3.x

Python-based standalone users on the 0.3.x line should run the new installer once:

```bash
curl -fsSL https://github.com/absolutepraya/wt/releases/latest/download/install.sh | bash
```

The installer replaces the old standalone executable and wrappers with the Node-based release after validation. It requires Node.js 18 or newer and Git. No `WT_REF` setting is needed for ordinary installs. Start a new shell, or refresh the current shell using the shell-init examples above, then confirm with `wt --version`.

## For AI coding agents

This repository ships an Agent Skill at [`skills/wt/SKILL.md`](skills/wt/SKILL.md). It teaches agents when to use WT instead of raw Git worktree commands and how to preserve project safety.

Install the skill with the [Vercel Skills CLI](https://github.com/vercel-labs/skills):

```bash
npx skills add absolutepraya/wt --skill wt
npx skills add absolutepraya/wt --skill wt --global --agent codex
```

Agents should use `wt new` without `--cd`. The successful output contains the worktree path to use for subsequent commands because a child process cannot change the agent host's working directory.

## Development

```bash
git clone https://github.com/absolutepraya/wt
cd wt
npm ci
npm test
npm run check
npm run pack:check
npm run smoke:npm
bash -n install.sh
bash scripts/check-installer.sh
git diff --check
```

The CI matrix runs Node 18, 20, 22, and 24 on Ubuntu, macOS, and Windows. POSIX installer tests run on Unix runners; Windows validates the cross-platform Node package and shell initializer.

## License

[MIT](LICENSE)
