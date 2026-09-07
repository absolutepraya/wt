# Task 9 report: verify local and global npm distribution

## Files

- `scripts/check-npm-package.mjs`: isolated npm pack, package-boundary, local-consumer, global-consumer, shim, Node-only runtime, lockfile, and shell-profile checks.
- `test/package.test.ts`: focused test entry point for the npm distribution smoke.
- `package.json`: unchanged, existing Task 9 npm scripts were used.
- `package-lock.json`: unchanged, existing dependency lock state remains intact.

## Checks and evidence

- `npm run check` passed: TypeScript typecheck, build, and bundled artifact syntax check.
- `npm run pack:check` passed. The packed tarball contained exactly `LICENSE`, `README.md`, `dist/wt.cjs`, and `package.json`.
- `npm run smoke:npm` passed. The tarball contained `package.json` and `dist/wt.cjs`, and excluded source, test, legacy launcher, release scripts, and dependency-tree paths.
- The local consumer installed the tarball with `npm install --save-dev`, recorded `@absolutepraya/wt@0.3.1` as a development dependency in its lockfile, and passed `npx --no-install wt --version` and `wt --help`.
- The global consumer installed with an isolated npm prefix and passed the prefix binary `wt --version` and `wt --help` checks.
- Local and global npm bin shims were verified against the installed `dist/wt.cjs` artifact and the repository build output.
- Local and global executable checks used a Node-only `PATH`; the bundled artifact contains no Python reference.
- Local and global npm install and command phases left Bash, Zsh, Fish, and PowerShell profile paths unchanged.
- `npx tsx --test test/package.test.ts` passed: 1 test.
- `git diff --check` passed.

## Limitations

- Native Windows execution was not available in this environment, so Windows npm shim and prefix behavior remain for the Task 10 CI matrix.
- Fish and PowerShell runtimes were not installed locally. Their profile paths are included in the no-mutation snapshot, while their standalone shell behavior remains covered by the installer and later cross-platform CI work.
