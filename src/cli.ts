import { VERSION } from "./version.js";

export function runCli(args: string[] = process.argv.slice(2)): number {
  if (args.includes("--version") || args.includes("-V")) {
    console.log(`wt ${VERSION}`);
    return 0;
  }

  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    console.log("Universal git worktree CLI");
    console.log("\nUsage: wt <command> [options]");
    return 0;
  }

  console.error(`wt: command not yet dispatched: ${args[0]}`);
  return 1;
}

if (typeof require !== "undefined" && require.main === module) {
  process.exitCode = runCli();
}
