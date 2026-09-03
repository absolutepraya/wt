import { chmod, mkdir, readFile } from "node:fs/promises";
import { build } from "esbuild";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const output = "dist/wt.cjs";

await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  outfile: output,
  define: { WT_BUILD_VERSION: JSON.stringify(packageJson.version) },
  banner: { js: "#!/usr/bin/env node" },
  minify: false,
  sourcemap: false,
});
await chmod(output, 0o755);
