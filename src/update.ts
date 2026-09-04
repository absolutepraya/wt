import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { UpdateError } from "./errors.js";
import { installMetadataPath, normalizePath, wtConfigDir } from "./paths.js";
import { detectInstallChannel } from "./runtime.js";
import type { CliContext } from "./types.js";
import { VERSION } from "./version.js";

const RELEASE_API_URL = "https://api.github.com/repos/absolutepraya/wt/releases/latest";
const RELEASE_HOST = "github.com";
const RELEASE_PATH = "/absolutepraya/wt/releases/download";
const RELEASE_CDN_HOSTS = new Set([
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "github-releases.githubusercontent.com",
]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const REQUIRED_ASSETS = ["wt", "wt.sh", "wt.fish", "checksums.txt"] as const;
const MAX_API_BYTES = 1024 * 1024;
const MAX_ASSET_BYTES = 10 * 1024 * 1024;
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA256 = /^[a-f0-9]{64}$/i;

export interface ReleaseInfo {
  tag: string;
  version: string;
  assets: Map<string, string>;
}

export interface UpdateServices {
  apiUrl: string;
  fetchImpl: typeof fetch;
  executablePath: string;
  configDir: string;
  now: () => Date;
  /** Test-only failure injection; production callers use the default rename. */
  renameImpl?: typeof rename;
}

interface InstallMetadata {
  channel: "standalone";
  binary: string;
  shell_wrapper: string;
  fish_wrapper: string;
  repository: "absolutepraya/wt";
  tag: string;
  installed_at: string;
}

interface Replacement {
  destination: string;
  staged: string;
  backup?: string;
  installed?: boolean;
}

export function parseStableVersion(value: string): string | null {
  const text = value.startsWith("v") ? value.slice(1) : value;
  return STABLE_VERSION.test(text) ? text : null;
}

function versionParts(version: string): [number, number, number] {
  const stable = parseStableVersion(version);
  if (!stable) throw new UpdateError(`unsupported stable version ${JSON.stringify(valueForMessage(version))}`);
  return stable.split(".").map(Number) as [number, number, number];
}

function compareVersions(left: string, right: string): number {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index]! !== b[index]!) return a[index]! < b[index]! ? -1 : 1;
  }
  return 0;
}

function valueForMessage(value: string): string {
  return value.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

async function responseBytes(response: Response, limit: number, purpose: string): Promise<Buffer> {
  if (!response.ok) throw new UpdateError(`${purpose} failed with HTTP ${response.status}.`);
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > limit)) {
    throw new UpdateError(`${purpose} exceeds the ${limit} byte safety limit.`);
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const contents = Buffer.from(await response.arrayBuffer());
    if (contents.length > limit) throw new UpdateError(`${purpose} exceeds the ${limit} byte safety limit.`);
    return contents;
  }
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      length += chunk.length;
      if (length > limit) {
        await reader.cancel();
        throw new UpdateError(`${purpose} exceeds the ${limit} byte safety limit.`);
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof UpdateError) throw error;
    throw new UpdateError(`${purpose} could not be read.`);
  }
  return Buffer.concat(chunks, length);
}

function expectedAssetUrl(name: string, tag: string): string {
  return `https://${RELEASE_HOST}${RELEASE_PATH}/${tag}/${name}`;
}

function validateAssetUrl(name: string, tag: string, rawUrl: unknown): string {
  if (typeof rawUrl !== "string") throw new UpdateError(`release asset ${name} has no download URL.`);
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { throw new UpdateError(`release asset ${name} has an invalid download URL.`); }
  if (parsed.protocol !== "https:" || parsed.hostname !== RELEASE_HOST || parsed.username || parsed.password || parsed.hash || parsed.search
    || parsed.pathname !== `${RELEASE_PATH}/${tag}/${name}` || parsed.href !== expectedAssetUrl(name, tag)) {
    throw new UpdateError(`release asset ${name} is not hosted by the expected wt release.`);
  }
  return parsed.href;
}

function validateRedirectUrl(name: string, tag: string, rawUrl: string, previous: URL): URL {
  let target: URL;
  try { target = new URL(rawUrl, previous); } catch { throw new UpdateError(`release asset ${name} has an invalid redirect.`); }
  if (target.protocol !== "https:" || target.port || target.username || target.password || target.hash) {
    throw new UpdateError(`release asset ${name} redirected to an unapproved URL.`);
  }
  if (target.hostname === RELEASE_HOST) {
    if (target.search || target.pathname !== `${RELEASE_PATH}/${tag}/${name}` || target.href !== expectedAssetUrl(name, tag)) {
      throw new UpdateError(`release asset ${name} redirected outside the expected wt release.`);
    }
    return target;
  }
  if (previous.hostname !== RELEASE_HOST || !RELEASE_CDN_HOSTS.has(target.hostname)
    || !target.pathname.startsWith("/github-production-release-asset/") || !target.searchParams.get("sig")) {
    throw new UpdateError(`release asset ${name} redirected to an unapproved host.`);
  }
  return target;
}

