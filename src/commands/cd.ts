import { isAbsolute, relative, resolve } from "node:path";
import { loadConfig } from "../config.js";
import { listWorktrees } from "../git.js";
import { normalizePath, projectId, statePaths } from "../paths.js";
import { loadState } from "../state.js";
import type { CliContext } from "../types.js";
import { renderCdOutput, writeOutput } from "../output.js";
import { defaultWorktreeServices, type WorktreeServices } from "../worktrees.js";

function contains(parent: string, child: string): boolean { const value = relative(parent, child); return value === "" || (!value.startsWith("..") && !isAbsolute(value)); }
function contextHome(context: CliContext): string | undefined { return context.env.HOME || context.env.USERPROFILE; }

export async function runCd(context: CliContext, name?: string, services: WorktreeServices = defaultWorktreeServices): Promise<number> {
  const config = loadConfig(context.cwd);
  const root = resolve(config.repoRoot);
  const state = await loadState(statePaths(projectId(root), contextHome(context)).statePath);
  const worktrees = listWorktrees(services.git, root).map((entry) => ({ ...entry, path: normalizePath(entry.path) }));
  let target: string | undefined;
  if (name === undefined) {
    const currentRoot = services.git.run(["rev-parse", "--show-toplevel"], context.cwd);
    const currentPath = currentRoot.status === 0 && currentRoot.stdout.trim()
      ? normalizePath(currentRoot.stdout.trim())
      : normalizePath(context.cwd);
    for (const worktree of [...worktrees].sort((left, right) => right.path.length - left.path.length)) {
      if (worktree.path === currentPath || contains(worktree.path, currentPath)) {
        target = worktree.path;
        break;
      }
    }
    target ??= root;
  } else if (name === "main" || name === "(main)") {
    target = root;
  } else {
    const entry = Object.values(state.slots).find((candidate) => candidate.name === name);
    if (entry) {
      const expected = resolve(root, entry.path);
      if (worktrees.some((worktree) => worktree.path === normalizePath(expected))) target = expected;
      else writeOutput(context.io.stderr, `wt: stale state for ${JSON.stringify(name)}: ${expected} is not an active Git worktree.`);
    }
  }
  if (!target) {
    const valid = ["main", ...Object.values(state.slots).map((entry) => entry.name).sort()];
    writeOutput(context.io.stderr, `wt: no worktree named ${JSON.stringify(name)}. Valid: ${JSON.stringify(valid)}`);
    return 1;
  }
  writeOutput(context.io.stdout, renderCdOutput(resolve(target)));
  return 0;
}
