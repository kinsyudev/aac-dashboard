import type { db as appDb } from "@acme/db/client";
import { and, eq } from "@acme/db";
import {
  discordFarmNotifications,
  discordFarms,
  discordFarmTimers,
} from "@acme/db/schema";

import type { ManagementState } from "./management-view";
import { getCropCatalog, resolveCatalogItem } from "./crop-catalog";
import { resolveCropAlias } from "./crop-timers";
import { parseDurationSeconds } from "./duration";
import {
  findOwnedFarm,
  normalizeFarmSlug,
  resolveReminderDefaults,
} from "./farms";
import { findDashboardUserIdForDiscordUser } from "./identity";
import { buildManagementList, displayText } from "./management-view";
import {
  buildTimerNotifications,
  chooseDuration,
  createFarmTimer,
  findFarmCropOverride,
  listActiveTimers,
} from "./timers";

export class ManagementInputError extends Error {}

export interface ManagementScope {
  database: typeof appDb;
  guildId: string;
  ownerDiscordUserId: string;
}

function owned(
  scope: ManagementScope,
  table: typeof discordFarms | typeof discordFarmTimers,
) {
  return and(
    eq(table.guildId, scope.guildId),
    eq(table.ownerDiscordUserId, scope.ownerDiscordUserId),
  );
}

export async function getManagedFarm(scope: ManagementScope, id: string) {
  const farm = await scope.database.query.discordFarms.findFirst({
    where: and(owned(scope, discordFarms), eq(discordFarms.id, id)),
  });
  if (!farm)
    throw new ManagementInputError(
      "This farm no longer exists. Refresh the list.",
    );
  return farm;
}

export async function getManagedTimer(scope: ManagementScope, id: string) {
  const timer = await scope.database.query.discordFarmTimers.findFirst({
    where: and(
      owned(scope, discordFarmTimers),
      eq(discordFarmTimers.id, id),
      eq(discordFarmTimers.status, "pending"),
    ),
    with: { farm: true },
  });
  if (!timer)
    throw new ManagementInputError(
      "This timer is no longer active. Refresh the list.",
    );
  return timer;
}

export async function managementEntries(
  scope: ManagementScope,
  kind: ManagementState["kind"],
) {
  if (kind === "farms") {
    const farms = await scope.database.query.discordFarms.findMany({
      where: owned(scope, discordFarms),
      orderBy: (fields, { asc }) => [asc(fields.slug), asc(fields.id)],
    });
    return farms.map((farm) => ({
      id: farm.id,
      name: farm.name,
      summary: `**${displayText(farm.name, 80)}** · ${displayText(farm.slug, 80)}`,
      detail: [
        `**${displayText(farm.name, 100)}** · ${displayText(farm.slug, 80)}`,
        farm.description ? displayText(farm.description, 400) : null,
        farm.defaultChannelId
          ? `Reminders: <#${farm.defaultChannelId}>`
          : "Reminders: use your default channel",
        farm.defaultRoleId
          ? `Ping: <@&${farm.defaultRoleId}>`
          : "Ping: use your default recipient",
      ]
        .filter(Boolean)
        .join("\n"),
    }));
  }
  const timers = await listActiveTimers(scope);
  return timers.map((timer) => ({
    id: timer.id,
    name: `${timer.cropName}${timer.farmSlug ? ` · ${timer.farmSlug}` : ""} · ${timer.id.slice(0, 8)}`,
    summary: `**${displayText(timer.cropName, 80)}**${timer.farmSlug ? ` · ${displayText(timer.farmSlug, 80)}` : ""} — <t:${Math.floor(timer.readyAt.getTime() / 1000)}:R>`,
    detail: [
      `**${displayText(timer.cropName, 100)}** · ${timer.id.slice(0, 8)}`,
      `Ready <t:${Math.floor(timer.readyAt.getTime() / 1000)}:f>`,
      timer.farmSlug ? `Farm: ${displayText(timer.farmSlug, 80)}` : "No farm",
      timer.note ? displayText(timer.note, 500) : null,
    ]
      .filter(Boolean)
      .join("\n"),
  }));
}

export async function managementList(
  scope: ManagementScope,
  state: ManagementState,
  notice?: string,
) {
  return buildManagementList(
    state,
    await managementEntries(scope, state.kind),
    notice,
  );
}

