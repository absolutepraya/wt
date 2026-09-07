import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const manifest = JSON.parse(readFileSync("package.json", "utf8"));

test("package manifest points at the bundled CLI", async () => {
  assert.deepEqual(manifest.bin, { wt: "dist/wt.cjs" });
  assert.equal("dependencies" in manifest, false);
  const artifact = readFileSync("dist/wt.cjs", "utf8");
  assert.equal(artifact.startsWith("#!/usr/bin/env node\n"), true);

  const pack = JSON.parse(
    execFileSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8" }),
  )[0];
  const files = pack.files.map(({ path }: { path: string }) => path);
  assert.equal(files.includes("dist/wt.cjs"), true);
  assert.equal(files.includes("bin/wt"), false);
  assert.equal(files.includes("npm/wt.cjs"), false);
  assert.equal(files.some((file: string) => file.startsWith("src/")), false);
  assert.equal(files.some((file: string) => file.startsWith("test/")), false);
  assert.equal(files.some((file: string) => file.startsWith("tests/")), false);
});
