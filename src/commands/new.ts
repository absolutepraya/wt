import { existsSync, readdirSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, relative, resolve } from "node:path";
import { loadConfig } from "../config.js";
import { GitError } from "../errors.js";
import { addWorktree, branchInUse, deleteBranch, gitFetch, removeWorktree } from "../git.js";
import { withProjectLock } from "../locking.js";
import { resolveName, sanitizeBranchName } from "../naming.js";
import { assertInsideWorktreeRoot, projectId, statePaths } from "../paths.js";
import { currentUser } from "../runtime.js";
import { createEmptyState, loadState, reserveSlot, saveState } from "../state.js";
import { renderBranchTemplate } from "../template.js";
import type { CliContext, StateEntry } from "../types.js";
import { renderCdOutput, renderSection, writeOutput } from "../output.js";
import { defaultWorktreeServices, rollbackWorktree, runScripts, setupEnvironment, type WorktreeServices } from "../worktrees.js";

export interface NewOptions {
  name?: string;
  branch?: string;
  from?: string;
  noSetup: boolean;
  cdAfterCreate: boolean;
}

interface NewResult {
  name: string;
  branch: string;
  base: string;
  tracksRemote: boolean;
  path: string;
  slot: number;
  root: string;
  statePath: string;
  portOffsetInterval: number;
  generationToken: string;
}

function splitBase(base: string): [string, string] {
  const slash = base.indexOf("/");
  if (slash < 1 || slash === base.length - 1) throw new GitError(`invalid default_base ${JSON.stringify(base)}; expected <remote>/<branch>.`);
  return [base.slice(0, slash), base.slice(slash + 1)];
}

function contextHome(context: CliContext): string | undefined { return context.env.HOME || context.env.USERPROFILE; }

function newGenerationToken(state: Awaited<ReturnType<typeof loadState>>): string {
  let token = randomUUID();
  const existing = new Set(Object.values(state.slots).map((entry) => entry.generation_token).filter((value): value is string => Boolean(value)));
  while (existing.has(token)) token = randomUUID();
  return token;
}

