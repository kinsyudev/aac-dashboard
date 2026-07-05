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
