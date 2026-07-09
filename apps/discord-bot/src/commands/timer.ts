import { db } from "@acme/db/client";
import { Command } from "@sapphire/framework";
import { MessageFlags } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";

import {
  logInteractionError,
  logInteractionFinish,
  logInteractionStart,
} from "../lib/logging";
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
    const startedAt = Date.now();
    const baseContext = {
      interactionType: "chat_input" as const,
      commandName: "timer",
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
      options: {
        subcommand: interaction.options.getSubcommand(false),
        id: interaction.options.getString("id"),
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

      const subcommand = interaction.options.getSubcommand();
      if (subcommand !== "cancel") {
        const response = await interaction.reply({
          content: "Unknown timer command.",
          flags: MessageFlags.Ephemeral,
        });

        logInteractionFinish(this.container.logger, {
          ...baseContext,
          outcome: "user_error",
          durationMs: Date.now() - startedAt,
          result: { reason: "unknown_subcommand", subcommand },
        });

        return response;
      }

      const shortId = interaction.options.getString("id", true);
      const canceled = await cancelTimerByShortId({
        database: db,
        guildId: interaction.guildId,
        ownerDiscordUserId: interaction.user.id,
        shortId,
        canceledAt: new Date(),
      });

      const response = await interaction.reply({
        content:
          canceled == null
            ? `No active timer found for \`${shortId}\`.`
            : `Canceled timer \`${shortId}\`.`,
        flags: MessageFlags.Ephemeral,
      });

      logInteractionFinish(this.container.logger, {
        ...baseContext,
        outcome: canceled == null ? "user_error" : "ok",
        durationMs: Date.now() - startedAt,
        result: {
          subcommand,
          shortId,
          canceled: canceled != null,
          timerId: canceled?.id,
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
