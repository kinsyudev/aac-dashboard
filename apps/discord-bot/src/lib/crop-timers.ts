import { parseDurationSeconds } from "./duration";

export interface CropTimerItem {
  id: number;
  name: string;
  description: string | null;
}

export interface CropAliasMatch {
  kind: "match";
  item: CropTimerItem;
  growthSeconds: number;
}

export interface CropAliasAmbiguous {
  kind: "ambiguous";
  matches: CropAliasMatch[];
}

export type CropAliasResult = CropAliasMatch | CropAliasAmbiguous | null;

export type CropAliasMap = Map<string, CropAliasMatch[]>;

export function stripArcheAgeMarkup(input: string) {
  return input
    .replaceAll(/\|c[0-9A-Fa-f]{8}/g, "")
    .replaceAll("|r", "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

export function parseGrowthTimerSeconds(description: string | null) {
  if (!description) return null;

  const clean = stripArcheAgeMarkup(description);
  const match = clean.match(/Matures in approx\.\s+((?:\d+\s*[dhms]\s*)+)/i);
  if (!match?.[1]) return null;

  return parseDurationSeconds(match[1]);
}

function normalizeAlias(input: string) {
  return input.trim().toLowerCase().replaceAll(/\s+/g, " ");
}

function cropBaseName(name: string) {
  return name
    .replace(/\s+Seed Bundle$/i, "")
    .replace(/\s+Seed$/i, "")
    .replace(/\s+Greenhouse$/i, "")
    .trim();
}

function aliasesForItem(name: string) {
  const normalizedName = normalizeAlias(name);
  const base = normalizeAlias(cropBaseName(name));
  const aliases = new Set<string>([normalizedName]);

  if (/ Seed$/i.test(name)) {
    aliases.add(base);
    aliases.add(`${base} seed`);
  }

  if (/ Seed Bundle$/i.test(name)) {
    aliases.add(`${base} bundle`);
    aliases.add(`${base} seed bundle`);
  }

  if (/ Greenhouse$/i.test(name)) {
    aliases.add(`${base} greenhouse`);
  }

  return Array.from(aliases);
}

export function buildCropAliases(items: CropTimerItem[]) {
  const aliases: CropAliasMap = new Map();

  for (const item of items) {
    const growthSeconds = parseGrowthTimerSeconds(item.description);
    if (growthSeconds == null) continue;

    for (const alias of aliasesForItem(item.name)) {
      const existing = aliases.get(alias) ?? [];
      existing.push({ kind: "match", item, growthSeconds });
      aliases.set(alias, existing);
    }
  }

  return aliases;
}

export function resolveCropAlias(
  aliases: CropAliasMap,
  rawInput: string,
): CropAliasResult {
  const matches = aliases.get(normalizeAlias(rawInput)) ?? [];
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0] ?? null;
  return { kind: "ambiguous", matches };
}
