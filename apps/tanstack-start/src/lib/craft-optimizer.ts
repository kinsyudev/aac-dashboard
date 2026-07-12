import { pickPreferredCraft } from "./craft-helpers.ts";
import { getDiscountedLabor } from "./proficiency.ts";

export const MAX_CRAFT_DEPTH = 8;

export type CraftMode = "buy" | "craft";
export type ModesMap = Record<number, CraftMode>;
export type SelectedCraftMap = Record<number, number>;
export type OptimizationObjective = "profit" | "silverPerLabor";

export type PriceMap = Map<
  number,
  { avg24h: string | null; avg7d: string | null; avg30d: string | null }
>;
export type OverrideMap = Map<number, number>;
export type ProficiencyMap = Map<string, number>;

export interface CraftMaterialLike {
  item: { id: number; name?: string | null };
  amount: number;
}

export interface CraftProductLike {
  item: { id: number };
  amount: number;
}

export interface CraftEntryLike {
  craft: {
    id: number;
    labor: number;
    proficiency: string | null;
    name: string;
  };
  materials: CraftMaterialLike[];
  products: CraftProductLike[];
}

export type SubcraftMap<T extends CraftEntryLike> = Record<number, T[]>;

export interface CraftMetrics {
  producedAmount: number;
  directLabor: number;
  materialsCost: number;
  subcraftLabor: number;
  totalLaborPerBatch: number;
  costPerUnit: number;
  laborPerUnit: number;
  profitPerUnit: number;
  silverPerLabor: number | null;
  silverPerLaborState: "finite" | "infinite" | "none";
}

export interface AutoPlan<T extends CraftEntryLike> {
  entry: T;
  modes: ModesMap;
  selectedCrafts: SelectedCraftMap;
  metrics: CraftMetrics;
}

export interface FlattenedMaterialRequirement<
  TItem = CraftMaterialLike["item"],
> {
  item: TItem;
  totalAmount: number;
}

export interface LaborRequirement {
  proficiency: string;
  labor: number;
}

export interface CraftRequirementSummary<TItem = CraftMaterialLike["item"]> {
  batches: number;
  producedAmount: number;
  producedQuantity: number;
  materials: FlattenedMaterialRequirement<TItem>[];
  laborByProficiency: LaborRequirement[];
  materialCost: number;
  totalLabor: number;
}

interface Context<T extends CraftEntryLike> {
  subcraftMap: SubcraftMap<T>;
  priceMap: PriceMap;
  overrideMap: OverrideMap;
  proficiencyMap: ProficiencyMap;
  maxDepth: number;
}

interface AcquisitionPlan<T extends CraftEntryLike> {
  mode: CraftMode;
  entry: T | null;
  unitCost: number;
  unitLabor: number;
  modes: ModesMap;
  selectedCrafts: SelectedCraftMap;
}

interface CraftPlan<T extends CraftEntryLike> {
  entry: T;
  metrics: CraftMetrics;
  modes: ModesMap;
  selectedCrafts: SelectedCraftMap;
}

function mergeModes(...parts: ModesMap[]): ModesMap {
  return parts.reduce<ModesMap>((acc, part) => ({ ...acc, ...part }), {});
}

function mergeSelectedCrafts(...parts: SelectedCraftMap[]): SelectedCraftMap {
  return parts.reduce<SelectedCraftMap>(
    (acc, part) => ({ ...acc, ...part }),
    {},
  );
}

function addMapValue<TKey>(map: Map<TKey, number>, key: TKey, amount: number) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

