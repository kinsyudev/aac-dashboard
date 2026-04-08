import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { eq, inArray } from "@acme/db";
import { craftMaterials, craftProducts, crafts, items } from "@acme/db/schema";

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
} satisfies TRPCRouterRecord;
