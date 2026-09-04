import { relative, resolve, isAbsolute } from "node:path";
import { loadConfig } from "../config.js";
import { listWorktrees } from "../git.js";
import { assertInsideWorktreeRoot, normalizePath, projectId, statePaths } from "../paths.js";
import { loadState } from "../state.js";
import type { CliContext } from "../types.js";
import { writeOutput } from "../output.js";
import { defaultWorktreeServices, type WorktreeServices } from "../worktrees.js";

function contextHome(context: CliContext): string | undefined { return context.env.HOME || context.env.USERPROFILE; }
function contains(parent: string, child: string): boolean { const value = relative(parent, child); return value === "" || (!value.startsWith("..") && !isAbsolute(value)); }
function row(cells: string[], widths: number[]): string { return `║${cells.map((cell, index) => ` ${cell.padEnd(widths[index]!)} `).join("│")}║`; }
function line(left: string, middle: string, right: string, widths: number[], fill: string): string { return `${left}${widths.map((width) => fill.repeat(width + 2)).join(middle)}${right}`; }

export async function runLs(context: CliContext, services: WorktreeServices = defaultWorktreeServices): Promise<number> {
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
  const headers = ["SLOT", "NAME", "BRANCH", "PATH", "PORTS"];
  const rows: string[][] = [];
  const unmanaged: string[][] = [];
  for (const worktree of worktrees) {
    const current = worktree.path === selectedPath ? " ✓" : "";
    const branch = worktree.branch ?? "(detached)";
    const path = worktree.path === normalizePath(root) ? "." : relative(root, worktree.path) || ".";
    if (worktree.path === normalizePath(root)) rows.push([`0${current}`, "(main)", branch, path, "base"]);
    else {
      const managed = managedByPath.get(worktree.path);
      if (managed) rows.push([`${managed.slot}${current}`, managed.entry.name, branch, path, `+${managed.slot * config.portOffsetInterval}`]);
      else unmanaged.push(["", "", branch, path, ""]);
    }
  }
  rows.sort((left, right) => Number(left[0].split(" ")[0]) - Number(right[0].split(" ")[0]));
  const allRows = [...rows, ...unmanaged];
  const widths = headers.map((header, index) => Math.max(header.length, ...allRows.map((entry) => entry[index]!.length)));
  const output = [
    line("╔", "╤", "╗", widths, "═"), row(headers, widths), line("╟", "┼", "╢", widths, "─"),
    ...rows.map((entry) => row(entry, widths)),
    ...(unmanaged.length ? [line("╠", "╧", "╣", widths, "═"), `║ ${"Unmanaged worktrees".padEnd(widths.reduce((sum, width) => sum + width + 3, -3))} ║`, line("╠", "╤", "╣", widths, "═"), ...unmanaged.map((entry) => row(entry, widths))] : []),
    line("╚", "╧", "╝", widths, "═"),
  ];
  writeOutput(context.io.stdout, output.join("\n"));
  const livePaths = new Set(worktrees.map((entry) => entry.path));
  for (const entry of Object.values(state.slots)) {
    const expected = normalizePath(assertInsideWorktreeRoot(resolve(root, entry.path), worktreeRoot));
    if (!livePaths.has(expected)) writeOutput(context.io.stderr, `wt: stale state for ${JSON.stringify(entry.name)}: ${expected} is not an active Git worktree.`);
  }
  return 0;
}
