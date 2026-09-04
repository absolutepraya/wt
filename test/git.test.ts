import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GitError } from "../src/errors.js";
import { addWorktree, branchHasUpstream, branchInUse, deleteBranch, git, gitFetch, hasUnmergedCommits, listWorktrees, removeWorktree, systemGitRunner, unmergedCommitSummary } from "../src/git.js";
import { createGitFixture, FakeGitRunner, runGit } from "./fixtures.js";

test("git preserves argument boundaries and sanitizes deterministic failures", () => {
  const runner = new FakeGitRunner([{ status: 2, stdout: "", stderr: "fatal:\u001b[31m bad\nbranch" }]);
  assert.throws(() => git(runner, ["show", "topic with spaces"], "/repo"), (error: unknown) => error instanceof GitError && error.message.includes("topic with spaces") && !error.message.includes("\u001b"));
  assert.deepEqual(runner.calls[0], { args: ["show", "topic with spaces"], cwd: "/repo" });
});

test("fetch and mutation operations retain legacy flags", () => {
  const runner = new FakeGitRunner();
  gitFetch(runner, "/repo");
  addWorktree(runner, "/repo", "/repo/.worktrees/new", "feature/new", "origin/main", true);
  addWorktree(runner, "/repo", "/repo/.worktrees/existing", "feature/existing", "origin/main", false);
  removeWorktree(runner, "/repo", "/repo/.worktrees/new", true);
  deleteBranch(runner, "/repo", "feature/new", false);
  assert.deepEqual(runner.calls.map((call) => call.args), [["fetch", "origin", "main"], ["worktree", "add", "-b", "feature/new", "/repo/.worktrees/new", "origin/main"], ["worktree", "add", "-B", "feature/existing", "/repo/.worktrees/existing", "origin/main"], ["worktree", "remove", "--force", "/repo/.worktrees/new"], ["branch", "-d", "feature/new"]]);
});

test("turns operation failures into typed Git errors and preserves nonzero probes", () => {
  const failures: Array<() => void> = [
    () => gitFetch(new FakeGitRunner([{ status: 1, stdout: "", stderr: "fatal: fetch failed" }]), "/repo"),
    () => listWorktrees(new FakeGitRunner([{ status: 1, stdout: "", stderr: "fatal: not a repository" }]), "/repo"),
    () => addWorktree(new FakeGitRunner([{ status: 1, stdout: "", stderr: "fatal: add failed" }]), "/repo", "/tmp/wt", "feature/x", "main", true),
    () => removeWorktree(new FakeGitRunner([{ status: 1, stdout: "", stderr: "fatal: remove failed" }]), "/repo", "/tmp/wt", false),
    () => deleteBranch(new FakeGitRunner([{ status: 1, stdout: "", stderr: "fatal: delete failed" }]), "/repo", "feature/x", false),
  ];
  for (const operation of failures) assert.throws(operation, (error: unknown) => error instanceof GitError && error.code === "GIT_ERROR");

  const noUpstream = new FakeGitRunner([
    { status: 0, stdout: "commit\n", stderr: "" },
    { status: 1, stdout: "", stderr: "fatal: no upstream" },
  ]);
  assert.equal(hasUnmergedCommits(noUpstream, "/repo", "feature/x"), true);
  assert.equal(branchHasUpstream(new FakeGitRunner([{ status: 1, stdout: "", stderr: "fatal: no upstream" }]), "/repo", "feature/x"), false);
});

test("parses linked worktrees and supports their lifecycle with real Git", () => {
  const fixture = createGitFixture();
  const worktree = join(fixture.repo, ".worktrees", "feature");
  const existingWorktree = join(fixture.repo, ".worktrees", "existing");
  const detachedWorktree = join(fixture.repo, ".worktrees", "detached");
  mkdirSync(join(fixture.repo, ".worktrees"));
  addWorktree(systemGitRunner, fixture.repo, worktree, "feature/test", "main", true);
  runGit(["branch", "feature/existing", "main"], fixture.repo);
  addWorktree(systemGitRunner, fixture.repo, existingWorktree, "feature/existing", "main", false);
  runGit(["worktree", "add", "--detach", detachedWorktree, "main"], fixture.repo);
  const worktrees = listWorktrees(systemGitRunner, fixture.repo);
  assert.equal(worktrees.length, 4);
  assert.equal(branchInUse(systemGitRunner, fixture.repo, "feature/test"), true);
  assert.equal(branchInUse(systemGitRunner, fixture.repo, "missing"), false);
  assert.equal(worktrees.find((entry) => entry.path.endsWith(".worktrees/detached"))?.branch, null);
  const bareWorktrees = listWorktrees(systemGitRunner, fixture.remote);
  assert.equal(bareWorktrees.length, 1);
  assert.equal(bareWorktrees[0]?.bare, true);
  removeWorktree(systemGitRunner, fixture.repo, worktree, false);
  deleteBranch(systemGitRunner, fixture.repo, "feature/test", false);
  removeWorktree(systemGitRunner, fixture.repo, existingWorktree, false);
  deleteBranch(systemGitRunner, fixture.repo, "feature/existing", false);
  assert.equal(existsSync(worktree), false);
});

test("unmerged checks exclude commits already pushed upstream", () => {
  const fixture = createGitFixture();
  runGit(["checkout", "-b", "feature/pushed"], fixture.repo);
  writeFileSync(join(fixture.repo, "pushed.txt"), "pushed\n");
  runGit(["add", "pushed.txt"], fixture.repo);
  runGit(["commit", "-m", "pushed work"], fixture.repo);
  runGit(["push", "-u", "origin", "feature/pushed"], fixture.repo);
  assert.equal(branchHasUpstream(systemGitRunner, fixture.repo, "feature/pushed"), true);
  assert.equal(hasUnmergedCommits(systemGitRunner, fixture.repo, "feature/pushed"), false);
  writeFileSync(join(fixture.repo, "local.txt"), "local\n");
  runGit(["add", "local.txt"], fixture.repo);
  runGit(["commit", "-m", "local work"], fixture.repo);
  assert.equal(hasUnmergedCommits(systemGitRunner, fixture.repo, "feature/pushed"), true);
  assert.match(unmergedCommitSummary(systemGitRunner, fixture.repo, "feature/pushed").join("\n"), /local work/);
});

test("detects unmerged work on a branch with no upstream", () => {
  const fixture = createGitFixture();
  runGit(["checkout", "-b", "feature/local"], fixture.repo);
  writeFileSync(join(fixture.repo, "local.txt"), "local\n");
  runGit(["add", "local.txt"], fixture.repo);
  runGit(["commit", "-m", "local only"], fixture.repo);
  assert.equal(branchHasUpstream(systemGitRunner, fixture.repo, "feature/local"), false);
  assert.equal(hasUnmergedCommits(systemGitRunner, fixture.repo, "feature/local"), true);
  assert.match(unmergedCommitSummary(systemGitRunner, fixture.repo, "feature/local").join("\n"), /local only/);
});
