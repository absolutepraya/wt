import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { runCli } from "../src/cli.js";
import { normalizePath } from "../src/paths.js";
import type { CliContext } from "../src/types.js";
import { createGitFixture } from "./fixtures.js";

interface CapturedContext extends CliContext { output(): { stdout: string; stderr: string }; }

function capturedContext(cwd: string, home = mkdtempSync(join(tmpdir(), "wt-cli-home-"))): CapturedContext {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let stdoutText = "";
  let stderrText = "";
  stdout.on("data", (chunk) => { stdoutText += String(chunk); });
  stderr.on("data", (chunk) => { stderrText += String(chunk); });
  return {
    cwd,
    env: { ...process.env, HOME: home, USER: "test" },
    io: { stdout, stderr, stdin: process.stdin, stdoutIsTTY: false, stdinIsTTY: false },
    output: () => ({ stdout: stdoutText, stderr: stderrText }),
  };
}

function repository(): string {
  const fixture = createGitFixture();
  mkdirSync(join(fixture.repo, ".wt"));
  writeFileSync(join(fixture.repo, ".wt", "config.toml"), [
    'worktree_path = ".worktrees"',
    'branch_template = "test/{name}"',
    'default_base = "origin/main"',
    "setup = []",
    "teardown = []",
  ].join("\n"));
  return fixture.repo;
}

test("CLI globals and command help use injected streams", async () => {
  const version = capturedContext(process.cwd());
  const result = runCli(["--version"], version);
  assert.equal(typeof result.then, "function");
  assert.equal(await result, 0);
  assert.match(version.output().stdout, /^wt /);
  assert.equal(version.output().stderr, "");

  const help = capturedContext(process.cwd());
  assert.equal(await runCli(["new", "-h"], help), 0);
  assert.match(help.output().stdout, /Usage: wt new/);
  assert.equal(help.output().stderr, "");
});

test("CLI awaits lifecycle dispatch and preserves command aliases and flags", async () => {
  const repo = repository();
  const home = mkdtempSync(join(tmpdir(), "wt-cli-shared-home-"));
  const created = capturedContext(repo, home);
  assert.equal(await runCli(["new", "cli-space", "--skip-setup", "--cd"], created), 0);
  assert.match(created.output().stdout, /Created worktree: cli-space/);
  assert.equal((created.output().stdout.match(/__cd__:/g) ?? []).length, 1);

  const listed = capturedContext(repo, home);
  assert.equal(await runCli(["list"], listed), 0);
  assert.match(listed.output().stdout, /cli-space/);

  const removed = capturedContext(repo, home);
  assert.equal(await runCli(["remove", "cli-space", "--force", "--keep-branch"], removed), 0);
  assert.match(removed.output().stdout, /Removed worktree: cli-space/);
});

test("ls supports the agent-readable output format", async () => {
  const repo = repository();
  const listed = capturedContext(repo);

  assert.equal(await runCli(["ls", "--format", "agent"], listed), 0);
  const output = listed.output().stdout;
  assert.match(output, /Managed worktrees:/);
  assert.match(output, /1\. name: \(main\)/);
  assert.ok(output.includes(`path: ${normalizePath(resolve(repo))}`));
  assert.doesNotMatch(output, /╔|║|╚/);
});

test("ls keeps table as the default and rejects unknown formats", async () => {
  const repo = repository();
  const defaultListing = capturedContext(repo);
  assert.equal(await runCli(["ls"], defaultListing), 0);
  assert.match(defaultListing.output().stdout, /╔|║|╚/);

  const explicitTable = capturedContext(repo);
  assert.equal(await runCli(["list", "--format", "table"], explicitTable), 0);
  assert.match(explicitTable.output().stdout, /╔|║|╚/);

  const invalid = capturedContext(repo);
  assert.equal(await runCli(["ls", "--format", "yaml"], invalid), 2);
  assert.match(invalid.output().stderr, /Usage: wt ls \[--format table\|agent\]/);
});

test("CLI returns stable usage and operational exit codes", async () => {
  const usage = capturedContext(process.cwd());
  assert.equal(await runCli(["new", "one", "two"], usage), 2);
  assert.match(usage.output().stderr, /Usage: wt new/);
  assert.match(usage.output().stderr, /Try `wt --help`/);

  const update = capturedContext(process.cwd());
  assert.equal(await runCli(["update", "--check"], update), 0);
  assert.match(update.output().stdout, /Source checkout detected/);
  assert.equal(update.output().stderr, "");
});
