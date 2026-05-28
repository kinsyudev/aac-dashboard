import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { and, desc, eq, inArray } from "@acme/db";
import {
  items,
  prices,
  proficiencyEnum,
  userCostumePlannerLoadouts,
  userPriceOverrides,
  userProficiencies,
} from "@acme/db/schema";

import { memberProcedure } from "../trpc";

const plannerGradeSchema = z.enum([
  "grand",
  "rare",
  "arcane",
  "heroic",
  "unique",
  "celestial",
  "divine",
  "epic",
  "legendary",
  "mythic",
]);

const costumePlannerStateSchema = z.object({
  kind: z.enum(["costume", "undergarment"]),
  targetGrade: plannerGradeSchema,
  targetProgress: z.number().min(0).max(100),
  targetStats: z.array(z.string()).max(5),
  currentEnabled: z.boolean(),
  currentGrade: plannerGradeSchema,
  currentProgress: z.number().min(0).max(100),
  currentStats: z.array(z.string()).max(5),
  serendipityOverride: z.string(),
  currentItemValue: z.string(),
  honorGoldPerThousand: z.string(),
  craftedSerendipities: z.boolean().default(false),
  boundSynthiumForEpicPlus: z.boolean().default(false),
  serendipityCraftModes: z
    .record(z.string(), z.enum(["buy", "craft"]))
    .default({}),
  serendipitySelectedCrafts: z.record(z.string(), z.number().int()).default({}),
});

const loadoutNameSchema = z.string().trim().min(1).max(120);

function serializeCostumePlannerLoadout(row: {
  id: string;
  name: string;
  kind: string;
  state: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}) {
  const state = costumePlannerStateSchema.parse(row.state);

  return {
    id: row.id,
    name: row.name,
    kind: state.kind,
    state,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const profileRouter = {
  listCostumePlannerLoadouts: memberProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const rows = await ctx.db
      .select({
        id: userCostumePlannerLoadouts.id,
        name: userCostumePlannerLoadouts.name,
        kind: userCostumePlannerLoadouts.kind,
        state: userCostumePlannerLoadouts.state,
        createdAt: userCostumePlannerLoadouts.createdAt,
        updatedAt: userCostumePlannerLoadouts.updatedAt,
      })
      .from(userCostumePlannerLoadouts)
      .where(eq(userCostumePlannerLoadouts.userId, userId))
      .orderBy(desc(userCostumePlannerLoadouts.updatedAt));

    return rows.map(serializeCostumePlannerLoadout);
  }),

  createCostumePlannerLoadout: memberProcedure
    .input(
      z.object({
        name: loadoutNameSchema,
        state: costumePlannerStateSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [created] = await ctx.db
        .insert(userCostumePlannerLoadouts)
        .values({
          userId: ctx.session.user.id,
          name: input.name,
          kind: input.state.kind,
          state: input.state,
          updatedAt: new Date(),
        })
        .returning({
          id: userCostumePlannerLoadouts.id,
          name: userCostumePlannerLoadouts.name,
          kind: userCostumePlannerLoadouts.kind,
          state: userCostumePlannerLoadouts.state,
          createdAt: userCostumePlannerLoadouts.createdAt,
          updatedAt: userCostumePlannerLoadouts.updatedAt,
        });

      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Costume planner loadout creation failed.",
        });
      }

      return serializeCostumePlannerLoadout(created);
    }),

  updateCostumePlannerLoadout: memberProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: loadoutNameSchema.optional(),
        state: costumePlannerStateSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(userCostumePlannerLoadouts)
        .set({
          ...(input.name != null ? { name: input.name } : {}),
          kind: input.state.kind,
          state: input.state,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(userCostumePlannerLoadouts.id, input.id),
            eq(userCostumePlannerLoadouts.userId, ctx.session.user.id),
          ),
        )
        .returning({
          id: userCostumePlannerLoadouts.id,
          name: userCostumePlannerLoadouts.name,
          kind: userCostumePlannerLoadouts.kind,
          state: userCostumePlannerLoadouts.state,
          createdAt: userCostumePlannerLoadouts.createdAt,
          updatedAt: userCostumePlannerLoadouts.updatedAt,
        });

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Costume planner loadout not found.",
        });
      }

      return serializeCostumePlannerLoadout(updated);
    }),

  deleteCostumePlannerLoadout: memberProcedure
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      const [deleted] = await ctx.db
        .delete(userCostumePlannerLoadouts)
        .where(
          and(
            eq(userCostumePlannerLoadouts.id, input),
            eq(userCostumePlannerLoadouts.userId, ctx.session.user.id),
          ),
        )
        .returning({ id: userCostumePlannerLoadouts.id });

      if (!deleted) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Costume planner loadout not found.",
        });
      }

      return deleted;
    }),

  getPriceOverrides: memberProcedure.query(async ({ ctx }) => {
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
        avg30d: prices.avg30d,
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

  setPriceOverride: memberProcedure
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

  deletePriceOverride: memberProcedure
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

  getUserData: memberProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const [proficiencies, overrides] = await Promise.all([
      ctx.db
        .select({
          proficiency: userProficiencies.proficiency,
          value: userProficiencies.value,
        })
        .from(userProficiencies)
        .where(eq(userProficiencies.userId, userId)),
      ctx.db
        .select({
          itemId: userPriceOverrides.itemId,
          price: userPriceOverrides.price,
        })
        .from(userPriceOverrides)
        .where(eq(userPriceOverrides.userId, userId)),
    ]);
    return { proficiencies, overrides };
  }),

  getProficiencies: memberProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    return ctx.db
      .select({
        proficiency: userProficiencies.proficiency,
        value: userProficiencies.value,
        updatedAt: userProficiencies.updatedAt,
      })
      .from(userProficiencies)
      .where(eq(userProficiencies.userId, userId));
  }),

  setProficiency: memberProcedure
    .input(
      z.object({
        proficiency: z.enum(proficiencyEnum.enumValues),
        value: z.number().int().min(0).max(300000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await ctx.db
        .insert(userProficiencies)
        .values({
          userId,
          proficiency: input.proficiency,
          value: input.value,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [userProficiencies.userId, userProficiencies.proficiency],
          set: { value: input.value, updatedAt: new Date() },
        });
    }),
} satisfies TRPCRouterRecord;
