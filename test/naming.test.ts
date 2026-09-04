import { test } from "node:test";
import assert from "node:assert/strict";
import { CITIES, generateName, resolveName, sanitizeBranchName } from "../src/naming.js";
import { UsageError } from "../src/errors.js";

test("ports the deterministic city inventory and collision fallback", () => {
  assert.equal(CITIES.length, 117);
  const used = new Set(CITIES.slice(0, -1));
  assert.equal(generateName("cities", used, { random: () => 0, maxTries: 1 }), CITIES.at(-1));
  const exhausted = generateName("cities", new Set(CITIES), { random: () => 0, tokenHex: () => "c0de" });
  assert.equal(exhausted, "adelaide-c0de");
});

test("word pairs avoid collisions and explicit names are checked", () => {
  const name = generateName("word_pairs", new Set(["amber-anchor"]), { random: () => 0.0001, tokenHex: () => "beef" });
  assert.equal(name, "amber-anchor-beef");
  assert.equal(resolveName("feature-one", "cities", new Set()), "feature-one");
  for (const name of ["feature/one", "feature\\one", ".", ".."]) assert.throws(() => resolveName(name, "cities", new Set()), UsageError);
  assert.throws(() => resolveName("feature-one", "cities", new Set(["feature-one"])), UsageError);
});

test("validates branch names without silently rewriting them", () => {
  assert.equal(sanitizeBranchName("user/feature-one"), "user/feature-one");
  for (const branch of ["", "user//feature", "user/../feature", "user/feature.lock", "user feature", "user/[feature]"]) assert.throws(() => sanitizeBranchName(branch), UsageError);
});
