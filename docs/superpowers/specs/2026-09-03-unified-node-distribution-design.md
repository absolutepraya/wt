# Unified Node.js Distribution for wt

**Status:** Accepted design
**Date:** 2026-09-03

## Summary

`wt` will move from a Python implementation with a thin npm launcher to one
canonical Node.js implementation. The source will be written in TypeScript,
compiled into one bundled JavaScript CLI artifact, and distributed through
both npm and a standalone Bash installer.

The global npm package, project-local npm package, and standalone installer
will execute the same bundled CLI. The standalone installer will remain
macOS/Linux-oriented, while the npm package will support macOS, Linux, and
Windows. Existing commands, flags, configuration, state, environment
variables, exit behavior, and shell sentinel semantics will remain compatible.

The migration is staged for safety, but the final shipped runtime is Node.js
only. Existing Python standalone installations from the 0.3.x line will need
one manual rerun of the new installer. After that migration, `wt update` will
work normally for standalone installations.

## Goals

- Provide one implementation and one runtime across all supported distribution
  methods.
- Support both global and project-local npm installation.
- Make the Bash installer short, release-resolved, checksum-verified, and
  independent of npm.
- Make normal CLI commands immediately usable after installation when the
  install directory is on `PATH`.
- Preserve current CLI and project compatibility during the rewrite.
- Support npm installs on macOS, Linux, and Windows.
- Preserve safe concurrent worktree allocation and rollback behavior.
- Publish npm and standalone release assets from one versioned build.
- Keep shell integration explicit and safe for the current shell and automatic
  for future standalone shell sessions.

## Non-goals

- Shipping a compiled native executable or bundling a Node.js runtime.
- Maintaining separate Python and Node implementations permanently.
- Having an installer modify the already-running parent shell's environment or
  working directory.
- Having npm lifecycle scripts edit shell profiles.
- Rewriting the CLI's user-facing behavior as part of the runtime migration.
- Adding unrelated features to the worktree model.

## User-facing installation contract

### Standalone Bash installer

The canonical command will be:

```bash
curl -fsSL https://github.com/absolutepraya/wt/releases/latest/download/install.sh | bash
```

The command will be documented as macOS/Linux installation. The release
workflow will attach `install.sh` as a release asset. The installer will use
the stable release's `latest/download/install.sh` bootstrap URL, then resolve
the latest stable release tag once through the GitHub Releases API. It will
download every remaining payload from that exact tag, so one installation
cannot combine assets from different releases. It will not require a `WT_REF`
variable for normal use.

The installer will:

1. Check for Node.js 18 or newer.
2. Check for Git.
3. Stop before creating directories or changing shell files if either
   dependency is missing.
4. Print the detected version and clear macOS/Linux installation instructions
   for missing dependencies.
5. Download payloads into a temporary directory.
6. Validate release version, executable format, and SHA-256 checksums.
7. Install the bundled CLI and shell payloads atomically.
8. Record standalone installation metadata for `wt update`.
9. Add or update managed shell-wrapper blocks for future Bash and Zsh
   sessions, and install the Fish wrapper under
   `~/.config/fish/conf.d/wt.fish` when Fish integration is available.
10. Run a direct version smoke test against the installed executable.

The default binary location remains `~/.local/bin/wt`, with an override for a
custom prefix. The installer will report whether the prefix's `bin` directory
is already on `PATH`. It will update future shell configuration as needed but
will not claim to alter the current parent shell.

If download, validation, or installation fails, temporary files are removed
and the previous installation remains unchanged. Shell startup files are not
modified after a failed install.

### Global npm installation

```bash
npm install -g @absolutepraya/wt
wt --version
```

npm's global binary mapping will expose the same bundled CLI. The package will
not edit shell profiles or install shell wrappers. The CLI will identify an
npm-managed installation from its package installation context rather than
trusting a user-provided environment variable. Updating uses:

```bash
npm update -g @absolutepraya/wt
```

