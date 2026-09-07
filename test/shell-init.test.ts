import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { renderShellInit } from "../src/shell-init.js";

const SHELL_DIR = join(process.cwd(), "shell");
const POSIX_BASH_SKIP = process.platform === "win32" ? "Bash integration is POSIX-only; Windows uses PowerShell" : false;

function commandExists(command: string): boolean {
  return spawnSync("sh", ["-c", `command -v ${command}`], { encoding: "utf8" }).status === 0;
}

function fixture(): { bin: string; start: string; target: string } {
  const root = mkdtempSync(join(tmpdir(), "wt-shell-"));
  const bin = join(root, "bin");
  const start = join(root, "start");
  const target = join(root, "target with spaces");
  mkdirSync(bin);
  mkdirSync(start);
  mkdirSync(target);
  const executable = join(bin, "wt");
  writeFileSync(executable, `#!/bin/sh
case "\${1-}" in
  new|cd)
    printf '%s\\n' 'ordinary output'
    printf '%s\\n' '__cd__:relative-path'
    printf '%s\\n' '__cd__:${target}'
    printf '%s\\n' '__cd__:/later-valid-sentinel'
    ;;
  *) printf '%s\\n' 'ordinary passthrough' ;;
esac
`);
  chmodSync(executable, 0o755);
  return { bin, start, target };
}

function windowsMarkerFixture(): { bin: string; start: string; target: string } {
  const root = mkdtempSync(join(tmpdir(), "wt-shell-windows-marker-"));
  const bin = join(root, "bin");
  const start = join(root, "start");
  const candidate = "C:\\wt-target";
  const target = join(start, candidate);
  mkdirSync(bin);
  mkdirSync(start);
  mkdirSync(target);
  const executable = join(bin, "wt");
  writeFileSync(executable, `#!/bin/sh
printf '%s\\n' '__cd__:${candidate}'
`);
  chmodSync(executable, 0o755);
  return { bin, start, target };
}

function runBash(source: string, fixturePaths: ReturnType<typeof fixture>): ReturnType<typeof spawnSync> {
  return spawnSync("bash", ["-c", 'source "$1"; cd "$2"; wt cd; printf "PWD=%s\\n" "$PWD"', "bash", source, fixturePaths.start], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${fixturePaths.bin}:${process.env.PATH}` },
  });
}

test("Bash wrapper consumes only the first valid sentinel and preserves ordinary output", { skip: POSIX_BASH_SKIP }, () => {
  const paths = fixture();
  const result = runBash(join(SHELL_DIR, "wt.sh"), paths);
  assert.equal(result.status, 0, String(result.stderr));
  assert.equal(result.stdout, `ordinary output\n__cd__:relative-path\n__cd__:/later-valid-sentinel\nPWD=${paths.target}\n`);
});

test("generated Bash init requires explicit evaluation and supports paths with spaces", { skip: POSIX_BASH_SKIP }, () => {
  const paths = fixture();
  const init = join(mkdtempSync(join(tmpdir(), "wt-shell-init-")), "wt-init.sh");
  writeFileSync(init, renderShellInit("bash"));
  const inactive = spawnSync("bash", ["-c", 'bash "$1"; printf "PWD=%s\\n" "$PWD"', "bash", init], { encoding: "utf8", cwd: paths.start });
  assert.equal(inactive.status, 0, String(inactive.stderr));
  assert.equal(inactive.stdout, `PWD=${realpathSync(paths.start)}\n`);

  const active = spawnSync("bash", ["-c", 'eval "$(cat "$1")"; wt cd; printf "PWD=%s\\n" "$PWD"', "bash", init], {
    encoding: "utf8",
    cwd: paths.start,
    env: { ...process.env, PATH: `${paths.bin}:${process.env.PATH}` },
  });
  assert.equal(active.status, 0, String(active.stderr));
  assert.ok(String(active.stdout).includes(`PWD=${paths.target}\n`));
});

test("Bash wrappers consume Windows drive-rooted navigation sentinels", { skip: POSIX_BASH_SKIP }, () => {
  const paths = windowsMarkerFixture();
  for (const source of [join(SHELL_DIR, "wt.sh"), join(mkdtempSync(join(tmpdir(), "wt-shell-init-")), "wt-init.sh")]) {
    if (source.endsWith("wt-init.sh")) writeFileSync(source, renderShellInit("bash"));
    const result = runBash(source, paths);
    assert.equal(result.status, 0, String(result.stderr));
    assert.equal(result.stdout, `PWD=${paths.target}\n`);
  }
});

test("PowerShell navigation reports failed directory changes", () => {
  const generated = renderShellInit("powershell");
  const shipped = readFileSync(join(SHELL_DIR, "wt.ps1"), "utf8");
  for (const source of [generated, shipped]) {
    assert.match(source, /Set-Location -LiteralPath \$wtTarget -ErrorAction Stop/);
    assert.match(source, /catch/);
    assert.match(source, /\$global:LASTEXITCODE = 1/);
  }
});

test("generated shell init is syntax-valid on available shells and profile-free", () => {
  const bash = renderShellInit("bash");
  const bashFile = join(mkdtempSync(join(tmpdir(), "wt-shell-syntax-")), "wt-init.sh");
  writeFileSync(bashFile, bash);
  assert.equal(spawnSync("bash", ["-n", bashFile], { encoding: "utf8" }).status, 0);
  assert.equal(bash.includes(".bashrc"), false);
  assert.equal(bash.includes("PROFILE"), false);
  if (commandExists("zsh")) assert.equal(spawnSync("zsh", ["-n", bashFile], { encoding: "utf8" }).status, 0);
  if (commandExists("fish")) {
    const fishFile = join(mkdtempSync(join(tmpdir(), "wt-shell-syntax-")), "wt-init.fish");
    writeFileSync(fishFile, renderShellInit("fish"));
    assert.equal(spawnSync("fish", ["-n", fishFile], { encoding: "utf8" }).status, 0);
  }
  if (commandExists("pwsh")) {
    const psFile = join(mkdtempSync(join(tmpdir(), "wt-shell-syntax-")), "wt-init.ps1");
    writeFileSync(psFile, renderShellInit("powershell"));
    assert.equal(spawnSync("pwsh", ["-NoProfile", "-Command", "& { . $args[0]; 'loaded' }", psFile], { encoding: "utf8" }).status, 0);
  }
  assert.equal(existsSync(join(SHELL_DIR, "wt.ps1")), true);
});
