import { parseArgs } from "node:util";
import { runCd, runLs, runNew, runRm, runUpdate } from "./commands/index.js";
import { UsageError, WtError } from "./errors.js";
import { writeOutput } from "./output.js";
import { renderShellInit } from "./shell-init.js";
import type { CliContext, ShellName } from "./types.js";
import { VERSION } from "./version.js";

const SHELLS = new Set<ShellName>(["bash", "zsh", "fish", "powershell"]);
type ParseOptions = NonNullable<NonNullable<Parameters<typeof parseArgs>[0]>["options"]>;

const TOP_LEVEL_HELP = `Universal git worktree CLI

Usage: wt <command> [options]

Commands:
  new [name]       create a worktree
  ls, list          list worktrees
  cd [name]         print a worktree path and navigation sentinel
  rm, remove <name> remove a worktree
  update            update a standalone installation
  shell-init <shell> print shell integration for the current session
  help              show this help

Run \`wt <command> -h\` for command-specific options.`;

const COMMAND_HELP: Record<string, string> = {
  new: "Usage: wt new [name] [-b branch] [--from remote-branch] [--no-setup|--skip-setup] [--cd]",
  ls: "Usage: wt ls",
  cd: "Usage: wt cd [name]",
  rm: "Usage: wt rm <name> [--force] [--keep-branch]",
  update: "Usage: wt update [--check]",
  "shell-init": "Usage: wt shell-init <bash|zsh|fish|powershell>",
};

function processContext(): CliContext {
  return {
    cwd: process.cwd(),
    env: process.env,
    io: {
      stdout: process.stdout,
      stderr: process.stderr,
      stdin: process.stdin,
      stdoutIsTTY: Boolean(process.stdout.isTTY),
      stdinIsTTY: Boolean(process.stdin.isTTY),
    },
  };
}

function printHelp(context: CliContext, command?: string): void {
  writeOutput(context.io.stdout, command ? COMMAND_HELP[command] ?? TOP_LEVEL_HELP : TOP_LEVEL_HELP);
}

function parseCommandArgs(args: string[], options: ParseOptions) {
  try {
    return parseArgs({ args, options, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError(diagnostic(error));
  }
}

function requirePositionals(positionals: string[], minimum: number, maximum: number, usage: string): void {
  if (positionals.length < minimum || positionals.length > maximum) throw new UsageError(usage);
}

function diagnostic(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  const sanitized = value.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/\s+/g, " ").trim();
  return (sanitized || "unexpected failure").slice(0, 500);
}

function exitCode(error: unknown): number {
  return error instanceof WtError && error.code === "USAGE_ERROR" ? 2 : 1;
}

async function dispatch(command: string, args: string[], context: CliContext): Promise<number> {
  switch (command) {
    case "new": {
      const { values, positionals } = parseCommandArgs(args, {
        branch: { type: "string", short: "b" },
        from: { type: "string" },
        "no-setup": { type: "boolean" },
        "skip-setup": { type: "boolean" },
        cd: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      });
      if (values.help) { printHelp(context, "new"); return 0; }
      requirePositionals(positionals, 0, 1, COMMAND_HELP.new);
      return await runNew(context, {
        name: positionals[0],
        branch: values.branch as string | undefined,
        from: values.from as string | undefined,
        noSetup: Boolean(values["no-setup"] || values["skip-setup"]),
        cdAfterCreate: Boolean(values.cd),
      });
    }
    case "ls":
    case "list": {
      const { values, positionals } = parseCommandArgs(args, { help: { type: "boolean", short: "h" } });
      if (values.help) { printHelp(context, "ls"); return 0; }
      requirePositionals(positionals, 0, 0, COMMAND_HELP.ls);
      return await runLs(context);
    }
    case "cd": {
      const { values, positionals } = parseCommandArgs(args, { help: { type: "boolean", short: "h" } });
      if (values.help) { printHelp(context, "cd"); return 0; }
      requirePositionals(positionals, 0, 1, COMMAND_HELP.cd);
      return await runCd(context, positionals[0]);
    }
    case "rm":
    case "remove": {
      const { values, positionals } = parseCommandArgs(args, {
        force: { type: "boolean" },
        "keep-branch": { type: "boolean" },
        help: { type: "boolean", short: "h" },
      });
      if (values.help) { printHelp(context, "rm"); return 0; }
      requirePositionals(positionals, 1, 1, COMMAND_HELP.rm);
      return await runRm(context, {
        name: positionals[0]!,
        force: Boolean(values.force),
        keepBranch: Boolean(values["keep-branch"]),
      });
    }
    case "update": {
      const { values, positionals } = parseCommandArgs(args, {
        check: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      });
      if (values.help) { printHelp(context, "update"); return 0; }
      requirePositionals(positionals, 0, 0, COMMAND_HELP.update);
      return await runUpdate(context, Boolean(values.check));
    }
    case "shell-init": {
      const { values, positionals } = parseCommandArgs(args, { help: { type: "boolean", short: "h" } });
      if (values.help) { printHelp(context, "shell-init"); return 0; }
      requirePositionals(positionals, 1, 1, COMMAND_HELP["shell-init"]);
      const shell = positionals[0];
      if (!shell || !SHELLS.has(shell as ShellName)) throw new UsageError(COMMAND_HELP["shell-init"]);
      writeOutput(context.io.stdout, renderShellInit(shell as ShellName));
      return 0;
    }
    case "help": {
      requirePositionals(args, 0, 0, "Usage: wt help");
      printHelp(context);
      return 0;
    }
    default:
      throw new UsageError(`unknown command ${JSON.stringify(command)}. Run \`wt --help\` for usage.`);
  }
}

/** Dispatch a CLI invocation after all asynchronous lifecycle work has settled. */
export async function runCli(args: string[] = process.argv.slice(2), context: CliContext = processContext()): Promise<number> {
  try {
    if (args.length === 0) { printHelp(context); return 0; }
    const [first, ...remaining] = args;
    const global = parseCommandArgs([first!], {
      version: { type: "boolean", short: "V" },
      help: { type: "boolean", short: "h" },
    });
    if (global.values.version) { writeOutput(context.io.stdout, `wt ${VERSION}`); return 0; }
    if (global.values.help) { printHelp(context); return 0; }
    if (first!.startsWith("-")) throw new UsageError(`unknown option ${JSON.stringify(first!)}. Run \`wt --help\` for usage.`);
    return await dispatch(first!, remaining, context);
  } catch (error) {
    writeOutput(context.io.stderr, `wt: error: ${diagnostic(error)}${exitCode(error) === 2 ? "\nTry `wt --help` for usage." : ""}`);
    return exitCode(error);
  }
}

if (typeof require !== "undefined" && require.main === module) {
  void runCli().then((code) => { process.exitCode = code; });
}
