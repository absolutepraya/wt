import { createHash } from "node:crypto";
import { createServer } from "node:http";

const scenario = process.env.WT_INSTALLER_FIXTURE ?? "ok";
const requests = [];
const tag = scenario === "newer" ? "v0.3.3" : "v0.3.2";
const version = tag.slice(1);
const releaseAssetNames = ["wt", "wt.sh", "wt.fish", "checksums.txt"];
const assets = new Map([
  ["wt", Buffer.from(scenario === "malformed" ? "#!/usr/bin/env python3\nconst VERSION = \"" + version + "\";\nconsole.log(VERSION);\n" : scenario === "smoke-failure" ? "#!/usr/bin/env node\nconst VERSION = \"" + version + "\";\nprocess.exit(17);\n" : "#!/usr/bin/env node\nconst VERSION = \"" + version + "\";\nconsole.log(VERSION);\n")],
  ["wt.sh", Buffer.from("wt() { command wt \"$@\"; }\n")],
  ["wt.fish", Buffer.from("function wt\n  command wt $argv\nend\n")],
]);
const hash = (value) => createHash("sha256").update(value).digest("hex");
let checksums = [...assets].map(([name, value]) => hash(value) + "  " + name).join("\n") + "\n";
if (scenario === "bad-checksum") checksums = "0".repeat(64) + "  wt\n" + [...assets].filter(([name]) => name !== "wt").map(([name, value]) => hash(value) + "  " + name).join("\n") + "\n";
assets.set("checksums.txt", Buffer.from(checksums));
const releaseAssets = () => releaseAssetNames.map((name) => ({ name, browser_download_url: "http://127.0.0.1:" + server.address().port + "/download/" + tag + "/" + name }));

const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", "http://fixture").pathname;
  requests.push(pathname);
  if (pathname === "/api/latest" || pathname === "/api/latest-final") {
    if (pathname === "/api/latest-final") { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ tag_name: tag, draft: false, prerelease: false, assets: releaseAssets() })); return; }
    if (scenario === "api-error") { response.writeHead(500); response.end("unavailable"); return; }
    if (scenario === "api-redirect-bad") { response.writeHead(302, { location: "http://evil.example/api/latest" }); response.end(); return; }
    if (scenario === "api-redirect-good") { response.writeHead(302, { location: "/api/latest-final" }); response.end(); return; }
    if (scenario === "malformed-api") { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ tag_name: "release-0.3.2", draft: false, prerelease: false, assets: [] })); return; }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ tag_name: tag, draft: false, prerelease: false, assets: scenario === "missing-api-assets" ? [] : releaseAssets() }));
    return;
  }
  if (pathname === "/requests") { response.setHeader("content-type", "application/json"); response.end(JSON.stringify(requests)); return; }
  if (pathname.startsWith("/github-production-release-asset/")) {
    const redirectedName = pathname.slice(pathname.lastIndexOf("/") + 1);
    const redirectedAsset = assets.get(redirectedName);
    if (!redirectedAsset) { response.writeHead(404); response.end("not found"); return; }
    response.setHeader("content-type", "application/octet-stream");
    response.end(redirectedAsset);
    return;
  }
  const prefix = "/download/" + tag + "/";
  if (!pathname.startsWith(prefix)) { response.writeHead(404); response.end("not found"); return; }
  const name = pathname.slice(prefix.length);
  if (scenario === "missing" && name === "wt.fish") { response.writeHead(404); response.end("missing"); return; }
  if (scenario === "redirect-loop" && name === "wt") { response.writeHead(302, { location: pathname }); response.end(); return; }
  if (scenario === "asset-redirect-bad" && name === "wt") { response.writeHead(302, { location: "http://evil.example/payload" }); response.end(); return; }
  if (scenario === "cdn") {
    const address = server.address();
    response.writeHead(302, { location: "http://127.0.0.1:" + address.port + "/github-production-release-asset/fixture/" + name + "?sig=fixture" });
    response.end();
    return;
  }
  const asset = assets.get(name);
  if (!asset) { response.writeHead(404); response.end("not found"); return; }
  response.setHeader("content-type", "application/octet-stream");
  response.end(asset);
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  process.stdout.write(JSON.stringify({ baseUrl: "http://127.0.0.1:" + address.port, tag }) + "\n");
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
