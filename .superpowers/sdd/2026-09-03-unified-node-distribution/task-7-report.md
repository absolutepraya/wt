# Task 7 Report: Channel-Aware Node Self-Update

## Files

- `src/update.ts`: stable-release lookup, strict release asset URL checks, checksum parsing and verification, Node payload validation, nonmutating managed-channel guidance, and staged standalone replacement with rollback backups.
- `src/runtime.ts`, `src/paths.ts`: trusted standalone metadata matching, npm global versus local channel detection, source detection, and shared standalone metadata-path helpers.
- `src/commands/index.ts`: replaces the Task 6 update stub by exporting the Task 7 implementation without changing the CLI dispatch interface.
- `test/update.test.ts`, `test/channel.test.ts`: stable semver and malformed release coverage, checksum and payload validation, no-mutation check mode, preserved files after validation failure, standalone installation replacement, channel precedence, ignored environment override, and exact npm guidance.
- `test/cli.test.ts`: updates the former Task 6 placeholder expectation so source checkout guidance is exercised without a network request.

## Tests

Passed:

- `npm run typecheck`
- `npm test -- --test-name-pattern="update|channel"` (72 passing, 2 existing Windows-only skips)
- `npm test` (72 passing, 2 existing Windows-only skips)
- `npm run check`
- `npm run pack:check`
- `npm run smoke:npm`
- `node dist/wt.cjs update --check`
- `node dist/wt.cjs --version`
- `git diff --check`

## Concerns

- A multi-file replacement cannot be a single filesystem operation. The updater stages every payload before replacement, renames old files to same-directory rollback names, restores in reverse order on failure, and retains rollback files rather than deleting them if restoration itself fails.
- Native Windows update replacement behavior remains deferred to the planned Windows CI matrix. The implementation uses Node filesystem primitives and avoids shell-specific update logic.

## Deferred observations

- Task 8 owns installer migration, managed profile blocks, and initial standalone installation. This task only consumes matching standalone metadata and writes refreshed metadata after a verified update.
- npm and source installs intentionally do not download or mutate package files when `wt update` is invoked. No profiles, npm package files, release records, credentials, ledger entries, remote refs, or publication state were changed.
