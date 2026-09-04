import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createEmptyState, freeSlot, loadState, reserveSlot, saveState } from "../src/state.js";
import { ConfigurationError } from "../src/errors.js";
import type { StateEntry } from "../src/types.js";

function entry(name = "adelaide"): StateEntry { return { name, branch: `user/${name}`, path: `.worktrees/${name}`, base: "origin/main", created_at: "2026-09-04T00:00:00.000Z" }; }
function statePath(): string { return join(mkdtempSync(join(tmpdir(), "wt-state-")), "state.json"); }

test("state saves and loads the compatible snake_case schema", async () => {
  const path = statePath();
  const initial = createEmptyState("/repo");
  const { slot, state } = reserveSlot(initial, 3, { ...entry(), tracks_remote: true });
  assert.equal(slot, 1);
  await saveState(path, state);
  assert.deepEqual(await loadState(path), state);
  assert.match(readFileSync(path, "utf8"), /"project_root"/);
  assert.match(readFileSync(path, "utf8"), /"tracks_remote"/);
  if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o077, 0);
});

test("optional tracks_remote remains absent and slot transforms do not mutate input", async () => {
  const initial = createEmptyState("/repo");
  const reserved = reserveSlot(initial, 3, entry());
  assert.deepEqual(initial.slots, {});
  assert.equal("tracks_remote" in reserved.state.slots["1"], false);
  const freed = freeSlot(reserved.state, 1);
  assert.equal("1" in reserved.state.slots, true);
  assert.deepEqual(freed.slots, {});
  await saveState(statePath(), reserved.state);
});

test("missing state is empty, malformed state is rejected, and interrupted temp files are ignored", async () => {
  const path = statePath();
  assert.deepEqual(await loadState(path), createEmptyState());
  writeFileSync(path, "{not json");
  await assert.rejects(loadState(path), ConfigurationError);
  const good = createEmptyState("/repo");
  await saveState(path, good);
  writeFileSync(join(path, "..", ".state.json.interrupted.tmp"), "{not json");
  assert.deepEqual(await loadState(path), good);
});

test("rename failure preserves the previous state and cleans up the temporary file", async () => {
  const path = statePath(); const previous = createEmptyState("/previous"); const replacement = createEmptyState("/replacement");
  await saveState(path, previous);
  await assert.rejects(saveState(path, replacement, { replace: async () => { throw new Error("rename failed"); } }), /rename failed/);
  assert.deepEqual(await loadState(path), previous);
  assert.equal(readdirSync(join(path, "..")).some((name) => name.endsWith(".tmp")), false);
});

test("state validation rejects incompatible entries and reports exhausted slots", async () => {
  const path = statePath();
  writeFileSync(path, JSON.stringify({ version: 1, project_root: "/repo", slots: { "0": entry() } }));
  await assert.rejects(loadState(path), ConfigurationError);
  const reserved = reserveSlot(createEmptyState(), 1, entry());
  assert.throws(() => reserveSlot(reserved.state, 1, entry("bergen")), ConfigurationError);
});
