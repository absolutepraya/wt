import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const artifact = readFileSync("dist/wt.cjs", "utf8");
const version = packageJson.version;
const args = process.argv.slice(2);

const tagIndex = args.indexOf("--tag");
if (tagIndex !== -1) {
  const tag = args[tagIndex + 1];
  if (!tag || tag !== `v${version}`) {
    console.error(`version tag mismatch: expected v${version}`);
    process.exit(1);
  }
}

const embeddedVersion = JSON.stringify(version);
if (!artifact.includes(embeddedVersion)) {
  console.error(`generated artifact does not contain version ${version}`);
  process.exit(1);
}

if (args.includes("--print")) {
  console.log(version);
} else if (tagIndex === -1) {
  console.log(`version metadata is consistent: ${version}`);
}
