import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY = resolve(SCRIPT_DIRECTORY, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
export const RELEASE_ASSETS = ["wt", "wt.sh", "wt.fish", "install.sh"];

/**
 * @typedef {{
 *   directory: string,
 *   tarball: string,
 *   version: string,
 *   tag: string
 * }} ReleaseBuild
 */

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

export async function readReleaseVersion(repository = REPOSITORY) {
  const manifest = JSON.parse(await readFile(join(repository, "package.json"), "utf8"));
  if (typeof manifest.version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(manifest.version)) {
    throw new Error(`package.json has an invalid stable version: ${String(manifest.version)}`);
  }
  return manifest.version;
}

async function writeChecksums(directory, names) {
  const lines = [];
  for (const name of names) {
    lines.push(`${sha256(await readFile(join(directory, name)))}  ${name}`);
  }
  await writeFile(join(directory, "checksums.txt"), `${lines.join("\n")}\n`, "utf8");
}

export async function readChecksums(directory) {
  const text = await readFile(join(directory, "checksums.txt"), "utf8");
  const checksums = new Map();
  for (const line of text.trim().split(/\r?\n/).filter(Boolean)) {
    const match = /^([a-f0-9]{64})  ([^\r\n]+)$/.exec(line);
    if (!match) throw new Error(`invalid checksum line: ${line}`);
    if (checksums.has(match[2])) throw new Error(`duplicate checksum entry: ${match[2]}`);
    checksums.set(match[2], match[1]);
  }
  return checksums;
}

export async function assertMatchingReleaseAssets(expectedDirectory, actualDirectory) {
  const expected = await readChecksums(expectedDirectory);
  const actual = await readChecksums(actualDirectory);
  const expectedFiles = (await readdir(expectedDirectory)).filter((name) => name !== "checksums.txt").sort();
  const actualFiles = (await readdir(actualDirectory)).filter((name) => name !== "checksums.txt").sort();
  if (JSON.stringify(expectedFiles) !== JSON.stringify(actualFiles)
      || expected.size !== actual.size
      || [...expected.keys()].some((name) => actual.get(name) !== expected.get(name))) {
    throw new Error("same-version release hash conflict");
  }
  for (const [name, digest] of expected) {
    if (!existsSync(join(actualDirectory, name)) || sha256(await readFile(join(actualDirectory, name))) !== digest) {
      throw new Error("same-version release hash conflict");
    }
  }
  return true;
}

/**
 * Build the one artifact used by npm and the standalone release.
 * @param {{ repository?: string, directory?: string }} [options]
 * @returns {Promise<ReleaseBuild>}
 */
export async function buildRelease({ repository = REPOSITORY, directory } = {}) {
  const root = resolve(repository);
  const version = await readReleaseVersion(root);
  let releaseDirectory;
  if (directory) {
    releaseDirectory = resolve(directory);
    await rm(releaseDirectory, { recursive: true, force: true });
    await mkdir(releaseDirectory, { recursive: true, mode: 0o700 });
  } else {
    releaseDirectory = await mkdtemp(join(tmpdir(), `wt-release-${version}-`));
  }

  await execFileAsync(process.execPath, [join(root, "scripts", "build.mjs")], { cwd: root });
  const artifact = join(root, "dist", "wt.cjs");
  const sources = {
    wt: artifact,
    "wt.sh": join(root, "shell", "wt.sh"),
    "wt.fish": join(root, "shell", "wt.fish"),
    "install.sh": join(root, "install.sh"),
  };
  for (const [name, source] of Object.entries(sources)) {
    await copyFile(source, join(releaseDirectory, name));
  }
  if (!(await readFile(artifact, "utf8")).includes(JSON.stringify(version))) {
    throw new Error(`generated artifact does not contain version ${version}`);
  }
  await chmod(join(releaseDirectory, "wt"), 0o755);
  await chmod(join(releaseDirectory, "install.sh"), 0o755);

  const { stdout } = await execFileAsync(npmCommand, ["pack", "--pack-destination", releaseDirectory], { cwd: root });
  const tarballs = (await readdir(releaseDirectory)).filter((name) => name.endsWith(".tgz"));
  if (tarballs.length !== 1) throw new Error(`expected exactly one npm tarball, found ${tarballs.length}`);
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const expectedTarball = `${manifest.name.replace(/^@/, "").replace("/", "-")}-${version}.tgz`;
  if (!tarballs.includes(expectedTarball)) throw new Error(`npm pack produced an unexpected tarball: ${tarballs.join(", ")}`);
  const tarball = join(releaseDirectory, tarballs[0]);
  if (!stdout.includes(tarballs[0])) throw new Error("npm pack did not report the expected tarball");
  await writeChecksums(releaseDirectory, [...RELEASE_ASSETS, tarballs[0]]);
  return { directory: releaseDirectory, tarball, version, tag: `v${version}` };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  buildRelease().then((release) => {
    console.log(JSON.stringify(release, null, 2));
  }).catch((error) => {
    console.error(`release build: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
