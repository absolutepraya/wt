import { UpdateError } from "../errors.js";
import type { CliContext } from "../types.js";

export { runNew, type NewOptions } from "./new.js";
export { runLs } from "./ls.js";
export { runCd } from "./cd.js";
export { runRm, type RemoveOptions } from "./rm.js";

/** Task 7 owns channel-aware update behavior and will replace this typed stub. */
export async function runUpdate(_context: CliContext, _check: boolean): Promise<number> {
  throw new UpdateError("update is not available in this build.");
}
