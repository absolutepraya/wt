import { randomBytes } from "node:crypto";
import { UsageError } from "./errors.js";
import type { NameStrategy } from "./types.js";

export const CITIES = [
  "adelaide", "amsterdam", "antwerp", "athens", "auckland", "bangkok", "barcelona", "beirut", "berlin", "bogota", "boston", "bratislava", "brisbane", "brussels", "bucharest", "budapest", "buenos-aires", "cairo", "cape-town", "casablanca", "chicago", "copenhagen", "dakar", "delhi", "denver", "doha", "dubai", "dublin", "edinburgh", "florence", "geneva", "hamburg", "hanoi", "havana", "helsinki", "hobart", "honolulu", "istanbul", "jakarta", "jerusalem", "johannesburg", "kelowna", "kiev", "kingston", "kuala-lumpur", "kyoto", "lagos", "lima", "lisbon", "ljubljana", "london", "los-angeles", "lyon", "madrid", "manila", "marrakech", "marseille", "melbourne", "mexico-city", "milan", "minsk", "montevideo", "montreal", "moscow", "mumbai", "munich", "nairobi", "naples", "newport-beach", "new-orleans", "nice", "osaka", "oslo", "ottawa", "panama-city", "paris", "perth", "porto", "prague", "quebec", "quito", "reykjavik", "riga", "rio", "rome", "rotterdam", "san-francisco", "san-juan", "santiago", "sao-paulo", "sarajevo", "seattle", "seoul", "seville", "shanghai", "singapore", "sofia", "stockholm", "strasbourg", "sydney", "taipei", "tallinn", "tokyo", "toronto", "tunis", "turin", "valencia", "vancouver", "venice", "vienna", "vilnius", "warsaw", "wellington", "winnipeg", "yokohama", "zagreb", "zurich",
] as const;

export const ADJECTIVES = [
  "amber", "ancient", "azure", "bold", "brave", "bright", "calm", "cedar", "clever", "cobalt", "copper", "coral", "cosmic", "crimson", "crystal", "dapper", "deep", "eager", "ember", "fair", "fancy", "fierce", "frosty", "gentle", "gilded", "golden", "grand", "hidden", "humble", "jade", "keen", "kind", "lively", "lucky", "lunar", "mellow", "merry", "mighty", "misty", "mystic", "noble", "olive", "opal", "pearl", "plucky", "polar", "proud", "quick", "quiet", "rapid", "regal", "ruby", "rustic", "sage", "scarlet", "secret", "shimmer", "silent", "silken", "silver", "smart", "smooth", "snowy", "solar", "sterling", "stout", "sturdy", "sunny", "swift", "tidy", "topaz", "vast", "vivid", "wandering", "warm", "wild", "wise", "woven", "young", "zealous",
] as const;

export const NOUNS = [
  "anchor", "arrow", "badger", "beacon", "blossom", "bramble", "breeze", "brook", "canyon", "cascade", "cedar", "cinder", "cliff", "comet", "cove", "crane", "crest", "delta", "echo", "ember", "fern", "field", "flame", "forest", "fox", "gale", "garnet", "glen", "grove", "harbor", "haven", "hawk", "heron", "horizon", "isle", "ivy", "jasper", "knoll", "lake", "lantern", "leaf", "lily", "lotus", "marsh", "meadow", "mesa", "mist", "moon", "moss", "mountain", "oak", "ocean", "orchid", "otter", "owl", "peak", "pine", "pond", "prairie", "raven", "reef", "ridge", "river", "rose", "salt", "sand", "shore", "spruce", "star", "stone", "stream", "summit", "sunrise", "thicket", "tide", "tiger", "tulip", "valley", "vine", "willow", "wolf", "wren",
] as const;

export interface NameGenerationOptions {
  random?: () => number;
  tokenHex?: () => string;
  maxTries?: number;
}

function pick<T>(values: readonly T[], random: () => number): T {
  return values[Math.floor(random() * values.length)]!;
}

export function generateName(strategy: NameStrategy, used: ReadonlySet<string>, options: NameGenerationOptions = {}): string {
  const random = options.random ?? Math.random;
  const maxTries = options.maxTries ?? 5;
  const make = strategy === "cities"
    ? () => pick(CITIES, random)
    : () => `${pick(ADJECTIVES, random)}-${pick(NOUNS, random)}`;

  for (let attempt = 0; attempt < maxTries; attempt += 1) {
    const candidate = make();
    if (!used.has(candidate)) return candidate;
  }
  if (strategy === "cities") {
    const candidate = CITIES.find((city) => !used.has(city));
    if (candidate) return candidate;
  }
  return `${make()}-${(options.tokenHex?.() ?? randomBytes(2).toString("hex")).slice(0, 4)}`;
}

export function resolveName(explicitName: string | undefined, strategy: NameStrategy, used: ReadonlySet<string>, options?: NameGenerationOptions): string {
  if (!explicitName) return generateName(strategy, used, options);
  if (!explicitName.trim() || explicitName === "." || explicitName === ".." || /[\\/\0]/.test(explicitName)) {
    throw new UsageError("worktree name must be a nonempty single path component.");
  }
  if (used.has(explicitName)) throw new UsageError(`worktree name ${JSON.stringify(explicitName)} is already in use.`);
  return explicitName;
}

/** Validate a Git branch before it reaches a Git subprocess. */
export function sanitizeBranchName(branch: string): string {
  if (!branch || branch.length > 1024 || /[\x00-\x20\x7f~^:?*\\[\]]/.test(branch) || branch.includes("..") || branch.includes("@{") || branch === "@" || branch.startsWith("/") || branch.endsWith("/") || branch.endsWith(".") || branch.includes("//") || branch.split("/").some((part) => !part || part.startsWith(".") || part.endsWith(".lock"))) {
    throw new UsageError(`invalid Git branch name: ${JSON.stringify(branch)}`);
  }
  return branch;
}
