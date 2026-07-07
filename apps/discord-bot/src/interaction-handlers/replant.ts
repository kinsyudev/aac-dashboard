import { db } from "@acme/db/client";
import {
  InteractionHandler,
  InteractionHandlerTypes,
} from "@sapphire/framework";
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
  public constructor(
    ctx: InteractionHandler.LoaderContext,
    options: InteractionHandler.Options,
  ) {
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
    const { guildId } = interaction;

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
          eq(fields.guildId, guildId),
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
            content:
              "I could not recompute this crop timer. Run `/plant` manually with a duration.",
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
      guildId,
      ownerDiscordUserId: interaction.user.id,
      userId,
      farmId: original.farmId,
      cropItemId: original.cropItemId,
      cropName: original.cropName,
      durationSeconds,
      durationSource,
      explicitDurationSeconds,
      note: original.note,
      commandChannelId: interaction.channelId,
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
