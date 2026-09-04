# Task 12 report: remove Python distribution paths

## Parity evidence captured before deletion

The legacy Python suite contained 77 test functions across nine files. The
behavior assertions were mapped to the Node suite as follows:

| Python assertions | Node coverage | Result |
| --- | --- | --- |
| `tests/test_commands.py` (33) | `test/cli.test.ts`, `test/commands.test.ts`, `test/e2e.test.ts`, `test/output.test.ts`, `test/errors.test.ts` | Covered command flags, aliases, lifecycle, setup and teardown rollback, safety prompts, exit codes, output sentinels, and sanitized errors. |
| `tests/test_config.py` (6) | `test/config.test.ts`, `test/paths.test.ts` | Covered config discovery, defaults, malformed values, strategy validation, and path safety. |
| `tests/test_e2e.py` (1) | `test/e2e.test.ts` | Covered the subprocess lifecycle for create, list, current directory output, and removal. |
| `tests/test_git_ops.py` (7) | `test/git.test.ts` | Covered fetch failures, worktree parsing, linked worktrees, checked-out branches, and upstream-aware unmerged checks. |
| `tests/test_naming.py` (7) | `test/naming.test.ts` | Covered inventories, generated names, collisions, fallback, and branch-name validation. |
| `tests/test_npm_package.py` (4) | `test/package-manifest.test.ts`, `test/package.test.ts`, `test/channel.test.ts`, `test/runtime.test.ts` | Covered the `dist/wt.cjs` bin target, package boundary, local and global npm consumers, version/help forwarding, profile nonmutation, and channel detection. |
| `tests/test_state.py` (11) | `test/state.test.ts`, `test/paths.test.ts`, `test/commands.test.ts` | Covered project identity, state paths, round trips, empty and malformed state, slot allocation, capacity, interrupted writes, generation safety, and lifecycle state mutation. |
| `tests/test_template.py` (3) | `test/template.test.ts` | Covered rendering, date substitution, and invalid tokens. |
| `tests/test_update.py` (5) | `test/update.test.ts`, `test/channel.test.ts`, `test/runtime.test.ts` | Covered source and npm refusal, stable release checks, checksums, payload validation, atomic replacement and rollback, and channel-specific guidance. |
| Python lock assertions embedded in command/state tests | `test/locking.test.ts`, `test/commands.test.ts` | Covered contention, stale recovery, live-owner protection, token ownership, cleanup, and concurrent lifecycle serialization. |
| No legacy Python installer, shell, or release test files | `test/installer.test.ts`, `test/shell-init.test.ts`, `test/release.test.ts`, `test/package.test.ts` | Covered the newer standalone installer, shell-init, release asset, checksum, and CI gate contracts. |

The mapping was completed before removing the legacy files. The Node suite is
the sole executable behavior suite after this cleanup.

## Deleted distribution paths

- `bin/wt`
- `npm/wt.cjs`
- `scripts/check-version.py`
- `scripts/check-npm-package.sh`
- `tests/conftest.py`
- `tests/test_commands.py`
- `tests/test_config.py`
- `tests/test_e2e.py`
- `tests/test_git_ops.py`
- `tests/test_naming.py`
- `tests/test_npm_package.py`
- `tests/test_state.py`
- `tests/test_template.py`
- `tests/test_update.py`

The stale `bin/wt` installer-contract check was removed from
`scripts/check-installer.sh`. No Python runtime dependency or Python package
entry remains. Historical migration prose remains explicitly labeled in the
README, changelog, ADRs, and releasing guide.

## Preserved distribution contract

- `package.json.bin.wt` is `dist/wt.cjs`, and `files` contains only
  `dist/wt.cjs`.
- The npm smoke test verifies local and global shims execute the same bytes as
  the repository `dist/wt.cjs` artifact.
- `scripts/build-release.mjs` copies that same artifact to the standalone
  `wt` asset and packs the npm tarball from the same build.
- No shipped runtime path invokes Python. The runtime requirement is Node.js
  18 or newer plus Git.

## Required local gate

All required local commands passed:

- `npm ci`: passed, 9 packages added, 0 vulnerabilities.
- `npm test`: passed, 96 tests total, 94 passed, 2 expected Windows skips.
- `npm run check`: passed typecheck, build, and bundled artifact syntax check.
- `npm run check-version`: passed, version `0.3.1` is consistent.
- `npm run pack:check`: passed, tarball contains exactly 4 files: LICENSE,
  README.md, `dist/wt.cjs`, and package.json.
- `npm run smoke:npm`: passed local and global installs, shim identity,
  version/help execution, lockfile recording, and profile nonmutation.
- `bash -n install.sh`: passed.
- `bash scripts/check-installer.sh`: passed.
- `git diff --check`: passed.
- `git status --short --branch`: clean after the intentional cleanup commit.

## Platform and artifact inspection

- `zsh -n shell/wt.sh`: passed.
- `fish -n shell/wt.fish`: unavailable, `fish` is not installed locally.
- PowerShell load check: unavailable, `pwsh` is not installed locally.
- Release build produced exactly six files: `wt`, `wt.sh`, `wt.fish`,
  `install.sh`, `absolutepraya-wt-0.3.1.tgz`, and `checksums.txt`.
- Release checksum verification passed for all five payload assets, and the
  standalone `wt` bytes matched repository `dist/wt.cjs` exactly.
- The npm tarball listing contained only `package/LICENSE`,
  `package/dist/wt.cjs`, `package/package.json`, and `package/README.md`.
- Credential-shaped strings, temporary files, Python runtime files, and old
  launcher paths were absent from the release payloads. Python mentions that
  remain in the package README are explicitly historical migration prose.
- Native Windows and hosted macOS/Windows CI were not available in the local
  environment; CI remains the cross-platform gate.
