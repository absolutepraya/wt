import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ProjectLockError, withProjectLock } from "../src/locking.js";

const OWNER_PREFIX = "owner-";
const METADATA_FILE = "metadata.json";
function lockPath(): string { return join(mkdtempSync(join(tmpdir(), "wt-lock-")), "project.lock"); }
function ownerPath(path: string, token: string): string { return join(path, `${OWNER_PREFIX}${token}`); }
function metadataPath(path: string, token: string): string { return join(ownerPath(path, token), METADATA_FILE); }
function metadata(token: string, overrides: Record<string, unknown> = {}): string { return JSON.stringify({ pid: process.pid, hostname: hostname(), token, startedAt: "2026-09-04T00:00:00.000Z", ...overrides }); }
function writeLock(path: string, token: string, contents = metadata(token), stale = false): void {
  mkdirSync(path); mkdirSync(ownerPath(path, token)); writeFileSync(metadataPath(path, token), contents);
  if (stale) { const old = new Date(Date.now() - 61_000); utimesSync(metadataPath(path, token), old, old); }
}
function removeLock(path: string, token: string): void { unlinkSync(metadataPath(path, token)); rmdirSync(ownerPath(path, token)); rmdirSync(path); }
function makeStale(path: string): void { const old = new Date(Date.now() - 61_000); utimesSync(path, old, old); }
function deferred(): { promise: Promise<void>; resolve: () => void } { let resolve!: () => void; return { promise: new Promise<void>((done) => { resolve = done; }), resolve }; }
function waitFor(child: ChildProcess, type: string): Promise<void> {
  return new Promise((resolve, reject) => { const onMessage = (message: unknown) => { if ((message as { type?: string }).type === type) { child.off("message", onMessage); resolve(); } }; child.on("message", onMessage); child.once("error", reject); child.once("exit", (code) => { if (code !== 0) reject(new Error(`worker exited ${code}`)); }); });
}
function waitForExit(child: ChildProcess): Promise<void> { return new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`worker exited ${code}`))); }); }
function spawnWorker(path: string, output: string, role: "holder" | "waiter"): ChildProcess {
  const source = join(mkdtempSync(join(tmpdir(), "wt-lock-worker-")), "worker.ts");
  writeFileSync(source, `import { appendFile } from "node:fs/promises"; import { withProjectLock } from ${JSON.stringify(join(process.cwd(), "src", "locking.ts"))}; const wait = (type: string) => new Promise<void>((resolve) => process.on("message", (message: unknown) => { if ((message as { type?: string }).type === type) resolve(); })); void (async () => { const [path, output, role] = process.argv.slice(2); const testHooks = role === "waiter" ? { beforeFirstAcquireAttempt: async () => { process.send?.({ type: "before-attempt" }); await wait("attempt"); }, afterFirstAcquireContention: () => process.send?.({ type: "contended" }) } : undefined; await withProjectLock(path!, async () => { await appendFile(output!, \`start:\${role}\\n\`); process.send?.({ type: role === "holder" ? "held" : "acquired" }); if (role === "holder") await wait("release"); await appendFile(output!, \`end:\${role}\\n\`); }, { testHooks }); process.disconnect?.(); })().catch((error) => { console.error(error); process.exitCode = 1; process.disconnect?.(); });`);
  return spawn(process.execPath, [join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), source, path, output, role], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
}

test("serializes child processes after a confirmed in-path contention attempt", async () => {
  const path = lockPath(); const output = join(path, "..", "order.txt");
  const holder = spawnWorker(path, output, "holder"); await waitFor(holder, "held");
  const waiter = spawnWorker(path, output, "waiter"); await waitFor(waiter, "before-attempt"); waiter.send({ type: "attempt" }); await waitFor(waiter, "contended");
  holder.send({ type: "release" }); await Promise.all([waitForExit(holder), waitForExit(waiter)]);
  assert.deepEqual(readFileSync(output, "utf8").trim().split("\n"), ["start:holder", "end:holder", "start:waiter", "end:waiter"]);
});

