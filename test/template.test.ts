import { test } from "node:test";
import assert from "node:assert/strict";
import { UsageError } from "../src/errors.js";
import { renderBranchTemplate } from "../src/template.js";

const values = { user: "abhip", name: "adelaide", slot: 3 };
test("renders the approved user name and slot placeholders", () => {
  assert.equal(renderBranchTemplate("{user}/{slot}-{name}", values), "abhip/3-adelaide");
});
test("rejects unknown malformed and invalid template branches before Git", () => {
  for (const template of ["{user}/{unknown}", "{user/{name}", "{user}/bad branch"]) assert.throws(() => renderBranchTemplate(template, values), UsageError);
});
