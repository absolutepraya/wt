import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { UpdateError } from "../src/errors.js";
import { latestStableRelease, parseChecksums, parseStableVersion, runUpdate, validateCliPayload } from "../src/update.js";
import type { CliContext } from "../src/types.js";

const RELEASE_API = "https://api.example.test/releases/latest";
const TAG = "v0.3.2";
const RELEASE_ROOT = `https://github.com/absolutepraya/wt/releases/download/${TAG}`;

function digest(value: Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function payloads(version = "0.3.2"): Map<string, Buffer> {
  const result = new Map<string, Buffer>([
    ["wt", Buffer.from(`#!/usr/bin/env node\nconst VERSION = \"${version}\";\nconsole.log(VERSION);\n`)],
    ["wt.sh", Buffer.from("wt() { command wt \"$@\"; }\n")],
    ["wt.fish", Buffer.from("function wt\n  command wt $argv\nend\n")],
  ]);
  result.set("checksums.txt", Buffer.from([...result].map(([name, value]) => `${digest(value)}  ${name}`).join("\n") + "\n"));
  return result;
}
function release(assets = ["wt", "wt.sh", "wt.fish", "checksums.txt"], overrides: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ tag_name: TAG, draft: false, prerelease: false, assets: assets.map((name) => ({ name, browser_download_url: `${RELEASE_ROOT}/${name}` })), ...overrides }));
}
function fetchFor(values: Map<string, Buffer>, calls: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url === RELEASE_API) return release();
    const name = url.slice(url.lastIndexOf("/") + 1);
    const value = values.get(name);
    return value ? new Response(new Uint8Array(value)) : new Response("not found", { status: 404 });
  }) as typeof fetch;
}
function context(cwd = process.cwd()): CliContext & { output(): string } {
  const stdout = new PassThrough();
  let output = "";
  stdout.on("data", (chunk) => { output += String(chunk); });
  return { cwd, env: { ...process.env }, io: { stdout, stderr: new PassThrough(), stdin: process.stdin, stdoutIsTTY: false, stdinIsTTY: false }, output: () => output };
}
function assetRelease(assetOverrides: Record<string, string> = {}, overrides: Record<string, unknown> = {}): Response {
  const assets = ["wt", "wt.sh", "wt.fish", "checksums.txt"].map((name) => ({ name, browser_download_url: assetOverrides[name] ?? `${RELEASE_ROOT}/${name}` }));
  return release([], { assets, ...overrides });
}
function standaloneFixture(): { executable: string; configDir: string } {
  const root = mkdtempSync(join(tmpdir(), "wt-update-"));
  const executable = join(root, "bin", "wt");
  const configDir = join(root, "config");
  mkdirSync(dirnameFor(executable), { recursive: true });
  mkdirSync(configDir, { recursive: true });
  writeFileSync(executable, "old executable\n");
  writeFileSync(join(configDir, "wt.sh"), "old shell\n");
  writeFileSync(join(configDir, "wt.fish"), "old fish\n");
  writeFileSync(join(configDir, "install.json"), JSON.stringify({ channel: "standalone", binary: executable }) + "\n");
  return { executable, configDir };
}
function dirnameFor(value: string): string { return value.slice(0, value.lastIndexOf("/")); }

