import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const repository = process.cwd();
const installer = join(repository, "install.sh");

interface Server {
  baseUrl: string;
  stop(): Promise<void>;
}

async function startServer(scenario = "ok"): Promise<Server> {
  const child = spawn(process.execPath, ["scripts/installer-test-server.mjs"], {
    cwd: repository,
    env: { ...process.env, WT_INSTALLER_FIXTURE: scenario },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const [chunk] = await once(child.stdout!, "data");
  const { baseUrl } = JSON.parse(String(chunk)) as { baseUrl: string };
  return {
    baseUrl,
    async stop() {
      child.kill("SIGTERM");
      await once(child, "exit");
    },
  };
}

function temporaryRoot(): string {
  return mkdtempSync(join(tmpdir(), "wt-installer-test-"));
}

function bootstrap(root: string): string {
  const path = join(root, "bootstrap.sh");
  copyFileSync(installer, path);
  return path;
}

function invoke(script: string, root: string, baseUrl: string, extra: NodeJS.ProcessEnv = {}) {
  const prefix = join(root, "prefix");
  const config = join(root, "config");
  return spawnSync("bash", [script], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: join(root, "home"),
      XDG_CONFIG_HOME: join(root, "xdg"),
      PREFIX: prefix,
      WT_CONFIG_DIR: config,
      WT_RELEASE_API_URL: baseUrl + "/api/latest",
      WT_RELEASE_DOWNLOAD_BASE_URL: baseUrl + "/download",
      ...extra,
    },
  });
}

function remove(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

test("installer resolves one exact tag, honors overrides, and records a standalone installation", async () => {
  const root = temporaryRoot(), server = await startServer();
  try {
    const result = invoke(bootstrap(root), root, server.baseUrl);
    assert.equal(result.status, 0, result.stderr);
    const binary = join(root, "prefix", "bin", "wt");
    assert.equal(spawnSync(binary, ["--version"], { encoding: "utf8" }).stdout.trim(), "0.3.2");
    const metadata = JSON.parse(readFileSync(join(root, "config", "install.json"), "utf8"));
    assert.deepEqual({ channel: metadata.channel, repository: metadata.repository, tag: metadata.tag }, { channel: "standalone", repository: "absolutepraya/wt", tag: "v0.3.2" });
    const requests = await (await fetch(server.baseUrl + "/requests")).json() as string[];
    assert.deepEqual(requests.filter((path) => path.startsWith("/download/")), ["/download/v0.3.2/wt", "/download/v0.3.2/wt.sh", "/download/v0.3.2/wt.fish", "/download/v0.3.2/checksums.txt"]);
    assert.match(result.stdout, /Immediate use:\s+'[^'\n]*prefix\/bin\/wt' --version/);
    assert.match(result.stdout, /Current shell cd:.*shell-init bash/);
    assert.match(result.stdout, /shell-init fish \| source/);
    assert.match(result.stdout, /PowerShell:.*shell-init powershell.*never edits it/);
  } finally {
    await server.stop();
    remove(root);
  }
});

test("installer preflight and failed remote validations create no final files", async () => {
  const root = temporaryRoot(), server = await startServer("bad-checksum");
  try {
    const result = invoke(bootstrap(root), root, server.baseUrl);
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(join(root, "prefix", "bin", "wt")), false);
    assert.equal(existsSync(join(root, "config", "install.json")), false);
    const missingNode = invoke(bootstrap(root), root, server.baseUrl, { PATH: "/usr/bin:/bin" });
    assert.notEqual(missingNode.status, 0);
    assert.match(missingNode.stderr, /Node\.js 18 or newer is required/);
  } finally {
    await server.stop();
    remove(root);
  }
});

