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
  shoppingListSources,
} from "@acme/db/schema";

const MAX_DEPTH = 8;
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
type ShoppingListRow = typeof shoppingLists.$inferSelect;
type ShoppingListSourceRow = typeof shoppingListSources.$inferSelect;

const armorSealByPiece = {
  head: "Medium Mana Seal",
  chest: "Chest Mana Seal",
  waist: "Small Mana Seal",
  wrists: "Small Mana Seal",
  hands: "Medium Mana Seal",
  legs: "Pants Mana Seal",
  feet: "Medium Mana Seal",
} as const;

const weaponSealByType = {
  Musical: "Musical Mana Seal",
  "1h": "One-Hander Mana Seal",
  "2h": "Two-Hander Mana Seal",
  Wooden: "Wooden Mana Seal",
} as const;

const weaponTokensByType = {
  "1h": ["Dagger", "Sword", "Katana", "Axe", "Club", "Shortspear"],
  "2h": ["Greatsword", "Nodachi", "Greataxe", "Greatclub", "Longspear"],
  Musical: ["Lute", "Flute"],
  Wooden: ["Bow", "Scepter", "Staff", "Shield"],
} as const;

const armorTokensByPiece = {
  head: ["hood", "cap", "helm", "helmet"],
  chest: ["shirt", "jerkin", "cuirass"],
  waist: ["belt"],
  wrists: ["guards", "vambraces", "bracers"],
  hands: ["gloves", "fists", "gauntlets"],
  legs: ["pants", "breeches", "greaves"],
  feet: ["shoes", "boots", "sabatons"],
} as const;

type ArmorPiece = keyof typeof armorSealByPiece;
type WeaponType = keyof typeof weaponSealByType;

function resolveDelphinadManaSealName(sourceItem: ItemRow | null) {
  if (!sourceItem) return null;

  const searchable = `${sourceItem.name} ${sourceItem.category}`.toLowerCase();
  if (!searchable.includes("delphinad")) return null;

  for (const [piece, tokens] of Object.entries(armorTokensByPiece)) {
    if (!tokens.some((token) => searchable.includes(token))) continue;

    const category = sourceItem.category.toLowerCase();
    const armorMaterial = category.includes("cloth")
      ? "Cloth"
      : category.includes("leather")
        ? "Leather"
        : category.includes("plate")
          ? "Plate"
          : null;
    if (!armorMaterial) return null;

    return `Delphinad ${armorMaterial} ${armorSealByPiece[piece as ArmorPiece]}`;
  }

  for (const [weaponType, tokens] of Object.entries(weaponTokensByType)) {
    if (tokens.some((token) => searchable.includes(token.toLowerCase()))) {
      return `Delphinad ${weaponSealByType[weaponType as WeaponType]}`;
    }
  }

  if (searchable.includes("necklace")) {
    return "Delphinad Large Jewelry Mana Seal";
  }
  if (searchable.includes("ring") || searchable.includes("earring")) {
    return "Delphinad Small Jewelry Mana Seal";
  }

  return null;
}

function isConsumedUpgradeGearMaterial(
  material: ItemRow,
  sourceItem: ItemRow | null,
): boolean {
  if (!sourceItem) return false;

  const lower = material.name.toLowerCase();
  if (!lower.includes("delphinad") && !lower.includes("ayanad")) return false;
  if (lower.includes("scroll")) return false;

  if (material.category.toLowerCase() === sourceItem.category.toLowerCase()) {
    return true;
  }

  const sourceSearchable =
    `${sourceItem.name} ${sourceItem.category}`.toLowerCase();
  for (const tokens of Object.values(armorTokensByPiece)) {
    if (!tokens.some((token) => sourceSearchable.includes(token))) continue;
    return tokens.some((token) => lower.includes(token));
  }

  if (sourceSearchable.includes("necklace")) return lower.includes("necklace");
  if (sourceSearchable.includes("ring")) return lower.includes("ring");
  if (sourceSearchable.includes("earring")) return lower.includes("earring");

  return false;
}

function pickPreferredCraft<
  T extends { products: { item: { id: number }; amount: number }[] },
