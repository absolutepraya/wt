import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    assert.match(result.stdout, /Immediate use:.*prefix\/bin\/wt --version/);
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
