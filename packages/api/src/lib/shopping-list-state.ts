import { TRPCError } from "@trpc/server";

import type { db } from "@acme/db/client";
import type { shoppingLists } from "@acme/db/schema";
import { eq, getTableColumns, inArray } from "@acme/db";
import {
  craftMaterials,
  craftProducts,
  crafts,
  items,
  shoppingListCrafts,
  shoppingListItems,
} from "@acme/db/schema";

const MAX_DEPTH = 4;
type DbClient = typeof db;
export type DbTx = Parameters<Parameters<DbClient["transaction"]>[0]>[0];

type ItemRow = typeof items.$inferSelect;
type CraftRow = typeof crafts.$inferSelect;

interface MaterialRow {
  craftId: number;
  amount: number;
  item: ItemRow;
}

interface ProductRow {
  craftId: number;
  amount: number;
  rate: number | null;
  item: ItemRow;
}

interface CraftEntry {
  craft: CraftRow;
  materials: MaterialRow[];
  products: ProductRow[];
}

type SubcraftMap = Record<number, CraftEntry[]>;
interface SnapshotItemRow {
  item: ItemRow;
  requiredQuantity: number;
}
interface SnapshotCraftRow {
  craft: CraftRow;
  requiredCount: number;
}
interface Snapshot {
  items: SnapshotItemRow[];
  crafts: SnapshotCraftRow[];
}
interface CraftBlueprint {
  craft: CraftRow;
  item: ItemRow | null;
  materials: MaterialRow[];
  products: ProductRow[];
  subcraftsByItemId: SubcraftMap;
}

function pickPreferredCraft(entries: CraftEntry[], itemId: number): CraftEntry {
  const preferred = [...entries].sort((a, b) => {
    const amountFor = (entry: CraftEntry) =>
      entry.products.find((product) => product.item.id === itemId)?.amount ??
      Number.MAX_SAFE_INTEGER;
    return amountFor(a) - amountFor(b);
  })[0];

  if (!preferred) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "No craft entries available for preferred craft selection.",
    });
  }

  return preferred;
}

export async function fetchCraftBlueprint(
  dbClient: DbClient | DbTx,
  craftId: number,
) {
  const blueprintMap = await fetchCraftBlueprintMap(dbClient, [craftId]);
  const blueprint = blueprintMap.get(craftId);

  if (!blueprint) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Craft not found." });
  }

  return blueprint;
}

async function fetchCraftBlueprintMap(
  dbClient: DbClient | DbTx,
  craftIds: number[],
): Promise<Map<number, CraftBlueprint>> {
  const uniqueRootCraftIds = Array.from(new Set(craftIds));
  if (uniqueRootCraftIds.length === 0) return new Map();

  const craftById = new Map<number, CraftRow>();
  const materialsByCraftId = new Map<number, MaterialRow[]>();
  const productsByCraftId = new Map<number, ProductRow[]>();
  const itemById = new Map<number, ItemRow>();
  const processedCraftIds = new Set<number>();
  let pendingCraftIds = uniqueRootCraftIds;

  while (pendingCraftIds.length > 0) {
    const batchCraftIds = pendingCraftIds.filter(
      (candidateId) => !processedCraftIds.has(candidateId),
    );
    pendingCraftIds = [];

    if (batchCraftIds.length === 0) continue;

    batchCraftIds.forEach((candidateId) => processedCraftIds.add(candidateId));

    const craftRows = await dbClient
      .select()
      .from(crafts)
      .where(inArray(crafts.id, batchCraftIds));

    if (craftRows.length === 0) continue;

    craftRows.forEach((craft) => {
      craftById.set(craft.id, craft);
    });

    const resolvedCraftIds = craftRows.map((craft) => craft.id);
    const [materialRows, productRows] = await Promise.all([
      dbClient
        .select({
          craftId: craftMaterials.craftId,
          amount: craftMaterials.amount,
          item: getTableColumns(items),
        })
        .from(craftMaterials)
        .innerJoin(items, eq(items.id, craftMaterials.itemId))
        .where(inArray(craftMaterials.craftId, resolvedCraftIds)),
      dbClient
        .select({
          craftId: craftProducts.craftId,
          amount: craftProducts.amount,
          rate: craftProducts.rate,
          item: getTableColumns(items),
        })
        .from(craftProducts)
        .innerJoin(items, eq(items.id, craftProducts.itemId))
        .where(inArray(craftProducts.craftId, resolvedCraftIds)),
    ]);

    materialRows.forEach((row) => {
      itemById.set(row.item.id, row.item);
      const existing = materialsByCraftId.get(row.craftId) ?? [];
      existing.push(row);
      materialsByCraftId.set(row.craftId, existing);
    });

    productRows.forEach((row) => {
      itemById.set(row.item.id, row.item);
      const existing = productsByCraftId.get(row.craftId) ?? [];
      existing.push(row);
      productsByCraftId.set(row.craftId, existing);
    });

    const materialItemIds = Array.from(
      new Set(materialRows.map((row) => row.item.id)),
    );
    if (materialItemIds.length === 0) continue;

    const subcraftRows = await dbClient
      .select()
      .from(crafts)
      .where(inArray(crafts.primaryProductId, materialItemIds));

    pendingCraftIds = subcraftRows
      .map((craft) => craft.id)
      .filter((candidateId) => !processedCraftIds.has(candidateId));
  }

  const subcraftsByItemId: SubcraftMap = {};
  for (const craft of craftById.values()) {
    const producedItemId = craft.primaryProductId;
    if (producedItemId == null) continue;

    (subcraftsByItemId[producedItemId] ??= []).push({
      craft,
      materials: materialsByCraftId.get(craft.id) ?? [],
      products: productsByCraftId.get(craft.id) ?? [],
    });
  }

  return new Map(
    uniqueRootCraftIds.map((craftId) => {
      const craft = craftById.get(craftId);
      if (!craft) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Craft not found." });
      }

      return [
        craftId,
        {
          craft,
          item:
            craft.primaryProductId != null
              ? (itemById.get(craft.primaryProductId) ?? null)
              : null,
          materials: materialsByCraftId.get(craftId) ?? [],
          products: productsByCraftId.get(craftId) ?? [],
          subcraftsByItemId,
        },
      ] satisfies [number, CraftBlueprint];
    }),
  );
}

