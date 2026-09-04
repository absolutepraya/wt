import { relative, resolve, isAbsolute } from "node:path";
import { loadConfig } from "../config.js";
import { TeardownError } from "../errors.js";
import { deleteBranch, hasUnmergedCommits, listWorktrees, removeWorktree, unmergedCommitSummary } from "../git.js";
import { withProjectLock } from "../locking.js";
import { normalizePath, projectId, statePaths } from "../paths.js";
import { freeSlot, loadState, saveState } from "../state.js";
import type { CliContext, StateEntry } from "../types.js";
import { renderSection, writeOutput } from "../output.js";
import { defaultWorktreeServices, runScripts, setupEnvironment, type WorktreeServices } from "../worktrees.js";

export interface RemoveOptions { name: string; force: boolean; keepBranch: boolean; }
function contextHome(context: CliContext): string | undefined { return context.env.HOME || context.env.USERPROFILE; }
function contains(parent: string, child: string): boolean { const value = relative(parent, child); return value === "" || (!value.startsWith("..") && !isAbsolute(value)); }

export async function runRm(context: CliContext, options: RemoveOptions, services: WorktreeServices = defaultWorktreeServices): Promise<number> {
  const config = loadConfig(context.cwd);
  const root = resolve(config.repoRoot);
  const paths = statePaths(projectId(root), contextHome(context));
  const initial = await loadState(paths.statePath);
  const initialMatch = Object.entries(initial.slots).find(([, entry]) => entry.name === options.name);
  if (!initialMatch) {
    writeOutput(context.io.stderr, `wt: no worktree named ${JSON.stringify(options.name)}. Valid: ${JSON.stringify(Object.values(initial.slots).map((entry) => entry.name).sort())}`);
    return 1;
  }
  const [initialSlot, initialEntry] = initialMatch as [string, StateEntry];
  const targetPath = resolve(root, initialEntry.path);
  if (contains(normalizePath(targetPath), normalizePath(context.cwd))) {
    writeOutput(context.io.stderr, `wt: you're currently inside ${targetPath}. cd out (for example, cd ${root}) before removing it.`);
    return 1;
  }

  const initialWorktree = listWorktrees(services.git, root).find((entry) => normalizePath(entry.path) === normalizePath(targetPath));
  if (!initialWorktree) {
    writeOutput(context.io.stderr, `wt: stale state for ${JSON.stringify(options.name)}: ${targetPath} is not an active Git worktree.`);
    return 1;
  }
  const initialBranch = initialWorktree.branch ?? initialEntry.branch;
  if (config.teardown.length > 0) {
    const env = setupEnvironment(root, initialEntry.name, targetPath, context.env, { branch: initialBranch, slot: Number(initialSlot), portOffsetInterval: config.portOffsetInterval });
    try { runScripts(config.teardown, targetPath, env, context.io, "teardown"); }
    catch (error) {
      const teardown = error instanceof TeardownError ? error : new TeardownError(String(error));
      if (!options.force) { writeOutput(context.io.stderr, `wt: teardown failed: ${teardown.message}`); return 1; }
      writeOutput(context.io.stderr, `wt: teardown failed: ${teardown.message} Continuing because --force was given.`);
    }
  }

  return withProjectLock(paths.lockPath, async () => {
    const state = await loadState(paths.statePath);
    const match = Object.entries(state.slots).find(([, entry]) => entry.name === options.name);
    if (!match) { writeOutput(context.io.stderr, `wt: no worktree named ${JSON.stringify(options.name)}.`); return 1; }
    const [slot, entry] = match as [string, StateEntry];
    const path = resolve(root, entry.path);
    const worktree = listWorktrees(services.git, root).find((candidate) => normalizePath(candidate.path) === normalizePath(path));
    if (!worktree) { writeOutput(context.io.stderr, `wt: stale state for ${JSON.stringify(options.name)}: ${path} is not an active Git worktree.`); return 1; }
    const branch = worktree.branch ?? entry.branch;
    if (!options.keepBranch && !options.force && hasUnmergedCommits(services.git, root, branch, config.defaultBase)) {
      const summary = unmergedCommitSummary(services.git, root, branch, config.defaultBase).map((line) => `  ${line}`).join("\n") || "  (none)";
      writeOutput(context.io.stderr, `wt: branch ${JSON.stringify(branch)} has unmerged commits not in ${JSON.stringify(config.defaultBase)}:\n${summary}\nUse --force to remove anyway, or --keep-branch to keep the branch.`);
      return 1;
    }
    try { removeWorktree(services.git, root, path, options.force); }
    catch (error) { writeOutput(context.io.stderr, `wt: cannot remove worktree ${path}: ${error instanceof Error ? error.message : String(error)}`); return 1; }
    if (!options.keepBranch) {
      try { deleteBranch(services.git, root, branch, options.force); }
      catch (error) { writeOutput(context.io.stderr, `wt: warning: could not delete branch ${JSON.stringify(branch)}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    await saveState(paths.statePath, freeSlot(state, Number(slot)));
    writeOutput(context.io.stdout, renderSection(`Removed worktree: ${options.name}`, { branch, path, slot: `${slot} (freed)` }));
    return 0;
  });
}