The CLI will identify this as an npm-managed installation and tell the user to
use npm when `wt update` is invoked.

### Project-local npm installation

```bash
npm install -D @absolutepraya/wt
npx --no-install wt --help
```

The package will work through npm scripts, `npx --no-install`, and the local
`node_modules/.bin` mapping. The consuming project owns the lockfile and the
update lifecycle:

```bash
npm update -D @absolutepraya/wt
```

The local package will not modify shell startup files. A bare `wt` command in
an arbitrary interactive shell is not promised for a local install unless the
user's shell or package manager has added `node_modules/.bin` to `PATH`.

## Runtime and build architecture

### Canonical source

The CLI will be implemented in TypeScript under `src/`. The implementation will
target Node.js 18 or newer and use a CommonJS-compatible bundled output so the
same artifact runs under all supported Node versions.

The source will be organized around focused modules:

```text
src/
  cli.ts          argument parsing and command dispatch
  commands/       new, ls, cd, rm, update
  config.ts       TOML loading and validation
  git.ts          safe Git process execution
  state.ts        JSON state and atomic persistence
  locking.ts      cross-platform project locking
  worktrees.ts    allocation, setup, teardown, cleanup
  output.ts       tables, progress, and errors
  shell-init.ts   Bash, Zsh, Fish, and PowerShell integration
  update.ts       release lookup and verified updates
```

The exact module boundaries may be refined during implementation, but the
behavioral responsibilities must remain isolated. Git commands will use
argument arrays rather than interpolated shell strings. User-provided setup
and teardown commands will continue to run through the project's shell because
they are explicitly configured shell commands.

### Bundled artifact

The build will produce one executable JavaScript artifact, for example:

```text
dist/wt.cjs
```

The artifact will include the shebang `#!/usr/bin/env node`, the embedded CLI
version, and all required runtime library code. TypeScript, the bundler, and
any TOML parser will be development/build dependencies only. The published
package will not require a separate runtime dependency installation beyond
Node.js and Git.

`package.json` will expose `dist/wt.cjs` through its `bin.wt` entry. The
standalone release asset named `wt` will be the same built artifact with the
executable bit set. The artifact will distinguish a package installation from
a standalone installation using its resolved installation context and
standalone metadata. No distribution path will execute the old Python CLI
after the migration release.

`package.json` remains the release version source of truth. The build will
inject that version into the artifact and CI will fail if the embedded version,
package version, and release tag disagree.

## Compatibility contract

The Node port will preserve:

- `wt new`, `wt ls`, `wt cd`, `wt rm`, and `wt update`.
- Existing flags, including `--cd`, `--no-setup`, `--skip-setup`,
  `--from`, `--keep-branch`, and `--force`.
- `.wt/config.toml` keys, defaults, validation, and upward config discovery.
- The `~/.wt/<project-id>/state.json` shape and project identity behavior.
- `WT_ROOT_PATH`, `WT_WORKSPACE_NAME`, `WT_WORKSPACE_PATH`, `WT_BRANCH`,
  `WT_SLOT`, and `WT_PORT_BASE` setup/teardown variables.
- Nonzero exit behavior for user, Git, configuration, setup, teardown, and
  update failures.
- The `__cd__:<path>` output sentinel consumed by shell wrappers.
- Source-checkout and npm-managed update safeguards.

Human-facing formatting may be improved, but machine-consumed output and
sentinels must remain stable. The temporary Python implementation will act as a
behavior reference while the Node implementation is brought to parity.

## Shell integration

Shell integration is an adapter around the single Node CLI, not a second
runtime.

### Standalone future sessions

The standalone installer will install Bash/Zsh and Fish wrappers and update
managed configuration blocks for future sessions. It will not attempt to
source the current parent shell from a piped child process.

### Explicit current-session activation

The CLI will add:

```bash
wt shell-init bash
wt shell-init zsh
wt shell-init fish
wt shell-init powershell
```