export function parseFinitePrice(
  value: string | null | undefined,
): number | null {
  if (value == null || value === "") return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getMarketPrice(
  price:
    | { avg24h: string | null; avg7d: string | null; avg30d: string | null }
    | null
    | undefined,
): number {
  return (
    parseFinitePrice(price?.avg24h) ??
    parseFinitePrice(price?.avg7d) ??
    parseFinitePrice(price?.avg30d) ??
    0
  );
}

export function hasMarketPrice(
  price:
    | { avg24h: string | null; avg7d: string | null; avg30d: string | null }
    | null
    | undefined,
): boolean {
  return (
    parseFinitePrice(price?.avg24h) != null ||
    parseFinitePrice(price?.avg7d) != null ||
    parseFinitePrice(price?.avg30d) != null
  );
}

export function getItemPrice(
  itemId: number,
  priceMap: PriceMap,
  overrideMap: OverrideMap,
): number {
  return overrideMap.get(itemId) ?? getMarketPrice(priceMap.get(itemId));
}

export function hasItemPrice(
  itemId: number,
  priceMap: PriceMap,
  overrideMap: OverrideMap,
): boolean {
  return overrideMap.has(itemId) || hasMarketPrice(priceMap.get(itemId));
}

export function getProducedAmount<T extends CraftEntryLike>(
  entry: T,
  itemId: number,
): number {
  return (
    entry.products.find((product) => product.item.id === itemId)?.amount ?? 1
  );
}

export function getSelectedEntry<T extends CraftEntryLike>(
  itemId: number,
  subcraftMap: SubcraftMap<T>,
  selectedCrafts: SelectedCraftMap,
  fallback?: T | null,
): T | null {
  const entries = subcraftMap[itemId];
  if (!entries?.length) return fallback ?? null;

  const selectedCraftId = selectedCrafts[itemId];
  if (selectedCraftId != null) {
    const selectedEntry = entries.find(
      (entry) => entry.craft.id === selectedCraftId,
    );
    if (selectedEntry) return selectedEntry;
  }

  return fallback ?? pickPreferredCraft(entries, itemId);
}

export function buildCraftRequirementSummary<T extends CraftEntryLike>(input: {
  entry: T;
  producedItemId: number;
  requiredQuantity: number;
  subcraftMap: SubcraftMap<T>;
  modes: ModesMap;
  selectedCrafts: SelectedCraftMap;
  priceMap: PriceMap;
  overrideMap: OverrideMap;
  proficiencyMap: ProficiencyMap;
  maxDepth?: number;
}): CraftRequirementSummary<T["materials"][number]["item"]> {
  const maxDepth = input.maxDepth ?? MAX_CRAFT_DEPTH;
  const materialMap = new Map<
    number,
    FlattenedMaterialRequirement<T["materials"][number]["item"]>
  >();
  const laborMap = new Map<string, number>();

  const addRawMaterial = (
    item: T["materials"][number]["item"],
    amount: number,
  ) => {
    const nextAmount = Math.max(0, amount);
    if (nextAmount <= 0) return;
    const existing = materialMap.get(item.id);
    if (existing) {
      existing.totalAmount += nextAmount;
      return;
    }
    materialMap.set(item.id, { item, totalAmount: nextAmount });
  };

  const visitEntry = (
    entry: T,
    producedItemId: number,
    requiredQuantity: number,
    depth: number,
    visited: Set<string>,
  ) => {
    const producedAmount = getProducedAmount(entry, producedItemId);
    const batches = Math.ceil(
      Math.max(0, requiredQuantity) / Math.max(1, producedAmount),
    );
    if (batches <= 0) return;

    if (entry.craft.labor > 0) {
      addMapValue(
        laborMap,
        entry.craft.proficiency ?? "Unknown",
        batches *
          getDiscountedLabor(
            entry.craft.labor,
            entry.craft.proficiency,
            input.proficiencyMap,
          ),
      );
    }

    for (const { item, amount } of entry.materials) {
      const requiredMaterialAmount = amount * batches;
      const isCraftable =
        depth < maxDepth && !!input.subcraftMap[item.id]?.length;
      const mode = input.modes[item.id] ?? "buy";
      const cycleKey = `${item.id}:${
        input.selectedCrafts[item.id] ?? "preferred"
      }`;

      if (!isCraftable || mode === "buy" || visited.has(cycleKey)) {
        addRawMaterial(item, requiredMaterialAmount);
        continue;
      }

      const subEntry = getSelectedEntry(
        item.id,
        input.subcraftMap,
        input.selectedCrafts,
      );
      if (!subEntry) {
        addRawMaterial(item, requiredMaterialAmount);
        continue;
      }

      visitEntry(
        subEntry,
        item.id,
        requiredMaterialAmount,
        depth + 1,
        new Set([...visited, cycleKey]),
      );
    }
  };

  const producedAmount = getProducedAmount(input.entry, input.producedItemId);
  const batches = Math.ceil(
    Math.max(0, input.requiredQuantity) / Math.max(1, producedAmount),
  );
  visitEntry(
    input.entry,
    input.producedItemId,
    input.requiredQuantity,
    0,
    new Set(),
  );

  const materials = Array.from(materialMap.values())
    .map((material) => ({
      ...material,
      totalAmount: Math.ceil(material.totalAmount),
    }))
    .sort(
      (left, right) =>
        (left.item.name ?? "").localeCompare(right.item.name ?? "") ||
        left.item.id - right.item.id,
    );
  const laborByProficiency = Array.from(laborMap.entries())
    .map(([proficiency, labor]) => ({ proficiency, labor }))
    .sort((left, right) => left.proficiency.localeCompare(right.proficiency));
  const materialCost = materials.reduce(
    (sum, material) =>
      sum +
      material.totalAmount *
        getItemPrice(material.item.id, input.priceMap, input.overrideMap),
    0,
  );
  const totalLabor = laborByProficiency.reduce(
    (sum, entry) => sum + entry.labor,
    0,
  );

  return {
    batches,
    producedAmount,
    producedQuantity: batches * producedAmount,
    materials,
    laborByProficiency,
    materialCost,
    totalLabor,
  };
}

export function computeManualCraftMetrics<T extends CraftEntryLike>(
  entry: T,
  producedItemId: number,
  salePrice: number,
  contextInput: Omit<Context<T>, "maxDepth"> & { maxDepth?: number },
  modes: ModesMap,
  selectedCrafts: SelectedCraftMap,
  depth = 0,
  visited = new Set<string>(),
): CraftMetrics {
  const context: Context<T> = {
    ...contextInput,
    maxDepth: contextInput.maxDepth ?? MAX_CRAFT_DEPTH,
  };
  const producedAmount = getProducedAmount(entry, producedItemId);
  const directLabor = getDiscountedLabor(
    entry.craft.labor,
    entry.craft.proficiency,
    context.proficiencyMap,
  );

  let materialsCost = 0;
  let subcraftLabor = 0;

  for (const { item, amount } of entry.materials) {
    const isCraftable =
      depth < context.maxDepth && !!context.subcraftMap[item.id]?.length;
    const mode = modes[item.id] ?? "buy";
    if (!isCraftable || mode === "buy") {
      materialsCost +=
        getItemPrice(item.id, context.priceMap, context.overrideMap) * amount;
      continue;
    }

    const cycleKey = `${item.id}:${selectedCrafts[item.id] ?? "preferred"}`;
    if (visited.has(cycleKey)) {
      materialsCost +=
        getItemPrice(item.id, context.priceMap, context.overrideMap) * amount;
      continue;
    }

    const subEntry = getSelectedEntry(
      item.id,
      context.subcraftMap,
      selectedCrafts,
    );
    if (!subEntry) {
      materialsCost +=
        getItemPrice(item.id, context.priceMap, context.overrideMap) * amount;
      continue;
    }

    const childMetrics = computeManualCraftMetrics(
      subEntry,
      item.id,
      getItemPrice(item.id, context.priceMap, context.overrideMap),
      context,
      modes,
      selectedCrafts,
      depth + 1,
      new Set([...visited, cycleKey]),
    );

    materialsCost += childMetrics.costPerUnit * amount;
    subcraftLabor += childMetrics.laborPerUnit * amount;
  }

  return finalizeMetrics({
    salePrice,
    producedAmount,
    directLabor,
    materialsCost,
    subcraftLabor,
  });
}

export function buildAutoPlan<T extends CraftEntryLike>(
  entries: T[],
  producedItemId: number,
  salePrice: number,
  contextInput: Omit<Context<T>, "maxDepth"> & { maxDepth?: number },
  objective: OptimizationObjective,
): AutoPlan<T> | null {
  const context: Context<T> = {
    ...contextInput,
    maxDepth: contextInput.maxDepth ?? MAX_CRAFT_DEPTH,
  };
  if (!entries.length) return null;

  if (objective === "profit") {
    const plan = chooseBestEntryByLambda(
      entries,
      producedItemId,
      0,
      context,
      0,
      new Set(),
    );
    return plan ? toAutoPlan(plan) : null;
  }

  const infinitePlan = chooseBestZeroLaborPlan(
    entries,
    producedItemId,
    salePrice,
    context,
    0,
    new Set(),
  );
  if (infinitePlan && infinitePlan.metrics.profitPerUnit > 0) {
    return toAutoPlan(infinitePlan);
  }

  let lambda = 0;
  let bestPlan =
    chooseBestEntryByLambda(
      entries,
      producedItemId,
      lambda,
      context,
      0,
      new Set(),
    ) ?? null;

  for (let iteration = 0; iteration < 10 && bestPlan; iteration += 1) {
    if (bestPlan.metrics.laborPerUnit <= 0) break;

    const nextLambda =
      (salePrice - bestPlan.metrics.costPerUnit) /
      bestPlan.metrics.laborPerUnit;
    if (Math.abs(nextLambda - lambda) < 1e-6) break;

    lambda = nextLambda;
    const nextPlan = chooseBestEntryByLambda(
      entries,
      producedItemId,
      lambda,
      context,
      0,
      new Set(),
    );
    if (!nextPlan) break;
    bestPlan = nextPlan;
  }

  return bestPlan ? toAutoPlan(bestPlan) : null;
}

function toAutoPlan<T extends CraftEntryLike>(plan: CraftPlan<T>): AutoPlan<T> {
  return {
    entry: plan.entry,
    modes: plan.modes,
    selectedCrafts: plan.selectedCrafts,
    metrics: plan.metrics,
  };
}

function chooseBestEntryByLambda<T extends CraftEntryLike>(
  entries: T[],
  producedItemId: number,
  lambda: number,
  context: Context<T>,
  depth: number,
  visited: Set<string>,
): CraftPlan<T> | null {
  let bestPlan: CraftPlan<T> | null = null;

  for (const entry of entries) {
    const plan = optimizeEntryByLambda(
      entry,
      producedItemId,
      lambda,
      context,
      depth,
      visited,
    );
    if (!plan) continue;

    if (!bestPlan) {
      bestPlan = plan;
      continue;
    }

    const weighted =
      plan.metrics.costPerUnit + lambda * plan.metrics.laborPerUnit;
    const bestWeighted =
      bestPlan.metrics.costPerUnit + lambda * bestPlan.metrics.laborPerUnit;

    if (weighted !== bestWeighted) {
      if (weighted < bestWeighted) bestPlan = plan;
      continue;
    }

    if (plan.metrics.costPerUnit !== bestPlan.metrics.costPerUnit) {
      if (plan.metrics.costPerUnit < bestPlan.metrics.costPerUnit)
        bestPlan = plan;
      continue;
    }

    if (plan.metrics.laborPerUnit < bestPlan.metrics.laborPerUnit) {
      bestPlan = plan;
    }
  }

  return bestPlan;
}

function optimizeEntryByLambda<T extends CraftEntryLike>(
  entry: T,
  producedItemId: number,
  lambda: number,
  context: Context<T>,
  depth: number,
  visited: Set<string>,
): CraftPlan<T> | null {
  const cycleKey = `${producedItemId}:${entry.craft.id}`;
  if (depth >= context.maxDepth || visited.has(cycleKey)) return null;

  const nextVisited = new Set(visited);
  nextVisited.add(cycleKey);

  let materialsCost = 0;
  let subcraftLabor = 0;
  let modes: ModesMap = {};
  let selectedCrafts: SelectedCraftMap = {};

  for (const { item, amount } of entry.materials) {
    const option = chooseBestMaterialAcquisitionByLambda(
      item.id,
      lambda,
      context,
      depth + 1,
      nextVisited,
    );
    materialsCost += option.unitCost * amount;
    subcraftLabor += option.unitLabor * amount;
    modes = mergeModes(modes, option.modes);
    selectedCrafts = mergeSelectedCrafts(selectedCrafts, option.selectedCrafts);
  }

  const producedAmount = getProducedAmount(entry, producedItemId);
  const directLabor = getDiscountedLabor(
    entry.craft.labor,
    entry.craft.proficiency,
    context.proficiencyMap,
  );
  const metrics = finalizeMetrics({
    salePrice: 0,
    producedAmount,
    directLabor,
    materialsCost,
    subcraftLabor,
  });

  return {
    entry,
    metrics,
    modes,
    selectedCrafts,
  };
}

function chooseBestMaterialAcquisitionByLambda<T extends CraftEntryLike>(
  itemId: number,
  lambda: number,
  context: Context<T>,
  depth: number,
  visited: Set<string>,
): AcquisitionPlan<T> {
  const buyPlan: AcquisitionPlan<T> = {
    mode: "buy",
    entry: null,
    unitCost: getItemPrice(itemId, context.priceMap, context.overrideMap),
    unitLabor: 0,
    modes: { [itemId]: "buy" },
    selectedCrafts: {},
  };
  const canBuy = hasItemPrice(itemId, context.priceMap, context.overrideMap);

  const entries = context.subcraftMap[itemId];
  if (!entries?.length || depth > context.maxDepth) return buyPlan;

  let bestPlan: AcquisitionPlan<T> | null = canBuy ? buyPlan : null;
  let bestWeighted = canBuy ? buyPlan.unitCost : Number.POSITIVE_INFINITY;

  for (const entry of entries) {
    const crafted = optimizeEntryByLambda(
      entry,
      itemId,
      lambda,
      context,
      depth,
      visited,
    );
    if (!crafted) continue;

    const weighted =
      crafted.metrics.costPerUnit + lambda * crafted.metrics.laborPerUnit;
    if (weighted > bestWeighted) continue;

    const nextPlan: AcquisitionPlan<T> = {
      mode: "craft",
      entry,
      unitCost: crafted.metrics.costPerUnit,
      unitLabor: crafted.metrics.laborPerUnit,
      modes: mergeModes({ [itemId]: "craft" }, crafted.modes),
      selectedCrafts: mergeSelectedCrafts(
        { [itemId]: entry.craft.id },
        crafted.selectedCrafts,
      ),
    };

    if (!bestPlan || weighted < bestWeighted) {
      bestPlan = nextPlan;
      bestWeighted = weighted;
      continue;
    }

    if (nextPlan.unitCost < bestPlan.unitCost) {
      bestPlan = nextPlan;
      bestWeighted = weighted;
      continue;
    }

    if (nextPlan.unitLabor < bestPlan.unitLabor) {
      bestPlan = nextPlan;
      bestWeighted = weighted;
    }
  }

  return bestPlan ?? buyPlan;
}

function chooseBestZeroLaborPlan<T extends CraftEntryLike>(
  entries: T[],
  producedItemId: number,
  salePrice: number,
  context: Context<T>,
  depth: number,
  visited: Set<string>,
): CraftPlan<T> | null {
  let bestPlan: CraftPlan<T> | null = null;

  for (const entry of entries) {
    const plan = optimizeEntryZeroLabor(
      entry,
      producedItemId,
      salePrice,
      context,
      depth,
      visited,
    );
    if (!plan) continue;
    if (
      !bestPlan ||
      plan.metrics.profitPerUnit > bestPlan.metrics.profitPerUnit
    ) {
      bestPlan = plan;
    }
  }

  return bestPlan;
}

function optimizeEntryZeroLabor<T extends CraftEntryLike>(
  entry: T,
  producedItemId: number,
  salePrice: number,
  context: Context<T>,
  depth: number,
  visited: Set<string>,
): CraftPlan<T> | null {
  const directLabor = getDiscountedLabor(
    entry.craft.labor,
    entry.craft.proficiency,
    context.proficiencyMap,
  );
  if (directLabor > 0) return null;

  const cycleKey = `${producedItemId}:${entry.craft.id}:zero`;
  if (depth >= context.maxDepth || visited.has(cycleKey)) return null;

  const nextVisited = new Set(visited);
  nextVisited.add(cycleKey);

  let materialsCost = 0;
  let modes: ModesMap = {};
  let selectedCrafts: SelectedCraftMap = {};

  for (const { item, amount } of entry.materials) {
    const option = chooseBestZeroLaborMaterial(
      item.id,
      context,
      depth + 1,
      nextVisited,
    );
    if (!option) return null;
    materialsCost += option.unitCost * amount;
    modes = mergeModes(modes, option.modes);
    selectedCrafts = mergeSelectedCrafts(selectedCrafts, option.selectedCrafts);
  }

  const metrics = finalizeMetrics({
    salePrice,
    producedAmount: getProducedAmount(entry, producedItemId),
    directLabor: 0,
    materialsCost,
    subcraftLabor: 0,
  });

  if (metrics.laborPerUnit !== 0) return null;

  return {
    entry,
    metrics,
    modes,
    selectedCrafts,
  };
}

function chooseBestZeroLaborMaterial<T extends CraftEntryLike>(
  itemId: number,
  context: Context<T>,
  depth: number,
  visited: Set<string>,
): AcquisitionPlan<T> | null {
  const buyPlan: AcquisitionPlan<T> = {
    mode: "buy",
    entry: null,
    unitCost: getItemPrice(itemId, context.priceMap, context.overrideMap),
    unitLabor: 0,
    modes: { [itemId]: "buy" },
    selectedCrafts: {},
  };
  const canBuy = hasItemPrice(itemId, context.priceMap, context.overrideMap);

  const entries = context.subcraftMap[itemId];
  if (!entries?.length || depth > context.maxDepth) return buyPlan;

  let bestPlan: AcquisitionPlan<T> | null = canBuy ? buyPlan : null;

  for (const entry of entries) {
    const crafted = optimizeEntryZeroLabor(
      entry,
      itemId,
      getItemPrice(itemId, context.priceMap, context.overrideMap),
      context,
      depth,
      visited,
    );
    if (!crafted) continue;
    if (crafted.metrics.laborPerUnit !== 0) continue;

    if (bestPlan && crafted.metrics.costPerUnit >= bestPlan.unitCost) continue;

    bestPlan = {
      mode: "craft",
      entry,
      unitCost: crafted.metrics.costPerUnit,
      unitLabor: 0,
      modes: mergeModes({ [itemId]: "craft" }, crafted.modes),
      selectedCrafts: mergeSelectedCrafts(
        { [itemId]: entry.craft.id },
        crafted.selectedCrafts,
      ),
    };
  }

  return bestPlan ?? buyPlan;
}

function finalizeMetrics(input: {
  salePrice: number;
  producedAmount: number;
  directLabor: number;
  materialsCost: number;
  subcraftLabor: number;
}): CraftMetrics {
  const producedAmount = input.producedAmount > 0 ? input.producedAmount : 1;
  const totalLaborPerBatch = input.directLabor + input.subcraftLabor;
  const costPerUnit = input.materialsCost / producedAmount;
  const laborPerUnit = totalLaborPerBatch / producedAmount;
  const profitPerUnit = input.salePrice - costPerUnit;

  let silverPerLabor: number | null = null;
  let silverPerLaborState: "finite" | "infinite" | "none" = "none";

  if (laborPerUnit > 0) {
    silverPerLabor = (profitPerUnit * 100) / laborPerUnit;
    silverPerLaborState = "finite";
  } else if (profitPerUnit > 0) {
    silverPerLaborState = "infinite";
  }

  return {
    producedAmount,
    directLabor: input.directLabor,
    materialsCost: input.materialsCost,
    subcraftLabor: input.subcraftLabor,
    totalLaborPerBatch,
    costPerUnit,
    laborPerUnit,
    profitPerUnit,
    silverPerLabor,
    silverPerLaborState,
  };
}
