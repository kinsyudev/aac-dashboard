import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { desc, eq, getTableColumns, inArray } from "@acme/db";
import {
  craftMaterials,
  craftProducts,
  crafts,
  items,
  prices,
} from "@acme/db/schema";

import type { createTRPCContext } from "../trpc";
import { memberProcedure } from "../trpc";

const UNSUPPORTED_RECIPE_INGREDIENTS = new Set(["elite trader ticket"]);
const UNSUPPORTED_CRAFT_NAME_PREFIXES = ["trash_"];

function normalizeItemName(name: string): string {
  return name.trim().toLowerCase();
}

export function hasUnsupportedCraftName(name: string): boolean {
  const normalized = normalizeItemName(name);
  return UNSUPPORTED_CRAFT_NAME_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix),
  );
}

function hasUnsupportedRecipeIngredient(
  materials: { item: { name: string } }[],
): boolean {
  return materials.some(({ item }) =>
    UNSUPPORTED_RECIPE_INGREDIENTS.has(normalizeItemName(item.name)),
  );
}

type CraftRow = typeof crafts.$inferSelect;
type ItemRow = typeof items.$inferSelect;

interface CraftMaterialEntry {
  craftId: number;
  amount: number;
  item: ItemRow;
}

interface CraftProductEntry {
  craftId: number;
  amount: number;
  rate: number | null;
  item: ItemRow;
}

export interface CraftWithMaterialsAndProducts {
  craft: CraftRow;
  materials: CraftMaterialEntry[];
  products: CraftProductEntry[];
}

export type SubcraftEntry = CraftWithMaterialsAndProducts;
type CraftDataForItem = {
  item: ItemRow;
  crafts: CraftWithMaterialsAndProducts[];
  prices: {
    itemId: number;
    avg24h: string | null;
    avg7d: string | null;
    avg30d: string | null;
  }[];
  subcraftsByItemId: Record<number, SubcraftEntry[]>;
} | null;

