import { isAbsolute } from "node:path";
import { UsageError } from "./errors.js";

export type OutputFields = Record<string, string | number>;

export function renderSection(title: string, fields: OutputFields = {}, width = 80): string {
  const divider = "═".repeat(Math.max(1, width));
  const keys = Object.keys(fields);
  const keyWidth = Math.max(0, ...keys.map((key) => key.length));
  const lines = [divider, title, ...keys.map((key) => `  ${key.padEnd(keyWidth)}  ${fields[key]}`), divider];
  return lines.join("\n");
}

/** Normal navigation output followed by exactly one machine-consumed sentinel. */
export function renderCdOutput(path: string): string {
  if (!isAbsolute(path)) throw new UsageError("cd target must be an absolute path.");
  return `${path}\n__cd__:${path}`;
}

export function writeOutput(stream: NodeJS.WritableStream, output: string): void {
  stream.write(`${output.endsWith("\n") ? output : `${output}\n`}`);
}
