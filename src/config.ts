import { readFileSync } from "node:fs";
import { parse } from "@iarna/toml";
import { ConfigurationError } from "./errors.js";
import { discoverConfig, resolveMainWorktree } from "./paths.js";
import type { Config, NameStrategy } from "./types.js";

export const DEFAULT_CONFIG = { worktreePath: ".worktrees", portOffsetInterval: 10, maxSlots: 20, nameStrategy: "cities" as NameStrategy, branchTemplate: "{user}/{name}", defaultBase: "origin/main", setup: [] as string[], teardown: [] as string[] };
export function loadConfig(start = process.cwd()): Config {
  const path = discoverConfig(start); let raw: Record<string, unknown>;
  try { raw = parse(readFileSync(path, "utf8")) as Record<string, unknown>; } catch (error) { throw new ConfigurationError(`Malformed TOML in ${path}: ${error instanceof Error ? error.message : "invalid syntax"}`); }
  const value: Record<string, unknown> = {
    ...DEFAULT_CONFIG,
    worktreePath: raw.worktree_path ?? DEFAULT_CONFIG.worktreePath,
    portOffsetInterval: raw.port_offset_interval ?? DEFAULT_CONFIG.portOffsetInterval,
    maxSlots: raw.max_slots ?? DEFAULT_CONFIG.maxSlots,
    nameStrategy: raw.name_strategy ?? DEFAULT_CONFIG.nameStrategy,
    branchTemplate: raw.branch_template ?? DEFAULT_CONFIG.branchTemplate,
    defaultBase: raw.default_base ?? DEFAULT_CONFIG.defaultBase,
    setup: raw.setup ?? DEFAULT_CONFIG.setup,
    teardown: raw.teardown ?? DEFAULT_CONFIG.teardown,
  };
  requireString(value, "worktreePath"); requireNumber(value, "portOffsetInterval"); requireNumber(value, "maxSlots"); requireString(value, "nameStrategy"); requireString(value, "branchTemplate"); requireString(value, "defaultBase"); requireArray(value, "setup"); requireArray(value, "teardown");
  if (value.nameStrategy !== "cities" && value.nameStrategy !== "word_pairs") throw new ConfigurationError(`Invalid name_strategy: ${String(value.nameStrategy)}.`);
  if (!Number.isInteger(value.portOffsetInterval) || (value.portOffsetInterval as number) <= 0) throw new ConfigurationError("port_offset_interval must be a positive integer.");
  if (!Number.isInteger(value.maxSlots) || (value.maxSlots as number) <= 0) throw new ConfigurationError("max_slots must be a positive integer.");
  const worktreePath = value.worktreePath as string; if (/^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/.test(worktreePath) || worktreePath.split(/[\\/]/).includes("..")) throw new ConfigurationError("worktree_path must be a relative path within the repository.");
  return { repoRoot: resolveMainWorktree(start), worktreePath, portOffsetInterval: value.portOffsetInterval as number, maxSlots: value.maxSlots as number, nameStrategy: value.nameStrategy as NameStrategy, branchTemplate: value.branchTemplate as string, defaultBase: value.defaultBase as string, setup: value.setup as string[], teardown: value.teardown as string[] };
}
function requireString(raw: Record<string, unknown>, key: string): void { if (typeof raw[key] !== "string") throw new ConfigurationError(`${key} must be a string.`); }
function requireNumber(raw: Record<string, unknown>, key: string): void { if (typeof raw[key] !== "number" || !Number.isFinite(raw[key])) throw new ConfigurationError(`${key} must be a number.`); }
function requireArray(raw: Record<string, unknown>, key: string): void { if (!Array.isArray(raw[key]) || !(raw[key] as unknown[]).every((item) => typeof item === "string")) throw new ConfigurationError(`${key} must be an ordered array of strings.`); }
