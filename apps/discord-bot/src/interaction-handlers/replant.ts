import type { ButtonInteraction } from "discord.js";
import {
  InteractionHandler,
  InteractionHandlerTypes,
} from "@sapphire/framework";
import { MessageFlags } from "discord.js";

import { db } from "@acme/db/client";

import type { ReplantDurationChoice } from "../lib/timers";
import { getCropCatalog } from "../lib/crop-catalog";
import { resolveCropAlias } from "../lib/crop-timers";
import { findDashboardUserIdForDiscordUser } from "../lib/identity";
import {
  logInteractionError,
  logInteractionFinish,
  logInteractionStart,
} from "../lib/logging";
import { buildItemEmbed, buildReplantDurationChoice } from "../lib/messages";
import {
  chooseReplantDurationMode,
  createFarmTimer,
  findFarmCropOverride,
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

    const match = /^farm-replant:([^:]+)(?::(reuse|default))?$/.exec(
      interaction.customId,
    );
    if (!match?.[1]) return this.none();
    return this.some({
      timerId: match[1],
      choice: match[2] as ReplantDurationChoice | undefined,
    });
  }

  public async run(
    interaction: ButtonInteraction,
    parsed: InteractionHandler.ParseResult<this>,
  ) {
    const startedAt = Date.now();
    const baseContext = {
      interactionType: "button" as const,
      commandName: "replant",
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
      options: {
        timerId: parsed.timerId,
        choice: parsed.choice ?? null,
      },
    };

    logInteractionStart(this.container.logger, baseContext);

    try {
      if (!interaction.guildId) {
        const response = await interaction.reply({
          content: "Replant can only be used inside a Discord server.",
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

      const original = await db.query.discordFarmTimers.findFirst({
        with: { cropItem: { columns: { icon: true } } },
        where: (fields, { eq }) => eq(fields.id, parsed.timerId),
      });

      if (original == null) {
        const response = await interaction.reply({
          content: "The original timer could not be found.",
          flags: MessageFlags.Ephemeral,
        });

        logInteractionFinish(this.container.logger, {
          ...baseContext,
          outcome: "user_error",
          durationMs: Date.now() - startedAt,
          result: { reason: "missing_original_timer" },
        });

        return response;
      }

      if (original.ownerDiscordUserId !== interaction.user.id) {
        const response = await interaction.reply({
          content: "Only the planting user can replant this timer.",
          flags: MessageFlags.Ephemeral,
        });

        logInteractionFinish(this.container.logger, {
          ...baseContext,
          outcome: "user_error",
          durationMs: Date.now() - startedAt,
          result: {
            reason: "forbidden_user",
            ownerDiscordUserId: original.ownerDiscordUserId,
          },
        });

        return response;
      }

      const userId = await findDashboardUserIdForDiscordUser(
        db,
        interaction.user.id,
      );
      const farmUser = await db.query.discordFarmUsers.findFirst({
        where: (fields, { and, eq }) =>
          and(
            eq(fields.guildId, guildId),
            eq(fields.discordUserId, interaction.user.id),
          ),
      });

      const mode = chooseReplantDurationMode(
        original.durationSource,
        parsed.choice,
      );
      if (mode === "choose") {
        const response = await interaction.reply({
          ...buildReplantDurationChoice({
            timerId: original.id,
            cropName: original.cropName,
            durationSeconds:
              original.explicitDurationSeconds ?? original.durationSeconds,
          }),
          flags: MessageFlags.Ephemeral,
        });

        logInteractionFinish(this.container.logger, {
          ...baseContext,
          outcome: "ok",
          durationMs: Date.now() - startedAt,
          result: { action: "duration_choice_requested" },
        });

        return response;
      }
      let durationSeconds =
        original.explicitDurationSeconds ?? original.durationSeconds;
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
          const catalog = await getCropCatalog(db);
          const crop = resolveCropAlias(catalog.aliases, original.cropName);
          if (crop == null || crop.kind === "ambiguous") {
            const response = await interaction.reply({
              content:
                "I could not recompute this crop timer. Run `/plant` manually with a duration.",
              flags: MessageFlags.Ephemeral,
            });

            logInteractionFinish(this.container.logger, {
              ...baseContext,
              outcome: "user_error",
              durationMs: Date.now() - startedAt,
              result: {
                reason: "recompute_failed",
                cropName: original.cropName,
              },
            });

            return response;
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

      const responsePayload = {
        embeds: [
          buildItemEmbed(
            {
              title: `${timer.cropName} timer restarted`,
              description: `New timer \`${timer.id.slice(0, 8)}\` is ready <t:${Math.floor(timer.readyAt.getTime() / 1000)}:R>.`,
              color: 0x22c55e,
            },
            original.cropItem.icon,
          ),
        ],
        components: [],
      };
      const response = parsed.choice
        ? await interaction.update(responsePayload)
        : await interaction.reply({
            ...responsePayload,
            flags: MessageFlags.Ephemeral,
          });

      logInteractionFinish(this.container.logger, {
        ...baseContext,
        outcome: "ok",
        durationMs: Date.now() - startedAt,
        result: {
          timerId: timer.id,
          cropName: timer.cropName,
          readyAt: timer.readyAt,
          durationSource,
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
