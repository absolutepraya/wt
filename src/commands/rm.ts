import { isAbsolute, relative, resolve } from "node:path";
import { loadConfig } from "../config.js";
import { TeardownError } from "../errors.js";
import { deleteBranch, hasUnmergedCommits, listWorktrees, removeWorktree, unmergedCommitSummary } from "../git.js";
import { withProjectLock } from "../locking.js";
import { assertInsideWorktreeRoot, normalizePath, projectId, statePaths } from "../paths.js";
import { freeSlot, loadState, saveState } from "../state.js";
import type { CliContext, GitWorktree, StateEntry } from "../types.js";
import { renderSection, writeOutput } from "../output.js";
import { defaultWorktreeServices, runScripts, setupEnvironment, type WorktreeServices } from "../worktrees.js";

export interface RemoveOptions { name: string; force: boolean; keepBranch: boolean; }

interface RemoveSnapshot {
  slot: string;
  entry: StateEntry;
  path: string;
  branch: string;
}

interface SnapshotResult { snapshot?: RemoveSnapshot; diagnostic?: string; }

function contextHome(context: CliContext): string | undefined { return context.env.HOME || context.env.USERPROFILE; }
function contains(parent: string, child: string): boolean { const value = relative(parent, child); return value === "" || (!value.startsWith("..") && !isAbsolute(value)); }
function stateIdentity(entry: StateEntry): string { return `${entry.created_at}\u0000${entry.path}\u0000${entry.branch}`; }
function targetPath(root: string, worktreeRoot: string, entry: StateEntry): string {
  return assertInsideWorktreeRoot(resolve(root, entry.path), worktreeRoot);
}

function changedDiagnostic(name: string): string {
  return `wt: worktree ${JSON.stringify(name)} changed while it was being removed; no replacement was touched. The original worktree and state require review.`;
}

function inspectSnapshot(
  root: string,
  worktreeRoot: string,
  state: Awaited<ReturnType<typeof loadState>>,
  name: string,
  services: WorktreeServices,
): SnapshotResult {
  const match = Object.entries(state.slots).find(([, entry]) => entry.name === name);
  if (!match) return { diagnostic: `wt: no worktree named ${JSON.stringify(name)}.` };
  const [slot, entry] = match as [string, StateEntry];
  const path = targetPath(root, worktreeRoot, entry);
  const worktree: GitWorktree | undefined = listWorktrees(services.git, root).find((candidate) => normalizePath(candidate.path) === normalizePath(path));
  if (!worktree) return { diagnostic: `wt: stale state for ${JSON.stringify(name)}: ${path} is not an active Git worktree.` };
  return { snapshot: { slot, entry: { ...entry }, path, branch: worktree.branch ?? entry.branch } };
}

function sameSnapshot(expected: RemoveSnapshot, current: RemoveSnapshot): boolean {
  return stateIdentity(expected.entry) === stateIdentity(current.entry)
    && normalizePath(expected.path) === normalizePath(current.path)
    && expected.branch === current.branch;
}

async function inspectUnderLock(
  lockPath: string,
  statePath: string,
  root: string,
  worktreeRoot: string,
  name: string,
  services: WorktreeServices,
  expected?: RemoveSnapshot,
): Promise<SnapshotResult> {
  return withProjectLock(lockPath, async () => {
    const result = inspectSnapshot(root, worktreeRoot, await loadState(statePath), name, services);
    if (result.diagnostic || !result.snapshot) return result;
    if (expected && !sameSnapshot(expected, result.snapshot)) return { diagnostic: changedDiagnostic(name) };
    return result;
  });
}

