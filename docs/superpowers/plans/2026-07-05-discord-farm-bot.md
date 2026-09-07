# Discord Farm Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Sapphire-based Discord bot that helps private-server users track ArcheAge farm planting timers, using parsed in-game crop timers by default and user/farm overrides when configured.

**Architecture:** Add `apps/discord-bot` as a long-running Railway worker in the existing pnpm/turbo monorepo. Persist users, farms, crop overrides, timers, and delivery attempts in Postgres through `@acme/db`; use Sapphire slash commands for UX and a single-instance polling loop for reminder delivery.

**Tech Stack:** Node 22, pnpm 11, TypeScript, Sapphire, discord.js, Drizzle ORM, Postgres, node:test, tsx, Turborepo.

---

## Product Decisions

- The bot runs as one Railway worker process in v1.
- Discord-only users are supported; dashboard `user.id` linking is nullable and automatic when a matching Discord OAuth account exists.
- Dashboard UI is out of scope. The data model must still be dashboard-readable.
- Plain crop names resolve to base seed items, such as `carrot` resolving to `Carrot Seed`.
- Bundles and greenhouses are selected only when the user names them explicitly.
- Farm climate does not affect v1 timer inference.
- Timer duration priority is explicit `/plant duration`, then farm+crop override, then parsed in-game item description timer.
- Saved duration overrides are farm+crop specific, not global.
- Timers are one-shot. Delivered reminders include a `Replant` button that creates a fresh one-shot timer.
- Replant reuses explicit duration if the original timer used one; otherwise it recomputes the effective duration from current farm override or game data.
- Each user manages only their own farms and timers in v1.
- Pre-reminders ping only the planting user. Default advance reminder is 15 minutes; `0` disables pre-reminders.
- Final reminders ping explicit role, farm default role, user default role, then planting user.
- Final reminders post to explicit channel, farm default channel, user default channel, then the channel where `/plant` was run.
- Management command responses are ephemeral. Pre-reminders and final reminders are normal channel messages.
- Timer rows are kept indefinitely for now.
- Delivery failures retry up to 5 times, then stop retrying with error state recorded.

## File Structure

Create these files:

- `apps/discord-bot/package.json`: workspace package manifest, scripts, Sapphire/Discord dependencies.
- `apps/discord-bot/tsconfig.json`: TypeScript config using `@acme/tsconfig/base.json`.
- `apps/discord-bot/eslint.config.ts`: package eslint config matching existing app patterns.
- `apps/discord-bot/src/env.ts`: validates Discord bot token and optional guild id.
- `apps/discord-bot/src/index.ts`: creates Sapphire client, logs in, starts scheduler.
- `apps/discord-bot/src/lib/duration.ts`: parses and formats duration strings.
- `apps/discord-bot/src/lib/duration.test.ts`: unit tests for duration parsing/formatting.
- `apps/discord-bot/src/lib/crop-timers.ts`: parses item descriptions and resolves crop aliases.
- `apps/discord-bot/src/lib/crop-timers.test.ts`: unit tests for crop parser and resolver.
- `apps/discord-bot/src/lib/identity.ts`: resolves Discord user to optional dashboard user.
- `apps/discord-bot/src/lib/farms.ts`: farm/settings persistence helpers.
- `apps/discord-bot/src/lib/farms.test.ts`: pure tests for fallback/default resolution.
- `apps/discord-bot/src/lib/timers.ts`: creates, lists, cancels, and replants timers.
- `apps/discord-bot/src/lib/timers.test.ts`: pure tests for duration priority and replant rules.
- `apps/discord-bot/src/lib/messages.ts`: builds Discord reminder message payloads.
- `apps/discord-bot/src/lib/scheduler.ts`: polls due notifications and records delivery attempts.
- `apps/discord-bot/src/lib/scheduler.test.ts`: pure tests for due notification selection and retry decisions.
- `apps/discord-bot/src/commands/plant.ts`: `/plant` slash command and crop/farm autocomplete.
- `apps/discord-bot/src/commands/timers.ts`: `/timers` slash command.
- `apps/discord-bot/src/commands/timer.ts`: `/timer cancel` slash command.
- `apps/discord-bot/src/commands/farm.ts`: `/farm add`, `/farm set-defaults`, `/farm crop-override`, `/farm list`, `/farm show`.
- `apps/discord-bot/src/commands/settings.ts`: `/settings reminder-minutes`, `/settings show`.
- `apps/discord-bot/src/interaction-handlers/replant.ts`: handles final reminder `Replant` button.

Modify these files:

- `packages/db/src/bot-schema.ts`: new Drizzle tables and relations for the bot.
- `packages/db/src/schema.ts`: export the bot schema.
- `turbo.json`: add Discord bot env vars to `globalEnv`.

Keep these files unchanged:

- `packages/api/*`: no API routes are needed for v1.
- `apps/tanstack-start/*`: dashboard UI comes after the bot MVP.

## Task 1: Scaffold `apps/discord-bot`

**Files:**
- Create: `apps/discord-bot/package.json`
- Create: `apps/discord-bot/tsconfig.json`
- Create: `apps/discord-bot/eslint.config.ts`
- Create: `apps/discord-bot/src/env.ts`
- Create: `apps/discord-bot/src/index.ts`
- Modify: `turbo.json`

- [ ] **Step 1: Create the package manifest**

Create `apps/discord-bot/package.json` with this content:

```json
{
  "name": "@acme/discord-bot",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "dev": "pnpm with-env tsx watch src/index.ts",
    "start": "pnpm with-env tsx src/index.ts",
    "test": "node --import tsx --test \"src/**/*.test.ts\"",
    "typecheck": "tsc --noEmit",
    "lint": "eslint --flag unstable_native_nodejs_ts_config",
    "with-env": "dotenv -e ../../.env --"
  },
  "dependencies": {
    "@acme/db": "workspace:*",
    "@sapphire/framework": "^5.3.6",
    "@t3-oss/env-core": "catalog:",
    "discord.js": "^14.19.3",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@acme/eslint-config": "workspace:*",
    "@acme/prettier-config": "workspace:*",
    "@acme/tsconfig": "workspace:*",
    "@types/node": "catalog:",
    "eslint": "catalog:",
    "prettier": "catalog:",
    "tsx": "4.21.0",
    "typescript": "catalog:"
  },
  "prettier": "@acme/prettier-config"
}
```

- [ ] **Step 2: Create TypeScript config**

Create `apps/discord-bot/tsconfig.json` with this content:

```json
{
  "extends": "@acme/tsconfig/base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create eslint config**

Create `apps/discord-bot/eslint.config.ts` with this content:

```ts
import { defineConfig } from "eslint/config";

import { baseConfig } from "@acme/eslint-config/base";

export default defineConfig(
  {
    ignores: ["dist/**"],
  },
  baseConfig,
);
```

- [ ] **Step 4: Create env validation**

Create `apps/discord-bot/src/env.ts` with this content:

```ts
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod/v4";

export function botEnv() {
  return createEnv({
    server: {
      AAC_DISCORD_BOT_TOKEN: z.string().min(1),
      AAC_DISCORD_GUILD_ID: z.string().min(1).optional(),
      DATABASE_URL: z.string().min(1),
      NODE_ENV: z.enum(["development", "production"]).optional(),
    },
    runtimeEnv: process.env,
    skipValidation:
      !!process.env.CI || process.env.npm_lifecycle_event === "lint",
  });
}
```

- [ ] **Step 5: Create minimal bot entrypoint**

Create `apps/discord-bot/src/index.ts` with this content:

```ts
import { LogLevel, SapphireClient } from "@sapphire/framework";
import { GatewayIntentBits } from "discord.js";

import { botEnv } from "./env";

const env = botEnv();

const client = new SapphireClient({
  defaultPrefix: "!",
  intents: [GatewayIntentBits.Guilds],
  logger: {
    level: process.env.NODE_ENV === "production" ? LogLevel.Info : LogLevel.Debug,
  },
});

client.once("ready", () => {
  client.logger.info(`Discord farm bot logged in as ${client.user?.tag}`);
});

