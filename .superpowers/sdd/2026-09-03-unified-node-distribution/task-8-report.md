# Task 8 Report: Node-Based Standalone Installer

## Files

- `install.sh`: replaces the legacy Python/raw-branch installer with a macOS/Linux Node 18+ bootstrap. It preflights platform, downloader, Node, and Git before final-path mutation; resolves one stable exact release tag; follows API and asset redirects manually through a strict release/CDN allowlist; downloads only exact-tag assets to a private temporary directory; validates SHA-256 checksums, the Node shebang, the embedded release version, and direct version/help startup; then stages and atomically replaces the executable, POSIX wrappers, and standalone metadata with rollback.
- `scripts/check-installer.sh`: syntax and static contract check for the release API/download overrides, Node/Git prerequisites, managed block, exact local-source diagnostic, and removal of the Python/`WT_REF` contract.
- `scripts/installer-test-server.mjs`: isolated loopback release fixture for normal, newer, API-error, checksum-error, missing-asset, malformed-payload, redirect, and startup-smoke responses.
- `test/installer.test.ts`: exercises exact-tag downloads, override paths, metadata, preflight and failed-install final-file invariants including a forced later move failure, arbitrary direct-origin rejection, malicious and valid constrained CDN redirects, redirect limits, API/checksum/missing/malformed failures, startup smoke failure, hostile shell paths, malformed managed blocks, idempotent Bash/Zsh/Fish managed blocks, local-source installation, and the exact missing-dist message.

## Tests

Passed:

- `bash -n install.sh`
- `bash scripts/check-installer.sh`
- `npm run typecheck`
- `npx tsx --test test/installer.test.ts` (9 passing in the final focused run)
- `npm test` (80 passing, 2 existing Windows-only skips, run before the final summary-only correction)
- `npm run check`
- `npm run pack:check`
- `npm run smoke:npm`
- `zsh -n shell/wt.sh`
- `git diff --check`

## Concerns

- Initial installation is a multi-file operation. The installer validates every downloaded payload before it creates final directories, stages each output beside its destination, moves replaced files to same-directory backups, and restores them in reverse order on replacement failure. A forced later destination move failure is covered and verifies the complete prior installation is restored.
- Redirects are followed manually with a bounded hop count. API redirects remain on the expected release endpoint, asset redirects remain on the exact release URL or approved GitHub asset CDN path, and malicious or looping fixtures fail before final files are changed.
- Initial API and asset URLs are admitted only for the exact official GitHub endpoints or loopback fixture hosts. An arbitrary direct origin is rejected before any request or final-file mutation.
- The installed binary is invoked by absolute path with both `--version` and `--help` before profile integration. A startup-smoke failure restores the prior files or reports retained rollback artifacts.
- Managed profile blocks reject malformed marker layouts without rewriting the profile. Bash/Zsh/Fish integration and summary paths are shell-escaped, with hostile path fixtures covering spaces, quotes, backslashes, and command-substitution-looking text.
- Native Windows was not run. Fish and PowerShell are unavailable in this environment, so their native syntax commands could not run. Existing Task 6 wrappers remain unchanged; the installer tests verify the Fish managed block content and the post-install summary gives the explicit PowerShell profile line without editing a PowerShell profile.

## Deferred observations

- Release assembly and publication remain later tasks. This installer expects the planned exact-tag `wt`, `wt.sh`, `wt.fish`, and `checksums.txt` release assets.
- No credentials, release publication, push, merge, profile changes outside isolated test homes, or SDD ledger changes were made.
