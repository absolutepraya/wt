import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

async function findTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findTests(path));
    else if (entry.isFile() && entry.name.endsWith(".test.ts")) files.push(path);
  }
  return files;
}

const tests = (await findTests("test")).sort();
const tsx = join("node_modules", "tsx", "dist", "cli.mjs");
const child = spawn(process.execPath, [tsx, "--test", ...tests], { stdio: "inherit", shell: false });
child.on("error", (error) => {
  console.error(`failed to start tests: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? 1;
  if (signal) process.exitCode = 1;
});
