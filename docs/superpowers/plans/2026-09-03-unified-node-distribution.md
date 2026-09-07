# Unified Node.js Distribution for wt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Python CLI and thin npm launcher with one bundled TypeScript/Node.js CLI that works through standalone Bash installation, global npm installation, and project-local npm installation.

**Architecture:** Port the existing behavior into focused TypeScript modules, bundle them with esbuild into `dist/wt.cjs`, and point both npm and standalone release distribution at that artifact. Preserve the current config, state, command, shell-sentinel, safety, and update contracts while adding cross-platform Node/npm execution, release-based installation, and shell initialization for Bash, Zsh, Fish, and PowerShell.

**Tech Stack:** Node.js 18+, TypeScript, esbuild, `@iarna/toml` bundled at build time, Node `node:test`, `tsx`, npm, Git, Bash, Zsh, Fish, and PowerShell.

**Spec:** `docs/superpowers/specs/2026-09-03-unified-node-distribution-design.md`

## Global Constraints

- Node.js 18 or newer is the only shipped runtime requirement besides Git.
- The npm package has no external runtime dependencies; TypeScript, esbuild, `tsx`, `@types/node`, and `@iarna/toml` are development/build dependencies.
- npm installs support macOS, Linux, and Windows core commands.
- The standalone Bash installer supports macOS and Linux.
- Existing command names, flags, config keys, state JSON keys, environment variables, exit behavior, and `__cd__:<path>` output remain compatible.
- `package.json` is the release version source of truth; the bundled CLI and `vX.Y.Z` tag must match it.
- Standalone installation uses the latest stable GitHub Release, resolves one exact tag, verifies checksums, and installs atomically.
- npm global and local installations never edit shell profiles.
- Existing Python standalone installations require one manual rerun of the new installer; no permanent Python runtime path remains.
- Preserve unrelated files and changes. Stage explicit paths only.
- Use `git push -u origin absolutepraya/npm-install-ux` for the first branch push.
- Do not publish from the feature branch. npm publication and GitHub Release creation remain merged-main CI actions.

## File Map

Create:

- `tsconfig.json`
- `scripts/build.mjs`
- `scripts/run-tests.mjs`
- `scripts/check-version.mjs`
- `scripts/build-release.mjs`
- `scripts/check-npm-package.mjs`
- `scripts/check-installer.sh`
- `scripts/installer-test-server.mjs`
- `src/types.ts`
- `src/errors.ts`
- `src/version.ts`
- `src/runtime.ts`
- `src/paths.ts`
- `src/config.ts`
- `src/state.ts`
- `src/locking.ts`
- `src/git.ts`
- `src/naming.ts`
- `src/template.ts`
- `src/output.ts`
- `src/worktrees.ts`
- `src/cli.ts`
- `src/commands/new.ts`
- `src/commands/ls.ts`
- `src/commands/cd.ts`
- `src/commands/rm.ts`
- `src/commands/index.ts`
- `src/shell-init.ts`
- `src/update.ts`
- `shell/wt.ps1`
- `test/fixtures.ts`
- `test/runtime.test.ts`
- `test/paths.test.ts`
- `test/config.test.ts`
- `test/state.test.ts`
- `test/locking.test.ts`
- `test/git.test.ts`
- `test/naming.test.ts`
- `test/template.test.ts`
- `test/output.test.ts`
- `test/commands.test.ts`
- `test/e2e.test.ts`
- `test/cli.test.ts`
- `test/shell-init.test.ts`
- `test/update.test.ts`
- `test/channel.test.ts`
- `test/package.test.ts`
- `test/package-manifest.test.ts`
- `test/installer.test.ts`
- `test/release.test.ts`

Modify:

- `package.json`
- `package-lock.json`
- `.gitignore`
- `install.sh`
- `shell/wt.sh`
- `shell/wt.fish`
- `.github/workflows/ci.yml`
- `README.md`
- `CHANGELOG.md`
- `AGENTS.md`
- `docs/adr/0001-npm-adapter-distribution.md`
- `docs/adr/0002-automated-releases-and-self-update.md`
- `docs/RELEASING.md`
- `skills/wt/SKILL.md`

Delete after behavioral parity is demonstrated:

- `bin/wt`
- `npm/wt.cjs`
- `scripts/check-version.py`
- `scripts/check-npm-package.sh`
- `tests/conftest.py`
- `tests/test_*.py`

Responsibilities:

