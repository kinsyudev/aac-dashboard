import type {
  CraftEntryLike,
  ModesMap,
  OverrideMap,
  PriceMap,
  ProficiencyMap,
  SelectedCraftMap,
  SubcraftMap,
} from "./craft-optimizer.ts";
import {
  buildCraftRequirementSummary,
  getItemPrice,
  getProducedAmount,
  getSelectedEntry,
  hasItemPrice,
} from "./craft-optimizer.ts";

export interface CraftPagePlanInput<T extends CraftEntryLike> {
  rootEntry: T;
  rootItemId: number;
  craftCount: number;
  subcraftMap: SubcraftMap<T>;
  modes: ModesMap;
  selectedCrafts: SelectedCraftMap;
  priceMap: PriceMap;
  overrideMap: OverrideMap;
  proficiencyMap: ProficiencyMap;
  salePrice?: number;
  focusPath: number[];
}

export interface CraftPageSummary {
  totalOutput: number;
  craftCost: number | null;
  totalLabor: number;
  costPerItem: number | null;
  profitBeforeFees: number | null;
  profitPerItem: number | null;
  profitPerLabor: number | null;
  missingPriceItems: string[];
}

interface FocusLevel<T extends CraftEntryLike> {
  itemId: number;
  entry: T;
  crafts: number;
}

export function normalizeCraftCount(value: number): number {
  return Number.isInteger(value) && value > 0 ? value : 1;
}

export function buildCraftPagePlan<T extends CraftEntryLike>(
  input: CraftPagePlanInput<T>,
) {
  const craftCount = normalizeCraftCount(input.craftCount);
  const rootOutput = getProducedAmount(input.rootEntry, input.rootItemId);
  const requirement = buildCraftRequirementSummary({
    entry: input.rootEntry,
    producedItemId: input.rootItemId,
    requiredQuantity: craftCount * rootOutput,
    subcraftMap: input.subcraftMap,
    modes: input.modes,
    selectedCrafts: input.selectedCrafts,
    priceMap: input.priceMap,
    overrideMap: input.overrideMap,
    proficiencyMap: input.proficiencyMap,
  });

  const missingPriceItems = requirement.materials
    .filter(
      (material) =>
        !hasItemPrice(material.item.id, input.priceMap, input.overrideMap),
    )
    .map((material) => material.item.name ?? `Item ${material.item.id}`);
  const craftCost = missingPriceItems.length ? null : requirement.materialCost;
  const totalOutput = craftCount * rootOutput;
  const salePrice = input.salePrice;
  const revenue = salePrice == null ? null : salePrice * totalOutput;
  const profitBeforeFees =
    revenue == null || craftCost == null ? null : revenue - craftCost;

  const levels: FocusLevel<T>[] = [
    {
      itemId: input.rootItemId,
      entry: input.rootEntry,
      crafts: craftCount,
    },
  ];
  for (const itemId of input.focusPath.slice(1)) {
    const parent = levels.at(-1);
    if (!parent) break;
    const parentMaterial = parent.entry.materials.find(
      (material) => material.item.id === itemId,
    );
    if (!parentMaterial || input.modes[itemId] !== "craft") break;
    const entry = getSelectedEntry(
      itemId,
      input.subcraftMap,
      input.selectedCrafts,
    );
    if (!entry) break;
    levels.push({
      itemId,
      entry,
      crafts: Math.ceil(
        (parent.crafts * parentMaterial.amount) /
          Math.max(1, getProducedAmount(entry, itemId)),
      ),
    });
  }

  const focused = levels.at(-1);
  if (!focused) throw new Error("A Craft Plan always has a root focus level.");

  return {
    craftCount,
    breadcrumb: levels,
    focused,
    focusedMaterialQuantities: focused.entry.materials.map((material) => ({
      itemId: material.item.id,
      amount: material.amount * focused.crafts,
    })),
    summary: {
      totalOutput,
      craftCost,
      totalLabor: requirement.totalLabor,
      costPerItem:
        craftCost == null || rootOutput === 1 ? null : craftCost / totalOutput,
      profitBeforeFees,
      profitPerItem:
        profitBeforeFees == null || rootOutput === 1
          ? null
          : profitBeforeFees / totalOutput,
      profitPerLabor:
        profitBeforeFees == null || requirement.totalLabor === 0
          ? null
          : (profitBeforeFees * 100) / requirement.totalLabor,
      missingPriceItems,
    } satisfies CraftPageSummary,
  };
}

export function getRecipeSignature<T extends CraftEntryLike>(entry: T): string {
  return entry.materials
    .map(
      (material) =>
        `${material.amount} ${material.item.name ?? `Item ${material.item.id}`}`,
    )
    .join(", ");
}

export function getRecipeChoiceCost<T extends CraftEntryLike>(
  entry: T,
  priceMap: PriceMap,
  overrideMap: OverrideMap,
): number | null {
  if (
    entry.materials.some(
      (material) => !hasItemPrice(material.item.id, priceMap, overrideMap),
    )
  ) {
    return null;
  }
  return entry.materials.reduce(
    (total, material) =>
      total +
      getItemPrice(material.item.id, priceMap, overrideMap) * material.amount,
    0,
  );
}