function getSimulationChain(
  mainCraft: {
    materials: MaterialRow[];
  },
  subcraftMap: SubcraftMap,
): { keyMaterialId: number | null; keyMaterialName: string | null } {
  const tierList = [
    "illustrious",
    "magnificent",
    "epherium",
    "delphinad",
    "ayanad",
  ] as const;

  for (const material of mainCraft.materials) {
    const name = material.item.name.toLowerCase();
    if (tierList.some((tier) => name.includes(tier))) {
      return {
        keyMaterialId: material.item.id,
        keyMaterialName: material.item.name,
      };
    }
  }

  for (const material of mainCraft.materials) {
    if (subcraftMap[material.item.id]?.length) {
      return {
        keyMaterialId: material.item.id,
        keyMaterialName: material.item.name,
      };
    }
  }

  return { keyMaterialId: null, keyMaterialName: null };
}

function buildSnapshot(
  entry: CraftEntry,
  craftModeSet: Set<number>,
  subcraftMap: SubcraftMap,
  quantity: number,
): Snapshot {
  const itemCounts = new Map<number, SnapshotItemRow>();
  const craftCounts = new Map<number, SnapshotCraftRow>();

  const accumulate = (
    currentEntry: CraftEntry,
    scaleFactor: number,
    depth: number,
  ): void => {
    const currentRequiredCount = Math.max(1, Math.ceil(scaleFactor));
    const existingCraft = craftCounts.get(currentEntry.craft.id);
    if (existingCraft) {
      existingCraft.requiredCount += currentRequiredCount;
    } else {
      craftCounts.set(currentEntry.craft.id, {
        craft: currentEntry.craft,
        requiredCount: currentRequiredCount,
      });
    }

    for (const material of currentEntry.materials) {
      const scaledAmount = material.amount * scaleFactor;
      const subcraftEntries = subcraftMap[material.item.id];
      const isCraftable = depth < MAX_DEPTH && !!subcraftEntries?.length;
      if (craftModeSet.has(material.item.id) && isCraftable) {
        const subcraft = pickPreferredCraft(subcraftEntries, material.item.id);
        const producedAmount =
          subcraft.products.find(
            (product) => product.item.id === material.item.id,
          )?.amount ?? 1;
        accumulate(subcraft, scaledAmount / producedAmount, depth + 1);
        continue;
      }

      const requiredQuantity = Math.max(1, Math.ceil(scaledAmount));
      const existingItem = itemCounts.get(material.item.id);
      if (existingItem) {
        existingItem.requiredQuantity += requiredQuantity;
      } else {
        itemCounts.set(material.item.id, {
          item: material.item,
          requiredQuantity,
        });
      }
    }
  };

  accumulate(entry, quantity, 0);

  return {
    items: [...itemCounts.values()].sort((a, b) =>
      a.item.name.localeCompare(b.item.name),
    ),
    crafts: [...craftCounts.values()].sort((a, b) =>
      a.craft.name.localeCompare(b.craft.name),
    ),
  };
}

