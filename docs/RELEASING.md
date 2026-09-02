# Releasing wt

The package version in `package.json` is the release source of truth. The
`VERSION` constant in `bin/wt` must match it. CI checks this before running a
release.

## One-time npm setup

The release workflow uses npm Trusted Publishing with GitHub Actions OIDC. No
`NPM_TOKEN` or GitHub personal access token belongs in the repository.

The npm package must exist before its package settings can have a trusted
publisher. If `@absolutepraya/wt` has not been published yet, seed the first
version from a trusted local machine after this release PR is merged:

```bash
npm login
npm publish --access public
npm logout
```

Run those commands from the merged `main` checkout, and verify that the
published version is the version in `package.json`. The local npm credential is
only for this one-time bootstrap. It is not used by CI.

Then, while signed in to the npm account that owns the `@absolutepraya` scope:

1. Open the package settings for `@absolutepraya/wt` on npmjs.com.
2. Open the `Trusted Publisher` section and choose `GitHub Actions`.
3. Set the organization or user to `absolutepraya`.
4. Set the repository to `wt`.
5. Set the workflow filename to `ci.yml`. Enter only the filename, not the
   `.github/workflows/` path.
6. Leave the environment name blank.
7. Allow the `npm publish` action and save the configuration.

The release job grants itself `id-token: write` for npm OIDC and
`contents: write` for tags and GitHub Releases. If GitHub rejects the write
permission, check the repository's Actions workflow permission setting and
allow the repository workflow to use its write token.

After the trusted publisher is configured, a push to `main` runs the release
job automatically. If the first release run failed while the package or trust
relationship was being configured, rerun the workflow against `main`:

```bash
gh workflow run ci.yml --ref main
```

Trusted Publishing automatically creates npm provenance for this public
repository and public package. The workflow therefore does not need a
long-lived npm token or a separate provenance flag.

## Release contract

For a new release:

1. Update `package.json` and `bin/wt` to the same stable `X.Y.Z` version.
2. Add the user-facing changes to `CHANGELOG.md`.
3. Run `python scripts/check-version.py`, `pytest -q tests/`, and the npm checks.
4. Merge the release PR to `main`.

The release job then:

- verifies the shared version and stable tag shape;
- builds the npm tarball, standalone CLI, Bash and Fish shell wrappers, and checksums;
- publishes the npm version if it is not already present;
- creates or verifies `vX.Y.Z` without rewriting an existing tag;
- creates or updates the matching GitHub Release with generated notes and
  release assets.

The workflow is idempotent for a partially completed release. It does not
publish a version that is already on npm, and it never moves a tag that already
belongs to another main commit. Later main pushes that keep the same version
are successful no-ops. `workflow_dispatch` is available for a safe rerun after
setup or a transient failure.

## Historical v0.3.0 release

The existing `v0.3.0` tag predates this automation. Its historical GitHub
Release has now been created without rewriting the tag, and intentionally has
no automated asset contract. Future releases use the automated flow above.

For reference, the one-time command was:

```bash
gh release create v0.3.0 \
  --verify-tag \
  --title "v0.3.0" \
  --generate-notes
```

The automated asset contract starts with the next version released from
`main`.