test("installer rejects arbitrary direct release origins before downloading", async () => {
  const root = temporaryRoot(), server = await startServer();
  try {
    const result = invoke(bootstrap(root), root, server.baseUrl, { WT_RELEASE_API_URL: "https://evil.example/repos/absolutepraya/wt/releases/latest" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /approved GitHub endpoint or loopback fixture/);
    assert.equal(existsSync(join(root, "prefix", "bin", "wt")), false);
    const requests = await (await fetch(server.baseUrl + "/requests")).json() as string[];
    assert.deepEqual(requests.filter((path) => path !== "/requests"), []);
  } finally {
    await server.stop();
    remove(root);
  }
});

test("installer preserves existing final files on API, missing asset, and malformed payload failures", async () => {
  for (const scenario of ["api-error", "missing", "malformed"]) {
    const root = temporaryRoot(), server = await startServer(scenario);
    try {
      const prefix = join(root, "prefix", "bin"), config = join(root, "config");
      mkdirSync(prefix, { recursive: true }); mkdirSync(config, { recursive: true });
      writeFileSync(join(prefix, "wt"), "old binary\n");
      writeFileSync(join(config, "wt.sh"), "old shell\n");
      writeFileSync(join(config, "wt.fish"), "old fish\n");
      writeFileSync(join(config, "install.json"), "old metadata\n");
      const result = invoke(bootstrap(root), root, server.baseUrl);
      assert.notEqual(result.status, 0, scenario);
      assert.equal(readFileSync(join(prefix, "wt"), "utf8"), "old binary\n");
      assert.equal(readFileSync(join(config, "wt.sh"), "utf8"), "old shell\n");
      assert.equal(readFileSync(join(config, "wt.fish"), "utf8"), "old fish\n");
      assert.equal(readFileSync(join(config, "install.json"), "utf8"), "old metadata\n");
    } finally {
      await server.stop();
      remove(root);
    }
  }
});

test("installer propagates a later replacement failure and restores the complete prior installation", async () => {
  const root = temporaryRoot(), server = await startServer();
  try {
    const prefix = join(root, "prefix", "bin"), config = join(root, "config"), shim = join(root, "shim");
    mkdirSync(prefix, { recursive: true }); mkdirSync(config, { recursive: true }); mkdirSync(shim, { recursive: true });
    for (const [path, value] of [[join(prefix, "wt"), "old binary\n"], [join(config, "wt.sh"), "old shell\n"], [join(config, "wt.fish"), "old fish\n"], [join(config, "install.json"), "old metadata\n"]] as const) writeFileSync(path, value);
    const mv = join(shim, "mv");
    writeFileSync(mv, "#!/usr/bin/env bash\ncase \"$1\" in\n  *.wt-stage.wt.fish.*) exit 73 ;;;\n  *) exec /bin/mv \"$@\" ;;;\nesac\n");
    chmodSync(mv, 0o755);
    const result = invoke(bootstrap(root), root, server.baseUrl, { PATH: shim + ":" + process.env.PATH, PREFIX: join(root, "prefix"), WT_CONFIG_DIR: config });
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(join(prefix, "wt"), "utf8"), "old binary\n");
    assert.equal(readFileSync(join(config, "wt.sh"), "utf8"), "old shell\n");
    assert.equal(readFileSync(join(config, "wt.fish"), "utf8"), "old fish\n");
    assert.equal(readFileSync(join(config, "install.json"), "utf8"), "old metadata\n");
    assert.match(result.stderr, /atomically/);
  } finally {
    await server.stop();
    remove(root);
  }
});

test("installer rejects malicious API and asset redirects, accepts the constrained CDN fixture, and enforces the redirect limit", async () => {
  for (const scenario of ["api-redirect-bad", "asset-redirect-bad", "redirect-loop"]) {
    const root = temporaryRoot(), server = await startServer(scenario);
    try {
      const result = invoke(bootstrap(root), root, server.baseUrl);
      assert.notEqual(result.status, 0, scenario);
      assert.equal(existsSync(join(root, "prefix", "bin", "wt")), false);
    } finally {
      await server.stop();
      remove(root);
    }
  }
  const root = temporaryRoot(), server = await startServer("cdn");
  try {
    const result = invoke(bootstrap(root), root, server.baseUrl);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(spawnSync(join(root, "prefix", "bin", "wt"), ["--version"], { encoding: "utf8" }).stdout.trim(), "0.3.2");
  } finally {
    await server.stop();
    remove(root);
  }
});

test("installer smoke-tests the installed executable and preserves files when startup fails", async () => {
  const root = temporaryRoot(), server = await startServer("smoke-failure");
  try {
    const result = invoke(bootstrap(root), root, server.baseUrl);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /version\/help smoke/);
    assert.equal(existsSync(join(root, "prefix", "bin", "wt")), false);
    assert.equal(existsSync(join(root, "config", "install.json")), false);
  } finally {
    await server.stop();
    remove(root);
  }
});

