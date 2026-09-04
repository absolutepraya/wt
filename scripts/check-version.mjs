import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export async function readVersion(repository = process.cwd()) {
  const packageJson = JSON.parse(await readFile(join(repository, "package.json"), "utf8"));
  if (typeof packageJson.version !== "string" || !STABLE_VERSION.test(packageJson.version)) {
    throw new Error(`package.json has an invalid stable version: ${String(packageJson.version)}`);
  }
  return packageJson.version;
}

export async function checkVersion({ repository = process.cwd(), artifactPath, tag } = {}) {
  const root = resolve(repository);
  const version = await readVersion(root);
  const artifact = await readFile(resolve(root, artifactPath ?? join("dist", "wt.cjs")), "utf8");
  if (!artifact.includes(JSON.stringify(version))) {
    throw new Error(`generated artifact does not contain version ${version}`);
  }
  if (tag !== undefined && tag !== `v${version}`) {
    throw new Error(`version tag mismatch: expected v${version}`);
  }
  return version;
}

function parseArgs(args) {
  let print = false;
  let tag;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--print") print = true;
    else if (argument === "--tag") {
      tag = args[++index];
      if (!tag) throw new Error("--tag requires a value");
    } else throw new Error(`unknown argument: ${argument}`);
  }
  return { print, tag };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`version check: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
  if (options) {
    checkVersion({ tag: options.tag }).then((version) => {
      console.log(options.print ? version : `version metadata is consistent: ${version}`);
    }).catch((error) => {
      console.error(`version check: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
  }
}