export function parseFarmForm(values: Record<string, string>) {
  const slug = normalizeFarmSlug(values.slug ?? "");
  if (!slug || slug.length > 80)
    throw new ManagementInputError(
      "Use a farm slug with letters or numbers, up to 80 characters.",
    );
  const nameInput = values.name?.trim();
  const name = nameInput == null || nameInput === "" ? slug : nameInput;
  const descriptionInput = values.description?.trim();
  const description =
    descriptionInput == null || descriptionInput === ""
      ? null
      : descriptionInput;
  if (name.length > 100 || (description?.length ?? 0) > 500) {
    throw new ManagementInputError(
      "Use a name up to 100 characters and notes up to 500 characters.",
    );
  }
  return { slug, name, description };
}

export async function saveManagedFarm(
  scope: ManagementScope,
  id: string | undefined,
  values: Record<string, string>,
) {
  const data = parseFarmForm(values);
  try {
    if (id) {
      const [farm] = await scope.database
        .update(discordFarms)
        .set(data)
        .where(and(owned(scope, discordFarms), eq(discordFarms.id, id)))
        .returning();
      if (!farm)
        throw new ManagementInputError(
          "This farm no longer exists. Refresh the list.",
        );
      return farm;
    }
    const userId = await findDashboardUserIdForDiscordUser(
      scope.database,
      scope.ownerDiscordUserId,
    );
    const [farm] = await scope.database
      .insert(discordFarms)
      .values({
        ...data,
        guildId: scope.guildId,
        ownerDiscordUserId: scope.ownerDiscordUserId,
        userId,
      })
      .onConflictDoNothing()
      .returning();
    if (!farm)
      throw new ManagementInputError(
        "You already have a farm with that slug. Choose another slug or edit the existing farm.",
      );
    return farm;
  } catch (error) {
    // Drizzle wraps PostgreSQL errors in a query error.
    const cause = error instanceof Error && error.cause ? error.cause : error;
    if (
      typeof cause === "object" &&
      cause != null &&
      "code" in cause &&
      cause.code === "23505"
    ) {
      throw new ManagementInputError(
        "You already have a farm with that slug. Choose another slug.",
      );
    }
    throw error;
  }
}

export async function deleteManagedEntry(
  scope: ManagementScope,
  state: ManagementState,
) {
  const id = state.id;
  if (!id) throw new ManagementInputError("Select an entry first.");
  if (state.kind === "farms") {
    const rows = await scope.database
      .delete(discordFarms)
      .where(and(owned(scope, discordFarms), eq(discordFarms.id, id)))
      .returning({ id: discordFarms.id });
    if (!rows.length)
      throw new ManagementInputError("This farm was already deleted.");
    return;
  }
  await scope.database.transaction(async (tx) => {
    const [timer] = await tx
      .update(discordFarmTimers)
      .set({ status: "canceled", canceledAt: new Date() })
      .where(
        and(
          owned(scope, discordFarmTimers),
          eq(discordFarmTimers.id, id),
          eq(discordFarmTimers.status, "pending"),
        ),
      )
      .returning({ id: discordFarmTimers.id });
    if (!timer)
      throw new ManagementInputError("This timer is no longer active.");
    await tx
      .update(discordFarmNotifications)
      .set({ status: "skipped" })
      .where(
        and(
          eq(discordFarmNotifications.timerId, timer.id),
          eq(discordFarmNotifications.status, "pending"),
        ),
      );
  });
}

