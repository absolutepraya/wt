import { readFileSync } from "node:fs";

export function hasVersionChange(previousManifest, currentManifest) {
  return previousManifest?.version !== currentManifest?.version;
}

export function npmReleaseDecision({ remoteIntegrity, localIntegrity }) {
  if (remoteIntegrity === undefined) return "publish";
  if (typeof remoteIntegrity === "string" && remoteIntegrity === localIntegrity) return "reuse";
  throw new Error("same-version npm package hash conflict");
}

export function assertTagTarget(expected, actual) {
  if (expected !== actual) {
    throw new Error(`same-version tag conflict: expected ${expected}, got ${actual}`);
  }
  return true;
}

export function classifyReleaseLookup({ exitCode, stderr }) {
  if (exitCode === 0) return "exists";
  const notFoundLine = String(stderr)
    .split(/\r?\n/)
    .some((line) => /^(?:error:\s*)?release not found$/i.test(line.trim()));
  if (exitCode === 1 && notFoundLine) return "missing";
  throw new Error(`unexpected GitHub Release lookup failure (exit ${exitCode}): ${String(stderr).trim()}`);
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index === -1 || !args[index + 1]) throw new Error(`${name} requires a value`);
  return args[index + 1];
}

function manifest(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function main(args) {
  const command = args[0];
  if (command === "version-change") {
    console.log(hasVersionChange(manifest(option(args, "--previous")), manifest(option(args, "--current"))));
    return;
  }
  if (command === "npm-integrity") {
    const localIntegrity = option(args, "--local");
    const remoteIndex = args.indexOf("--remote");
    const remoteIntegrity = remoteIndex === -1 ? undefined : args[remoteIndex + 1];
    if (remoteIndex !== -1 && (!remoteIntegrity || remoteIntegrity.startsWith("--"))) {
      throw new Error("--remote requires a value");
    }
    console.log(npmReleaseDecision({ remoteIntegrity, localIntegrity }));
    return;
  }
  if (command === "tag-target") {
    assertTagTarget(option(args, "--expected"), option(args, "--actual"));
    console.log("match");
    return;
  }
  if (command === "release-lookup") {
    const exitCode = Number(option(args, "--status"));
    const stderr = readFileSync(option(args, "--error-file"), "utf8");
    console.log(classifyReleaseLookup({ exitCode, stderr }));
    return;
  }
  throw new Error(`unknown release gate: ${command ?? ""}`);
}

if (process.argv[1] && new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`release gate: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
