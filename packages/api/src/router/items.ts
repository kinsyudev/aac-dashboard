import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { asc, desc, eq, getTableColumns, ilike, inArray, like } from "@acme/db";
import {
  craftMaterials,
  craftProducts,
  crafts,
  items,
  prices,
} from "@acme/db/schema";

import type { CraftWithMaterialsAndProducts } from "./crafts";
import { hasUnsupportedCraftName } from "./crafts";
import { protectedProcedure } from "../trpc";

export const itemsRouter = {
  all: protectedProcedure.query(({ ctx }) => {
    return ctx.db
      .select(getTableColumns(items))
      .from(items)
      .orderBy(asc(items.category), asc(items.name));
  }),

  price: protectedProcedure.input(z.number().int()).query(({ ctx, input }) => {
    return ctx.db
      .select()
      .from(prices)
      .where(eq(prices.itemId, input))
      .orderBy(desc(prices.fetchedAt))
      .limit(1)
      .then((rows) => rows[0] ?? null);
  }),

  pricesBatch: protectedProcedure
    .input(z.array(z.number().int()))
    .query(({ ctx, input }) => {
      if (input.length === 0) return [];
      return ctx.db
        .selectDistinctOn([prices.itemId])
        .from(prices)
        .where(inArray(prices.itemId, input))
        .orderBy(prices.itemId, desc(prices.fetchedAt));
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
        craftName: crafts.name,
      })
      .from(items)
      .innerJoin(crafts, eq(crafts.primaryProductId, items.id))
      .orderBy(items.id, asc(items.category), asc(items.name))
      .then((rows) =>
        rows
          .filter((row) => !hasUnsupportedCraftName(row.craftName))
          .map(({ craftName: _craftName, ...row }) => row),
      );
  }),

  byName: protectedProcedure.input(z.string()).query(({ ctx, input }) => {
    return ctx.db
      .select({ ...getTableColumns(items), labor: crafts.labor })
      .from(items)
      .leftJoin(crafts, eq(crafts.primaryProductId, items.id))
      .where(like(items.name, input))
      .orderBy(items.name);
  }),

  search: protectedProcedure
    .input(z.string().min(2))
    .query(({ ctx, input }) => {
      return ctx.db
        .select({
          id: items.id,
          name: items.name,
          icon: items.icon,
          category: items.category,
          sellable: items.sellable,
        })
        .from(items)
        .where(ilike(items.name, `%${input}%`))
        .orderBy(items.name)
        .limit(25);
    }),

  detail: protectedProcedure
    .input(z.number().int())
    .query(async ({ ctx, input: itemId }) => {
      const [item, priceHistory, craftedByRows, usedInRows] = await Promise.all(
        [
          ctx.db
            .select(getTableColumns(items))
            .from(items)
            .where(eq(items.id, itemId))
            .then((rows) => rows[0] ?? null),
          ctx.db
            .select()
            .from(prices)
            .where(eq(prices.itemId, itemId))
            .orderBy(asc(prices.fetchedAt)),
          ctx.db
            .select()
            .from(crafts)
            .where(eq(crafts.primaryProductId, itemId))
            .then((rows) =>
              rows.filter((craft) => !hasUnsupportedCraftName(craft.name)),
            ),
          ctx.db
            .select({
              id: crafts.id,
              name: crafts.name,
              labor: crafts.labor,
              castDelayMs: crafts.castDelayMs,
              primaryProductId: crafts.primaryProductId,
              proficiency: crafts.proficiency,
            })
            .from(crafts)
            .innerJoin(craftMaterials, eq(craftMaterials.craftId, crafts.id))
            .where(eq(craftMaterials.itemId, itemId))
            .then((rows) =>
              rows.filter((craft) => !hasUnsupportedCraftName(craft.name)),
            ),
        ],
      );

      if (!item) return null;

      const craftIds = [
        ...new Set([...craftedByRows, ...usedInRows].map((craft) => craft.id)),
      ];

      if (craftIds.length === 0) {
        return {
          item,
          priceHistory,
          craftedBy: [] as CraftWithMaterialsAndProducts[],
          usedIn: [] as CraftWithMaterialsAndProducts[],
          craftableItemIds: [] as number[],
          latestPrices: [] as {
            itemId: number;
            avg24h: string | null;
            avg7d: string | null;
          }[],
        };
      }

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
        (acc, entry) => {
          (acc[entry.craftId] ??= []).push(entry);
          return acc;
        },
        {} as Record<number, typeof materials>,
      );
      const productsByCraft = products.reduce(
        (acc, entry) => {
          (acc[entry.craftId] ??= []).push(entry);
          return acc;
        },
        {} as Record<number, typeof products>,
      );

      const materialItemIds = [
        ...new Set(materials.map((material) => material.item.id)),
      ];
      const relatedItemIds = [
        ...new Set([
          ...materials.map((material) => material.item.id),
          ...products.map((product) => product.item.id),
        ]),
      ];

      const [latestPrices, craftableItems] = await Promise.all([
        materialItemIds.length > 0
          ? ctx.db
              .selectDistinctOn([prices.itemId], {
                itemId: prices.itemId,
                avg24h: prices.avg24h,
                avg7d: prices.avg7d,
              })
              .from(prices)
              .where(inArray(prices.itemId, materialItemIds))
              .orderBy(prices.itemId, desc(prices.fetchedAt))
          : [],
        relatedItemIds.length > 0
          ? ctx.db
              .selectDistinctOn([crafts.primaryProductId], {
                itemId: crafts.primaryProductId,
                craftName: crafts.name,
              })
              .from(crafts)
              .where(inArray(crafts.primaryProductId, relatedItemIds))
              .orderBy(crafts.primaryProductId)
              .then((rows) =>
                rows.filter((entry) => !hasUnsupportedCraftName(entry.craftName)),
              )
          : [],
      ]);

      const toCraftEntries = (
        craftRows: typeof craftedByRows,
      ): CraftWithMaterialsAndProducts[] =>
        craftRows.map((craft) => ({
          craft,
          materials: materialsByCraft[craft.id] ?? [],
          products: productsByCraft[craft.id] ?? [],
        }));

      return {
        item,
        priceHistory,
        craftedBy: toCraftEntries(craftedByRows),
        usedIn: toCraftEntries(usedInRows),
        craftableItemIds: craftableItems
          .map((entry) => entry.itemId)
          .filter((itemId): itemId is number => itemId != null),
        latestPrices,
      };
    }),
} satisfies TRPCRouterRecord;
