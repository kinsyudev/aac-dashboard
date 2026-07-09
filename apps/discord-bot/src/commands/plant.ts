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
import {
  logInteractionError,
  logInteractionFinish,
  logInteractionStart,
} from "../lib/logging";

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
    const startedAt = Date.now();
    const focused = interaction.options.getFocused(true);
    const baseContext = {
      interactionType: "autocomplete" as const,
      commandName: "plant",
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
      options: {
        focused: focused.name,
        query: String(focused.value),
      },
    };

    logInteractionStart(this.container.logger, baseContext);

    try {
      if (focused.name !== "crop") {
        const response = await interaction.respond([]);
        logInteractionFinish(this.container.logger, {
          ...baseContext,
          outcome: "ok",
          durationMs: Date.now() - startedAt,
          result: { suggestionCount: 0, skipped: true },
        });
        return response;
      }

      const catalog = await getCropCatalog(db);
      const suggestions = findCropSuggestions(catalog, String(focused.value));
      const response = await interaction.respond(suggestions);

      logInteractionFinish(this.container.logger, {
        ...baseContext,
        outcome: "ok",
        durationMs: Date.now() - startedAt,
        result: { suggestionCount: suggestions.length },
      });

      return response;
    } catch (error) {
      logInteractionError(this.container.logger, {
        ...baseContext,
        durationMs: Date.now() - startedAt,
        error,
      });
      logInteractionFinish(this.container.logger, {
        ...baseContext,
        outcome: "system_error",
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    const startedAt = Date.now();
    const cropInput = interaction.options.getString("crop", true);
    const durationInput = interaction.options.getString("duration");
    const role = interaction.options.getRole("role");
    const farmSlug = interaction.options.getString("farm");
    const channel = interaction.options.getChannel("channel");
    const note = interaction.options.getString("note");
    const baseContext = {
      interactionType: "chat_input" as const,
      commandName: "plant",
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
      options: {
        crop: cropInput,
        duration: durationInput,
        roleId: role?.id ?? null,
        farm: farmSlug,
        channelId: channel?.id ?? null,
        note,
      },
    };

    logInteractionStart(this.container.logger, baseContext);

    try {
      if (!interaction.guildId) {
        const response = await interaction.reply({
          content: "Farm timers can only be used inside a Discord server.",
          flags: MessageFlags.Ephemeral,
        });
        logInteractionFinish(this.container.logger, {
          ...baseContext,
          outcome: "user_error",
          durationMs: Date.now() - startedAt,
          result: { reason: "missing_guild" },
        });
        return response;
      }
      const { guildId } = interaction;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const explicitDurationSeconds =
        durationInput != null ? parseDurationSeconds(durationInput) : null;

      if (durationInput != null && explicitDurationSeconds == null) {
        const response = await interaction.editReply({
          content:
            "Duration must look like `45m`, `1h 30m`, `2d 4h`, or `3600s`, with a maximum of 14 days.",
        });
        logInteractionFinish(this.container.logger, {
          ...baseContext,
          outcome: "user_error",
          durationMs: Date.now() - startedAt,
          result: { reason: "invalid_duration" },
        });
        return response;
      }

      const catalog = await getCropCatalog(db);
      const crop = resolveCropAlias(catalog.aliases, cropInput);
      const exactItem = resolveCatalogItem(catalog, cropInput);

      if (crop?.kind === "ambiguous") {
        const suggestions = crop.matches
          .slice(0, 5)
          .map((match) => match.item.name)
          .join(", ");

        const response = await interaction.editReply({
          content: `That crop is ambiguous. Try one of: ${suggestions}.`,
        });
        logInteractionFinish(this.container.logger, {
          ...baseContext,
          outcome: "user_error",
          durationMs: Date.now() - startedAt,
          result: { reason: "ambiguous_crop", suggestionCount: crop.matches.length },
        });
        return response;
      }

      if (crop == null && exactItem?.kind === "ambiguous") {
        const suggestions = exactItem.matches
          .slice(0, 5)
          .map((match) => match.name)
          .join(", ");

        const response = await interaction.editReply({
          content: `That crop is ambiguous. Try one of: ${suggestions}.`,
        });
        logInteractionFinish(this.container.logger, {
          ...baseContext,
          outcome: "user_error",
          durationMs: Date.now() - startedAt,
          result: { reason: "ambiguous_item", suggestionCount: exactItem.matches.length },
        });
        return response;
      }

      if (crop == null && !(explicitDurationSeconds != null && exactItem?.kind === "match")) {
        const response = await interaction.editReply({
          content: `I do not have an in-game timer for "${cropInput}". Add a duration override like \`duration:45m\`.`,
        });
        logInteractionFinish(this.container.logger, {
          ...baseContext,
          outcome: "user_error",
          durationMs: Date.now() - startedAt,
          result: { reason: "unknown_crop" },
        });
        return response;
      }

      const resolvedItem =
        crop?.item ??
        (exactItem?.kind === "match" ? exactItem.item : null);
      if (resolvedItem == null) {
        const response = await interaction.editReply({
          content: `I do not have an in-game timer for "${cropInput}". Add a duration override like \`duration:45m\`.`,
        });
        logInteractionFinish(this.container.logger, {
          ...baseContext,
          outcome: "user_error",
          durationMs: Date.now() - startedAt,
          result: { reason: "unresolved_item" },
        });
        return response;
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
        const response = await interaction.editReply({
          content: `You do not have a farm named \`${farmSlug}\`. Create it with \`/farm add\`.`,
        });
        logInteractionFinish(this.container.logger, {
          ...baseContext,
          outcome: "user_error",
          durationMs: Date.now() - startedAt,
          result: { reason: "unknown_farm", farm: farmSlug },
        });
        return response;
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

      const response = await interaction.editReply({
        content: `Created timer \`${timer.id.slice(0, 8)}\` for ${resolvedItem.name}. It will be ready <t:${Math.floor(timer.readyAt.getTime() / 1000)}:R>.`,
      });

      logInteractionFinish(this.container.logger, {
        ...baseContext,
        outcome: "ok",
        durationMs: Date.now() - startedAt,
        result: {
          timerId: timer.id,
          cropName: resolvedItem.name,
          farmId: farm?.id ?? null,
          durationSource: duration.source,
          durationSeconds: duration.durationSeconds,
          readyAt: timer.readyAt,
        },
      });

      return response;
    } catch (error) {
      logInteractionError(this.container.logger, {
        ...baseContext,
        durationMs: Date.now() - startedAt,
        error,
      });
      logInteractionFinish(this.container.logger, {
        ...baseContext,
        outcome: "system_error",
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  }
}
