---
status: accepted
---

# Automate stable releases and standalone self-update

We will use `package.json` as the canonical release version and require the
standalone CLI's `VERSION` constant to match it. A successful CI run on
`main`, after the Python and npm checks pass, is the release trigger for a new
stable version.

The release job will use npm Trusted Publishing with GitHub Actions OIDC. It
will publish only a version that is not already present on npm, create the
matching immutable `vX.Y.Z` tag, and create or update the matching GitHub
Release. A concurrent release job is serialized, and an existing tag that
points at another commit is left untouched rather than overwritten.

Each automated release will attach the standalone CLI, the Bash and Fish shell
wrappers, the exact npm tarball, and a SHA-256 checksum manifest. `wt update`
will use the latest stable GitHub Release, verify those assets and their
embedded version, then replace the installed standalone files atomically with
rollback on failure. npm-managed installations remain controlled by the
consumer's npm dependency graph.

## Considered options

- Publish on every push to `main`: rejected because it could republish an
  unchanged version or publish an unintentional working version.
- Store an npm publish token in GitHub Actions: rejected because Trusted
  Publishing provides short-lived, workflow-scoped authentication without a
  long-lived write credential.
- Update the source checkout in place: rejected because self-update must not
  mutate a repository or a consumer project's dependency installation.
- Download an unverified script from `main`: rejected because stable updates
  need a versioned release and checksum validation.

## Consequences

Release authors must deliberately update both version locations and merge a
release-ready change to `main`. The npm package must be seeded once before its
Trusted Publisher can be configured. Standalone installations gain a
consistent, stable update path, while project-local npm installations use
normal dependency updates.
