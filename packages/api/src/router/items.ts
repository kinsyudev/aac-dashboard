import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { desc, eq } from "@acme/db";
import { prices } from "@acme/db/schema";

import { protectedProcedure } from "../trpc";

export const itemsRouter = {
  price: protectedProcedure
    .input(z.number().int())
    .query(({ ctx, input }) => {
      return ctx.db
        .select()
        .from(prices)
        .where(eq(prices.itemId, input))
        .orderBy(desc(prices.fetchedAt))
        .limit(1)
        .then((rows) => rows[0] ?? null);
    }),

  priceHistory: protectedProcedure
    .input(z.number().int())
    .query(({ ctx, input }) => {
      return ctx.db
        .select()
        .from(prices)
        .where(eq(prices.itemId, input))
        .orderBy(desc(prices.fetchedAt));
    }),
} satisfies TRPCRouterRecord;
