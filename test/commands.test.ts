import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { runCd, runLs, runNew, runRm } from "../src/commands/index.js";
import { SetupError } from "../src/errors.js";
import { listWorktrees, systemGitRunner } from "../src/git.js";
import { projectId, statePaths } from "../src/paths.js";
import { loadState, saveState } from "../src/state.js";
import type { CliContext } from "../src/types.js";
import { createGitFixture, runGit } from "./fixtures.js";

interface Repository { repo: string; home: string; }

function writeConfig(repo: string, body = ""): void {
  mkdirSync(join(repo, ".wt"), { recursive: true });
  writeFileSync(join(repo, ".wt", "config.toml"), [
    'worktree_path = ".worktrees"',
    ...(body.includes("port_offset_interval") ? [] : ["port_offset_interval = 10"]),
    ...(body.includes("max_slots") ? [] : ["max_slots = 3"]),
    'name_strategy = "cities"',
    'branch_template = "test/{name}"',
    'default_base = "origin/main"',
    ...(body.includes("setup") ? [] : ["setup = []"]),
    ...(body.includes("teardown") ? [] : ["teardown = []"]),
    body,
  ].filter(Boolean).join("\n"));
}

function makeRepository(body = ""): Repository {
  const fixture = createGitFixture();
  writeConfig(fixture.repo, body);
  return { repo: fixture.repo, home: mkdtempSync(join(tmpdir(), "wt-command-home-")) };
}

function context(repository: Repository, cwd = repository.repo): CliContext & { output: () => { stdout: string; stderr: string } } {
  const stdout = new PassThrough(); const stderr = new PassThrough();
  let stdoutText = ""; let stderrText = "";
  stdout.on("data", (chunk) => { stdoutText += String(chunk); });
  stderr.on("data", (chunk) => { stderrText += String(chunk); });
  return {
    cwd,
    env: { ...process.env, HOME: repository.home, USER: "test" },
    io: { stdout, stderr, stdin: process.stdin, stdoutIsTTY: false, stdinIsTTY: false },
    output: () => ({ stdout: stdoutText, stderr: stderrText }),
  };
}

function statePath(repository: Repository): string { return statePaths(projectId(repository.repo), repository.home).statePath; }

test("new creates a tracked worktree and setup failure rolls Git and state back", async () => {
  const repository = makeRepository('setup = ["exit 7"]');
  const command = context(repository);
  await assert.rejects(runNew(command, { name: "broken", noSetup: false, cdAfterCreate: false }), SetupError);
  assert.equal(listWorktrees(systemGitRunner, repository.repo).some((entry) => entry.path.endsWith("/.worktrees/broken")), false);
  assert.deepEqual((await loadState(statePath(repository))).slots, {});
  assert.equal(systemGitRunner.run(["show-ref", "--verify", "--quiet", "refs/heads/test/broken"], repository.repo).status, 1);
});

test("rm preserves a worktree after teardown failure unless force is explicit", async () => {
  const repository = makeRepository('teardown = ["exit 8"]');
  const create = context(repository);
  await runNew(create, { name: "teardown", noSetup: true, cdAfterCreate: false });
  const path = join(repository.repo, ".worktrees", "teardown");
  const blocked = context(repository);
  assert.equal(await runRm(blocked, { name: "teardown", force: false, keepBranch: false }), 1);
  assert.match(blocked.output().stderr, /teardown failed/);
  assert.equal(listWorktrees(systemGitRunner, repository.repo).some((entry) => entry.path.endsWith("/.worktrees/teardown")), true);
  assert.equal(await runRm(context(repository), { name: "teardown", force: true, keepBranch: false }), 0);
  assert.deepEqual((await loadState(statePath(repository))).slots, {});
});

test("rm refuses unmerged branches without force and preserves state until removal succeeds", async () => {
  const repository = makeRepository();
  await runNew(context(repository), { name: "protected", noSetup: true, cdAfterCreate: false });
  const path = join(repository.repo, ".worktrees", "protected");
  writeFileSync(join(path, "work.txt"), "unmerged\n");
  runGit(["add", "work.txt"], path); runGit(["commit", "-m", "unmerged"], path);
  const blocked = context(repository);
  assert.equal(await runRm(blocked, { name: "protected", force: false, keepBranch: false }), 1);
  assert.match(blocked.output().stderr, /unmerged commits/);
  assert.equal(Object.values((await loadState(statePath(repository))).slots).some((entry) => entry.name === "protected"), true);
  assert.equal(await runRm(context(repository), { name: "protected", force: true, keepBranch: false }), 0);
});

test("new honors explicit branch and from combinations, then protects keep-branch", async () => {
  const repository = makeRepository();
  runGit(["checkout", "-b", "source"], repository.repo);
  runGit(["push", "-u", "origin", "source"], repository.repo);
  runGit(["checkout", "main"], repository.repo);
  await runNew(context(repository), { name: "from-source", branch: "target", from: "source", noSetup: true, cdAfterCreate: false });
  const entry = Object.values((await loadState(statePath(repository))).slots)[0]!;
  assert.deepEqual({ branch: entry.branch, base: entry.base, tracksRemote: entry.tracks_remote }, { branch: "target", base: "origin/source", tracksRemote: true });
  assert.equal(await runRm(context(repository), { name: "from-source", force: false, keepBranch: true }), 0);
  assert.equal(systemGitRunner.run(["show-ref", "--verify", "--quiet", "refs/heads/target"], repository.repo).status, 0);
});

test("slot exhaustion and stale state have safe diagnostics without mutation", async () => {
  const repository = makeRepository("max_slots = 1");
  await runNew(context(repository), { name: "one", noSetup: true, cdAfterCreate: false });
  await assert.rejects(runNew(context(repository), { name: "two", noSetup: true, cdAfterCreate: false }), /No free slots/);
  const state = await loadState(statePath(repository));
  state.slots["1"]!.path = ".worktrees/missing";
  await saveState(statePath(repository), state);
  const listed = context(repository);
  assert.equal(await runLs(listed), 0);
  assert.match(listed.output().stderr, /stale state/);
  const cd = context(repository);
  assert.equal(await runCd(cd, "one"), 1);
  assert.match(cd.output().stderr, /stale state/);
  assert.equal(cd.output().stdout.includes("__cd__:"), false);
});

test("new serializes concurrent allocation through the project lock", async () => {
  const repository = makeRepository();
  await Promise.all([
    runNew(context(repository), { name: "first", noSetup: true, cdAfterCreate: false }),
    runNew(context(repository), { name: "second", noSetup: true, cdAfterCreate: false }),
  ]);
  const entries = Object.values((await loadState(statePath(repository))).slots);
  assert.deepEqual(entries.map((entry) => entry.name).sort(), ["first", "second"]);
  assert.deepEqual(Object.keys((await loadState(statePath(repository))).slots).sort(), ["1", "2"]);
});