test("recovers stale metadata-less crash windows without removing a successor", async () => {
  const empty = lockPath(); mkdirSync(empty); makeStale(empty); await withProjectLock(empty, () => undefined); assert.throws(() => statSync(empty), /ENOENT/);
  const incomplete = lockPath(); mkdirSync(incomplete); mkdirSync(ownerPath(incomplete, "crashed")); makeStale(incomplete); await withProjectLock(incomplete, () => undefined); assert.throws(() => statSync(incomplete), /ENOENT/);
  const raced = lockPath(); mkdirSync(raced); mkdirSync(ownerPath(raced, "crashed")); makeStale(raced);
  await assert.rejects(withProjectLock(raced, () => undefined, { timeoutMs: 120, testHooks: { beforeStaleCleanup: () => { rmdirSync(ownerPath(raced, "crashed")); rmdirSync(raced); writeLock(raced, "successor"); } } }), (error: unknown) => error instanceof ProjectLockError && error.code === "LOCK_TIMEOUT");
  assert.equal(JSON.parse(readFileSync(metadataPath(raced, "successor"), "utf8")).token, "successor");
});

test("recovers a stale empty lock on Windows and preserves a successor", { skip: process.platform !== "win32" }, async () => {
  const recovered = lockPath(); mkdirSync(recovered); makeStale(recovered); let acquired = false;
  await withProjectLock(recovered, () => { acquired = true; assert.equal(statSync(recovered).isDirectory(), true); });
  assert.equal(acquired, true); assert.throws(() => statSync(recovered), /ENOENT/);

  const raced = lockPath(); mkdirSync(raced); makeStale(raced);
  try {
    await assert.rejects(withProjectLock(raced, () => { throw new Error("unexpected acquisition"); }, { timeoutMs: 0, testHooks: { beforeEmptyLockReplacement: () => { rmdirSync(raced); writeLock(raced, "successor"); } } }), (error: unknown) => error instanceof ProjectLockError && error.code === "LOCK_TIMEOUT");
    assert.equal(JSON.parse(readFileSync(metadataPath(raced, "successor"), "utf8")).token, "successor");
  } finally { removeLock(raced, "successor"); }
});

test("does not replace a successor published during stale empty-lock recovery", async () => {
  const path = lockPath(); mkdirSync(path); makeStale(path);
  try {
    await assert.rejects(withProjectLock(path, () => { throw new Error("unexpected acquisition"); }, { timeoutMs: 0, testHooks: { beforeEmptyLockReplacement: () => { rmdirSync(path); writeLock(path, "successor"); } } }), (error: unknown) => error instanceof ProjectLockError && error.code === "LOCK_TIMEOUT");
    assert.equal(JSON.parse(readFileSync(metadataPath(path, "successor"), "utf8")).token, "successor");
    await assert.rejects(withProjectLock(path, () => { throw new Error("unexpected successor acquisition"); }, { timeoutMs: 0 }), (error: unknown) => error instanceof ProjectLockError && error.code === "LOCK_TIMEOUT");
  } finally { if (statSync(path).isDirectory()) { const owner = readdirSync(path).find((entry) => entry.startsWith(OWNER_PREFIX)); if (owner) { unlinkSync(join(path, owner, METADATA_FILE)); rmdirSync(join(path, owner)); } rmdirSync(path); } }
});

test("cleans the prepared candidate when stale recovery fails", async () => {
  const path = lockPath(); mkdirSync(path); makeStale(path);
  await assert.rejects(withProjectLock(path, () => undefined, { testHooks: { beforeEmptyLockReplacement: () => { throw new Error("stale recovery failed"); } } }), /stale recovery failed/);
  assert.equal(readdirSync(join(path, "..")).some((entry) => entry.startsWith(".project.lock.owner-")), false);
  rmdirSync(path);
});

