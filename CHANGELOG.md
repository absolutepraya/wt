# Changelog

## v0.1.0 — initial release

First public release of `wt`. Single-file Python CLI, stdlib only.

- `wt new` — create a worktree, run per-project setup scripts, auto-cd.
- `wt ls` — list worktrees with slot, branch, port offset, and a `✓` marker on the one you're inside.
- `wt cd` — jump into a worktree (or back to main with `wt cd` / `wt cd main`).
- `wt rm` — run teardown, remove worktree, free slot, delete branch.
- Per-project `.wt/config.toml` with `setup`/`teardown` shell-command arrays.
- Per-worktree env vars (`WT_ROOT_PATH`, `WT_WORKSPACE_NAME`, `WT_WORKSPACE_PATH`, `WT_BRANCH`, `WT_SLOT`, `WT_PORT_BASE`).
- City-name and word-pair auto-naming strategies.
- Concurrency-safe slot allocation via `flock`.
- Safety: dirty-tree and unmerged-commits checks on `rm`; cwd-inside-target guard; partial-worktree rollback on setup failure.
- Bash, zsh, and fish shell wrappers for auto-cd on `new`/`cd`.
