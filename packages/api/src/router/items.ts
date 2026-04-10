import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { asc, desc, eq, getTableColumns, ilike, like } from "@acme/db";
import { crafts, items, prices } from "@acme/db/schema";

import { protectedProcedure } from "../trpc";

export const itemsRouter = {
  price: protectedProcedure.input(z.number().int()).query(({ ctx, input }) => {
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

  byId: protectedProcedure.input(z.number().int()).query(({ ctx, input }) => {
    return ctx.db
      .select({ ...getTableColumns(items), labor: crafts.labor })
      .from(items)
      .leftJoin(crafts, eq(crafts.primaryProductId, items.id))
      .where(eq(items.id, input))
      .then((rows) => rows[0] ?? null);
  }),

  craftable: protectedProcedure.query(({ ctx }) => {
    return ctx.db
      .selectDistinctOn([items.id], {
        ...getTableColumns(items),
        labor: crafts.labor,
      })
      .from(items)
      .innerJoin(crafts, eq(crafts.primaryProductId, items.id))
      .orderBy(items.id, asc(items.category), asc(items.name));
  }),

  byName: protectedProcedure.input(z.string()).query(({ ctx, input }) => {
    return ctx.db
      .select({ ...getTableColumns(items), labor: crafts.labor })
      .from(items)
      .leftJoin(crafts, eq(crafts.primaryProductId, items.id))
      .where(like(items.name, input))
      .orderBy(items.name);
  }),

  search: protectedProcedure.input(z.string().min(2)).query(({ ctx, input }) => {
    return ctx.db
      .select({ id: items.id, name: items.name, icon: items.icon })
      .from(items)
      .where(ilike(items.name, `%${input}%`))
      .orderBy(items.name)
      .limit(10);
  }),
} satisfies TRPCRouterRecord;
