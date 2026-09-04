import { spawnSync } from "node:child_process";
import { basename, dirname, extname, join, resolve } from "node:path";
import { SetupError, TeardownError } from "./errors.js";
import { deleteBranch, listWorktrees, removeWorktree, systemGitRunner, type GitRunner } from "./git.js";
import { withProjectLock } from "./locking.js";
import { assertInsideWorktreeRoot, normalizePath } from "./paths.js";
import { freeSlot, loadState, saveState } from "./state.js";
import type { CliIO, PersistedState, StateEntry } from "./types.js";
import { renderSection, writeOutput } from "./output.js";

export interface WorktreeServices {
  git: GitRunner;
  now: () => Date;
  random: () => number;
}

export const defaultWorktreeServices: WorktreeServices = {
  git: systemGitRunner,
  now: () => new Date(),
  random: Math.random,
};

export class RollbackConflictError extends Error {
  constructor() {
    super("setup rollback conflict: the worktree reservation is absent or changed; leaving the path, branch, and replacement state untouched.");
    this.name = "RollbackConflictError";
  }
}

export interface SetupEnvironmentDetails {
  branch?: string;
  slot?: number;
  portOffsetInterval?: number;
}

/** Build the legacy setup/teardown environment without mutating process.env. */
export function setupEnvironment(
  root: string,
  name: string,
  path: string,
  env: NodeJS.ProcessEnv,
  details: SetupEnvironmentDetails = {},
): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {
    ...env,
    WT_ROOT_PATH: resolve(root),
    WT_WORKSPACE_NAME: name,
    WT_WORKSPACE_PATH: resolve(path),
  };
  if (details.branch !== undefined) next.WT_BRANCH = details.branch;
  if (details.slot !== undefined) {
    next.WT_SLOT = String(details.slot);
    if (details.portOffsetInterval !== undefined) next.WT_PORT_BASE = String(details.slot * details.portOffsetInterval);
  }
  return next;
}

function compactCommand(command: string): string {
  const flattened = command.replace(/\s+/g, " ").trim();
  return flattened.length <= 60 ? flattened : `${flattened.slice(0, 59)}…`;
}

/**
 * Configured commands intentionally use a shell: they are project-owned TOML
 * values. Git operations remain shell-free in src/git.ts.
 */
export function runScripts(
  scripts: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  io: CliIO,
  phase = "setup",
): void {
  for (const [index, command] of scripts.entries()) {
    writeOutput(io.stdout, renderSection(`[${index + 1}/${scripts.length}] ${phase}: ${compactCommand(command)}`, {}, { trailingDivider: false }));
    const result = spawnSync(command, { cwd, env, shell: true, stdio: "inherit" });
    if (result.error || result.status !== 0) {
      const exit = result.status === null ? "unknown" : String(result.status);
      const message = `${phase} command failed (exit ${exit}): ${command}`;
      if (phase === "teardown") throw new TeardownError(message);
      throw new SetupError(message);
    }
  }
}

function lockPathForState(statePath: string): string {
  const stateName = basename(statePath);
  return join(dirname(statePath), `${stateName.slice(0, stateName.length - extname(stateName).length)}.lock`);
}

interface RollbackReservation {
  slot: number;
  entry: StateEntry;
}

function findRollbackReservation(
  state: PersistedState,
  root: string,
  path: string,
  branch: string,
  generationToken: string | undefined,
): RollbackReservation | undefined {
  if (!generationToken) return undefined;
  let expectedPath: string;
  try { expectedPath = assertInsideWorktreeRoot(resolve(path), resolve(root)); }
  catch { return undefined; }
  const matches = Object.entries(state.slots).filter(([, entry]) => {
    if (entry.generation_token !== generationToken || entry.branch !== branch) return false;
    try {
      const statePath = assertInsideWorktreeRoot(resolve(root, entry.path), resolve(root));
      return normalizePath(statePath) === normalizePath(expectedPath);
    } catch { return false; }
  });
  if (matches.length !== 1) return undefined;
  const [slot, entry] = matches[0]!;
  return { slot: Number(slot), entry };
}

/** Roll back a failed setup only while holding the reservation's project lock. */
export async function rollbackWorktree(
  services: WorktreeServices,
  root: string,
  path: string,
  branch: string,
  statePath: string,
  removeBranch: boolean,
  generationToken?: string,
): Promise<void> {
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(path);
  await withProjectLock(lockPathForState(statePath), async () => {
    const state = await loadState(statePath);
    const reservation = findRollbackReservation(state, absoluteRoot, absolutePath, branch, generationToken);
    if (!reservation) throw new RollbackConflictError();

    const live = listWorktrees(services.git, absoluteRoot).find((worktree) => normalizePath(worktree.path) === normalizePath(absolutePath));
    if (!live || live.branch !== branch) throw new RollbackConflictError();

    // The path and branch are now validated against both state and Git. Keep
    // cleanup registered with Git and never recursively delete this path.
    removeWorktree(services.git, absoluteRoot, absolutePath, true);
    services.git.run(["worktree", "prune"], absoluteRoot);
    if (removeBranch) deleteBranch(services.git, absoluteRoot, branch, true);
    await saveState(statePath, freeSlot(state, reservation.slot));
  });
}