async function getCraftDataForItem(
  ctx: Awaited<ReturnType<typeof createTRPCContext>>,
  itemId: number,
): Promise<CraftDataForItem> {
  // Round 1: item + crafts for item (parallel)
  const [item, craftsForItem] = await Promise.all([
    ctx.db
      .select()
      .from(items)
      .where(eq(items.id, itemId))
      .then((r) => r[0] ?? null),
    ctx.db
      .select()
      .from(crafts)
      .where(eq(crafts.primaryProductId, itemId))
      .then((rows) =>
        rows.filter((craft) => !hasUnsupportedCraftName(craft.name)),
      ),
  ]);

  if (!item) return null;
  if (!craftsForItem.length)
    return {
      item,
      crafts: [],
      prices: [],
      subcraftsByItemId: {},
    };

  const craftIds = craftsForItem.map((c) => c.id);

  // Round 2: materials and products (parallel)
  const [materials, products] = await Promise.all([
    ctx.db
      .select({
        craftId: craftMaterials.craftId,
        amount: craftMaterials.amount,
        item: getTableColumns(items),
      })
      .from(craftMaterials)
      .innerJoin(items, eq(items.id, craftMaterials.itemId))
      .where(inArray(craftMaterials.craftId, craftIds)),
    ctx.db
      .select({
        craftId: craftProducts.craftId,
        amount: craftProducts.amount,
        rate: craftProducts.rate,
        item: getTableColumns(items),
      })
      .from(craftProducts)
      .innerJoin(items, eq(items.id, craftProducts.itemId))
      .where(inArray(craftProducts.craftId, craftIds)),
  ]);

  const materialsByCraft = materials.reduce(
    (acc, m) => {
      (acc[m.craftId] ??= []).push(m);
      return acc;
    },
    {} as Record<number, typeof materials>,
  );
  const productsByCraft = products.reduce(
    (acc, p) => {
      (acc[p.craftId] ??= []).push(p);
      return acc;
    },
    {} as Record<number, typeof products>,
  );
  const supportedCraftsForItem = craftsForItem.filter((craft) => {
    const craftMaterials = materialsByCraft[craft.id] ?? [];
    return !hasUnsupportedRecipeIngredient(craftMaterials);
  });

  if (!supportedCraftsForItem.length) {
    return {
      item,
      crafts: [],
      prices: [],
      subcraftsByItemId: {},
    };
  }

  // Round 3: BFS sub-crafts
  const allMaterialItemIds = new Set<number>(
    supportedCraftsForItem.flatMap((craft) =>
      (materialsByCraft[craft.id] ?? []).map((m) => m.item.id),
    ),
  );

  const subcraftsByItemId: Record<number, SubcraftEntry[]> = {};

  let pendingIds = [...allMaterialItemIds];
  const visited = new Set<number>([itemId, ...pendingIds]);

  while (pendingIds.length > 0) {
    const subCraftsRows = await ctx.db
      .select()
      .from(crafts)
      .where(inArray(crafts.primaryProductId, pendingIds))
      .then((rows) =>
        rows.filter((craft) => !hasUnsupportedCraftName(craft.name)),
      );

    if (!subCraftsRows.length) break;

    const subCraftIds = subCraftsRows.map((c) => c.id);

    const [subMaterials, subProducts] = await Promise.all([
      ctx.db
        .select({
          craftId: craftMaterials.craftId,
          amount: craftMaterials.amount,
          item: getTableColumns(items),
        })
        .from(craftMaterials)
        .innerJoin(items, eq(items.id, craftMaterials.itemId))
        .where(inArray(craftMaterials.craftId, subCraftIds)),
      ctx.db
        .select({
          craftId: craftProducts.craftId,
          amount: craftProducts.amount,
          rate: craftProducts.rate,
          item: getTableColumns(items),
        })
        .from(craftProducts)
        .innerJoin(items, eq(items.id, craftProducts.itemId))
        .where(inArray(craftProducts.craftId, subCraftIds)),
    ]);

    const subMatByCraft = subMaterials.reduce(
      (acc, m) => {
        (acc[m.craftId] ??= []).push(m);
        return acc;
      },
      {} as Record<number, CraftMaterialEntry[]>,
    );
    const subProdByCraft = subProducts.reduce(
      (acc, p) => {
        (acc[p.craftId] ??= []).push(p);
        return acc;
      },
      {} as Record<number, CraftProductEntry[]>,
    );

    const supportedSubCrafts = subCraftsRows.filter((craft) => {
      const craftMaterials = subMatByCraft[craft.id] ?? [];
      return !hasUnsupportedRecipeIngredient(craftMaterials);
    });

    for (const craft of supportedSubCrafts) {
      const pid = craft.primaryProductId;
      if (pid == null) continue;
      (subcraftsByItemId[pid] ??= []).push({
        craft,
        materials: subMatByCraft[craft.id] ?? [],
        products: subProdByCraft[craft.id] ?? [],
      });
    }

    const newIds = supportedSubCrafts
      .flatMap((craft) => subMatByCraft[craft.id] ?? [])
      .map((m) => m.item.id)
      .filter((id) => !visited.has(id));
    for (const id of newIds) {
      visited.add(id);
      allMaterialItemIds.add(id);
    }
    pendingIds = [...new Set(newIds)];
  }

  // Round 4: latest prices for all BFS material ids plus the crafted item
  const pricedItemIds = [itemId, ...allMaterialItemIds];
  const latestPrices =
    pricedItemIds.length > 0
      ? await ctx.db
          .selectDistinctOn([prices.itemId], {
            itemId: prices.itemId,
            avg24h: prices.avg24h,
            avg7d: prices.avg7d,
            avg30d: prices.avg30d,
          })
          .from(prices)
          .where(inArray(prices.itemId, pricedItemIds))
          .orderBy(prices.itemId, desc(prices.fetchedAt))
      : [];
  return {
    item,
    crafts: supportedCraftsForItem.map((craft) => ({
      craft,
      materials: materialsByCraft[craft.id] ?? [],
      products: productsByCraft[craft.id] ?? [],
    })),
    prices: latestPrices,
    subcraftsByItemId,
  };
}

