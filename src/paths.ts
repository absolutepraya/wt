import { existsSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep, isAbsolute } from "node:path";
import { ConfigurationError } from "./errors.js";

export function normalizePath(value: string): string { let result: string; try { result = realpathSync.native(value); } catch { result = resolve(value); } return process.platform === "win32" ? result.toLowerCase() : result; }
export function discoverConfig(start = process.cwd()): string {
  let current = normalizePath(start);
  while (true) { const candidate = join(current, ".wt", "config.toml"); if (existsSync(candidate)) return candidate; const parent = dirname(current); if (parent === current) throw new ConfigurationError(`No .wt/config.toml found from ${start}.`); current = parent; }
}
export function resolveMainWorktree(start = process.cwd()): string {
  try {
    const common = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: start, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    return normalizePath(dirname(resolve(start, common)));
  } catch { return normalizePath(start); }
}
export function projectId(repoRoot: string): string { const root = normalizePath(repoRoot); return `${root.split(/[\\/]/).pop()!}-${createHash("sha1").update(root).digest("hex").slice(0, 8)}`; }
export function statePaths(id: string, home = homedir()): { statePath: string; lockPath: string } { const base = join(home, ".wt"); return { statePath: join(base, `${id}.json`), lockPath: join(base, `${id}.lock`) }; }
function canonicalizeWithMissingTail(value: string): string {
  const absolute = resolve(value);
  let existing = absolute;
  const tail: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) return normalizePath(absolute);
    tail.unshift(basename(existing));
    existing = parent;
  }
  return normalizePath(join(realpathSync.native(existing), ...tail));
}
export function assertInsideWorktreeRoot(candidate: string, root: string): string {
  const target = canonicalizeWithMissingTail(candidate);
  const base = canonicalizeWithMissingTail(root);
  const rel = relative(base, target);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw new ConfigurationError(`Worktree path must be inside ${base}.`);
  return target;
}
export const ensureInsideWorktreeRoot = assertInsideWorktreeRoot;
