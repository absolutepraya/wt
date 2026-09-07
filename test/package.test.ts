import { execFileSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

test("local and global npm distributions use the bundled CLI", () => {
  const script = join(process.cwd(), "scripts", "check-npm-package.mjs");
  assert.doesNotThrow(() => {
    execFileSync(process.execPath, [script], { cwd: process.cwd(), stdio: "inherit" });
  });
});
