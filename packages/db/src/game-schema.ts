import { relations } from "drizzle-orm";
import { index, pgTable, primaryKey } from "drizzle-orm/pg-core";

export const items = pgTable("items", (t) => ({
  id: t.integer().primaryKey(),
  name: t.text().notNull(),
  description: t.text(),
  category: t.text().notNull(),
  level: t.integer().notNull().default(0),
  price: t.integer().notNull().default(0),
  refund: t.integer().notNull().default(0),
  bindId: t.integer().notNull().default(0),
  sellable: t.boolean().notNull().default(false),
  implId: t.integer().notNull().default(0),
  fixedGrade: t.integer().notNull().default(-1),
  gradable: t.boolean().notNull().default(false),
  maxStackSize: t.integer().notNull().default(1),
  levelRequirement: t.integer().notNull().default(0),
  levelLimit: t.integer().notNull().default(0),
  icon: t.text(),
  overIcon: t.text(),
}));

export const crafts = pgTable("crafts", (t) => ({
  id: t.integer().primaryKey(),
  name: t.text().notNull(),
  labor: t.integer().notNull().default(0),
  castDelayMs: t.integer().notNull().default(0),
  primaryProductId: t.integer().references(() => items.id),
}));

export const craftMaterials = pgTable(
  "craft_materials",
  (t) => ({
    craftId: t.integer().notNull().references(() => crafts.id),
    itemId: t.integer().notNull().references(() => items.id),
    amount: t.integer().notNull().default(1),
  }),
  (table) => [
    primaryKey({ columns: [table.craftId, table.itemId] }),
    index("idx_craft_materials_item").on(table.itemId),
  ],
);

export const craftProducts = pgTable(
  "craft_products",
  (t) => ({
    craftId: t.integer().notNull().references(() => crafts.id),
    itemId: t.integer().notNull().references(() => items.id),
    amount: t.integer().notNull().default(1),
    rate: t.integer().notNull().default(100),
  }),
  (table) => [
    primaryKey({ columns: [table.craftId, table.itemId] }),
    index("idx_craft_products_item").on(table.itemId),
  ],
);

export const itemLaborOverrides = pgTable("item_labor_overrides", (t) => ({
  itemId: t.integer().primaryKey().references(() => items.id),
  labor: t.integer().notNull(),
}));

export const laborOverrides = pgTable("labor_overrides", (t) => ({
  craftId: t.integer().primaryKey().references(() => crafts.id),
  labor: t.integer().notNull(),
}));

export const prices = pgTable(
  "prices",
  (t) => ({
    itemId: t.integer().notNull().references(() => items.id),
    itemName: t.text().notNull(),
    avg24h: t.text("avg_24h"),
    vol24h: t.text("vol_24h"),
    avg7d: t.text("avg_7d"),
    vol7d: t.text("vol_7d"),
    avg30d: t.text("avg_30d"),
    vol30d: t.text("vol_30d"),
    fetchedAt: t.text().notNull(),
  }),
  (table) => [
    primaryKey({ columns: [table.itemId, table.fetchedAt] }),
    index("idx_prices_item_fetched").on(table.itemId, table.fetchedAt),
  ],
);

export const itemsRelations = relations(items, ({ many, one }) => ({
  craftMaterials: many(craftMaterials),
  craftProducts: many(craftProducts),
  crafts: many(crafts),
  prices: many(prices),
  laborOverride: one(itemLaborOverrides, {
    fields: [items.id],
    references: [itemLaborOverrides.itemId],
  }),
}));

export const craftsRelations = relations(crafts, ({ many, one }) => ({
  craftMaterials: many(craftMaterials),
  craftProducts: many(craftProducts),
  primaryProduct: one(items, {
    fields: [crafts.primaryProductId],
    references: [items.id],
  }),
  laborOverride: one(laborOverrides, {
    fields: [crafts.id],
    references: [laborOverrides.craftId],
  }),
}));

export const craftMaterialsRelations = relations(craftMaterials, ({ one }) => ({
  craft: one(crafts, {
    fields: [craftMaterials.craftId],
    references: [crafts.id],
  }),
  item: one(items, {
    fields: [craftMaterials.itemId],
    references: [items.id],
  }),
}));

export const craftProductsRelations = relations(craftProducts, ({ one }) => ({
  craft: one(crafts, {
    fields: [craftProducts.craftId],
    references: [crafts.id],
  }),
  item: one(items, {
    fields: [craftProducts.itemId],
    references: [items.id],
  }),
}));

export const itemLaborOverridesRelations = relations(
  itemLaborOverrides,
  ({ one }) => ({
    item: one(items, {
      fields: [itemLaborOverrides.itemId],
      references: [items.id],
    }),
  }),
);

export const laborOverridesRelations = relations(laborOverrides, ({ one }) => ({
  craft: one(crafts, {
    fields: [laborOverrides.craftId],
    references: [crafts.id],
  }),
}));

export const pricesRelations = relations(prices, ({ one }) => ({
  item: one(items, {
    fields: [prices.itemId],
    references: [items.id],
  }),
}));