async function replaceListSnapshot(
  tx: DbTx,
  shoppingListId: string,
  snapshot: ReturnType<typeof buildSnapshot>,
  progress?: {
    itemProgress?: Map<number, number>;
    craftProgress?: Map<number, number>;
  },
) {
  await tx
    .delete(shoppingListItems)
    .where(eq(shoppingListItems.shoppingListId, shoppingListId));
  await tx
    .delete(shoppingListCrafts)
    .where(eq(shoppingListCrafts.shoppingListId, shoppingListId));

  if (snapshot.items.length > 0) {
    await tx.insert(shoppingListItems).values(
      snapshot.items.map((row) => ({
        shoppingListId,
        itemId: row.item.id,
        requiredQuantity: row.requiredQuantity,
        obtainedQuantity: Math.min(
          row.requiredQuantity,
          progress?.itemProgress?.get(row.item.id) ?? 0,
        ),
        updatedAt: new Date(),
      })),
    );
  }

  if (snapshot.crafts.length > 0) {
    await tx.insert(shoppingListCrafts).values(
      snapshot.crafts.map((row) => ({
        shoppingListId,
        craftId: row.craft.id,
        requiredCount: row.requiredCount,
        completedCount: Math.min(
          row.requiredCount,
          progress?.craftProgress?.get(row.craft.id) ?? 0,
        ),
        updatedAt: new Date(),
      })),
    );
  }
}

export async function getExistingProgress(
  tx: DbTx,
  shoppingListId: string,
): Promise<{
  itemProgress: Map<number, number>;
  craftProgress: Map<number, number>;
}> {
  const [existingItems, existingCraftRows] = await Promise.all([
    tx
      .select({
        itemId: shoppingListItems.itemId,
        obtainedQuantity: shoppingListItems.obtainedQuantity,
      })
      .from(shoppingListItems)
      .where(eq(shoppingListItems.shoppingListId, shoppingListId)),
    tx
      .select({
        craftId: shoppingListCrafts.craftId,
        completedCount: shoppingListCrafts.completedCount,
      })
      .from(shoppingListCrafts)
      .where(eq(shoppingListCrafts.shoppingListId, shoppingListId)),
  ]);

  return {
    itemProgress: new Map<number, number>(
      existingItems.map((row: { itemId: number; obtainedQuantity: number }) => [
        row.itemId,
        row.obtainedQuantity,
      ]),
    ),
    craftProgress: new Map<number, number>(
      existingCraftRows.map(
        (row: { craftId: number; completedCount: number }) => [
          row.craftId,
          row.completedCount,
        ],
      ),
    ),
  };
}

export async function regenerateListState(
  tx: DbTx,
  list: typeof shoppingLists.$inferSelect,
  progress?: {
    itemProgress?: Map<number, number>;
    craftProgress?: Map<number, number>;
  },
) {
  const craftModeSet = new Set(list.craftModeItemIds);
  let snapshot: ReturnType<typeof buildSnapshot>;

  if (list.sourceType === "simulator") {
    const blueprint = await fetchCraftBlueprint(tx, list.sourceCraftId);
    const simulationChain = getSimulationChain(
      blueprint,
      blueprint.subcraftsByItemId,
    );
    const finalUpgradeEntry: CraftEntry = {
      craft: blueprint.craft,
      materials: blueprint.materials.filter(
        (material: MaterialRow) =>
          material.item.id !== simulationChain.keyMaterialId,
      ),
      products: blueprint.products,
    };

    const attemptSnapshot = buildSnapshot(
      {
        craft: blueprint.craft,
        materials: blueprint.materials,
        products: blueprint.products,
      },
      craftModeSet,
      blueprint.subcraftsByItemId,
      list.sourceQuantity,
    );
    const upgradeSnapshot = buildSnapshot(
      finalUpgradeEntry,
      craftModeSet,
      blueprint.subcraftsByItemId,
      1,
    );

    const mergedItems = new Map<
      number,
      { item: ItemRow; requiredQuantity: number }
    >();
    const mergedCrafts = new Map<
      number,
      { craft: CraftRow; requiredCount: number }
    >();

    for (const row of [...attemptSnapshot.items, ...upgradeSnapshot.items]) {
      const existing = mergedItems.get(row.item.id);
      if (existing) existing.requiredQuantity += row.requiredQuantity;
      else mergedItems.set(row.item.id, { ...row });
    }

    for (const row of [...attemptSnapshot.crafts, ...upgradeSnapshot.crafts]) {
      const existing = mergedCrafts.get(row.craft.id);
      if (existing) existing.requiredCount += row.requiredCount;
      else mergedCrafts.set(row.craft.id, { ...row });
    }

    snapshot = {
      items: Array.from(mergedItems.values()).sort((a, b) =>
        a.item.name.localeCompare(b.item.name),
      ),
      crafts: Array.from(mergedCrafts.values()).sort((a, b) =>
        a.craft.name.localeCompare(b.craft.name),
      ),
    };
  } else {
    const blueprint = await fetchCraftBlueprint(tx, list.sourceCraftId);
    const rootEntry: CraftEntry = {
      craft: blueprint.craft,
      materials: blueprint.materials,
      products: blueprint.products,
    };
    snapshot = buildSnapshot(
      rootEntry,
      craftModeSet,
      blueprint.subcraftsByItemId,
      list.sourceQuantity,
    );
  }

  await replaceListSnapshot(tx, list.id, snapshot, progress);
}

