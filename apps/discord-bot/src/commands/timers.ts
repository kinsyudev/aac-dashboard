import { db } from "@acme/db/client";
import { Command } from "@sapphire/framework";
import { MessageFlags } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";

import {
  logInteractionError,
  logInteractionFinish,
  logInteractionStart,
} from "../lib/logging";
import { listActiveTimers, shortTimerId } from "../lib/timers";

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

      const timers = await listActiveTimers({
        database: db,
        guildId: interaction.guildId,
        ownerDiscordUserId: interaction.user.id,
      });

      if (timers.length === 0) {
        const response = await interaction.reply({
          content: "You do not have any active farm timers.",
          flags: MessageFlags.Ephemeral,
        });

        logInteractionFinish(this.container.logger, {
          ...baseContext,
          outcome: "user_error",
          durationMs: Date.now() - startedAt,
          result: { timerCount: 0 },
        });

        return response;
      }

      const response = await interaction.reply({
        content: timers
          .map((timer) => {
            const farm = timer.farmSlug != null ? ` on \`${timer.farmSlug}\`` : "";
            const note = timer.note != null ? ` — ${timer.note}` : "";
            return `\`${shortTimerId(timer.id)}\` ${timer.cropName}${farm}: <t:${Math.floor(timer.readyAt.getTime() / 1000)}:R>${note}`;
          })
          .join("\n"),
        flags: MessageFlags.Ephemeral,
      });

      logInteractionFinish(this.container.logger, {
        ...baseContext,
        outcome: "ok",
        durationMs: Date.now() - startedAt,
        result: { timerCount: timers.length },
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
