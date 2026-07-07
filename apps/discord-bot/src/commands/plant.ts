import { db } from "@acme/db/client";
import { Command } from "@sapphire/framework";
import { ChannelType, MessageFlags } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";

import { resolveCropAlias } from "../lib/crop-timers";
import {
  findCropSuggestions,
  getCropCatalog,
  resolveCatalogItem,
} from "../lib/crop-catalog";
import { parseDurationSeconds } from "../lib/duration";
import { resolveReminderDefaults } from "../lib/farms";
import { findDashboardUserIdForDiscordUser } from "../lib/identity";
import {
  createFarmTimer,
  findFarmCropOverride,
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

  public override async autocompleteRun(
    interaction: Command.AutocompleteInteraction,
  ) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== "crop") return interaction.respond([]);

    const catalog = await getCropCatalog(db);
    return interaction.respond(findCropSuggestions(catalog, String(focused.value)));
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      return interaction.reply({
        content: "Farm timers can only be used inside a Discord server.",
        flags: MessageFlags.Ephemeral,
      });
    }
    const { guildId } = interaction;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const cropInput = interaction.options.getString("crop", true);
    const durationInput = interaction.options.getString("duration");
    const role = interaction.options.getRole("role");
    const farmSlug = interaction.options.getString("farm");
    const channel = interaction.options.getChannel("channel");
    const note = interaction.options.getString("note");

    const explicitDurationSeconds =
      durationInput != null ? parseDurationSeconds(durationInput) : null;

    if (durationInput != null && explicitDurationSeconds == null) {
      return interaction.editReply({
        content:
          "Duration must look like `45m`, `1h 30m`, `2d 4h`, or `3600s`, with a maximum of 14 days.",
      });
    }

    const catalog = await getCropCatalog(db);
    const crop = resolveCropAlias(catalog.aliases, cropInput);
    const exactItem = resolveCatalogItem(catalog, cropInput);

    if (crop?.kind === "ambiguous") {
      const suggestions = crop.matches
        .slice(0, 5)
        .map((match) => match.item.name)
        .join(", ");

      return interaction.editReply({
        content: `That crop is ambiguous. Try one of: ${suggestions}.`,
      });
    }

    if (crop == null && exactItem?.kind === "ambiguous") {
      const suggestions = exactItem.matches
        .slice(0, 5)
        .map((match) => match.name)
        .join(", ");

      return interaction.editReply({
        content: `That crop is ambiguous. Try one of: ${suggestions}.`,
      });
    }

    if (crop == null && !(explicitDurationSeconds != null && exactItem?.kind === "match")) {
      return interaction.editReply({
        content: `I do not have an in-game timer for "${cropInput}". Add a duration override like \`duration:45m\`.`,
      });
    }

    const resolvedItem =
      crop?.item ??
      (exactItem?.kind === "match" ? exactItem.item : null);
    if (resolvedItem == null) {
      return interaction.editReply({
        content: `I do not have an in-game timer for "${cropInput}". Add a duration override like \`duration:45m\`.`,
      });
    }

    const userId = await findDashboardUserIdForDiscordUser(db, interaction.user.id);
    const farm = farmSlug
      ? await db.query.discordFarms.findFirst({
          where: (fields, { and, eq }) =>
            and(
              eq(fields.guildId, guildId),
              eq(fields.ownerDiscordUserId, interaction.user.id),
              eq(fields.slug, farmSlug),
            ),
        })
      : null;

    if (farmSlug != null && farm == null) {
      return interaction.editReply({
        content: `You do not have a farm named \`${farmSlug}\`. Create it with \`/farm add\`.`,
      });
    }

    const farmCropOverrideSeconds = await findFarmCropOverride({
      database: db,
      farmId: farm?.id ?? null,
      itemId: resolvedItem.id,
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
              durationSeconds: crop?.growthSeconds ?? 0,
              source: "game_timer" as const,
              explicitDurationSeconds: null,
            };

    const farmUser = await db.query.discordFarmUsers.findFirst({
      where: (fields, { and, eq }) =>
        and(
          eq(fields.guildId, guildId),
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
      guildId,
      ownerDiscordUserId: interaction.user.id,
      userId,
      farmId: farm?.id ?? null,
      cropItemId: resolvedItem.id,
      cropName: resolvedItem.name,
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

    return interaction.editReply({
      content: `Created timer \`${timer.id.slice(0, 8)}\` for ${resolvedItem.name}. It will be ready <t:${Math.floor(timer.readyAt.getTime() / 1000)}:R>.`,
    });
  }
}
