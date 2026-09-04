import { isAbsolute } from "node:path";
import { UsageError } from "./errors.js";

export type OutputFields = Record<string, string | number>;

export interface SectionOptions {
  width?: number;
  trailingDivider?: boolean;
}

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;

function assertSafeOutputText(value: string, context: string): void {
  if (CONTROL_CHARACTER.test(value)) {
    throw new UsageError(`${context} contains control characters.`);
  }
}

export function renderSection(title: string, fields: OutputFields = {}, options: SectionOptions | number = {}): string {
  assertSafeOutputText(title, "output title");
  for (const [key, value] of Object.entries(fields)) {
    assertSafeOutputText(key, "output label");
    assertSafeOutputText(String(value), `output value for ${JSON.stringify(key)}`);
  }
  const width = typeof options === "number" ? options : options.width ?? 80;
  const trailingDivider = typeof options === "number" ? true : options.trailingDivider ?? true;
  const divider = "═".repeat(Math.max(1, width));
  const keys = Object.keys(fields);
  const keyWidth = Math.max(0, ...keys.map((key) => key.length));
  const lines = [divider, title, ...keys.map((key) => `  ${key.padEnd(keyWidth)}  ${fields[key]}`)];
  if (trailingDivider) lines.push(divider);
  return lines.join("\n");
}

/** Normal navigation output followed by exactly one machine-consumed sentinel. */
export function renderCdOutput(path: string): string {
  assertSafeOutputText(path, "cd target");
  if (!isAbsolute(path)) throw new UsageError("cd target must be an absolute path.");
  return `${path}\n__cd__:${path}`;
}

export function writeOutput(stream: NodeJS.WritableStream, output: string): void {
  stream.write(`${output.endsWith("\n") ? output : `${output}\n`}`);
}