export async function runRm(context: CliContext, options: RemoveOptions, services: WorktreeServices = defaultWorktreeServices): Promise<number> {
  const config = loadConfig(context.cwd);
  const root = resolve(config.repoRoot);
  const worktreeRoot = assertInsideWorktreeRoot(resolve(root, config.worktreePath), root);
  const paths = statePaths(projectId(root), contextHome(context));

  // Establish the generation while holding the project lock. The state entry
  // is then checked again after the unlocked teardown phase and before any Git
  // removal or state mutation.
  const initial = await inspectUnderLock(paths.lockPath, paths.statePath, root, worktreeRoot, options.name, services);
  if (initial.diagnostic || !initial.snapshot) {
    writeOutput(context.io.stderr, initial.diagnostic ?? `wt: no worktree named ${JSON.stringify(options.name)}.`);
    return 1;
  }
  const snapshot = initial.snapshot;
  if (contains(normalizePath(snapshot.path), normalizePath(context.cwd))) {
    writeOutput(context.io.stderr, `wt: you're currently inside ${snapshot.path}. cd out (for example, cd ${root}) before removing it.`);
    return 1;
  }

  const beforeTeardown = await inspectUnderLock(paths.lockPath, paths.statePath, root, worktreeRoot, options.name, services, snapshot);
  if (beforeTeardown.diagnostic || !beforeTeardown.snapshot) {
    writeOutput(context.io.stderr, beforeTeardown.diagnostic ?? changedDiagnostic(options.name));
    return 1;
  }
  writeOutput(context.io.stdout, renderSection("Removing worktree", { name: options.name, branch: snapshot.branch, path: snapshot.path, slot: snapshot.slot }, { trailingDivider: false }));

  if (config.teardown.length > 0) {
    const env = setupEnvironment(root, snapshot.entry.name, snapshot.path, context.env, { branch: snapshot.branch, slot: Number(snapshot.slot), portOffsetInterval: config.portOffsetInterval });
    try { runScripts(config.teardown, snapshot.path, env, context.io, "teardown"); }
    catch (error) {
      const teardown = error instanceof TeardownError ? error : new TeardownError(String(error));
      if (!options.force) { writeOutput(context.io.stderr, `wt: teardown failed: ${teardown.message}`); return 1; }
      writeOutput(context.io.stderr, `wt: teardown failed: ${teardown.message} Continuing because --force was given.`);
    }
  }

  return withProjectLock(paths.lockPath, async () => {
    const latestState = await loadState(paths.statePath);
    const latest = inspectSnapshot(root, worktreeRoot, latestState, options.name, services);
    if (latest.diagnostic || !latest.snapshot) {
      writeOutput(context.io.stderr, latest.diagnostic ?? changedDiagnostic(options.name));
      return 1;
    }
    if (!sameSnapshot(snapshot, latest.snapshot)) {
      writeOutput(context.io.stderr, changedDiagnostic(options.name));
      return 1;
    }

    // Re-read state after the Git lookup as the final precondition. This
    // closes the rm/rm/new replacement window before removal and persistence.
    const finalState = await loadState(paths.statePath);
    const finalMatch = Object.entries(finalState.slots).find(([, entry]) => entry.name === options.name);
    if (!finalMatch || stateIdentity(finalMatch[1]) !== stateIdentity(snapshot.entry)) {
      writeOutput(context.io.stderr, changedDiagnostic(options.name));
      return 1;
    }

    if (!options.keepBranch && !options.force && hasUnmergedCommits(services.git, root, latest.snapshot.branch, config.defaultBase)) {
      const summary = unmergedCommitSummary(services.git, root, latest.snapshot.branch, config.defaultBase).map((line) => `  ${line}`).join("\n") || "  (none)";
      writeOutput(context.io.stderr, `wt: branch ${JSON.stringify(latest.snapshot.branch)} has unmerged commits not in ${JSON.stringify(config.defaultBase)}:\n${summary}\nUse --force to remove anyway, or --keep-branch to keep the branch.`);
      return 1;
    }
    try { removeWorktree(services.git, root, latest.snapshot.path, options.force); }
    catch (error) { writeOutput(context.io.stderr, `wt: cannot remove worktree ${latest.snapshot.path}: ${error instanceof Error ? error.message : String(error)}`); return 1; }
    if (!options.keepBranch) {
      try { deleteBranch(services.git, root, latest.snapshot.branch, options.force); }
      catch (error) { writeOutput(context.io.stderr, `wt: warning: could not delete branch ${JSON.stringify(latest.snapshot.branch)}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    await saveState(paths.statePath, freeSlot(finalState, Number(latest.snapshot.slot)));
    writeOutput(context.io.stdout, renderSection(`Removed worktree: ${options.name}`, { branch: latest.snapshot.branch, path: latest.snapshot.path, slot: `${latest.snapshot.slot} (freed)` }));
    return 0;
  });
}
