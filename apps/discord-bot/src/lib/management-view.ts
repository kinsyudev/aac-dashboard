import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  escapeMarkdown,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

export type ManagementKind = "farms" | "timers";
export interface ManagementState {
  kind: ManagementKind;
  ownerId: string;
  page: number;
  id?: string;
}
export interface ManagementEntry {
  id: string;
  name: string;
  summary: string;
  detail: string;
}

export interface CropPickerEntry {
  id: number;
  name: string;
}

const PAGE_SIZE = 10;
export const managementId = (state: ManagementState, action: string) =>
  `manage:${state.kind}:${state.ownerId}:${state.page}:${action}:${state.id ?? ""}`;

export function parseManagementId(value: string) {
  const match =
    /^manage:(farms|timers):(\d{1,20}):(\d{1,6}):([a-z-]+):([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})?$/.exec(
      value,
    );
  if (!match) return null;
  const [, kind, ownerId, page, action, id] = match;
  if (kind == null || ownerId == null || page == null || action == null)
    return null;
  return {
    kind: kind as ManagementKind,
    ownerId,
    page: Number(page),
    action,
    id,
  };
}

export function managementButton(
  state: ManagementState,
  action: string,
  label: string,
  style = ButtonStyle.Secondary,
) {
  return new ButtonBuilder()
    .setCustomId(managementId(state, action))
    .setLabel(label)
    .setStyle(style);
}

export function displayText(value: string, limit = 200) {
  return escapeMarkdown(value.replaceAll(/\s+/g, " ").slice(0, limit));
}

export function buildManagementList(
  input: ManagementState,
  entries: ManagementEntry[],
  notice?: string,
) {
  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const state = {
    ...input,
    id: undefined,
    page: Math.max(0, Math.min(input.page, pages - 1)),
  };
  const visible = entries.slice(
    state.page * PAGE_SIZE,
    (state.page + 1) * PAGE_SIZE,
  );
  const selected = entries.find((entry) => entry.id === input.id);
  const embed = new EmbedBuilder()
    .setTitle(state.kind === "farms" ? "Your farms" : "Your active timers")
    .setColor(0x22c55e)
    .setDescription(
      visible.length
        ? visible.map((entry) => entry.summary).join("\n")
        : `No ${state.kind} yet. Use Add ${state.kind === "farms" ? "farm" : "timer"} to get started.`,
    )
    .setFooter({
      text: `Page ${state.page + 1}/${pages} · ${entries.length} ${state.kind}`,
    });
  if (selected)
    embed.addFields({
      name: "Selected",
      value: selected.detail.slice(0, 1024),
    });

  const components: (
    | ActionRowBuilder<ButtonBuilder>
    | ActionRowBuilder<StringSelectMenuBuilder>
  )[] = [];
  if (visible.length) {
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(managementId(state, "select"))
          .setPlaceholder(
            `Select a ${state.kind === "farms" ? "farm" : "timer"} to manage`,
          )
          .addOptions(
            visible.map((entry) => ({
              label: entry.name.slice(0, 100),
              value: entry.id,
              default: entry.id === selected?.id,
            })),
          ),
      ),
    );
  }
  const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
    managementButton(
      state,
      "add",
      state.kind === "farms" ? "Add farm" : "Add timer",
      ButtonStyle.Success,
    ),
  );
  if (selected)
    actions.addComponents(
      managementButton(
        { ...state, id: selected.id },
        "edit",
        "Edit",
        ButtonStyle.Primary,
      ),
      managementButton(
        { ...state, id: selected.id },
        "delete",
        "Delete",
        ButtonStyle.Danger,
      ),
    );
  actions.addComponents(managementButton(state, "list", "Refresh"));
  components.push(actions);
  components.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      managementButton(
        { ...state, page: Math.max(0, state.page - 1) },
        "list",
        "Previous",
      ).setDisabled(state.page === 0),
      managementButton(
        { ...state, page: state.page + 1 },
        "list",
        "Next",
      ).setDisabled(state.page === pages - 1),
      managementButton(
        {
          ...state,
          kind: state.kind === "farms" ? "timers" : "farms",
          page: 0,
        },
        "list",
        state.kind === "farms" ? "Timers" : "Farms",
      ),
    ),
  );
  return {
    ...(notice ? { content: notice } : {}),
    embeds: [embed],
    components,
    allowedMentions: { parse: [] as const },
  };
}

