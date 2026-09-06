import type { ModalSubmitInteraction } from "discord.js";
import {
  InteractionHandler,
  InteractionHandlerTypes,
} from "@sapphire/framework";

import { db } from "@acme/db/client";

import { handleManagementInteraction } from "../lib/management-interactions";
import { parseManagementId } from "../lib/management-view";

export class ManagementModalHandler extends InteractionHandler {
  public constructor(
    ctx: InteractionHandler.LoaderContext,
    options: InteractionHandler.Options,
  ) {
    super(ctx, {
      ...options,
      interactionHandlerType: InteractionHandlerTypes.ModalSubmit,
    });
  }

  public override parse(interaction: ModalSubmitInteraction) {
    return parseManagementId(interaction.customId) ? this.some() : this.none();
  }

  public async run(interaction: ModalSubmitInteraction) {
    await handleManagementInteraction(interaction, db, (error) =>
      this.container.logger.error("Farm management form failed", error),
    );
  }
}