>(entries: T[], itemId: number): T {
  const preferred = [...entries].sort((a, b) => {
    const amountFor = (entry: T) =>
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

function getMatchingAyanadName(name: string): string | null {
  if (!name.toLowerCase().includes("sealed delphinad")) return null;
  return name.replace(/delphinad/i, "Ayanad");
}

async function resolveAyanadUpgradeBlueprint(
  dbClient: DbClient | DbTx,
  sourceItem: ItemRow | null,
): Promise<CraftBlueprint | null> {
  const ayanadItemName = sourceItem
    ? getMatchingAyanadName(sourceItem.name)
    : null;
  if (!ayanadItemName) return null;

  const [ayanadItem] = await dbClient
    .select()
    .from(items)
    .where(eq(items.name, ayanadItemName))
    .limit(1);

  if (!ayanadItem) return null;

  const ayanadCraftRows = await dbClient
    .select()
    .from(crafts)
    .where(eq(crafts.primaryProductId, ayanadItem.id));

  const supportedCrafts = ayanadCraftRows.filter(
    (craft) => !craft.name.startsWith("trash_"),
  );
  if (!supportedCrafts.length) return null;

  const blueprintMap = await fetchCraftBlueprintMap(
    dbClient,
    supportedCrafts.map((craft) => craft.id),
  );
  const preferredBlueprint = pickPreferredCraft(
    supportedCrafts
      .map((craft) => blueprintMap.get(craft.id))
      .filter((blueprint): blueprint is CraftBlueprint => blueprint != null),
    ayanadItem.id,
  );

  return preferredBlueprint;
}

async function resolvePrimaryCraftBlueprintForItemName(
  dbClient: DbClient | DbTx,
  itemName: string | null,
): Promise<CraftBlueprint | null> {
  if (!itemName) return null;

  const [targetItem] = await dbClient
    .select()
    .from(items)
    .where(eq(items.name, itemName))
    .limit(1);

  if (!targetItem) return null;

  const craftRows = await dbClient
    .select()
    .from(crafts)
    .where(eq(crafts.primaryProductId, targetItem.id));

  const supportedCrafts = craftRows.filter(
    (craft) => !craft.name.startsWith("trash_"),
  );
  if (!supportedCrafts.length) return null;

  const blueprintMap = await fetchCraftBlueprintMap(
    dbClient,
    supportedCrafts.map((craft) => craft.id),
  );

  return pickPreferredCraft(
    supportedCrafts
      .map((craft) => blueprintMap.get(craft.id))
      .filter((blueprint): blueprint is CraftBlueprint => blueprint != null),
    targetItem.id,
  );
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

export async function getListSources(
  dbClient: DbTx | DbClient,
  shoppingListId: string,
): Promise<ShoppingListSourceRow[]> {
  return dbClient
    .select()
    .from(shoppingListSources)
    .where(eq(shoppingListSources.shoppingListId, shoppingListId));
}

function mergeSnapshots(snapshots: Snapshot[]): Snapshot {
  const mergedItems = new Map<number, SnapshotItemRow>();
  const mergedCrafts = new Map<number, SnapshotCraftRow>();

  for (const snapshot of snapshots) {
    for (const row of snapshot.items) {
      const existing = mergedItems.get(row.item.id);
      if (existing) existing.requiredQuantity += row.requiredQuantity;
      else mergedItems.set(row.item.id, { ...row });
    }

    for (const row of snapshot.crafts) {
      const existing = mergedCrafts.get(row.craft.id);
      if (existing) existing.requiredCount += row.requiredCount;
      else mergedCrafts.set(row.craft.id, { ...row });
    }
  }

  return {
    items: Array.from(mergedItems.values()).sort((a, b) =>
      a.item.name.localeCompare(b.item.name),
    ),
    crafts: Array.from(mergedCrafts.values()).sort((a, b) =>
      a.craft.name.localeCompare(b.craft.name),
    ),
  };
}

function buildSnapshotForSimulatorSource(
  blueprint: CraftBlueprint,
  ayanadBlueprint: CraftBlueprint | null,
  craftModeSet: Set<number>,
  quantity: number,
): Snapshot {
  const finalUpgradeEntry: CraftEntry | null = ayanadBlueprint
    ? {
        craft: ayanadBlueprint.craft,
        materials: ayanadBlueprint.materials.filter(
          (material: MaterialRow) =>
            !isConsumedUpgradeGearMaterial(material.item, blueprint.item),
        ),
        products: ayanadBlueprint.products,
      }
    : null;

  return mergeSnapshots([
    buildSnapshot(
      {
        craft: blueprint.craft,
        materials: blueprint.materials,
        products: blueprint.products,
      },
      craftModeSet,
      blueprint.subcraftsByItemId,
      quantity,
    ),
    finalUpgradeEntry
      ? buildSnapshot(
          finalUpgradeEntry,
          craftModeSet,
          ayanadBlueprint?.subcraftsByItemId ?? blueprint.subcraftsByItemId,
          1,
        )
      : { items: [], crafts: [] },
  ]);
}

async function buildSnapshotForResealSimulatorSource(
  dbClient: DbClient | DbTx,
  blueprint: CraftBlueprint,
  ayanadBlueprint: CraftBlueprint | null,
  craftModeSet: Set<number>,
  failedRetries: number,
): Promise<Snapshot> {
  const manaSealBlueprint = await resolvePrimaryCraftBlueprintForItemName(
    dbClient,
    resolveDelphinadManaSealName(blueprint.item),
  );
  if (!manaSealBlueprint) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Could not resolve Delphinad mana seal craft for this item.",
    });
  }

  const finalUpgradeEntry: CraftEntry | null = ayanadBlueprint
    ? {
        craft: ayanadBlueprint.craft,
        materials: ayanadBlueprint.materials.filter(
          (material: MaterialRow) =>
            !isConsumedUpgradeGearMaterial(material.item, blueprint.item),
        ),
        products: ayanadBlueprint.products,
      }
    : null;

  const manaSealItemId = manaSealBlueprint?.item?.id ?? null;
  const manaSealProduced =
    manaSealBlueprint && manaSealItemId != null
      ? (manaSealBlueprint.products.find(
          (product) => product.item.id === manaSealItemId,
        )?.amount ?? 1)
      : 1;
  const manaSealBatches = Math.ceil(failedRetries / manaSealProduced);

  return mergeSnapshots([
    buildSnapshot(
      {
        craft: blueprint.craft,
        materials: blueprint.materials,
        products: blueprint.products,
      },
      craftModeSet,
      blueprint.subcraftsByItemId,
      1,
    ),
    buildSnapshot(
      {
        craft: manaSealBlueprint.craft,
        materials: manaSealBlueprint.materials,
        products: manaSealBlueprint.products,
      },
      craftModeSet,
      manaSealBlueprint.subcraftsByItemId,
      manaSealBatches,
    ),
    finalUpgradeEntry
      ? buildSnapshot(
          finalUpgradeEntry,
          craftModeSet,
          ayanadBlueprint?.subcraftsByItemId ?? blueprint.subcraftsByItemId,
          1,
        )
      : { items: [], crafts: [] },
  ]);
}

async function buildSourceSnapshot(
  tx: DbTx,
  source: ShoppingListSourceRow,
  craftModeSet: Set<number>,
): Promise<Snapshot> {
  const blueprint = await fetchCraftBlueprint(tx, source.craftId);

  if (source.sourceType === "simulator") {
    const ayanadBlueprint = await resolveAyanadUpgradeBlueprint(
      tx,
      blueprint.item,
    );
    return buildSnapshotForSimulatorSource(
      blueprint,
      ayanadBlueprint,
      craftModeSet,
      source.quantity,
    );
  }

  if (source.sourceType === "resealSimulator") {
    const ayanadBlueprint = await resolveAyanadUpgradeBlueprint(
      tx,
      blueprint.item,
    );
    return buildSnapshotForResealSimulatorSource(
      tx,
      blueprint,
      ayanadBlueprint,
      craftModeSet,
      source.quantity,
    );
  }

  return buildSnapshot(
    {
      craft: blueprint.craft,
      materials: blueprint.materials,
      products: blueprint.products,
    },
    craftModeSet,
    blueprint.subcraftsByItemId,
    source.quantity,
  );
}

export function getSourceKind(
  sources: Pick<ShoppingListSourceRow, "sourceType">[],
): "empty" | "craft" | "simulator" {
  if (sources.length === 0) return "empty";
  return sources[0]?.sourceType === "simulator" ||
    sources[0]?.sourceType === "resealSimulator"
    ? "simulator"
    : "craft";
}

export function assertValidListSources(
  sources: Pick<ShoppingListSourceRow, "sourceType">[],
) {
  if (sources.length === 0) return;

  const hasCraft = sources.some((source) => source.sourceType === "craft");
  const hasSimulator = sources.some(
    (source) =>
      source.sourceType === "simulator" ||
      source.sourceType === "resealSimulator",
  );

  if (hasCraft && hasSimulator) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Shopping lists cannot mix craft and simulator sources.",
    });
  }

  if (hasSimulator && sources.length > 1) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Simulator shopping lists can only have one source.",
    });
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
  list: ShoppingListRow,
  progress?: {
    itemProgress?: Map<number, number>;
    craftProgress?: Map<number, number>;
  },
) {
  const craftModeSet = new Set(list.craftModeItemIds);
  const sources = await getListSources(tx, list.id);
  assertValidListSources(sources);
  const snapshot = mergeSnapshots(
    await Promise.all(
      sources
        .sort(
          (a, b) =>
            a.position - b.position ||
            a.createdAt.getTime() - b.createdAt.getTime(),
        )
        .map((source) => buildSourceSnapshot(tx, source, craftModeSet)),
    ),
  );

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
