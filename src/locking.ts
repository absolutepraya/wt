import { mkdir, open, readFile, rm, stat, utimes } from "node:fs/promises";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

export type ProjectLockErrorCode = "LOCK_TIMEOUT" | "LOCK_STALE_OWNER" | "LOCK_OWNERSHIP";
export class ProjectLockError extends Error {
  readonly code: ProjectLockErrorCode;
  constructor(code: ProjectLockErrorCode, message: string, options?: ErrorOptions) { super(message, options); this.name = "ProjectLockError"; this.code = code; }
}

interface LockMetadata { pid: number; hostname: string; token: string; startedAt: string; }
export interface ProjectLockOptions { timeoutMs?: number; }

const RETRY_MS = 100;
const STALE_MS = 60_000;
const REFRESH_MS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function parseMetadata(value: string): LockMetadata | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) return undefined;
    const { pid, hostname: ownerHostname, token, startedAt } = parsed;
    if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0 || typeof ownerHostname !== "string" || ownerHostname.length === 0 || typeof token !== "string" || token.length === 0 || typeof startedAt !== "string" || Number.isNaN(Date.parse(startedAt))) return undefined;
    return { pid, hostname: ownerHostname, token, startedAt };
  } catch { return undefined; }
}
function isMissing(error: unknown): boolean { return isRecord(error) && error.code === "ENOENT"; }
function isExists(error: unknown): boolean { return isRecord(error) && error.code === "EEXIST"; }
function wait(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

function ownerIsDead(metadata: LockMetadata): boolean {
  if (metadata.hostname !== hostname()) return false;
  try { process.kill(metadata.pid, 0); return false; }
  catch (error: unknown) { return !isRecord(error) || error.code === "ESRCH"; }
}

async function removeStaleLock(lockPath: string): Promise<boolean> {
  let details: string;
  let modifiedAt: number;
  try {
    [details, { mtimeMs: modifiedAt }] = await Promise.all([readFile(lockPath, "utf8"), stat(lockPath)]);
  } catch (error) {
    if (isMissing(error)) return true;
    throw new ProjectLockError("LOCK_STALE_OWNER", `Unable to inspect project lock ${lockPath}.`, { cause: error });
  }
  if (Date.now() - modifiedAt <= STALE_MS) return false;
  const metadata = parseMetadata(details);
  if (metadata && !ownerIsDead(metadata)) return false;
  try { await rm(lockPath); return true; }
  catch (error) {
    if (isMissing(error)) return true;
    throw new ProjectLockError("LOCK_STALE_OWNER", `Unable to recover stale project lock ${lockPath}.`, { cause: error });
  }
}

class HeldProjectLock {
  private timer: NodeJS.Timeout | undefined;
  constructor(private readonly lockPath: string, private readonly token: string, private readonly handle: Awaited<ReturnType<typeof open>>) {}

  startRefreshing(): void {
    this.timer = setInterval(() => { void this.refresh(); }, REFRESH_MS);
    this.timer.unref();
  }

  private async refresh(): Promise<void> {
    try {
      const metadata = parseMetadata(await readFile(this.lockPath, "utf8"));
      if (metadata?.token === this.token) await utimes(this.lockPath, new Date(), new Date());
    } catch { /* Release verifies ownership and reports a replacement lock. */ }
  }

  async release(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.handle.close();
    let metadata: LockMetadata | undefined;
    try { metadata = parseMetadata(await readFile(this.lockPath, "utf8")); }
    catch (error) {
      if (isMissing(error)) throw new ProjectLockError("LOCK_OWNERSHIP", `Project lock ${this.lockPath} disappeared before release.`, { cause: error });
      throw new ProjectLockError("LOCK_OWNERSHIP", `Unable to verify project lock ${this.lockPath} during release.`, { cause: error });
    }
    if (metadata?.token !== this.token) throw new ProjectLockError("LOCK_OWNERSHIP", `Project lock ${this.lockPath} ownership changed before release.`);
    try { await rm(this.lockPath); }
    catch (error) { throw new ProjectLockError("LOCK_OWNERSHIP", `Unable to release project lock ${this.lockPath}.`, { cause: error }); }
  }
}

async function acquireProjectLock(lockPath: string, timeoutMs: number): Promise<HeldProjectLock> {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new ProjectLockError("LOCK_TIMEOUT", "Project lock timeout must be non-negative.");
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const token = randomUUID();
    const metadata: LockMetadata = { pid: process.pid, hostname: hostname(), token, startedAt: new Date().toISOString() };
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try { await handle.writeFile(JSON.stringify(metadata)); await handle.sync(); }
      catch (error) { await handle.close(); await rm(lockPath, { force: true }).catch(() => undefined); throw error; }
      const held = new HeldProjectLock(lockPath, token, handle);
      held.startRefreshing();
      return held;
    } catch (error) {
      if (!isExists(error)) throw error;
      await removeStaleLock(lockPath);
      if (Date.now() >= deadline) throw new ProjectLockError("LOCK_TIMEOUT", `Timed out waiting for project lock ${lockPath}.`);
      await wait(RETRY_MS);
    }
  }
}

export async function withProjectLock<T>(lockPath: string, callback: () => Promise<T> | T, options: ProjectLockOptions = {}): Promise<T> {
  const lock = await acquireProjectLock(lockPath, options.timeoutMs ?? 30_000);
  try { return await callback(); }
  finally { await lock.release(); }
}
