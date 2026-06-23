import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(repoRoot, "pack_data.json");
const outputPath = path.join(
  repoRoot,
  "apps/tanstack-start/src/data/trade-packs.generated.json",
);

const KNOWN_REWARDS = new Set([
  "Gold",
  "Charcoal Stabilizer",
  "Dragon Essence Stabilizer",
  "Gilda Star",
  "Lord's Pence",
]);

const LARDER_RE = /Aged Cheese|Aged Salve|Aged Honey/;
const FREE_PACK_ITEM_IDS = new Set([43323, 43324, 9000362, 9000414]);
const NON_ZONE_ORIGIN_PREFIXES = [
  "Ahnimar",
  "Airain",
  "Aubre Cradle",
  "Cinderstone",
  "Dewstone",
  "Falcorth",
  "Fish Food",
  "Gweonid",
  "Halcyona",
  "Haranyan",
  "Hasla",
  "Hellswamp",
  "Karkasse",
  "Lilyut",
  "Nuian",
  "Original Lilyut",
  "Perinoor",
  "Rokhala",
  "Rookborne",
  "Silent Forest",
  "Solis",
  "Solzreed",
  "Sunbite",
  "Sungold",
  "Tigerspine",
  "Whalesong",
  "White Arden",
  "Windscour",
];

function normalizeRawRow(row) {
  return {
    name: String(row.name_x),
    payout: Number(row.payout),
    rewardItemName: String(row.reward_item_name),
    destination: String(row.zone),
    itemId: Number(row.item_id),
    filename: row.filename == null ? null : String(row.filename),
  };
}

function deriveOrigin(name, zoneNames) {
  return zoneNames.find((zone) => name.startsWith(`${zone} `)) ?? null;
}

const raw = JSON.parse(await readFile(sourcePath, "utf8"));
if (!Array.isArray(raw)) {
  throw new Error("pack_data.json must contain a JSON array.");
}

const rows = raw.map(normalizeRawRow);
const zoneNames = [...new Set(rows.map((row) => row.destination))];
const originNames = [...new Set([...zoneNames, ...NON_ZONE_ORIGIN_PREFIXES])].sort(
  (a, b) => b.length - a.length || a.localeCompare(b),
);

const unknownRewards = new Set();
const unmatchedOrigins = [];
const sameOriginRows = [];

const packs = rows.map((row) => {
  if (!KNOWN_REWARDS.has(row.rewardItemName)) {
    unknownRewards.add(row.rewardItemName);
  }

  const origin = deriveOrigin(row.name, originNames);
  if (origin == null) {
    unmatchedOrigins.push(row);
  }
  if (origin === row.destination) {
    sameOriginRows.push(row);
  }

  return {
    ...row,
    origin,
    route: origin == null ? null : `${origin} -> ${row.destination}`,
    isLarder: LARDER_RE.test(row.name),
    isFreePack: FREE_PACK_ITEM_IDS.has(row.itemId),
  };
});

if (unknownRewards.size > 0) {
  throw new Error(
    `Unknown reward item names: ${[...unknownRewards].sort().join(", ")}`,
  );
}

if (unmatchedOrigins.length > 0) {
  const sample = unmatchedOrigins
    .slice(0, 20)
    .map((row) => `${row.itemId} ${row.name} -> ${row.destination}`)
    .join("\n");
  throw new Error(
    `Could not derive origins for ${unmatchedOrigins.length} rows:\n${sample}`,
  );
}

if (sameOriginRows.length > 0) {
  const sample = sameOriginRows
    .slice(0, 20)
    .map((row) => `${row.itemId} ${row.name} -> ${row.destination}`)
    .join("\n");
  throw new Error(`Found ${sameOriginRows.length} same-origin rows:\n${sample}`);
}

const output = {
  generatedAt: new Date().toISOString(),
  source: "pack_data.json",
  packs,
};

await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);

console.log(`Generated ${packs.length} trade pack rows.`);
console.log(`Output: ${path.relative(repoRoot, outputPath)}`);