- `src/cli.ts` and `src/commands/` own argument parsing, dispatch, and command-specific orchestration.
- `src/config.ts`, `src/paths.ts`, `src/state.ts`, and `src/locking.ts` own durable project configuration, path resolution, state persistence, and serialization.
- `src/git.ts`, `src/naming.ts`, `src/template.ts`, and `src/worktrees.ts` own Git calls, allocation, branch naming, lifecycle, setup, teardown, and rollback.
- `src/output.ts` and `src/shell-init.ts` own human output, the `__cd__` protocol, and shell adapters.
- `src/runtime.ts` and `src/update.ts` own prerequisite checks, installation-channel detection, release lookup, checksum validation, and standalone update behavior.
- `scripts/` owns reproducible builds, package and installer smoke tests, release assembly, and version checks.
- `install.sh` and `shell/` own standalone bootstrap and shell-specific integration files.
- `.github/workflows/ci.yml` owns the cross-platform test matrix and merged-main publication gate.
- `README.md`, `AGENTS.md`, `docs/`, `CHANGELOG.md`, and `skills/wt/SKILL.md` own user-facing, contributor, release, and agent workflow documentation.

---

## Task 1: Add the TypeScript build and npm package scaffold

**Files:** `package.json`, `package-lock.json`, `tsconfig.json`, `scripts/build.mjs`, `scripts/run-tests.mjs`, `src/version.ts`, `src/cli.ts`, `test/package-manifest.test.ts`, `.gitignore`

- [ ] Add the build and test dependencies with npm:

  ```
  npm install --save-dev typescript esbuild tsx @types/node @iarna/toml
  ```

  Keep these as development dependencies. Do not add a runtime `dependencies` block.

- [ ] Change `package.json` so the package remains `@absolutepraya/wt`, requires Node `>=18`, maps `wt` to `dist/wt.cjs`, packages only `dist/wt.cjs`, and has these scripts:

  ```
  "build": "node scripts/build.mjs",
  "typecheck": "tsc --noEmit",
  "test": "npm run build && node scripts/run-tests.mjs",
  "check-version": "node scripts/check-version.mjs",
  "check": "npm run typecheck && npm run build && node --check dist/wt.cjs",
  "pack:check": "npm run build && npm pack --dry-run",
  "smoke:npm": "npm run build && node scripts/check-npm-package.mjs"
  ```

  Remove the old `npm/wt.cjs` entry.

- [ ] Add strict TypeScript settings to `tsconfig.json`:

  ```
  {
    "compilerOptions": {
      "target": "ES2022",
      "module": "ESNext",
      "moduleResolution": "Bundler",
      "strict": true,
      "noEmit": true,
      "esModuleInterop": true,
      "forceConsistentCasingInFileNames": true,
      "skipLibCheck": true,
      "types": ["node"]
    },
    "include": ["src/**/*.ts", "test/**/*.ts"]
  }
  ```

- [ ] Define `src/version.ts`:

  ```
  declare const WT_BUILD_VERSION: string | undefined;

  export const VERSION =
    typeof WT_BUILD_VERSION === "string" ? WT_BUILD_VERSION : "0.0.0-dev";
  ```

- [ ] Implement `scripts/build.mjs` with esbuild. Use `src/cli.ts` as the entry point, bundle imports, target Node 18, emit CommonJS to `dist/wt.cjs`, inject the package version through `define`, add a Node shebang banner, disable minification and sourcemaps, create `dist`, and chmod the artifact 0755.

- [ ] Add an initial `src/cli.ts` with exported `runCli` and `--version`/`-V` and `--help` handling. The scaffold may return exit code 1 for commands not yet dispatched; Task 6 replaces this behavior with the complete parser.

- [ ] Implement `scripts/run-tests.mjs` to discover sorted `test/**/*.test.ts` files recursively and invoke the local `tsx` binary with Node’s test runner. Select `tsx.cmd` on Windows and preserve the child exit code.

- [ ] Add `test/package-manifest.test.ts` asserting `bin.wt` is `dist/wt.cjs`, the generated artifact starts with the Node shebang, and the package file list excludes the old Python and thin-launcher paths.

- [ ] Ignore generated `dist/` output and npm pack tarballs, while retaining lockfiles and source files.

- [ ] Run:

  ```
  npm install
  npm run typecheck
  npm run build
  node --check dist/wt.cjs
  npm test
  ```

- [ ] Commit:

  ```
  git add package.json package-lock.json tsconfig.json scripts/build.mjs scripts/run-tests.mjs src test/package-manifest.test.ts .gitignore
  git commit -m "build: add bundled TypeScript CLI"
  ```

## Task 2: Port shared types, runtime detection, paths, configuration, and errors

**Files:** `src/types.ts`, `src/errors.ts`, `src/version.ts`, `src/runtime.ts`, `src/paths.ts`, `src/config.ts`, `test/runtime.test.ts`, `test/paths.test.ts`, `test/config.test.ts`

