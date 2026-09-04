import { test } from "node:test";
import assert from "node:assert/strict";
import { ConfigurationError } from "../src/errors.js";

test("error messages remove C0 controls", () => { const error = new ConfigurationError("bad\u001b[31m\nvalue\u0007"); assert.equal(error.message, "bad [31m value"); assert.equal(error.code, "CONFIG_ERROR"); });
