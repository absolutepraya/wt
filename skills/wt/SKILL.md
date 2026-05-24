---
name: wt
description: Use when the user wants to create, list, enter, or remove a git worktree for parallel feature/bug/review work via the `wt` CLI. Triggers on "create a worktree", "spin up a worktree", "wt new", "new worktree for X", "isolate this in a worktree", "check out branch X in a worktree", "remove the <name> worktree". Use INSTEAD of raw `git worktree add` whenever a project has a `.wt/config.toml`.
---

# wt — Universal git worktree CLI

`wt` is a single-file Python CLI for managing git worktrees with per-project setup/teardown, numbered slots with port offsets, and auto-cd. Canonical install at `~/.local/bin/wt`. Source: https://github.com/absolutepraya/wt.

## When to use this skill

The user asks for one of:

- A new worktree (off `origin/main` or off an existing remote branch for review)
- Listing existing worktrees
- Jumping to a worktree (or back to main)
- Removing a worktree (with teardown + branch deletion)

If the user says "create a worktree for X" / "wt new" / "spin up a branch for X", **use `wt`** rather than `git worktree add`.

## Prereq check

Before running `wt new` in a repo, confirm the repo has a `.wt/config.toml` at its root. If absent:

1. Tell the user the project isn't `wt`-configured.
2. Offer to create a minimal one (template below) OR ask permission to fall back to raw `git worktree add`.

Do not silently create the config or silently fall back.

## Command reference

```bash
# Create
wt new                                  # auto-name (city), branch off origin/main, run setup, auto-cd
wt new my-fix                           # explicit name
wt new -b user/feat/X-123               # explicit branch (auto dir name)
wt new my-fix -b user/feat/X-123        # explicit name + branch
wt new --from feature-x                 # check out an existing remote branch (review/MR workflow)
wt new --skip-setup                     # create the worktree but skip setup (alias: --no-setup)

# Inspect
wt ls                                   # marks the worktree you're currently in with a green ✓ next to its slot
wt cd                                   # cd to main (no name = main)
wt cd <name>                            # cd into an existing worktree

# Remove
wt rm <name>                            # teardown + remove + free slot + delete branch (prompts on dirty/unmerged)
wt rm <name> --force                    # bypass dirty/unmerged safety checks
wt rm <name> --keep-branch              # remove worktree but preserve the branch
```

Get full per-command help: `wt <command> -h`.

## Per-project `.wt/config.toml` template

For a new project, drop this in `<repo>/.wt/config.toml` (after asking the user, especially about `setup`/`teardown`):

```toml
worktree_path = ".worktrees"
port_offset_interval = 100
max_slots = 9

# Optional — defaults shown
name_strategy = "cities"             # or "word_pairs"
branch_template = "{user}/{name}"    # placeholders: {name}, {user}, {date}
default_base = "origin/main"

# Optional — commands run sequentially with a divider + "[i/N] setup: <cmd>" label
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

## Env vars setup/teardown scripts receive

Use these in scripts instead of hardcoding paths or ports — every worktree gets its own values automatically.

| Variable | Example | Use for |
|---|---|---|
| `WT_ROOT_PATH` | `/Users/you/code/myrepo` | Reaching back to the main worktree |
| `WT_WORKSPACE_NAME` | `rotterdam` | Container names, project IDs |
| `WT_WORKSPACE_PATH` | `/Users/you/code/myrepo/.worktrees/rotterdam` | cwd-relative paths |
| `WT_BRANCH` | `you/rotterdam` | Logging, env files |
| `WT_SLOT` | `3` | Naming things by slot |
| `WT_PORT_BASE` | `300` (= `slot × port_offset_interval`) | Port offsets: `5432 + WT_PORT_BASE`, etc. |

## Safety / footguns

- **`wt rm` from inside the target**: refused — cd out first (`cd <main-worktree>` or `wt cd`) before `wt rm`.
- **Unmerged commits**: `wt rm` prompts if the branch has commits not in `origin/main` and not pushed anywhere. `--force` skips the prompt; `--keep-branch` preserves the branch.
- **Partial setup failure**: a failed `setup` command (or Ctrl-C mid-setup) rolls back the worktree automatically — no half-baked directories.
- **Live branch detection**: `wt rm` checks the branch actually checked out in the worktree right now, not whatever `wt new` originally created. So `git checkout`-ing a different branch into a worktree and then removing it still cleans up the right ref.
- **Worktrees git knows about but `wt` doesn't**: shown in a separate "Unmanaged worktrees" section by `wt ls`. Don't try to `wt rm` those — use raw `git worktree remove` if you need to clean them up.

## Concurrency

`wt new` is safe to invoke in parallel (the script holds an `flock` across slot/name allocation AND the `git worktree add` call). Two parallel `wt new` calls serialize through the git step but both succeed cleanly.

## When `wt` is the wrong tool

- Repo has no `.wt/config.toml` and the user hasn't asked for one → use raw `git worktree add`, after telling them.
- Worktree the user wants to operate on appears in `wt ls` under "Unmanaged worktrees" → it wasn't created via `wt`, use raw git commands.
- User wants something `wt` doesn't do (sparse checkout, prune detached worktrees, etc.) → use raw git commands directly.

## Where to read more

Repo + full docs (including the install one-liner and rendered output previews for `wt new`/`rm`/`ls`): https://github.com/absolutepraya/wt
