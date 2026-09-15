import { relative, resolve, isAbsolute } from "node:path";
import { loadConfig } from "../config.js";
import { listWorktrees } from "../git.js";
import { assertInsideWorktreeRoot, normalizePath, projectId, statePaths } from "../paths.js";
import { loadState } from "../state.js";
import type { CliContext } from "../types.js";
import { writeOutput } from "../output.js";
import { defaultWorktreeServices, type WorktreeServices } from "../worktrees.js";

export type LsFormat = "table" | "agent";

interface LsOptions { format?: LsFormat; }

interface ListedWorktree {
  managed: boolean;
  slot?: number;
  name?: string;
  branch: string;
  relativePath: string;
  absolutePath: string;
  ports?: string;
  current: boolean;
}

function contextHome(context: CliContext): string | undefined { return context.env.HOME || context.env.USERPROFILE; }
function contains(parent: string, child: string): boolean { const value = relative(parent, child); return value === "" || (!value.startsWith("..") && !isAbsolute(value)); }
function truncate(value: string, width: number): string {
  if (value.length <= width) return value;
  if (width <= 1) return "…".slice(0, width);
  return `${value.slice(0, width - 1)}…`;
}
function row(cells: string[], widths: number[]): string {
  return `║${cells.map((cell, index) => ` ${truncate(cell, widths[index]!).padEnd(widths[index]!)} `).join("│")}║`;
}
function line(left: string, middle: string, right: string, widths: number[], fill: string): string {
  return `${left}${widths.map((width) => fill.repeat(width + 2)).join(middle)}${right}`;
}
function fitWidths(widths: number[], terminalWidth: number): number[] {
  const overhead = 3 * widths.length + 1;
  const target = Math.max(widths.length, terminalWidth - overhead);
  const fitted = [...widths];
  while (fitted.reduce((sum, width) => sum + width, 0) > target) {
    const widest = fitted.indexOf(Math.max(...fitted));
    if (fitted[widest]! <= 1) break;
    fitted[widest] = fitted[widest]! - 1;
  }
  return fitted;
}
function renderTable(headers: string[], managed: ListedWorktree[], unmanaged: ListedWorktree[], terminalWidth: number): string {
  const managedRows = managed.map((entry) => [
    `${entry.slot}${entry.current ? " ✓" : ""}`,
    entry.name!,
    entry.branch,
    entry.relativePath,
    entry.ports!,
  ]);
  const unmanagedRows = unmanaged.map((entry) => ["", "", entry.branch, entry.relativePath, ""]);
  const allRows = [...managedRows, ...unmanagedRows];
  const intrinsicWidths = headers.map((header, index) => Math.max(header.length, ...allRows.map((entry) => entry[index]!.length)));
  const widths = fitWidths(intrinsicWidths, terminalWidth);
  const titleWidth = widths.reduce((sum, width) => sum + width + 3, -3);
  const output = [
    line("╔", "╤", "╗", widths, "═"),
    row(headers, widths),
    line("╟", "┼", "╢", widths, "─"),
    ...managedRows.map((entry) => row(entry, widths)),
  ];
  if (unmanagedRows.length) {
    output.push(
      line("╠", "╧", "╣", widths, "═"),
      `║ ${truncate("Unmanaged worktrees", titleWidth).padEnd(titleWidth)} ║`,
      line("╠", "╤", "╣", widths, "═"),
      ...unmanagedRows.map((entry) => row(entry, widths)),
    );
  }
  output.push(line("╚", "╧", "╝", widths, "═"));
  return output.join("\n");
}
function renderAgent(managed: ListedWorktree[], unmanaged: ListedWorktree[]): string {
  const output = ["Managed worktrees:"];
  for (const [index, entry] of managed.entries()) {
    output.push(
      `${index + 1}. name: ${entry.name}`,
      `   slot: ${entry.slot}`,
      `   branch: ${entry.branch}`,
      `   path: ${entry.absolutePath}`,
      `   ports: ${entry.ports}`,
      `   current: ${entry.current}`,
    );
  }
  if (unmanaged.length) {
    output.push("", "Unmanaged worktrees:");
    for (const [index, entry] of unmanaged.entries()) {
      output.push(
        `${index + 1}. branch: ${entry.branch}`,
        `   path: ${entry.absolutePath}`,
        `   current: ${entry.current}`,
      );
    }
  }
  return output.join("\n");
}

export async function runLs(context: CliContext, options: LsOptions = {}, services: WorktreeServices = defaultWorktreeServices): Promise<number> {
  const config = loadConfig(context.cwd);
  const root = resolve(config.repoRoot);
  const worktreeRoot = assertInsideWorktreeRoot(resolve(root, config.worktreePath), root);
  const state = await loadState(statePaths(projectId(root), contextHome(context)).statePath);
  const managedByPath = new Map(Object.entries(state.slots).map(([slot, entry]) => [normalizePath(assertInsideWorktreeRoot(resolve(root, entry.path), worktreeRoot)), { slot: Number(slot), entry }]));
  const worktrees = listWorktrees(services.git, root).map((entry) => ({ ...entry, path: normalizePath(entry.path) }));
  const cwd = normalizePath(context.cwd);
  const currentRoot = services.git.run(["rev-parse", "--show-toplevel"], context.cwd);
  const currentPath = currentRoot.status === 0 && currentRoot.stdout.trim() ? normalizePath(currentRoot.stdout.trim()) : cwd;
  const selectedPath = [...worktrees]
    .sort((left, right) => right.path.length - left.path.length)
    .find((worktree) => worktree.path === currentPath || contains(worktree.path, currentPath))?.path;
  const rootPath = normalizePath(root);
  const listed: ListedWorktree[] = [];
  for (const worktree of worktrees) {
    const current = worktree.path === selectedPath;
    const branch = worktree.branch ?? "(detached)";
    const relativePath = worktree.path === rootPath ? "." : relative(root, worktree.path) || ".";
    if (worktree.path === rootPath) {
      listed.push({ managed: true, slot: 0, name: "(main)", branch, relativePath, absolutePath: worktree.path, ports: "base", current });
    } else {
      const managed = managedByPath.get(worktree.path);
      if (managed) {
        listed.push({ managed: true, slot: managed.slot, name: managed.entry.name, branch, relativePath, absolutePath: worktree.path, ports: `+${managed.slot * config.portOffsetInterval}`, current });
      } else {
        listed.push({ managed: false, branch, relativePath, absolutePath: worktree.path, current });
      }
    }
  }
  const managed = listed.filter((entry) => entry.managed).sort((left, right) => left.slot! - right.slot!);
  const unmanaged = listed.filter((entry) => !entry.managed);
  const format = options.format ?? "table";
  const output = format === "agent"
    ? renderAgent(managed, unmanaged)
    : renderTable(["SLOT", "NAME", "BRANCH", "PATH", "PORTS"], managed, unmanaged, context.io.terminalWidth ?? 80);
  writeOutput(context.io.stdout, output);
  const livePaths = new Set(worktrees.map((entry) => entry.path));
  for (const entry of Object.values(state.slots)) {
    const expected = normalizePath(assertInsideWorktreeRoot(resolve(root, entry.path), worktreeRoot));
    if (!livePaths.has(expected)) writeOutput(context.io.stderr, `wt: stale state for ${JSON.stringify(entry.name)}: ${expected} is not an active Git worktree.`);
  }
  return 0;
}
