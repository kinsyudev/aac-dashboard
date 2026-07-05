import { and, asc, eq, lte, sql } from "@acme/db";
import type { db as appDb } from "@acme/db/client";
import {
  discordFarmNotifications,
  discordFarmTimers,
  discordFarms,
} from "@acme/db/schema";
import type { SapphireClient } from "@sapphire/framework";

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
    .orderBy(asc(discordFarmNotifications.notifyAt))
    .limit(25);

  for (const row of dueRows) {
    if (!shouldRetryNotification({ attemptCount: row.notificationAttemptCount })) {
      await markNotificationFailed(input.database, row.notificationId, now, "Max delivery attempts reached.");
      continue;
    }

    try {
      const channel = await input.client.channels.fetch(row.reminderChannelId);
      if (!channel?.isSendable()) {
        throw new Error(
          `Channel ${row.reminderChannelId} is not sendable or is unavailable.`,
        );
      }

      const lateBySeconds = Math.max(
        0,
        Math.floor((now.getTime() - row.readyAt.getTime()) / 1000),
      );

      const message = await channel.send(
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
  let inFlight = false;

  const run = async () => {
    if (inFlight) return;
    inFlight = true;

    try {
      await pollDueFarmNotifications(input);
    } catch (error) {
      input.client.logger.error(error);
    } finally {
      inFlight = false;
    }
  };

  void run();
  return setInterval(() => {
    void run();
  }, intervalMs);
}
