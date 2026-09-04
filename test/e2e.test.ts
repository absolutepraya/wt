import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { runCd, runLs, runNew, runRm } from "../src/commands/index.js";
import { listWorktrees, systemGitRunner } from "../src/git.js";
import { createGitFixture } from "./fixtures.js";
import type { CliContext } from "../src/types.js";

function makeRepository(): { repo: string; home: string } {
  const fixture = createGitFixture();
  mkdirSync(join(fixture.repo, ".wt"));
  writeFileSync(join(fixture.repo, ".wt", "config.toml"), 'worktree_path = ".worktrees"\nbranch_template = "test/{name}"\ndefault_base = "origin/main"\nsetup = []\nteardown = []\n');
  return { repo: fixture.repo, home: mkdtempSync(join(tmpdir(), "wt-e2e-home-")) };
}

function command(repo: string, home: string, cwd = repo): CliContext & { text: () => string } {
  const stdout = new PassThrough(); let text = ""; stdout.on("data", (chunk) => { text += String(chunk); });
  return { cwd, env: { ...process.env, HOME: home, USER: "test" }, io: { stdout, stderr: new PassThrough(), stdin: process.stdin, stdoutIsTTY: false, stdinIsTTY: false }, text: () => text };
}

test("complete new, list, current cd, and remove lifecycle retains one sentinel only when requested", async () => {
  const repository = makeRepository();
  const create = command(repository.repo, repository.home);
  assert.equal(await runNew(create, { name: "lifecycle", noSetup: true, cdAfterCreate: true }), 0);
  assert.equal((create.text().match(/__cd__:/g) ?? []).length, 1);
  const path = join(repository.repo, ".worktrees", "lifecycle");
  const listed = command(repository.repo, repository.home);
  assert.equal(await runLs(listed), 0);
  assert.match(listed.text(), /lifecycle/);
  assert.equal(listed.text().includes("__cd__:"), false);
  const cd = command(repository.repo, repository.home, path);
  assert.equal(await runCd(cd), 0);
  assert.equal((cd.text().match(/__cd__:/g) ?? []).length, 1);
  assert.match(cd.text(), /\.worktrees\/lifecycle/);
  assert.equal(await runRm(command(repository.repo, repository.home), { name: "lifecycle", force: false, keepBranch: false }), 0);
  assert.equal(listWorktrees(systemGitRunner, repository.repo).some((entry) => entry.path.endsWith("/.worktrees/lifecycle")), false);
});
