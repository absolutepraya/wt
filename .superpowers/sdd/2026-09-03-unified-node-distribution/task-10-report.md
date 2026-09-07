# Task 10 fix-round report

## Scope

Preserved the existing Task 10 edits and made only these corrections:

- Removed the duplicate Windows command, lock, package, and shell-init test
  invocation from the CI matrix. POSIX installer tests remain excluded on
  Windows.
- Added focused coverage proving that a not-found-looking GitHub error with an
  unexpected exit status fails closed.

No Task 11 files, real `gh` calls, pushes, npm publishes, or releases were
performed.

## Checks and evidence

Environment: Node `v26.3.1`, npm `11.16.0`.

- `node --check scripts/release-gates.mjs`: passed.
- `node --check test/release.test.ts`: passed.
- `npx tsx --test test/release.test.ts`: passed, 8 tests, 0 failures.
  Coverage includes unchanged-main skip, same-version npm reuse, missing
  package publish, npm and release hash conflicts, tag/commit conflict, and
  fail-closed GitHub release lookup.
- `npm test`: passed, 94 tests, 2 platform skips, 0 failures.
- `npm run check`: passed.
- `npm run pack:check`: passed with exactly 4 npm package files.
- `npm run smoke:npm`: passed with local and global consumer checks.
- `git diff --check`: passed.
- Workflow YAML parse with Ruby Psych: passed.

## Limitations

`actionlint` is not installed locally, so dedicated GitHub Actions linting was
not available. Native Windows and macOS hosted CI were not run locally. No
external release action was performed.