export async function saveManagedTimer(
  scope: ManagementScope,
  id: string | undefined,
  values: Record<string, string>,
  channelId: string,
) {
  const original = id ? await getManagedTimer(scope, id) : null;
  const durationInput = values.duration?.trim() ?? "";
  const explicitDurationSeconds = durationInput
    ? parseDurationSeconds(durationInput)
    : null;
  if (durationInput && explicitDurationSeconds == null) {
    throw new ManagementInputError(
      "Use a duration such as 45m, 1h 30m, or 2d 4h, up to 14 days.",
    );
  }
  const catalog = await getCropCatalog(scope.database);
  const cropInput = values.crop?.trim() ?? "";
  const itemById = /^\d+$/.test(cropInput)
    ? catalog.entries.find((entry) => entry.item.id === Number(cropInput))?.item
    : null;
  const crop = itemById
    ? { kind: "match" as const, item: itemById }
    : resolveCatalogItem(catalog, cropInput);
  if (crop?.kind === "ambiguous") {
    throw new ManagementInputError(
      `Choose a more specific crop: ${crop.matches
        .slice(0, 5)
        .map((item) => `${item.name} (${item.id})`)
        .join(", ")}.`,
    );
  }
  if (!crop)
    throw new ManagementInputError(
      "Crop not found. Enter a crop, seed, sapling, brazier, or larder name, or its item ID.",
    );
  const farmSlug = values.farm?.trim();
  const farm = farmSlug
    ? await findOwnedFarm({ ...scope, slug: farmSlug })
    : null;
  if (farmSlug && !farm)
    throw new ManagementInputError(
      "Farm not found. Use one of your farm slugs from the Farms list.",
    );
  const noteInput = values.note?.trim();
  const note = noteInput == null || noteInput === "" ? null : noteInput;
  if ((note?.length ?? 0) > 500)
    throw new ManagementInputError("Keep the note under 500 characters.");
  const farmUser = await scope.database.query.discordFarmUsers.findFirst({
    where: (fields, { and: both, eq: equal }) =>
      both(
        equal(fields.guildId, scope.guildId),
        equal(fields.discordUserId, scope.ownerDiscordUserId),
      ),
  });

  if (original) {
    // A blank duration leaves the schedule and its notification history intact.
    const plantedAt = new Date();
    return scope.database.transaction(async (tx) => {
      const [timer] = await tx
        .update(discordFarmTimers)
        .set({
          cropItemId: crop.item.id,
          cropName: crop.item.name,
          farmId: farm?.id ?? null,
          note,
          ...(explicitDurationSeconds != null
            ? {
                plantedAt,
                readyAt: new Date(
                  plantedAt.getTime() + explicitDurationSeconds * 1000,
                ),
                durationSeconds: explicitDurationSeconds,
                explicitDurationSeconds,
                durationSource: "explicit" as const,
              }
            : {}),
        })
        .where(
          and(
            owned(scope, discordFarmTimers),
            eq(discordFarmTimers.id, original.id),
            eq(discordFarmTimers.status, "pending"),
            eq(discordFarmTimers.updatedAt, original.updatedAt),
          ),
        )
        .returning();
      if (!timer)
        throw new ManagementInputError(
          "This timer changed or is no longer active. Refresh the list and try again.",
        );
      if (explicitDurationSeconds != null) {
        await tx
          .delete(discordFarmNotifications)
          .where(eq(discordFarmNotifications.timerId, timer.id));
        await tx.insert(discordFarmNotifications).values(
          buildTimerNotifications({
            timerId: timer.id,
            plantedAt,
            durationSeconds: explicitDurationSeconds,
            reminderMinutes: farmUser?.reminderMinutes ?? 15,
          }).map((notification) => ({ ...notification, timerId: timer.id })),
        );
      }
      return timer;
    });
  }

  const gameCrop = resolveCropAlias(catalog.aliases, crop.item.name);
  const duration = chooseDuration({
    explicitDurationSeconds,
    farmCropOverrideSeconds: await findFarmCropOverride({
      database: scope.database,
      farmId: farm?.id ?? null,
      itemId: crop.item.id,
    }),
    gameTimerSeconds:
      gameCrop && gameCrop.kind !== "ambiguous" ? gameCrop.growthSeconds : null,
  });
  if (!duration)
    throw new ManagementInputError(
      "No default duration is available for this crop. Enter a duration in the form.",
    );
  const defaults = resolveReminderDefaults({
    explicitChannelId: null,
    explicitRoleId: null,
    farmDefaultChannelId: farm?.defaultChannelId ?? null,
    farmDefaultRoleId: farm?.defaultRoleId ?? null,
    userDefaultChannelId: farmUser?.defaultChannelId ?? null,
    userDefaultRoleId: farmUser?.defaultRoleId ?? null,
    commandChannelId: channelId,
    ownerDiscordUserId: scope.ownerDiscordUserId,
  });
  const userId = await findDashboardUserIdForDiscordUser(
    scope.database,
    scope.ownerDiscordUserId,
  );
  return scope.database.transaction((tx) =>
    createFarmTimer({
      ...scope,
      database: tx,
      userId,
      farmId: farm?.id ?? null,
      cropItemId: crop.item.id,
      cropName: crop.item.name,
      durationSeconds: duration.durationSeconds,
      durationSource: duration.source,
      explicitDurationSeconds: duration.explicitDurationSeconds,
      note,
      commandChannelId: channelId,
      reminderChannelId: defaults.reminderChannelId,
      pingRoleId: defaults.pingRoleId,
      plantedAt: new Date(),
      reminderMinutes: farmUser?.reminderMinutes ?? 15,
    }),
  );
}
