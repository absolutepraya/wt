# Changelog

## Unreleased

- Added `wt --version` and `wt -V` to report the installed CLI version.
- Added `wt update` and `wt update --check` for checksum-verified updates of standalone installations from stable GitHub Releases.
- Added release assets for the standalone CLI, shell wrapper, npm tarball, and SHA-256 checksums.
- Added CI release automation that publishes new package versions and creates matching GitHub Releases after all checks pass.
- Added npm Trusted Publishing and GitHub Actions permission guidance for tokenless release authentication.
- Renamed the npm package to `@absolutepraya/wt` and prepared patch release `0.3.1` for the account-owned scope.
- `wt new` now stays in the current directory by default. Pass `--cd` to opt into interactive-shell navigation after creating the worktree.
- Documented Vercel Skills CLI installation: `npx skills add absolutepraya/wt --skill wt`.
- Added npm package metadata and a cross-platform Node launcher for project-local installs as `@absolutepraya/wt`.
- Added package checks that verify the npm binary forwards to the existing Python CLI.
- Added a separate CI npm matrix that validates the packed artifact in a fresh consumer project.

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
