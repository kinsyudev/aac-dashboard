import type {
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from "discord.js";
import { MessageFlags } from "discord.js";

import type { db as appDb } from "@acme/db/client";

import { getCropCatalog } from "./crop-catalog";
import {
  deleteManagedEntry,
  getManagedFarm,
  getManagedTimer,
  managementEntries,
  ManagementInputError,
  managementList,
  saveManagedFarm,
  saveManagedTimer,
} from "./management";
import {
  buildCropPicker,
  buildDeleteConfirmation,
  buildManagementModal,
  parseManagementId,
} from "./management-view";

export type ManagementInteraction =
  | ButtonInteraction
  | StringSelectMenuInteraction
  | ModalSubmitInteraction;

export async function handleManagementInteraction(
  interaction: ManagementInteraction,
  database: typeof appDb,
  reportError: (error: unknown) => void,
) {
  const state = parseManagementId(interaction.customId);
  if (!state) return;
  if (!interaction.guildId || state.ownerId !== interaction.user.id) {
    await interaction.reply({
      content: "Open your own farm or timer list to manage your entries.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const scope = {
    database,
    guildId: interaction.guildId,
    ownerDiscordUserId: interaction.user.id,
  };
  try {
    if (
      interaction.isButton() &&
      state.kind === "timers" &&
      state.action === "add"
    ) {
      await interaction.deferUpdate();
      const catalog = await getCropCatalog(database);
      await interaction.editReply(
        buildCropPicker(
          state,
          catalog.entries.map((entry) => entry.item),
        ),
      );
      return;
    }
    if (
      interaction.isStringSelectMenu() &&
      state.kind === "timers" &&
      state.action === "pick-crop"
    ) {
      const cropId = Number(interaction.values[0]);
      const catalog = await getCropCatalog(database);
      const crop = catalog.entries.find(
        (entry) => entry.item.id === cropId,
      )?.item;
      if (!crop)
        throw new ManagementInputError(
          "That crop is no longer available. Open Add timer and choose another crop.",
        );
      await interaction.showModal(
        buildManagementModal(
          { ...state, id: undefined },
          { crop: String(crop.id) },
        ),
      );
      return;
    }
    if (
      interaction.isButton() &&
      (state.action === "add" || state.action === "edit")
    ) {
      const values: Record<string, string> = {};
      if (state.action === "edit") {
        if (!state.id) throw new ManagementInputError("Select an entry first.");
        if (state.kind === "farms") {
          const farm = await getManagedFarm(scope, state.id);
          Object.assign(values, {
            slug: farm.slug,
            name: farm.name,
            description: farm.description ?? "",
          });
        } else {
          const timer = await getManagedTimer(scope, state.id);
          Object.assign(values, {
            crop: String(timer.cropItemId),
            farm: timer.farm?.slug ?? "",
            note: timer.note ?? "",
          });
        }
      }
      await interaction.showModal(
        buildManagementModal(
          { ...state, id: state.action === "add" ? undefined : state.id },
          values,
        ),
      );
      return;
    }
    if (interaction.isModalSubmit()) {
      if (state.action !== "save" || !interaction.isFromMessage()) return;
      await interaction.deferUpdate();
      const fields =
        state.kind === "farms"
          ? ["slug", "name", "description"]
          : ["crop", "duration", "farm", "note"];
      const values = Object.fromEntries(
        fields.map((key) => [key, interaction.fields.getTextInputValue(key)]),
      );
      if (!interaction.channelId)
        throw new ManagementInputError(
          "Open the list inside a server channel.",
        );
      const saved =
        state.kind === "farms"
          ? await saveManagedFarm(scope, state.id, values)
          : await saveManagedTimer(
              scope,
              state.id,
              values,
              interaction.channelId,
            );
      await interaction.editReply(
        await managementList(
          scope,
          { ...state, id: saved.id },
          state.id
            ? "Changes saved."
            : `${state.kind === "farms" ? "Farm" : "Timer"} added.`,
        ),
      );
      return;
    }
    await interaction.deferUpdate();
    if (interaction.isStringSelectMenu() && state.action === "select") {
      const id = interaction.values[0];
      // Only IDs actually owned in this server can become actionable selections.
      const entries = await managementEntries(scope, state.kind);
      if (!entries.some((entry) => entry.id === id))
        throw new ManagementInputError(
          "This entry is no longer available. Refresh the list.",
        );
      await interaction.editReply(
        await managementList(scope, { ...state, id }),
      );
    } else if (interaction.isButton() && state.action === "delete") {
      const entry = (await managementEntries(scope, state.kind)).find(
        (entry) => entry.id === state.id,
      );
      if (!entry)
        throw new ManagementInputError(
          "This entry is no longer available. Refresh the list.",
        );
      await interaction.editReply(buildDeleteConfirmation(state, entry));
    } else if (interaction.isButton() && state.action === "confirm-delete") {
      await deleteManagedEntry(scope, state);
      await interaction.editReply(
        await managementList(
          scope,
          { ...state, id: undefined },
          state.kind === "farms"
            ? "Farm deleted. Existing timers will keep running."
            : "Timer deleted. Remaining reminders canceled.",
        ),
      );
    } else if (
      interaction.isButton() &&
      (state.action === "crop-prev" || state.action === "crop-next")
    ) {
      const catalog = await getCropCatalog(database);
      await interaction.editReply(
        buildCropPicker(
          state,
          catalog.entries.map((entry) => entry.item),
        ),
      );
    } else {
      await interaction.editReply(await managementList(scope, state));
    }
  } catch (error) {
    if (!(error instanceof ManagementInputError)) reportError(error);
    const content =
      error instanceof ManagementInputError
        ? error.message
        : "Could not finish that action. Refresh the list and try again.";
    // Keep the current list/form controls available when validation or persistence fails.
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({
        content,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
    } else {
      await interaction.reply({
        content,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
    }
  }
}
