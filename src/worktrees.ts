import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { SetupError, TeardownError } from "./errors.js";
import { deleteBranch, removeWorktree, systemGitRunner, type GitRunner } from "./git.js";
import { withProjectLock } from "./locking.js";
import { freeSlot, loadState, saveState } from "./state.js";
import type { CliIO } from "./types.js";
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

function removeReservation(root: string, statePath: string, path: string): Promise<void> {
  return loadState(statePath).then(async (state) => {
    const slot = Object.entries(state.slots).find(([, entry]) => resolve(root, entry.path) === resolve(path))?.[0];
    if (slot) await saveState(statePath, freeSlot(state, Number(slot)));
  });
}

/** Best-effort recovery after a failed create. It never uses a shell for Git. */
export async function rollbackWorktree(
  services: WorktreeServices,
  root: string,
  path: string,
  branch: string,
  statePath: string,
  removeBranch: boolean,
): Promise<void> {
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(path);
  try { removeWorktree(services.git, absoluteRoot, absolutePath, true); }
  catch {
    // A failed post-checkout hook can leave an unregistered directory. Its path
    // was constructed under the configured worktree root by the caller.
    if (existsSync(absolutePath)) rmSync(absolutePath, { recursive: true, force: true });
  }
  services.git.run(["worktree", "prune"], absoluteRoot);
  if (removeBranch) {
    try { deleteBranch(services.git, absoluteRoot, branch, true); } catch { /* cleanup is best effort */ }
  }
  const stateName = basename(statePath);
  const lockPath = join(dirname(statePath), `${stateName.slice(0, stateName.length - extname(stateName).length)}.lock`);
  await withProjectLock(lockPath, () => removeReservation(absoluteRoot, statePath, absolutePath));
}