await client.login(env.AAC_DISCORD_BOT_TOKEN);
```

- [ ] **Step 6: Add bot env vars to Turbo**

Modify `turbo.json` and add `AAC_DISCORD_GUILD_ID` to `globalEnv`, near `AAC_DISCORD_BOT_TOKEN`:

```json
"globalEnv": [
  "AAC_AUTH",
  "AAC_DISCORD_BOT_TOKEN",
  "AAC_DISCORD_GUILD_ID",
  "AUTH_ALLOWED_DISCORD_IDS",
  "AUTH_DISCORD_ID",
  "AUTH_DISCORD_GUILD_ID",
  "AUTH_DISCORD_ROLE_ID",
  "AUTH_DISCORD_SECRET",
  "AUTH_REDIRECT_PROXY_URL",
  "AUTH_SECRET",
  "DATABASE_URL",
  "DEV",
  "PORT"
]
```

- [ ] **Step 7: Install dependencies**

Run:

```bash
pnpm install
```

Expected: `pnpm-lock.yaml` updates and workspace dependency checks pass.

- [ ] **Step 8: Verify scaffold**

Run:

```bash
pnpm -F @acme/discord-bot typecheck
pnpm -F @acme/discord-bot lint
```

Expected: both commands pass.

- [ ] **Step 9: Commit scaffold**

Run:

```bash
git add apps/discord-bot package.json pnpm-lock.yaml turbo.json
git commit -m "feat: scaffold discord farm bot app"
```

## Task 2: Add Bot Database Schema

**Files:**
- Create: `packages/db/src/bot-schema.ts`
- Modify: `packages/db/src/schema.ts`

- [ ] **Step 1: Create bot schema**

Create `packages/db/src/bot-schema.ts` with this content:

```ts
import { relations, sql } from "drizzle-orm";
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
      .$onUpdateFn(() => sql`now()`),
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
      .$onUpdateFn(() => sql`now()`),
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
      .$onUpdateFn(() => sql`now()`),
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
      .$onUpdateFn(() => sql`now()`),
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
      .$onUpdateFn(() => sql`now()`),
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
```

- [ ] **Step 2: Export the schema**

Modify `packages/db/src/schema.ts` so it exports the new schema:

```ts
export * from "./app-authz-schema";
export * from "./auth-schema";
export * from "./bot-schema";
export * from "./game-schema";
export * from "./shopping-schema";
```

Keep the existing `Post` table and `CreatePostSchema` definitions in the same file.

- [ ] **Step 3: Verify schema types**

Run:

```bash
pnpm -F @acme/db typecheck
```

Expected: pass.

- [ ] **Step 4: Push schema to development database**

Run:

```bash
pnpm db:push
```

Expected: Drizzle applies the new tables and enums.

- [ ] **Step 5: Commit schema**

Run:

```bash
git add packages/db/src/bot-schema.ts packages/db/src/schema.ts
git commit -m "feat: add discord farm bot schema"
```

## Task 3: Implement Duration Parsing

**Files:**
- Create: `apps/discord-bot/src/lib/duration.test.ts`
- Create: `apps/discord-bot/src/lib/duration.ts`

- [ ] **Step 1: Write failing duration tests**

Create `apps/discord-bot/src/lib/duration.test.ts` with this content:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { formatDuration, parseDurationSeconds } from "./duration";

test("parses compact duration units", () => {
  assert.equal(parseDurationSeconds("45m"), 45 * 60);
  assert.equal(parseDurationSeconds("1h 30m"), 90 * 60);
  assert.equal(parseDurationSeconds("2d 4h"), 52 * 60 * 60);
  assert.equal(parseDurationSeconds("90m"), 90 * 60);
  assert.equal(parseDurationSeconds("3600s"), 3600);
});

test("rejects vague and invalid durations", () => {
  assert.equal(parseDurationSeconds("tomorrow"), null);
  assert.equal(parseDurationSeconds("half hour"), null);
  assert.equal(parseDurationSeconds("1hour"), null);
  assert.equal(parseDurationSeconds("0m"), null);
  assert.equal(parseDurationSeconds("15"), null);
});

test("caps duration at 14 days", () => {
  assert.equal(parseDurationSeconds("14d"), 14 * 24 * 60 * 60);
  assert.equal(parseDurationSeconds("14d 1s"), null);
});

test("formats durations for Discord messages", () => {
  assert.equal(formatDuration(45 * 60), "45m");
  assert.equal(formatDuration(90 * 60), "1h 30m");
  assert.equal(formatDuration(52 * 60 * 60), "2d 4h");
  assert.equal(formatDuration(3600), "1h");
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm -F @acme/discord-bot test -- src/lib/duration.test.ts
```

Expected: fail because `./duration` does not exist.

- [ ] **Step 3: Implement duration parser**

Create `apps/discord-bot/src/lib/duration.ts` with this content:

```ts
const MAX_DURATION_SECONDS = 14 * 24 * 60 * 60;

const UNIT_SECONDS = {
  d: 24 * 60 * 60,
  h: 60 * 60,
  m: 60,
  s: 1,
} as const;

export type DurationUnit = keyof typeof UNIT_SECONDS;

export function parseDurationSeconds(input: string) {
  const normalized = input.trim().toLowerCase();
  if (normalized.length === 0) return null;

  const matches = Array.from(normalized.matchAll(/(\d+)\s*([dhms])/g));
  if (matches.length === 0) return null;

  const consumed = matches.map((match) => match[0]).join(" ");
  if (consumed.replaceAll(/\s+/g, "") !== normalized.replaceAll(/\s+/g, "")) {
    return null;
  }

  let total = 0;
  for (const match of matches) {
    const rawValue = match[1];
    const rawUnit = match[2] as DurationUnit | undefined;
    if (!rawValue || !rawUnit) return null;

    const value = Number(rawValue);
    if (!Number.isInteger(value) || value <= 0) return null;
    total += value * UNIT_SECONDS[rawUnit];
  }

  if (total <= 0 || total > MAX_DURATION_SECONDS) return null;
  return total;
}

export function formatDuration(totalSeconds: number) {
  let remaining = Math.max(0, Math.floor(totalSeconds));
  const parts: string[] = [];

  for (const unit of ["d", "h", "m", "s"] as const) {
    const unitSeconds = UNIT_SECONDS[unit];
    const value = Math.floor(remaining / unitSeconds);
    if (value === 0) continue;
    parts.push(`${value}${unit}`);
    remaining -= value * unitSeconds;
  }

  return parts.length > 0 ? parts.join(" ") : "0s";
}
```

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
pnpm -F @acme/discord-bot test -- src/lib/duration.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit duration utility**

Run:

```bash
git add apps/discord-bot/src/lib/duration.ts apps/discord-bot/src/lib/duration.test.ts
git commit -m "feat: add farm bot duration parser"
```

## Task 4: Implement Crop Timer Parsing and Resolution

**Files:**
- Create: `apps/discord-bot/src/lib/crop-timers.test.ts`
- Create: `apps/discord-bot/src/lib/crop-timers.ts`

- [ ] **Step 1: Write failing crop timer tests**

Create `apps/discord-bot/src/lib/crop-timers.test.ts` with this content:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCropAliases,
  parseGrowthTimerSeconds,
  resolveCropAlias,
  stripArcheAgeMarkup,
} from "./crop-timers";

const items = [
  {
    id: 15661,
    name: "Carrot Seed",
    description:
      "Plants a |cFFf5CB65carrot seed|r.\n\nMatures in approx. 43 m\nClimate: Temperate",
  },
  {
    id: 26449,
    name: "Carrot Seed Bundle",
    description:
      "Plants a bundle of carrot seeds.\n\nMatures in approx. |cFFFF9C275 h 43 m|r\nClimate: Temperate",
  },
  {
    id: 35187,
    name: "Carrot Greenhouse",
    description:
      "Plants a greenhouse.\n\nMatures in approx. |cFFFF9C272 h|r",
  },
  {
    id: 15664,
    name: "Cucumber Seed",
    description: "Matures in approx. 10 m",
  },
];

test("strips ArcheAge color markup", () => {
  assert.equal(stripArcheAgeMarkup("|cFFFF9C275 h 43 m|r"), "5 h 43 m");
});

test("parses growth timers from item descriptions", () => {
  assert.equal(parseGrowthTimerSeconds(items[0]!.description), 43 * 60);
  assert.equal(parseGrowthTimerSeconds(items[1]!.description), 5 * 60 * 60 + 43 * 60);
  assert.equal(parseGrowthTimerSeconds(items[2]!.description), 2 * 60 * 60);
  assert.equal(parseGrowthTimerSeconds("No timer here"), null);
});

test("builds aliases for seed, bundle, and greenhouse items", () => {
  const aliases = buildCropAliases(items);

  assert.equal(resolveCropAlias(aliases, "carrot")?.item.id, 15661);
  assert.equal(resolveCropAlias(aliases, "carrot seed")?.item.id, 15661);
  assert.equal(resolveCropAlias(aliases, "carrot bundle")?.item.id, 26449);
  assert.equal(resolveCropAlias(aliases, "carrot seed bundle")?.item.id, 26449);
  assert.equal(resolveCropAlias(aliases, "carrot greenhouse")?.item.id, 35187);
});

