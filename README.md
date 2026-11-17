<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
    <img src="assets/logo-light.svg" alt="wt" height="96">
  </picture>

  <h3>Agent-first Git worktree manager</h3>

  <p>Give every coding agent its own named, isolated worktree, with repeatable setup, reserved ports, and safe cleanup.</p>

  [![CI](https://github.com/absolutepraya/wt/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/absolutepraya/wt/actions/workflows/ci.yml)
  [![npm version](https://img.shields.io/npm/v/%40absolutepraya%2Fwt?logo=npm)](https://www.npmjs.com/package/@absolutepraya/wt)
  [![npm downloads](https://img.shields.io/npm/dm/%40absolutepraya%2Fwt?logo=npm)](https://www.npmjs.com/package/@absolutepraya/wt)
  [![GitHub Release](https://img.shields.io/github/v/release/absolutepraya/wt?display_name=tag&sort=semver)](https://github.com/absolutepraya/wt/releases)
  [![Node.js 18+](https://img.shields.io/badge/node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
  [![License](https://img.shields.io/github/license/absolutepraya/wt)](LICENSE)
</div>

WT lets several agents work concurrently on one project through a single worktree manager, whichever coding agent you use. Switch between Claude Code, Codex, Cursor, OpenCode, or another agent without changing the project's worktree workflow. It works just as well for human-led parallel feature work.

Git worktrees solve the one-checkout-per-branch problem. WT adds what parallel work still needs:

- **Isolation**: a named worktree and branch per task, created from a configurable base.
- **Repeatable setup and teardown**: your own commands run when a worktree is created and removed.
- **Slots and port offsets**: each worktree gets a reserved slot, so services do not fight over one dev port.
- **Safe cleanup**: dirty or unmerged work is never removed without confirmation.
- **Agent-readable output**: `wt ls --format agent` prints labeled records with absolute paths.

## Quick start

1. [Install WT](#install).
2. In a Git repository, create `.wt/config.toml` once:

   ```bash
   mkdir -p .wt
   cat > .wt/config.toml <<'EOF'
   worktree_path = ".worktrees"
   port_offset_interval = 100
   max_slots = 9
   EOF
   ```

3. Create a worktree:

   ```bash
   wt new
   ```

## Install

WT is one Node.js CLI with three distribution modes. All of them need Node.js 18 or newer and Git 2.5 or newer.

### Standalone installer (macOS, Linux)

```bash
curl -fsSL https://github.com/absolutepraya/wt/releases/latest/download/install.sh | bash
```

The installer downloads the latest stable release, verifies the SHA-256 manifest and the embedded CLI version, then installs atomically. It writes:

- `~/.local/bin/wt`, the executable
- `~/.config/wt/wt.sh` and `~/.config/wt/wt.fish`, the shell wrappers
- `~/.config/wt/install.json`, standalone channel metadata

It adds managed wrapper blocks to your Bash, Zsh, and Fish startup files, and stops with an actionable message if Node.js or Git is missing. Set `PREFIX` or `WT_CONFIG_DIR` to install elsewhere. Update with `wt update`.

### npm (macOS, Linux, Windows)

```bash
npm install -g @absolutepraya/wt     # global
npm install -D @absolutepraya/wt     # project-local, pinned by your lockfile
npx --no-install wt --help           # run a local install
```

npm installs never edit shell profiles. Update them with `npm update`.

### From source

```bash
git clone https://github.com/absolutepraya/wt
cd wt
npm ci
npm run build
node dist/wt.cjs --help
```

Update a source checkout with Git. `wt update` does not modify it.

> [!NOTE]
> All three modes ship the same bundled `dist/wt.cjs`. Only the standalone installer supplies shell wrappers and a self-updating `wt update`. Windows is supported through npm.

## Shell integration

`wt shell-init <shell>` prints the integration for your shell and never edits a profile. The wrapper it installs understands the `__cd__:<path>` sentinel used by `wt new --cd` and `wt cd`, which lets WT change your shell's directory.

```bash
eval "$(wt shell-init bash)"                  # Bash
eval "$(wt shell-init zsh)"                   # Zsh
wt shell-init fish | source                   # Fish
Invoke-Expression (& wt shell-init powershell)   # PowerShell
```

To load it in future shells, source the wrapper from your profile (`source ~/.config/wt/wt.sh` for Bash and Zsh, `source ~/.config/wt/wt.fish` for Fish). Add the PowerShell line to your profile yourself; WT never edits it.

## Commands

```text
wt new                          create a worktree from origin/main
wt new [name]                   choose a worktree name
wt new -b user/feature          choose the branch name
wt new --from feature-x         base on an existing remote branch
wt new --no-setup               skip configured setup commands (alias: --skip-setup)
wt new --cd                     navigate the interactive shell after creation

wt ls                           list managed and unmanaged Git worktrees (alias: list)
wt ls --format table            explicit human-readable table
wt ls --format agent            numbered, labeled output for coding agents
wt cd [name]                    print the current, main, or a named worktree path

wt rm <name>                    run teardown and remove the worktree (alias: remove)
wt rm <name> --keep-branch      remove the worktree but keep its branch
wt rm <name> --force            bypass dirty, unmerged, and teardown failures

wt update [--check]             update, or check for, a standalone installation
wt shell-init <shell>           print integration for bash, zsh, fish, or powershell
wt --version, -V                print the installed version
wt --help, -h                   show help (also: wt <command> --help)
```

`wt update --check` only contacts the release service for standalone installs. For npm and source installs it prints guidance to update through npm or Git.

## Configuration

WT discovers `<repo>/.wt/config.toml` by searching upward from the current directory:

```toml
worktree_path = ".worktrees"          # must stay inside the repository
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

Each non-main worktree gets the first free slot from `1` through `max_slots` and a port base of `slot * port_offset_interval`. Setup and teardown commands run in order from the worktree directory through the platform shell, with these variables set:

| Variable | Example | Purpose |
| --- | --- | --- |
| `WT_ROOT_PATH` | `/home/you/code/myrepo` | Main worktree root |
| `WT_WORKSPACE_NAME` | `rotterdam` | Worktree name |
| `WT_WORKSPACE_PATH` | `/home/you/code/myrepo/.worktrees/rotterdam` | Absolute worktree path |
| `WT_BRANCH` | `you/rotterdam` | Live branch name |
| `WT_SLOT` | `3` | Allocated slot |
| `WT_PORT_BASE` | `300` | Slot times `port_offset_interval` |

For example, a service on port `5432` can bind to `5432 + WT_PORT_BASE` in its setup script.

## Safety

WT keeps one JSON state file per project under `~/.wt/<project-id>.json`, outside the repository. State writes are validated and atomic, and a project lock serializes slot allocation and destructive changes, so `wt new` is safe to run concurrently.

- If setup fails or is interrupted, `wt new` rolls back the worktree and branch it just created.
- `wt rm` refuses to remove the worktree containing the current directory, and re-checks the live branch and worktree identity after teardown.
- Dirty worktrees and branches with unmerged commits require confirmation.
- A worktree known to Git but not to WT shows as unmanaged in `wt ls`. Remove it with Git, not `wt rm`.
- Stale or incompatible state entries are reported, never silently destroyed.

> [!WARNING]
> `wt rm --force` bypasses the dirty, unmerged, and teardown-failure checks. Use it only when you are sure the work is disposable.

## For AI coding agents

This repository ships an Agent Skill at [`skills/wt/SKILL.md`](skills/wt/SKILL.md). It teaches agents when to prefer WT over raw `git worktree` commands and how to keep the project safe. Install it with the [Vercel Skills CLI](https://github.com/vercel-labs/skills):

```bash
npx skills add absolutepraya/wt --skill wt
npx skills add absolutepraya/wt --skill wt --global --agent codex
```

> [!IMPORTANT]
> Agents should run `wt new` without `--cd`. A child process cannot change its parent's working directory, so use the absolute worktree path in WT's output for follow-up commands.

To inspect existing worktrees, agents should use `wt ls --format agent`. It returns numbered records with labeled fields and full absolute paths, with no box-drawing characters or terminal-width truncation. Humans can keep using `wt ls`.

## Releases and migration

`package.json` is the release version source of truth. Each stable `vX.Y.Z` release is built once and publishes the same `dist/wt.cjs` to npm and to GitHub Releases, with a checksum manifest covering every asset. The installer and `wt update` accept only stable releases and verify every download before replacing anything. See [docs/RELEASING.md](docs/RELEASING.md) for Trusted Publishing and recovery.

Python-based standalone users on the 0.3.x line should run the standalone installer once. It replaces the old executable and wrappers with the Node-based release after validation. Start a new shell, then confirm with `wt --version`.

## Development

```bash
git clone https://github.com/absolutepraya/wt
cd wt
npm ci
npm test
npm run check
npm run pack:check
npm run smoke:npm
bash -n install.sh && bash scripts/check-installer.sh
```

CI runs Node 18, 20, 22, and 24 on Ubuntu, macOS, and Windows. POSIX installer tests run on Unix runners; Windows validates the cross-platform Node package and shell initializer.