- [ ] Define shared interfaces in `src/types.ts`:

  ```
  export type NameStrategy = "cities" | "word_pairs";
  export type ShellName = "bash" | "zsh" | "fish" | "powershell";
  export type InstallChannel =
    | "standalone"
    | "npm-global"
    | "npm-local"
    | "source";

  export interface Config {
    repoRoot: string;
    worktreePath: string;
    portOffsetInterval: number;
    maxSlots: number;
    nameStrategy: NameStrategy;
    branchTemplate: string;
    defaultBase: string;
    setup: string[];
    teardown: string[];
  }

  export interface StateEntry {
    name: string;
    branch: string;
    path: string;
    base: string;
    tracks_remote?: boolean;
    created_at: string;
  }

  export interface PersistedState {
    version: 1;
    project_root: string;
    slots: Record<string, StateEntry>;
  }

  export interface GitWorktree {
    path: string;
    head: string;
    branch: string | null;
    bare?: boolean;
  }

  export interface CliIO {
    stdout: NodeJS.WritableStream;
    stderr: NodeJS.WritableStream;
    stdin: NodeJS.ReadableStream;
    stdoutIsTTY: boolean;
    stdinIsTTY: boolean;
  }

  export interface CliContext {
    cwd: string;
    env: NodeJS.ProcessEnv;
    io: CliIO;
  }
  ```

- [ ] Add typed errors for usage, configuration, Git, setup, teardown, update, and installer validation failures. Each error carries a stable code and a sanitized user-facing message.

- [ ] Implement runtime helpers to resolve the current user, require Git with a noninteractive version check, classify the current platform, and classify installation channel. Channel detection must not trust caller-controlled `WT_INSTALL_CHANNEL`. Use this precedence: matching standalone metadata, npm package context with global/local distinction, source checkout, then unknown diagnostic.

- [ ] Implement path helpers to discover `.wt/config.toml` by walking upward, resolve the main worktree through Git common-directory metadata, compute the existing project ID and state paths, normalize paths with `realpath` and Windows case normalization, and reject paths outside the configured worktree root.

- [ ] Implement `src/config.ts` with the bundled TOML parser and preserve these defaults exactly:

  ```
  worktree_path = ".worktrees"
  port_offset_interval = 10
  max_slots = 20
  name_strategy = "cities"
  branch_template = "{user}/{name}"
  default_base = "origin/main"
  setup = []
  teardown = []
  ```

  Validate types, supported strategies, positive slot and port values, relative worktree constraints, and ordered setup/teardown arrays.

- [ ] Add tests for missing Git, user fallback, path discovery, linked worktrees, channel classification, default values, malformed TOML, invalid numeric values, invalid strategy, and repository escape attempts.

- [ ] Run:

  ```
  npm run typecheck
  npm test -- --test-name-pattern="runtime|paths|config|package"
  ```

- [ ] Commit:

  ```
  git add src/types.ts src/errors.ts src/version.ts src/runtime.ts src/paths.ts src/config.ts test/runtime.test.ts test/paths.test.ts test/config.test.ts
  git commit -m "feat: add runtime paths and configuration primitives"
  ```
## Task 3: Port state persistence and cross-platform locking

**Files:** `src/state.ts`, `src/locking.ts`, `test/state.test.ts`, `test/locking.test.ts`

- [ ] Implement state helpers to create an empty version-1 state, load and validate the existing JSON location, preserve snake_case keys, treat `tracks_remote` as optional, reserve/free slots as pure transformations, and save through same-directory temporary-file plus atomic-rename writes. Set restrictive permissions where supported.

- [ ] Replace POSIX-only flock with a cross-platform exclusive lock on the existing `.lock` path:
  - create with `fs.promises.open(lockPath, "wx")`;
  - write `{ pid, hostname, token, startedAt }` metadata;
  - wait 100 ms between attempts;
  - consider stale only after 60 seconds and only if the owner is dead or metadata is invalid;
  - refresh mtime every 10 seconds;
  - release only when the stored token still matches;
  - close handles, stop timers, and clean up in `finally`.

- [ ] Expose `withProjectLock` for callers to wrap the complete state/Git critical section. Surface timeout, stale-owner, and ownership errors with stable codes.

- [ ] Test state round trips, interrupted writes, concurrent child-process serialization, live-owner protection, invalid metadata recovery, token mismatch protection, and cleanup after successful and failed callbacks on POSIX and Windows.

- [ ] Run the focused state and lock tests on Node 18 and the local Node version.

- [ ] Commit:

  ```
  git add src/state.ts src/locking.ts test/state.test.ts test/locking.test.ts
  git commit -m "feat: add config state and cross-platform locking"
  ```
## Task 4: Port Git operations, naming, templates, and output

**Files:** `src/git.ts`, `src/naming.ts`, `src/template.ts`, `src/output.ts`, `test/fixtures.ts`, `test/git.test.ts`, `test/naming.test.ts`, `test/template.test.ts`, `test/output.test.ts`

