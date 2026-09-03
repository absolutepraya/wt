import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const packageDirectory = mkdtempSync(join(tmpdir(), "wt-package-"));
const consumerDirectory = mkdtempSync(join(tmpdir(), "wt-consumer-"));

try {
  execFileSync("npm", ["pack", "--silent", "--pack-destination", packageDirectory], {
    stdio: "inherit",
  });
  const tarball = readdirSync(packageDirectory).find((name) => name.endsWith(".tgz"));
  if (!tarball) throw new Error("npm pack did not produce a tarball");

  execFileSync("npm", ["init", "--yes"], { cwd: consumerDirectory, stdio: "ignore" });
  execFileSync(
    "npm",
    ["install", "--no-audit", "--no-fund", "--save-dev", join(packageDirectory, tarball)],
    { cwd: consumerDirectory, stdio: "inherit" },
  );
  execFileSync("npx", ["--no-install", "wt", "--version"], {
    cwd: consumerDirectory,
    stdio: "inherit",
  });
  execFileSync("npx", ["--no-install", "wt", "--help"], {
    cwd: consumerDirectory,
    stdio: "inherit",
  });
} finally {
  rmSync(packageDirectory, { recursive: true, force: true });
  rmSync(consumerDirectory, { recursive: true, force: true });
}