test("stable release parsing rejects prerelease forms and malformed release metadata", async () => {
  assert.equal(parseStableVersion("v1.2.3"), "1.2.3");
  assert.equal(parseStableVersion("01.2.3"), null);
  assert.equal(parseStableVersion("1.2.3-beta.1"), null);
  assert.equal(parseStableVersion("1.2.3+build.1"), null);
  await assert.rejects(() => latestStableRelease(RELEASE_API, (async () => release([], { draft: true })) as typeof fetch), /stable release/);
  await assert.rejects(() => latestStableRelease(RELEASE_API, (async () => release([], { prerelease: true })) as typeof fetch), UpdateError);
  await assert.rejects(() => latestStableRelease(RELEASE_API, (async () => release([], { tag_name: "release-0.3.2" })) as typeof fetch), /stable vX.Y.Z/);
  await assert.rejects(() => latestStableRelease(RELEASE_API, (async () => release([], { tag_name: "v1.2.3-beta.1" })) as typeof fetch), /stable vX.Y.Z/);
  await assert.rejects(() => latestStableRelease(RELEASE_API, (async () => new Response(JSON.stringify({ draft: false, prerelease: false, assets: [] }))) as typeof fetch), /no tag/);
  await assert.rejects(() => latestStableRelease(RELEASE_API, (async () => release(["wt", "wt.sh", "wt.fish"])) as typeof fetch), /missing update assets/);
  await assert.rejects(() => latestStableRelease(RELEASE_API, (async () => release(["wt", "wt", "wt.sh", "wt.fish", "checksums.txt"])) as typeof fetch), /duplicate asset/);
  await assert.rejects(() => latestStableRelease(RELEASE_API, (async () => assetRelease({ wt: `${RELEASE_ROOT.replace(TAG, "v0.3.1")}/wt` })) as typeof fetch), /expected wt release/);
  await assert.rejects(() => latestStableRelease(RELEASE_API, (async () => assetRelease({ wt: `${RELEASE_ROOT}/other` })) as typeof fetch), /expected wt release/);
  await assert.rejects(() => latestStableRelease(RELEASE_API, (async () => new Response(JSON.stringify({ tag_name: TAG, draft: false, prerelease: false, assets: [{ name: "wt", browser_download_url: "https://evil.example/wt" }] }))) as typeof fetch), /expected wt release/);
});

test("checksum and embedded Node payload validation are strict", () => {
  const checksums = parseChecksums(`${"a".repeat(64)}  wt\n${"b".repeat(64)} *wt.sh\ninvalid\n`);
  assert.equal(checksums.get("wt"), "a".repeat(64));
  assert.equal(checksums.get("wt.sh"), "b".repeat(64));
  validateCliPayload(payloads().get("wt")!, "0.3.2");
  assert.throws(() => validateCliPayload(Buffer.from("#!/usr/bin/env python3\nconst VERSION = '0.3.2';\n"), "0.3.2"), /interpreter header/);
  assert.throws(() => validateCliPayload(payloads("0.3.1").get("wt")!, "0.3.2"), /version does not match/);
});

test("standalone update verifies every payload before replacing any installed file", async () => {
  const fixture = standaloneFixture();
  const downloaded = payloads();
  downloaded.set("checksums.txt", Buffer.from(`${"0".repeat(64)}  wt\n${digest(downloaded.get("wt.sh")!)}  wt.sh\n${digest(downloaded.get("wt.fish")!)}  wt.fish\n`));
  const before = [readFileSync(fixture.executable, "utf8"), readFileSync(join(fixture.configDir, "wt.sh"), "utf8"), readFileSync(join(fixture.configDir, "wt.fish"), "utf8")];
  await assert.rejects(() => runUpdate(context(), false, { apiUrl: RELEASE_API, fetchImpl: fetchFor(downloaded), executablePath: fixture.executable, configDir: fixture.configDir, now: () => new Date("2026-09-04T00:00:00.000Z") }), /checksum verification failed/);
  assert.deepEqual([readFileSync(fixture.executable, "utf8"), readFileSync(join(fixture.configDir, "wt.sh"), "utf8"), readFileSync(join(fixture.configDir, "wt.fish"), "utf8")], before);
});

test("standalone update rejects an untrusted redirect from a validated release asset", async () => {
  const fixture = standaloneFixture();
  const downloaded = payloads();
  const redirectingFetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url === RELEASE_API) return release();
    if (url === `${RELEASE_ROOT}/wt`) return new Response(null, { status: 302, headers: { location: "https://evil.example/payload" } });
    return new Response(new Uint8Array(downloaded.get(url.slice(url.lastIndexOf("/") + 1))!));
  }) as typeof fetch;
  await assert.rejects(() => runUpdate(context(), false, { apiUrl: RELEASE_API, fetchImpl: redirectingFetch, executablePath: fixture.executable, configDir: fixture.configDir, now: () => new Date() }), /unapproved host/);
  assert.equal(readFileSync(fixture.executable, "utf8"), "old executable\n");
});