- [ ] Implement the Git runner around `spawnSync("git", args, { cwd, env, encoding: "utf8", shell: false })`. Keep argument boundaries intact and convert nonzero results into typed Git errors with useful sanitized stderr.

- [ ] Expose these operations:

  ```
  export interface GitResult {
    status: number;
    stdout: string;
    stderr: string;
  }

  export interface GitRunner {
    run(args: string[], cwd: string): GitResult;
  }

  export function git(runner: GitRunner, args: string[], cwd: string): GitResult;
  export function gitFetch(runner: GitRunner, cwd: string): void;
  export function listWorktrees(runner: GitRunner, cwd: string): GitWorktree[];
  export function branchInUse(runner: GitRunner, cwd: string, branch: string): boolean;
  export function hasUnmergedCommits(runner: GitRunner, cwd: string, branch: string): boolean;
  export function branchHasUpstream(runner: GitRunner, cwd: string, branch: string): boolean;
  export function unmergedCommitSummary(runner: GitRunner, cwd: string, branch: string): string[];
  export function addWorktree(
    runner: GitRunner,
    cwd: string,
    worktreePath: string,
    branch: string,
    base: string,
    createBranch: boolean
  ): void;
  export function removeWorktree(
    runner: GitRunner,
    cwd: string,
    worktreePath: string,
    force: boolean
  ): void;
  export function deleteBranch(
    runner: GitRunner,
    cwd: string,
    branch: string,
    force: boolean
  ): void;
  ```

- [ ] Preserve fetch behavior, remote-tracking checks, branch-in-use checks, unmerged summaries, linked-worktree parsing, and branch deletion safety from the Python implementation.

- [ ] Port the deterministic city and word-pair name lists, collision-aware generation, maximum slot behavior, explicit names, and branch-name sanitization.

- [ ] Implement branch-template rendering for `{user}`, `{name}`, and `{slot}`. Reject unknown placeholders and invalid branches before Git is called.

- [ ] Implement human output plus the machine-readable sentinel. Normal output retains current command information, and cd mode emits exactly one `__cd__:<absolute-path>` line.

- [ ] Add temporary real repositories, bare origins, initial commits, configured remotes, and linked-worktree fixtures. Use a fake `GitRunner` for deterministic failure tests and real Git for parsing and lifecycle primitives.

- [ ] Run the focused tests and compare assertions against the existing Python suite.

- [ ] Commit:

  ```
  git add src/git.ts src/naming.ts src/template.ts src/output.ts test/fixtures.ts test/git.test.ts test/naming.test.ts test/template.test.ts test/output.test.ts
  git commit -m "feat: port Git and worktree presentation primitives"
  ```

## Task 5: Port worktree lifecycle commands and rollback behavior

**Files:** `src/worktrees.ts`, `src/commands/new.ts`, `src/commands/ls.ts`, `src/commands/cd.ts`, `src/commands/rm.ts`, `src/commands/index.ts`, `test/commands.test.ts`, `test/e2e.test.ts`

- [ ] Define these options and orchestration interfaces:

  ```
  export interface NewOptions {
    name?: string;
    branch?: string;
    from?: string;
    noSetup: boolean;
    cdAfterCreate: boolean;
  }

  export interface RemoveOptions {
    name: string;
    force: boolean;
    keepBranch: boolean;
  }

  export interface WorktreeServices {
    git: GitRunner;
    now: () => Date;
    random: () => number;
  }

  export function setupEnvironment(
    root: string,
    name: string,
    path: string,
    env: NodeJS.ProcessEnv
  ): NodeJS.ProcessEnv;

  export function runScripts(
    scripts: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    io: CliIO
  ): void;

  export function rollbackWorktree(
    services: WorktreeServices,
    root: string,
    path: string,
    branch: string,
    statePath: string,
    removeBranch: boolean
  ): void;

  export function runNew(
    context: CliContext,
    options: NewOptions,
    services?: WorktreeServices
  ): number;
  export function runLs(context: CliContext): number;
  export function runCd(context: CliContext, name?: string): number;
  export function runRm(
    context: CliContext,
    options: RemoveOptions,
    services?: WorktreeServices
  ): number;
  ```

- [ ] Implement `new` in this order: discover config and main root, fetch remotes, acquire the project lock, load state, reserve a unique name and slot, resolve branch/base and reject in-use branches, create the Git worktree, persist state atomically, release the lock, run setup outside the lock unless skipped, roll back Git and state if setup fails, then print details and the optional sentinel.

- [ ] Implement `ls` and `cd` with current selection rules, absolute paths, stale-state diagnostics, and no mutation. Default `cd` selects the current worktree when invoked inside one and otherwise follows current main-root behavior.

- [ ] Implement `rm` safety: reject unknown names and current worktrees, refuse unmerged commits without `--force`, run teardown before removal, remove the Git worktree, delete the branch unless `--keep-branch`, free state only after successful removal, and preserve recoverable diagnostics for partial failures.

