import type { db as appDb } from "@acme/db/client";
import type { farmTimerDurationSourceEnum } from "@acme/db/schema";
import { and, asc, eq, ilike, or, sql } from "@acme/db";
import {
  discordFarmCropOverrides,
  discordFarmNotifications,
  discordFarms,
  discordFarmTimers,
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
  const readyAt = new Date(
    input.plantedAt.getTime() + input.durationSeconds * 1000,
  );
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

export function isLikelyPlantableTimerItem(input: {
  name: string;
  description: string | null;
}) {
  if (input.description == null) return false;
  if (/\bLarder$/i.test(input.name)) {
    return /\b(?:Aging (?:Time|Period)\b|Used for aging\b|designed to properly age\b|installed\b)/i.test(
      input.description,
    );
  }
  if (
    !/Seed(?: Bundle)?$|Greenhouse$|Sapling$|Brazier(?:s)?$/i.test(input.name)
  ) {
    return false;
  }

  return /(?:^|\s)(Plants?|Places?)\b/i.test(input.description);
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
  database: Pick<typeof appDb, "insert">;
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
  const readyAt = new Date(
    input.plantedAt.getTime() + input.durationSeconds * 1000,
  );

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
  const matches = await input.database
    .select({ id: discordFarmTimers.id })
    .from(discordFarmTimers)
    .where(
      and(
        eq(discordFarmTimers.guildId, input.guildId),
        eq(discordFarmTimers.ownerDiscordUserId, input.ownerDiscordUserId),
        eq(discordFarmTimers.status, "pending"),
        ilike(sql<string>`${discordFarmTimers.id}::text`, `${input.shortId}%`),
      ),
    );

  if (matches.length !== 1) return null;
  const [match] = matches;
  if (!match) return null;

  const [timer] = await input.database
    .update(discordFarmTimers)
    .set({ status: "canceled", canceledAt: input.canceledAt })
    .where(eq(discordFarmTimers.id, match.id))
    .returning({ id: discordFarmTimers.id });

  if (!timer) return null;

  await input.database
    .update(discordFarmNotifications)
    .set({ status: "skipped" })
    .where(eq(discordFarmNotifications.timerId, timer.id));

  return timer;
}

export async function findSeedItemsWithTimers(database: typeof appDb) {
  const candidateItems = await database
    .select({
      id: items.id,
      name: items.name,
      description: items.description,
      icon: items.icon,
    })
    .from(items)
    .where(
      or(
        ilike(items.name, "%Seed%"),
        ilike(items.name, "%Bundle%"),
        ilike(items.name, "%Greenhouse%"),
        ilike(items.name, "%Sapling%"),
        ilike(items.name, "%Brazier%"),
        ilike(items.name, "%Larder%"),
      ),
    )
    .orderBy(asc(items.name));

  return candidateItems.filter((item) => isLikelyPlantableTimerItem(item));
}
