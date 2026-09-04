import { test } from "node:test";
import assert from "node:assert/strict";
import { currentUser, classifyPlatform, detectInstallChannel, requireGit } from "../src/runtime.js";
import { GitError } from "../src/errors.js";

test("runtime classifies platforms and resolves user fallback", () => { assert.equal(classifyPlatform("darwin"), "macos"); assert.equal(classifyPlatform("win32"), "windows"); assert.equal(currentUser({ USER: "", USERNAME: "fallback" }), "fallback"); });
test("missing Git is actionable", () => { assert.throws(() => requireGit(process.cwd(), (() => { throw new Error("missing"); }) as never), (error: unknown) => error instanceof GitError && error.code === "GIT_ERROR"); });
test("channel ignores caller override and detects source", () => { assert.equal(detectInstallChannel({ executablePath: process.cwd() + "/dist/wt.cjs", cwd: process.cwd(), home: "/nonexistent" }), "source"); });
