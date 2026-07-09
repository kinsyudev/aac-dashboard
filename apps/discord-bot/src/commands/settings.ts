import { and, eq } from "@acme/db";
import { db } from "@acme/db/client";
import { discordFarmUsers } from "@acme/db/schema";
import { Command } from "@sapphire/framework";
import { MessageFlags } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";

import { ensureDiscordFarmUser } from "../lib/farms";
import { findDashboardUserIdForDiscordUser } from "../lib/identity";
import {
  logInteractionError,
  logInteractionFinish,
  logInteractionStart,
} from "../lib/logging";

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
    const startedAt = Date.now();
    const baseContext = {
      interactionType: "chat_input" as const,
      commandName: "settings",
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
      options: {
        subcommand: interaction.options.getSubcommand(false),
        minutes: interaction.options.getInteger("minutes"),
      },
    };

    logInteractionStart(this.container.logger, baseContext);

    try {
      if (!interaction.guildId) {
        const response = await interaction.reply({
          content: "Settings can only be used inside a Discord server.",
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

        const response = await interaction.reply({
          content:
            reminderMinutes === 0
              ? "Advance reminders disabled."
              : `Advance reminders set to ${reminderMinutes} minutes.`,
          flags: MessageFlags.Ephemeral,
        });

        logInteractionFinish(this.container.logger, {
          ...baseContext,
          outcome: "ok",
          durationMs: Date.now() - startedAt,
          result: { subcommand, reminderMinutes },
        });

        return response;
      }

      if (subcommand === "show") {
        const response = await interaction.reply({
          content: [
            `Advance reminder: ${
              farmUser.reminderMinutes === 0
                ? "disabled"
                : `${farmUser.reminderMinutes} minutes`
            }`,
            farmUser.defaultRoleId != null
              ? `Default role: <@&${farmUser.defaultRoleId}>`
              : "Default role: none",
            farmUser.defaultChannelId != null
              ? `Default channel: <#${farmUser.defaultChannelId}>`
              : "Default channel: current / farm / command channel",
          ].join("\n"),
          flags: MessageFlags.Ephemeral,
        });

        logInteractionFinish(this.container.logger, {
          ...baseContext,
          outcome: "ok",
          durationMs: Date.now() - startedAt,
          result: { subcommand },
        });

        return response;
      }

      const response = await interaction.reply({
        content: "Unknown settings command.",
        flags: MessageFlags.Ephemeral,
      });

      logInteractionFinish(this.container.logger, {
        ...baseContext,
        outcome: "user_error",
        durationMs: Date.now() - startedAt,
        result: { reason: "unknown_subcommand", subcommand },
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
