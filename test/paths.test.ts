import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverConfig, assertInsideWorktreeRoot, normalizePath, projectId, resolveMainWorktree, statePaths } from "../src/paths.js";
import { ConfigurationError } from "../src/errors.js";

test("discovers config upward and computes compatible state paths", () => { const root = mkdtempSync(join(tmpdir(), "wt-")); mkdirSync(join(root, ".wt")); mkdirSync(join(root, "a", "b"), { recursive: true }); writeFileSync(join(root, ".wt", "config.toml"), ""); const id = projectId(root); assert.equal(normalizePath(discoverConfig(join(root, "a", "b"))), normalizePath(join(root, ".wt", "config.toml"))); assert.equal(statePaths(id, "/home/test").statePath, join("/home/test", ".wt", `${id}.json`)); });
test("rejects repository escape attempts", () => { const root = mkdtempSync(join(tmpdir(), "wt-")); mkdirSync(join(root, "inside")); assert.throws(() => assertInsideWorktreeRoot(join(root, ".."), root), ConfigurationError); });
test("resolves the main worktree from a linked worktree", () => { const root = mkdtempSync(join(tmpdir(), "wt-git-")); writeFileSync(join(root, "README"), "root\n"); execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root }); execFileSync("git", ["add", "README"], { cwd: root }); execFileSync("git", ["-c", "user.name=wt", "-c", "user.email=wt@example.test", "commit", "-qm", "init"], { cwd: root }); const linked = join(root, ".worktrees", "linked"); execFileSync("git", ["worktree", "add", "-q", "-b", "linked-branch", linked], { cwd: root }); assert.equal(resolveMainWorktree(linked), normalizePath(root)); });
