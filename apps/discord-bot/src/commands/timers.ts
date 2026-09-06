import type { ChatInputCommandInteraction } from "discord.js";
import { Command } from "@sapphire/framework";
import { MessageFlags } from "discord.js";

import { db } from "@acme/db/client";

import {
  logInteractionError,
  logInteractionFinish,
  logInteractionStart,
} from "../lib/logging";
import { managementList } from "../lib/management";

export class TimersCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder.setName("timers").setDescription("List your active farm timers."),
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    const startedAt = Date.now();
    const baseContext = {
      interactionType: "chat_input" as const,
      commandName: "timers",
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
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

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const response = await interaction.editReply(
        await managementList(
          {
            database: db,
            guildId: interaction.guildId,
            ownerDiscordUserId: interaction.user.id,
          },
          { kind: "timers", ownerId: interaction.user.id, page: 0 },
        ),
      );

      logInteractionFinish(this.container.logger, {
        ...baseContext,
        outcome: "ok",
        durationMs: Date.now() - startedAt,
        result: { view: "timers" },
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
