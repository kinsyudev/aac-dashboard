import { inArray, sql } from "@acme/db";
import type { db as appDb } from "@acme/db/client";
import { craftMaterials, craftProducts, crafts, items } from "@acme/db/schema";

export interface CustomCraft {
  id: number;
  labor: number;
  product: { itemId: number; amount: number };
  materials: { itemId: number; amount: number }[];
}

// Recipes that aa-classic.com doesn't list. They use IDs far above the
// upstream range so a sync never collides with them, and sync-items re-applies
// them after every run (including --full-refresh, which deletes all crafts).
// Craft names come from the product item's name in the DB.
export const CUSTOM_CRAFTS = [
  {
    id: 990_000_001,
    labor: 1500,
    product: { itemId: 43131, amount: 1 },
    materials: [{ itemId: 43128, amount: 200 }],
  },
  {
    id: 990_000_002,
    labor: 1500,
    product: { itemId: 43130, amount: 1 },
    materials: [{ itemId: 43129, amount: 200 }],
  },
] as const satisfies readonly CustomCraft[];

export function customCraftItemIds(customCrafts: readonly CustomCraft[]) {
  return [
    ...new Set(
      customCrafts.flatMap((craft) => [
        craft.product.itemId,
        ...craft.materials.map((material) => material.itemId),
      ]),
    ),
  ];
}

export async function applyCustomCrafts(
  database: typeof appDb,
  customCrafts: readonly CustomCraft[] = CUSTOM_CRAFTS,
) {
  if (customCrafts.length === 0) return;

  const itemIds = customCraftItemIds(customCrafts);
  const knownItems = new Map(
    (
      await database
        .select({ id: items.id, name: items.name })
        .from(items)
        .where(inArray(items.id, itemIds))
    ).map((item) => [item.id, item.name]),
  );
  const missingItemIds = itemIds.filter((id) => !knownItems.has(id));
  if (missingItemIds.length > 0) {
    throw new Error(
      `Custom crafts reference items missing from the DB: ${missingItemIds.join(", ")}`,
    );
  }

  const craftIds = customCrafts.map((craft) => craft.id);
  await database.transaction(async (tx) => {
    await tx
      .insert(crafts)
      .values(
        customCrafts.map((craft) => ({
          id: craft.id,
          name: knownItems.get(craft.product.itemId) ?? "",
          labor: craft.labor,
          castDelayMs: 0,
          primaryProductId: craft.product.itemId,
        })),
      )
      .onConflictDoUpdate({
        target: crafts.id,
        set: {
          name: sql`excluded.name`,
          labor: sql`excluded.labor`,
          castDelayMs: sql`excluded.cast_delay_ms`,
          primaryProductId: sql`excluded.primary_product_id`,
        },
      });

    await tx
      .delete(craftMaterials)
      .where(inArray(craftMaterials.craftId, craftIds));
    await tx
      .delete(craftProducts)
      .where(inArray(craftProducts.craftId, craftIds));

    await tx.insert(craftProducts).values(
      customCrafts.map((craft) => ({
        craftId: craft.id,
        itemId: craft.product.itemId,
        amount: craft.product.amount,
        rate: 100,
      })),
    );
    await tx.insert(craftMaterials).values(
      customCrafts.flatMap((craft) =>
        craft.materials.map((material) => ({
          craftId: craft.id,
          itemId: material.itemId,
          amount: material.amount,
        })),
      ),
    );
  });

  for (const craft of customCrafts) {
    console.log(
      `  Custom craft ${craft.id}: ${knownItems.get(craft.product.itemId)} (${craft.labor} labor)`,
    );
  }
}
