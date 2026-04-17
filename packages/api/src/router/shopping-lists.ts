import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import type { db } from "@acme/db/client";
import { and, asc, desc, eq, sql } from "@acme/db";
import {
  crafts,
  items,
  shoppingListCrafts,
  shoppingListInvites,
  shoppingListItems,
  shoppingListMembers,
  shoppingListRoleEnum,
  shoppingLists,
  shoppingListSources,
  shoppingListSourceTypeEnum,
  user,
} from "@acme/db/schema";

import type { DbTx } from "../lib/shopping-list-state";
import {
  assertValidListSources,
  fetchCraftBlueprint,
  getComputedUsage,
  getExistingProgress,
  getListSources,
  getSourceKind,
  regenerateListState,
} from "../lib/shopping-list-state";
import { protectedProcedure, publicProcedure } from "../trpc";

async function getListAccess(
  dbClient: typeof db | DbTx,
  shoppingListId: string,
  userId: string,
) {
  const [list] = await dbClient
    .select({
      list: shoppingLists,
      owner: {
        id: user.id,
        name: user.name,
        image: user.image,
      },
      membershipRole: shoppingListMembers.role,
    })
    .from(shoppingLists)
    .innerJoin(user, eq(user.id, shoppingLists.ownerUserId))
    .leftJoin(
      shoppingListMembers,
      and(
        eq(shoppingListMembers.shoppingListId, shoppingLists.id),
        eq(shoppingListMembers.userId, userId),
      ),
    )
    .where(eq(shoppingLists.id, shoppingListId))
    .limit(1);

  if (!list) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Shopping list not found.",
    });
  }

  const isOwner = list.list.ownerUserId === userId;
  const role = isOwner ? "owner" : list.membershipRole;

  if (!role) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }

  return {
    list: list.list,
    owner: list.owner,
    isOwner,
    role,
    canWrite: isOwner || role === "write",
  };
}

function buildInviteUrl(token: string) {
  return `/shoplists/invite/${token}`;
}

const roleSchema = z.enum(shoppingListRoleEnum.enumValues);
const sourceTypeSchema = z.enum(shoppingListSourceTypeEnum.enumValues);

async function insertSource(
  tx: DbTx,
  input: {
    shoppingListId: string;
    sourceType: "craft" | "simulator";
    craftId: number;
    itemId: number | null;
    quantity: number;
  },
) {
  const [maxPositionRow] = await tx
    .select({
      value: sql<number>`coalesce(max(${shoppingListSources.position}), -1)`,
    })
    .from(shoppingListSources)
    .where(eq(shoppingListSources.shoppingListId, input.shoppingListId));

  const [created] = await tx
    .insert(shoppingListSources)
    .values({
      shoppingListId: input.shoppingListId,
      sourceType: input.sourceType,
      craftId: input.craftId,
      itemId: input.itemId,
      quantity: input.quantity,
      position: (maxPositionRow?.value ?? -1) + 1,
      updatedAt: new Date(),
    })
    .returning();

  if (!created) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Shopping list source creation failed.",
    });
  }

  return created;
}

async function getResolvedSources(dbClient: typeof db | DbTx, listId: string) {
  return dbClient
    .select({
      id: shoppingListSources.id,
      sourceType: shoppingListSources.sourceType,
      craftId: shoppingListSources.craftId,
      itemId: shoppingListSources.itemId,
      quantity: shoppingListSources.quantity,
      position: shoppingListSources.position,
      createdAt: shoppingListSources.createdAt,
      craft: {
        id: crafts.id,
        name: crafts.name,
        proficiency: crafts.proficiency,
        labor: crafts.labor,
      },
      item: {
        id: items.id,
        name: items.name,
        icon: items.icon,
      },
    })
    .from(shoppingListSources)
    .innerJoin(crafts, eq(crafts.id, shoppingListSources.craftId))
    .leftJoin(items, eq(items.id, shoppingListSources.itemId))
    .where(eq(shoppingListSources.shoppingListId, listId))
    .orderBy(
      asc(shoppingListSources.position),
      asc(shoppingListSources.createdAt),
    );
}

