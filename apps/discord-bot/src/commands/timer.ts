import { db } from "@acme/db/client";
import { Command } from "@sapphire/framework";
import { MessageFlags } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";

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
    if (!interaction.guildId) {
      return interaction.reply({
        content: "Farm timers can only be used inside a Discord server.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const subcommand = interaction.options.getSubcommand();
    if (subcommand !== "cancel") {
      return interaction.reply({
        content: "Unknown timer command.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const shortId = interaction.options.getString("id", true);
    const canceled = await cancelTimerByShortId({
      database: db,
      guildId: interaction.guildId,
      ownerDiscordUserId: interaction.user.id,
      shortId,
      canceledAt: new Date(),
    });

    return interaction.reply({
      content:
        canceled == null
          ? `No active timer found for \`${shortId}\`.`
          : `Canceled timer \`${shortId}\`.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
