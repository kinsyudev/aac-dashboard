import { relations } from "drizzle-orm";
import {
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth-schema";
import { items } from "./game-schema";

export const farmTimerDurationSourceEnum = pgEnum(
  "farm_timer_duration_source",
  ["explicit", "farm_crop_override", "game_timer"],
);

export const farmTimerStatusEnum = pgEnum("farm_timer_status", [
  "pending",
  "canceled",
  "delivered",
  "delivery_failed",
]);

export const farmNotificationKindEnum = pgEnum("farm_notification_kind", [
  "advance",
  "ready",
]);

export const farmNotificationStatusEnum = pgEnum(
  "farm_notification_status",
  ["pending", "delivered", "failed", "skipped"],
);

export const discordFarmUsers = pgTable(
  "discord_farm_users",
  {
    guildId: text("guild_id").notNull(),
    discordUserId: text("discord_user_id").notNull(),
    userId: text("user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    defaultRoleId: text("default_role_id"),
    defaultChannelId: text("default_channel_id"),
    reminderMinutes: integer("reminder_minutes").notNull().default(15),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.discordUserId] }),
    index("idx_discord_farm_users_user").on(table.userId),
  ],
);

export const discordFarms = pgTable(
  "discord_farms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: text("guild_id").notNull(),
    ownerDiscordUserId: text("owner_discord_user_id").notNull(),
    userId: text("user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    defaultRoleId: text("default_role_id"),
    defaultChannelId: text("default_channel_id"),
    screenshotUrl: text("screenshot_url"),
    screenshotProxyUrl: text("screenshot_proxy_url"),
    screenshotContentType: text("screenshot_content_type"),
    screenshotName: text("screenshot_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date()),
  },
  (table) => [
    uniqueIndex("idx_discord_farms_owner_slug").on(
      table.guildId,
      table.ownerDiscordUserId,
      table.slug,
    ),
    index("idx_discord_farms_user").on(table.userId),
  ],
);

export const discordFarmCropOverrides = pgTable(
  "discord_farm_crop_overrides",
  {
    farmId: uuid("farm_id")
      .notNull()
      .references(() => discordFarms.id, { onDelete: "cascade" }),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    durationSeconds: integer("duration_seconds").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.farmId, table.itemId] }),
    index("idx_discord_farm_crop_overrides_item").on(table.itemId),
  ],
);

export const discordFarmTimers = pgTable(
  "discord_farm_timers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: text("guild_id").notNull(),
    ownerDiscordUserId: text("owner_discord_user_id").notNull(),
    userId: text("user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    farmId: uuid("farm_id").references(() => discordFarms.id, {
      onDelete: "set null",
    }),
    cropItemId: integer("crop_item_id")
      .notNull()
      .references(() => items.id, { onDelete: "restrict" }),
    cropName: text("crop_name").notNull(),
    durationSeconds: integer("duration_seconds").notNull(),
    durationSource: farmTimerDurationSourceEnum("duration_source").notNull(),
    explicitDurationSeconds: integer("explicit_duration_seconds"),
    note: text("note"),
    commandChannelId: text("command_channel_id").notNull(),
    reminderChannelId: text("reminder_channel_id").notNull(),
    pingRoleId: text("ping_role_id"),
    plantedAt: timestamp("planted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    readyAt: timestamp("ready_at", { withTimezone: true }).notNull(),
    status: farmTimerStatusEnum("status").notNull().default("pending"),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    deliveryAttemptCount: integer("delivery_attempt_count").notNull().default(0),
    lastDeliveryAttemptAt: timestamp("last_delivery_attempt_at", {
      withTimezone: true,
    }),
    lastDeliveryError: text("last_delivery_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date()),
  },
  (table) => [
    index("idx_discord_farm_timers_owner_status").on(
      table.guildId,
      table.ownerDiscordUserId,
      table.status,
    ),
    index("idx_discord_farm_timers_due").on(table.status, table.readyAt),
    index("idx_discord_farm_timers_user").on(table.userId),
  ],
);

export const discordFarmNotifications = pgTable(
  "discord_farm_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    timerId: uuid("timer_id")
      .notNull()
      .references(() => discordFarmTimers.id, { onDelete: "cascade" }),
    kind: farmNotificationKindEnum("kind").notNull(),
    status: farmNotificationStatusEnum("status").notNull().default("pending"),
    notifyAt: timestamp("notify_at", { withTimezone: true }).notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastError: text("last_error"),
    discordMessageId: text("discord_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date()),
  },
  (table) => [
    uniqueIndex("idx_discord_farm_notifications_timer_kind").on(
      table.timerId,
      table.kind,
    ),
    index("idx_discord_farm_notifications_due").on(
      table.status,
      table.notifyAt,
    ),
  ],
);

export const discordFarmUsersRelations = relations(
  discordFarmUsers,
  ({ one }) => ({
    dashboardUser: one(user, {
      fields: [discordFarmUsers.userId],
      references: [user.id],
    }),
  }),
);

export const discordFarmsRelations = relations(
  discordFarms,
  ({ one, many }) => ({
    dashboardUser: one(user, {
      fields: [discordFarms.userId],
      references: [user.id],
    }),
    cropOverrides: many(discordFarmCropOverrides),
    timers: many(discordFarmTimers),
  }),
);

export const discordFarmCropOverridesRelations = relations(
  discordFarmCropOverrides,
  ({ one }) => ({
    farm: one(discordFarms, {
      fields: [discordFarmCropOverrides.farmId],
      references: [discordFarms.id],
    }),
    item: one(items, {
      fields: [discordFarmCropOverrides.itemId],
      references: [items.id],
    }),
  }),
);

export const discordFarmTimersRelations = relations(
  discordFarmTimers,
  ({ one, many }) => ({
    dashboardUser: one(user, {
      fields: [discordFarmTimers.userId],
      references: [user.id],
    }),
    farm: one(discordFarms, {
      fields: [discordFarmTimers.farmId],
      references: [discordFarms.id],
    }),
    cropItem: one(items, {
      fields: [discordFarmTimers.cropItemId],
      references: [items.id],
    }),
    notifications: many(discordFarmNotifications),
  }),
);

export const discordFarmNotificationsRelations = relations(
  discordFarmNotifications,
  ({ one }) => ({
    timer: one(discordFarmTimers, {
      fields: [discordFarmNotifications.timerId],
      references: [discordFarmTimers.id],
    }),
  }),
);
