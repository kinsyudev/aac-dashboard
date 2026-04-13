import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import type { db } from "@acme/db/client";
import { and, asc, desc, eq, getTableColumns, inArray } from "@acme/db";
import {
  craftMaterials,
  craftProducts,
  crafts,
  items,
  shoppingListCrafts,
  shoppingListInvites,
  shoppingListItems,
  shoppingListMembers,
  shoppingListRoleEnum,
  shoppingLists,
  shoppingListSourceTypeEnum,
  user,
} from "@acme/db/schema";

import { protectedProcedure, publicProcedure } from "../trpc";

const MAX_DEPTH = 4;
type DbClient = typeof db;
type DbTx = Parameters<Parameters<DbClient["transaction"]>[0]>[0];

type ItemRow = typeof items.$inferSelect;
type CraftRow = typeof crafts.$inferSelect;
interface MaterialRow {
  craftId: number;
  amount: number;
  item: ItemRow;
}
interface ProductRow {
  craftId: number;
  amount: number;
  rate: number | null;
  item: ItemRow;
}
interface CraftEntry {
  craft: CraftRow;
  materials: MaterialRow[];
  products: ProductRow[];
}
type SubcraftMap = Record<number, CraftEntry[]>;

function pickPreferredCraft(entries: CraftEntry[], itemId: number): CraftEntry {
  const preferred = [...entries].sort((a, b) => {
    const amountFor = (entry: CraftEntry) =>
      entry.products.find((product) => product.item.id === itemId)?.amount ??
      Number.MAX_SAFE_INTEGER;
    return amountFor(a) - amountFor(b);
  })[0];

  if (!preferred) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "No craft entries available for preferred craft selection.",
    });
  }

  return preferred;
}

