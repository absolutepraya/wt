# Changelog

## Unreleased

- Unified the Node.js CLI across standalone, global npm, and project-local npm
  installations using one bundled artifact.
- Added global and local npm support without shell profile mutation.
- Added Bash, Zsh, Fish, and PowerShell shell-init output for cross-platform
  interactive navigation.
- Added a release-based macOS/Linux installer with checksum validation and
  rollback, plus standalone-only `wt update`.
- Added a one-time migration path for historical Python-based standalone 0.3.x
  installations.
- Added merged-main CI publication through npm Trusted Publishing and matching
  GitHub Release assets.
- Added safe migration for stale empty lock files created by the historical
  Python standalone CLI.

## Historical v0.1.0

The initial public release used a single-file Python CLI with standard-library
dependencies. It introduced:

- `wt new`, `wt ls`, `wt cd`, and `wt rm` for managed Git worktrees.
- Per-project `.wt/config.toml` with setup and teardown command arrays.
- Per-worktree environment variables for paths, branches, slots, and ports.
- City-name and word-pair auto-naming strategies.
- Concurrency-safe slot allocation and dirty-tree, unmerged-commit, and
  partial-setup safety checks.
- Bash, Zsh, and Fish wrappers for shell navigation.
