import { getItemPrice } from "~/lib/craft-optimizer";
import { getDiscountedLabor } from "~/lib/proficiency";

export const REWARD_ITEM_IDS = {
  charcoalStabilizer: 32103,
  dragonEssenceStabilizer: 32106,
  lordsCoin: 26880,
} as const;

export type RewardItemName =
  | "Gold"
  | "Charcoal Stabilizer"
  | "Dragon Essence Stabilizer"
  | "Gilda Star"
  | "Lord's Pence";

export interface TradePack {
  name: string;
  payout: number;
  rewardItemName: RewardItemName;
  destination: string;
  itemId: number;
  filename: string | null;
  origin: string;
  route: string;
  isLarder: boolean;
  isFreePack: boolean;
}

export interface CuratedTradePackData {
  generatedAt: string;
  source: string;
  packs: TradePack[];
}

export type PriceMap = Map<
  number,
  { avg24h: string | null; avg7d: string | null; avg30d: string | null }
>;
export type OverrideMap = Map<number, number>;
export type ProficiencyMap = Map<string, number>;

export interface TradePackMaterial {
  itemId: number;
  amount: number;
}

export interface TradePackCraftData {
  labor: number;
  proficiency: string | null;
  materials: TradePackMaterial[];
}

export interface TradePackInputs {
  pack: TradePack;
  craft: TradePackCraftData | null;
  priceMap: PriceMap;
  overrideMap?: OverrideMap;
  proficiencyMap?: ProficiencyMap;
  gildaStarValue?: number;
  larderCostPerPack?: number;
  larderLaborPerPack?: number;
  turnInLabor?: number;
}

export interface TradePackMetrics {
  revenue: number;
  cost: number;
  profit: number;
  labor: number;
  silverPerLabor: number | null;
}

export interface TradePackResult {
  pack: TradePack;
  metrics: TradePackMetrics;
}

export interface TradePackFilters {
  origin?: string;
  destination?: string;
  rewardItemName?: RewardItemName | "all";
}

export interface TradePackRunSummary extends TradePackMetrics {
  count: number;
}

const DEFAULT_TURN_IN_LABOR = 110;

function getOverrideMap(input?: OverrideMap): OverrideMap {
  return input ?? new Map();
}

function getProficiencyMap(input?: ProficiencyMap): ProficiencyMap {
  return input ?? new Map();
}

function getSilverPerLabor(profit: number, labor: number): number | null {
  if (labor <= 0) return null;
  return (profit * 100) / labor;
}

export function getRewardUnitValue(
  rewardItemName: RewardItemName,
  inputs: Pick<
    TradePackInputs,
    "priceMap" | "overrideMap" | "gildaStarValue"
  >,
): number {
  const overrideMap = getOverrideMap(inputs.overrideMap);

  switch (rewardItemName) {
    case "Gold":
      return 1;
    case "Charcoal Stabilizer":
      return getItemPrice(
        REWARD_ITEM_IDS.charcoalStabilizer,
        inputs.priceMap,
        overrideMap,
      );
    case "Dragon Essence Stabilizer":
      return getItemPrice(
        REWARD_ITEM_IDS.dragonEssenceStabilizer,
        inputs.priceMap,
        overrideMap,
      );
    case "Gilda Star":
      return inputs.gildaStarValue ?? 0;
    case "Lord's Pence":
      return (
        getItemPrice(REWARD_ITEM_IDS.lordsCoin, inputs.priceMap, overrideMap) /
        100
      );
  }
}

export function calculateMaterialCost({
  craft,
  priceMap,
  overrideMap = new Map(),
}: {
  craft: TradePackCraftData;
  priceMap: PriceMap;
  overrideMap?: OverrideMap;
}): number {
  return craft.materials.reduce(
    (total, material) =>
      total +
      getItemPrice(material.itemId, priceMap, overrideMap) * material.amount,
    0,
  );
}

export function calculatePackMetrics(inputs: TradePackInputs): TradePackMetrics {
  const { pack, craft } = inputs;
  const overrideMap = getOverrideMap(inputs.overrideMap);
  const proficiencyMap = getProficiencyMap(inputs.proficiencyMap);
  const turnInLabor = getDiscountedLabor(
    inputs.turnInLabor ?? DEFAULT_TURN_IN_LABOR,
    "Commerce",
    proficiencyMap,
  );
  const revenue =
    pack.payout *
    getRewardUnitValue(pack.rewardItemName, {
      priceMap: inputs.priceMap,
      overrideMap,
      gildaStarValue: inputs.gildaStarValue,
    });

  let cost = 0;
  let labor = turnInLabor;

  if (!pack.isFreePack && pack.isLarder) {
    cost = inputs.larderCostPerPack ?? 0;
    labor += inputs.larderLaborPerPack ?? 0;
  } else if (!pack.isFreePack) {
    if (!craft) {
      throw new Error(`Missing craft data for trade pack item ${pack.itemId}`);
    }

    cost = calculateMaterialCost({
      craft,
      priceMap: inputs.priceMap,
      overrideMap,
    });
    labor += getDiscountedLabor(craft.labor, craft.proficiency, proficiencyMap);
  }

  const profit = revenue - cost;

  return {
    revenue,
    cost,
    profit,
    labor,
    silverPerLabor: getSilverPerLabor(profit, labor),
  };
}

export function filterTradePacks(
  packs: TradePack[],
  filters: TradePackFilters,
): TradePack[] {
  return packs.filter((pack) => {
    const origin = filters.origin ?? "all";
    const destination = filters.destination ?? "all";
    const rewardItemName = filters.rewardItemName ?? "all";

    return (
      (origin === "all" || pack.origin === origin) &&
      (destination === "all" || pack.destination === destination) &&
      (rewardItemName === "all" || pack.rewardItemName === rewardItemName)
    );
  });
}

export function getTopPacksByProfitSilverPerLabor(
  results: TradePackResult[],
  limit = results.length,
): TradePackResult[] {
  return [...results]
    .filter((result) => result.metrics.silverPerLabor != null)
    .sort(
      (a, b) =>
        (b.metrics.silverPerLabor ?? Number.NEGATIVE_INFINITY) -
        (a.metrics.silverPerLabor ?? Number.NEGATIVE_INFINITY),
    )
    .slice(0, limit);
}

export function getTopPacksByRevenue(
  results: TradePackResult[],
  limit = results.length,
): TradePackResult[] {
  return [...results]
    .sort((a, b) => b.metrics.revenue - a.metrics.revenue)
    .slice(0, limit);
}

export function summarizePackRun(
  metrics: TradePackMetrics,
  countInput: number,
): TradePackRunSummary {
  const count = Math.max(1, Math.floor(countInput));
  const revenue = metrics.revenue * count;
  const cost = metrics.cost * count;
  const profit = metrics.profit * count;
  const labor = metrics.labor * count;

  return {
    count,
    revenue,
    cost,
    profit,
    labor,
    silverPerLabor: getSilverPerLabor(profit, labor),
  };
}
