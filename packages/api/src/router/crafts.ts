import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { desc, eq, getTableColumns, inArray } from "@acme/db";
import {
  craftMaterials,
  craftProducts,
  crafts,
  items,
  prices,
  userPriceOverrides,
} from "@acme/db/schema";

import { protectedProcedure } from "../trpc";

export const craftsRouter = {
  all: protectedProcedure.query(({ ctx }) => {
    return ctx.db.select().from(crafts);
  }),
  byId: protectedProcedure
    .input(z.number().int())
    .query(async ({ ctx, input }) => {
      const craft = await ctx.db
        .select()
        .from(crafts)
        .where(eq(crafts.id, input))
        .then((rows) => rows[0] ?? null);

      if (!craft) return null;

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
          : [];

      return { craft, materials, products, subcrafts };
    }),

  byItemId: protectedProcedure
    .input(z.number().int())
    .query(({ ctx, input }) => {
      return ctx.db
        .select()
        .from(crafts)
        .where(eq(crafts.primaryProductId, input));
    }),

  forItem: protectedProcedure
    .input(z.number().int())
    .query(async ({ ctx, input: itemId }) => {
      const userId = ctx.session.user.id;

      // Round 1: item + crafts for item + user overrides (parallel)
      const [item, craftsForItem, overrides] = await Promise.all([
        ctx.db
          .select()
          .from(items)
          .where(eq(items.id, itemId))
          .then((r) => r[0] ?? null),
        ctx.db.select().from(crafts).where(eq(crafts.primaryProductId, itemId)),
        ctx.db
          .select({
            itemId: userPriceOverrides.itemId,
            price: userPriceOverrides.price,
          })
          .from(userPriceOverrides)
          .where(eq(userPriceOverrides.userId, userId)),
      ]);

      if (!item) return null;
      if (!craftsForItem.length) return { item, crafts: [], prices: [], overrides };

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

      // Round 3: BFS sub-crafts
      const allMaterialItemIds = new Set<number>(materials.map((m) => m.item.id));

      type SubcraftMaterial = { craftId: number; amount: number; item: typeof items.$inferSelect };
      type SubcraftProduct = { craftId: number; amount: number; rate: number | null; item: typeof items.$inferSelect };
      type SubcraftEntry = {
        craft: typeof crafts.$inferSelect;
        materials: SubcraftMaterial[];
        products: SubcraftProduct[];
      };

      const subcraftsByItemId: Record<number, SubcraftEntry[]> = {};

      let pendingIds = [...allMaterialItemIds];
      const visited = new Set<number>([itemId, ...pendingIds]);

      while (pendingIds.length > 0) {
        const subCraftsRows = await ctx.db
          .select()
          .from(crafts)
          .where(inArray(crafts.primaryProductId, pendingIds));

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
          (acc, m) => { (acc[m.craftId] ??= []).push(m); return acc; },
          {} as Record<number, SubcraftMaterial[]>,
        );
        const subProdByCraft = subProducts.reduce(
          (acc, p) => { (acc[p.craftId] ??= []).push(p); return acc; },
          {} as Record<number, SubcraftProduct[]>,
        );

        for (const craft of subCraftsRows) {
          const pid = craft.primaryProductId!;
          (subcraftsByItemId[pid] ??= []).push({
            craft,
            materials: subMatByCraft[craft.id] ?? [],
            products: subProdByCraft[craft.id] ?? [],
          });
        }

        const newIds = subMaterials
          .map((m) => m.item.id)
          .filter((id) => !visited.has(id));
        for (const id of newIds) { visited.add(id); allMaterialItemIds.add(id); }
        pendingIds = [...new Set(newIds)];
      }

      // Round 4: latest prices for all BFS material ids
      const latestPrices = allMaterialItemIds.size > 0
        ? await ctx.db
            .selectDistinctOn([prices.itemId], {
              itemId: prices.itemId,
              avg24h: prices.avg24h,
              avg7d: prices.avg7d,
            })
            .from(prices)
            .where(inArray(prices.itemId, [...allMaterialItemIds]))
            .orderBy(prices.itemId, desc(prices.fetchedAt))
        : [];

      return {
        item,
        crafts: craftsForItem.map((craft) => ({
          craft,
          materials: materialsByCraft[craft.id] ?? [],
          products: productsByCraft[craft.id] ?? [],
        })),
        prices: latestPrices,
        overrides,
        subcraftsByItemId,
      };
    }),
  forCraft: protectedProcedure
    .input(z.number().int())
    .query(async ({ ctx, input: craftId }) => {
      const userId = ctx.session.user.id;

      // Round 1: craft + user overrides (parallel)
      const [craft, overrides] = await Promise.all([
        ctx.db
          .select()
          .from(crafts)
          .where(eq(crafts.id, craftId))
          .then((r) => r[0] ?? null),
        ctx.db
          .select({
            itemId: userPriceOverrides.itemId,
            price: userPriceOverrides.price,
          })
          .from(userPriceOverrides)
          .where(eq(userPriceOverrides.userId, userId)),
      ]);
      if (!craft) return null;

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

      // Round 3: BFS subcrafts
      const allMaterialItemIds = new Set<number>(materials.map((m) => m.item.id));

      type SubcraftMaterial = {
        craftId: number;
        amount: number;
        item: typeof items.$inferSelect;
      };
      type SubcraftProduct = {
        craftId: number;
        amount: number;
        rate: number | null;
        item: typeof items.$inferSelect;
      };
      type SubcraftEntry = {
        craft: typeof crafts.$inferSelect;
        materials: SubcraftMaterial[];
        products: SubcraftProduct[];
      };

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
          .where(inArray(crafts.primaryProductId, pendingIds));

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
          {} as Record<number, SubcraftMaterial[]>,
        );
        const subProdByCraft = subProducts.reduce(
          (acc, p) => {
            (acc[p.craftId] ??= []).push(p);
            return acc;
          },
          {} as Record<number, SubcraftProduct[]>,
        );

        for (const subCraft of subCraftsRows) {
          const pid = subCraft.primaryProductId!;
          (subcraftsByItemId[pid] ??= []).push({
            craft: subCraft,
            materials: subMatByCraft[subCraft.id] ?? [],
            products: subProdByCraft[subCraft.id] ?? [],
          });
        }

        const newIds = subMaterials
          .map((m) => m.item.id)
          .filter((id) => !visited.has(id));
        for (const id of newIds) {
          visited.add(id);
          allMaterialItemIds.add(id);
        }
        pendingIds = [...new Set(newIds)];
      }

      // Round 4: latest prices for all BFS material ids
      const latestPrices =
        allMaterialItemIds.size > 0
          ? await ctx.db
              .selectDistinctOn([prices.itemId], {
                itemId: prices.itemId,
                avg24h: prices.avg24h,
                avg7d: prices.avg7d,
              })
              .from(prices)
              .where(inArray(prices.itemId, [...allMaterialItemIds]))
              .orderBy(prices.itemId, desc(prices.fetchedAt))
          : [];

      return {
        craft,
        item,
        materials,
        products,
        prices: latestPrices,
        overrides,
        subcraftsByItemId,
      };
    }),
} satisfies TRPCRouterRecord;
