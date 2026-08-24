#!/usr/bin/env node

"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cliPath = path.resolve(__dirname, "..", "bin", "wt");
const cliArgs = process.argv.slice(2);
const pythonCheck =
  "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)";

function pythonCandidates() {
  if (process.platform === "win32") {
    return [
      ["py", ["-3"]],
      ["python", []],
      ["python3", []],
    ];
  }

  return [
    ["python3", []],
    ["python", []],
  ];
}

function findPython() {
  for (const [command, prefix] of pythonCandidates()) {
    const result = spawnSync(command, [...prefix, "-c", pythonCheck], {
      stdio: "ignore",
    });

    if (!result.error && result.status === 0) {
      return [command, prefix];
    }
  }

  return null;
}

const python = findPython();
if (!python) {
  console.error(
    "wt (npm): Python 3.11 or newer is required. Install Python 3.11+ and ensure it is on PATH. Git is also required.",
  );
  process.exit(1);
}

const [command, prefix] = python;
const result = spawnSync(command, [...prefix, cliPath, ...cliArgs], {
  stdio: "inherit",
});

if (result.error) {
  console.error(`wt (npm): failed to start Python: ${result.error.message}`);
  process.exit(1);
}

if (result.signal) {
  console.error(`wt (npm): Python exited after signal ${result.signal}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