export function buildCropPicker(
  input: ManagementState,
  crops: CropPickerEntry[],
) {
  const pages = Math.max(1, Math.ceil(crops.length / 25));
  const state = {
    ...input,
    id: undefined,
    page: Math.max(0, Math.min(input.page, pages - 1)),
  };
  const visible = crops.slice(state.page * 25, (state.page + 1) * 25);
  const picker = new StringSelectMenuBuilder()
    .setCustomId(managementId(state, "pick-crop"))
    .setPlaceholder("Choose a crop")
    .addOptions(
      visible.map((crop) => ({
        label: crop.name.slice(0, 100),
        value: String(crop.id),
      })),
    );

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Choose a crop")
        .setDescription("Type to find a crop on this page, then select it.")
        .setColor(0x22c55e)
        .setFooter({ text: `Crop suggestions ${state.page + 1}/${pages}` }),
    ],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(picker),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        managementButton(
          { ...state, page: Math.max(0, state.page - 1) },
          "crop-prev",
          "Previous",
        ).setDisabled(state.page === 0),
        managementButton(
          { ...state, page: state.page + 1 },
          "crop-next",
          "Next",
        ).setDisabled(state.page === pages - 1),
        managementButton({ ...state, kind: "timers", page: 0 }, "list", "Back"),
      ),
    ],
    allowedMentions: { parse: [] as const },
  };
}

export function buildDeleteConfirmation(
  state: ManagementState,
  entry: ManagementEntry,
) {
  return {
    content: `Delete **${displayText(entry.name, 100)}**? ${
      state.kind === "farms"
        ? "Farm defaults and crop overrides will be removed. Existing timers will keep running without a farm."
        : "This cancels the timer and stops its remaining reminders."
    }`,
    embeds: [],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        managementButton(state, "confirm-delete", "Delete", ButtonStyle.Danger),
        managementButton(state, "list", "Keep it"),
      ),
    ],
    allowedMentions: { parse: [] as const },
  };
}

export function buildManagementModal(
  state: ManagementState,
  values: Record<string, string> = {},
) {
  const editing = state.id != null;
  const fields =
    state.kind === "farms"
      ? [
          {
            key: "slug",
            label: "Farm slug",
            required: true,
            max: 80,
            placeholder: "main-farm",
          },
          {
            key: "name",
            label: "Display name",
            required: false,
            max: 100,
            placeholder: "Main farm",
          },
          {
            key: "description",
            label: "Notes or location",
            required: false,
            max: 500,
            placeholder: "",
          },
        ]
      : [
          {
            key: "crop",
            label: "Crop name or item ID",
            required: true,
            max: 100,
            placeholder: "Potato Seed",
          },
          {
            key: "duration",
            label: editing
              ? "Time from now (blank keeps timer)"
              : "Duration (blank uses farm/game default)",
            required: false,
            max: 50,
            placeholder: "45m, 1h 30m, or 2d 4h",
          },
          {
            key: "farm",
            label: "Farm slug (optional)",
            required: false,
            max: 80,
            placeholder: "main-farm",
          },
          {
            key: "note",
            label: "Note",
            required: false,
            max: 500,
            placeholder: "",
          },
        ];
  return new ModalBuilder()
    .setCustomId(managementId(state, "save"))
    .setTitle(
      `${editing ? "Edit" : "Add"} ${state.kind === "farms" ? "farm" : "timer"}`,
    )
    .addComponents(
      fields.map((field) => {
        const input = new TextInputBuilder()
          .setCustomId(field.key)
          .setLabel(field.label)
          .setStyle(
            field.key === "note" || field.key === "description"
              ? TextInputStyle.Paragraph
              : TextInputStyle.Short,
          )
          .setRequired(field.required)
          .setMaxLength(field.max);
        if (field.placeholder) input.setPlaceholder(field.placeholder);
        const value = values[field.key];
        if (value) input.setValue(value.slice(0, field.max));
        return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
      }),
    );
}
