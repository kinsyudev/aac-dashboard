import { pickCheapestCraft } from "./craft-helpers.ts";

export type CraftMode = "buy" | "craft";
export type CraftModeMap = Partial<Record<number, CraftMode>>;

export interface PriceEntry {
  avg24h: string | null;
  avg7d: string | null;
  avg30d: string | null;
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

const COIN_ITEM_ID = 500;
const GOLD_PER_COIN = 0.0001;

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
  return (
    parseFinitePrice(price?.avg24h) ??
    parseFinitePrice(price?.avg7d) ??
    parseFinitePrice(price?.avg30d) ??
    0
  );
}

export function getItemPrice(
  itemId: number,
  priceMap: PriceMap,
  overrideMap: OverrideMap,
): number {
  if (itemId === COIN_ITEM_ID) return GOLD_PER_COIN;
  const custom = overrideMap.get(itemId);
  if (custom != null) return custom;
  return getMarketPrice(priceMap.get(itemId));
}

export function mergePriceMaps(...priceMaps: PriceMap[]): PriceMap {
  return new Map(priceMaps.flatMap((priceMap) => [...priceMap]));
}

export function getMatchingAyanadName(name: string): string | null {
  if (!name.toLowerCase().includes("sealed delphinad")) return null;
  return name.replace(/delphinad/i, "Ayanad");
}

export function isForcedAuctionHouseMaterial(item: { name: string }): boolean {
  const normalized = item.name.trim().toLowerCase();
  return (
    normalized === "ayanad weaponsmithing scroll" ||
    normalized === "ayanad armorsmithing scroll" ||
    normalized === "ayanad accessory scroll"
  );
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
  modes: CraftModeMap = {},
  visited = new Set<number>(),
): number {
  const produced =
    entry.products.find((product) => product.item.id === itemId)?.amount ?? 1;

  const batchCost = entry.materials.reduce((sum, { item, amount }) => {
    const subEntries = subcraftMap[item.id];
    const mode = modes[item.id] ?? "craft";
    const unitCost =
      subEntries?.length &&
      mode === "craft" &&
      !isForcedAuctionHouseMaterial(item) &&
      !visited.has(item.id)
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
  modes: CraftModeMap = {},
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
  modes: CraftModeMap = {},
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

export interface RecommendedModeOptions {
  /**
   * Gold one point of labor is worth. 0 picks the cheapest gold option; a positive value only crafts a
   * material when the gold saved beats the labor spent at this rate (used to maximize silver per labor).
   */
  laborValueGold?: number;
  /** Labor for one run of a craft, e.g. after proficiency discounts. Defaults to the listed labor. */
  getCraftLabor?: (craft: CraftInfo) => number;
}

export function buildRecommendedModes<T extends CraftEntryLike>(
  materials: { item: { id: number; name: string } }[],
  subcraftMap: SubcraftMap<T>,
  priceMap: PriceMap,
  overrideMap: OverrideMap,
  options: RecommendedModeOptions = {},
): Record<number, CraftMode> {
  const laborValueGold = Math.max(0, options.laborValueGold ?? 0);
  const getCraftLabor = options.getCraftLabor ?? ((craft) => craft.labor);
  const acc: Record<number, CraftMode> = {};
  const visited = new Set<number>();
  // Labor of one crafted unit under the modes decided so far (children are decided first).
  const unitLabor = new Map<number, number>();

  const visit = (item: { id: number; name: string }) => {
    if (visited.has(item.id)) return;
    visited.add(item.id);

    const subEntries = subcraftMap[item.id];
    if (!subEntries?.length) return;

    if (isForcedAuctionHouseMaterial(item)) {
      acc[item.id] = "buy";
      return;
    }

    const entry = pickCheapestCraft(
      subEntries,
      item.id,
      (candidate, productItemId) =>
        getCraftEntryUnitCost(
          candidate,
          productItemId,
          subcraftMap,
          priceMap,
          overrideMap,
        ),
    );
    for (const mat of entry.materials) {
      visit(mat.item);
    }

    const buyUnit = getItemPrice(item.id, priceMap, overrideMap);
    if (laborValueGold === 0) {
      const craftUnit = deepCraftCost(
        item.id,
        subcraftMap,
        priceMap,
        overrideMap,
      );
      acc[item.id] = buyUnit > 0 && craftUnit < buyUnit ? "craft" : "buy";
      return;
    }

    const produced =
      entry.products.find((product) => product.item.id === item.id)?.amount ??
      1;
    const craftLabor =
      (getCraftLabor(entry.craft) +
        entry.materials.reduce(
          (sum, { item: material, amount }) =>
            sum +
            (acc[material.id] === "craft"
              ? (unitLabor.get(material.id) ?? 0)
              : 0) *
              amount,
          0,
        )) /
      produced;
    const craftUnit = getCraftEntryUnitCost(
      entry,
      item.id,
      subcraftMap,
      priceMap,
      overrideMap,
      acc,
    );
    unitLabor.set(item.id, craftLabor);
    acc[item.id] =
      buyUnit > 0 && craftUnit + laborValueGold * craftLabor < buyUnit
        ? "craft"
        : "buy";
  };

  for (const mat of materials) {
    visit(mat.item);
  }

  return acc;
}