function buildListSummary<
  T extends {
    sourceType: "craft" | "simulator";
    quantity: number;
    item: {
      id: number | null;
      name: string | null;
      icon: string | null;
    } | null;
  },
>(sources: T[]) {
  const sourceKind = getSourceKind(sources);
  const rootCount = sources.length;
  const primarySourceItem = sources[0]?.item ?? null;
  const totalQuantity = sources.reduce(
    (sum, source) => sum + source.quantity,
    0,
  );

  return {
    sourceKind,
    rootCount,
    totalQuantity,
    primarySourceItem,
  };
}

function mergeCraftModeItemIds(current: number[], incoming?: number[]) {
  return Array.from(new Set([...current, ...(incoming ?? [])])).sort(
    (a, b) => a - b,
  );
}

export const shoppingListsRouter = {
  listMineAndShared: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const [ownedLists, sharedLists] = await Promise.all([
      ctx.db
        .select({
          id: shoppingLists.id,
          name: shoppingLists.name,
          updatedAt: shoppingLists.updatedAt,
          owner: {
            id: user.id,
            name: user.name,
            image: user.image,
          },
        })
        .from(shoppingLists)
        .innerJoin(user, eq(user.id, shoppingLists.ownerUserId))
        .where(eq(shoppingLists.ownerUserId, userId))
        .orderBy(desc(shoppingLists.updatedAt)),
      ctx.db
        .select({
          id: shoppingLists.id,
          name: shoppingLists.name,
          updatedAt: shoppingLists.updatedAt,
          role: shoppingListMembers.role,
          owner: {
            id: user.id,
            name: user.name,
            image: user.image,
          },
        })
        .from(shoppingListMembers)
        .innerJoin(
          shoppingLists,
          eq(shoppingLists.id, shoppingListMembers.shoppingListId),
        )
        .innerJoin(user, eq(user.id, shoppingLists.ownerUserId))
        .where(eq(shoppingListMembers.userId, userId))
        .orderBy(desc(shoppingLists.updatedAt)),
    ]);

    const sourceRows = await ctx.db
      .select({
        shoppingListId: shoppingListSources.shoppingListId,
        sourceType: shoppingListSources.sourceType,
        quantity: shoppingListSources.quantity,
        position: shoppingListSources.position,
        createdAt: shoppingListSources.createdAt,
        item: {
          id: items.id,
          name: items.name,
          icon: items.icon,
        },
      })
      .from(shoppingListSources)
      .leftJoin(items, eq(items.id, shoppingListSources.itemId));

    const sourcesByListId = sourceRows.reduce<
      Map<
        string,
        {
          sourceType: "craft" | "simulator";
          quantity: number;
          position: number;
          createdAt: Date;
          item: {
            id: number | null;
            name: string | null;
            icon: string | null;
          } | null;
        }[]
      >
    >((acc, row) => {
      const existing = acc.get(row.shoppingListId) ?? [];
      existing.push(row);
      acc.set(row.shoppingListId, existing);
      return acc;
    }, new Map());

    const mapList = <
      T extends {
        id: string;
        name: string;
        updatedAt: Date;
        owner: { id: string; name: string; image: string | null };
      },
    >(
      list: T,
    ) => {
      const sources =
        sourcesByListId
          .get(list.id)
          ?.sort(
            (a, b) =>
              a.position - b.position ||
              a.createdAt.getTime() - b.createdAt.getTime(),
          ) ?? [];

      return {
        ...list,
        ...buildListSummary(sources),
      };
    };

    return {
      owned: ownedLists.map(mapList),
      shared: sharedLists.map(mapList),
    };
  }),

  getById: protectedProcedure
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      const access = await getListAccess(ctx.db, input, ctx.session.user.id);
      const shoppingListId = access.list.id;

      const [sourceRows, itemRows, craftRows, memberRows, inviteRows] =
        await Promise.all([
          getResolvedSources(ctx.db, shoppingListId),
          ctx.db
            .select({
              itemId: shoppingListItems.itemId,
              requiredQuantity: shoppingListItems.requiredQuantity,
              stockQuantity: shoppingListItems.obtainedQuantity,
              item: {
                id: items.id,
                name: items.name,
                icon: items.icon,
              },
            })
            .from(shoppingListItems)
            .innerJoin(items, eq(items.id, shoppingListItems.itemId))
            .where(eq(shoppingListItems.shoppingListId, shoppingListId))
            .orderBy(asc(items.name)),
          ctx.db
            .select({
              craftId: shoppingListCrafts.craftId,
              requiredCount: shoppingListCrafts.requiredCount,
              stockCount: shoppingListCrafts.completedCount,
              craft: {
                id: crafts.id,
                name: crafts.name,
                proficiency: crafts.proficiency,
                labor: crafts.labor,
              },
              product: {
                id: items.id,
                name: items.name,
                icon: items.icon,
              },
            })
            .from(shoppingListCrafts)
            .innerJoin(crafts, eq(crafts.id, shoppingListCrafts.craftId))
            .leftJoin(items, eq(items.id, crafts.primaryProductId))
            .where(eq(shoppingListCrafts.shoppingListId, shoppingListId))
            .orderBy(asc(crafts.name)),
          ctx.db
            .select({
              userId: shoppingListMembers.userId,
              role: shoppingListMembers.role,
              acceptedAt: shoppingListMembers.acceptedAt,
              user: {
                name: user.name,
                image: user.image,
              },
            })
            .from(shoppingListMembers)
            .innerJoin(user, eq(user.id, shoppingListMembers.userId))
            .where(eq(shoppingListMembers.shoppingListId, shoppingListId))
            .orderBy(asc(user.name)),
          access.isOwner
            ? ctx.db
                .select({
                  id: shoppingListInvites.id,
                  role: shoppingListInvites.role,
                  createdAt: shoppingListInvites.createdAt,
                  expiresAt: shoppingListInvites.expiresAt,
                  revokedAt: shoppingListInvites.revokedAt,
                  consumedAt: shoppingListInvites.consumedAt,
                  inviteUrl: shoppingListInvites.token,
                })
                .from(shoppingListInvites)
                .where(eq(shoppingListInvites.shoppingListId, shoppingListId))
                .orderBy(desc(shoppingListInvites.createdAt))
            : Promise.resolve([]),
        ]);
      const computedUsage = await getComputedUsage(ctx.db, access.list, {
        itemRows: itemRows.map((row) => ({
          itemId: row.itemId,
          requiredQuantity: row.requiredQuantity,
          stockQuantity: row.stockQuantity,
        })),
        craftRows: craftRows.map((row) => ({
          craftId: row.craftId,
          requiredCount: row.requiredCount,
          stockCount: row.stockCount,
        })),
      });

      return {
        ...access,
        list: {
          ...access.list,
          craftModeItemIds: access.list.craftModeItemIds,
          ...buildListSummary(sourceRows),
        },
        sources: sourceRows,
        items: itemRows.map((row) => {
          const derived = computedUsage.items.get(row.itemId);
          return {
            ...row,
            totalQuantity: derived?.totalQuantity ?? row.requiredQuantity,
            usedQuantity: derived?.usedQuantity ?? 0,
            remainingQuantity:
              derived?.remainingQuantity ??
              Math.max(0, row.requiredQuantity - row.stockQuantity),
          };
        }),
        crafts: craftRows.map((row) => {
          const derived = computedUsage.crafts.get(row.craftId);
          return {
            ...row,
            totalCount: derived?.totalCount ?? row.requiredCount,
            usedCount: derived?.usedCount ?? 0,
            remainingCount:
              derived?.remainingCount ??
              Math.max(0, row.requiredCount - row.stockCount),
          };
        }),
        members: memberRows,
        invites: inviteRows.map((invite) => ({
          ...invite,
          inviteUrl: buildInviteUrl(invite.inviteUrl),
        })),
      };
    }),

  createEmpty: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(120).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [created] = await ctx.db
        .insert(shoppingLists)
        .values({
          ownerUserId: ctx.session.user.id,
          name: input.name?.trim() ?? "New shopping list",
          updatedAt: new Date(),
        })
        .returning();

      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Shopping list creation failed.",
        });
      }

      return { id: created.id };
    }),

  createFromCraft: protectedProcedure
    .input(
      z.object({
        craftId: z.number().int(),
        quantity: z.number().int().min(1).default(1),
        craftModeItemIds: z.array(z.number().int()).default([]),
        name: z.string().trim().min(1).max(120).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const blueprint = await fetchCraftBlueprint(ctx.db, input.craftId);
      const name =
        input.name?.trim() ??
        `${blueprint.item?.name ?? blueprint.craft.name} x${input.quantity}`;

      return ctx.db.transaction(async (tx: DbTx) => {
        const [created] = await tx
          .insert(shoppingLists)
          .values({
            ownerUserId: ctx.session.user.id,
            name,
            craftModeItemIds: input.craftModeItemIds,
            updatedAt: new Date(),
          })
          .returning();

        if (!created) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Shopping list creation failed.",
          });
        }

        await insertSource(tx, {
          shoppingListId: created.id,
          sourceType: "craft",
          craftId: input.craftId,
          itemId: blueprint.item?.id ?? null,
          quantity: input.quantity,
        });
        await regenerateListState(tx, created);

        return { id: created.id };
      });
    }),

  createFromSimulator: protectedProcedure
    .input(
      z.object({
        itemId: z.number().int(),
        craftId: z.number().int(),
        attempts: z.number().int().min(1).default(1),
        craftModeItemIds: z.array(z.number().int()).default([]),
        name: z.string().trim().min(1).max(120).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [targetItem] = await ctx.db
        .select()
        .from(items)
        .where(eq(items.id, input.itemId))
        .limit(1);

      if (!targetItem) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Item not found." });
      }

      const name =
        input.name?.trim() ??
        `${targetItem.name} attempt plan x${input.attempts}`;

      return ctx.db.transaction(async (tx: DbTx) => {
        const [created] = await tx
          .insert(shoppingLists)
          .values({
            ownerUserId: ctx.session.user.id,
            name,
            craftModeItemIds: input.craftModeItemIds,
            updatedAt: new Date(),
          })
          .returning();

        if (!created) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Shopping list creation failed.",
          });
        }

        await insertSource(tx, {
          shoppingListId: created.id,
          sourceType: "simulator",
          craftId: input.craftId,
          itemId: targetItem.id,
          quantity: input.attempts,
        });
        await regenerateListState(tx, created);

        return { id: created.id };
      });
    }),

  addCraftSource: protectedProcedure
    .input(
      z.object({
        listId: z.string().uuid(),
        craftId: z.number().int(),
        quantity: z.number().int().min(1).default(1),
        name: z.string().trim().min(1).max(120).optional(),
        craftModeItemIds: z.array(z.number().int()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await getListAccess(
        ctx.db,
        input.listId,
        ctx.session.user.id,
      );
      if (!access.canWrite) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const blueprint = await fetchCraftBlueprint(ctx.db, input.craftId);

      return ctx.db.transaction(async (tx: DbTx) => {
        const existingSources = await getListSources(tx, input.listId);
        assertValidListSources(existingSources);

        if (getSourceKind(existingSources) === "simulator") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot add craft sources to a simulator list.",
          });
        }

        const progress = await getExistingProgress(tx, input.listId);
        const [updated] = await tx
          .update(shoppingLists)
          .set({
            name: input.name?.trim() ?? access.list.name,
            craftModeItemIds: mergeCraftModeItemIds(
              access.list.craftModeItemIds,
              input.craftModeItemIds,
            ),
            updatedAt: new Date(),
          })
          .where(eq(shoppingLists.id, input.listId))
          .returning();

        if (!updated) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Shopping list not found.",
          });
        }

        await insertSource(tx, {
          shoppingListId: input.listId,
          sourceType: "craft",
          craftId: input.craftId,
          itemId: blueprint.item?.id ?? null,
          quantity: input.quantity,
        });

        await regenerateListState(tx, updated, progress);
        return { id: updated.id };
      });
    }),

  updateCraftSource: protectedProcedure
    .input(
      z.object({
        listId: z.string().uuid(),
        sourceId: z.string().uuid(),
        craftId: z.number().int(),
        quantity: z.number().int().min(1).default(1),
        name: z.string().trim().min(1).max(120).optional(),
        craftModeItemIds: z.array(z.number().int()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await getListAccess(
        ctx.db,
        input.listId,
        ctx.session.user.id,
      );
      if (!access.canWrite) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const blueprint = await fetchCraftBlueprint(ctx.db, input.craftId);

      return ctx.db.transaction(async (tx: DbTx) => {
        const existingSources = await getListSources(tx, input.listId);
        assertValidListSources(existingSources);

        if (getSourceKind(existingSources) !== "craft") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Only craft list sources can be edited here.",
          });
        }

        const [source] = await tx
          .select()
          .from(shoppingListSources)
          .where(
            and(
              eq(shoppingListSources.id, input.sourceId),
              eq(shoppingListSources.shoppingListId, input.listId),
            ),
          )
          .limit(1);

        if (!source) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Shopping list source not found.",
          });
        }

        if (source.sourceType !== "craft") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Only craft sources can be edited here.",
          });
        }

        const progress = await getExistingProgress(tx, input.listId);
        const [updated] = await tx
          .update(shoppingLists)
          .set({
            name: input.name?.trim() ?? access.list.name,
            craftModeItemIds: mergeCraftModeItemIds(
              access.list.craftModeItemIds,
              input.craftModeItemIds,
            ),
            updatedAt: new Date(),
          })
          .where(eq(shoppingLists.id, input.listId))
          .returning();

        if (!updated) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Shopping list not found.",
          });
        }

        await tx
          .update(shoppingListSources)
          .set({
            craftId: input.craftId,
            itemId: blueprint.item?.id ?? null,
            quantity: input.quantity,
            updatedAt: new Date(),
          })
          .where(eq(shoppingListSources.id, input.sourceId));

        await regenerateListState(tx, updated, progress);
        return { id: updated.id };
      });
    }),

  updateDefinition: protectedProcedure
    .input(
      z.object({
        listId: z.string().uuid(),
        name: z.string().trim().min(1).max(120).optional(),
        sourceType: sourceTypeSchema.optional(),
        craftId: z.number().int().optional(),
        itemId: z.number().int().optional(),
        quantity: z.number().int().min(1).optional(),
        craftModeItemIds: z.array(z.number().int()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await getListAccess(
        ctx.db,
        input.listId,
        ctx.session.user.id,
      );
      if (!access.canWrite) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      return ctx.db.transaction(async (tx: DbTx) => {
        const sources = await getListSources(tx, input.listId);
        assertValidListSources(sources);

        const sourceKind = getSourceKind(sources);
        if (sourceKind !== "simulator" || sources.length !== 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Only single-source simulator lists can be updated from this flow.",
          });
        }

        const source = sources[0];
        if (!source) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Shopping list source missing.",
          });
        }

        const progress = await getExistingProgress(tx, input.listId);
        const [updated] = await tx
          .update(shoppingLists)
          .set({
            name: input.name?.trim() ?? access.list.name,
            craftModeItemIds:
              input.craftModeItemIds ?? access.list.craftModeItemIds,
            updatedAt: new Date(),
          })
          .where(eq(shoppingLists.id, input.listId))
          .returning();

        if (!updated) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Shopping list not found.",
          });
        }

        await tx
          .update(shoppingListSources)
          .set({
            sourceType: input.sourceType ?? source.sourceType,
            craftId: input.craftId ?? source.craftId,
            itemId: input.itemId ?? source.itemId,
            quantity: input.quantity ?? source.quantity,
            updatedAt: new Date(),
          })
          .where(eq(shoppingListSources.id, source.id));

        await regenerateListState(tx, updated, progress);

        return { id: updated.id };
      });
    }),

  rename: protectedProcedure
    .input(
      z.object({
        listId: z.string().uuid(),
        name: z.string().trim().min(1).max(120),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await getListAccess(
        ctx.db,
        input.listId,
        ctx.session.user.id,
      );
      if (!access.canWrite) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      await ctx.db
        .update(shoppingLists)
        .set({
          name: input.name.trim(),
          updatedAt: new Date(),
        })
        .where(eq(shoppingLists.id, input.listId));
    }),

  updateSourceQuantity: protectedProcedure
    .input(
      z.object({
        listId: z.string().uuid(),
        sourceId: z.string().uuid(),
        quantity: z.number().int().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await getListAccess(
        ctx.db,
        input.listId,
        ctx.session.user.id,
      );
      if (!access.canWrite) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      return ctx.db.transaction(async (tx: DbTx) => {
        const progress = await getExistingProgress(tx, input.listId);
        const [source] = await tx
          .select()
          .from(shoppingListSources)
          .where(
            and(
              eq(shoppingListSources.id, input.sourceId),
              eq(shoppingListSources.shoppingListId, input.listId),
            ),
          )
          .limit(1);

        if (!source) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Shopping list source not found.",
          });
        }

        await tx
          .update(shoppingListSources)
          .set({
            quantity: input.quantity,
            updatedAt: new Date(),
          })
          .where(eq(shoppingListSources.id, source.id));

        const [updated] = await tx
          .update(shoppingLists)
          .set({ updatedAt: new Date() })
          .where(eq(shoppingLists.id, input.listId))
          .returning();

        if (!updated) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Shopping list not found.",
          });
        }

        await regenerateListState(tx, updated, progress);
        return { id: updated.id };
      });
    }),

  removeSource: protectedProcedure
    .input(
      z.object({
        listId: z.string().uuid(),
        sourceId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await getListAccess(
        ctx.db,
        input.listId,
        ctx.session.user.id,
      );
      if (!access.canWrite) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      return ctx.db.transaction(async (tx: DbTx) => {
        const progress = await getExistingProgress(tx, input.listId);
        const [source] = await tx
          .select()
          .from(shoppingListSources)
          .where(
            and(
              eq(shoppingListSources.id, input.sourceId),
              eq(shoppingListSources.shoppingListId, input.listId),
            ),
          )
          .limit(1);

        if (!source) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Shopping list source not found.",
          });
        }

        await tx
          .delete(shoppingListSources)
          .where(eq(shoppingListSources.id, source.id));

        const remainingSources = await getListSources(tx, input.listId);
        assertValidListSources(remainingSources);

        const [updated] = await tx
          .update(shoppingLists)
          .set({ updatedAt: new Date() })
          .where(eq(shoppingLists.id, input.listId))
          .returning();

        if (!updated) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Shopping list not found.",
          });
        }

        await regenerateListState(tx, updated, progress);
        return { id: updated.id };
      });
    }),

  updateItemProgress: protectedProcedure
    .input(
      z.object({
        listId: z.string().uuid(),
        itemId: z.number().int(),
        obtainedQuantity: z.number().int().min(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await getListAccess(
        ctx.db,
        input.listId,
        ctx.session.user.id,
      );
      if (!access.canWrite) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const [row] = await ctx.db
        .select({
          requiredQuantity: shoppingListItems.requiredQuantity,
        })
        .from(shoppingListItems)
        .where(
          and(
            eq(shoppingListItems.shoppingListId, input.listId),
            eq(shoppingListItems.itemId, input.itemId),
          ),
        )
        .limit(1);

      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "List item not found.",
        });
      }

      await ctx.db
        .update(shoppingListItems)
        .set({
          obtainedQuantity: Math.min(
            row.requiredQuantity,
            input.obtainedQuantity,
          ),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(shoppingListItems.shoppingListId, input.listId),
            eq(shoppingListItems.itemId, input.itemId),
          ),
        );
    }),

  updateCraftProgress: protectedProcedure
    .input(
      z.object({
        listId: z.string().uuid(),
        craftId: z.number().int(),
        completedCount: z.number().int().min(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await getListAccess(
        ctx.db,
        input.listId,
        ctx.session.user.id,
      );
      if (!access.canWrite) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      await ctx.db.transaction(async (tx: DbTx) => {
        const [row] = await tx
          .select({
            requiredCount: shoppingListCrafts.requiredCount,
            completedCount: shoppingListCrafts.completedCount,
          })
          .from(shoppingListCrafts)
          .where(
            and(
              eq(shoppingListCrafts.shoppingListId, input.listId),
              eq(shoppingListCrafts.craftId, input.craftId),
            ),
          )
          .limit(1);

        if (!row) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "List craft not found.",
          });
        }

        const nextCompletedCount = Math.min(
          row.requiredCount,
          input.completedCount,
        );
        if (nextCompletedCount === row.completedCount) return;

        await tx
          .update(shoppingListCrafts)
          .set({
            completedCount: nextCompletedCount,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(shoppingListCrafts.shoppingListId, input.listId),
              eq(shoppingListCrafts.craftId, input.craftId),
            ),
          );
      });
    }),

  duplicate: protectedProcedure
    .input(
      z.object({
        listId: z.string().uuid(),
        mode: z.enum(["fresh", "copyState"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await getListAccess(
        ctx.db,
        input.listId,
        ctx.session.user.id,
      );
      const sourceDefinitions = await getListSources(ctx.db, input.listId);
      const [sourceItems, sourceCraftRows]: [
        { itemId: number; obtainedQuantity: number }[],
        { craftId: number; completedCount: number }[],
      ] =
        input.mode === "copyState"
          ? await Promise.all([
              ctx.db
                .select({
                  itemId: shoppingListItems.itemId,
                  obtainedQuantity: shoppingListItems.obtainedQuantity,
                })
                .from(shoppingListItems)
                .where(eq(shoppingListItems.shoppingListId, input.listId)),
              ctx.db
                .select({
                  craftId: shoppingListCrafts.craftId,
                  completedCount: shoppingListCrafts.completedCount,
                })
                .from(shoppingListCrafts)
                .where(eq(shoppingListCrafts.shoppingListId, input.listId)),
            ])
          : [[], []];

      return ctx.db.transaction(async (tx: DbTx) => {
        const [created] = await tx
          .insert(shoppingLists)
          .values({
            ownerUserId: ctx.session.user.id,
            name:
              input.mode === "fresh"
                ? `${access.list.name} copy`
                : `${access.list.name} snapshot`,
            craftModeItemIds: access.list.craftModeItemIds,
            updatedAt: new Date(),
          })
          .returning();

        if (!created) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Shopping list duplication failed.",
          });
        }

        if (sourceDefinitions.length > 0) {
          await tx.insert(shoppingListSources).values(
            sourceDefinitions.map((source) => ({
              shoppingListId: created.id,
              sourceType: source.sourceType,
              craftId: source.craftId,
              itemId: source.itemId,
              quantity: source.quantity,
              position: source.position,
              updatedAt: new Date(),
            })),
          );
        }

        await regenerateListState(tx, created, {
          itemProgress: new Map<number, number>(
            sourceItems.map(
              (row: { itemId: number; obtainedQuantity: number }) => [
                row.itemId,
                row.obtainedQuantity,
              ],
            ),
          ),
          craftProgress: new Map<number, number>(
            sourceCraftRows.map(
              (row: { craftId: number; completedCount: number }) => [
                row.craftId,
                row.completedCount,
              ],
            ),
          ),
        });

        return { id: created.id };
      });
    }),

  createInvite: protectedProcedure
    .input(
      z.object({
        listId: z.string().uuid(),
        role: roleSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await getListAccess(
        ctx.db,
        input.listId,
        ctx.session.user.id,
      );
      if (!access.isOwner) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const token = crypto.randomUUID();
      const [invite] = await ctx.db
        .insert(shoppingListInvites)
        .values({
          shoppingListId: input.listId,
          token,
          role: input.role,
          createdByUserId: ctx.session.user.id,
        })
        .returning({
          id: shoppingListInvites.id,
          role: shoppingListInvites.role,
          token: shoppingListInvites.token,
          createdAt: shoppingListInvites.createdAt,
        });

      if (!invite) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Invite creation failed.",
        });
      }

      return {
        ...invite,
        inviteUrl: buildInviteUrl(invite.token),
      };
    }),

  revokeInvite: protectedProcedure
    .input(
      z.object({
        listId: z.string().uuid(),
        inviteId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await getListAccess(
        ctx.db,
        input.listId,
        ctx.session.user.id,
      );
      if (!access.isOwner) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      await ctx.db
        .update(shoppingListInvites)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(shoppingListInvites.id, input.inviteId),
            eq(shoppingListInvites.shoppingListId, input.listId),
          ),
        );
    }),

  removeMember: protectedProcedure
    .input(
      z.object({
        listId: z.string().uuid(),
        userId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await getListAccess(
        ctx.db,
        input.listId,
        ctx.session.user.id,
      );
      if (!access.isOwner) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      if (access.list.ownerUserId === input.userId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Owner cannot be removed.",
        });
      }

      await ctx.db
        .delete(shoppingListMembers)
        .where(
          and(
            eq(shoppingListMembers.shoppingListId, input.listId),
            eq(shoppingListMembers.userId, input.userId),
          ),
        );
    }),

  delete: protectedProcedure
    .input(z.object({ listId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const access = await getListAccess(
        ctx.db,
        input.listId,
        ctx.session.user.id,
      );
      if (!access.isOwner) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await ctx.db
        .delete(shoppingLists)
        .where(eq(shoppingLists.id, input.listId));
    }),

  getInvitePreview: publicProcedure
    .input(z.string())
    .query(async ({ ctx, input }) => {
      const [invite] = await ctx.db
        .select({
          id: shoppingListInvites.id,
          role: shoppingListInvites.role,
          revokedAt: shoppingListInvites.revokedAt,
          consumedAt: shoppingListInvites.consumedAt,
          expiresAt: shoppingListInvites.expiresAt,
          list: {
            id: shoppingLists.id,
            name: shoppingLists.name,
          },
          owner: {
            name: user.name,
            image: user.image,
          },
        })
        .from(shoppingListInvites)
        .innerJoin(
          shoppingLists,
          eq(shoppingLists.id, shoppingListInvites.shoppingListId),
        )
        .innerJoin(user, eq(user.id, shoppingLists.ownerUserId))
        .where(eq(shoppingListInvites.token, input))
        .limit(1);

      if (!invite) return null;

      const isAvailable =
        invite.revokedAt == null &&
        invite.consumedAt == null &&
        (invite.expiresAt == null || invite.expiresAt > new Date());

      return {
        ...invite,
        isAvailable,
      };
    }),

  acceptInviteToken: protectedProcedure
    .input(z.string())
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      return ctx.db.transaction(async (tx: DbTx) => {
        const [invite] = await tx
          .select()
          .from(shoppingListInvites)
          .where(eq(shoppingListInvites.token, input))
          .limit(1);

        if (!invite) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Invite not found.",
          });
        }

        const isAvailable =
          invite.revokedAt == null &&
          invite.consumedAt == null &&
          (invite.expiresAt == null || invite.expiresAt > new Date());

        if (!isAvailable) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invite is no longer available.",
          });
        }

        const [list] = await tx
          .select()
          .from(shoppingLists)
          .where(eq(shoppingLists.id, invite.shoppingListId))
          .limit(1);

        if (!list) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Shopping list missing.",
          });
        }

        if (list.ownerUserId !== userId) {
          await tx
            .insert(shoppingListMembers)
            .values({
              shoppingListId: invite.shoppingListId,
              userId,
              role: invite.role,
              acceptedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [
                shoppingListMembers.shoppingListId,
                shoppingListMembers.userId,
              ],
              set: {
                role: invite.role,
                acceptedAt: new Date(),
              },
            });
        }

        await tx
          .update(shoppingListInvites)
          .set({
            consumedAt: new Date(),
            consumedByUserId: userId,
          })
          .where(eq(shoppingListInvites.id, invite.id));

        return { listId: invite.shoppingListId };
      });
    }),
} satisfies TRPCRouterRecord;