test("installer supports newer exact-tag fixtures and idempotent shell profile blocks", async () => {
  const root = temporaryRoot(), server = await startServer("newer");
  try {
    const script = bootstrap(root);
    assert.equal(invoke(script, root, server.baseUrl).status, 0);
    assert.equal(invoke(script, root, server.baseUrl).status, 0);
    for (const profile of [join(root, "home", ".bashrc"), join(root, "home", ".zshrc"), join(root, "xdg", "fish", "conf.d", "wt.fish")]) {
      assert.equal((readFileSync(profile, "utf8").match(/# wt-managed: BEGIN/g) ?? []).length, 1);
    }
    assert.equal(JSON.parse(readFileSync(join(root, "config", "install.json"), "utf8")).tag, "v0.3.3");
  } finally {
    await server.stop();
    remove(root);
  }
});

test("installer isolates profile staging from a predictable symlink collision", async () => {
  const root = temporaryRoot(), server = await startServer();
  try {
    const home = join(root, "home"), shim = join(root, "shim"), profile = join(home, ".bashrc"), sentinel = join(root, "profile-sentinel"), collisionPath = join(root, "collision-path");
    mkdirSync(home, { recursive: true }); mkdirSync(shim, { recursive: true });
    writeFileSync(sentinel, "keep this file\n");
    const nodeShim = join(shim, "node");
    writeFileSync(nodeShim, `#!/usr/bin/env bash
if [[ "$1" == "-" && "$2" == "$WT_COLLISION_PROFILE" ]]; then
  collision_path="$(dirname "$2")/.$(basename "$2").wt-managed-$$"
  ln -s "$WT_COLLISION_TARGET" "$collision_path"
  printf '%s' "$collision_path" > "$WT_COLLISION_PATH_FILE"
fi
exec "${process.execPath}" "$@"
`);
    chmodSync(nodeShim, 0o755);
    const result = invoke(bootstrap(root), root, server.baseUrl, {
      HOME: home,
      PATH: shim + ":" + process.env.PATH,
      WT_COLLISION_PROFILE: profile,
      WT_COLLISION_TARGET: sentinel,
      WT_COLLISION_PATH_FILE: collisionPath,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(sentinel, "utf8"), "keep this file\n");
    assert.equal(lstatSync(readFileSync(collisionPath, "utf8")).isSymbolicLink(), true);
    assert.match(readFileSync(profile, "utf8"), /# wt-managed: BEGIN/);
  } finally {
    await server.stop();
    remove(root);
  }
});

test("installer preserves malformed profile content and escapes hostile installation paths", async () => {
  const root = temporaryRoot(), server = await startServer();
  try {
    const home = join(root, "home");
    mkdirSync(home, { recursive: true });
    const originalBash = "before\n# wt-managed: BEGIN\nuser content must remain\n";
    writeFileSync(join(home, ".bashrc"), originalBash);
    const sentinel = join(root, "sentinel");
    const hostileConfig = join(root, "config with ' quote \\ slash $(touch " + sentinel + ") spaces");
    const hostilePrefix = join(root, "prefix \" double \\ slash $(touch " + sentinel + "-prefix) spaces");
    const result = invoke(bootstrap(root), root, server.baseUrl, { HOME: home, PREFIX: hostilePrefix, WT_CONFIG_DIR: hostileConfig });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(home, ".bashrc"), "utf8"), originalBash);
    const zsh = readFileSync(join(home, ".zshrc"), "utf8");
    assert.equal(spawnSync("zsh", ["-n", join(home, ".zshrc")]).status, 0);
    assert.match(zsh, /source '/);
    assert.match(result.stdout, /Immediate use:\s+'[^\n]*\$\(touch/);
    assert.match(result.stdout, /PATH:\s+add '[^\n]*\$\(touch/);
    assert.match(result.stdout, /Future Fish:\s+managed wrapper block was added to '[^\n]*'/);
    assert.equal(existsSync(sentinel), false);
    assert.equal(existsSync(sentinel + "-prefix"), false);
  } finally {
    await server.stop();
    remove(root);
  }
});

test("local source installation uses dist and reports the exact missing-dist diagnostic", () => {
  const root = temporaryRoot();
  try {
    const local = spawnSync("bash", [installer], {
      cwd: repository,
      encoding: "utf8",
      env: { ...process.env, HOME: join(root, "home"), XDG_CONFIG_HOME: join(root, "xdg"), PREFIX: join(root, "prefix"), WT_CONFIG_DIR: join(root, "config") },
    });
    assert.equal(local.status, 0, local.stderr);
    assert.equal(JSON.parse(readFileSync(join(root, "config", "install.json"), "utf8")).tag, "v0.3.1");

    const incomplete = join(root, "source");
    mkdirSync(incomplete, { recursive: true });
    copyFileSync(installer, join(incomplete, "install.sh"));
    writeFileSync(join(incomplete, "package.json"), "{}\n");
    const missing = spawnSync("bash", ["install.sh"], { cwd: incomplete, encoding: "utf8", env: { ...process.env, HOME: join(root, "other-home") } });
    assert.notEqual(missing.status, 0);
    assert.equal(missing.stderr.trim(), "wt installer: dist/wt.cjs is missing; run npm ci && npm run build first.");
  } finally {
    remove(root);
  }
});
