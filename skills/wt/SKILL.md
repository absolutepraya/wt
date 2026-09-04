---
name: wt
description: Use when the user wants to create, list, enter, or remove a Git worktree for parallel feature, bug, or review work through the wt CLI. Triggers on create a worktree, spin up a worktree, wt new, new worktree, isolate this in a worktree, check out a branch in a worktree, or remove a worktree.
---

# wt Agent Skill

WT is an agent-first Git worktree manager for LLM agents. It gives several
agents isolated worktrees in one project through one unified, coding-agent
agnostic manager. Source and documentation: https://github.com/absolutepraya/wt.

## When to use this skill

Use WT when the user asks to:

- create a worktree for feature, bug, or review work;
- list managed worktrees;
- enter a worktree or return to the main worktree; or
- remove a worktree with its teardown and branch cleanup.

Use `wt` instead of raw `git worktree` commands when the repository has a
`.wt/config.toml`.

## Installation and runtime

WT uses one bundled Node.js CLI, `dist/wt.cjs`, for standalone, global npm,
and project-local npm distribution. It requires Node.js 18 or newer and Git.
The standalone installer supports macOS and Linux. npm installations support
the core commands on macOS, Linux, and Windows.

```bash
curl -fsSL https://github.com/absolutepraya/wt/releases/latest/download/install.sh | bash
npm install -g @absolutepraya/wt
npm install -D @absolutepraya/wt
```

Standalone installation supplies shell wrappers and is the only installation
mode with self-mutating `wt update`. Update global or local npm installations
with npm. Update a source checkout with Git. npm never edits shell profiles.

## Prerequisite check

Before running `wt new`, confirm the repository has `.wt/config.toml` at its
root or in a parent directory. If it is absent:

1. Tell the user that the project is not WT-configured.
2. Offer to create a minimal configuration after asking about setup and
   teardown commands.
3. Only use raw `git worktree add` if the user explicitly approves that
   fallback.

Do not silently create configuration or silently fall back to raw Git.

## Command reference

```bash
wt new                                  # name from origin/main, run setup
wt new --cd                             # create and navigate the interactive shell
wt new my-fix                           # explicit worktree name
wt new -b user/feat/X-123               # explicit branch, auto directory name
wt new my-fix -b user/feat/X-123        # explicit name and branch
wt new --from feature-x                 # use an existing remote branch
wt new --skip-setup                     # create without setup commands
wt new --no-setup                       # alias for --skip-setup

wt ls                                   # list managed and unmanaged worktrees
wt list                                 # alias for ls
wt cd                                   # navigate to the current or main worktree
wt cd <name>                            # navigate to an existing worktree

wt rm <name>                            # teardown, remove, and delete its branch
wt remove <name>                        # alias for rm
wt rm <name> --force                    # bypass dirty, unmerged, and teardown checks
wt rm <name> --keep-branch              # remove worktree but preserve its branch

wt update --check                       # check a standalone update
wt update                               # update a standalone installation
```

Run `wt <command> --help` for command-specific options. Agents should use
`wt new` without `--cd`: a child process cannot change the working directory
of its parent agent process. Use the absolute worktree path printed by WT for
subsequent commands.

## Shell navigation

`wt shell-init` prints shell integration and never edits a profile:

```bash
eval "$(wt shell-init bash)"
eval "$(wt shell-init zsh)"
```

```fish
wt shell-init fish | source
```

```powershell
Invoke-Expression (& wt shell-init powershell)
```

The standalone installer installs `~/.config/wt/wt.sh` for Bash and Zsh and
`~/.config/wt/wt.fish` for Fish. It adds managed startup blocks for those
shells. npm and source installations do not edit profiles. Add the
PowerShell expression to the profile yourself if it should load in future
sessions.

## Project configuration

For a new project, ask before creating `<repo>/.wt/config.toml`:

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

`worktree_path` must be inside the repository. Slots run from `1` through
`max_slots`, and each slot gets `slot * port_offset_interval` as its port
base. Setup and teardown commands run in order from the worktree directory.

## Setup and teardown environment

Each configured command receives these environment variables:

| Variable | Meaning |
| --- | --- |
| `WT_ROOT_PATH` | Main worktree root |
| `WT_WORKSPACE_NAME` | Managed worktree name |
| `WT_WORKSPACE_PATH` | Absolute worktree path |
| `WT_BRANCH` | Live branch name |
| `WT_SLOT` | Allocated slot number |
| `WT_PORT_BASE` | Slot times `port_offset_interval` |

## Safety rules

- Check the current working directory before `wt rm`; WT refuses to remove a
  worktree containing it.
- Treat dirty or unmerged worktree warnings as a review gate. Use `--force`
  only when the user has accepted the loss risk.
- Use `--keep-branch` when removing files while preserving branch work.
- A failed setup or interruption rolls back the new worktree and branch.
- Concurrent `wt new` calls are serialized for name, slot, Git, and state
  operations.
- WT rechecks live worktree and branch identity before destructive cleanup.
- Do not remove an unmanaged worktree with WT. Use Git after confirming the
  target.
- Never commit credentials, local context, state files, or generated release
  directories.

## Contributing to WT

Use a named WT worktree based on `origin/main`; keep the main worktree
unchanged. Validate changes with the commands appropriate to the scope:

```bash
npm ci
npm test
npm run check
npm run check-version
npm run pack:check
npm run smoke:npm
bash -n install.sh
bash scripts/check-installer.sh
git diff --check
```

Keep `README.md`, `AGENTS.md`, `CHANGELOG.md`, `docs/adr/`, and
`docs/RELEASING.md` aligned with current behavior. Releases come only from
merged `main`, use the package version as source of truth, and publish through
Trusted Publishing. Never push, publish, tag, or create a GitHub Release from
a feature branch without explicit approval.