test("preserves a successor during deterministic stale recovery and release races", async () => {
  const stale = lockPath(); writeLock(stale, "owner-a", metadata("owner-a", { pid: 999_999_999 }), true);
  await assert.rejects(withProjectLock(stale, () => undefined, { timeoutMs: 120, testHooks: { beforeStaleCleanup: () => { removeLock(stale, "owner-a"); writeLock(stale, "owner-b"); } } }), (error: unknown) => error instanceof ProjectLockError && error.code === "LOCK_TIMEOUT");
  assert.equal(JSON.parse(readFileSync(metadataPath(stale, "owner-b"), "utf8")).token, "owner-b");
  const release = lockPath();
  await withProjectLock(release, () => undefined, { testHooks: { beforeOuterRmdir: () => { rmdirSync(release); writeLock(release, "successor"); } } });
  assert.equal(JSON.parse(readFileSync(metadataPath(release, "successor"), "utf8")).token, "successor");
});

test("protects live and fresh-invalid owners, then recovers dead or invalid stale owners", async () => {
  const live = lockPath(); writeLock(live, "live");
  await assert.rejects(withProjectLock(live, () => undefined, { timeoutMs: 120 }), (error: unknown) => error instanceof ProjectLockError && error.code === "LOCK_TIMEOUT");
  const freshInvalid = lockPath(); writeLock(freshInvalid, "invalid", "not json");
  await assert.rejects(withProjectLock(freshInvalid, () => undefined, { timeoutMs: 120 }), (error: unknown) => error instanceof ProjectLockError && error.code === "LOCK_TIMEOUT");
  const invalid = lockPath(); writeLock(invalid, "invalid", "not json", true); await withProjectLock(invalid, () => undefined);
  const dead = lockPath(); writeLock(dead, "dead", metadata("dead", { pid: 999_999_999 }), true); await withProjectLock(dead, () => undefined);
});

test("records metadata in a directory lock and drains an in-flight heartbeat before release", async () => {
  const keepAlive = setInterval(() => undefined, 1_000);
  try {
    const path = lockPath(); const read = deferred(); const continueRefresh = deferred(); const finishCallback = deferred(); let releaseDone = false;
    const held = withProjectLock(path, async () => finishCallback.promise, { testHooks: { refreshIntervalMs: 1, afterRefreshRead: async () => { read.resolve(); await continueRefresh.promise; } } });
    await read.promise;
    finishCallback.resolve(); const release = held.then(() => { releaseDone = true; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(releaseDone, false);
    assert.equal(statSync(path).isDirectory(), true);
    const owner = readdirSync(path).find((entry) => entry.startsWith(OWNER_PREFIX))!;
    const stored = JSON.parse(readFileSync(join(path, owner, METADATA_FILE), "utf8"));
    assert.equal(stored.pid, process.pid); assert.equal(stored.hostname, hostname()); assert.equal(typeof stored.token, "string"); assert.equal(typeof stored.startedAt, "string");
    continueRefresh.resolve(); await release;
  } finally { clearInterval(keepAlive); }
});

test("does not remove a different owner and cleans up callback outcomes", async () => {
  const path = lockPath();
  await assert.rejects(withProjectLock(path, () => { const token = readdirSync(path).find((entry) => entry.startsWith(OWNER_PREFIX))!.slice(OWNER_PREFIX.length); unlinkSync(metadataPath(path, token)); rmdirSync(ownerPath(path, token)); rmdirSync(path); writeLock(path, "replacement"); }), (error: unknown) => error instanceof ProjectLockError && error.code === "LOCK_OWNERSHIP");
  assert.equal(JSON.parse(readFileSync(metadataPath(path, "replacement"), "utf8")).token, "replacement");
  const failure = lockPath(); await assert.rejects(withProjectLock(failure, () => { throw new Error("callback failed"); }), /callback failed/); assert.throws(() => statSync(failure), /ENOENT/);
  const acquireFailure = lockPath(); await assert.rejects(withProjectLock(acquireFailure, () => undefined, { testHooks: { beforeMetadataWrite: () => { throw new Error("metadata write failed"); } } }), /metadata write failed/); assert.throws(() => statSync(acquireFailure), /ENOENT/);
});

test("uses directory locks on Windows", { skip: process.platform !== "win32" }, async () => {
  const path = lockPath(); await withProjectLock(path, () => assert.equal(statSync(path).isDirectory(), true));
});