test("standalone update accepts the expected signed GitHub release CDN redirect", async () => {
  const fixture = standaloneFixture();
  const downloaded = payloads();
  const cdn = "https://release-assets.githubusercontent.com/github-production-release-asset/12345/wt?sig=test";
  const redirectingFetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url === RELEASE_API) return release();
    if (url === `${RELEASE_ROOT}/wt`) return new Response(null, { status: 302, headers: { location: cdn } });
    const name = url.startsWith("https://release-assets.githubusercontent.com/") ? "wt" : url.slice(url.lastIndexOf("/") + 1);
    return new Response(new Uint8Array(downloaded.get(name)!));
  }) as typeof fetch;
  await runUpdate(context(), false, { apiUrl: RELEASE_API, fetchImpl: redirectingFetch, executablePath: fixture.executable, configDir: fixture.configDir, now: () => new Date() });
  assert.match(readFileSync(fixture.executable, "utf8"), /VERSION = "0.3.2"/);
});

test("standalone update replaces the executable, shell assets, and metadata as one validated set", async () => {
  const fixture = standaloneFixture();
  const output = context();
  await runUpdate(output, false, { apiUrl: RELEASE_API, fetchImpl: fetchFor(payloads()), executablePath: fixture.executable, configDir: fixture.configDir, now: () => new Date("2026-09-04T00:00:00.000Z") });
  assert.match(readFileSync(fixture.executable, "utf8"), /VERSION = "0.3.2"/);
  assert.match(readFileSync(join(fixture.configDir, "wt.sh"), "utf8"), /command wt/);
  assert.equal(JSON.parse(readFileSync(join(fixture.configDir, "install.json"), "utf8")).tag, TAG);
  assert.match(output.output(), /Installed version: .*\nLatest stable version: 0.3.2/);
  assert.match(output.output(), /Updated wt from/);
});

test("standalone update rolls back after a destination was renamed", async () => {
  const fixture = standaloneFixture();
  const before = {
    executable: readFileSync(fixture.executable, "utf8"),
    shell: readFileSync(join(fixture.configDir, "wt.sh"), "utf8"),
    fish: readFileSync(join(fixture.configDir, "wt.fish"), "utf8"),
    metadata: readFileSync(join(fixture.configDir, "install.json"), "utf8"),
  };
  let injected = false;
  const renameImpl: typeof rename = async (from, to) => {
    if (!injected && String(from).includes(".wt.sh.wt-update-")) {
      injected = true;
      throw new Error("injected replacement failure");
    }
    await rename(from, to);
  };
  await assert.rejects(() => runUpdate(context(), false, { apiUrl: RELEASE_API, fetchImpl: fetchFor(payloads()), executablePath: fixture.executable, configDir: fixture.configDir, now: () => new Date(), renameImpl }), /injected replacement failure/);
  assert.equal(injected, true);
  assert.deepEqual({
    executable: readFileSync(fixture.executable, "utf8"),
    shell: readFileSync(join(fixture.configDir, "wt.sh"), "utf8"),
    fish: readFileSync(join(fixture.configDir, "wt.fish"), "utf8"),
    metadata: readFileSync(join(fixture.configDir, "install.json"), "utf8"),
  }, before);
});

test("update check fetches stable diagnostics but never downloads or changes standalone files", async () => {
  const fixture = standaloneFixture();
  const downloaded = payloads();
  const calls: string[] = [];
  const output = context();
  await runUpdate(output, true, { apiUrl: RELEASE_API, fetchImpl: fetchFor(downloaded, calls), executablePath: fixture.executable, configDir: fixture.configDir, now: () => new Date() });
  assert.deepEqual(calls, [RELEASE_API]);
  assert.equal(readFileSync(fixture.executable, "utf8"), "old executable\n");
  assert.match(output.output(), /Update available/);
});