test("rejects ambiguous aliases", () => {
  const aliases = buildCropAliases([
    ...items,
    { id: 1, name: "Blue Seed", description: "Matures in approx. 1 h" },
    { id: 2, name: "Blue Greenhouse", description: "Matures in approx. 2 h" },
  ]);

  assert.equal(resolveCropAlias(aliases, "blue")?.kind, "ambiguous");
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm -F @acme/discord-bot test -- src/lib/crop-timers.test.ts
```

Expected: fail because `./crop-timers` does not exist.

- [ ] **Step 3: Implement crop timer utility**

Create `apps/discord-bot/src/lib/crop-timers.ts` with this content:

```ts
import { parseDurationSeconds } from "./duration";

export interface CropTimerItem {
  id: number;
  name: string;
  description: string | null;
}

export interface CropAliasMatch {
  kind: "match";
  item: CropTimerItem;
  growthSeconds: number;
}

export interface CropAliasAmbiguous {
  kind: "ambiguous";
  matches: CropAliasMatch[];
}

export type CropAliasResult = CropAliasMatch | CropAliasAmbiguous | null;

export type CropAliasMap = Map<string, CropAliasMatch[]>;

export function stripArcheAgeMarkup(input: string) {
  return input
    .replaceAll(/\|c[0-9A-Fa-f]{8}/g, "")
    .replaceAll("|r", "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

export function parseGrowthTimerSeconds(description: string | null) {
  if (!description) return null;

  const clean = stripArcheAgeMarkup(description);
  const match = clean.match(/Matures in approx\.\s+((?:\d+\s*[dhms]\s*)+)/i);
  if (!match?.[1]) return null;

  return parseDurationSeconds(match[1]);
}

function normalizeAlias(input: string) {
  return input.trim().toLowerCase().replaceAll(/\s+/g, " ");
}

function cropBaseName(name: string) {
  return name
    .replace(/\s+Seed Bundle$/i, "")
    .replace(/\s+Seed$/i, "")
    .replace(/\s+Greenhouse$/i, "")
    .trim();
}

function aliasesForItem(name: string) {
  const normalizedName = normalizeAlias(name);
  const base = normalizeAlias(cropBaseName(name));
  const aliases = new Set<string>([normalizedName]);

  if (/ Seed$/i.test(name)) {
    aliases.add(base);
    aliases.add(`${base} seed`);
  }

  if (/ Seed Bundle$/i.test(name)) {
    aliases.add(`${base} bundle`);
    aliases.add(`${base} seed bundle`);
  }

  if (/ Greenhouse$/i.test(name)) {
    aliases.add(`${base} greenhouse`);
  }

  return Array.from(aliases);
}

export function buildCropAliases(items: CropTimerItem[]) {
  const aliases: CropAliasMap = new Map();

  for (const item of items) {
    const growthSeconds = parseGrowthTimerSeconds(item.description);
    if (growthSeconds == null) continue;

    for (const alias of aliasesForItem(item.name)) {
      const existing = aliases.get(alias) ?? [];
      existing.push({ kind: "match", item, growthSeconds });
      aliases.set(alias, existing);
    }
  }

  return aliases;
}

export function resolveCropAlias(
  aliases: CropAliasMap,
  rawInput: string,
): CropAliasResult {
  const matches = aliases.get(normalizeAlias(rawInput)) ?? [];
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0] ?? null;
  return { kind: "ambiguous", matches };
}
```

- [ ] **Step 4: Run crop timer tests**

Run:

```bash
pnpm -F @acme/discord-bot test -- src/lib/crop-timers.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit crop timer utility**

Run:

```bash
git add apps/discord-bot/src/lib/crop-timers.ts apps/discord-bot/src/lib/crop-timers.test.ts
git commit -m "feat: parse crop growth timers"
```

## Task 5: Implement Identity, Settings, and Farm Services

**Files:**
- Create: `apps/discord-bot/src/lib/identity.ts`
- Create: `apps/discord-bot/src/lib/farms.test.ts`
- Create: `apps/discord-bot/src/lib/farms.ts`

- [ ] **Step 1: Create identity resolver**

Create `apps/discord-bot/src/lib/identity.ts` with this content:

```ts
import { and, eq } from "@acme/db";
import type { db as appDb } from "@acme/db/client";
import { account } from "@acme/db/schema";

export async function findDashboardUserIdForDiscordUser(
  database: typeof appDb,
  discordUserId: string,
) {
  const row = await database.query.account.findFirst({
    columns: { userId: true },
    where: and(
      eq(account.providerId, "discord"),
      eq(account.accountId, discordUserId),
    ),
  });

  return row?.userId ?? null;
}
```

- [ ] **Step 2: Write failing farm fallback tests**

Create `apps/discord-bot/src/lib/farms.test.ts` with this content:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { normalizeFarmSlug, resolveReminderDefaults } from "./farms";

test("normalizes farm slugs", () => {
  assert.equal(normalizeFarmSlug(" Main Farm "), "main-farm");
  assert.equal(normalizeFarmSlug("main_farm"), "main-farm");
  assert.equal(normalizeFarmSlug("main--farm"), "main-farm");
});

test("resolves reminder channel fallback", () => {
  assert.deepEqual(
    resolveReminderDefaults({
      explicitChannelId: "explicit-channel",
      explicitRoleId: null,
      farmDefaultChannelId: "farm-channel",
      farmDefaultRoleId: "farm-role",
      userDefaultChannelId: "user-channel",
      userDefaultRoleId: "user-role",
      commandChannelId: "command-channel",
      ownerDiscordUserId: "user-1",
    }),
    {
      reminderChannelId: "explicit-channel",
      pingRoleId: "farm-role",
      pingUserId: null,
    },
  );
});

test("falls back to planting user when no role exists", () => {
  assert.deepEqual(
    resolveReminderDefaults({
      explicitChannelId: null,
      explicitRoleId: null,
      farmDefaultChannelId: null,
      farmDefaultRoleId: null,
      userDefaultChannelId: null,
      userDefaultRoleId: null,
      commandChannelId: "command-channel",
      ownerDiscordUserId: "user-1",
    }),
    {
      reminderChannelId: "command-channel",
      pingRoleId: null,
      pingUserId: "user-1",
    },
  );
});
```

- [ ] **Step 3: Run farm tests and verify failure**

Run:

```bash
pnpm -F @acme/discord-bot test -- src/lib/farms.test.ts
```

Expected: fail because `./farms` does not exist.

- [ ] **Step 4: Implement farm service primitives**

Create `apps/discord-bot/src/lib/farms.ts` with this content:

```ts
import { and, eq } from "@acme/db";
import type { db as appDb } from "@acme/db/client";
import {
  discordFarmCropOverrides,
  discordFarms,
  discordFarmUsers,
} from "@acme/db/schema";

export interface ReminderDefaultInput {
  explicitChannelId: string | null;
  explicitRoleId: string | null;
  farmDefaultChannelId: string | null;
  farmDefaultRoleId: string | null;
  userDefaultChannelId: string | null;
  userDefaultRoleId: string | null;
  commandChannelId: string;
  ownerDiscordUserId: string;
}

export function normalizeFarmSlug(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .replaceAll(/-{2,}/g, "-");
}

export function resolveReminderDefaults(input: ReminderDefaultInput) {
  const reminderChannelId =
    input.explicitChannelId ??
    input.farmDefaultChannelId ??
    input.userDefaultChannelId ??
    input.commandChannelId;

  const pingRoleId =
    input.explicitRoleId ??
    input.farmDefaultRoleId ??
    input.userDefaultRoleId ??
    null;

  return {
    reminderChannelId,
    pingRoleId,
    pingUserId: pingRoleId == null ? input.ownerDiscordUserId : null,
  };
}

export async function ensureDiscordFarmUser(input: {
  database: typeof appDb;
  guildId: string;
  discordUserId: string;
  userId: string | null;
}) {
  const [row] = await input.database
    .insert(discordFarmUsers)
    .values({
      guildId: input.guildId,
      discordUserId: input.discordUserId,
      userId: input.userId,
    })
    .onConflictDoUpdate({
      target: [discordFarmUsers.guildId, discordFarmUsers.discordUserId],
      set: { userId: input.userId },
    })
    .returning();

  if (!row) throw new Error("Failed to ensure Discord farm user.");
  return row;
}

export async function findOwnedFarm(input: {
  database: typeof appDb;
  guildId: string;
  ownerDiscordUserId: string;
  slug: string;
}) {
  return input.database.query.discordFarms.findFirst({
    where: and(
      eq(discordFarms.guildId, input.guildId),
      eq(discordFarms.ownerDiscordUserId, input.ownerDiscordUserId),
      eq(discordFarms.slug, normalizeFarmSlug(input.slug)),
    ),
  });
}

export async function upsertFarmCropOverride(input: {
  database: typeof appDb;
  farmId: string;
  itemId: number;
  durationSeconds: number;
}) {
  await input.database
    .insert(discordFarmCropOverrides)
    .values({
      farmId: input.farmId,
      itemId: input.itemId,
      durationSeconds: input.durationSeconds,
    })
    .onConflictDoUpdate({
      target: [
        discordFarmCropOverrides.farmId,
        discordFarmCropOverrides.itemId,
      ],
      set: {
        durationSeconds: input.durationSeconds,
      },
    });
}
```

- [ ] **Step 5: Run farm tests**

Run:

```bash
pnpm -F @acme/discord-bot test -- src/lib/farms.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit farm primitives**

Run:

```bash
git add apps/discord-bot/src/lib/identity.ts apps/discord-bot/src/lib/farms.ts apps/discord-bot/src/lib/farms.test.ts
git commit -m "feat: add farm bot settings primitives"
```

## Task 6: Implement Timer Creation, Listing, Canceling, and Replant Rules

**Files:**
- Create: `apps/discord-bot/src/lib/timers.test.ts`
- Create: `apps/discord-bot/src/lib/timers.ts`

- [ ] **Step 1: Write failing timer logic tests**

Create `apps/discord-bot/src/lib/timers.test.ts` with this content:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTimerNotifications,
  chooseDuration,
  chooseReplantDurationMode,
  shortTimerId,
} from "./timers";

test("duration priority uses explicit, override, then game timer", () => {
  assert.deepEqual(
    chooseDuration({
      explicitDurationSeconds: 50,
      farmCropOverrideSeconds: 60,
      gameTimerSeconds: 70,
    }),
    { durationSeconds: 50, source: "explicit", explicitDurationSeconds: 50 },
  );

  assert.deepEqual(
    chooseDuration({
      explicitDurationSeconds: null,
      farmCropOverrideSeconds: 60,
      gameTimerSeconds: 70,
    }),
    {
      durationSeconds: 60,
      source: "farm_crop_override",
      explicitDurationSeconds: null,
    },
  );

  assert.deepEqual(
    chooseDuration({
      explicitDurationSeconds: null,
      farmCropOverrideSeconds: null,
      gameTimerSeconds: 70,
    }),
    { durationSeconds: 70, source: "game_timer", explicitDurationSeconds: null },
  );
});

test("duration selection returns null when no source exists", () => {
  assert.equal(
    chooseDuration({
      explicitDurationSeconds: null,
      farmCropOverrideSeconds: null,
      gameTimerSeconds: null,
    }),
    null,
  );
});

test("advance reminder is skipped when disabled or too close", () => {
  const plantedAt = new Date("2026-07-05T10:00:00.000Z");

  assert.deepEqual(
    buildTimerNotifications({
      timerId: "timer-1",
      plantedAt,
      durationSeconds: 60 * 60,
      reminderMinutes: 15,
    }),
    [
      {
        kind: "advance",
        notifyAt: new Date("2026-07-05T10:45:00.000Z"),
      },
      {
        kind: "ready",
        notifyAt: new Date("2026-07-05T11:00:00.000Z"),
      },
    ],
  );

  assert.deepEqual(
    buildTimerNotifications({
      timerId: "timer-1",
      plantedAt,
      durationSeconds: 10 * 60,
      reminderMinutes: 15,
    }),
    [
      {
        kind: "ready",
        notifyAt: new Date("2026-07-05T10:10:00.000Z"),
      },
    ],
  );

  assert.deepEqual(
    buildTimerNotifications({
      timerId: "timer-1",
      plantedAt,
      durationSeconds: 60 * 60,
      reminderMinutes: 0,
    }),
    [
      {
        kind: "ready",
        notifyAt: new Date("2026-07-05T11:00:00.000Z"),
      },
    ],
  );
});

test("replant mode freezes explicit durations and recomputes inferred durations", () => {
  assert.equal(chooseReplantDurationMode("explicit"), "reuse_explicit");
  assert.equal(chooseReplantDurationMode("farm_crop_override"), "recompute");
  assert.equal(chooseReplantDurationMode("game_timer"), "recompute");
});

test("short timer id uses first eight uuid characters", () => {
  assert.equal(
    shortTimerId("12345678-90ab-cdef-1234-567890abcdef"),
    "12345678",
  );
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm -F @acme/discord-bot test -- src/lib/timers.test.ts
```

Expected: fail because `./timers` does not exist.

- [ ] **Step 3: Implement timer logic and persistence helpers**

Create `apps/discord-bot/src/lib/timers.ts` with this content:

```ts
import { and, asc, eq, ilike, or } from "@acme/db";
import type { db as appDb } from "@acme/db/client";
import {
  discordFarmCropOverrides,
  discordFarmNotifications,
  discordFarmTimers,
  discordFarms,
  farmTimerDurationSourceEnum,
  items,
} from "@acme/db/schema";

export type DurationSource =
  (typeof farmTimerDurationSourceEnum.enumValues)[number];

export interface DurationChoiceInput {
  explicitDurationSeconds: number | null;
  farmCropOverrideSeconds: number | null;
  gameTimerSeconds: number | null;
}

export interface TimerNotificationPlan {
  kind: "advance" | "ready";
  notifyAt: Date;
}

export function chooseDuration(input: DurationChoiceInput) {
  if (input.explicitDurationSeconds != null) {
    return {
      durationSeconds: input.explicitDurationSeconds,
      source: "explicit" as const,
      explicitDurationSeconds: input.explicitDurationSeconds,
    };
  }

  if (input.farmCropOverrideSeconds != null) {
    return {
      durationSeconds: input.farmCropOverrideSeconds,
      source: "farm_crop_override" as const,
      explicitDurationSeconds: null,
    };
  }

  if (input.gameTimerSeconds != null) {
    return {
      durationSeconds: input.gameTimerSeconds,
      source: "game_timer" as const,
      explicitDurationSeconds: null,
    };
  }

  return null;
}

export function buildTimerNotifications(input: {
  timerId: string;
  plantedAt: Date;
  durationSeconds: number;
  reminderMinutes: number;
}): TimerNotificationPlan[] {
  const readyAt = new Date(input.plantedAt.getTime() + input.durationSeconds * 1000);
  const notifications: TimerNotificationPlan[] = [];
  const advanceSeconds = input.reminderMinutes * 60;

  if (advanceSeconds > 0 && input.durationSeconds > advanceSeconds) {
    notifications.push({
      kind: "advance",
      notifyAt: new Date(readyAt.getTime() - advanceSeconds * 1000),
    });
  }

  notifications.push({ kind: "ready", notifyAt: readyAt });
  return notifications;
}

export function chooseReplantDurationMode(source: DurationSource) {
  return source === "explicit" ? "reuse_explicit" : "recompute";
}

export function shortTimerId(id: string) {
  return id.slice(0, 8);
}

export async function findFarmCropOverride(input: {
  database: typeof appDb;
  farmId: string | null;
  itemId: number;
}) {
  if (input.farmId == null) return null;

  const row = await input.database.query.discordFarmCropOverrides.findFirst({
    columns: { durationSeconds: true },
    where: and(
      eq(discordFarmCropOverrides.farmId, input.farmId),
      eq(discordFarmCropOverrides.itemId, input.itemId),
    ),
  });

  return row?.durationSeconds ?? null;
}

export async function createFarmTimer(input: {
  database: typeof appDb;
  guildId: string;
  ownerDiscordUserId: string;
  userId: string | null;
  farmId: string | null;
  cropItemId: number;
  cropName: string;
  durationSeconds: number;
  durationSource: DurationSource;
  explicitDurationSeconds: number | null;
  note: string | null;
  commandChannelId: string;
  reminderChannelId: string;
  pingRoleId: string | null;
  plantedAt: Date;
  reminderMinutes: number;
}) {
  const readyAt = new Date(input.plantedAt.getTime() + input.durationSeconds * 1000);

  const [timer] = await input.database
    .insert(discordFarmTimers)
    .values({
      guildId: input.guildId,
      ownerDiscordUserId: input.ownerDiscordUserId,
      userId: input.userId,
      farmId: input.farmId,
      cropItemId: input.cropItemId,
      cropName: input.cropName,
      durationSeconds: input.durationSeconds,
      durationSource: input.durationSource,
      explicitDurationSeconds: input.explicitDurationSeconds,
      note: input.note,
      commandChannelId: input.commandChannelId,
      reminderChannelId: input.reminderChannelId,
      pingRoleId: input.pingRoleId,
      plantedAt: input.plantedAt,
      readyAt,
    })
    .returning();

  if (!timer) throw new Error("Failed to create farm timer.");

  const notifications = buildTimerNotifications({
    timerId: timer.id,
    plantedAt: input.plantedAt,
    durationSeconds: input.durationSeconds,
    reminderMinutes: input.reminderMinutes,
  });

  await input.database.insert(discordFarmNotifications).values(
    notifications.map((notification) => ({
      timerId: timer.id,
      kind: notification.kind,
      notifyAt: notification.notifyAt,
    })),
  );

  return timer;
}

export async function listActiveTimers(input: {
  database: typeof appDb;
  guildId: string;
  ownerDiscordUserId: string;
}) {
  return input.database
    .select({
      id: discordFarmTimers.id,
      cropName: discordFarmTimers.cropName,
      note: discordFarmTimers.note,
      readyAt: discordFarmTimers.readyAt,
      farmSlug: discordFarms.slug,
    })
    .from(discordFarmTimers)
    .leftJoin(discordFarms, eq(discordFarms.id, discordFarmTimers.farmId))
    .where(
      and(
        eq(discordFarmTimers.guildId, input.guildId),
        eq(discordFarmTimers.ownerDiscordUserId, input.ownerDiscordUserId),
        eq(discordFarmTimers.status, "pending"),
      ),
    )
    .orderBy(asc(discordFarmTimers.readyAt));
}

export async function cancelTimerByShortId(input: {
  database: typeof appDb;
  guildId: string;
  ownerDiscordUserId: string;
  shortId: string;
  canceledAt: Date;
}) {
  const [timer] = await input.database
    .update(discordFarmTimers)
    .set({ status: "canceled", canceledAt: input.canceledAt })
    .where(
      and(
        eq(discordFarmTimers.guildId, input.guildId),
        eq(discordFarmTimers.ownerDiscordUserId, input.ownerDiscordUserId),
        eq(discordFarmTimers.status, "pending"),
        ilike(discordFarmTimers.id, `${input.shortId}%`),
      ),
    )
    .returning({ id: discordFarmTimers.id });

  if (!timer) return null;

  await input.database
    .update(discordFarmNotifications)
    .set({ status: "skipped" })
    .where(eq(discordFarmNotifications.timerId, timer.id));

  return timer;
}

export async function findSeedItemsWithTimers(database: typeof appDb) {
  return database
    .select({
      id: items.id,
      name: items.name,
      description: items.description,
    })
    .from(items)
    .where(
      and(
        eq(items.category, "Seed"),
        or(
          ilike(items.description, "%Matures in approx.%"),
          ilike(items.name, "%Seed%"),
          ilike(items.name, "%Greenhouse%"),
        ),
      ),
    )
    .orderBy(asc(items.name));
}
```

- [ ] **Step 4: Run timer tests**

Run:

```bash
pnpm -F @acme/discord-bot test -- src/lib/timers.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit timer primitives**

Run:

```bash
git add apps/discord-bot/src/lib/timers.ts apps/discord-bot/src/lib/timers.test.ts
git commit -m "feat: add farm timer primitives"
```

## Task 7: Implement Reminder Messages and Scheduler

**Files:**
- Create: `apps/discord-bot/src/lib/messages.ts`
- Create: `apps/discord-bot/src/lib/scheduler.test.ts`
- Create: `apps/discord-bot/src/lib/scheduler.ts`
- Modify: `apps/discord-bot/src/index.ts`

- [ ] **Step 1: Create message builders**

Create `apps/discord-bot/src/lib/messages.ts` with this content:

```ts
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type APIEmbed,
  type MessageCreateOptions,
} from "discord.js";

import { formatDuration } from "./duration";
import { shortTimerId } from "./timers";

export interface ReminderMessageInput {
  timerId: string;
  kind: "advance" | "ready";
  cropName: string;
  note: string | null;
  farmSlug: string | null;
  plantedByDiscordUserId: string;
  pingRoleId: string | null;
  readyAt: Date;
  durationSeconds: number;
  lateBySeconds: number;
}

export function buildReminderMessage(
  input: ReminderMessageInput,
): MessageCreateOptions {
  const target =
    input.kind === "advance"
      ? `<@${input.plantedByDiscordUserId}>`
      : input.pingRoleId != null
        ? `<@&${input.pingRoleId}>`
        : `<@${input.plantedByDiscordUserId}>`;

  const title =
    input.kind === "advance"
      ? `${input.cropName} is almost ready`
      : `${input.cropName} is ready`;

  const description =
    input.kind === "advance"
      ? `${target} ${input.cropName} will be ready soon.`
      : `${target} ${input.cropName} is ready to harvest.`;

  const fields: APIEmbed["fields"] = [
    { name: "Timer", value: shortTimerId(input.timerId), inline: true },
    { name: "Duration", value: formatDuration(input.durationSeconds), inline: true },
    {
      name: "Ready",
      value: `<t:${Math.floor(input.readyAt.getTime() / 1000)}:R>`,
      inline: true,
    },
  ];

  if (input.farmSlug != null) {
    fields.push({ name: "Farm", value: input.farmSlug, inline: true });
  }

  if (input.note != null && input.note.trim().length > 0) {
    fields.push({ name: "Note", value: input.note.trim(), inline: false });
  }

  if (input.lateBySeconds >= 60) {
    fields.push({
      name: "Delivery",
      value: `Late by ${formatDuration(input.lateBySeconds)}`,
      inline: true,
    });
  }

  const message: MessageCreateOptions = {
    content: target,
    embeds: [{ title, description, color: input.kind === "advance" ? 0xf59e0b : 0x22c55e, fields }],
  };

  if (input.kind === "ready") {
    message.components = [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`farm-replant:${input.timerId}`)
          .setLabel("Replant")
          .setStyle(ButtonStyle.Primary),
      ),
    ];
  }

  return message;
}
```

- [ ] **Step 2: Write failing scheduler tests**

Create `apps/discord-bot/src/lib/scheduler.test.ts` with this content:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { shouldRetryNotification } from "./scheduler";

test("retries failed notifications up to five attempts", () => {
  assert.equal(shouldRetryNotification({ attemptCount: 0 }), true);
  assert.equal(shouldRetryNotification({ attemptCount: 4 }), true);
  assert.equal(shouldRetryNotification({ attemptCount: 5 }), false);
});
```

- [ ] **Step 3: Run scheduler tests and verify failure**

Run:

```bash
pnpm -F @acme/discord-bot test -- src/lib/scheduler.test.ts
```

Expected: fail because `./scheduler` does not exist.

- [ ] **Step 4: Implement scheduler**

Create `apps/discord-bot/src/lib/scheduler.ts` with this content:

```ts
import { and, eq, lte, sql } from "@acme/db";
import type { db as appDb } from "@acme/db/client";
import {
  discordFarmNotifications,
  discordFarmTimers,
  discordFarms,
} from "@acme/db/schema";
import type { SapphireClient } from "@sapphire/framework";
import type { TextBasedChannel } from "discord.js";

import { buildReminderMessage } from "./messages";

const MAX_DELIVERY_ATTEMPTS = 5;

export function shouldRetryNotification(input: { attemptCount: number }) {
  return input.attemptCount < MAX_DELIVERY_ATTEMPTS;
}

export async function pollDueFarmNotifications(input: {
  database: typeof appDb;
  client: SapphireClient;
  now?: Date;
}) {
  const now = input.now ?? new Date();

  const dueRows = await input.database
    .select({
      notificationId: discordFarmNotifications.id,
      notificationKind: discordFarmNotifications.kind,
      notificationAttemptCount: discordFarmNotifications.attemptCount,
      timerId: discordFarmTimers.id,
      guildId: discordFarmTimers.guildId,
      ownerDiscordUserId: discordFarmTimers.ownerDiscordUserId,
      cropName: discordFarmTimers.cropName,
      note: discordFarmTimers.note,
      reminderChannelId: discordFarmTimers.reminderChannelId,
      pingRoleId: discordFarmTimers.pingRoleId,
      readyAt: discordFarmTimers.readyAt,
      durationSeconds: discordFarmTimers.durationSeconds,
      farmSlug: discordFarms.slug,
    })
    .from(discordFarmNotifications)
    .innerJoin(
      discordFarmTimers,
      eq(discordFarmTimers.id, discordFarmNotifications.timerId),
    )
    .leftJoin(discordFarms, eq(discordFarms.id, discordFarmTimers.farmId))
    .where(
      and(
        eq(discordFarmNotifications.status, "pending"),
        eq(discordFarmTimers.status, "pending"),
        lte(discordFarmNotifications.notifyAt, now),
      ),
    )
    .limit(25);

  for (const row of dueRows) {
    if (!shouldRetryNotification({ attemptCount: row.notificationAttemptCount })) {
      await markNotificationFailed(input.database, row.notificationId, now, "Max delivery attempts reached.");
      continue;
    }

    try {
      const channel = await input.client.channels.fetch(row.reminderChannelId);
      if (!channel?.isTextBased()) {
        throw new Error(`Channel ${row.reminderChannelId} is not text based or is unavailable.`);
      }

      const lateBySeconds = Math.max(
        0,
        Math.floor((now.getTime() - row.readyAt.getTime()) / 1000),
      );

      const message = await (channel as TextBasedChannel).send(
        buildReminderMessage({
          timerId: row.timerId,
          kind: row.notificationKind,
          cropName: row.cropName,
          note: row.note,
          farmSlug: row.farmSlug,
          plantedByDiscordUserId: row.ownerDiscordUserId,
          pingRoleId: row.pingRoleId,
          readyAt: row.readyAt,
          durationSeconds: row.durationSeconds,
          lateBySeconds,
        }),
      );

      await input.database
        .update(discordFarmNotifications)
        .set({
          status: "delivered",
          deliveredAt: now,
          lastAttemptAt: now,
          discordMessageId: message.id,
          attemptCount: sql`${discordFarmNotifications.attemptCount} + 1`,
          lastError: null,
        })
        .where(eq(discordFarmNotifications.id, row.notificationId));

      if (row.notificationKind === "ready") {
        await input.database
          .update(discordFarmTimers)
          .set({
            status: "delivered",
            deliveredAt: now,
            deliveryAttemptCount: sql`${discordFarmTimers.deliveryAttemptCount} + 1`,
            lastDeliveryAttemptAt: now,
            lastDeliveryError: null,
          })
          .where(eq(discordFarmTimers.id, row.timerId));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordNotificationAttemptFailure(input.database, {
        notificationId: row.notificationId,
        timerId: row.timerId,
        attemptedAt: now,
        error: message,
        isReadyNotification: row.notificationKind === "ready",
        nextAttemptCount: row.notificationAttemptCount + 1,
      });
    }
  }
}

async function markNotificationFailed(
  database: typeof appDb,
  notificationId: string,
  failedAt: Date,
  error: string,
) {
  await database
    .update(discordFarmNotifications)
    .set({
      status: "failed",
      lastAttemptAt: failedAt,
      lastError: error,
    })
    .where(eq(discordFarmNotifications.id, notificationId));
}

async function recordNotificationAttemptFailure(
  database: typeof appDb,
  input: {
    notificationId: string;
    timerId: string;
    attemptedAt: Date;
    error: string;
    isReadyNotification: boolean;
    nextAttemptCount: number;
  },
) {
  const exhausted = input.nextAttemptCount >= MAX_DELIVERY_ATTEMPTS;

  await database
    .update(discordFarmNotifications)
    .set({
      status: exhausted ? "failed" : "pending",
      attemptCount: sql`${discordFarmNotifications.attemptCount} + 1`,
      lastAttemptAt: input.attemptedAt,
      lastError: input.error,
    })
    .where(eq(discordFarmNotifications.id, input.notificationId));

  if (input.isReadyNotification) {
    await database
      .update(discordFarmTimers)
      .set({
        status: exhausted ? "delivery_failed" : "pending",
        deliveryAttemptCount: sql`${discordFarmTimers.deliveryAttemptCount} + 1`,
        lastDeliveryAttemptAt: input.attemptedAt,
        lastDeliveryError: input.error,
      })
      .where(eq(discordFarmTimers.id, input.timerId));
  }
}

export function startFarmNotificationScheduler(input: {
  database: typeof appDb;
  client: SapphireClient;
  intervalMs?: number;
}) {
  const intervalMs = input.intervalMs ?? 60_000;

  const run = () => {
    void pollDueFarmNotifications(input).catch((error) => {
      input.client.logger.error(error);
    });
  };

  run();
  return setInterval(run, intervalMs);
}
```

- [ ] **Step 5: Wire scheduler into entrypoint**

Modify `apps/discord-bot/src/index.ts` to this content:

```ts
import { db } from "@acme/db/client";
import { LogLevel, SapphireClient } from "@sapphire/framework";
import { GatewayIntentBits } from "discord.js";

import { botEnv } from "./env";
import { startFarmNotificationScheduler } from "./lib/scheduler";

const env = botEnv();

const client = new SapphireClient({
  defaultPrefix: "!",
  intents: [GatewayIntentBits.Guilds],
  logger: {
    level: process.env.NODE_ENV === "production" ? LogLevel.Info : LogLevel.Debug,
  },
});

client.once("ready", () => {
  client.logger.info(`Discord farm bot logged in as ${client.user?.tag}`);
  startFarmNotificationScheduler({ database: db, client });
});

await client.login(env.AAC_DISCORD_BOT_TOKEN);
```

- [ ] **Step 6: Run scheduler tests**

Run:

```bash
pnpm -F @acme/discord-bot test -- src/lib/scheduler.test.ts
pnpm -F @acme/discord-bot typecheck
```

Expected: both pass.

- [ ] **Step 7: Commit scheduler**

Run:

```bash
git add apps/discord-bot/src/lib/messages.ts apps/discord-bot/src/lib/scheduler.ts apps/discord-bot/src/lib/scheduler.test.ts apps/discord-bot/src/index.ts
git commit -m "feat: deliver farm timer reminders"
```

## Task 8: Implement `/plant`, `/timers`, and `/timer cancel`

**Files:**
- Create: `apps/discord-bot/src/commands/plant.ts`
- Create: `apps/discord-bot/src/commands/timers.ts`
- Create: `apps/discord-bot/src/commands/timer.ts`

- [ ] **Step 1: Create `/plant` command**

Create `apps/discord-bot/src/commands/plant.ts` with this content:

```ts
import { db } from "@acme/db/client";
import { Command } from "@sapphire/framework";
import {
  ApplicationCommandOptionType,
  ChannelType,
  type ChatInputCommandInteraction,
} from "discord.js";

import { buildCropAliases, resolveCropAlias } from "../lib/crop-timers";
import { parseDurationSeconds } from "../lib/duration";
import { resolveReminderDefaults } from "../lib/farms";
import { findDashboardUserIdForDiscordUser } from "../lib/identity";
import {
  createFarmTimer,
  findFarmCropOverride,
  findSeedItemsWithTimers,
} from "../lib/timers";

export class PlantCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName("plant")
        .setDescription("Create an ArcheAge farm crop timer.")
        .addStringOption((option) =>
          option
            .setName("crop")
            .setDescription("Crop, bundle, or greenhouse to plant.")
            .setAutocomplete(true)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("duration")
            .setDescription("Override duration, such as 45m, 1h 30m, or 2d 4h."),
        )
        .addRoleOption((option) =>
          option.setName("role").setDescription("Role to ping when ready."),
        )
        .addStringOption((option) =>
          option
            .setName("farm")
            .setDescription("Your farm slug.")
            .setAutocomplete(true),
        )
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Channel for reminders.")
            .addChannelTypes(ChannelType.GuildText),
        )
        .addStringOption((option) =>
          option.setName("note").setDescription("Optional note for this timer."),
        ),
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      return interaction.reply({
        content: "Farm timers can only be used inside a Discord server.",
        ephemeral: true,
      });
    }

    const cropInput = interaction.options.getString("crop", true);
    const durationInput = interaction.options.getString("duration");
    const role = interaction.options.getRole("role");
    const farmSlug = interaction.options.getString("farm");
    const channel = interaction.options.getChannel("channel");
    const note = interaction.options.getString("note");

    const seedItems = await findSeedItemsWithTimers(db);
    const aliases = buildCropAliases(seedItems);
    const crop = resolveCropAlias(aliases, cropInput);

    if (crop == null) {
      return interaction.reply({
        content: `I do not have an in-game timer for "${cropInput}". Add a duration override like \`duration:45m\`.`,
        ephemeral: true,
      });
    }

    if (crop.kind === "ambiguous") {
      const suggestions = crop.matches
        .slice(0, 5)
        .map((match) => match.item.name)
        .join(", ");

      return interaction.reply({
        content: `That crop is ambiguous. Try one of: ${suggestions}.`,
        ephemeral: true,
      });
    }

    const explicitDurationSeconds =
      durationInput != null ? parseDurationSeconds(durationInput) : null;

    if (durationInput != null && explicitDurationSeconds == null) {
      return interaction.reply({
        content: "Duration must look like `45m`, `1h 30m`, `2d 4h`, or `3600s`, with a maximum of 14 days.",
        ephemeral: true,
      });
    }

    const userId = await findDashboardUserIdForDiscordUser(db, interaction.user.id);
    const farm = farmSlug
      ? await db.query.discordFarms.findFirst({
          where: (fields, { and, eq }) =>
            and(
              eq(fields.guildId, interaction.guildId!),
              eq(fields.ownerDiscordUserId, interaction.user.id),
              eq(fields.slug, farmSlug),
            ),
        })
      : null;

    if (farmSlug != null && farm == null) {
      return interaction.reply({
        content: `You do not have a farm named \`${farmSlug}\`. Create it with \`/farm add\`.`,
        ephemeral: true,
      });
    }

    const farmCropOverrideSeconds = await findFarmCropOverride({
      database: db,
      farmId: farm?.id ?? null,
      itemId: crop.item.id,
    });

    const duration =
      explicitDurationSeconds != null
        ? {
            durationSeconds: explicitDurationSeconds,
            source: "explicit" as const,
            explicitDurationSeconds,
          }
        : farmCropOverrideSeconds != null
          ? {
              durationSeconds: farmCropOverrideSeconds,
              source: "farm_crop_override" as const,
              explicitDurationSeconds: null,
            }
          : {
              durationSeconds: crop.growthSeconds,
              source: "game_timer" as const,
              explicitDurationSeconds: null,
            };

    const farmUser = await db.query.discordFarmUsers.findFirst({
      where: (fields, { and, eq }) =>
        and(
          eq(fields.guildId, interaction.guildId!),
          eq(fields.discordUserId, interaction.user.id),
        ),
    });

    const defaults = resolveReminderDefaults({
      explicitChannelId: channel?.id ?? null,
      explicitRoleId: role?.id ?? null,
      farmDefaultChannelId: farm?.defaultChannelId ?? null,
      farmDefaultRoleId: farm?.defaultRoleId ?? null,
      userDefaultChannelId: farmUser?.defaultChannelId ?? null,
      userDefaultRoleId: farmUser?.defaultRoleId ?? null,
      commandChannelId: interaction.channelId,
      ownerDiscordUserId: interaction.user.id,
    });

    const timer = await createFarmTimer({
      database: db,
      guildId: interaction.guildId,
      ownerDiscordUserId: interaction.user.id,
      userId,
      farmId: farm?.id ?? null,
      cropItemId: crop.item.id,
      cropName: crop.item.name,
      durationSeconds: duration.durationSeconds,
      durationSource: duration.source,
      explicitDurationSeconds: duration.explicitDurationSeconds,
      note,
      commandChannelId: interaction.channelId,
      reminderChannelId: defaults.reminderChannelId,
      pingRoleId: defaults.pingRoleId,
      plantedAt: new Date(),
      reminderMinutes: farmUser?.reminderMinutes ?? 15,
    });

    return interaction.reply({
      content: `Created timer \`${timer.id.slice(0, 8)}\` for ${crop.item.name}. It will be ready <t:${Math.floor(timer.readyAt.getTime() / 1000)}:R>.`,
      ephemeral: true,
    });
  }
}
```

- [ ] **Step 2: Create `/timers` command**

Create `apps/discord-bot/src/commands/timers.ts` with this content:

```ts
import { db } from "@acme/db/client";
import { Command } from "@sapphire/framework";
import type { ChatInputCommandInteraction } from "discord.js";

import { listActiveTimers, shortTimerId } from "../lib/timers";

export class TimersCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName("timers")
        .setDescription("List your active farm timers."),
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      return interaction.reply({
        content: "Farm timers can only be used inside a Discord server.",
        ephemeral: true,
      });
    }

    const timers = await listActiveTimers({
      database: db,
      guildId: interaction.guildId,
      ownerDiscordUserId: interaction.user.id,
    });

    if (timers.length === 0) {
      return interaction.reply({
        content: "You do not have any active farm timers.",
        ephemeral: true,
      });
    }

    return interaction.reply({
      content: timers
        .map((timer) => {
          const farm = timer.farmSlug != null ? ` on \`${timer.farmSlug}\`` : "";
          const note = timer.note != null ? ` — ${timer.note}` : "";
          return `\`${shortTimerId(timer.id)}\` ${timer.cropName}${farm}: <t:${Math.floor(timer.readyAt.getTime() / 1000)}:R>${note}`;
        })
        .join("\n"),
      ephemeral: true,
    });
  }
}
```

- [ ] **Step 3: Create `/timer cancel` command**

Create `apps/discord-bot/src/commands/timer.ts` with this content:

```ts
import { db } from "@acme/db/client";
import { Command } from "@sapphire/framework";
import type { ChatInputCommandInteraction } from "discord.js";

