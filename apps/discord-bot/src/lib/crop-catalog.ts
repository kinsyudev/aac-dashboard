import type { db as appDb } from "@acme/db/client";

import {
  aliasesForItem,
  buildCropAliases,
  normalizeAlias,
} from "./crop-timers";
import type { CropAliasMap, CropTimerItem } from "./crop-timers";
import { findSeedItemsWithTimers } from "./timers";

export interface CropAutocompleteSuggestion {
  name: string;
  value: string;
}

interface CropCatalogEntry {
  item: CropTimerItem;
  aliases: string[];
  normalizedName: string;
}

export interface CropCatalog {
  aliases: CropAliasMap;
  entries: CropCatalogEntry[];
  allAliases: Map<string, CropTimerItem[]>;
  suggestionCache: Map<string, CropAutocompleteSuggestion[]>;
}

export interface CropCatalogItemMatch {
  kind: "match";
  item: CropTimerItem;
}

export interface CropCatalogItemAmbiguous {
  kind: "ambiguous";
  matches: CropTimerItem[];
}

export type CropCatalogItemResult =
  | CropCatalogItemMatch
  | CropCatalogItemAmbiguous
  | null;

let cropCatalogPromise: Promise<CropCatalog> | null = null;

export function buildCropCatalog(items: CropTimerItem[]): CropCatalog {
  const uniqueItems = Array.from(
    new Map(items.map((item) => [item.id, item] as const)).values(),
  ).sort((left, right) => left.name.localeCompare(right.name));

  const allAliases = new Map<string, CropTimerItem[]>();
  for (const item of uniqueItems) {
    for (const alias of aliasesForItem(item.name)) {
      const existing = allAliases.get(alias) ?? [];
      existing.push(item);
      allAliases.set(alias, existing);
    }
  }

  return {
    aliases: buildCropAliases(uniqueItems),
    allAliases,
    suggestionCache: new Map(),
    entries: uniqueItems.map((item) => ({
      item,
      aliases: aliasesForItem(item.name),
      normalizedName: normalizeAlias(item.name),
    })),
  };
}

export function setCropCatalogForTests(catalog: CropCatalog | null) {
  cropCatalogPromise = catalog == null ? null : Promise.resolve(catalog);
}

export function initializeCropCatalog(database: typeof appDb) {
  cropCatalogPromise ??= findSeedItemsWithTimers(database).then(buildCropCatalog);
  return cropCatalogPromise;
}

export async function getCropCatalog(database: typeof appDb) {
  return initializeCropCatalog(database);
}

export function resolveCatalogItem(
  catalog: CropCatalog,
  rawInput: string,
): CropCatalogItemResult {
  const matches = catalog.allAliases.get(normalizeAlias(rawInput)) ?? [];
  if (matches.length === 0) return null;
  if (matches.length === 1) {
    const [item] = matches;
    return item == null ? null : { kind: "match", item };
  }
  return { kind: "ambiguous", matches };
}

function levenshteinDistanceWithinLimit(
  left: string,
  right: string,
  limit: number,
) {
  const leftLength = left.length;
  const rightLength = right.length;
  if (Math.abs(leftLength - rightLength) > limit) return null;

  let previous = Array.from({ length: rightLength + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= leftLength; leftIndex += 1) {
    const current = [leftIndex];
    let rowMin = current[0] ?? leftIndex;

    for (let rightIndex = 1; rightIndex <= rightLength; rightIndex += 1) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      const value = Math.min(
        (previous[rightIndex] ?? rightIndex) + 1,
        (current[rightIndex - 1] ?? rightIndex) + 1,
        (previous[rightIndex - 1] ?? rightIndex - 1) + substitutionCost,
      );
      current.push(value);
      if (value < rowMin) rowMin = value;
    }

    if (rowMin > limit) return null;
    previous = current;
  }

  const distance = previous[rightLength];
  return distance != null && distance <= limit ? distance : null;
}

function scoreAlias(query: string, alias: string) {
  if (query.length === 0) return 100;
  if (alias === query) return 10_000;
  if (alias.startsWith(query)) return 9_000 - alias.length;
  if (alias.includes(query)) return 8_000 - alias.length;

  const queryTokens = query.split(" ").filter(Boolean);
  const aliasTokens = alias.split(" ").filter(Boolean);

  if (queryTokens.length > 0) {
    const tokenPrefixMatch = queryTokens.every((token) =>
      aliasTokens.some((aliasToken) => aliasToken.startsWith(token)),
    );
    if (tokenPrefixMatch) return 7_000 - alias.length;

    let totalDistance = 0;
    for (const token of queryTokens) {
      let bestDistance: number | null = null;
      for (const aliasToken of aliasTokens) {
        const limit = token.length <= 4 ? 1 : 2;
        const distance = levenshteinDistanceWithinLimit(token, aliasToken, limit);
        if (distance == null) continue;
        if (bestDistance == null || distance < bestDistance) {
          bestDistance = distance;
        }
      }

      if (bestDistance == null) return null;
      totalDistance += bestDistance;
    }

    return 6_000 - totalDistance * 100 - alias.length;
  }

  return null;
}

export function findCropSuggestions(
  catalog: CropCatalog,
  rawQuery: string,
  limit = 25,
): CropAutocompleteSuggestion[] {
  const query = normalizeAlias(rawQuery);
  const cached = catalog.suggestionCache.get(query);
  if (cached != null) {
    return cached.slice(0, limit);
  }

  const bestByItem = new Map<
    number,
    { score: number; suggestion: CropAutocompleteSuggestion }
  >();

  for (const entry of catalog.entries) {
    let bestScore: number | null = null;

    for (const alias of entry.aliases) {
      const score = scoreAlias(query, alias);
      if (score == null) continue;
      if (bestScore == null || score > bestScore) {
        bestScore = score;
      }
    }

    if (bestScore == null) continue;

    bestByItem.set(entry.item.id, {
      score: bestScore,
      suggestion: {
        name: entry.item.name,
        value: entry.item.name,
      },
    });
  }

  const suggestions = Array.from(bestByItem.values())
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.suggestion.name.localeCompare(right.suggestion.name);
    })
    .slice(0, limit)
    .map((entry) => entry.suggestion);

  catalog.suggestionCache.set(query, suggestions);
  return suggestions;
}