- [ ] Run setup and teardown through `spawnSync(command, { cwd, env, shell: true, stdio: "inherit" })`. Set WT-specific environment variables without exposing internal identifiers in normal output.

- [ ] Extend fixtures with `makeRepository`, `writeConfig`, and `runCliProcess`. Test setup rollback, teardown failure, branch protection, explicit branch/from combinations, slot exhaustion, stale state, concurrent creates, and the complete new/list/cd/remove lifecycle.

- [ ] Run:

  ```
  npm run typecheck
  npm test -- --test-name-pattern="commands|e2e"
  ```

- [ ] Commit:

  ```
  git add src/worktrees.ts src/commands test/commands.test.ts test/e2e.test.ts
  git commit -m "feat: port worktree lifecycle commands"
  ```

## Task 6: Add complete CLI dispatch and shell initialization

**Files:** `src/cli.ts`, `src/commands/index.ts`, `src/shell-init.ts`, `shell/wt.sh`, `shell/wt.fish`, `shell/wt.ps1`, `test/cli.test.ts`, `test/shell-init.test.ts`

- [ ] Replace the scaffold parser with Node’s `node:util.parseArgs` and preserve:
  - global `-V`/`--version` and `-h`/`--help`;
  - `new [name]` with `-b`/`--branch`, `--from`, `--no-setup`/`--skip-setup`, and `--cd`;
  - `ls`/`list`;
  - `cd [name]`;
  - `rm name`/`remove name` with `--force` and `--keep-branch`;
  - `update` with `--check`;
  - `shell-init bash|zsh|fish|powershell`;
  - `help`.

- [ ] Route handlers through dependency-injected `CliContext`. Catch typed errors at the boundary, print concise stderr diagnostics, and return stable usage or operational exit codes.

- [ ] Implement `renderShellInit(shell): string`. Generated code invokes the installed `wt` executable, parses the first `__cd__` line, prints remaining output, and changes the parent shell only through explicit evaluation in the caller’s shell.

- [ ] Keep `shell/wt.sh` and `shell/wt.fish` as thin sentinel wrappers. Add `shell/wt.ps1` defining a PowerShell `wt` function that handles the sentinel with `Set-Location -LiteralPath`.

- [ ] Make shell initialization idempotent and profile-free by default. Standalone installation may add a managed source block for future Bash/Zsh sessions; npm installation must not edit profiles.

- [ ] Test generated shell syntax where available, ordinary-output preservation, sentinel consumption, paths with spaces, and the fact that parent-shell changes require explicit `eval` or shell dot-sourcing.

- [ ] Run:

  ```
  npm run typecheck
  npm test -- --test-name-pattern="cli|shell"
  bash -n shell/wt.sh
  zsh -n shell/wt.sh
  fish -n shell/wt.fish
  pwsh -NoProfile -Command "& { . ./shell/wt.ps1; 'loaded' }"
  ```

- [ ] Commit:

  ```
  git add src/cli.ts src/commands/index.ts src/shell-init.ts shell/wt.sh shell/wt.fish shell/wt.ps1 test/cli.test.ts test/shell-init.test.ts
  git commit -m "feat: add shell initialization and CLI dispatch"
  ```
## Task 7: Add channel-aware Node self-update

**Files:** `src/update.ts`, `src/runtime.ts`, `src/paths.ts`, `test/update.test.ts`, `test/channel.test.ts`

- [ ] Define update interfaces:

  ```
  export interface ReleaseInfo {
    tag: string;
    version: string;
    assets: Map<string, string>;
  }

  export function parseStableVersion(value: string): string | null;
  export function latestStableRelease(
    apiUrl: string,
    fetchImpl?: typeof fetch
  ): Promise<ReleaseInfo>;
  export function parseChecksums(contents: string): Map<string, string>;
  export function validateCliPayload(contents: Buffer, expectedVersion: string): void;
  export interface UpdateServices {
    apiUrl: string;
    fetchImpl: typeof fetch;
    executablePath: string;
    configDir: string;
    now: () => Date;
  }
  export function runUpdate(
    context: CliContext,
    checkOnly: boolean,
    services?: UpdateServices
  ): Promise<number>;
  ```

- [ ] Accept only stable GitHub Releases API results. Reject prereleases, drafts, malformed semantic versions, missing tags, missing `wt`, `wt.sh`, `wt.fish`, or `checksums.txt` assets, and asset URLs outside the expected repository release host.

- [ ] Parse SHA-256 checksum lines, verify every downloaded asset, and validate the Node payload’s shebang and embedded version.

- [ ] Detect channel in this order: matching standalone `install.json`, npm metadata with global/local distinction, source checkout, then unknown diagnostic. Ignore manual `WT_INSTALL_CHANNEL` values.