export async function runNew(
  context: CliContext,
  options: NewOptions,
  services: WorktreeServices = defaultWorktreeServices,
): Promise<number> {
  const config = loadConfig(context.cwd);
  const root = resolve(config.repoRoot);
  const [remote, defaultBranch] = splitBase(config.defaultBase);
  const statePath = statePaths(projectId(root), contextHome(context)).statePath;
  const lockPath = statePaths(projectId(root), contextHome(context)).lockPath;

  let base: string;
  let tracksRemote: boolean;
  let requestedBranch: string | undefined;
  if (options.from !== undefined) {
    const exists = services.git.run(["ls-remote", "--heads", remote, options.from], root);
    if (exists.status !== 0 || !exists.stdout.trim()) {
      throw new GitError(`branch ${JSON.stringify(options.from)} not found on ${remote}. List remote branches with: git ls-remote --heads ${remote}`);
    }
    gitFetch(services.git, root, remote, options.from);
    base = `${remote}/${options.from}`;
    tracksRemote = true;
    requestedBranch = options.branch ?? options.from;
  } else {
    gitFetch(services.git, root, remote, defaultBranch);
    base = config.defaultBase;
    tracksRemote = false;
    requestedBranch = options.branch;
  }

  const result = await withProjectLock(lockPath, async (): Promise<NewResult> => {
    const loaded = await loadState(statePath);
    const state = loaded.project_root ? loaded : createEmptyState(root);
    const worktreeRoot = assertInsideWorktreeRoot(join(root, config.worktreePath), root);
    const usedNames = new Set(Object.values(state.slots).map((entry) => entry.name));
    if (existsSync(worktreeRoot)) {
      for (const entry of readdirSync(worktreeRoot, { withFileTypes: true })) if (entry.isDirectory()) usedNames.add(entry.name);
    }
    if (options.name && existsSync(join(worktreeRoot, options.name))) {
      throw new GitError(`${join(worktreeRoot, options.name)} already exists. Pick another name or remove the existing directory first.`);
    }
    const name = resolveName(options.name, config.nameStrategy, usedNames, { random: services.random });
    const worktreePath = assertInsideWorktreeRoot(join(worktreeRoot, name), worktreeRoot);
    const occupiedSlots = new Set(Object.keys(state.slots).map(Number));
    const slot = Array.from({ length: config.maxSlots }, (_, index) => index + 1).find((candidate) => !occupiedSlots.has(candidate));
    if (slot === undefined) {
      // reserveSlot provides the stable exhausted-slot diagnostic.
      reserveSlot(state, config.maxSlots, { name, branch: "pending", path: relative(root, worktreePath), base, created_at: services.now().toISOString() });
      throw new GitError("No free slots.");
    }
    const branch = sanitizeBranchName(requestedBranch ?? renderBranchTemplate(config.branchTemplate, { user: currentUser(context.env), name, slot }));
    if (options.from !== undefined && branchInUse(services.git, root, options.from)) {
      throw new GitError(`branch ${JSON.stringify(options.from)} is already checked out in another worktree.`);
    }
    const inUse = branchInUse(services.git, root, branch);
    if (inUse) throw new GitError(`branch ${JSON.stringify(branch)} is already checked out in another worktree.`);
    const generationToken = newGenerationToken(state);
    const entry: StateEntry = { name, branch, path: relative(root, worktreePath), base, tracks_remote: tracksRemote, created_at: services.now().toISOString(), generation_token: generationToken };
    const reserved = reserveSlot(state, config.maxSlots, entry);
    let worktreeCreated = false;
    try {
      // Ordinary branches must be created with -b. The --from path is the
      // explicit remote/base operation that uses -B and may update a local
      // branch to the selected remote ref.
      addWorktree(services.git, root, worktreePath, branch, base, !tracksRemote);
      worktreeCreated = true;
      await saveState(statePath, reserved.state);
    } catch (error) {
      // We already own the project lock. Do not call rollbackWorktree here,
      // because it deliberately reacquires that lock before changing state.
      try { removeWorktree(services.git, root, worktreePath, true); }
      catch { if (existsSync(worktreePath)) rmSync(worktreePath, { recursive: true, force: true }); }
      services.git.run(["worktree", "prune"], root);
      if (worktreeCreated) {
        try { deleteBranch(services.git, root, branch, true); } catch { /* Preserve the create failure. */ }
      }
      throw error;
    }
    return { name, branch, base, tracksRemote, path: worktreePath, slot: reserved.slot, root, statePath, portOffsetInterval: config.portOffsetInterval, generationToken };
  });

  if (!options.noSetup && config.setup.length > 0) {
    const env = setupEnvironment(result.root, result.name, result.path, context.env, { branch: result.branch, slot: result.slot, portOffsetInterval: result.portOffsetInterval });
    try { runScripts(config.setup, result.path, env, context.io, "setup"); }
    catch (error) {
      if (config.teardown.length > 0) {
        try { runScripts(config.teardown, result.path, env, context.io, "teardown"); } catch { /* Setup failure remains primary. */ }
      }
      try { await rollbackWorktree(services, result.root, result.path, result.branch, result.statePath, true, result.generationToken); }
      catch (rollback) { writeOutput(context.io.stderr, `wt: warning: setup rollback needs attention: ${rollback instanceof Error ? rollback.message : String(rollback)}`); }
      throw error;
    }
  }

  const branchDisplay = result.tracksRemote ? `${result.branch} (tracks ${result.base})` : result.branch;
  writeOutput(context.io.stdout, renderSection(`Created worktree: ${result.name}`, {
    branch: branchDisplay,
    base: result.base,
    path: result.path,
    slot: `${result.slot} (port offset +${result.slot * result.portOffsetInterval} to +${result.slot * result.portOffsetInterval + result.portOffsetInterval - 1})`,
  }));
  if (options.cdAfterCreate) writeOutput(context.io.stdout, renderCdOutput(result.path));
  return 0;
}
