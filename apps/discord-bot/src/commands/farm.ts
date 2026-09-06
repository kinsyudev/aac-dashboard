import type { ChatInputCommandInteraction } from "discord.js";
import { Command } from "@sapphire/framework";
import { ChannelType, MessageFlags } from "discord.js";

import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { discordFarms } from "@acme/db/schema";

import {
  findCropSuggestions,
  getCropCatalog,
  resolveCatalogItem,
} from "../lib/crop-catalog";
import { parseDurationSeconds } from "../lib/duration";
import {
  ensureDiscordFarmUser,
  findOwnedFarm,
  normalizeFarmSlug,
  upsertFarmCropOverride,
} from "../lib/farms";
import { findDashboardUserIdForDiscordUser } from "../lib/identity";
import {
  logInteractionError,
  logInteractionFinish,
  logInteractionStart,
} from "../lib/logging";
import { managementList } from "../lib/management";

export class FarmCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName("farm")
        .setDescription("Manage your farm defaults.")
        .addSubcommand((subcommand) =>
          subcommand
            .setName("add")
            .setDescription("Add one of your farms.")
            .addStringOption((option) =>
              option
                .setName("slug")
                .setDescription("Short farm slug.")
                .setRequired(true),
            )
            .addStringOption((option) =>
              option.setName("name").setDescription("Display name."),
            )
            .addStringOption((option) =>
              option
                .setName("description")
                .setDescription("Farm notes or location."),
            )
            .addRoleOption((option) =>
              option
                .setName("default-role")
                .setDescription("Default ready ping role."),
            )
            .addChannelOption((option) =>
              option
                .setName("default-channel")
                .setDescription("Default reminder channel.")
                .addChannelTypes(ChannelType.GuildText),
            )
            .addAttachmentOption((option) =>
              option.setName("screenshot").setDescription("Farm screenshot."),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("set-defaults")
            .setDescription("Set farm default role or channel.")
            .addStringOption((option) =>
              option
                .setName("farm")
                .setDescription("Farm slug.")
                .setRequired(true),
            )
            .addRoleOption((option) =>
              option.setName("role").setDescription("Default ready ping role."),
            )
            .addChannelOption((option) =>
              option
                .setName("channel")
                .setDescription("Default reminder channel.")
                .addChannelTypes(ChannelType.GuildText),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("crop-override")
            .setDescription("Set a duration override for a crop on a farm.")
            .addStringOption((option) =>
              option
                .setName("farm")
                .setDescription("Farm slug.")
                .setRequired(true),
            )
            .addStringOption((option) =>
              option
                .setName("crop")
                .setDescription("Crop, bundle, or greenhouse.")
                .setAutocomplete(true)
                .setRequired(true),
            )
            .addStringOption((option) =>
              option
                .setName("duration")
                .setDescription("Duration such as 45m or 1h 30m.")
                .setRequired(true),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand.setName("list").setDescription("List your farms."),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("show")
            .setDescription("Show one of your farms.")
            .addStringOption((option) =>
              option
                .setName("farm")
                .setDescription("Farm slug.")
                .setRequired(true),
            ),
        ),
    );
  }

  public override async autocompleteRun(
    interaction: Command.AutocompleteInteraction,
  ) {
    const startedAt = Date.now();
    const focused = interaction.options.getFocused(true);
    const query = String(focused.value).toLowerCase();
    const baseContext = {
      interactionType: "autocomplete" as const,
      commandName: "farm",
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
      options: {
        focused: focused.name,
        query,
        subcommand: interaction.options.getSubcommand(false),
      },
    };

    logInteractionStart(this.container.logger, baseContext);

    try {
      if (!interaction.guildId) {
        const response = await interaction.respond([]);
        logInteractionFinish(this.container.logger, {
          ...baseContext,
          outcome: "user_error",
          durationMs: Date.now() - startedAt,
          result: { reason: "missing_guild" },
        });
        return response;
      }
      const { guildId } = interaction;

      if (focused.name === "crop") {
        const catalog = await getCropCatalog(db);
        const suggestions = findCropSuggestions(catalog, query);
        const response = await interaction.respond(suggestions);
        logInteractionFinish(this.container.logger, {
          ...baseContext,
          outcome: "ok",
          durationMs: Date.now() - startedAt,
          result: { suggestionCount: suggestions.length },
        });
        return response;
      }

      if (focused.name === "farm") {
        const farms = await db.query.discordFarms.findMany({
          where: (fields, { and, eq: whereEq }) =>
            and(
              whereEq(fields.guildId, guildId),
              whereEq(fields.ownerDiscordUserId, interaction.user.id),
            ),
          orderBy: (fields, { asc }) => [asc(fields.slug)],
        });

        const suggestions = farms
          .filter((farm) => farm.slug.toLowerCase().includes(query))
          .slice(0, 25)
          .map((farm) => ({ name: farm.name, value: farm.slug }));

        const response = await interaction.respond(suggestions);
        logInteractionFinish(this.container.logger, {
          ...baseContext,
          outcome: "ok",
          durationMs: Date.now() - startedAt,
          result: { suggestionCount: suggestions.length },
        });
        return response;
      }

      const response = await interaction.respond([]);
      logInteractionFinish(this.container.logger, {
        ...baseContext,
        outcome: "ok",
        durationMs: Date.now() - startedAt,
        result: { suggestionCount: 0, skipped: true },
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
    const subcommand = interaction.options.getSubcommand(false);
    const baseContext = {
      interactionType: "chat_input" as const,
      commandName: "farm",
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
      options: {
        subcommand,
        farm: interaction.options.getString("farm"),
        slug: interaction.options.getString("slug"),
        crop: interaction.options.getString("crop"),
        duration: interaction.options.getString("duration"),
        roleId:
          interaction.options.getRole("role")?.id ??
          interaction.options.getRole("default-role")?.id ??
          null,
        channelId:
          interaction.options.getChannel("channel")?.id ??
          interaction.options.getChannel("default-channel")?.id ??
          null,
        name: interaction.options.getString("name"),
      },
    };

    logInteractionStart(this.container.logger, baseContext);

    try {
      if (!interaction.guildId) {
        const response = await interaction.reply({
          content: "Farm commands can only be used inside a Discord server.",
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
      const userId = await findDashboardUserIdForDiscordUser(
        db,
        interaction.user.id,
      );

      if (subcommand === "add") {
        const slug = normalizeFarmSlug(
          interaction.options.getString("slug", true),
        );
        const screenshot = interaction.options.getAttachment("screenshot");

        await ensureDiscordFarmUser({
          database: db,
          guildId,
          discordUserId: interaction.user.id,
          userId,
        });

        const [farm] = await db
          .insert(discordFarms)
          .values({
            guildId,
            ownerDiscordUserId: interaction.user.id,
            userId,
            slug,
            name: interaction.options.getString("name") ?? slug,
            description: interaction.options.getString("description"),
            defaultRoleId:
              interaction.options.getRole("default-role")?.id ?? null,
            defaultChannelId:
              interaction.options.getChannel("default-channel")?.id ?? null,
            screenshotUrl: screenshot?.url ?? null,
            screenshotProxyUrl: screenshot?.proxyURL ?? null,
            screenshotContentType: screenshot?.contentType ?? null,
            screenshotName: screenshot?.name ?? null,
          })
          .onConflictDoUpdate({
            target: [
              discordFarms.guildId,
              discordFarms.ownerDiscordUserId,
              discordFarms.slug,
            ],
            set: {
              name: interaction.options.getString("name") ?? slug,
              description: interaction.options.getString("description"),
              defaultRoleId:
                interaction.options.getRole("default-role")?.id ?? null,
              defaultChannelId:
                interaction.options.getChannel("default-channel")?.id ?? null,
              screenshotUrl: screenshot?.url ?? null,
              screenshotProxyUrl: screenshot?.proxyURL ?? null,
              screenshotContentType: screenshot?.contentType ?? null,
              screenshotName: screenshot?.name ?? null,
            },
          })
          .returning();

        const response = await interaction.reply({
          content: `Saved farm \`${farm?.slug ?? slug}\`.`,
          flags: MessageFlags.Ephemeral,
        });
        logInteractionFinish(this.container.logger, {
          ...baseContext,
          outcome: "ok",
          durationMs: Date.now() - startedAt,
          result: {
            subcommand,
            farmId: farm?.id ?? null,
            slug: farm?.slug ?? slug,
          },
        });
        return response;
      }

      if (subcommand === "list") {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const response = await interaction.editReply(
          await managementList(
            {
              database: db,
              guildId,
              ownerDiscordUserId: interaction.user.id,
            },
            { kind: "farms", ownerId: interaction.user.id, page: 0 },
          ),
        );
        logInteractionFinish(this.container.logger, {
          ...baseContext,
          outcome: "ok",
          durationMs: Date.now() - startedAt,
          result: { subcommand },
        });
        return response;
      }

      const farmSlug = interaction.options.getString("farm");
      const farm =
        farmSlug != null
          ? await findOwnedFarm({
              database: db,
              guildId,
              ownerDiscordUserId: interaction.user.id,
              slug: farmSlug,
            })
          : null;

      if (farmSlug != null && farm == null) {
        const response = await interaction.reply({
          content: `You do not have a farm named \`${farmSlug}\`.`,
          flags: MessageFlags.Ephemeral,
        });
        logInteractionFinish(this.container.logger, {
          ...baseContext,
          outcome: "user_error",
          durationMs: Date.now() - startedAt,
          result: { reason: "unknown_farm", farm: farmSlug },
        });
        return response;
      }

      if (subcommand === "set-defaults" && farm != null) {
        await db
          .update(discordFarms)
          .set({
            defaultRoleId:
              interaction.options.getRole("role")?.id ?? farm.defaultRoleId,
            defaultChannelId:
              interaction.options.getChannel("channel")?.id ??
              farm.defaultChannelId,
          })
          .where(eq(discordFarms.id, farm.id));

        const response = await interaction.reply({
          content: `Updated defaults for \`${farm.slug}\`.`,
          flags: MessageFlags.Ephemeral,
        });
        logInteractionFinish(this.container.logger, {
          ...baseContext,
          outcome: "ok",
          durationMs: Date.now() - startedAt,
          result: { subcommand, farmId: farm.id, slug: farm.slug },
        });
        return response;
      }

      if (subcommand === "crop-override" && farm != null) {
        const durationSeconds = parseDurationSeconds(
          interaction.options.getString("duration", true),
        );

        if (durationSeconds == null) {
          const response = await interaction.reply({
            content:
              "Duration must look like `45m`, `1h 30m`, `2d 4h`, or `3600s`, with a maximum of 14 days.",
            flags: MessageFlags.Ephemeral,
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
        const crop = resolveCatalogItem(
          catalog,
          interaction.options.getString("crop", true),
        );

        if (crop == null || crop.kind === "ambiguous") {
          const response = await interaction.reply({
            content:
              "Choose one item from the crop autocomplete, including larders.",
            flags: MessageFlags.Ephemeral,
          });
          logInteractionFinish(this.container.logger, {
            ...baseContext,
            outcome: "user_error",
            durationMs: Date.now() - startedAt,
            result: { reason: "unresolved_crop" },
          });
          return response;
        }

        await upsertFarmCropOverride({
          database: db,
          farmId: farm.id,
          itemId: crop.item.id,
          durationSeconds,
        });

        const response = await interaction.reply({
          content: `Saved ${crop.item.name} override for \`${farm.slug}\`.`,
          flags: MessageFlags.Ephemeral,
        });
        logInteractionFinish(this.container.logger, {
          ...baseContext,
          outcome: "ok",
          durationMs: Date.now() - startedAt,
          result: {
            subcommand,
            farmId: farm.id,
            cropItemId: crop.item.id,
            durationSeconds,
          },
        });
        return response;
      }

      if (subcommand === "show" && farm != null) {
        const response = await interaction.reply({
          content: [
            `\`${farm.slug}\` — ${farm.name}`,
            farm.description ?? null,
            farm.defaultRoleId != null
              ? `Role: <@&${farm.defaultRoleId}>`
              : null,
            farm.defaultChannelId != null
              ? `Channel: <#${farm.defaultChannelId}>`
              : null,
            farm.screenshotUrl != null
              ? `Screenshot: ${farm.screenshotUrl}`
              : null,
          ]
            .filter((line): line is string => line != null && line.length > 0)
            .join("\n"),
          flags: MessageFlags.Ephemeral,
        });
        logInteractionFinish(this.container.logger, {
          ...baseContext,
          outcome: "ok",
          durationMs: Date.now() - startedAt,
          result: { subcommand, farmId: farm.id, slug: farm.slug },
        });
        return response;
      }

      const response = await interaction.reply({
        content: "Unknown farm command.",
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
