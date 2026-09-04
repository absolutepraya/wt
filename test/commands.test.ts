import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { runCd, runLs, runNew, runRm } from "../src/commands/index.js";
import { ConfigurationError, SetupError } from "../src/errors.js";
import { listWorktrees, systemGitRunner, type GitResult } from "../src/git.js";
import { projectId, statePaths } from "../src/paths.js";
import { loadState, saveState } from "../src/state.js";
import type { CliContext } from "../src/types.js";
import type { WorktreeServices } from "../src/worktrees.js";
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

test("ordinary new refuses to reset an existing unchecked-out local branch", async () => {
  const repository = makeRepository();
  runGit(["checkout", "-b", "existing"], repository.repo);
  writeFileSync(join(repository.repo, "existing.txt"), "keep this commit\n");
  runGit(["add", "existing.txt"], repository.repo);
  runGit(["commit", "-m", "existing unique work"], repository.repo);
  const before = runGit(["rev-parse", "existing"], repository.repo).trim();
  runGit(["checkout", "main"], repository.repo);
  await assert.rejects(runNew(context(repository), { name: "ordinary", branch: "existing", noSetup: true, cdAfterCreate: false }), /already exists/);
  assert.equal(runGit(["rev-parse", "existing"], repository.repo).trim(), before);
  assert.equal(listWorktrees(systemGitRunner, repository.repo).some((entry) => entry.path.endsWith("/.worktrees/ordinary")), false);
  assert.deepEqual((await loadState(statePath(repository))).slots, {});
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

test("state-derived escaped paths are rejected before cd, ls, or rm can inspect them", async () => {
  const repository = makeRepository();
  const state = await loadState(statePath(repository));
  state.slots["1"] = { name: "escaped", branch: "test/escaped", path: "../../outside", base: "origin/main", created_at: "2026-09-04T00:00:00.000Z" };
  await saveState(statePath(repository), state);
  await assert.rejects(runCd(context(repository), "escaped"), ConfigurationError);
  await assert.rejects(runLs(context(repository)), ConfigurationError);
  await assert.rejects(runRm(context(repository), { name: "escaped", force: true, keepBranch: false }), ConfigurationError);
});

test("rm aborts after teardown when the persisted generation changes", async () => {
  const repository = makeRepository();
  await runNew(context(repository), { name: "race", noSetup: true, cdAfterCreate: false });
  let worktreeLists = 0;
  const services: WorktreeServices = {
    now: () => new Date(),
    random: () => 0,
    git: {
      run(args: string[], cwd: string): GitResult {
        const result = systemGitRunner.run(args, cwd);
        if (args[0] === "worktree" && args[1] === "list") {
          worktreeLists += 1;
          if (worktreeLists === 3) {
            const path = statePath(repository);
            const changed = JSON.parse(readFileSync(path, "utf8")) as { slots: Record<string, { created_at: string }> };
            changed.slots["1"]!.created_at = "2026-09-04T00:00:01.000Z";
            writeFileSync(path, `${JSON.stringify(changed)}\n`);
          }
        }
        return result;
      },
    },
  };
  const result = context(repository);
  assert.equal(await runRm(result, { name: "race", force: true, keepBranch: false }, services), 1);
  assert.match(result.output().stderr, /changed while it was being removed/);
  assert.equal(listWorktrees(systemGitRunner, repository.repo).some((entry) => entry.path.endsWith("/.worktrees/race")), true);
  assert.equal(Object.values((await loadState(statePath(repository))).slots)[0]!.name, "race");
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
