import { spawnSync } from "node:child_process";
import { GitError } from "./errors.js";
import type { GitWorktree } from "./types.js";

export interface GitResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface GitRunner {
  run(args: string[], cwd: string): GitResult;
}

/** Run Git without a shell, preserving every argument boundary. */
export const systemGitRunner: GitRunner = {
  run(args, cwd) {
    const result = spawnSync("git", args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      encoding: "utf8",
      shell: false,
    });
    const stderr = result.stderr || result.error?.message || "";
    return {
      status: result.status ?? 1,
      stdout: result.stdout || "",
      stderr,
    };
  },
};

export function git(runner: GitRunner, args: string[], cwd: string): GitResult {
  const result = runner.run([...args], cwd);
  if (result.status !== 0) {
    const diagnostic = result.stderr.trim() || "Git returned no diagnostic.";
    throw new GitError(`git ${args.join(" ")} failed (exit ${result.status}): ${diagnostic}`);
  }
  return result;
}

/** Fetch a configured base ref. The defaults retain the legacy origin/main behavior. */
export function gitFetch(runner: GitRunner, cwd: string, remote = "origin", branch = "main"): void {
  git(runner, ["fetch", remote, branch], cwd);
}

export function listWorktrees(runner: GitRunner, cwd: string): GitWorktree[] {
  const output = git(runner, ["worktree", "list", "--porcelain"], cwd).stdout;
  const worktrees: GitWorktree[] = [];
  let current: Partial<GitWorktree> = {};

  const finish = (): void => {
    if (!current.path) return;
    worktrees.push({
      path: current.path,
      head: current.head ?? "",
      branch: current.branch ?? null,
      ...(current.bare ? { bare: true } : {}),
    });
    current = {};
  };

  for (const line of output.split(/\r?\n/)) {
    if (!line) {
      finish();
    } else if (line.startsWith("worktree ")) {
      current.path = line.slice("worktree ".length);
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    } else if (line === "detached") {
      current.branch = null;
    } else if (line === "bare") {
      current.bare = true;
    }
  }
  finish();
  return worktrees;
}

export function branchInUse(runner: GitRunner, cwd: string, branch: string): boolean {
  return listWorktrees(runner, cwd).some((worktree) => worktree.branch === branch);
}

export function branchHasUpstream(runner: GitRunner, cwd: string, branch: string): boolean {
  return runner.run(["rev-parse", "--abbrev-ref", `${branch}@{upstream}`], cwd).status === 0;
}

/**
 * Whether a branch contains work absent from both its configured base and its
 * upstream. This mirrors the legacy deletion guard.
 */
export function hasUnmergedCommits(
  runner: GitRunner,
  cwd: string,
  branch: string,
  base = "origin/main",
): boolean {
  const outsideBase = git(runner, ["rev-list", `${base}..${branch}`], cwd).stdout.trim();
  if (!outsideBase) return false;

  const upstream = runner.run(["rev-parse", "--abbrev-ref", `${branch}@{upstream}`], cwd);
  if (upstream.status !== 0) return true;

  return Boolean(git(runner, ["rev-list", `${base}..${branch}`, `^${upstream.stdout.trim()}`], cwd).stdout.trim());
}

export function unmergedCommitSummary(
  runner: GitRunner,
  cwd: string,
  branch: string,
  base = "origin/main",
): string[] {
  const output = git(runner, ["log", "--oneline", `${base}..${branch}`], cwd).stdout.trim();
  return output ? output.split(/\r?\n/) : [];
}

export function addWorktree(
  runner: GitRunner,
  cwd: string,
  worktreePath: string,
  branch: string,
  base: string,
  createBranch: boolean,
): void {
  git(runner, ["worktree", "add", createBranch ? "-b" : "-B", branch, worktreePath, base], cwd);
}

export function removeWorktree(runner: GitRunner, cwd: string, worktreePath: string, force: boolean): void {
  git(runner, ["worktree", "remove", ...(force ? ["--force"] : []), worktreePath], cwd);
}

export function deleteBranch(runner: GitRunner, cwd: string, branch: string, force: boolean): void {
  git(runner, ["branch", force ? "-D" : "-d", branch], cwd);
}
