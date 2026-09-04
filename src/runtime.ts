import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";
import type { InstallChannel } from "./types.js";
import { GitError } from "./errors.js";

export function currentUser(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.USER || env.USERNAME;
  if (value?.trim()) return value.trim();
  try { return userInfo().username || "unknown"; } catch { return "unknown"; }
}
export const resolveUser = currentUser;

export function requireGit(cwd = process.cwd(), runner = execFileSync): string {
  try {
    return runner("git", ["--version"], { cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, encoding: "utf8" }).trim();
  } catch { throw new GitError("Git is required but was not found or could not run noninteractively. Install Git and try again."); }
}
export function platformName(platform = process.platform): "macos" | "linux" | "windows" | "unknown" {
  return platform === "darwin" ? "macos" : platform === "win32" ? "windows" : platform === "linux" ? "linux" : "unknown";
}
export const classifyPlatform = platformName;

export interface ChannelOptions { executablePath?: string; cwd?: string; home?: string; metadataPath?: string; }
export function detectInstallChannel(options: ChannelOptions = {}): InstallChannel | "unknown" {
  const executablePath = normalize(options.executablePath || process.argv[1] || process.execPath);
  const metadata = options.metadataPath || join(options.home || homedir(), ".config", "wt", "install.json");
  try {
    const record = JSON.parse(readFileSync(metadata, "utf8"));
    if (record?.channel === "standalone" && typeof record.binary === "string" && samePath(record.binary, executablePath)) return "standalone";
  } catch { /* absent or malformed metadata is not evidence */ }

  const npmMarker = `${sep}node_modules${sep}@absolutepraya${sep}wt${sep}`;
  const npmMarkerAlt = `${sep}node_modules${sep}@absolutepraya${sep}wt`;
  if (executablePath.includes(npmMarker) || executablePath.includes(npmMarkerAlt)) {
    const marker = `${sep}node_modules${sep}`;
    const nodeModules = executablePath.lastIndexOf(marker);
    const consumerRoot = executablePath.slice(0, nodeModules);
    return existsSync(join(consumerRoot, "package.json")) ? "npm-local" : "npm-global";
  }
  const sourceRoot = findSourceRoot(executablePath, options.cwd || process.cwd());
  if (sourceRoot) return "source";
  return "unknown";
}
export const classifyInstallChannel = detectInstallChannel;
function samePath(a: string, b: string): boolean { return normalize(isAbsolute(a) ? a : join(process.cwd(), a)).toLowerCase() === b.toLowerCase(); }
function findUp(start: string, file: string): string | null { let current = start; while (true) { const candidate = join(current, file); if (existsSync(candidate)) return candidate; const parent = dirname(current); if (parent === current) return null; current = parent; } }
function findSourceRoot(executablePath: string, cwd: string): string | null {
  for (const start of [dirname(executablePath), cwd]) { const pkg = findUp(start, "package.json"); if (pkg && existsSync(join(dirname(pkg), "src"))) return dirname(pkg); }
  return null;
}
