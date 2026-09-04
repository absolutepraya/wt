import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { PassThrough } from "node:stream";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { runCd, runLs, runNew, runRm } from "../src/commands/index.js";
import { ConfigurationError, SetupError } from "../src/errors.js";
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

interface CliProcessResult { code: number | null; stdout: string; stderr: string; }

function runCliProcess(repository: Repository, action: "new" | "rm", name: string, extraEnv: Record<string, string>): Promise<CliProcessResult> {
  const worker = join(mkdtempSync(join(tmpdir(), "wt-command-worker-")), "worker.ts");
  const commandModule = join(process.cwd(), "src", "commands", "index.ts");
  writeFileSync(worker, `import { runNew, runRm } from ${JSON.stringify(commandModule)}; const [action, repo, home, name] = process.argv.slice(2); const context = { cwd: repo!, env: { ...process.env, HOME: home!, USER: "test" }, io: { stdout: process.stdout, stderr: process.stderr, stdin: process.stdin, stdoutIsTTY: false, stdinIsTTY: false } }; void (async () => { const code = action === "rm" ? await runRm(context, { name: name!, force: true, keepBranch: false }) : await runNew(context, { name: name!, noSetup: true, cdAfterCreate: false }); process.exitCode = code; })().catch((error) => { console.error(error); process.exitCode = 2; });\n`);
  const child = spawn(process.execPath, [join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), worker, action, repository.repo, repository.home, name], { cwd: repository.repo, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${path}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

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

test("rm conservatively rejects legacy state without a generation token", async () => {
  const repository = makeRepository();
  await runNew(context(repository), { name: "legacy", noSetup: true, cdAfterCreate: false });
  const path = statePath(repository);
  const state = await loadState(path);
  delete state.slots["1"]!.generation_token;
  await saveState(path, state);
  const command = context(repository);
  assert.equal(await runRm(command, { name: "legacy", force: true, keepBranch: false }), 1);
  assert.match(command.output().stderr, /no generation token/);
  assert.equal(listWorktrees(systemGitRunner, repository.repo).some((entry) => entry.path.endsWith("/.worktrees/legacy")), true);
  assert.equal(systemGitRunner.run(["show-ref", "--verify", "--quiet", "refs/heads/test/legacy"], repository.repo).status, 0);
});

test("concurrent rm/new lifecycle preserves a replacement when the original teardown resumes", async () => {
  const repository = makeRepository();
  const started = join(repository.home, "first-teardown-started");
  const release = join(repository.home, "first-teardown-release");
  const teardownCode = "const fs=require('node:fs');const started=process.env.WT_RACE_STARTED;const release=process.env.WT_RACE_RELEASE;if(!fs.existsSync(started)){fs.writeFileSync(started,'1');while(!fs.existsSync(release))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20)}";
  writeConfig(repository.repo, `teardown = [${JSON.stringify(`node -e ${JSON.stringify(teardownCode)}`)}]`);
  await runCliProcess(repository, "new", "race", {});
  const initialState = await loadState(statePath(repository));
  const initialToken = initialState.slots["1"]!.generation_token;
  assert.ok(initialToken);
  const environment = { WT_RACE_STARTED: started, WT_RACE_RELEASE: release };
  const first = runCliProcess(repository, "rm", "race", environment);
  try {
    await waitForFile(started);
    const second = await runCliProcess(repository, "rm", "race", environment);
    assert.equal(second.code, 0);
    const replacement = await runCliProcess(repository, "new", "race", {});
    assert.equal(replacement.code, 0);
  } finally {
    writeFileSync(release, "1");
  }
  const result = await first;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /changed while it was being removed/);
  assert.equal(listWorktrees(systemGitRunner, repository.repo).some((entry) => entry.path.endsWith("/.worktrees/race")), true);
  const replacementState = await loadState(statePath(repository));
  const replacementEntry = Object.values(replacementState.slots)[0]!;
  assert.equal(replacementEntry.name, "race");
  assert.ok(replacementEntry.generation_token);
  assert.notEqual(replacementEntry.generation_token, initialToken);
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
