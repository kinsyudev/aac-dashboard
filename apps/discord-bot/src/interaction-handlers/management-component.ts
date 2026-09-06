import type { Interaction } from "discord.js";
import {
  InteractionHandler,
  InteractionHandlerTypes,
} from "@sapphire/framework";

import { db } from "@acme/db/client";

import { handleManagementInteraction } from "../lib/management-interactions";
import { parseManagementId } from "../lib/management-view";

export class ManagementComponentHandler extends InteractionHandler {
  public constructor(
    ctx: InteractionHandler.LoaderContext,
    options: InteractionHandler.Options,
  ) {
    super(ctx, {
      ...options,
      interactionHandlerType: InteractionHandlerTypes.MessageComponent,
    });
  }

  public override parse(interaction: Interaction) {
    return interaction.isMessageComponent() &&
      parseManagementId(interaction.customId)
      ? this.some()
      : this.none();
  }

  public async run(interaction: Interaction) {
    if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
    await handleManagementInteraction(interaction, db, (error) =>
      this.container.logger.error("Farm management interaction failed", error),
    );
  }
}