import { cancelTimerByShortId } from "../lib/timers";

export class TimerCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName("timer")
        .setDescription("Manage one of your farm timers.")
        .addSubcommand((subcommand) =>
          subcommand
            .setName("cancel")
            .setDescription("Cancel an active farm timer.")
            .addStringOption((option) =>
              option
                .setName("id")
                .setDescription("Short timer id from /timers.")
                .setRequired(true),
            ),
        ),
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      return interaction.reply({
        content: "Farm timers can only be used inside a Discord server.",
        ephemeral: true,
      });
    }

    const subcommand = interaction.options.getSubcommand();
    if (subcommand !== "cancel") {
      return interaction.reply({
        content: "Unknown timer command.",
        ephemeral: true,
      });
    }

    const shortId = interaction.options.getString("id", true);
    const canceled = await cancelTimerByShortId({
      database: db,
      guildId: interaction.guildId,
      ownerDiscordUserId: interaction.user.id,
      shortId,
      canceledAt: new Date(),
    });

    return interaction.reply({
      content:
        canceled == null
          ? `No active timer found for \`${shortId}\`.`
          : `Canceled timer \`${shortId}\`.`,
      ephemeral: true,
    });
  }
}
```

- [ ] **Step 4: Run command typecheck**

Run:

```bash
pnpm -F @acme/discord-bot typecheck
```

Expected: pass with Sapphire discovering commands from `src/commands`.

- [ ] **Step 5: Commit timer commands**

Run:

```bash
git add apps/discord-bot/src/commands/plant.ts apps/discord-bot/src/commands/timers.ts apps/discord-bot/src/commands/timer.ts
git commit -m "feat: add farm timer slash commands"
```

## Task 9: Implement Farm and Settings Commands

**Files:**
- Create: `apps/discord-bot/src/commands/farm.ts`
- Create: `apps/discord-bot/src/commands/settings.ts`

- [ ] **Step 1: Create `/farm` command**

Create `apps/discord-bot/src/commands/farm.ts` with this content:

```ts
import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { discordFarms } from "@acme/db/schema";
import { Command } from "@sapphire/framework";
import { ChannelType, type ChatInputCommandInteraction } from "discord.js";