async function getCraftDataForItems(
  ctx: Awaited<ReturnType<typeof createTRPCContext>>,
  itemIds: number[],
): Promise<Record<number, CraftDataForItem>> {
  const rootItemIds = [...new Set(itemIds)];
  if (rootItemIds.length === 0) return {};

  const [rootItems, rootCraftRows] = await Promise.all([
    ctx.db.select().from(items).where(inArray(items.id, rootItemIds)),
    ctx.db
      .select()
      .from(crafts)
      .where(inArray(crafts.primaryProductId, rootItemIds))
      .then((rows) =>
        rows.filter((craft) => !hasUnsupportedCraftName(craft.name)),
      ),
  ]);
  const rootItemsById = new Map(rootItems.map((item) => [item.id, item]));

  const rootCraftIds = rootCraftRows.map((craft) => craft.id);
  const [rootMaterials, rootProducts] =
    rootCraftIds.length > 0
      ? await Promise.all([
          ctx.db
            .select({
              craftId: craftMaterials.craftId,
              amount: craftMaterials.amount,
              item: getTableColumns(items),
            })
            .from(craftMaterials)
            .innerJoin(items, eq(items.id, craftMaterials.itemId))
            .where(inArray(craftMaterials.craftId, rootCraftIds)),
          ctx.db
            .select({
              craftId: craftProducts.craftId,
              amount: craftProducts.amount,
              rate: craftProducts.rate,
              item: getTableColumns(items),
            })
            .from(craftProducts)
            .innerJoin(items, eq(items.id, craftProducts.itemId))
            .where(inArray(craftProducts.craftId, rootCraftIds)),
        ])
      : [[], []];

  const rootMaterialsByCraft = rootMaterials.reduce(
    (acc, material) => {
      (acc[material.craftId] ??= []).push(material);
      return acc;
    },
    {} as Record<number, typeof rootMaterials>,
  );
  const rootProductsByCraft = rootProducts.reduce(
    (acc, product) => {
      (acc[product.craftId] ??= []).push(product);
      return acc;
    },
    {} as Record<number, typeof rootProducts>,
  );
  const supportedRootCraftRows = rootCraftRows.filter((craft) => {
    const materials = rootMaterialsByCraft[craft.id] ?? [];
    return !hasUnsupportedRecipeIngredient(materials);
  });

  const allMaterialItemIds = new Set<number>(
    supportedRootCraftRows.flatMap((craft) =>
      (rootMaterialsByCraft[craft.id] ?? []).map(
        (material) => material.item.id,
      ),
    ),
  );
  const subcraftsByItemId: Record<number, SubcraftEntry[]> = {};
  const visited = new Set<number>([...rootItemIds, ...allMaterialItemIds]);
  let pendingIds = [...allMaterialItemIds];

  while (pendingIds.length > 0) {
    const subCraftRows = await ctx.db
      .select()
      .from(crafts)
      .where(inArray(crafts.primaryProductId, pendingIds))
      .then((rows) =>
        rows.filter((craft) => !hasUnsupportedCraftName(craft.name)),
      );
    if (!subCraftRows.length) break;

    const subCraftIds = subCraftRows.map((craft) => craft.id);
    const [subMaterials, subProducts] = await Promise.all([
      ctx.db
        .select({
          craftId: craftMaterials.craftId,
          amount: craftMaterials.amount,
          item: getTableColumns(items),
        })
        .from(craftMaterials)
        .innerJoin(items, eq(items.id, craftMaterials.itemId))
        .where(inArray(craftMaterials.craftId, subCraftIds)),
      ctx.db
        .select({
          craftId: craftProducts.craftId,
          amount: craftProducts.amount,
          rate: craftProducts.rate,
          item: getTableColumns(items),
        })
        .from(craftProducts)
        .innerJoin(items, eq(items.id, craftProducts.itemId))
        .where(inArray(craftProducts.craftId, subCraftIds)),
    ]);

    const subMaterialsByCraft = subMaterials.reduce(
      (acc, material) => {
        (acc[material.craftId] ??= []).push(material);
        return acc;
      },
      {} as Record<number, CraftMaterialEntry[]>,
    );
    const subProductsByCraft = subProducts.reduce(
      (acc, product) => {
        (acc[product.craftId] ??= []).push(product);
        return acc;
      },
      {} as Record<number, CraftProductEntry[]>,
    );
    const supportedSubCraftRows = subCraftRows.filter((craft) => {
      const materials = subMaterialsByCraft[craft.id] ?? [];
      return !hasUnsupportedRecipeIngredient(materials);
    });

    for (const craft of supportedSubCraftRows) {
      const primaryProductId = craft.primaryProductId;
      if (primaryProductId == null) continue;
      (subcraftsByItemId[primaryProductId] ??= []).push({
        craft,
        materials: subMaterialsByCraft[craft.id] ?? [],
        products: subProductsByCraft[craft.id] ?? [],
      });
    }

    const newIds = supportedSubCraftRows
      .flatMap((craft) => subMaterialsByCraft[craft.id] ?? [])
      .map((material) => material.item.id)
      .filter((id) => !visited.has(id));
    for (const id of newIds) {
      visited.add(id);
      allMaterialItemIds.add(id);
    }
    pendingIds = [...new Set(newIds)];
  }

  const pricedItemIds = [...new Set([...rootItemIds, ...allMaterialItemIds])];
  const latestPrices =
    pricedItemIds.length > 0
      ? await ctx.db
          .selectDistinctOn([prices.itemId], {
            itemId: prices.itemId,
            avg24h: prices.avg24h,
            avg7d: prices.avg7d,
            avg30d: prices.avg30d,
          })
          .from(prices)
          .where(inArray(prices.itemId, pricedItemIds))
          .orderBy(prices.itemId, desc(prices.fetchedAt))
      : [];
  const latestPricesByItemId = new Map(
    latestPrices.map((price) => [price.itemId, price]),
  );

  const craftsByRootItemId = new Map<number, CraftWithMaterialsAndProducts[]>();
  for (const craft of supportedRootCraftRows) {
    const primaryProductId = craft.primaryProductId;
    if (primaryProductId == null) continue;
    const entries = craftsByRootItemId.get(primaryProductId) ?? [];
    entries.push({
      craft,
      materials: rootMaterialsByCraft[craft.id] ?? [],
      products: rootProductsByCraft[craft.id] ?? [],
    });
    craftsByRootItemId.set(primaryProductId, entries);
  }

  const collectReachableCraftData = (
    rootCrafts: CraftWithMaterialsAndProducts[],
  ) => {
    const reachable: Record<number, SubcraftEntry[]> = {};
    const reachableItemIds = new Set<number>();
    const visited = new Set<number>();
    let pendingIds = rootCrafts.flatMap((craft) =>
      craft.materials.map((material) => material.item.id),
    );

    while (pendingIds.length > 0) {
      const nextPendingIds: number[] = [];
      for (const itemId of pendingIds) {
        reachableItemIds.add(itemId);
        if (visited.has(itemId)) continue;
        visited.add(itemId);

        const entries = subcraftsByItemId[itemId];
        if (!entries?.length) continue;
        reachable[itemId] = entries;

        for (const entry of entries) {
          for (const material of entry.materials) {
            reachableItemIds.add(material.item.id);
            nextPendingIds.push(material.item.id);
          }
        }
      }
      pendingIds = nextPendingIds;
    }

    return {
      prices: [...reachableItemIds]
        .flatMap((itemId) => {
          const price = latestPricesByItemId.get(itemId);
          return price ? [price] : [];
        })
        .sort((a, b) => a.itemId - b.itemId),
      subcraftsByItemId: reachable,
    };
  };

  return Object.fromEntries(
    rootItemIds.map((itemId) => {
      const item = rootItemsById.get(itemId);
      if (!item) return [itemId, null] as const;
      const rootCrafts = craftsByRootItemId.get(itemId) ?? [];
      const reachable = collectReachableCraftData(rootCrafts);
      const rootPrice = latestPricesByItemId.get(itemId);
      return [
        itemId,
        {
          item,
          crafts: rootCrafts,
          prices: rootPrice
            ? [rootPrice, ...reachable.prices]
            : reachable.prices,
          subcraftsByItemId: reachable.subcraftsByItemId,
        },
      ] as const;
    }),
  );
}

