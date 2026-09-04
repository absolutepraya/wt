import { mkdir, open, readdir, readFile, rename, rmdir, stat, unlink, utimes } from "node:fs/promises";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";

export type ProjectLockErrorCode = "LOCK_TIMEOUT" | "LOCK_STALE_OWNER" | "LOCK_OWNERSHIP";
export class ProjectLockError extends Error {
  readonly code: ProjectLockErrorCode;
  constructor(code: ProjectLockErrorCode, message: string, options?: ErrorOptions) { super(message, options); this.name = "ProjectLockError"; this.code = code; }
}

interface LockMetadata { pid: number; hostname: string; token: string; startedAt: string; }
interface LockSnapshot { ownerDirectory?: string; metadataPath?: string; metadataText?: string; metadata?: LockMetadata; modifiedAt: number; }
export interface ProjectLockTestHooks {
  beforeFirstAcquireAttempt?: () => Promise<void> | void;
  afterFirstAcquireContention?: () => Promise<void> | void;
  beforeMetadataWrite?: () => Promise<void> | void;
  beforeStaleCleanup?: () => Promise<void> | void;
  beforeEmptyLockReplacement?: () => Promise<void> | void;
  beforeOuterRmdir?: () => Promise<void> | void;
  afterRefreshRead?: () => Promise<void> | void;
  refreshIntervalMs?: number;
}
export interface ProjectLockOptions { timeoutMs?: number; testHooks?: ProjectLockTestHooks; }

const RETRY_MS = 100;
const STALE_MS = 60_000;
const REFRESH_MS = 10_000;
const OWNER_PREFIX = "owner-";
const METADATA_FILE = "metadata.json";

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isMissing(error: unknown): boolean { return isRecord(error) && error.code === "ENOENT"; }
function isOccupied(error: unknown): boolean { return isRecord(error) && (error.code === "EEXIST" || error.code === "ENOTEMPTY"); }
function isNotEmpty(error: unknown): boolean { return isRecord(error) && (error.code === "ENOTEMPTY" || error.code === "EEXIST"); }
function wait(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
function ownerDirectory(lockPath: string, token: string): string { return join(lockPath, `${OWNER_PREFIX}${token}`); }
function metadataPath(lockPath: string, token: string): string { return join(ownerDirectory(lockPath, token), METADATA_FILE); }
function candidateDirectory(lockPath: string, token: string): string { return join(dirname(lockPath), `.${basename(lockPath)}.${OWNER_PREFIX}${token}.tmp`); }

class LockContendedError extends Error {}

function parseMetadata(value: string): LockMetadata | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) return undefined;
    const { pid, hostname: ownerHostname, token, startedAt } = parsed;
    if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0 || typeof ownerHostname !== "string" || ownerHostname.length === 0 || typeof token !== "string" || token.length === 0 || typeof startedAt !== "string" || Number.isNaN(Date.parse(startedAt))) return undefined;
    return { pid, hostname: ownerHostname, token, startedAt };
  } catch { return undefined; }
}

function ownerIsDead(metadata: LockMetadata): boolean {
  if (metadata.hostname !== hostname()) return false;
  try { process.kill(metadata.pid, 0); return false; }
  catch (error: unknown) { return !isRecord(error) || error.code === "ESRCH"; }
}

async function inspectLock(lockPath: string): Promise<LockSnapshot | undefined> {
  let rootMtime: number;
  try {
    const root = await stat(lockPath);
    if (!root.isDirectory()) throw new ProjectLockError("LOCK_STALE_OWNER", `Project lock ${lockPath} is not a directory.`);
    rootMtime = root.mtimeMs;
  } catch (error) {
    if (isMissing(error)) return undefined;
    if (error instanceof ProjectLockError) throw error;
    throw new ProjectLockError("LOCK_STALE_OWNER", `Unable to inspect project lock ${lockPath}.`, { cause: error });
  }
  let owners: string[];
  try { owners = (await readdir(lockPath, { withFileTypes: true })).filter((entry) => entry.isDirectory() && entry.name.startsWith(OWNER_PREFIX)).map((entry) => entry.name); }
  catch (error) { throw new ProjectLockError("LOCK_STALE_OWNER", `Unable to inspect project lock ${lockPath}.`, { cause: error }); }
  if (owners.length !== 1) return { modifiedAt: rootMtime };
  const directory = owners[0];
  const path = join(lockPath, directory, METADATA_FILE);
  try {
    const [metadataText, metadataStat] = await Promise.all([readFile(path, "utf8"), stat(path)]);
    const metadata = parseMetadata(metadataText);
    if (metadata?.token !== directory.slice(OWNER_PREFIX.length)) return { ownerDirectory: directory, metadataPath: path, metadataText, modifiedAt: metadataStat.mtimeMs };
    return { ownerDirectory: directory, metadataPath: path, metadataText, metadata, modifiedAt: metadataStat.mtimeMs };
  } catch (error) {
    if (isMissing(error)) return { ownerDirectory: directory, modifiedAt: rootMtime };
    throw new ProjectLockError("LOCK_STALE_OWNER", `Unable to inspect project lock ${lockPath}.`, { cause: error });
  }
}

