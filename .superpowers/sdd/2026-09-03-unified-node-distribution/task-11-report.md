# Task 11 report

## Scope

Documentation for the unified Node.js distribution only. No implementation,
CI, package scripts, release code, or Task 12 cleanup was changed.

## Files

- `README.md`
- `AGENTS.md`
- `docs/adr/0001-npm-adapter-distribution.md`
- `docs/adr/0002-automated-releases-and-self-update.md`
- `docs/RELEASING.md`
- `CHANGELOG.md`
- `skills/wt/SKILL.md`

## Evidence

- README now identifies WT as an agent-first Git worktree manager for LLM
  agents and documents concurrent, coding-agent-agnostic worktree management.
- README badges point to the repository CI workflow, npm package, npm download
  page, GitHub Releases, Node.js, and the MIT license. Read-only registry and
  release checks confirmed `@absolutepraya/wt@0.3.1` and stable `v0.3.1`.
- README documents the exact standalone, global npm, local npm, and source
  commands, installation paths, shell-init evaluation, child-process behavior,
  commands and flags, config, state, setup and teardown environment, safety,
  release assets, checksum validation, and Python 0.3.x migration.
- AGENTS and the WT skill now treat Node.js and `dist/wt.cjs` as canonical and
  describe the Node 18, 20, 22, and 24 matrix on Ubuntu, macOS, and Windows.
- ADR 0001 records the unified artifact and distribution boundary. ADR 0002
  and `docs/RELEASING.md` record version source of truth, Trusted Publishing,
  the exact six-asset release contract, idempotency, migration, and installer
  rollback guarantees.
- CHANGELOG includes the unified Node distribution, npm modes, four shell
  initializers, release installer, and one-time Python migration.

## Required stale-reference review

Ran:

```bash
rg -n "Python|python|WT_REF|npm/wt\.cjs|bin/wt|npm publish|manual release" README.md AGENTS.md docs CHANGELOG.md .github install.sh scripts src shell
```

Reviewed every match:

- `README.md`, ADRs, `docs/RELEASING.md`, and `CHANGELOG.md` mention Python
  only for the explicitly labeled historical 0.3.x migration or historical
  rationale. `WT_REF` is mentioned only to state that ordinary installs do
  not require it. `npm publish` is mentioned only in the prohibition against
  manual feature-branch publishing.
- `~/.local/bin/wt` matches `bin/wt` because it is the current documented
  standalone installation path, not the removed Python source path.
- `.github/workflows/ci.yml` contains the real automated `npm publish` step,
  which is current release behavior and is intentionally retained.
- `scripts/check-version.py` and its old source-path references remain for the
  explicitly planned Task 12 removal and were not touched in this docs-only
  task.
- `scripts/check-installer.sh` uses `WT_REF`, `python3`, and `bin/wt` in a
  negative stale-contract assertion. `scripts/installer-test-server.mjs`
  emits a Python shebang only as a malformed-installer rejection fixture.
  `scripts/check-npm-package.mjs` checks that the artifact does not contain
  Python and that the old npm launcher is not packed. These are validation
  safeguards, not current installation instructions.
- The approved plan and design spec retain migration history, old paths, and
  Task 12 deletion instructions. They are planning records and were outside
  the seven-file Task 11 documentation scope.
- No current documentation references `npm/wt.cjs` as an installable path.

## Checks

- `git diff --check` passed.
- Task 11 fix round 1 assertions passed for the installer-only smoke and
  rollback wording, shell rc/config sourcing qualification, channel-specific
  `wt update --check` behavior, and delegated workflow status.
- No em dash characters found in the seven changed documentation files.
- Changed-file review confirmed only the seven requested docs plus this SDD
  report were modified.
- No push, publish, tag, PR, merge, profile mutation, or credential access was
  performed.

## Limitations

- This docs-only task did not rerun the implementation or hosted CI test
  matrix. Those checks were completed and reviewed in Tasks 8 and 10.
- Native Windows, Fish, and PowerShell execution is provided by the hosted CI
  matrix and was not run locally.
- Delegated implementation and review completed normally. This fix round
  addresses the review findings in the scoped documentation directly.
