import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { discordFarms } from "@acme/db/schema";
import { Command } from "@sapphire/framework";
import { ChannelType } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";

import { buildCropAliases, resolveCropAlias } from "../lib/crop-timers";
import { parseDurationSeconds } from "../lib/duration";
import {
  ensureDiscordFarmUser,
  findOwnedFarm,
  normalizeFarmSlug,
  upsertFarmCropOverride,
} from "../lib/farms";
import { findDashboardUserIdForDiscordUser } from "../lib/identity";
import { findSeedItemsWithTimers } from "../lib/timers";

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
              option.setName("description").setDescription("Farm notes or location."),
            )
            .addRoleOption((option) =>
              option.setName("default-role").setDescription("Default ready ping role."),
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
              option.setName("farm").setDescription("Farm slug.").setRequired(true),
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
              option.setName("farm").setDescription("Farm slug.").setRequired(true),
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
              option.setName("farm").setDescription("Farm slug.").setRequired(true),
            ),
        ),
    );
  }

  public override async autocompleteRun(
    interaction: Command.AutocompleteInteraction,
  ) {
    if (!interaction.guildId) return interaction.respond([]);
    const { guildId } = interaction;

    const focused = interaction.options.getFocused(true);
    const query = String(focused.value).toLowerCase();

    if (focused.name === "crop") {
      const seedItems = await findSeedItemsWithTimers(db);
      return interaction.respond(
        seedItems
          .filter((item) => item.name.toLowerCase().includes(query))
          .slice(0, 25)
          .map((item) => ({ name: item.name, value: item.name })),
      );
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

      return interaction.respond(
        farms
          .filter((farm) => farm.slug.toLowerCase().includes(query))
          .slice(0, 25)
          .map((farm) => ({ name: farm.name, value: farm.slug })),
      );
    }

    return interaction.respond([]);
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      return interaction.reply({
        content: "Farm commands can only be used inside a Discord server.",
        ephemeral: true,
      });
    }
    const { guildId } = interaction;

    const subcommand = interaction.options.getSubcommand();
    const userId = await findDashboardUserIdForDiscordUser(db, interaction.user.id);

    if (subcommand === "add") {
      const slug = normalizeFarmSlug(interaction.options.getString("slug", true));
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
          defaultRoleId: interaction.options.getRole("default-role")?.id ?? null,
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
            defaultRoleId: interaction.options.getRole("default-role")?.id ?? null,
            defaultChannelId:
              interaction.options.getChannel("default-channel")?.id ?? null,
            screenshotUrl: screenshot?.url ?? null,
            screenshotProxyUrl: screenshot?.proxyURL ?? null,
            screenshotContentType: screenshot?.contentType ?? null,
            screenshotName: screenshot?.name ?? null,
          },
        })
        .returning();

      return interaction.reply({
        content: `Saved farm \`${farm?.slug ?? slug}\`.`,
        ephemeral: true,
      });
    }

    if (subcommand === "list") {
      const farms = await db.query.discordFarms.findMany({
        where: (fields, { and, eq: whereEq }) =>
          and(
            whereEq(fields.guildId, guildId),
            whereEq(fields.ownerDiscordUserId, interaction.user.id),
          ),
        orderBy: (fields, { asc }) => [asc(fields.slug)],
      });

      return interaction.reply({
        content:
          farms.length === 0
            ? "You have not added any farms."
            : farms.map((farm) => `\`${farm.slug}\` — ${farm.name}`).join("\n"),
        ephemeral: true,
      });
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
      return interaction.reply({
        content: `You do not have a farm named \`${farmSlug}\`.`,
        ephemeral: true,
      });
    }

    if (subcommand === "set-defaults" && farm != null) {
      await db
        .update(discordFarms)
        .set({
          defaultRoleId: interaction.options.getRole("role")?.id ?? farm.defaultRoleId,
          defaultChannelId:
            interaction.options.getChannel("channel")?.id ?? farm.defaultChannelId,
        })
        .where(eq(discordFarms.id, farm.id));

      return interaction.reply({
        content: `Updated defaults for \`${farm.slug}\`.`,
        ephemeral: true,
      });
    }

    if (subcommand === "crop-override" && farm != null) {
      const durationSeconds = parseDurationSeconds(
        interaction.options.getString("duration", true),
      );

      if (durationSeconds == null) {
        return interaction.reply({
          content:
            "Duration must look like `45m`, `1h 30m`, `2d 4h`, or `3600s`, with a maximum of 14 days.",
          ephemeral: true,
        });
      }

      const seedItems = await findSeedItemsWithTimers(db);
      const crop = resolveCropAlias(
        buildCropAliases(seedItems),
        interaction.options.getString("crop", true),
      );

      if (crop == null || crop.kind === "ambiguous") {
        return interaction.reply({
          content: "That crop did not resolve to one seed, bundle, or greenhouse.",
          ephemeral: true,
        });
      }

      await upsertFarmCropOverride({
        database: db,
        farmId: farm.id,
        itemId: crop.item.id,
        durationSeconds,
      });

      return interaction.reply({
        content: `Saved ${crop.item.name} override for \`${farm.slug}\`.`,
        ephemeral: true,
      });
    }

    if (subcommand === "show" && farm != null) {
      return interaction.reply({
        content: [
          `\`${farm.slug}\` — ${farm.name}`,
          farm.description ?? null,
          farm.defaultRoleId != null ? `Role: <@&${farm.defaultRoleId}>` : null,
          farm.defaultChannelId != null ? `Channel: <#${farm.defaultChannelId}>` : null,
          farm.screenshotUrl != null ? `Screenshot: ${farm.screenshotUrl}` : null,
        ]
          .filter((line): line is string => line != null && line.length > 0)
          .join("\n"),
        ephemeral: true,
      });
    }

    return interaction.reply({
      content: "Unknown farm command.",
      ephemeral: true,
    });
  }
}