async function fetchReleaseAsset(
  name: string,
  tag: string,
  url: string,
  fetchImpl: typeof fetch,
): Promise<Response> {
  let current = new URL(validateAssetUrl(name, tag, url));
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    let response: Response;
    try {
      response = await fetchImpl(current.href, { headers: { "User-Agent": `wt/${VERSION}` }, redirect: "manual" });
    } catch {
      throw new UpdateError(`download of ${name} failed.`);
    }
    if (!REDIRECT_STATUSES.has(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) throw new UpdateError(`release asset ${name} returned a redirect without a location.`);
    current = validateRedirectUrl(name, tag, location, current);
  }
  throw new UpdateError(`release asset ${name} exceeded the redirect limit.`);
}

export async function latestStableRelease(apiUrl: string, fetchImpl: typeof fetch = fetch): Promise<ReleaseInfo> {
  let payload: Buffer;
  try {
    payload = await responseBytes(await fetchImpl(apiUrl, { headers: { Accept: "application/vnd.github+json", "User-Agent": `wt/${VERSION}` } }), MAX_API_BYTES, "GitHub release lookup");
  } catch (error) {
    if (error instanceof UpdateError) throw error;
    throw new UpdateError("GitHub release lookup failed.");
  }
  let release: unknown;
  try { release = JSON.parse(payload.toString("utf8")); } catch { throw new UpdateError("GitHub returned invalid release metadata."); }
  if (!release || typeof release !== "object" || Array.isArray(release)) throw new UpdateError("GitHub returned an invalid release response.");
  const record = release as Record<string, unknown>;
  if (record.draft !== false || record.prerelease !== false) throw new UpdateError("GitHub did not return a stable release.");
  if (typeof record.tag_name !== "string") throw new UpdateError("latest GitHub release has no tag.");
  const version = parseStableVersion(record.tag_name);
  if (!version || record.tag_name !== `v${version}`) throw new UpdateError("latest GitHub release tag is not a stable vX.Y.Z tag.");
  if (!Array.isArray(record.assets)) throw new UpdateError("latest GitHub release has no asset list.");
  const assets = new Map<string, string>();
  for (const asset of record.assets) {
    if (!asset || typeof asset !== "object" || Array.isArray(asset)) throw new UpdateError("latest GitHub release has malformed asset metadata.");
    const assetRecord = asset as Record<string, unknown>;
    if (typeof assetRecord.name !== "string" || !assetRecord.name || assetRecord.name.includes("/") || assetRecord.name.includes("\\")) {
      throw new UpdateError("latest GitHub release has an invalid asset name.");
    }
    if (assets.has(assetRecord.name)) throw new UpdateError(`latest GitHub release has duplicate asset ${assetRecord.name}.`);
    assets.set(assetRecord.name, validateAssetUrl(assetRecord.name, record.tag_name, assetRecord.browser_download_url));
  }
  const missing = REQUIRED_ASSETS.filter((asset) => !assets.has(asset));
  if (missing.length) throw new UpdateError(`latest stable release ${record.tag_name} is missing update assets: ${missing.join(", ")}.`);
  return { tag: record.tag_name, version, assets };
}

export function parseChecksums(contents: string): Map<string, string> {
  const checksums = new Map<string, string>();
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /^([a-fA-F0-9]{64})[ \t]+\*?([^\s\\/]+)$/.exec(line);
    if (!match) continue;
    const [, digest, name] = match;
    if (checksums.has(name!)) throw new UpdateError(`checksums.txt has duplicate entry ${name}.`);
    checksums.set(name!, digest!.toLowerCase());
  }
  return checksums;
}

export function validateCliPayload(contents: Buffer, expectedVersion: string): void {
  const version = parseStableVersion(expectedVersion);
  if (!version) throw new UpdateError("expected release version is not stable.");
  let text: string;
  try { text = contents.toString("utf8"); } catch { throw new UpdateError("downloaded CLI is not valid UTF-8."); }
  if (text.includes("\uFFFD")) throw new UpdateError("downloaded CLI is not valid UTF-8.");
  if (!text.startsWith("#!/usr/bin/env node\n") && !text.startsWith("#!/usr/bin/env node\r\n")) {
    throw new UpdateError("downloaded CLI has an unexpected interpreter header.");
  }
  const escaped = version.replace(/\./g, "\\.");
  const assignment = new RegExp(`\\b(?:const|let|var)\\s+VERSION\\s*=\\s*[\\s\\S]{0,240}?[\"']${escaped}[\"']`);
  if (!assignment.test(text)) throw new UpdateError("downloaded CLI version does not match the GitHub release tag.");
}