The command will emit shell code on stdout and diagnostics on stderr. Users can
activate the current shell explicitly, for example:

```bash
eval "$(wt shell-init zsh)"
```

PowerShell users will have the equivalent generated function. npm installation
will not edit `$PROFILE`; users opt into it explicitly.

`wt cd` and `wt new --cd` will continue to depend on the wrapper because a
child process cannot change the parent shell's current directory.

## State, locking, and Git behavior

The Node implementation will preserve the existing state path and JSON schema.
State persistence will write to a temporary file and replace the destination
atomically.

The current POSIX-only `flock` dependency will be replaced by a
cross-platform lock abstraction. Acquisition will be atomic, serialize slot
and name allocation, and work on Windows without relying on POSIX-only APIs.
The lock will record an owner token, process information, and heartbeat or
timestamp metadata. Contenders will wait for an active lock. Stale-lock
recovery will only remove a lock when the owner is no longer valid and the
staleness rules are satisfied. Release will verify ownership before removing
the lock.

The implementation will retain the current behavior that `wt new` reserves a
slot before creating the worktree, runs setup with WT environment variables,
and rolls back the worktree and state reservation on setup failure. `wt rm`
will retain dirty-worktree, unmerged-branch, current-directory, teardown, and
branch-cleanup safety checks.

## Error and safety semantics

### Installer

- Dependency checks happen before any filesystem mutation.
- Missing Node.js or Git produces an actionable error and nonzero exit status.
- The error includes the detected state, required versions, and installation
  guidance for macOS/Linux.
- Downloads and generated metadata are staged in temporary files.
- Payloads are checked for expected version, interpreter header, executable
  shape, and checksum before replacement.
- Installation replaces files atomically and preserves the previous payload on
  failure.
- Shell profile changes occur only after the payload installation succeeds.

### CLI

- Errors are concise, contextual, and written to stderr.
- Missing Git, invalid configuration, malformed state, and unavailable release
  assets fail without silent repair or destructive cleanup.
- Git failures include the relevant operation while retaining useful Git
  diagnostics.
- Setup and teardown failures retain the existing rollback and prompt/force
  behavior.
- Lock contention waits safely; lock recovery never assumes that a live owner
  is stale.

### Updates

- Standalone updates fetch the latest stable GitHub Release, verify the asset
  set and checksums, and replace files atomically.
- Any network, validation, permission, or replacement failure leaves the
  installed version unchanged.
- npm-managed installations do not mutate `node_modules`; they print the
  appropriate global or local npm update command.
- Source checkouts do not self-update.

### Shell initialization

- `wt shell-init` writes only generated shell code to stdout.
- Unsupported shells return a nonzero status with a diagnostic on stderr.
- npm lifecycle installation never changes shell profiles.

## Release and CI design

The release workflow will build the bundled artifact once and use that build
for package validation and standalone release assets.

### CI matrix

CI will cover Node.js 18, 20, 22, and 24 on:

- Ubuntu
- macOS
- Windows

The suite will run the Node tests, syntax/type checks, build, package-content
checks, and real-Git integration tests. Windows coverage will verify path
handling, state persistence, locking, and core commands. Bash installer tests
remain on macOS/Linux.

### Release assets

Each stable release will attach:

```text
wt
wt.sh
wt.fish
install.sh
absolutepraya-wt-X.Y.Z.tgz
checksums.txt
```

The checksum manifest will cover the executable, shell wrappers, installer, and
npm tarball. The installer will validate the downloaded executable, shell
wrappers, and tarball against the manifest. `wt update` will validate the
executable and installed wrappers.

The existing npm Trusted Publisher configuration will remain the publication
mechanism. A version bump merged into `main` will publish the npm package,
create the matching immutable `vX.Y.Z` tag, and create or update the matching
GitHub Release. A main push without a version bump will be an idempotent
no-op. Release failures will not rewrite existing tags or silently publish a
different artifact.

## Migration sequence

