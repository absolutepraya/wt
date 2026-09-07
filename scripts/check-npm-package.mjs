import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const repository = resolve(process.cwd());
const packageManifest = JSON.parse(readFileSync(join(repository, "package.json"), "utf8"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const packageDirectory = mkdtempSync(join(tmpdir(), "wt-package-"));
const localConsumer = mkdtempSync(join(tmpdir(), "wt-local-consumer-"));
const globalPrefix = mkdtempSync(join(tmpdir(), "wt-global-prefix-"));
const home = mkdtempSync(join(tmpdir(), "wt-npm-home-"));
const cache = mkdtempSync(join(tmpdir(), "wt-npm-cache-"));
const commandEnvironment = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  XDG_CONFIG_HOME: join(home, ".config"),
  npm_config_cache: cache,
  npm_config_userconfig: join(home, ".npmrc"),
  npm_config_audit: "false",
  npm_config_fund: "false",
  npm_config_update_notifier: "false",
};
const profilePaths = [
  join(home, ".bashrc"),
  join(home, ".zshrc"),
  join(home, ".config", "fish", "config.fish"),
  join(home, ".config", "fish", "conf.d", "wt.fish"),
  join(home, ".config", "powershell", "Microsoft.PowerShell_profile.ps1"),
  join(home, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1"),
  join(home, "AppData", "Roaming", "PowerShell", "Microsoft.PowerShell_profile.ps1"),
  join(home, "Documents", "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1"),
];

function run(command, args, options = {}) {
  return execCommand(command, args, {
    cwd: repository,
    env: commandEnvironment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function execCommand(command, args, options = {}) {
  return execFileSync(command, args, {
    shell: process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command),
    ...options,
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function snapshotProfiles() {
  return new Map(profilePaths.map((path) => [path, existsSync(path) ? readFileSync(path) : null]));
}

function assertProfilesUnchanged(before, label) {
  for (const [path, contents] of before) {
    const after = existsSync(path) ? readFileSync(path) : null;
    assert(
      (contents === null && after === null) ||
        (contents !== null && after !== null && contents.equals(after)),
      `${label} changed shell profile ${path}`,
    );
  }
}

function assertVersionHelp(command, cwd, env) {
  const version = execCommand(command, ["--version"], { cwd, env, encoding: "utf8" }).trim();
  assert(version === `wt ${packageManifest.version}`, `${command} returned unexpected version: ${version}`);
  const help = execCommand(command, ["--help"], { cwd, env, encoding: "utf8" });
  assert(help.includes("Usage: wt <command>"), `${command} did not print CLI help`);
}

function assertNpxVersionHelp(cwd, env) {
  const version = execCommand(npx, ["--no-install", "wt", "--version"], { cwd, env, encoding: "utf8" }).trim();
  assert(version === `wt ${packageManifest.version}`, `${npx} wt returned unexpected version: ${version}`);
  const help = execCommand(npx, ["--no-install", "wt", "--help"], { cwd, env, encoding: "utf8" });
  assert(help.includes("Usage: wt <command>"), `${npx} wt did not print CLI help`);
}

function assertShimTargetsArtifact(shim, artifact, bundledArtifact, label) {
  assert(existsSync(shim), `${label} npm bin shim is missing: ${shim}`);
  assert(existsSync(artifact), `${label} bundled artifact is missing: ${artifact}`);
  assert(readFileSync(artifact).equals(readFileSync(bundledArtifact)), `${label} artifact differs from the build output`);
  const shimStat = lstatSync(shim);
  if (process.platform !== "win32" && shimStat.isSymbolicLink()) {
    assert(resolve(dirname(shim), readlinkSync(shim)) === resolve(artifact), `${label} shim target differs from artifact`);
  } else {
    const shimText = readFileSync(shim, "utf8");
    assert(shimText.includes("dist/wt.cjs") || shimText.includes("dist\\wt.cjs"), `${label} shim does not invoke dist/wt.cjs`);
  }
  assert(!readFileSync(artifact, "utf8").toLowerCase().includes("python"), `${label} artifact references Python`);
}

function globalCommandPath(prefix) {
  return process.platform === "win32" ? join(prefix, "wt.cmd") : join(prefix, "bin", "wt");
}

function nodeOnlyEnvironment(extra = {}) {
  return {
    ...commandEnvironment,
    PATH: dirname(process.execPath),
    Path: dirname(process.execPath),
    ...extra,
  };
}

try {
  assert(packageManifest.name === "@absolutepraya/wt", "unexpected package name");
  assert(packageManifest.bin?.wt === "dist/wt.cjs", "npm bin must point at dist/wt.cjs");
  assert(!packageManifest.dependencies, "the npm package must not have runtime dependencies");

  const packOutput = run(npm, ["pack", "--silent", "--pack-destination", packageDirectory]);
  const tarballName = packOutput.trim().split(/\r?\n/).at(-1);
  assert(tarballName?.endsWith(".tgz"), "npm pack did not produce a tarball");
  const tarball = join(packageDirectory, tarballName);
  assert(existsSync(tarball), `packed tarball is missing: ${tarball}`);

  const packInfo = JSON.parse(run(npm, ["pack", "--dry-run", "--json"]))[0];
  const packedFiles = packInfo.files.map(({ path }) => path.replaceAll("\\", "/"));
  for (const path of ["package.json", "dist/wt.cjs"]) {
    assert(packedFiles.includes(path), `tarball is missing ${path}`);
  }
  const forbiddenPrefixes = ["src/", "test/", "tests/", "bin/", "npm/", "scripts/", "node_modules/"];
  for (const path of packedFiles) {
    assert(!forbiddenPrefixes.some((prefix) => path.startsWith(prefix)), `development file packed: ${path}`);
  }
  assert(!packedFiles.includes("npm/wt.cjs"), "old npm launcher was packed");

  run(npm, ["init", "--yes"], { cwd: localConsumer, stdio: "ignore" });
  const localProfiles = snapshotProfiles();
  run(npm, ["install", "--no-audit", "--no-fund", "--save-dev", tarball], { cwd: localConsumer, stdio: "inherit" });
  assertProfilesUnchanged(localProfiles, "local npm install");
  const localLock = JSON.parse(readFileSync(join(localConsumer, "package-lock.json"), "utf8"));
  const localPackage = localLock.packages?.[`node_modules/${packageManifest.name}`];
  assert(localPackage?.version === packageManifest.version, "local lockfile does not record the package version");
  assert(localPackage?.dev === true, "local lockfile package is not a development dependency");
  const localArtifact = join(localConsumer, "node_modules", packageManifest.name, "dist", "wt.cjs");
  const localShim = join(localConsumer, "node_modules", ".bin", process.platform === "win32" ? "wt.cmd" : "wt");
  const bundledArtifact = join(repository, "dist", "wt.cjs");
  assertShimTargetsArtifact(localShim, localArtifact, bundledArtifact, "local");
  assertNpxVersionHelp(localConsumer, commandEnvironment);
  assertVersionHelp(localShim, localConsumer, nodeOnlyEnvironment({ PATH: `${dirname(process.execPath)}${process.platform === "win32" ? ";" : ":"}${join(localConsumer, "node_modules", ".bin")}` }));
  assertProfilesUnchanged(localProfiles, "local npm commands");

  const globalProfiles = snapshotProfiles();
  run(npm, ["install", "--global", "--prefix", globalPrefix, "--no-audit", "--no-fund", tarball], { stdio: "inherit" });
  assertProfilesUnchanged(globalProfiles, "global npm install");
  const globalModules = process.platform === "win32" ? "node_modules" : join("lib", "node_modules");
  const globalArtifact = join(globalPrefix, globalModules, packageManifest.name, "dist", "wt.cjs");
  const globalShim = globalCommandPath(globalPrefix);
  assertShimTargetsArtifact(globalShim, globalArtifact, bundledArtifact, "global");
  assertVersionHelp(globalShim, repository, nodeOnlyEnvironment());
  assertProfilesUnchanged(globalProfiles, "global npm commands");

  console.log(`npm distribution smoke passed: ${packedFiles.length} packed files, local and global consumers verified`);
} finally {
  for (const path of [packageDirectory, localConsumer, globalPrefix, home, cache]) {
    rmSync(path, { recursive: true, force: true });
  }
}
