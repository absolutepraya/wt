# Repository instructions

These instructions apply to the `wt` repository and complement the user's and
runtime-level instructions.

## Project model

- `bin/wt` is the canonical implementation of the CLI. Keep its behavior
  independent of Node and external Python packages.
- `npm/wt.cjs` is a thin Node launcher for project-local npm installs. It must
  forward to `bin/wt` rather than reimplementing worktree behavior.
- `skills/wt/SKILL.md` is shipped agent guidance. Keep it aligned with the
  commands and safety behavior implemented by the CLI.
- `.wt/config.toml` is the repository's worktree configuration. It uses
  `.worktrees`, `origin/main`, city names, and `{user}/{name}` branches.
- `CONTEXT.md` is intentionally local-only and ignored. Do not recreate or
  commit it.

## Worktree workflow

- Do not implement changes in the main worktree. Create a named worktree from
  the repository root with `~/.local/bin/wt new <name>` and use the path shown
  by the command.
- Keep unrelated worktree changes untouched. Inspect the exact diff before
  committing.
- Push a new branch with `git push -u origin <branch>`.
- Do not use raw `git worktree add` for normal repository work because this
  project is configured for `wt`.

## Validation

Run the checks relevant to the change. The full CI matrix covers Python 3.11,
3.12, and 3.13 on Ubuntu and macOS, plus npm smoke tests on Node 18, 20, and
22.

```bash
python -m pytest -q tests/
python -c "import ast; ast.parse(open('bin/wt').read())"
python bin/wt --help
npm run check
npm run pack:check
bash scripts/check-npm-package.sh
git diff --check
```

Use `mise exec node@22.21.1 -- <command>` for the pinned local Node runtime
when the repository's mise configuration is available.

## Documentation and releases

- Keep `README.md`, `CHANGELOG.md`, `docs/adr/`, and `skills/wt/SKILL.md`
  consistent with user-facing behavior and distribution changes.
- The project-local npm package is `@absolutepraya/wt`. Its package version is
  defined in `package.json`.
- Publish only from merged `main`, after validating the packed artifact. Tag
  the release as `vX.Y.Z`, publish the public package, and verify the registry
  version plus a clean consumer install.
- Do not describe the npm package as available from the registry until a
  registry lookup confirms the publication.
- Never commit credentials, npm tokens, generated local context, or unrelated
  machine-specific files.
