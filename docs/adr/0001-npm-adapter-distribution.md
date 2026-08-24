---
status: accepted
---

# Publish an npm adapter around the core CLI

We will publish `@praya/wt` as a public, project-local npm package that exposes the `wt` command through a thin adapter around the existing core CLI. Consumer projects own their lockfiles, while the standalone installer remains responsible for global installation and shell integration. This preserves the existing CLI contract without requiring a Node rewrite, bundled runtime, or install-time shell mutation.

## Considered options

- Rewrite the CLI in Node: rejected because it would duplicate or replace stable worktree behavior for the sake of one distribution channel.
- Bundle a Python runtime in the npm package: rejected for the initial release because platform-specific binaries would increase artifact size and release complexity.
- Install shell configuration from npm: rejected because dependency installation should not modify a user's interactive shell.

## Consequences

The npm adapter requires Node 18 or newer, Python 3.11 or newer, and Git. Release is manual: merge the feature branch, create the version tag, publish publicly under the owned `@praya` scope, and verify a clean consumer install.
