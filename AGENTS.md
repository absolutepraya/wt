# Repository instructions

These instructions apply to the `wt` repository and complement runtime-level
instructions.

## Project model

- WT is a Node.js CLI. `src/` is the implementation source and `dist/wt.cjs`
  is the single bundled artifact used by both npm and standalone releases.
- `package.json` is the package and release version source of truth. The
  bundled artifact and stable release tag must match its `X.Y.Z` version.
- `skills/wt/SKILL.md` is shipped agent guidance. Keep it aligned with the
  current commands, installation modes, and safety behavior.
- `.wt/config.toml` is project configuration. It uses `.worktrees`,
  `origin/main`, city names, and `{user}/{name}` by default.
- `CONTEXT.md` is intentionally local-only and ignored. Do not recreate or
  commit it.

## Worktree workflow

- Do not implement changes in the main worktree. Create a named worktree from
  the repository root with `~/.local/bin/wt new <name>` and use the path shown
  by the command.
- Keep unrelated worktree changes untouched. Inspect the exact diff before
  committing and stage explicit paths only.
- Push a new branch with `git push -u origin <branch>` only after approval.
- Do not use raw `git worktree add` for normal repository work because this
  project is configured for WT.
- Agents should use `wt new` without `--cd`. A child process cannot change the
  working directory of its parent agent process.

## Validation

The CI matrix runs Node 18, 20, 22, and 24 on Ubuntu, macOS, and Windows.
POSIX installer tests run on Unix runners, while the Windows job runs the
cross-platform Node test subset and npm smoke checks.

```bash
npm ci
npm test
npm run check
npm run check-version
npm run pack:check
npm run smoke:npm
bash -n install.sh
bash scripts/check-installer.sh
git diff --check
```

When available, use `mise exec node@22.21.1 -- <command>` for the pinned local
Node runtime.

## Distribution and releases

- Standalone installation is macOS/Linux only and uses the latest stable
  GitHub Release. It requires Node.js 18+ and Git, verifies checksums, and
  atomically replaces the executable and shell wrappers with rollback on
  installation or smoke-test failure.
- npm global and local installations support macOS, Linux, and Windows. npm
  never edits shell profiles. npm-managed installations update through npm.
- Source checkouts update through Git. `wt update` may self-update only a
  standalone installation.
- A release is built from merged `main` only. CI uses one `dist/wt.cjs` build
  for npm and standalone assets, verifies `vX.Y.Z`, and publishes through npm
  Trusted Publishing with GitHub Actions OIDC.
- A release contains `wt`, `wt.sh`, `wt.fish`, `install.sh`, the exact npm
  tarball, and `checksums.txt`. The checksum manifest covers every other
  release asset.
- Do not push, publish, create tags, or create GitHub Releases from a feature
  branch. Never commit npm tokens or other credentials.

## User-facing documentation

Keep `README.md`, `CHANGELOG.md`, `docs/adr/`, `docs/RELEASING.md`, and
`skills/wt/SKILL.md` consistent with the bundled Node distribution, shell
initializers, migration guidance, and release contract.