- [ ] For standalone, download assets to a temporary directory, revalidate checksums and versions, then atomically replace executable, shell integrations, and metadata. Keep the current installation intact if any step fails.

- [ ] For npm contexts, do not mutate package files. Print:

  ```
  Global install detected. Run: npm update -g @absolutepraya/wt
  Local install detected. Run: npm update -D @absolutepraya/wt
  ```

  For source checkouts, explain that the repository should be updated and rebuilt. `update --check` reports installed and latest stable versions without mutation.

- [ ] Test stable-release selection, malformed API data, checksum parsing, version mismatch, rollback, standalone/global/local/source detection, and untrusted environment override behavior.

- [ ] Run:

  ```
  npm run typecheck
  npm test -- --test-name-pattern="update|channel"
  ```

- [ ] Commit:

  ```
  git add src/update.ts src/runtime.ts src/paths.ts test/update.test.ts test/channel.test.ts
  git commit -m "feat: add channel-aware Node self-update"
  ```

## Task 8: Rewrite the standalone installer around the Node artifact

**Files:** `install.sh`, `scripts/check-installer.sh`, `scripts/installer-test-server.mjs`, `test/installer.test.ts`, `shell/wt.sh`, `shell/wt.fish`, `shell/wt.ps1`

- [ ] Define the normal install commands:

  ```
  curl -fsSL https://github.com/absolutepraya/wt/releases/latest/download/install.sh | bash
  npm install -g @absolutepraya/wt
  npm install -D @absolutepraya/wt
  ```

  Do not require a `WT_REF` pipe for ordinary installation.

- [ ] Retain testable overrides `PREFIX`, `WT_CONFIG_DIR`, `WT_RELEASE_API_URL`, and `WT_RELEASE_DOWNLOAD_BASE_URL`. Fix the default repository to `absolutepraya/wt`. In local source mode, require `dist/wt.cjs` and print exactly:

  ```
  wt installer: dist/wt.cjs is missing; run npm ci && npm run build first.
  ```

- [ ] Perform all prerequisite checks before creating directories or modifying files: curl or wget, Node 18+, Git, and macOS/Linux platform. Explain each missing prerequisite and exit nonzero.

- [ ] Fetch the Releases API, select the latest stable release, extract one exact tag, and download `wt`, `wt.sh`, `wt.fish`, and `checksums.txt` from that exact tag. The bootstrap URL may be `releases/latest/download/install.sh`, but payloads must use the resolved tag.

- [ ] Download all assets into a private temporary directory. Verify SHA-256 checksums with Node or an available utility. Validate the main payload’s Node shebang and embedded version before installing.

- [ ] Install atomically into `PREFIX/bin/wt`, `WT_CONFIG_DIR/wt.sh`, and `WT_CONFIG_DIR/wt.fish`. Write `WT_CONFIG_DIR/install.json` with channel, executable path, repository, tag, and installed timestamp. Never leave partial final files after a failed download or validation.

- [ ] Make managed Bash, Zsh, and Fish integration idempotent. Document an explicit PowerShell profile line because the Bash installer must not silently edit a Windows PowerShell profile. npm installs do not invoke this installer and do not edit profiles.

- [ ] Print a post-install summary distinguishing immediate absolute-path usability, possible PATH refresh, future-shell wrapper availability, and the explicit shell evaluation needed for current-shell directory changes.

- [ ] Add an isolated HTTP test server serving release metadata, exact-tag assets, bad checksums, missing assets, and newer versions. Test prerequisite failure, API failure, checksum failure, malformed payload, atomicity, overrides, local source installation, and idempotent profile changes. Assert failed installs create no final files.

- [ ] Run:

  ```
  bash -n install.sh
  bash scripts/check-installer.sh
  npm run typecheck
  npm test -- --test-name-pattern="installer"
  ```

- [ ] Commit:

  ```
  git add install.sh scripts/check-installer.sh scripts/installer-test-server.mjs test/installer.test.ts shell/wt.sh shell/wt.fish shell/wt.ps1
  git commit -m "feat: make standalone installer Node-based"
  ```

## Task 9: Verify local and global npm distribution

**Files:** `scripts/check-npm-package.mjs`, `test/package.test.ts`, `package.json`, `package-lock.json`

- [ ] Build and pack in a temporary directory. Inspect the tarball list and assert it contains `package.json` and `dist/wt.cjs`, excludes `src`, `test`, `tests`, `bin`, old `npm/wt.cjs`, and release scripts, and contains no development dependency tree.

- [ ] Test a local consumer by creating a temporary package, installing the tarball with `npm install -D`, running `npx --no-install wt --version` and `npx --no-install wt --help`, asserting the lockfile records the package, and proving no shell profiles change.

- [ ] Test a global consumer with an isolated npm prefix. Install with `npm install --global --prefix $globalPrefix`, run the platform-specific binary from that prefix, check version and help, and prove no profiles change.

