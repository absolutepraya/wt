import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// @ts-expect-error The release scripts are intentionally executable JavaScript files.
import { assertMatchingReleaseAssets, buildRelease, readChecksums, RELEASE_ASSETS } from "../scripts/build-release.mjs";
// @ts-expect-error The version checker is intentionally an executable JavaScript file.
import { checkVersion } from "../scripts/check-version.mjs";
// @ts-expect-error The release gates are intentionally executable JavaScript files.
import { assertTagTarget, classifyReleaseLookup, hasVersionChange, npmReleaseDecision } from "../scripts/release-gates.mjs";

test("version check rejects an artifact with a mismatched embedded version", async () => {
  const root = mkdtempSync(join(tmpdir(), "wt-release-version-"));
  try {
    const artifact = join(root, "wt.cjs");
    writeFileSync(artifact, "#!/usr/bin/env node\nconsole.log(\"0.0.0\");\n");
    await assert.rejects(checkVersion({ repository: process.cwd(), artifactPath: artifact }), /does not contain version/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release build contains the exact published asset set and checksums", async () => {
  const root = mkdtempSync(join(tmpdir(), "wt-release-assets-"));
  try {
    const build = await buildRelease({ directory: root });
    const names = (await readdir(build.directory)).sort();
    assert.deepEqual(names, [...RELEASE_ASSETS, build.tarball.split("/").at(-1)!, "checksums.txt"].sort());
    const checksums = await readChecksums(build.directory);
    assert.deepEqual([...checksums.keys()].sort(), [...RELEASE_ASSETS, build.tarball.split("/").at(-1)!].sort());
    assert.equal(readFileSync(join(build.directory, "wt"), "utf8"), readFileSync(join(process.cwd(), "dist", "wt.cjs"), "utf8"));
    const releaseBytes = names
      .filter((name) => name !== "checksums.txt")
      .map((name) => readFileSync(join(build.directory, name), "utf8"))
      .join("\n");
    assert.equal(releaseBytes.includes(process.cwd()), false);
    assert.equal(releaseBytes.includes("NODE_AUTH_TOKEN"), false);
    assert.equal(releaseBytes.includes("GITHUB_TOKEN"), false);
    assert.equal(build.tag, `v${build.version}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("default release builds use unique temporary staging directories", async () => {
  const first = await buildRelease();
  try {
    const second = await buildRelease();
    try {
      const prefix = join(tmpdir(), `wt-release-${first.version}-`);
      assert.equal(first.directory.startsWith(prefix), true);
      assert.equal(second.directory.startsWith(prefix), true);
      assert.notEqual(first.directory, second.directory);
      assert.equal(statSync(first.directory).isDirectory(), true);
      assert.equal(statSync(second.directory).isDirectory(), true);
    } finally {
      rmSync(second.directory, { recursive: true, force: true });
    }
  } finally {
    rmSync(first.directory, { recursive: true, force: true });
  }
});

test("release checksums are deterministic and duplicate releases are reusable", async () => {
  const first = mkdtempSync(join(tmpdir(), "wt-release-first-"));
  const second = mkdtempSync(join(tmpdir(), "wt-release-second-"));
  try {
    const firstBuild = await buildRelease({ directory: first });
    const secondBuild = await buildRelease({ directory: second });
    assert.equal(readFileSync(join(first, "checksums.txt"), "utf8"), readFileSync(join(second, "checksums.txt"), "utf8"));
    await assert.doesNotReject(assertMatchingReleaseAssets(firstBuild.directory, secondBuild.directory));
  } finally {
    rmSync(first, { recursive: true, force: true });
    rmSync(second, { recursive: true, force: true });
  }
});

test("duplicate checksum entries are rejected", async () => {
  const directory = mkdtempSync(join(tmpdir(), "wt-release-duplicate-"));
  try {
    writeFileSync(
      join(directory, "checksums.txt"),
      `${"a".repeat(64)}  wt\n${"b".repeat(64)}  wt\n`,
    );
    await assert.rejects(readChecksums(directory), /duplicate checksum entry: wt/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("release idempotency gates skip, reuse, and reject conflicts", () => {
  assert.equal(hasVersionChange({ version: "0.3.1" }, { version: "0.3.1" }), false);
  assert.equal(hasVersionChange({ version: "0.3.0" }, { version: "0.3.1" }), true);
  assert.equal(npmReleaseDecision({ remoteIntegrity: "sha512-same", localIntegrity: "sha512-same" }), "reuse");
  assert.equal(npmReleaseDecision({ remoteIntegrity: undefined, localIntegrity: "sha512-local" }), "publish");
  assert.throws(
    () => npmReleaseDecision({ remoteIntegrity: "sha512-other", localIntegrity: "sha512-local" }),
    /same-version npm package hash conflict/,
  );
  assert.doesNotThrow(() => assertTagTarget("commit-a", "commit-a"));
  assert.throws(() => assertTagTarget("commit-a", "commit-b"), /same-version tag conflict/);
});

test("npm integrity gate rejects a missing remote value", () => {
  assert.throws(
    () => execFileSync(process.execPath, ["scripts/release-gates.mjs", "npm-integrity", "--local", "sha512-local", "--remote"], { encoding: "utf8" }),
    (error: unknown) => error instanceof Error
      && "stderr" in error
      && String((error as { stderr?: unknown }).stderr).includes("--remote requires a value"),
  );
});

test("GitHub release lookup accepts only a verified absence", () => {
  assert.equal(classifyReleaseLookup({ exitCode: 0, stderr: "" }), "exists");
  assert.equal(classifyReleaseLookup({ exitCode: 1, stderr: "release not found\n" }), "missing");
  assert.throws(
    () => classifyReleaseLookup({ exitCode: 1, stderr: "authentication failed\n" }),
    /unexpected GitHub Release lookup failure/,
  );
  assert.throws(
    () => classifyReleaseLookup({ exitCode: 1, stderr: "could not resolve api.github.com\n" }),
    /unexpected GitHub Release lookup failure/,
  );
  assert.throws(
    () => classifyReleaseLookup({ exitCode: 2, stderr: "release not found\n" }),
    /unexpected GitHub Release lookup failure/,
  );
});

test("same-version release hash conflicts fail closed", async () => {
  const expected = mkdtempSync(join(tmpdir(), "wt-release-expected-"));
  const actual = mkdtempSync(join(tmpdir(), "wt-release-actual-"));
  try {
    const expectedBuild = await buildRelease({ directory: expected });
    const actualBuild = await buildRelease({ directory: actual });
    writeFileSync(join(actual, "wt"), `${readFileSync(join(actual, "wt"), "utf8")}changed`);
    await assert.rejects(assertMatchingReleaseAssets(expectedBuild.directory, actualBuild.directory), /same-version release hash conflict/);
  } finally {
    rmSync(expected, { recursive: true, force: true });
    rmSync(actual, { recursive: true, force: true });
  }
});

test("version check supports print and explicit stable tags", () => {
  const output = execFileSync(process.execPath, ["scripts/check-version.mjs", "--print"], { encoding: "utf8" }).trim();
  assert.equal(output, JSON.parse(readFileSync("package.json", "utf8")).version);
  assert.doesNotThrow(() => execFileSync(process.execPath, ["scripts/check-version.mjs", "--tag", `v${output}`]));
  assert.throws(() => execFileSync(process.execPath, ["scripts/check-version.mjs", "--tag", "v0.0.0"]), /version check/);
});