import { buildCropAliases, resolveCropAlias } from "../lib/crop-timers";
import { parseDurationSeconds } from "../lib/duration";
import {
  ensureDiscordFarmUser,
  findOwnedFarm,
  normalizeFarmSlug,
  upsertFarmCropOverride,
} from "../lib/farms";
import { findDashboardUserIdForDiscordUser } from "../lib/identity";
import { findSeedItemsWithTimers } from "../lib/timers";

export class FarmCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName("farm")
        .setDescription("Manage your farm defaults.")
        .addSubcommand((subcommand) =>
          subcommand
            .setName("add")
            .setDescription("Add one of your farms.")
            .addStringOption((option) =>
              option.setName("slug").setDescription("Short farm slug.").setRequired(true),
            )
            .addStringOption((option) =>
              option.setName("name").setDescription("Display name."),
            )
            .addStringOption((option) =>
              option.setName("description").setDescription("Farm notes or location."),
            )
            .addRoleOption((option) =>
              option.setName("default-role").setDescription("Default ready ping role."),
            )
            .addChannelOption((option) =>
              option
                .setName("default-channel")
                .setDescription("Default reminder channel.")
                .addChannelTypes(ChannelType.GuildText),
            )
            .addAttachmentOption((option) =>
              option.setName("screenshot").setDescription("Farm screenshot."),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("set-defaults")
            .setDescription("Set farm default role or channel.")
            .addStringOption((option) =>
              option.setName("farm").setDescription("Farm slug.").setRequired(true),
            )
            .addRoleOption((option) =>
              option.setName("role").setDescription("Default ready ping role."),
            )
            .addChannelOption((option) =>
              option
                .setName("channel")
                .setDescription("Default reminder channel.")
                .addChannelTypes(ChannelType.GuildText),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("crop-override")
            .setDescription("Set a duration override for a crop on a farm.")
            .addStringOption((option) =>
              option.setName("farm").setDescription("Farm slug.").setRequired(true),
            )
            .addStringOption((option) =>
              option
                .setName("crop")
                .setDescription("Crop, bundle, or greenhouse.")
                .setAutocomplete(true)
                .setRequired(true),
            )
            .addStringOption((option) =>
              option
                .setName("duration")
                .setDescription("Duration such as 45m or 1h 30m.")
                .setRequired(true),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand.setName("list").setDescription("List your farms."),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("show")
            .setDescription("Show one of your farms.")
            .addStringOption((option) =>
              option.setName("farm").setDescription("Farm slug.").setRequired(true),
            ),
        ),
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      return interaction.reply({
        content: "Farm commands can only be used inside a Discord server.",
        ephemeral: true,
      });
    }

    const subcommand = interaction.options.getSubcommand();
    const userId = await findDashboardUserIdForDiscordUser(db, interaction.user.id);

    if (subcommand === "add") {
      const slug = normalizeFarmSlug(interaction.options.getString("slug", true));
      const screenshot = interaction.options.getAttachment("screenshot");

      await ensureDiscordFarmUser({
        database: db,
        guildId: interaction.guildId,
        discordUserId: interaction.user.id,
        userId,
      });

      const [farm] = await db
        .insert(discordFarms)
        .values({
          guildId: interaction.guildId,
          ownerDiscordUserId: interaction.user.id,
          userId,
          slug,
          name: interaction.options.getString("name") ?? slug,
          description: interaction.options.getString("description"),
          defaultRoleId: interaction.options.getRole("default-role")?.id ?? null,
          defaultChannelId:
            interaction.options.getChannel("default-channel")?.id ?? null,
          screenshotUrl: screenshot?.url ?? null,
          screenshotProxyUrl: screenshot?.proxyURL ?? null,
          screenshotContentType: screenshot?.contentType ?? null,
          screenshotName: screenshot?.name ?? null,
        })
        .onConflictDoUpdate({
          target: [
            discordFarms.guildId,
            discordFarms.ownerDiscordUserId,
            discordFarms.slug,
          ],
          set: {
            name: interaction.options.getString("name") ?? slug,
            description: interaction.options.getString("description"),
            defaultRoleId: interaction.options.getRole("default-role")?.id ?? null,
            defaultChannelId:
              interaction.options.getChannel("default-channel")?.id ?? null,
            screenshotUrl: screenshot?.url ?? null,
            screenshotProxyUrl: screenshot?.proxyURL ?? null,
            screenshotContentType: screenshot?.contentType ?? null,
            screenshotName: screenshot?.name ?? null,
          },
        })
        .returning();

      return interaction.reply({
        content: `Saved farm \`${farm?.slug ?? slug}\`.`,
        ephemeral: true,
      });
    }

    if (subcommand === "list") {
      const farms = await db.query.discordFarms.findMany({
        where: (fields, { and, eq }) =>
          and(
            eq(fields.guildId, interaction.guildId!),
            eq(fields.ownerDiscordUserId, interaction.user.id),
          ),
        orderBy: (fields, { asc }) => [asc(fields.slug)],
      });

      return interaction.reply({
        content:
          farms.length === 0
            ? "You have not added any farms."
            : farms
                .map((farm) => `\`${farm.slug}\` — ${farm.name}`)
                .join("\n"),
        ephemeral: true,
      });
    }

    const farmSlug = interaction.options.getString("farm");
    const farm =
      farmSlug != null
        ? await findOwnedFarm({
            database: db,
            guildId: interaction.guildId,
            ownerDiscordUserId: interaction.user.id,
            slug: farmSlug,
          })
        : null;

    if (farmSlug != null && farm == null) {
      return interaction.reply({
        content: `You do not have a farm named \`${farmSlug}\`.`,
        ephemeral: true,
      });
    }

    if (subcommand === "set-defaults" && farm != null) {
      await db
        .update(discordFarms)
        .set({
          defaultRoleId: interaction.options.getRole("role")?.id ?? farm.defaultRoleId,
          defaultChannelId:
            interaction.options.getChannel("channel")?.id ?? farm.defaultChannelId,
        })
        .where(eq(discordFarms.id, farm.id));

      return interaction.reply({
        content: `Updated defaults for \`${farm.slug}\`.`,
        ephemeral: true,
      });
    }

    if (subcommand === "crop-override" && farm != null) {
      const durationSeconds = parseDurationSeconds(
        interaction.options.getString("duration", true),
      );

      if (durationSeconds == null) {
        return interaction.reply({
          content: "Duration must look like `45m`, `1h 30m`, `2d 4h`, or `3600s`, with a maximum of 14 days.",
          ephemeral: true,
        });
      }

      const seedItems = await findSeedItemsWithTimers(db);
      const crop = resolveCropAlias(
        buildCropAliases(seedItems),
        interaction.options.getString("crop", true),
      );

      if (crop == null || crop.kind === "ambiguous") {
        return interaction.reply({
          content: "That crop did not resolve to one seed, bundle, or greenhouse.",
          ephemeral: true,
        });
      }

      await upsertFarmCropOverride({
        database: db,
        farmId: farm.id,
        itemId: crop.item.id,
        durationSeconds,
      });

      return interaction.reply({
        content: `Saved ${crop.item.name} override for \`${farm.slug}\`.`,
        ephemeral: true,
      });
    }

    if (subcommand === "show" && farm != null) {
      return interaction.reply({
        content: [
          `\`${farm.slug}\` — ${farm.name}`,
          farm.description ?? null,
          farm.defaultRoleId != null ? `Role: <@&${farm.defaultRoleId}>` : null,
          farm.defaultChannelId != null ? `Channel: <#${farm.defaultChannelId}>` : null,
          farm.screenshotUrl != null ? `Screenshot: ${farm.screenshotUrl}` : null,
        ]
          .filter((line): line is string => line != null && line.length > 0)
          .join("\n"),
        ephemeral: true,
      });
    }

    return interaction.reply({
      content: "Unknown farm command.",
      ephemeral: true,
    });
  }
}
```

- [ ] **Step 2: Create `/settings` command**

Create `apps/discord-bot/src/commands/settings.ts` with this content:

```ts
import { eq, and } from "@acme/db";
import { db } from "@acme/db/client";
import { discordFarmUsers } from "@acme/db/schema";
import { Command } from "@sapphire/framework";
import type { ChatInputCommandInteraction } from "discord.js";

