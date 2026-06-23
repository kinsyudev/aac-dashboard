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
const EXPECTED_PACK_COUNT = 7998;

// Origin prefixes found in pack names that are not present as destination zones.
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

function describeRawRow(row, index) {
  if (row == null || typeof row !== "object" || Array.isArray(row)) {
    return `row ${index}`;
  }

  const name = typeof row.name_x === "string" ? row.name_x : "unknown name";
  const itemId = typeof row.item_id === "number" ? row.item_id : "unknown id";
  return `row ${index} (${itemId} ${name})`;
}

function assertNonEmptyString(value, fieldName, row, index) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      `Invalid pack_data.json ${describeRawRow(
        row,
        index,
      )}: ${fieldName} must be a non-empty string.`,
    );
  }

  return value;
}

function assertFiniteNumber(value, fieldName, row, index) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(
      `Invalid pack_data.json ${describeRawRow(
        row,
        index,
      )}: ${fieldName} must be a finite number.`,
    );
  }

  return value;
}

function assertIntegerNumber(value, fieldName, row, index) {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(
      `Invalid pack_data.json ${describeRawRow(
        row,
        index,
      )}: ${fieldName} must be an integer number.`,
    );
  }

  return value;
}

function assertNullableString(value, fieldName, row, index) {
  if (value !== null && typeof value !== "string") {
    throw new Error(
      `Invalid pack_data.json ${describeRawRow(
        row,
        index,
      )}: ${fieldName} must be null or a string.`,
    );
  }

  return value;
}

function normalizeRawRow(row, index) {
  if (row == null || typeof row !== "object" || Array.isArray(row)) {
    throw new Error(
      `Invalid pack_data.json row ${index}: row must be an object.`,
    );
  }

  return {
    name: assertNonEmptyString(row.name_x, "name_x", row, index),
    payout: assertFiniteNumber(row.payout, "payout", row, index),
    rewardItemName: assertNonEmptyString(
      row.reward_item_name,
      "reward_item_name",
      row,
      index,
    ),
    destination: assertNonEmptyString(row.zone, "zone", row, index),
    itemId: assertIntegerNumber(row.item_id, "item_id", row, index),
    filename: assertNullableString(row.filename, "filename", row, index),
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

if (packs.length !== EXPECTED_PACK_COUNT) {
  throw new Error(
    `Expected ${EXPECTED_PACK_COUNT} trade pack rows, found ${packs.length}.`,
  );
}

const output = {
  generatedAt: new Date().toISOString(),
  source: "pack_data.json",
  packs,
};

await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);

console.log(`Generated ${packs.length} trade pack rows.`);
console.log(`Output: ${path.relative(repoRoot, outputPath)}`);
