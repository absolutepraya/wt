# Task 8 Report: Node-Based Standalone Installer

## Files

- `install.sh`: replaces the legacy Python/raw-branch installer with a macOS/Linux Node 18+ bootstrap. It preflights platform, downloader, Node, and Git before final-path mutation; resolves one stable exact release tag; downloads only exact-tag assets to a private temporary directory; validates SHA-256 checksums, the Node shebang, and the embedded release version; then stages and atomically replaces the executable, POSIX wrappers, and standalone metadata.
- `scripts/check-installer.sh`: syntax and static contract check for the release API/download overrides, Node/Git prerequisites, managed block, exact local-source diagnostic, and removal of the Python/`WT_REF` contract.
- `scripts/installer-test-server.mjs`: isolated loopback release fixture for normal, newer, API-error, checksum-error, missing-asset, and malformed-payload responses.
- `test/installer.test.ts`: exercises exact-tag downloads, override paths, metadata, preflight and failed-install final-file invariants, API/checksum/missing/malformed failures, idempotent Bash/Zsh/Fish managed blocks, local-source installation, and the exact missing-dist message.

## Tests

Passed:

- `bash -n install.sh`
- `bash scripts/check-installer.sh`
- `npm run typecheck`
- `npx tsx --test --test-name-pattern='installer' test/installer.test.ts` (4 passing)
- `npm test` (80 passing, 2 existing Windows-only skips)
- `npm run check`
- `npm run pack:check`
- `npm run smoke:npm`
- `zsh -n shell/wt.sh`
- `git diff --check`

## Concerns

- Initial installation is a multi-file operation. The installer validates every downloaded payload before it creates final directories, stages each output beside its destination, moves replaced files to same-directory backups, and restores them in reverse order on replacement failure.
- Fish and PowerShell are unavailable in this environment, so their native syntax commands could not run. Existing Task 6 wrappers remain unchanged; the installer tests verify the Fish managed block content and the post-install summary gives the explicit PowerShell profile line without editing a PowerShell profile.

## Deferred observations

- Release assembly and publication remain later tasks. This installer expects the planned exact-tag `wt`, `wt.sh`, `wt.fish`, and `checksums.txt` release assets.
- No credentials, release publication, push, merge, profile changes outside isolated test homes, or SDD ledger changes were made.
