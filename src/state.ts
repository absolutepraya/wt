import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { ConfigurationError } from "./errors.js";
import type { PersistedState, StateEntry } from "./types.js";

export class SlotsFullError extends ConfigurationError {
  constructor(maxSlots: number, used: number[]) { super(`No free slots (max_slots=${maxSlots}, used=${JSON.stringify(used)}).`); }
}

export function createEmptyState(projectRoot = ""): PersistedState { return { version: 1, project_root: projectRoot, slots: {} }; }
export const emptyState = createEmptyState;

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function validateEntry(value: unknown, slot: string): asserts value is StateEntry {
  if (!isRecord(value)) throw new ConfigurationError(`Invalid state entry for slot ${slot}.`);
  for (const key of ["name", "branch", "path", "base", "created_at"] as const) {
    if (typeof value[key] !== "string") throw new ConfigurationError(`Invalid state entry ${key} for slot ${slot}.`);
  }
  if (value.tracks_remote !== undefined && typeof value.tracks_remote !== "boolean") throw new ConfigurationError(`Invalid state entry tracks_remote for slot ${slot}.`);
  if (value.generation_token !== undefined && (typeof value.generation_token !== "string" || value.generation_token.length === 0 || value.generation_token.length > 256 || /[\u0000-\u001f\u007f-\u009f]/.test(value.generation_token))) throw new ConfigurationError(`Invalid state entry generation_token for slot ${slot}.`);
}

export function validateState(value: unknown): PersistedState {
  if (!isRecord(value) || value.version !== 1 || typeof value.project_root !== "string" || !isRecord(value.slots)) throw new ConfigurationError("Invalid state file.");
  for (const [slot, entry] of Object.entries(value.slots)) {
    if (!/^[1-9][0-9]*$/.test(slot)) throw new ConfigurationError(`Invalid state slot ${slot}.`);
    validateEntry(entry, slot);
  }
  return value as unknown as PersistedState;
}

export async function loadState(statePath: string): Promise<PersistedState> {
  try { return validateState(JSON.parse(await readFile(statePath, "utf8"))); }
  catch (error: unknown) {
    if (isMissing(error)) return createEmptyState();
    if (error instanceof ConfigurationError) throw error;
    throw new ConfigurationError(`Unable to read state file ${statePath}.`);
  }
}

function isMissing(error: unknown): boolean { return isRecord(error) && error.code === "ENOENT"; }

export interface StatePersistenceOptions { replace?: (temporaryPath: string, statePath: string) => Promise<void>; }

export async function saveState(statePath: string, state: PersistedState, options: StatePersistenceOptions = {}): Promise<void> {
  validateState(state);
  const directory = dirname(statePath);
  const temporaryPath = join(directory, `.${statePath.split(/[\\/]/).pop()!}.${randomUUID()}.tmp`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally { await handle.close(); }
    await chmod(temporaryPath, 0o600);
    await (options.replace ?? rename)(temporaryPath, statePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function cloneState(state: PersistedState): PersistedState {
  return { version: 1, project_root: state.project_root, slots: Object.fromEntries(Object.entries(state.slots).map(([slot, entry]) => [slot, { ...entry }])) };
}

export interface ReservedSlot { slot: number; state: PersistedState; }

export function reserveSlot(state: PersistedState, maxSlots: number, entry: StateEntry): ReservedSlot {
  validateState(state);
  if (!Number.isSafeInteger(maxSlots) || maxSlots < 1) throw new ConfigurationError("max_slots must be a positive integer.");
  validateEntry(entry, "new");
  const next = cloneState(state);
  const used = Object.keys(next.slots).map(Number).sort((a, b) => a - b);
  for (let slot = 1; slot <= maxSlots; slot += 1) {
    if (!(String(slot) in next.slots)) {
      next.slots[String(slot)] = { ...entry };
      return { slot, state: next };
    }
  }
  throw new SlotsFullError(maxSlots, used);
}

export function freeSlot(state: PersistedState, slot: number): PersistedState {
  validateState(state);
  if (!Number.isSafeInteger(slot) || slot < 1) throw new ConfigurationError("State slot must be a positive integer.");
  const next = cloneState(state);
  delete next.slots[String(slot)];
  return next;
}
