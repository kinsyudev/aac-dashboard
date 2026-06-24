import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { desc, eq, getTableColumns, inArray } from "@acme/db";
import { craftMaterials, crafts, items, prices } from "@acme/db/schema";

import type { CraftWithMaterialsAndProducts } from "./crafts";
import { memberProcedure } from "../trpc";
import { hasUnsupportedCraftName } from "./crafts";

const REWARD_PRICE_ITEM_IDS = [32103, 32106, 26880] as const;

export const tradePacksRouter = {
  dataForItems: memberProcedure
    .input(z.object({ itemIds: z.array(z.number().int()).min(1) }))
    .query(async ({ ctx, input }) => {
      const itemIds = [...new Set(input.itemIds)];

      const craftRows = await ctx.db
        .select()
        .from(crafts)
        .where(inArray(crafts.primaryProductId, itemIds))
        .then((rows) =>
          rows.filter((craft) => !hasUnsupportedCraftName(craft.name)),
        );

      const craftIds = craftRows.map((craft) => craft.id);

      const materialRows =
        craftIds.length > 0
          ? await ctx.db
              .select({
                craftId: craftMaterials.craftId,
                amount: craftMaterials.amount,
                item: getTableColumns(items),
              })
              .from(craftMaterials)
              .innerJoin(items, eq(items.id, craftMaterials.itemId))
              .where(inArray(craftMaterials.craftId, craftIds))
          : [];

      const materialItemIds = materialRows.map((row) => row.item.id);
      const pricedItemIds = [
        ...new Set([...materialItemIds, ...REWARD_PRICE_ITEM_IDS]),
      ];

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

      const materialsByCraftId = materialRows.reduce(
        (acc, row) => {
          (acc[row.craftId] ??= []).push({
            craftId: row.craftId,
            amount: row.amount,
            item: row.item,
          });
          return acc;
        },
        {} as Record<number, CraftWithMaterialsAndProducts["materials"]>,
      );

      const craftsByItemId = craftRows.reduce(
        (acc, craft) => {
          if (craft.primaryProductId == null) return acc;
          (acc[craft.primaryProductId] ??= []).push({
            craft,
            materials: materialsByCraftId[craft.id] ?? [],
            products: [],
          });
          return acc;
        },
        {} as Record<number, CraftWithMaterialsAndProducts[]>,
      );

      return {
        craftsByItemId,
        prices: latestPrices,
      };
    }),
} satisfies TRPCRouterRecord;
