# Releasing WT

`package.json` is the only release version source of truth. For a stable
version `X.Y.Z`, CI must produce:

- `dist/wt.cjs` with the embedded version `X.Y.Z`;
- npm package `@absolutepraya/wt@X.Y.Z`; and
- Git tag `vX.Y.Z`.

The release job builds `dist/wt.cjs` once and reuses those bytes for the npm
package and standalone `wt` asset.

## One-time npm Trusted Publishing setup

Configure the public `@absolutepraya/wt` package at npmjs.com. Do not add npm
tokens, personal access tokens, or other credentials to the repository or
GitHub Actions secrets.

1. Open the package settings and choose `Trusted Publisher`.
2. Select `GitHub Actions`.
3. Set the owner or organization to `absolutepraya`.
4. Set the repository to `wt`.
5. Set the workflow filename to `ci.yml`, without `.github/workflows/`.
6. Leave the environment name blank unless the workflow is deliberately
   changed to use one.
7. Save the publisher configuration.

The release job uses GitHub Actions OIDC. Its write permissions are limited
to `id-token: write` for npm authentication and `contents: write` for the
release tag and GitHub Release. The test jobs use read-only contents access.

## Release preparation

1. Change only `version` in `package.json` to a stable `X.Y.Z` value.
2. Run the local release checks:

   ```bash
   npm ci
   npm run check
   npm run check-version -- --print
   npm run check-version -- --tag vX.Y.Z
   npm test
   npm run pack:check
   npm run smoke:npm
   node scripts/build-release.mjs
   bash -n install.sh
   bash scripts/check-installer.sh
   git diff --check
   ```

3. Review the generated release directory and merge the version change to
   `main`.

Do not run `npm publish`, create release tags, or create GitHub Releases from a
feature branch. The merged-main workflow performs those actions.

## Automated flow

The workflow runs Node 18, 20, 22, and 24 on `ubuntu-latest`, `macos-latest`,
and `windows-latest`. POSIX installer tests run on Unix runners. The release
job starts only after every matrix job passes and only when a push changes the
package version, or when a workflow dispatch explicitly retries `main`.

The release job checks out the immutable event commit, installs dependencies,
builds and checks the release directory, verifies the package version and tag,
then publishes through Trusted Publishing and creates or verifies the matching
GitHub Release.

## Exact asset contract

Each stable GitHub Release contains exactly:

```text
wt
wt.sh
wt.fish
install.sh
absolutepraya-wt-X.Y.Z.tgz
checksums.txt
```

`wt` is the same `dist/wt.cjs` content packaged by npm. `wt.sh` is the Bash
and Zsh wrapper, and `wt.fish` is the Fish wrapper. `install.sh` is the
macOS/Linux bootstrap. The tarball is the output of `npm pack`. The checksum
manifest contains one SHA-256 entry for every other asset.

## Idempotency and recovery

A `main` push with no package version change skips the release. The release
job is serialized so concurrent release attempts do not race. If the requested
npm version already exists, CI compares its integrity hash with the locally
built tarball and reuses it only when they match. If a matching GitHub Release
already has the exact asset names and checksums, CI reuses it without uploading
duplicates. A same-version package, tag target, asset list, or asset hash
conflict fails closed and requires an explicit version decision.

After Trusted Publishing setup is complete, retry the failed workflow or
dispatch it against `main`. Do not bypass the release gates with a local
publish.

## Standalone installer and update guarantees

The supported standalone command is:

```bash
curl -fsSL https://github.com/absolutepraya/wt/releases/latest/download/install.sh | bash
```

It requires Node.js 18 or newer and Git, supports macOS and Linux, resolves a
stable release, validates expected GitHub or approved release CDN redirects,
verifies `checksums.txt`, checks the Node shebang and embedded version, and
performs a direct version/help smoke after installation. It stages the
executable, wrappers, and metadata privately. A replacement or smoke failure
rolls back the previous files when possible; if rollback fails, recovery
artifacts are retained and the installer exits nonzero.

`wt update` uses the same stable release and checksum contract for an existing
standalone installation. npm global and local installations update through
npm. Source checkouts update through Git.

## Migration from historical Python standalone 0.3.x

A user who installed the historical Python-based standalone 0.3.x release must
run the new installer once. It replaces the old executable and shell wrappers
after validation, requires Node.js 18+ and Git, and does not require `WT_REF`
for the normal command. Start a new shell or evaluate the appropriate
`wt shell-init` output, then confirm with `wt --version`.

The Node CLI also migrates an empty legacy project lock file when it is stale.
The old file is preserved beside the new directory lock. Non-empty legacy lock
files are rejected because they cannot be migrated safely without inspection.
