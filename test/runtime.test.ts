import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { currentUser, classifyPlatform, detectInstallChannel, requireGit } from "../src/runtime.js";
import { GitError } from "../src/errors.js";

test("runtime classifies platforms and resolves user fallback", () => { assert.equal(classifyPlatform("darwin"), "macos"); assert.equal(classifyPlatform("win32"), "windows"); assert.equal(currentUser({ USER: "", USERNAME: "fallback" }), "fallback"); });
test("missing Git is actionable", () => { assert.throws(() => requireGit(process.cwd(), (() => { throw new Error("missing"); }) as never), (error: unknown) => error instanceof GitError && error.code === "GIT_ERROR"); });
test("channel ignores caller override and detects source", () => { assert.equal(detectInstallChannel({ executablePath: process.cwd() + "/dist/wt.cjs", cwd: process.cwd(), home: "/nonexistent" }), "source"); });
test("standalone metadata takes precedence", () => { const home = mkdtempSync(join(tmpdir(), "wt-home-")); const executable = join(home, "bin", "wt"); const metadata = join(home, "install.json"); mkdirSync(join(home, "bin")); writeFileSync(metadata, JSON.stringify({ channel: "standalone", binary: executable })); assert.equal(detectInstallChannel({ executablePath: executable, metadataPath: metadata, home }), "standalone"); });
test("distinguishes local and global npm contexts", () => { const root = mkdtempSync(join(tmpdir(), "wt-npm-")); const local = join(root, "consumer", "node_modules", "@absolutepraya", "wt", "dist", "wt.cjs"); const global = join(root, "prefix", "lib", "node_modules", "@absolutepraya", "wt", "dist", "wt.cjs"); mkdirSync(join(root, "consumer"), { recursive: true }); writeFileSync(join(root, "consumer", "package.json"), "{}"); assert.equal(detectInstallChannel({ executablePath: local, home: "/nonexistent" }), "npm-local"); assert.equal(detectInstallChannel({ executablePath: global, home: "/nonexistent" }), "npm-global"); });
test("returns unknown without trusted installation evidence", () => { const root = mkdtempSync(join(tmpdir(), "wt-unknown-")); assert.equal(detectInstallChannel({ executablePath: join(root, "wt"), cwd: root, home: "/nonexistent" }), "unknown"); });
