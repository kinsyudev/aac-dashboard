import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { and, desc, eq, inArray } from "@acme/db";
import { items, prices, userPriceOverrides } from "@acme/db/schema";

import { protectedProcedure } from "../trpc";

export const profileRouter = {
  getPriceOverrides: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const overrides = await ctx.db
      .select({
        itemId: userPriceOverrides.itemId,
        price: userPriceOverrides.price,
        updatedAt: userPriceOverrides.updatedAt,
        itemName: items.name,
        itemIcon: items.icon,
      })
      .from(userPriceOverrides)
      .innerJoin(items, eq(items.id, userPriceOverrides.itemId))
      .where(eq(userPriceOverrides.userId, userId))
      .orderBy(items.name);

    if (overrides.length === 0) return [];

    const itemIds = overrides.map((o) => o.itemId);
    const latestPrices = await ctx.db
      .selectDistinctOn([prices.itemId], {
        itemId: prices.itemId,
        avg24h: prices.avg24h,
        avg7d: prices.avg7d,
      })
      .from(prices)
      .where(inArray(prices.itemId, itemIds))
      .orderBy(prices.itemId, desc(prices.fetchedAt));

    const priceMap = new Map(latestPrices.map((p) => [p.itemId, p]));

    return overrides.map((o) => ({
      ...o,
      marketPrice: priceMap.get(o.itemId) ?? null,
    }));
  }),

  setPriceOverride: protectedProcedure
    .input(z.object({ itemId: z.number().int(), price: z.number().positive() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const priceStr = input.price.toFixed(2);
      await ctx.db
        .insert(userPriceOverrides)
        .values({
          userId,
          itemId: input.itemId,
          price: priceStr,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [userPriceOverrides.userId, userPriceOverrides.itemId],
          set: { price: priceStr, updatedAt: new Date() },
        });
    }),

  deletePriceOverride: protectedProcedure
    .input(z.number().int())
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await ctx.db
        .delete(userPriceOverrides)
        .where(
          and(
            eq(userPriceOverrides.userId, userId),
            eq(userPriceOverrides.itemId, input),
          ),
        );
    }),
} satisfies TRPCRouterRecord;
