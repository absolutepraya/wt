import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { detectInstallChannel } from "../src/runtime.js";
import { runUpdate } from "../src/update.js";
import type { CliContext } from "../src/types.js";

function outputContext(cwd: string): CliContext & { output(): string } {
  const stdout = new PassThrough();
  let output = "";
  stdout.on("data", (chunk) => { output += String(chunk); });
  return { cwd, env: { WT_INSTALL_CHANNEL: "standalone" }, io: { stdout, stderr: new PassThrough(), stdin: process.stdin, stdoutIsTTY: false, stdinIsTTY: false }, output: () => output };
}

test("matching standalone metadata takes precedence over an untrusted environment override", () => {
  const root = mkdtempSync(join(tmpdir(), "wt-channel-"));
  const executable = join(root, "bin", "wt");
  const metadata = join(root, "config", "install.json");
  mkdirSync(join(root, "bin"), { recursive: true });
  mkdirSync(join(root, "config"), { recursive: true });
  writeFileSync(metadata, JSON.stringify({ channel: "standalone", binary: executable }));
  const previous = process.env.WT_INSTALL_CHANNEL;
  process.env.WT_INSTALL_CHANNEL = "npm";
  try { assert.equal(detectInstallChannel({ executablePath: executable, metadataPath: metadata }), "standalone"); }
  finally { if (previous === undefined) delete process.env.WT_INSTALL_CHANNEL; else process.env.WT_INSTALL_CHANNEL = previous; }
});

test("npm channel detection distinguishes a project-local package, global package, source checkout, and unknown paths", () => {
  const root = mkdtempSync(join(tmpdir(), "wt-channel-"));
  const local = join(root, "project", "node_modules", "@absolutepraya", "wt", "dist", "wt.cjs");
  const global = join(root, "prefix", "lib", "node_modules", "@absolutepraya", "wt", "dist", "wt.cjs");
  const source = join(root, "source");
  mkdirSync(join(root, "project"), { recursive: true });
  writeFileSync(join(root, "project", "package.json"), "{}");
  mkdirSync(join(source, "src"), { recursive: true });
  mkdirSync(join(source, "dist"), { recursive: true });
  writeFileSync(join(source, "package.json"), JSON.stringify({ name: "@absolutepraya/wt" }));
  writeFileSync(join(source, "src", "cli.ts"), "export {};\n");
  assert.equal(detectInstallChannel({ executablePath: local, home: join(root, "no-home") }), "npm-local");
  assert.equal(detectInstallChannel({ executablePath: global, home: join(root, "no-home") }), "npm-global");
  assert.equal(detectInstallChannel({ executablePath: join(source, "dist", "wt.cjs"), cwd: source, home: join(root, "no-home") }), "source");
  assert.equal(detectInstallChannel({ executablePath: join(root, "unmanaged", "wt"), cwd: join(root, "unmanaged"), home: join(root, "no-home") }), "unknown");
});

test("npm channel detection resolves a Unix bin symlink before classifying the package", { skip: process.platform === "win32" ? "Unix npm bins use symlinks" : false }, () => {
  const root = mkdtempSync(join(tmpdir(), "wt-channel-symlink-"));
  const project = join(root, "project");
  const target = join(project, "node_modules", "@absolutepraya", "wt", "dist", "wt.cjs");
  const link = join(root, "bin", "wt");
  mkdirSync(join(project, "node_modules", "@absolutepraya", "wt", "dist"), { recursive: true });
  mkdirSync(join(root, "bin"), { recursive: true });
  writeFileSync(join(project, "package.json"), "{}\n");
  writeFileSync(target, "#!/usr/bin/env node\n");
  symlinkSync(target, link);
  assert.equal(detectInstallChannel({ executablePath: link, cwd: root, home: join(root, "no-home") }), "npm-local");
});

test("npm update guidance is channel-specific and never invokes a self-update fetch", async () => {
  const root = mkdtempSync(join(tmpdir(), "wt-channel-"));
  const local = join(root, "project", "node_modules", "@absolutepraya", "wt", "dist", "wt.cjs");
  const global = join(root, "prefix", "lib", "node_modules", "@absolutepraya", "wt", "dist", "wt.cjs");
  mkdirSync(join(root, "project"), { recursive: true });
  writeFileSync(join(root, "project", "package.json"), "{}");
  const neverFetch = (async () => { throw new Error("self-update fetch must not run for npm"); }) as typeof fetch;
  const globalContext = outputContext(root);
  assert.equal(await runUpdate(globalContext, true, { apiUrl: "https://example.test/releases", fetchImpl: neverFetch, executablePath: global, configDir: join(root, "config"), now: () => new Date() }), 0);
  assert.equal(globalContext.output(), "Global install detected. Run: npm update -g @absolutepraya/wt\n");
  const localContext = outputContext(root);
  assert.equal(await runUpdate(localContext, true, { apiUrl: "https://example.test/releases", fetchImpl: neverFetch, executablePath: local, configDir: join(root, "config"), now: () => new Date() }), 0);
  assert.equal(localContext.output(), "Local install detected. Run: npm update -D @absolutepraya/wt\n");
});
