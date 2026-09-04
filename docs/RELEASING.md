# Releasing wt

`package.json` is the release version source of truth. The generated
`dist/wt.cjs` artifact and the Git tag must use the same stable `X.Y.Z` value.
CI builds that artifact once, uses it for the npm package and standalone
assets, and verifies SHA-256 checksums before publishing.

## One-time npm Trusted Publishing setup

Configure the package owner account at npmjs.com. No npm token, GitHub
personal access token, or secret belongs in the repository.

1. Open `@absolutepraya/wt` package settings and choose `Trusted Publisher`.
2. Select `GitHub Actions`.
3. Set the owner or organization to `absolutepraya`.
4. Set the repository to `wt`.
5. Set the workflow filename to `ci.yml`, without the `.github/workflows/`
   prefix.
6. Leave the environment name blank unless the workflow is deliberately
   changed to use one.
7. Save the publisher configuration.

The release job must retain only these write permissions:

```yaml
permissions:
  contents: write
  id-token: write
```

`id-token: write` lets npm authenticate the GitHub Actions OIDC identity.
`contents: write` lets the job create the matching tag and GitHub Release.
The repository Actions setting must allow workflows to use their write token.

## Release flow

1. Bump `version` in `package.json` to a stable `X.Y.Z` value.
2. Run the local checks:

   ```bash
   npm ci
   npm run build
   npm run check-version -- --print
   npm run check-version -- --tag vX.Y.Z
   node scripts/build-release.mjs
   npm test
   ```

3. Merge the version bump to `main`.

The merged-main workflow runs the Node 18, 20, 22, and 24 matrix on Ubuntu,
macOS, and Windows first. The release job runs only after every matrix job
passes. It builds from `main`, verifies the version and checksums, publishes
the public npm package through Trusted Publishing, and creates the matching
GitHub Release.

Each GitHub Release contains exactly these assets:

```text
wt
wt.sh
wt.fish
install.sh
absolutepraya-wt-X.Y.Z.tgz
checksums.txt
```

`wt` is the same `dist/wt.cjs` bytes shipped through npm. `checksums.txt`
covers every other published asset.

## Idempotency and recovery

A `main` push that does not change the package version skips publication. A
workflow dispatch against `main` can safely retry a failed release. If the
requested npm version already exists, CI compares its published integrity
hash with the locally built tarball and reuses it only when they match. If a
matching GitHub Release already contains the exact asset names and hashes, CI
reuses it without uploading a duplicate release. Any same-version package,
tag, asset-list, or asset-hash conflict fails the job and requires an explicit
version decision.

Do not run `npm publish` from a feature branch. Do not add long-lived npm
tokens to repository or Actions secrets. If Trusted Publishing setup was
completed after a failed workflow, use the GitHub Actions rerun or dispatch
the workflow against `main`.