export async function getComputedUsage(
  dbClient: DbTx | DbClient,
  list: typeof shoppingLists.$inferSelect,
  state?: {
    itemRows: {
      itemId: number;
      requiredQuantity: number;
      stockQuantity: number;
    }[];
    craftRows: {
      craftId: number;
      requiredCount: number;
      stockCount: number;
    }[];
  },
) {
  const craftModeSet = new Set(list.craftModeItemIds);
  const [itemRows, craftRows] = state
    ? [state.itemRows, state.craftRows]
    : await Promise.all([
        dbClient
          .select({
            itemId: shoppingListItems.itemId,
            requiredQuantity: shoppingListItems.requiredQuantity,
            stockQuantity: shoppingListItems.obtainedQuantity,
          })
          .from(shoppingListItems)
          .where(eq(shoppingListItems.shoppingListId, list.id)),
        dbClient
          .select({
            craftId: shoppingListCrafts.craftId,
            requiredCount: shoppingListCrafts.requiredCount,
            stockCount: shoppingListCrafts.completedCount,
          })
          .from(shoppingListCrafts)
          .where(eq(shoppingListCrafts.shoppingListId, list.id)),
      ]);

  const itemUsed = new Map<number, number>();
  const craftUsed = new Map<number, number>();
  const blueprintMap = await fetchCraftBlueprintMap(
    dbClient,
    craftRows.filter((row) => row.stockCount > 0).map((row) => row.craftId),
  );

  craftRows
    .filter((row) => row.stockCount > 0)
    .forEach((row) => {
      const blueprint = blueprintMap.get(row.craftId);
      if (!blueprint) return;
      const snapshot = buildSnapshot(
        {
          craft: blueprint.craft,
          materials: blueprint.materials,
          products: blueprint.products,
        },
        craftModeSet,
        blueprint.subcraftsByItemId,
        row.stockCount,
      );

      for (const item of snapshot.items) {
        itemUsed.set(
          item.item.id,
          (itemUsed.get(item.item.id) ?? 0) + item.requiredQuantity,
        );
      }

      for (const craft of snapshot.crafts) {
        if (craft.craft.id === row.craftId) continue;
        craftUsed.set(
          craft.craft.id,
          (craftUsed.get(craft.craft.id) ?? 0) + craft.requiredCount,
        );
      }
    });

  return {
    items: new Map(
      itemRows.map((row) => [
        row.itemId,
        {
          totalQuantity: row.requiredQuantity,
          stockQuantity: row.stockQuantity,
          usedQuantity: itemUsed.get(row.itemId) ?? 0,
          remainingQuantity: Math.max(
            0,
            row.requiredQuantity -
              row.stockQuantity -
              (itemUsed.get(row.itemId) ?? 0),
          ),
        },
      ]),
    ),
    crafts: new Map(
      craftRows.map((row) => [
        row.craftId,
        {
          totalCount: row.requiredCount,
          stockCount: row.stockCount,
          usedCount: craftUsed.get(row.craftId) ?? 0,
          remainingCount: Math.max(
            0,
            row.requiredCount -
              row.stockCount -
              (craftUsed.get(row.craftId) ?? 0),
          ),
        },
      ]),
    ),
  };
}
