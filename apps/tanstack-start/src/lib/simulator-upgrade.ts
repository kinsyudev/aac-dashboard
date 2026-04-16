import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { pickCheapestCraft } from "~/lib/craft-helpers";
import { useTRPC } from "~/lib/trpc";

export type CraftMode = "buy" | "craft";

export interface PriceEntry {
  avg24h: string | null;
  avg7d: string | null;
}

export type PriceMap = Map<number, PriceEntry>;
export type OverrideMap = Map<number, number>;

export interface CraftMaterial {
  item: { id: number; name: string };
  amount: number;
}

export interface CraftProduct {
  item: { id: number };
  amount: number;
}

export interface CraftInfo {
  id: number;
  name: string;
  labor: number;
  proficiency: string | null;
}

export interface CraftEntryLike {
  craft: CraftInfo;
  materials: CraftMaterial[];
  products: CraftProduct[];
}

export type SubcraftMap<T extends CraftEntryLike> = Record<number, T[]>;

export interface SimulationChain {
  keyMaterialId: number | null;
  keyMaterialName: string | null;
  upgradeMaterials: CraftMaterial[];
}

export function parseFinitePrice(
  value: string | null | undefined,
): number | null {
  if (value == null) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getMarketPrice(price: PriceEntry | null | undefined): number {
  return parseFinitePrice(price?.avg24h) ?? parseFinitePrice(price?.avg7d) ?? 0;
}

export function getItemPrice(
  itemId: number,
  priceMap: PriceMap,
  overrideMap: OverrideMap,
): number {
  const custom = overrideMap.get(itemId);
  if (custom != null) return custom;
  return getMarketPrice(priceMap.get(itemId));
}

export function getMatchingAyanadName(name: string): string | null {
  if (!name.toLowerCase().includes("sealed delphinad")) return null;
  return name.replace(/delphinad/i, "Ayanad");
}

export function getSimulationChain<T extends CraftEntryLike>(
  mainCraft: T,
  subcraftMap: SubcraftMap<T>,
): SimulationChain {
  const tierList = [
    "illustrious",
    "magnificent",
    "epherium",
    "delphinad",
    "ayanad",
  ] as const;

  let keyMaterialId: number | null = null;
  let keyMaterialName: string | null = null;

  for (const material of mainCraft.materials) {
    const lowerName = material.item.name.toLowerCase();
    if (tierList.some((tier) => lowerName.includes(tier))) {
      keyMaterialId = material.item.id;
      keyMaterialName = material.item.name;
      break;
    }
  }

  if (keyMaterialId == null) {
    for (const material of mainCraft.materials) {
      if (subcraftMap[material.item.id]?.length) {
        keyMaterialId = material.item.id;
        keyMaterialName = material.item.name;
        break;
      }
    }
  }

  return {
    keyMaterialId,
    keyMaterialName,
    upgradeMaterials: mainCraft.materials.filter(
      ({ item }) => item.id !== keyMaterialId,
    ),
  };
}

export function getCraftEntryUnitCost<T extends CraftEntryLike>(
  entry: T,
  itemId: number,
  subcraftMap: SubcraftMap<T>,
  priceMap: PriceMap,
  overrideMap: OverrideMap,
  modes: Record<number, CraftMode> = {},
  visited = new Set<number>(),
): number {
  const produced =
    entry.products.find((product) => product.item.id === itemId)?.amount ?? 1;

  const batchCost = entry.materials.reduce((sum, { item, amount }) => {
    const subEntries = subcraftMap[item.id];
    const mode = modes[item.id] ?? "craft";
    const unitCost =
      subEntries?.length && mode === "craft" && !visited.has(item.id)
        ? deepCraftCost(
            item.id,
            subcraftMap,
            priceMap,
            overrideMap,
            modes,
            new Set([...visited, itemId]),
          )
        : getItemPrice(item.id, priceMap, overrideMap);

    return sum + unitCost * amount;
  }, 0);

  return batchCost / produced;
}

export function deepCraftCost<T extends CraftEntryLike>(
  itemId: number,
  subcraftMap: SubcraftMap<T>,
  priceMap: PriceMap,
  overrideMap: OverrideMap,
  modes: Record<number, CraftMode> = {},
  visited = new Set<number>(),
): number {
  if (visited.has(itemId)) return getItemPrice(itemId, priceMap, overrideMap);
  visited.add(itemId);

  const entries = subcraftMap[itemId];
  if (!entries?.length) return getItemPrice(itemId, priceMap, overrideMap);

  const entry = pickCheapestCraft(entries, itemId, (candidate, productItemId) =>
    getCraftEntryUnitCost(
      candidate,
      productItemId,
      subcraftMap,
      priceMap,
      overrideMap,
      modes,
      new Set(visited),
    ),
  );

  return getCraftEntryUnitCost(
    entry,
    itemId,
    subcraftMap,
    priceMap,
    overrideMap,
    modes,
    new Set(visited),
  );
}

export function pickCheapestCraftForItem<T extends CraftEntryLike>(
  entries: T[],
  itemId: number,
  subcraftMap: SubcraftMap<T>,
  priceMap: PriceMap,
  overrideMap: OverrideMap,
  modes: Record<number, CraftMode> = {},
): T {
  return pickCheapestCraft(entries, itemId, (entry, productItemId) =>
    getCraftEntryUnitCost(
      entry,
      productItemId,
      subcraftMap,
      priceMap,
      overrideMap,
      modes,
    ),
  );
}

export function useAyanadUpgradeData(itemName: string | null) {
  const trpc = useTRPC();
  const ayanadItemName = useMemo(
    () => (itemName ? getMatchingAyanadName(itemName) : null),
    [itemName],
  );
  const ayanadItemQuery = useQuery({
    ...trpc.items.byName.queryOptions(ayanadItemName ?? ""),
    enabled: !!ayanadItemName,
  });
  const ayanadItem = useMemo(
    () =>
      ayanadItemQuery.data?.find((item) => item.name === ayanadItemName) ??
      null,
    [ayanadItemName, ayanadItemQuery.data],
  );
  const ayanadCraftQuery = useQuery({
    ...trpc.crafts.forItem.queryOptions(ayanadItem?.id ?? -1),
    enabled: ayanadItem?.id != null,
  });

  return {
    ayanadItemName,
    ayanadItem,
    ayanadCraftData: ayanadCraftQuery.data ?? null,
  };
}