- [ ] Verify the npm bin shim resolves the same bundled artifact in both modes and no Python interpreter is required.

- [ ] Run:

  ```
  npm run check
  npm run pack:check
  npm run smoke:npm
  ```

- [ ] Commit:

  ```
  git add scripts/check-npm-package.mjs test/package.test.ts package.json package-lock.json
  git commit -m "test: cover local and global npm distribution"
  ```

## Task 10: Make CI and releases build and publish one artifact

**Files:** `.github/workflows/ci.yml`, `scripts/check-version.mjs`, `scripts/build-release.mjs`, `test/release.test.ts`, `docs/RELEASING.md`

- [ ] Implement `scripts/check-version.mjs` to read `package.json` as canonical source, verify the generated artifact embeds the same version, support `--print`, and support an explicit check such as `--tag v0.4.0`.

- [ ] Implement `scripts/build-release.mjs` with a JSDoc-documented result shape:

  ```
  /**
   * @typedef {{
   *   directory: string,
   *   tarball: string,
   *   version: string,
   *   tag: string
   * }} ReleaseBuild
   */
  ```

  Build `dist/wt.cjs`, copy it to asset `wt`, copy the POSIX shell integrations, copy `install.sh`, create the npm tarball, and write `checksums.txt` covering every published asset. Make the release directory deterministic and free of credentials and source paths.

- [ ] Replace the Python matrix with Node 18, 20, 22, and 24 on Ubuntu, macOS, and Windows. Every matrix job runs `npm ci`, typecheck, Node tests, version checks, pack checks, and npm smoke checks. Keep POSIX installer tests on Ubuntu/macOS and add Windows command, lock, shell-init, and package smoke coverage.

- [ ] Keep one release job gated on all required checks. Grant only GitHub contents write and npm Trusted Publishing ID-token permissions. Build from checked-out main, verify tag and checksums, publish npm with public access, create or update the matching GitHub Release, and upload exactly `wt`, `wt.sh`, `wt.fish`, `install.sh`, the npm tarball, and `checksums.txt`.

- [ ] Preserve idempotency: a merged version bump publishes once, a same-version rerun reuses existing package/release when hashes match, a main push without a package version change skips publication, and a same-version hash conflict fails.

- [ ] Document Trusted Publishing settings without tokens: package name, owner/repository, workflow filename, optional environment, and required Actions permissions.

- [ ] Add tests for version mismatch, asset list, checksum determinism, duplicate release behavior, and same-version hash conflict.

- [ ] Run:

  ```
  npm run build
  npm run check-version -- --print
  npm run check-version -- --tag v0.3.1
  node scripts/build-release.mjs
  ```

- [ ] Commit:

  ```
  git add .github/workflows/ci.yml scripts/check-version.mjs scripts/build-release.mjs test/release.test.ts docs/RELEASING.md
  git commit -m "ci: build and release one Node artifact"
  ```

## Task 11: Update README, durable guidance, ADRs, changelog, and migration docs

**Files:** `README.md`, `AGENTS.md`, `docs/adr/0001-npm-adapter-distribution.md`, `docs/adr/0002-automated-releases-and-self-update.md`, `docs/RELEASING.md`, `CHANGELOG.md`, `skills/wt/SKILL.md`

- [ ] Rewrite the README opening to state: WT is an agent-first Git worktree manager for LLM agents, allowing several agents to work on the same project concurrently through one manager regardless of which coding agent is used.

- [ ] Add badges for CI status, current npm version, npm downloads if available, latest GitHub release, supported Node version, and license. Tie URLs to the actual repository and package.

- [ ] Document the exact standalone, global npm, and local npm commands:

  ```
  curl -fsSL https://github.com/absolutepraya/wt/releases/latest/download/install.sh | bash
  npm install -g @absolutepraya/wt
  npm install -D @absolutepraya/wt
  ```

  Explain that standalone is the only mode with `wt update` self-mutation, npm users update through npm, and source checkouts update through Git.

- [ ] Document Node 18+ and Git prerequisites, supported OSes, path behavior, shell wrappers, immediate versus future shell availability, and the parent-shell limitation of child processes.

- [ ] Document `wt shell-init bash`, `zsh`, `fish`, and `powershell` with explicit evaluation or profile-loading examples. State that npm never edits profiles.

- [ ] Document commands and flags, configuration, state behavior, setup/teardown environment, safety rules, release assets, checksum verification, and the one-time migration for Python-based standalone 0.3.x users.

- [ ] Update `AGENTS.md` so Node is canonical, `dist/wt.cjs` is the shared npm/standalone artifact, the test matrix is Node 18/20/22/24 on Ubuntu/macOS/Windows, and project release/worktree safety rules remain explicit.

