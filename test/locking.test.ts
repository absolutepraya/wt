import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { withProjectLock, ProjectLockError } from "../src/locking.js";

function lockPath(): string { return join(mkdtempSync(join(tmpdir(), "wt-lock-")), "project.lock"); }
function staleMetadata(overrides: Record<string, unknown> = {}): string { return JSON.stringify({ pid: 999_999_999, hostname: hostname(), token: "stale", startedAt: "2020-01-01T00:00:00.000Z", ...overrides }); }
function staleLock(path: string, contents: string): void { writeFileSync(path, contents); const old = new Date(Date.now() - 61_000); utimesSync(path, old, old); }
function spawnWorker(path: string, output: string, label: string): Promise<void> {
  const source = join(mkdtempSync(join(tmpdir(), "wt-lock-worker-")), "worker.ts");
  writeFileSync(source, `import { appendFile } from "node:fs/promises"; import { withProjectLock } from ${JSON.stringify(join(process.cwd(), "src", "locking.ts"))}; void (async () => { await withProjectLock(process.argv[2]!, async () => { await appendFile(process.argv[3]!, "start:${label}\\n"); await new Promise((resolve) => setTimeout(resolve, 180)); await appendFile(process.argv[3]!, "end:${label}\\n"); }); })().catch((error) => { console.error(error); process.exitCode = 1; });`);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), source, path, output], { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`worker exited ${code}`)));
  });
}

test("serializes separate child processes", async () => {
  const path = lockPath();
  const output = join(path, "..", "order.txt");
  await Promise.all([spawnWorker(path, output, "one"), spawnWorker(path, output, "two")]);
  const lines = readFileSync(output, "utf8").trim().split("\n");
  assert.equal(lines.length, 4);
  assert.equal(lines[0].startsWith("start:"), true);
  assert.equal(lines[1], `end:${lines[0].slice("start:".length)}`);
  assert.equal(lines[2].startsWith("start:"), true);
  assert.equal(lines[3], `end:${lines[2].slice("start:".length)}`);
});

test("protects a live owner and recovers invalid or dead stale locks", async () => {
  const live = lockPath();
  writeFileSync(live, staleMetadata({ pid: process.pid }));
  await assert.rejects(withProjectLock(live, () => undefined, { timeoutMs: 120 }), (error: unknown) => error instanceof ProjectLockError && error.code === "LOCK_TIMEOUT");
  const freshInvalid = lockPath();
  writeFileSync(freshInvalid, "not json");
  await assert.rejects(withProjectLock(freshInvalid, () => undefined, { timeoutMs: 120 }), (error: unknown) => error instanceof ProjectLockError && error.code === "LOCK_TIMEOUT");
  const invalid = lockPath();
  staleLock(invalid, "not json");
  await withProjectLock(invalid, () => undefined);
  await assert.rejects(async () => readFileSync(invalid), /ENOENT/);
  const dead = lockPath();
  staleLock(dead, staleMetadata());
  await withProjectLock(dead, () => undefined);
});

test("records the owner metadata and reports unrecoverable stale lock paths", async () => {
  const path = lockPath();
  await withProjectLock(path, () => {
    const metadata = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(metadata.pid, process.pid);
    assert.equal(metadata.hostname, hostname());
    assert.equal(typeof metadata.token, "string");
    assert.equal(typeof metadata.startedAt, "string");
  });
  const directory = lockPath();
  mkdirSync(directory);
  await assert.rejects(withProjectLock(directory, () => undefined), (error: unknown) => error instanceof ProjectLockError && error.code === "LOCK_STALE_OWNER");
});

test("does not remove a lock when its token changes", async () => {
  const path = lockPath();
  await assert.rejects(withProjectLock(path, async () => { writeFileSync(path, staleMetadata({ token: "replacement", pid: process.pid })); }), (error: unknown) => error instanceof ProjectLockError && error.code === "LOCK_OWNERSHIP");
  assert.equal(JSON.parse(readFileSync(path, "utf8")).token, "replacement");
});

test("cleans up after successful and failed callbacks", async () => {
  const success = lockPath();
  assert.equal(await withProjectLock(success, () => "ok"), "ok");
  await assert.rejects(async () => readFileSync(success), /ENOENT/);
  const failure = lockPath();
  await assert.rejects(withProjectLock(failure, () => { throw new Error("callback failed"); }), /callback failed/);
  await assert.rejects(async () => readFileSync(failure), /ENOENT/);
});
