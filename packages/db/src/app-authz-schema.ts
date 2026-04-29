import { relations } from "drizzle-orm";
import { index, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth-schema";

export const appRoleEnum = pgEnum("app_role", ["member", "admin"]);

export const appUserRole = pgTable(
  "app_user_role",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    role: appRoleEnum().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("app_user_role_role_idx").on(table.role)],
);

export const appUserRoleRelations = relations(appUserRole, ({ one }) => ({
  user: one(user, {
    fields: [appUserRole.userId],
    references: [user.id],
  }),
}));