import { ensureDiscordFarmUser } from "../lib/farms";
import { findDashboardUserIdForDiscordUser } from "../lib/identity";

export class SettingsCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName("settings")
        .setDescription("Manage your farm bot settings.")
        .addSubcommand((subcommand) =>
          subcommand
            .setName("reminder-minutes")
            .setDescription("Set advance reminder minutes. Use 0 to disable.")
            .addIntegerOption((option) =>
              option
                .setName("minutes")
                .setDescription("Minutes before ready time.")
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(1440),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand.setName("show").setDescription("Show your farm bot settings."),
        ),
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      return interaction.reply({
        content: "Settings can only be used inside a Discord server.",
        ephemeral: true,
      });
    }

    const userId = await findDashboardUserIdForDiscordUser(db, interaction.user.id);
    const farmUser = await ensureDiscordFarmUser({
      database: db,
      guildId: interaction.guildId,
      discordUserId: interaction.user.id,
      userId,
    });

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "reminder-minutes") {
      const reminderMinutes = interaction.options.getInteger("minutes", true);

      await db
        .update(discordFarmUsers)
        .set({ reminderMinutes, userId })
        .where(
          and(
            eq(discordFarmUsers.guildId, interaction.guildId),
            eq(discordFarmUsers.discordUserId, interaction.user.id),
          ),
        );

      return interaction.reply({
        content:
          reminderMinutes === 0
            ? "Advance reminders disabled."
            : `Advance reminders set to ${reminderMinutes} minutes.`,
        ephemeral: true,
      });
    }

    if (subcommand === "show") {
      return interaction.reply({
        content: [
          `Advance reminder: ${farmUser.reminderMinutes === 0 ? "disabled" : `${farmUser.reminderMinutes} minutes`}`,
          farmUser.defaultRoleId != null ? `Default role: <@&${farmUser.defaultRoleId}>` : "Default role: none",
          farmUser.defaultChannelId != null ? `Default channel: <#${farmUser.defaultChannelId}>` : "Default channel: current / farm / command channel",
        ].join("\n"),
        ephemeral: true,
      });
    }

    return interaction.reply({
      content: "Unknown settings command.",
      ephemeral: true,
    });
  }
}
```

- [ ] **Step 3: Run command typecheck**

Run:

```bash
pnpm -F @acme/discord-bot typecheck
```

Expected: pass after the `discordFarms` import cleanup described above.

- [ ] **Step 4: Commit farm and settings commands**

Run:

```bash
git add apps/discord-bot/src/commands/farm.ts apps/discord-bot/src/commands/settings.ts
git commit -m "feat: add farm and settings commands"
```

## Task 10: Implement Autocomplete and Replant Button

**Files:**
- Modify: `apps/discord-bot/src/commands/plant.ts`
- Modify: `apps/discord-bot/src/commands/farm.ts`
- Create: `apps/discord-bot/src/interaction-handlers/replant.ts`

- [ ] **Step 1: Add crop autocomplete helper to `/plant`**

Modify `apps/discord-bot/src/commands/plant.ts` and add this method inside `PlantCommand`:

```ts
public override async autocompleteRun(interaction: Command.AutocompleteInteraction) {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== "crop") return interaction.respond([]);

  const seedItems = await findSeedItemsWithTimers(db);
  const query = String(focused.value).toLowerCase();

  return interaction.respond(
    seedItems
      .filter((item) => item.name.toLowerCase().includes(query))
      .slice(0, 25)
      .map((item) => ({ name: item.name, value: item.name })),
  );
}
```

- [ ] **Step 2: Add farm and crop autocomplete to `/farm`**

Modify `apps/discord-bot/src/commands/farm.ts` and add this method inside `FarmCommand`:

```ts
public override async autocompleteRun(interaction: Command.AutocompleteInteraction) {
  if (!interaction.guildId) return interaction.respond([]);

  const focused = interaction.options.getFocused(true);
  const query = String(focused.value).toLowerCase();

  if (focused.name === "crop") {
    const seedItems = await findSeedItemsWithTimers(db);
    return interaction.respond(
      seedItems
        .filter((item) => item.name.toLowerCase().includes(query))
        .slice(0, 25)
        .map((item) => ({ name: item.name, value: item.name })),
    );
  }

  if (focused.name === "farm") {
    const farms = await db.query.discordFarms.findMany({
      where: (fields, { and, eq }) =>
        and(
          eq(fields.guildId, interaction.guildId!),
          eq(fields.ownerDiscordUserId, interaction.user.id),
        ),
      orderBy: (fields, { asc }) => [asc(fields.slug)],
    });

    return interaction.respond(
      farms
        .filter((farm) => farm.slug.toLowerCase().includes(query))
        .slice(0, 25)
        .map((farm) => ({ name: farm.name, value: farm.slug })),
    );
  }

  return interaction.respond([]);
}
```

- [ ] **Step 3: Create replant interaction handler**

Create `apps/discord-bot/src/interaction-handlers/replant.ts` with this content:

```ts
import { db } from "@acme/db/client";
import { InteractionHandler, InteractionHandlerTypes } from "@sapphire/framework";
import type { ButtonInteraction } from "discord.js";

