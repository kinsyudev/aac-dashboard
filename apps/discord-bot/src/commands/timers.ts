import { db } from "@acme/db/client";
import { Command } from "@sapphire/framework";
import { MessageFlags } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";

import { listActiveTimers, shortTimerId } from "../lib/timers";

export class TimersCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder.setName("timers").setDescription("List your active farm timers."),
    );
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      return interaction.reply({
        content: "Farm timers can only be used inside a Discord server.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const timers = await listActiveTimers({
      database: db,
      guildId: interaction.guildId,
      ownerDiscordUserId: interaction.user.id,
    });

    if (timers.length === 0) {
      return interaction.reply({
        content: "You do not have any active farm timers.",
        flags: MessageFlags.Ephemeral,
      });
    }

    return interaction.reply({
      content: timers
        .map((timer) => {
          const farm = timer.farmSlug != null ? ` on \`${timer.farmSlug}\`` : "";
          const note = timer.note != null ? ` — ${timer.note}` : "";
          return `\`${shortTimerId(timer.id)}\` ${timer.cropName}${farm}: <t:${Math.floor(timer.readyAt.getTime() / 1000)}:R>${note}`;
        })
        .join("\n"),
      flags: MessageFlags.Ephemeral,
    });
  }
}
