import { test } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { UsageError } from "../src/errors.js";
import { renderCdOutput, renderSection, writeOutput } from "../src/output.js";

test("human section retains command information", () => {
  const output = renderSection("Created worktree: adelaide", { branch: "abhip/adelaide", slot: 1 }, 12);
  assert.match(output, /Created worktree: adelaide/);
  assert.match(output, /branch  abhip\/adelaide/);
  assert.equal(output.split("\n")[0], "═".repeat(12));
});
test("cd output has one absolute-path sentinel", () => {
  const output = renderCdOutput("/repo/.worktrees/adelaide");
  assert.equal(output.split("\n").filter((line) => line.startsWith("__cd__:")).length, 1);
  assert.throws(() => renderCdOutput("relative/path"), UsageError);
});
test("writeOutput appends one trailing newline", () => {
  let received = "";
  const stream = new Writable({ write(chunk, _encoding, callback) { received += String(chunk); callback(); } });
  writeOutput(stream, "hello");
  assert.equal(received, "hello\n");
});