async function fetchCraftBlueprint(dbClient: DbClient | DbTx, craftId: number) {
  const craft = await dbClient
    .select()
    .from(crafts)
    .where(eq(crafts.id, craftId))
    .then((rows: CraftRow[]) => rows[0] ?? null);

  if (!craft) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Craft not found." });
  }

  const [materials, products, item] = await Promise.all([
    dbClient
      .select({
        craftId: craftMaterials.craftId,
        amount: craftMaterials.amount,
        item: getTableColumns(items),
      })
      .from(craftMaterials)
      .innerJoin(items, eq(items.id, craftMaterials.itemId))
      .where(eq(craftMaterials.craftId, craftId)),
    dbClient
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
      ? dbClient
          .select()
          .from(items)
          .where(eq(items.id, craft.primaryProductId))
          .then((rows: ItemRow[]) => rows[0] ?? null)
      : Promise.resolve(null),
  ]);

  const allMaterialItemIds = new Set<number>(
    materials.map((m: MaterialRow) => m.item.id),
  );
  const subcraftsByItemId: SubcraftMap = {};
  const visited = new Set<number>([
    craft.primaryProductId ?? -1,
    ...allMaterialItemIds,
  ]);
  let pendingIds = [...allMaterialItemIds];

  while (pendingIds.length > 0) {
    const subCraftRows = await dbClient
      .select()
      .from(crafts)
      .where(inArray(crafts.primaryProductId, pendingIds));

    if (!subCraftRows.length) break;

    const subCraftIds = subCraftRows.map((candidate: CraftRow) => candidate.id);
    const [subMaterials, subProducts] = await Promise.all([
      dbClient
        .select({
          craftId: craftMaterials.craftId,
          amount: craftMaterials.amount,
          item: getTableColumns(items),
        })
        .from(craftMaterials)
        .innerJoin(items, eq(items.id, craftMaterials.itemId))
        .where(inArray(craftMaterials.craftId, subCraftIds)),
      dbClient
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

    const subMaterialsByCraft = subMaterials.reduce(
      (acc: Record<number, MaterialRow[]>, row: MaterialRow) => {
        (acc[row.craftId] ??= []).push(row);
        return acc;
      },
      {},
    );
    const subProductsByCraft = subProducts.reduce(
      (acc: Record<number, ProductRow[]>, row: ProductRow) => {
        (acc[row.craftId] ??= []).push(row);
        return acc;
      },
      {},
    );

    for (const subCraft of subCraftRows) {
      const producedItemId = subCraft.primaryProductId;
      if (producedItemId == null) continue;
      (subcraftsByItemId[producedItemId] ??= []).push({
        craft: subCraft,
        materials: subMaterialsByCraft[subCraft.id] ?? [],
        products: subProductsByCraft[subCraft.id] ?? [],
      });
    }

    const newIds = subMaterials
      .map((row: MaterialRow) => row.item.id)
      .filter((id: number) => !visited.has(id));
    for (const id of newIds) {
      visited.add(id);
      allMaterialItemIds.add(id);
    }
    pendingIds = Array.from(new Set<number>(newIds));
  }

  return {
    craft,
    item,
    materials,
    products,
    subcraftsByItemId,
  };
}

function getSimulationChain(
  mainCraft: {
    materials: MaterialRow[];
  },
  subcraftMap: SubcraftMap,
): { keyMaterialId: number | null; keyMaterialName: string | null } {
  const tierList = [
    "illustrious",
    "magnificent",
    "epherium",
    "delphinad",
    "ayanad",
  ] as const;

  for (const material of mainCraft.materials) {
    const name = material.item.name.toLowerCase();
    if (tierList.some((tier) => name.includes(tier))) {
      return {
        keyMaterialId: material.item.id,
        keyMaterialName: material.item.name,
      };
    }
  }

  for (const material of mainCraft.materials) {
    if (subcraftMap[material.item.id]?.length) {
      return {
        keyMaterialId: material.item.id,
        keyMaterialName: material.item.name,
      };
    }
  }

  return { keyMaterialId: null, keyMaterialName: null };
}

function buildSnapshot(
  entry: CraftEntry,
  craftModeSet: Set<number>,
  subcraftMap: SubcraftMap,
  quantity: number,
) {
  const itemCounts = new Map<
    number,
    { item: ItemRow; requiredQuantity: number }
  >();
  const craftCounts = new Map<
    number,
    { craft: CraftRow; requiredCount: number }
  >();

  const accumulate = (
    currentEntry: CraftEntry,
    scaleFactor: number,
    depth: number,
  ): void => {
    const currentRequiredCount = Math.max(1, Math.ceil(scaleFactor));
    const existingCraft = craftCounts.get(currentEntry.craft.id);
    if (existingCraft) {
      existingCraft.requiredCount += currentRequiredCount;
    } else {
      craftCounts.set(currentEntry.craft.id, {
        craft: currentEntry.craft,
        requiredCount: currentRequiredCount,
      });
    }

    for (const material of currentEntry.materials) {
      const scaledAmount = material.amount * scaleFactor;
      const subcraftEntries = subcraftMap[material.item.id];
      const isCraftable = depth < MAX_DEPTH && !!subcraftEntries?.length;
      if (craftModeSet.has(material.item.id) && isCraftable) {
        const subcraft = pickPreferredCraft(subcraftEntries, material.item.id);
        const producedAmount =
          subcraft.products.find(
            (product) => product.item.id === material.item.id,
          )?.amount ?? 1;
        accumulate(subcraft, scaledAmount / producedAmount, depth + 1);
        continue;
      }

      const requiredQuantity = Math.max(1, Math.ceil(scaledAmount));
      const existingItem = itemCounts.get(material.item.id);
      if (existingItem) {
        existingItem.requiredQuantity += requiredQuantity;
      } else {
        itemCounts.set(material.item.id, {
          item: material.item,
          requiredQuantity,
        });
      }
    }
  };

  accumulate(entry, quantity, 0);

  return {
    items: [...itemCounts.values()].sort((a, b) =>
      a.item.name.localeCompare(b.item.name),
    ),
    crafts: [...craftCounts.values()].sort((a, b) =>
      a.craft.name.localeCompare(b.craft.name),
    ),
  };
}

async function replaceListSnapshot(
  tx: DbTx,
  shoppingListId: string,
  snapshot: ReturnType<typeof buildSnapshot>,
  progress?: {
    itemProgress?: Map<number, number>;
    craftProgress?: Map<number, number>;
  },
) {
  await tx
    .delete(shoppingListItems)
    .where(eq(shoppingListItems.shoppingListId, shoppingListId));
  await tx
    .delete(shoppingListCrafts)
    .where(eq(shoppingListCrafts.shoppingListId, shoppingListId));

  if (snapshot.items.length > 0) {
    await tx.insert(shoppingListItems).values(
      snapshot.items.map((row) => ({
        shoppingListId,
        itemId: row.item.id,
        requiredQuantity: row.requiredQuantity,
        obtainedQuantity: Math.min(
          row.requiredQuantity,
          progress?.itemProgress?.get(row.item.id) ?? 0,
        ),
        updatedAt: new Date(),
      })),
    );
  }

  if (snapshot.crafts.length > 0) {
    await tx.insert(shoppingListCrafts).values(
      snapshot.crafts.map((row) => ({
        shoppingListId,
        craftId: row.craft.id,
        requiredCount: row.requiredCount,
        completedCount: Math.min(
          row.requiredCount,
          progress?.craftProgress?.get(row.craft.id) ?? 0,
        ),
        updatedAt: new Date(),
      })),
    );
  }
}

async function getExistingProgress(
  tx: DbTx,
  shoppingListId: string,
): Promise<{
  itemProgress: Map<number, number>;
  craftProgress: Map<number, number>;
}> {
  const [existingItems, existingCraftRows] = await Promise.all([
    tx
      .select({
        itemId: shoppingListItems.itemId,
        obtainedQuantity: shoppingListItems.obtainedQuantity,
      })
      .from(shoppingListItems)
      .where(eq(shoppingListItems.shoppingListId, shoppingListId)),
    tx
      .select({
        craftId: shoppingListCrafts.craftId,
        completedCount: shoppingListCrafts.completedCount,
      })
      .from(shoppingListCrafts)
      .where(eq(shoppingListCrafts.shoppingListId, shoppingListId)),
  ]);

  return {
    itemProgress: new Map<number, number>(
      existingItems.map((row: { itemId: number; obtainedQuantity: number }) => [
        row.itemId,
        row.obtainedQuantity,
      ]),
    ),
    craftProgress: new Map<number, number>(
      existingCraftRows.map(
        (row: { craftId: number; completedCount: number }) => [
          row.craftId,
          row.completedCount,
        ],
      ),
    ),
  };
}

async function regenerateListState(
  tx: DbTx,
  list: typeof shoppingLists.$inferSelect,
  progress?: {
    itemProgress?: Map<number, number>;
    craftProgress?: Map<number, number>;
  },
) {
  const craftModeSet = new Set(list.craftModeItemIds);
  let snapshot: ReturnType<typeof buildSnapshot>;

  if (list.sourceType === "simulator") {
    const blueprint = await fetchCraftBlueprint(tx, list.sourceCraftId);
    const simulationChain = getSimulationChain(
      blueprint,
      blueprint.subcraftsByItemId,
    );
    const finalUpgradeEntry: CraftEntry = {
      craft: blueprint.craft,
      materials: blueprint.materials.filter(
        (material: MaterialRow) =>
          material.item.id !== simulationChain.keyMaterialId,
      ),
      products: blueprint.products,
    };

    const attemptSnapshot = buildSnapshot(
      {
        craft: blueprint.craft,
        materials: blueprint.materials,
        products: blueprint.products,
      },
      craftModeSet,
      blueprint.subcraftsByItemId,
      list.sourceQuantity,
    );
    const upgradeSnapshot = buildSnapshot(
      finalUpgradeEntry,
      craftModeSet,
      blueprint.subcraftsByItemId,
      1,
    );

    const mergedItems = new Map<
      number,
      { item: ItemRow; requiredQuantity: number }
    >();
    const mergedCrafts = new Map<
      number,
      { craft: CraftRow; requiredCount: number }
    >();

    for (const row of [...attemptSnapshot.items, ...upgradeSnapshot.items]) {
      const existing = mergedItems.get(row.item.id);
      if (existing) existing.requiredQuantity += row.requiredQuantity;
      else mergedItems.set(row.item.id, { ...row });
    }

    for (const row of [...attemptSnapshot.crafts, ...upgradeSnapshot.crafts]) {
      const existing = mergedCrafts.get(row.craft.id);
      if (existing) existing.requiredCount += row.requiredCount;
      else mergedCrafts.set(row.craft.id, { ...row });
    }

    snapshot = {
      items: Array.from(mergedItems.values()).sort((a, b) =>
        a.item.name.localeCompare(b.item.name),
      ),
      crafts: Array.from(mergedCrafts.values()).sort((a, b) =>
        a.craft.name.localeCompare(b.craft.name),
      ),
    };
  } else {
    const blueprint = await fetchCraftBlueprint(tx, list.sourceCraftId);
    const rootEntry: CraftEntry = {
      craft: blueprint.craft,
      materials: blueprint.materials,
      products: blueprint.products,
    };
    snapshot = buildSnapshot(
      rootEntry,
      craftModeSet,
      blueprint.subcraftsByItemId,
      list.sourceQuantity,
    );
  }

  await replaceListSnapshot(tx, list.id, snapshot, progress);
}

async function getListAccess(
  dbClient: DbClient | DbTx,
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

export const shoppingListsRouter = {
  listMineAndShared: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const [owned, shared] = await Promise.all([
      ctx.db
        .select({
          id: shoppingLists.id,
          name: shoppingLists.name,
          sourceType: shoppingLists.sourceType,
          sourceQuantity: shoppingLists.sourceQuantity,
          updatedAt: shoppingLists.updatedAt,
          sourceItem: {
            id: items.id,
            name: items.name,
            icon: items.icon,
          },
          owner: {
            id: user.id,
            name: user.name,
            image: user.image,
          },
        })
        .from(shoppingLists)
        .innerJoin(user, eq(user.id, shoppingLists.ownerUserId))
        .leftJoin(items, eq(items.id, shoppingLists.sourceItemId))
        .where(eq(shoppingLists.ownerUserId, userId))
        .orderBy(desc(shoppingLists.updatedAt)),
      ctx.db
        .select({
          id: shoppingLists.id,
          name: shoppingLists.name,
          sourceType: shoppingLists.sourceType,
          sourceQuantity: shoppingLists.sourceQuantity,
          updatedAt: shoppingLists.updatedAt,
          role: shoppingListMembers.role,
          sourceItem: {
            id: items.id,
            name: items.name,
            icon: items.icon,
          },
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
        .leftJoin(items, eq(items.id, shoppingLists.sourceItemId))
        .where(eq(shoppingListMembers.userId, userId))
        .orderBy(desc(shoppingLists.updatedAt)),
    ]);

    return { owned, shared };
  }),

  getById: protectedProcedure
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      const access = await getListAccess(ctx.db, input, ctx.session.user.id);
      const shoppingListId = access.list.id;

      const [itemRows, craftRows, memberRows, inviteRows] = await Promise.all([
        ctx.db
          .select({
            itemId: shoppingListItems.itemId,
            requiredQuantity: shoppingListItems.requiredQuantity,
            obtainedQuantity: shoppingListItems.obtainedQuantity,
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
            completedCount: shoppingListCrafts.completedCount,
            craft: {
              id: crafts.id,
              name: crafts.name,
              proficiency: crafts.proficiency,
              labor: crafts.labor,
            },
          })
          .from(shoppingListCrafts)
          .innerJoin(crafts, eq(crafts.id, shoppingListCrafts.craftId))
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

      return {
        ...access,
        list: {
          ...access.list,
          craftModeItemIds: access.list.craftModeItemIds,
        },
        items: itemRows,
        crafts: craftRows,
        members: memberRows,
        invites: inviteRows.map((invite) => ({
          ...invite,
          inviteUrl: buildInviteUrl(invite.inviteUrl),
        })),
      };
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
            sourceType: "craft",
            sourceCraftId: input.craftId,
            sourceItemId: blueprint.item?.id ?? null,
            sourceQuantity: input.quantity,
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
            sourceType: "simulator",
            sourceCraftId: input.craftId,
            sourceItemId: targetItem.id,
            sourceQuantity: input.attempts,
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

        await regenerateListState(tx, created);

        return { id: created.id };
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
        const progress = await getExistingProgress(tx, input.listId);
        const [updated] = await tx
          .update(shoppingLists)
          .set({
            name: input.name?.trim() ?? access.list.name,
            sourceType: input.sourceType ?? access.list.sourceType,
            sourceCraftId: input.craftId ?? access.list.sourceCraftId,
            sourceItemId: input.itemId ?? access.list.sourceItemId,
            sourceQuantity: input.quantity ?? access.list.sourceQuantity,
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

      const [row] = await ctx.db
        .select({
          requiredCount: shoppingListCrafts.requiredCount,
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

      await ctx.db
        .update(shoppingListCrafts)
        .set({
          completedCount: Math.min(row.requiredCount, input.completedCount),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(shoppingListCrafts.shoppingListId, input.listId),
            eq(shoppingListCrafts.craftId, input.craftId),
          ),
        );
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
            sourceType: access.list.sourceType,
            sourceCraftId: access.list.sourceCraftId,
            sourceItemId: access.list.sourceItemId,
            sourceQuantity: access.list.sourceQuantity,
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