function sha256(payload: Buffer): string { return createHash("sha256").update(payload).digest("hex"); }

function verifyPayloads(payloads: Map<string, Buffer>, checksums: Map<string, string>): void {
  for (const [name, payload] of payloads) {
    const expected = checksums.get(name);
    if (!expected || !SHA256.test(expected)) throw new UpdateError(`checksums.txt does not contain a valid checksum for ${name}.`);
    if (sha256(payload) !== expected) throw new UpdateError(`checksum verification failed for ${name}.`);
  }
}

async function writeStaged(destination: string, contents: Buffer, executable: boolean): Promise<string> {
  const directory = dirname(destination);
  const temporary = join(directory, `.${basename(destination)}.wt-update-${process.pid}-${Math.random().toString(16).slice(2)}`);
  try {
    await writeFile(temporary, contents, { mode: executable ? 0o755 : 0o644, flag: "wx" });
    if (executable) {
      const existingMode = existsSync(destination) ? (await stat(destination)).mode & 0o777 : 0o755;
      await chmod(temporary, existingMode | 0o111);
    }
    return temporary;
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw new UpdateError(`cannot stage update at ${directory}: ${safeError(error)}`);
  }
}

async function transactionalReplace(
  files: Array<{ destination: string; contents: Buffer; executable: boolean }>,
  renameImpl: typeof rename = rename,
): Promise<void> {
  const replacements: Replacement[] = [];
  let completed = false;
  let rollbackFailed = false;
  try {
    for (const file of files) replacements.push({ destination: file.destination, staged: await writeStaged(file.destination, file.contents, file.executable) });
    for (const replacement of replacements) {
      if (existsSync(replacement.destination)) {
        replacement.backup = join(dirname(replacement.destination), `.${basename(replacement.destination)}.wt-backup-${process.pid}-${Math.random().toString(16).slice(2)}`);
        await renameImpl(replacement.destination, replacement.backup);
      }
      await renameImpl(replacement.staged, replacement.destination);
      replacement.staged = "";
      replacement.installed = true;
    }
    completed = true;
  } catch (error) {
    for (const replacement of [...replacements].reverse()) {
      try {
        if (replacement.installed && existsSync(replacement.destination)) await rm(replacement.destination, { recursive: true, force: true });
        if (replacement.backup && existsSync(replacement.backup)) {
          if (existsSync(replacement.destination)) rollbackFailed = true;
          else await renameImpl(replacement.backup, replacement.destination);
        }
      } catch { rollbackFailed = true; }
    }
    if (rollbackFailed) {
      throw new UpdateError("could not install update safely; preserved rollback files require manual recovery.");
    }
    throw error instanceof UpdateError ? error : new UpdateError(`could not install update safely: ${safeError(error)}`);
  } finally {
    await Promise.all(replacements.flatMap((replacement) => [replacement.staged, ...(completed ? [replacement.backup] : [])].filter((path): path is string => Boolean(path)).map((path) => rm(path, { recursive: true, force: true }).catch(() => undefined))));
  }
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "filesystem operation failed";
  return valueForMessage(message) || "filesystem operation failed";
}

function readMatchingStandaloneMetadata(configDir: string, executablePath: string): void {
  const metadata = installMetadataPath(configDir);
  try {
    const record = JSON.parse(readFileSync(metadata, "utf8")) as Record<string, unknown>;
    const binary = typeof record.binary === "string" ? record.binary : record.executable_path;
    if (record.channel !== "standalone" || typeof binary !== "string" || normalizePath(binary) !== normalizePath(executablePath)) {
      throw new UpdateError("standalone install metadata does not match this executable.");
    }
  } catch (error) {
    if (error instanceof UpdateError) throw error;
    throw new UpdateError("cannot read matching standalone install metadata.");
  }
}

async function downloadPayloads(release: ReleaseInfo, fetchImpl: typeof fetch, directory: string): Promise<Map<string, Buffer>> {
  const payloads = new Map<string, Buffer>();
  for (const asset of REQUIRED_ASSETS) {
    const url = release.assets.get(asset);
    if (!url) throw new UpdateError(`latest stable release ${release.tag} is missing update asset ${asset}.`);
    try {
      const payload = await responseBytes(await fetchReleaseAsset(asset, release.tag, url, fetchImpl), asset === "checksums.txt" ? MAX_API_BYTES : MAX_ASSET_BYTES, `download of ${asset}`);
      await writeFile(join(directory, asset), payload, { mode: asset === "wt" ? 0o700 : 0o600, flag: "wx" });
      payloads.set(asset, payload);
    } catch (error) {
      if (error instanceof UpdateError) throw error;
      throw new UpdateError(`download of ${asset} failed.`);
    }
  }
  return payloads;
}