import { buildCropAliases, resolveCropAlias } from "../lib/crop-timers";
import { findDashboardUserIdForDiscordUser } from "../lib/identity";
import {
  chooseReplantDurationMode,
  createFarmTimer,
  findFarmCropOverride,
  findSeedItemsWithTimers,
} from "../lib/timers";

export class ReplantInteractionHandler extends InteractionHandler {
  public constructor(ctx: InteractionHandler.LoaderContext, options: InteractionHandler.Options) {
    super(ctx, {
      ...options,
      interactionHandlerType: InteractionHandlerTypes.Button,
    });
  }

  public override parse(interaction: ButtonInteraction) {
    if (!interaction.customId.startsWith("farm-replant:")) {
      return this.none();
    }

    const timerId = interaction.customId.slice("farm-replant:".length);
    return this.some({ timerId });
  }

  public async run(
    interaction: ButtonInteraction,
    parsed: InteractionHandler.ParseResult<this>,
  ) {
    if (!interaction.guildId) {
      return interaction.reply({
        content: "Replant can only be used inside a Discord server.",
        ephemeral: true,
      });
    }

    const original = await db.query.discordFarmTimers.findFirst({
      where: (fields, { eq }) => eq(fields.id, parsed.timerId),
    });

    if (original == null) {
      return interaction.reply({
        content: "The original timer could not be found.",
        ephemeral: true,
      });
    }

    if (original.ownerDiscordUserId !== interaction.user.id) {
      return interaction.reply({
        content: "Only the planting user can replant this timer.",
        ephemeral: true,
      });
    }

    const userId = await findDashboardUserIdForDiscordUser(db, interaction.user.id);
    const farmUser = await db.query.discordFarmUsers.findFirst({
      where: (fields, { and, eq }) =>
        and(
          eq(fields.guildId, interaction.guildId!),
          eq(fields.discordUserId, interaction.user.id),
        ),
    });

    const mode = chooseReplantDurationMode(original.durationSource);
    let durationSeconds = original.explicitDurationSeconds ?? original.durationSeconds;
    let durationSource = original.durationSource;
    let explicitDurationSeconds = original.explicitDurationSeconds;

    if (mode === "recompute") {
      const overrideSeconds = await findFarmCropOverride({
        database: db,
        farmId: original.farmId,
        itemId: original.cropItemId,
      });

      if (overrideSeconds != null) {
        durationSeconds = overrideSeconds;
        durationSource = "farm_crop_override";
        explicitDurationSeconds = null;
      } else {
        const seedItems = await findSeedItemsWithTimers(db);
        const crop = resolveCropAlias(buildCropAliases(seedItems), original.cropName);
        if (crop == null || crop.kind === "ambiguous") {
          return interaction.reply({
            content: "I could not recompute this crop timer. Run `/plant` manually with a duration.",
            ephemeral: true,
          });
        }

        durationSeconds = crop.growthSeconds;
        durationSource = "game_timer";
        explicitDurationSeconds = null;
      }
    }

    const timer = await createFarmTimer({
      database: db,
      guildId: interaction.guildId,
      ownerDiscordUserId: interaction.user.id,
      userId,
      farmId: original.farmId,
      cropItemId: original.cropItemId,
      cropName: original.cropName,
      durationSeconds,
      durationSource,
      explicitDurationSeconds,
      note: original.note,
      commandChannelId: interaction.channelId ?? original.commandChannelId,
      reminderChannelId: original.reminderChannelId,
      pingRoleId: original.pingRoleId,
      plantedAt: new Date(),
      reminderMinutes: farmUser?.reminderMinutes ?? 15,
    });

    return interaction.reply({
      content: `Replanted ${timer.cropName}. New timer \`${timer.id.slice(0, 8)}\` is ready <t:${Math.floor(timer.readyAt.getTime() / 1000)}:R>.`,
      ephemeral: true,
    });
  }
}
```

- [ ] **Step 4: Run typecheck**

Run:

```bash
pnpm -F @acme/discord-bot typecheck
```

Expected: pass.

- [ ] **Step 5: Commit autocomplete and replant**

Run:

```bash
git add apps/discord-bot/src/commands/plant.ts apps/discord-bot/src/commands/farm.ts apps/discord-bot/src/interaction-handlers/replant.ts
git commit -m "feat: add farm bot autocomplete and replant"
```

## Task 11: Verify End-to-End and Prepare Railway Deployment

**Files:**
- Modify: `apps/discord-bot/package.json`
- Modify: `README.md`

- [ ] **Step 1: Add package-level command notes to README**

Append this section to `README.md`:

```md
## Discord Farm Bot