### Stage 1: Establish the Node build and compatibility harness

- Add TypeScript configuration, build scripts, and the bundled artifact path.
- Add Node test infrastructure and shared real-Git fixtures.
- Keep the existing Python implementation and tests available as the behavior
  reference.
- Define normalized comparison helpers for paths, timestamps, and generated
  names where exact output cannot be compared directly.

### Stage 2: Port the CLI by responsibility

- Port versioning, argument parsing, output, config, state, locking, Git
  operations, naming, worktree lifecycle, shell sentinel handling, and update
  logic.
- Port behavior tests alongside each responsibility.
- Verify concurrent allocation and rollback against real temporary repos.
- Verify Windows-safe path and lock behavior in CI.

### Stage 3: Switch distribution paths

- Point npm `bin.wt` to the bundled Node artifact.
- Replace the standalone release executable with the same artifact.
- Update the installer to perform Node/Git preflight and release-asset
  verification.
- Add `shell-init` support for Bash, Zsh, Fish, and PowerShell.
- Update `wt update` channel detection and migration messaging.
- Add package, global npm, local npm, installer, and release smoke tests.

### Stage 4: Remove the old runtime and update documentation

- Remove the Python implementation, Python launcher, Python tests, and Python
  CI matrix after Node parity is proven.
- Update `AGENTS.md`, `README.md`, `CHANGELOG.md`, `docs/adr/`,
  `docs/RELEASING.md`, and `skills/wt/SKILL.md` to describe the Node runtime.
- Document the one-time reinstall required for existing Python standalone
  installations.
- Ensure all examples distinguish global npm, local npm, and standalone
  installation.

## Verification strategy

The final test suite will use Node's built-in `node:test` and real Git
repositories rather than a second test framework or mocked Git behavior.

It will cover:

- CLI version/help and all command/flag combinations.
- Config defaults, validation, discovery, and malformed input.
- State identity, round trips, atomic writes, and slot allocation.
- Cross-platform locking, contention, stale-lock recovery, and crash-safe
  cleanup.
- Worktree creation, listing, navigation sentinel output, setup, teardown,
  rollback, branch tracking, dirty safety, unmerged safety, and removal.
- Concurrent `wt new` calls receiving distinct names and slots.
- Missing Git and invalid environment diagnostics.
- `shell-init` output and wrapper behavior for Bash, Zsh, Fish, and PowerShell.
- Standalone installer preflight failures with no partial filesystem changes.
- Installer checksum/version failure with the previous installation preserved.
- Standalone update success, no-op, checksum failure, permission failure, and
  rollback behavior.
- npm package metadata and packed contents.
- Local npm installation with `npx --no-install` and npm scripts.
- Global npm installation through a temporary npm prefix.
- Node package execution on Windows, including local and global mappings.
- Release asset naming, checksums, embedded version, and tarball parity.

The Python suite will remain until the Node suite covers the existing behavior.
The Python implementation will then be removed and the Node suite will become
the sole CI gate.

## Acceptance criteria

The design is implemented successfully when:

1. `npm install -g @absolutepraya/wt`, local npm installation, and the Bash
   installer all execute the same bundled Node artifact.
2. No shipped runtime path requires Python.
3. The npm package has no external runtime dependencies.
4. The Bash installer stops safely and gives useful instructions when Node.js
   or Git is missing.
5. Standard CLI commands work immediately after installation when the binary
   directory is on `PATH`.
6. Future standalone shell sessions load navigation wrappers automatically,
   while current-shell activation is available through `wt shell-init`.
7. Existing configuration, state, commands, flags, environment variables,
   sentinels, and safety behavior remain compatible.
8. npm installs support macOS, Linux, and Windows core commands.
9. Standalone and npm updates use their owning distribution's update flow.
10. CI covers all supported Node versions and operating systems.
11. One versioned build produces the npm package and GitHub Release assets.
12. Existing Python standalone users have a documented one-time reinstall
     migration path.
