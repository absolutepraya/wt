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
  assert.equal(output.split("\n").at(-1), "═".repeat(12));
});

test("supports open sections before setup and closed final sections", () => {
  const open = renderSection("Creating worktree", { name: "adelaide" }, { width: 12, trailingDivider: false });
  const closed = renderSection("Created worktree: adelaide", { name: "adelaide" });
  assert.notEqual(open.split("\n").at(-1), "═".repeat(12));
  assert.equal(closed.split("\n").at(-1), "═".repeat(80));
});

test("rejects control characters in labels, values, and paths", () => {
  assert.throws(() => renderSection("Creating\nworktree", { name: "adelaide" }), UsageError);
  assert.throws(() => renderSection("Creating worktree", { path: "/repo/\u001b[31m" }), UsageError);
  assert.throws(() => renderSection("Creating worktree", { "bad\tlabel": "adelaide" }), UsageError);
  for (const path of ["/repo/.worktrees/adelaide\n__cd__:/tmp/evil", "/repo/.worktrees/adelaide\u001b[31m", "/repo/.worktrees/adelaide\r"] ) {
    assert.throws(() => renderCdOutput(path), UsageError);
  }
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
