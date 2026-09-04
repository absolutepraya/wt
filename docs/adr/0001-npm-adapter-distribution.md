---
status: accepted
---

# Unified npm and standalone distribution

WT uses one bundled Node.js CLI artifact for every supported distribution.
`src/` is the implementation source, `package.json` declares the package and
release version, and `dist/wt.cjs` is the shared artifact consumed by:

- a global npm installation, which exposes `wt` through npm's global bin path;
- a project-local npm installation, which exposes `wt` through the consumer's
  `node_modules/.bin` and lockfile; and
- the macOS/Linux standalone installer, which copies the same artifact into
  the user's configured prefix.

The runtime requirement is Node.js 18 or newer plus Git. npm installation is
cross-platform for core commands on macOS, Linux, and Windows. The standalone
installer additionally provides Bash, Zsh, and Fish wrappers and therefore is
limited to macOS and Linux. PowerShell integration is printed by
`wt shell-init powershell` and is loaded by the user.

## Decision drivers

The worktree manager must be usable by LLM agents and human developers from
the same project, independent of which coding agent or package manager is in
use. A single artifact prevents behavior drift between local, global, and
standalone execution. npm installation must remain a normal dependency
operation and must never edit shell profiles.

## Considered options

- Keep separate runtime implementations: rejected because commands and safety
  behavior could diverge between distribution channels.
- Bundle a Python runtime: rejected because it adds platform-specific runtime
  payloads and preserves a permanent Python prerequisite.
- Install shell configuration from npm: rejected because dependency
  installation should not mutate a consumer's interactive shell.
- Require a global package for agent projects: rejected because local npm
  dependencies give agents a reproducible, lockfile-pinned CLI.

## Installation and migration consequences

The supported commands are:

```bash
curl -fsSL https://github.com/absolutepraya/wt/releases/latest/download/install.sh | bash
npm install -g @absolutepraya/wt
npm install -D @absolutepraya/wt
```

Users of the historical Python-based standalone 0.3.x installation must run
the standalone installer once. It replaces the old executable and wrappers
only after the release has passed version and checksum validation. Ordinary
installs do not require `WT_REF`. Global and local npm users update through
npm, and source checkouts update through Git. Only standalone installations
support the self-mutating `wt update` command.

## Consequences

The package contains no runtime dependencies beyond Node.js and Git. The
standalone installer manages `~/.local/bin/wt`, shell wrapper files, and
standalone metadata by default. Shell navigation still requires an initializer
or wrapper because a child process cannot change its parent shell's directory.
State remains outside the repository under the user's `~/.wt` directory, so
installing or updating WT does not alter project source or lockfiles.

The exact release asset contract, Trusted Publishing setup, and rollback
guarantees are defined in [ADR 0002](0002-automated-releases-and-self-update.md)
and [docs/RELEASING.md](../RELEASING.md).