- [ ] Update both ADRs and `docs/RELEASING.md` with the migration, exact asset contract, Trusted Publishing flow, version source of truth, idempotency, and installer rollback guarantees.

- [ ] Add a concise changelog entry for unified Node distribution, npm global/local support, cross-platform shell-init, release-based installer, and one-time Python migration.

- [ ] Search tracked docs and scripts for stale Python-runtime, required `WT_REF`, thin-launcher, old-asset, and manual-publish instructions. Keep historical material only when labeled historical.

- [ ] Run:

  ```
  rg -n "Python|python|WT_REF|npm/wt.cjs|bin/wt|npm publish|manual release" README.md AGENTS.md docs CHANGELOG.md .github install.sh scripts src shell
  git diff --check
  ```

  Review every match and remove obsolete current instructions without deleting useful historical rationale.

- [ ] Commit:

  ```
  git add README.md AGENTS.md docs CHANGELOG.md .github install.sh scripts src shell
  git commit -m "docs: document unified Node distribution"
  ```

## Task 12: Remove Python distribution paths after parity and run the final gate

**Files:** `bin/wt`, `npm/wt.cjs`, `scripts/check-version.py`, `scripts/check-npm-package.sh`, `tests/conftest.py`, `tests/test_*.py`, `.github/workflows/ci.yml`, `package.json`, `README.md`

- [ ] Confirm the TypeScript suite covers every behavior in the Python suite. Compare command, error, state, lock, update, package, installer, shell, and release assertions before deletion.

- [ ] Remove the old Python CLI, thin npm adapter, Python-only scripts, and Python tests. Remove stale Python dependencies, package files, and CI steps. Preserve only historical migration prose.

- [ ] Verify the package contains one CLI implementation and the standalone release uses exactly the same built bytes as npm’s `dist/wt.cjs` payload.

- [ ] Run the full local gate:

  ```
  npm ci
  npm test
  npm run check
  npm run check-version
  npm run pack:check
  npm run smoke:npm
  bash -n install.sh
  bash scripts/check-installer.sh
  git diff --check
  git status --short --branch
  ```

- [ ] Run available platform checks:

  ```
  zsh -n shell/wt.sh
  fish -n shell/wt.fish
  pwsh -NoProfile -Command "& { . ./shell/wt.ps1; 'loaded' }"
  ```

- [ ] Inspect the final tarball and release directory for source paths, credentials, temporary files, stale Python references, and extra release artifacts.

- [ ] Review the branch diff from `origin/main`, preserve unrelated changes, and verify the worktree is clean except for intentional committed work.

- [ ] Commit cleanup:

  ```
  git add -u bin/wt npm/wt.cjs scripts/check-version.py scripts/check-npm-package.sh tests/conftest.py tests/test_commands.py tests/test_config.py tests/test_e2e.py tests/test_git_ops.py tests/test_naming.py tests/test_npm_package.py tests/test_state.py tests/test_template.py tests/test_update.py .github/workflows/ci.yml package.json README.md
  git commit -m "refactor: remove Python distribution paths"
  ```

- [ ] Push with upstream tracking:

  ```
  git push -u origin absolutepraya/npm-install-ux
  ```

- [ ] Before asking for merge, report the exact commit, branch, CI run, package smoke result, installer result, release dry-run result, and any platform checks unavailable locally.

## Final Acceptance Checklist

- [ ] `wt --version` and `wt -V` report the package version from the bundled Node artifact.
- [ ] `wt new`, `wt ls`, `wt list`, `wt cd`, `wt rm`, `wt remove`, and `wt update --check` preserve the current contract.
- [ ] `wt shell-init` works for Bash, Zsh, Fish, and PowerShell.
- [ ] Standalone install uses the short GitHub Releases URL, requires no ordinary `WT_REF` pipe, verifies checksums, and installs atomically.
- [ ] Standalone install stops before writes when Node 18+ or Git is missing.
- [ ] Standalone install is immediately runnable through its absolute path and announces PATH or current-shell refresh needs.
- [ ] Python standalone 0.3.x users have a documented one-time migration step.
- [ ] Global npm install works without profile edits.
- [ ] Local npm install works through `npx --no-install wt` without profile edits.
- [ ] npm update guidance is correct for global and local installs.
- [ ] Node 18, 20, 22, and 24 pass on Ubuntu, macOS, and Windows.
- [ ] Every merged package version publishes npm and creates or updates the matching GitHub Release exactly once.
- [ ] GitHub Release assets include `wt`, `wt.sh`, `wt.fish`, `install.sh`, the npm tarball, and `checksums.txt`.
- [ ] npm and standalone use one bundled artifact, with no permanent Python runtime path.
- [ ] Documentation describes WT as an agent-first, coding-agent-agnostic worktree manager and contains current CI, npm, release, install, update, and migration instructions.
