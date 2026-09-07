import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { ConfigurationError } from "../src/errors.js";

function fixture(contents: string): string { const root = mkdtempSync(join(tmpdir(), "wt-config-")); mkdirSync(join(root, ".wt")); writeFileSync(join(root, ".wt", "config.toml"), contents); return root; }
test("uses exact defaults", () => { const c = loadConfig(fixture("")); assert.equal(c.worktreePath, ".worktrees"); assert.equal(c.portOffsetInterval, 10); assert.equal(c.maxSlots, 20); assert.equal(c.nameStrategy, "cities"); assert.deepEqual(c.setup, []); });
test("validates malformed, numeric, strategy, and ordered command values", () => { assert.throws(() => loadConfig(fixture("bad = [")), ConfigurationError); assert.throws(() => loadConfig(fixture("max_slots = 0")), ConfigurationError); assert.throws(() => loadConfig(fixture('name_strategy = "nope"')), ConfigurationError); assert.throws(() => loadConfig(fixture('setup = [1]')), ConfigurationError); });
test("rejects absolute and escaping worktree paths", () => { assert.throws(() => loadConfig(fixture('worktree_path = "../outside"')), ConfigurationError); });
