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

      // Round 2: materials, products, and latest prices via join (parallel)
      const [materials, products, latestPrices] = await Promise.all([
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
        ctx.db
          .selectDistinctOn([prices.itemId], {
            itemId: prices.itemId,
            avg24h: prices.avg24h,
            avg7d: prices.avg7d,
          })
          .from(prices)
          .innerJoin(craftMaterials, eq(craftMaterials.itemId, prices.itemId))
          .where(inArray(craftMaterials.craftId, craftIds))
          .orderBy(prices.itemId, desc(prices.fetchedAt)),
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

      return {
        item,
        crafts: craftsForItem.map((craft) => ({
          craft,
          materials: materialsByCraft[craft.id] ?? [],
          products: productsByCraft[craft.id] ?? [],
        })),
        prices: latestPrices,
        overrides,
      };
    }),
} satisfies TRPCRouterRecord;
