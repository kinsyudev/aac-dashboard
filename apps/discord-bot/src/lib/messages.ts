import type { APIEmbed, MessageCreateOptions } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

import { formatDuration } from "./duration";
import { shortTimerId } from "./timers";

export interface ReminderMessageInput {
  timerId: string;
  kind: "advance" | "ready";
  cropName: string;
  cropIcon: string | null;
  note: string | null;
  farmSlug: string | null;
  plantedByDiscordUserId: string;
  pingRoleId: string | null;
  readyAt: Date;
  durationSeconds: number;
  lateBySeconds: number;
}

export function buildItemEmbed(
  embed: APIEmbed,
  icon: string | null | undefined,
): APIEmbed {
  return {
    ...embed,
    ...(icon
      ? { thumbnail: { url: `https://aa-classic.com/game/icons/${icon}` } }
      : {}),
  };
}

export function buildReminderMessage(
  input: ReminderMessageInput,
): MessageCreateOptions {
  const target =
    input.kind === "advance"
      ? `<@${input.plantedByDiscordUserId}>`
      : input.pingRoleId != null
        ? `<@&${input.pingRoleId}>`
        : `<@${input.plantedByDiscordUserId}>`;

  const title =
    input.kind === "advance"
      ? `${input.cropName} is almost ready`
      : `${input.cropName} is ready`;

  const description =
    input.kind === "advance"
      ? `${target} ${input.cropName} will be ready soon.`
      : `${target} ${input.cropName} is ready to harvest.`;

  const fields: APIEmbed["fields"] = [
    { name: "Timer", value: shortTimerId(input.timerId), inline: true },
    {
      name: "Duration",
      value: formatDuration(input.durationSeconds),
      inline: true,
    },
    {
      name: "Ready",
      value: `<t:${Math.floor(input.readyAt.getTime() / 1000)}:R>`,
      inline: true,
    },
  ];

  if (input.farmSlug != null) {
    fields.push({ name: "Farm", value: input.farmSlug, inline: true });
  }

  if (input.note != null && input.note.trim().length > 0) {
    fields.push({ name: "Note", value: input.note.trim(), inline: false });
  }

  if (input.lateBySeconds >= 60) {
    fields.push({
      name: "Delivery",
      value: `Late by ${formatDuration(input.lateBySeconds)}`,
      inline: true,
    });
  }

  const message: MessageCreateOptions = {
    content: target,
    embeds: [
      buildItemEmbed(
        {
          title,
          description,
          color: input.kind === "advance" ? 0xf59e0b : 0x22c55e,
          fields,
        },
        input.cropIcon,
      ),
    ],
  };

  if (input.kind === "ready") {
    message.components = [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`farm-replant:${input.timerId}`)
          .setLabel("Replant")
          .setStyle(ButtonStyle.Primary),
      ),
    ];
  }

  return message;
}
