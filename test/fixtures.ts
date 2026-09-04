import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitResult, GitRunner } from "../src/git.js";

export function runGit(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export interface GitFixture { root: string; remote: string; repo: string; }

export function createGitFixture(): GitFixture {
  const root = mkdtempSync(join(tmpdir(), "wt-git-"));
  const remote = join(root, "origin.git");
  const repo = join(root, "repo");
  mkdirSync(remote);
  mkdirSync(repo);
  runGit(["init", "--bare", "-b", "main"], remote);
  runGit(["init", "-b", "main"], repo);
  runGit(["config", "user.email", "test@example.com"], repo);
  runGit(["config", "user.name", "WT Test"], repo);
  runGit(["config", "commit.gpgsign", "false"], repo);
  writeFileSync(join(repo, "README.md"), "# fixture\n");
  runGit(["add", "README.md"], repo);
  runGit(["commit", "-m", "initial"], repo);
  runGit(["remote", "add", "origin", remote], repo);
  runGit(["push", "-u", "origin", "main"], repo);
  return { root, remote, repo };
}

export class FakeGitRunner implements GitRunner {
  readonly calls: Array<{ args: string[]; cwd: string }> = [];
  constructor(private readonly responses: GitResult[] = []) {}
  run(args: string[], cwd: string): GitResult {
    this.calls.push({ args: [...args], cwd });
    return this.responses.shift() ?? { status: 0, stdout: "", stderr: "" };
  }
}