The farm bot lives in `apps/discord-bot` and runs as a single long-running worker.

Required environment variables:

- `DATABASE_URL`
- `AAC_DISCORD_BOT_TOKEN`
- `AAC_DISCORD_GUILD_ID` for development guild command registration when needed

Useful commands:

```bash
pnpm -F @acme/discord-bot dev
pnpm -F @acme/discord-bot start
pnpm -F @acme/discord-bot test
pnpm -F @acme/discord-bot typecheck
pnpm -F @acme/discord-bot lint
```
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm -F @acme/discord-bot test
```

Expected: all bot tests pass.

- [ ] **Step 3: Run package checks**

Run:

```bash
pnpm -F @acme/db typecheck
pnpm -F @acme/discord-bot typecheck
pnpm -F @acme/discord-bot lint
```

Expected: all commands pass.

- [ ] **Step 4: Run workspace checks**

Run:

```bash
pnpm typecheck
pnpm lint
```

Expected: both commands pass. Existing unrelated failures should be captured in the handoff with exact package and error output.

- [ ] **Step 5: Run local smoke test**

Run the bot against a private development server:

```bash
pnpm -F @acme/discord-bot start
```

Expected:

- Bot logs in.
- Slash commands register or are available in the configured guild.
- `/settings show` returns an ephemeral response.
- `/farm add slug:main name:Main` creates a farm.
- `/plant crop:Carrot Seed duration:2m farm:main note:test` creates a timer.
- `/timers` shows the created timer.
- Advance reminder is skipped because duration is shorter than 15 minutes.
- Final reminder posts in the expected channel.
- `Replant` creates a new timer.
- `/timer cancel id:<short-id>` cancels the new timer.

- [ ] **Step 6: Commit verification docs**

Run:

```bash
git add README.md apps/discord-bot/package.json
git commit -m "docs: document discord farm bot operations"
```

## Self-Review

Spec coverage:

- New Sapphire app: Tasks 1, 8, 9, and 10.
- Parsed in-game timers: Task 4.
- Explicit duration override: Tasks 3, 6, and 8.
- Farm+crop saved overrides: Tasks 2, 5, 6, and 9.
- Farms with slug, description, default role/channel, screenshot URL metadata: Tasks 2 and 9.
- Discord-only users with optional dashboard account linking: Tasks 2 and 5.
- Dashboard UI excluded while data remains dashboard-readable: Task 2.
- One-shot timers: Tasks 2, 6, and 7.
- Replant button: Tasks 7 and 10.
- Personal pre-reminder, default 15 minutes, configurable with `0` disabled: Tasks 2, 6, 7, and 9.
- Role/channel fallback chain: Tasks 5 and 8.
- Personal ownership only: Tasks 5, 8, 9, and 10.
- DB-backed polling and late delivery: Task 7.
- Retry up to 5 delivery attempts: Task 7.
- Railway single worker: Task 11.

Completeness scan:

- No unresolved sections are intentionally left in this plan.
- Each task identifies exact files and verification commands.

Type consistency:

- Duration source values match `farmTimerDurationSourceEnum`.
- Notification kind values match `farmNotificationKindEnum`.
- Timer status values match `farmTimerStatusEnum`.
- User ownership keys consistently use `guildId` and `ownerDiscordUserId`.
