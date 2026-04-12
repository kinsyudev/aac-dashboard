import { relations, sql } from "drizzle-orm";
import { index, pgEnum, pgTable, primaryKey } from "drizzle-orm/pg-core";

import { user } from "./auth-schema";
import { crafts, items } from "./game-schema";

export const shoppingListRoleEnum = pgEnum("shopping_list_role", [
  "read",
  "write",
]);

export const shoppingListSourceTypeEnum = pgEnum("shopping_list_source_type", [
  "craft",
  "simulator",
]);

export const shoppingLists = pgTable(
  "shopping_lists",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    ownerUserId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: t.text().notNull(),
    sourceType: shoppingListSourceTypeEnum().notNull().default("craft"),
    sourceCraftId: t
      .integer()
      .notNull()
      .references(() => crafts.id, { onDelete: "cascade" }),
    sourceItemId: t.integer().references(() => items.id, {
      onDelete: "set null",
    }),
    sourceQuantity: t.integer().notNull().default(1),
    craftModeItemIds: t
      .jsonb()
      .$type<number[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: t.timestamp().notNull().defaultNow(),
    updatedAt: t.timestamp().notNull().defaultNow(),
  }),
  (table) => [index("idx_shopping_lists_owner").on(table.ownerUserId)],
);

export const shoppingListItems = pgTable(
  "shopping_list_items",
  (t) => ({
    shoppingListId: t
      .uuid()
      .notNull()
      .references(() => shoppingLists.id, { onDelete: "cascade" }),
    itemId: t
      .integer()
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    requiredQuantity: t.integer().notNull().default(0),
    obtainedQuantity: t.integer().notNull().default(0),
    updatedAt: t.timestamp().notNull().defaultNow(),
  }),
  (table) => [
    primaryKey({ columns: [table.shoppingListId, table.itemId] }),
    index("idx_shopping_list_items_list").on(table.shoppingListId),
  ],
);

export const shoppingListCrafts = pgTable(
  "shopping_list_crafts",
  (t) => ({
    shoppingListId: t
      .uuid()
      .notNull()
      .references(() => shoppingLists.id, { onDelete: "cascade" }),
    craftId: t
      .integer()
      .notNull()
      .references(() => crafts.id, { onDelete: "cascade" }),
    requiredCount: t.integer().notNull().default(0),
    completedCount: t.integer().notNull().default(0),
    updatedAt: t.timestamp().notNull().defaultNow(),
  }),
  (table) => [
    primaryKey({ columns: [table.shoppingListId, table.craftId] }),
    index("idx_shopping_list_crafts_list").on(table.shoppingListId),
  ],
);

export const shoppingListMembers = pgTable(
  "shopping_list_members",
  (t) => ({
    shoppingListId: t
      .uuid()
      .notNull()
      .references(() => shoppingLists.id, { onDelete: "cascade" }),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: shoppingListRoleEnum().notNull(),
    acceptedAt: t.timestamp().notNull().defaultNow(),
  }),
  (table) => [
    primaryKey({ columns: [table.shoppingListId, table.userId] }),
    index("idx_shopping_list_members_user").on(table.userId),
  ],
);

export const shoppingListInvites = pgTable(
  "shopping_list_invites",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    shoppingListId: t
      .uuid()
      .notNull()
      .references(() => shoppingLists.id, { onDelete: "cascade" }),
    token: t.text().notNull().unique(),
    role: shoppingListRoleEnum().notNull(),
    createdByUserId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    consumedByUserId: t.text().references(() => user.id, {
      onDelete: "set null",
    }),
    revokedAt: t.timestamp(),
    consumedAt: t.timestamp(),
    expiresAt: t.timestamp(),
    createdAt: t.timestamp().notNull().defaultNow(),
  }),
  (table) => [
    index("idx_shopping_list_invites_list").on(table.shoppingListId),
    index("idx_shopping_list_invites_token").on(table.token),
  ],
);

export const shoppingListsRelations = relations(shoppingLists, ({ one, many }) => ({
  owner: one(user, {
    fields: [shoppingLists.ownerUserId],
    references: [user.id],
  }),
  sourceItem: one(items, {
    fields: [shoppingLists.sourceItemId],
    references: [items.id],
  }),
  sourceCraft: one(crafts, {
    fields: [shoppingLists.sourceCraftId],
    references: [crafts.id],
  }),
  items: many(shoppingListItems),
  crafts: many(shoppingListCrafts),
  members: many(shoppingListMembers),
  invites: many(shoppingListInvites),
}));

export const shoppingListItemsRelations = relations(
  shoppingListItems,
  ({ one }) => ({
    shoppingList: one(shoppingLists, {
      fields: [shoppingListItems.shoppingListId],
      references: [shoppingLists.id],
    }),
    item: one(items, {
      fields: [shoppingListItems.itemId],
      references: [items.id],
    }),
  }),
);

export const shoppingListCraftsRelations = relations(
  shoppingListCrafts,
  ({ one }) => ({
    shoppingList: one(shoppingLists, {
      fields: [shoppingListCrafts.shoppingListId],
      references: [shoppingLists.id],
    }),
    craft: one(crafts, {
      fields: [shoppingListCrafts.craftId],
      references: [crafts.id],
    }),
  }),
);

export const shoppingListMembersRelations = relations(
  shoppingListMembers,
  ({ one }) => ({
    shoppingList: one(shoppingLists, {
      fields: [shoppingListMembers.shoppingListId],
      references: [shoppingLists.id],
    }),
    user: one(user, {
      fields: [shoppingListMembers.userId],
      references: [user.id],
    }),
  }),
);

export const shoppingListInvitesRelations = relations(
  shoppingListInvites,
  ({ one }) => ({
    shoppingList: one(shoppingLists, {
      fields: [shoppingListInvites.shoppingListId],
      references: [shoppingLists.id],
    }),
    createdBy: one(user, {
      fields: [shoppingListInvites.createdByUserId],
      references: [user.id],
    }),
    consumedBy: one(user, {
      fields: [shoppingListInvites.consumedByUserId],
      references: [user.id],
    }),
  }),
);
