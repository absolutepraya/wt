import { UsageError } from "./errors.js";
import { sanitizeBranchName } from "./naming.js";

export interface BranchTemplateValues {
  user: string;
  name: string;
  slot: number;
}

const TOKEN = /\{([^{}]+)\}/g;

export function renderBranchTemplate(template: string, values: BranchTemplateValues): string {
  if (template.includes("{{") || template.includes("}}") || /[{}]/.test(template.replace(TOKEN, ""))) {
    throw new UsageError("branch_template contains malformed placeholders.");
  }
  const rendered = template.replace(TOKEN, (_match, token: string) => {
    if (token === "user") return values.user;
    if (token === "name") return values.name;
    if (token === "slot") return String(values.slot);
    throw new UsageError(`unknown branch_template placeholder: {${token}}`);
  });
  return sanitizeBranchName(rendered);
}
