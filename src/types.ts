export type NameStrategy = "cities" | "word_pairs";
export type ShellName = "bash" | "zsh" | "fish" | "powershell";
export type InstallChannel = "standalone" | "npm-global" | "npm-local" | "source";

export interface Config {
  repoRoot: string;
  worktreePath: string;
  portOffsetInterval: number;
  maxSlots: number;
  nameStrategy: NameStrategy;
  branchTemplate: string;
  defaultBase: string;
  setup: string[];
  teardown: string[];
}
export interface StateEntry { name: string; branch: string; path: string; base: string; tracks_remote?: boolean; created_at: string; }
export interface PersistedState { version: 1; project_root: string; slots: Record<string, StateEntry>; }
export interface GitWorktree { path: string; head: string; branch: string | null; bare?: boolean; }
export interface CliIO { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream; stdin: NodeJS.ReadableStream; stdoutIsTTY: boolean; stdinIsTTY: boolean; }
export interface CliContext { cwd: string; env: NodeJS.ProcessEnv; io: CliIO; }
