---
status: accepted
---

# Automated releases and standalone self-update

`package.json` is the sole release version source of truth. A stable
`X.Y.Z` version is injected into the bundled `dist/wt.cjs` artifact, and the
release tag must be `vX.Y.Z`. CI builds that artifact once and uses the same
bytes for the npm package and standalone `wt` asset.

## Release trigger and authentication

A push to merged `main` triggers the cross-platform test matrix. The matrix
runs Node 18, 20, 22, and 24 on Ubuntu, macOS, and Windows. The release job
runs only after the matrix succeeds and only when the package version changed,
or when an approved workflow dispatch retries a release on `main`.

The release job publishes through npm Trusted Publishing with GitHub Actions
OIDC. It needs workflow-scoped `id-token` permission for npm authentication and
`contents` permission to create the matching tag and GitHub Release. No
long-lived npm token or personal access token is stored in the repository.
The one-time npm setup is documented in [docs/RELEASING.md](../RELEASING.md).

## Exact release contract

Every stable release uses the same version in `package.json`, the embedded
artifact version, the npm package, and the `vX.Y.Z` tag. Its GitHub Release has
exactly these assets:

```text
wt
wt.sh
wt.fish
install.sh
absolutepraya-wt-X.Y.Z.tgz
checksums.txt
```

`wt` is the built `dist/wt.cjs` file. `wt.sh` and `wt.fish` are the shell
wrappers. The installer script is the release-based macOS/Linux bootstrap.
The npm tarball is produced by `npm pack`. `checksums.txt` contains a
SHA-256 entry for each of those five other assets. The installer downloads
`wt`, both POSIX wrappers, and the checksum manifest; `install.sh` itself is
the bootstrap entry point fetched from GitHub Releases.

## Idempotency and conflict handling

The release job is serialized. A main push that does not change the package
version is a no-op. Before publishing, CI checks whether the exact npm version
already exists. It reuses the package only when its published integrity hash
matches the locally built tarball; a same-version hash conflict fails.

The matching GitHub Release is reused only when its exact asset names and
checksums match. A tag is reused only when it points at the immutable commit
being released. Existing same-version tags, packages, or assets with different
content fail closed and require an explicit version decision. A failed release
can be retried after its setup issue is fixed without creating duplicate
assets.

## Standalone update and rollback

`wt update` is limited to standalone installations. It requests the latest
stable GitHub Release, accepts only an exact `vX.Y.Z` tag and expected release
asset URLs, verifies every downloaded SHA-256 entry, and checks the Node
shebang and embedded version in `wt`.

The installer and updater stage files privately, replace the executable,
wrappers, and standalone metadata as one transaction, and run a direct
version/help smoke on the installed executable. Any download, validation,
replacement, or smoke failure leaves the previous installation in place when
rollback is possible. If rollback itself cannot finish, temporary rollback
artifacts are retained and the command fails with a recovery diagnostic.
Neither path mutates a source checkout, an npm dependency, or a shell profile
through npm.

## Migration consequence

Users of the historical Python-based standalone 0.3.x installation must run
the new release installer once. It replaces the old standalone files after
validation and requires Node.js 18 or newer and Git. No ordinary install needs
`WT_REF`. Global and local npm installations update through npm, while source
checkouts update through Git.

## Rejected alternatives

- Publish on every `main` push: rejected because unchanged versions and
  accidental working versions should not be released.
- Store an npm publish token in CI: rejected because OIDC Trusted Publishing
  provides short-lived workflow-scoped authentication.
- Update a source checkout in place: rejected because self-update must not
  mutate a repository or a consumer dependency graph.
- Download an unverified script from a moving branch: rejected because stable
  installation requires a versioned release and checksum validation.