function updateServices(services?: UpdateServices): UpdateServices {
  const configDir = services?.configDir ?? wtConfigDir();
  return {
    apiUrl: services?.apiUrl ?? RELEASE_API_URL,
    fetchImpl: services?.fetchImpl ?? fetch,
    executablePath: resolve(services?.executablePath ?? process.argv[1] ?? process.execPath),
    configDir: resolve(configDir),
    now: services?.now ?? (() => new Date()),
    renameImpl: services?.renameImpl ?? rename,
  };
}

function diagnostic(context: CliContext, installed: string, release: ReleaseInfo): void {
  context.io.stdout.write(`Installed version: ${installed}\nLatest stable version: ${release.version} (${release.tag})\n`);
}

async function runUpdateInternal(context: CliContext, checkOnly: boolean, services?: UpdateServices): Promise<number> {
  const current = updateServices(services);
  const metadataPath = installMetadataPath(current.configDir);
  const channel = detectInstallChannel({ executablePath: current.executablePath, cwd: context.cwd, metadataPath });
  if (channel === "npm-global") {
    context.io.stdout.write("Global install detected. Run: npm update -g @absolutepraya/wt\n");
    return 0;
  }
  if (channel === "npm-local") {
    context.io.stdout.write("Local install detected. Run: npm update -D @absolutepraya/wt\n");
    return 0;
  }
  if (channel === "source") {
    context.io.stdout.write("Source checkout detected. Update the repository and rebuild wt instead.\n");
    return 0;
  }
  if (channel !== "standalone") throw new UpdateError("unable to determine how this wt installation is managed.");
  readMatchingStandaloneMetadata(current.configDir, current.executablePath);
  const release = await latestStableRelease(current.apiUrl, current.fetchImpl);
  diagnostic(context, VERSION, release);
  const installedVersion = parseStableVersion(VERSION);
  if (installedVersion) {
    const comparison = compareVersions(installedVersion, release.version);
    if (comparison >= 0) {
      context.io.stdout.write(comparison === 0 ? "wt is already up to date.\n" : "Installed wt is newer than the latest stable release.\n");
      return 0;
    }
  }
  if (checkOnly) {
    context.io.stdout.write("Update available. Run: wt update\n");
    return 0;
  }
  if (!existsSync(current.executablePath)) throw new UpdateError(`installed CLI not found at ${current.executablePath}.`);
  const payloadDirectory = await mkdtemp(join(tmpdir(), "wt-update-"));
  try {
    await downloadPayloads(release, current.fetchImpl, payloadDirectory);
    const checksums = parseChecksums(await readFile(join(payloadDirectory, "checksums.txt"), "utf8"));
    const installPayloads = new Map<string, Buffer>(await Promise.all(["wt", "wt.sh", "wt.fish"].map(async (name) => [name, await readFile(join(payloadDirectory, name))] as const)));
    verifyPayloads(installPayloads, checksums);
    validateCliPayload(installPayloads.get("wt")!, release.version);
    const metadata: InstallMetadata = {
      channel: "standalone",
      binary: current.executablePath,
      shell_wrapper: join(current.configDir, "wt.sh"),
      fish_wrapper: join(current.configDir, "wt.fish"),
      repository: "absolutepraya/wt",
      tag: release.tag,
      installed_at: current.now().toISOString(),
    };
    await transactionalReplace([
      { destination: current.executablePath, contents: installPayloads.get("wt")!, executable: true },
      { destination: join(current.configDir, "wt.sh"), contents: installPayloads.get("wt.sh")!, executable: false },
      { destination: join(current.configDir, "wt.fish"), contents: installPayloads.get("wt.fish")!, executable: false },
      { destination: metadataPath, contents: Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`), executable: false },
    ], current.renameImpl);
    context.io.stdout.write(`Updated wt from ${VERSION} to ${release.version}.\n`);
    return 0;
  } finally {
    await rm(payloadDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function runUpdate(context: CliContext, checkOnly: boolean, services?: UpdateServices): Promise<number> {
  try {
    return await runUpdateInternal(context, checkOnly, services);
  } catch (error) {
    if (error instanceof UpdateError) throw error;
    throw new UpdateError(`update failed: ${safeError(error)}.`);
  }
}