async function lockPathExists(lockPath: string): Promise<boolean> {
  try { await stat(lockPath); return true; }
  catch (error) {
    if (isMissing(error)) return false;
    throw new ProjectLockError("LOCK_STALE_OWNER", `Unable to inspect project lock ${lockPath}.`, { cause: error });
  }
}

async function cleanupCandidate(candidatePath: string, token: string): Promise<void> {
  await unlink(join(candidatePath, `${OWNER_PREFIX}${token}`, METADATA_FILE)).catch(() => undefined);
  await rmdir(join(candidatePath, `${OWNER_PREFIX}${token}`)).catch(() => undefined);
  await rmdir(candidatePath).catch(() => undefined);
}

async function prepareCandidate(lockPath: string, token: string, metadata: LockMetadata, hooks?: ProjectLockTestHooks): Promise<string> {
  const candidatePath = candidateDirectory(lockPath, token);
  let candidateCreated = false;
  try {
    await mkdir(candidatePath, { mode: 0o700 });
    candidateCreated = true;
    await mkdir(join(candidatePath, `${OWNER_PREFIX}${token}`), { mode: 0o700 });
    await hooks?.beforeMetadataWrite?.();
    const handle = await open(join(candidatePath, `${OWNER_PREFIX}${token}`, METADATA_FILE), "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(metadata)); await handle.sync(); }
    finally { await handle.close(); }
    return candidatePath;
  } catch (error) {
    if (candidateCreated) await cleanupCandidate(candidatePath, token);
    throw error;
  }
}

async function renameIsContention(lockPath: string, error: unknown): Promise<boolean> {
  if (isOccupied(error)) return true;
  if (!isRecord(error) || error.code !== "EPERM") return false;
  return lockPathExists(lockPath);
}

async function removeSnapshot(lockPath: string, snapshot: LockSnapshot): Promise<boolean> {
  if (snapshot.metadataPath && snapshot.metadataText !== undefined) {
    let current: string;
    try { current = await readFile(snapshot.metadataPath, "utf8"); }
    catch (error) { return isMissing(error); }
    if (current !== snapshot.metadataText) return false;
    try { await unlink(snapshot.metadataPath); }
    catch (error) { return isMissing(error); }
  } else if (snapshot.ownerDirectory) {
    try { await rmdir(join(lockPath, snapshot.ownerDirectory)); }
    catch (error) {
      if (isMissing(error)) return true;
      if (isNotEmpty(error)) return false;
      throw new ProjectLockError("LOCK_STALE_OWNER", `Unable to recover stale project lock ${lockPath}.`, { cause: error });
    }
  }
  if (snapshot.ownerDirectory) {
    try { await rmdir(join(lockPath, snapshot.ownerDirectory)); }
    catch (error) { if (!isMissing(error) && !isNotEmpty(error)) throw new ProjectLockError("LOCK_STALE_OWNER", `Unable to recover stale project lock ${lockPath}.`, { cause: error }); }
  }
  try { await rmdir(lockPath); return true; }
  catch (error) {
    if (isMissing(error) || isNotEmpty(error)) return false;
    throw new ProjectLockError("LOCK_STALE_OWNER", `Unable to recover stale project lock ${lockPath}.`, { cause: error });
  }
}

type StaleRecovery = "none" | "removed" | "acquired";

async function recoverStaleLock(lockPath: string, candidatePath: string, hooks?: ProjectLockTestHooks): Promise<StaleRecovery> {
  const snapshot = await inspectLock(lockPath);
  if (!snapshot) return "none";
  if (Date.now() - snapshot.modifiedAt <= STALE_MS) return "none";
  if (snapshot.metadata && !ownerIsDead(snapshot.metadata)) return "none";
  await hooks?.beforeStaleCleanup?.();
  if (!snapshot.ownerDirectory) {
    await hooks?.beforeEmptyLockReplacement?.();
    try {
      await rename(candidatePath, lockPath);
      return "acquired";
    } catch (error) {
      if (await renameIsContention(lockPath, error)) return "none";
      throw new ProjectLockError("LOCK_STALE_OWNER", `Unable to replace stale project lock ${lockPath}.`, { cause: error });
    }
  }
  return (await removeSnapshot(lockPath, snapshot)) ? "removed" : "none";
}

class HeldProjectLock {
  private timer: NodeJS.Timeout | undefined;
  private refreshes: Promise<void> = Promise.resolve();
  private readonly ownerDirectory: string;
  private readonly metadataPath: string;

  constructor(private readonly lockPath: string, private readonly token: string, private readonly hooks?: ProjectLockTestHooks) {
    this.ownerDirectory = ownerDirectory(lockPath, token);
    this.metadataPath = metadataPath(lockPath, token);
  }

  startRefreshing(): void {
    this.timer = setInterval(() => { this.refreshes = this.refreshes.then(() => this.refresh()); }, this.hooks?.refreshIntervalMs ?? REFRESH_MS);
    this.timer.unref();
  }

  private async refresh(): Promise<void> {
    try {
      const metadata = parseMetadata(await readFile(this.metadataPath, "utf8"));
      if (metadata?.token !== this.token) return;
      await this.hooks?.afterRefreshRead?.();
      await utimes(this.metadataPath, new Date(), new Date());
    } catch { /* Release waits for the refresh chain before removing the owner path. */ }
  }

  async release(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.refreshes;
    let metadata: LockMetadata | undefined;
    try { metadata = parseMetadata(await readFile(this.metadataPath, "utf8")); }
    catch (error) {
      if (isMissing(error)) throw new ProjectLockError("LOCK_OWNERSHIP", `Project lock ${this.lockPath} disappeared before release.`, { cause: error });
      throw new ProjectLockError("LOCK_OWNERSHIP", `Unable to verify project lock ${this.lockPath} during release.`, { cause: error });
    }
    if (metadata?.token !== this.token) throw new ProjectLockError("LOCK_OWNERSHIP", `Project lock ${this.lockPath} ownership changed before release.`);
    try { await unlink(this.metadataPath); await rmdir(this.ownerDirectory); }
    catch (error) { throw new ProjectLockError("LOCK_OWNERSHIP", `Unable to release project lock ${this.lockPath}.`, { cause: error }); }
    await this.hooks?.beforeOuterRmdir?.();
    try { await rmdir(this.lockPath); }
    catch (error) { if (!isMissing(error) && !isNotEmpty(error)) throw new ProjectLockError("LOCK_OWNERSHIP", `Unable to release project lock ${this.lockPath}.`, { cause: error }); }
  }
}

async function cleanupFailedAcquire(lockPath: string, token: string): Promise<void> {
  await cleanupCandidate(candidateDirectory(lockPath, token), token);
}

async function acquireProjectLock(lockPath: string, timeoutMs: number, hooks?: ProjectLockTestHooks): Promise<HeldProjectLock> {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new ProjectLockError("LOCK_TIMEOUT", "Project lock timeout must be non-negative.");
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + timeoutMs;
  let firstAttempt = true;
  let firstContention = true;
  while (true) {
    const token = randomUUID();
    let candidatePath: string | undefined;
    try {
      const metadata: LockMetadata = { pid: process.pid, hostname: hostname(), token, startedAt: new Date().toISOString() };
      if (firstAttempt) { firstAttempt = false; await hooks?.beforeFirstAcquireAttempt?.(); }
      candidatePath = await prepareCandidate(lockPath, token, metadata, hooks);
      if (await lockPathExists(lockPath)) throw new LockContendedError();
      try { await rename(candidatePath, lockPath); candidatePath = undefined; }
      catch (error) { if (await renameIsContention(lockPath, error)) throw new LockContendedError(); throw error; }
      const held = new HeldProjectLock(lockPath, token, hooks);
      held.startRefreshing();
      return held;
    } catch (error) {
      if (!(error instanceof LockContendedError)) {
        if (candidatePath) await cleanupFailedAcquire(lockPath, token);
        throw error;
      }
      if (firstContention) { firstContention = false; await hooks?.afterFirstAcquireContention?.(); }
      let recovery: StaleRecovery;
      try { recovery = await recoverStaleLock(lockPath, candidatePath!, hooks); }
      catch (recoveryError) {
        if (candidatePath) await cleanupFailedAcquire(lockPath, token);
        throw recoveryError;
      }
      if (recovery === "acquired") {
        candidatePath = undefined;
        const held = new HeldProjectLock(lockPath, token, hooks);
        held.startRefreshing();
        return held;
      }
      if (candidatePath) await cleanupFailedAcquire(lockPath, token);
      if (Date.now() >= deadline) throw new ProjectLockError("LOCK_TIMEOUT", `Timed out waiting for project lock ${lockPath}.`);
      await wait(RETRY_MS);
    }
  }
}

export async function withProjectLock<T>(lockPath: string, callback: () => Promise<T> | T, options: ProjectLockOptions = {}): Promise<T> {
  const lock = await acquireProjectLock(lockPath, options.timeoutMs ?? 30_000, options.testHooks);
  try { return await callback(); }
  finally { await lock.release(); }
}