export const craftsRouter = {
  all: memberProcedure.query(({ ctx }) => {
    return ctx.db
      .select()
      .from(crafts)
      .then((rows) =>
        rows.filter((craft) => !hasUnsupportedCraftName(craft.name)),
      );
  }),
  byId: memberProcedure
    .input(z.number().int())
    .query(async ({ ctx, input }) => {
      const craft = await ctx.db
        .select()
        .from(crafts)
        .where(eq(crafts.id, input))
        .then((rows) => rows[0] ?? null);

      if (!craft) return null;
      if (hasUnsupportedCraftName(craft.name)) return null;

      const [materials, products] = await Promise.all([
        ctx.db
          .select({ amount: craftMaterials.amount, item: items })
          .from(craftMaterials)
          .innerJoin(items, eq(items.id, craftMaterials.itemId))
          .where(eq(craftMaterials.craftId, input)),
        ctx.db
          .select({
            amount: craftProducts.amount,
            rate: craftProducts.rate,
            item: items,
          })
          .from(craftProducts)
          .innerJoin(items, eq(items.id, craftProducts.itemId))
          .where(eq(craftProducts.craftId, input)),
      ]);

      if (hasUnsupportedRecipeIngredient(materials)) return null;

      const materialItemIds = materials.map((m) => m.item.id);

      const subcrafts =
        materialItemIds.length > 0
          ? await ctx.db
              .select({
                craft: crafts,
                materialAmount: craftMaterials.amount,
                materialItem: items,
              })
              .from(crafts)
              .innerJoin(craftMaterials, eq(craftMaterials.craftId, crafts.id))
              .innerJoin(items, eq(items.id, craftMaterials.itemId))
              .where(inArray(crafts.primaryProductId, materialItemIds))
              .then((rows) =>
                rows.filter(
                  (entry) => !hasUnsupportedCraftName(entry.craft.name),
                ),
              )
          : [];

      return { craft, materials, products, subcrafts };
    }),

  byItemId: memberProcedure.input(z.number().int()).query(({ ctx, input }) => {
    return ctx.db
      .select()
      .from(crafts)
      .where(eq(crafts.primaryProductId, input))
      .then((rows) =>
        rows.filter((craft) => !hasUnsupportedCraftName(craft.name)),
      );
  }),

  forItem: memberProcedure
    .input(z.number().int())
    .query(({ ctx, input }) => getCraftDataForItem(ctx, input)),
  forItems: memberProcedure
    .input(z.array(z.number().int()).max(50))
    .query(async ({ ctx, input }) => {
      return getCraftDataForItems(ctx, input);
    }),
  forCraft: memberProcedure
    .input(z.number().int())
    .query(async ({ ctx, input: craftId }) => {
      const craft = await ctx.db
        .select()
        .from(crafts)
        .where(eq(crafts.id, craftId))
        .then((r) => r[0] ?? null);
      if (!craft) return null;
      if (hasUnsupportedCraftName(craft.name)) return null;

      // Round 2: materials, products, primary item (parallel)
      const [materials, products, item] = await Promise.all([
        ctx.db
          .select({
            craftId: craftMaterials.craftId,
            amount: craftMaterials.amount,
            item: getTableColumns(items),
          })
          .from(craftMaterials)
          .innerJoin(items, eq(items.id, craftMaterials.itemId))
          .where(eq(craftMaterials.craftId, craftId)),
        ctx.db
          .select({
            craftId: craftProducts.craftId,
            amount: craftProducts.amount,
            rate: craftProducts.rate,
            item: getTableColumns(items),
          })
          .from(craftProducts)
          .innerJoin(items, eq(items.id, craftProducts.itemId))
          .where(eq(craftProducts.craftId, craftId)),
        craft.primaryProductId
          ? ctx.db
              .select()
              .from(items)
              .where(eq(items.id, craft.primaryProductId))
              .then((r) => r[0] ?? null)
          : Promise.resolve(null),
      ]);

      if (hasUnsupportedRecipeIngredient(materials)) return null;

      // Round 3: BFS subcrafts
      const allMaterialItemIds = new Set<number>(
        materials.map((m) => m.item.id),
      );

      const subcraftsByItemId: Record<number, SubcraftEntry[]> = {};

      let pendingIds = [...allMaterialItemIds];
      const visited = new Set<number>([
        craft.primaryProductId ?? -1,
        ...pendingIds,
      ]);

      while (pendingIds.length > 0) {
        const subCraftsRows = await ctx.db
          .select()
          .from(crafts)
          .where(inArray(crafts.primaryProductId, pendingIds))
          .then((rows) =>
            rows.filter((craft) => !hasUnsupportedCraftName(craft.name)),
          );

        if (!subCraftsRows.length) break;

        const subCraftIds = subCraftsRows.map((c) => c.id);

        const [subMaterials, subProducts] = await Promise.all([
          ctx.db
            .select({
              craftId: craftMaterials.craftId,
              amount: craftMaterials.amount,
              item: getTableColumns(items),
            })
            .from(craftMaterials)
            .innerJoin(items, eq(items.id, craftMaterials.itemId))
            .where(inArray(craftMaterials.craftId, subCraftIds)),
          ctx.db
            .select({
              craftId: craftProducts.craftId,
              amount: craftProducts.amount,
              rate: craftProducts.rate,
              item: getTableColumns(items),
            })
            .from(craftProducts)
            .innerJoin(items, eq(items.id, craftProducts.itemId))
            .where(inArray(craftProducts.craftId, subCraftIds)),
        ]);

        const subMatByCraft = subMaterials.reduce(
          (acc, m) => {
            (acc[m.craftId] ??= []).push(m);
            return acc;
          },
          {} as Record<number, CraftMaterialEntry[]>,
        );
        const subProdByCraft = subProducts.reduce(
          (acc, p) => {
            (acc[p.craftId] ??= []).push(p);
            return acc;
          },
          {} as Record<number, CraftProductEntry[]>,
        );

        const supportedSubCrafts = subCraftsRows.filter((subCraft) => {
          const craftMaterials = subMatByCraft[subCraft.id] ?? [];
          return !hasUnsupportedRecipeIngredient(craftMaterials);
        });

        for (const subCraft of supportedSubCrafts) {
          const pid = subCraft.primaryProductId;
          if (pid == null) continue;
          (subcraftsByItemId[pid] ??= []).push({
            craft: subCraft,
            materials: subMatByCraft[subCraft.id] ?? [],
            products: subProdByCraft[subCraft.id] ?? [],
          });
        }

        const newIds = supportedSubCrafts
          .flatMap((subCraft) => subMatByCraft[subCraft.id] ?? [])
          .map((m) => m.item.id)
          .filter((id) => !visited.has(id));
        for (const id of newIds) {
          visited.add(id);
          allMaterialItemIds.add(id);
        }
        pendingIds = [...new Set(newIds)];
      }

      // Round 4: latest prices for all BFS material ids plus the primary item
      const pricedItemIds = [
        craft.primaryProductId,
        ...allMaterialItemIds,
      ].filter((value): value is number => value != null);
      const latestPrices =
        pricedItemIds.length > 0
          ? await ctx.db
              .selectDistinctOn([prices.itemId], {
                itemId: prices.itemId,
                avg24h: prices.avg24h,
                avg7d: prices.avg7d,
                avg30d: prices.avg30d,
              })
              .from(prices)
              .where(inArray(prices.itemId, pricedItemIds))
              .orderBy(prices.itemId, desc(prices.fetchedAt))
          : [];

      return {
        craft,
        item,
        materials,
        products,
        prices: latestPrices,
        subcraftsByItemId,
      };
    }),
} satisfies TRPCRouterRecord;
