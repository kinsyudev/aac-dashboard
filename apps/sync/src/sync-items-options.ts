export interface CraftIndexEntry {
  id: number;
  name: string;
}

export type CraftRefreshSelection =
  | { kind: "missing" }
  | { kind: "all" }
  | { kind: "ids"; ids: ReadonlySet<number> };

export function parseCraftRefreshSelection(
  args: readonly string[],
): CraftRefreshSelection {
  const refreshArgs = args.filter(
    (arg) => arg === "--refresh-crafts" || arg.startsWith("--refresh-crafts="),
  );

  if (refreshArgs.length === 0) return { kind: "missing" };
  if (refreshArgs.length > 1) {
    throw new Error("Pass --refresh-crafts at most once");
  }

  const refreshArg = refreshArgs[0];
  if (refreshArg === "--refresh-crafts") return { kind: "all" };

  const rawIds = refreshArg?.slice("--refresh-crafts=".length) ?? "";
  const parts = rawIds.split(",").map((part) => part.trim());
  if (parts.length === 0 || parts.some((part) => !/^\d+$/.test(part))) {
    throw new Error(
      "--refresh-crafts must be empty or a comma-separated list of craft IDs",
    );
  }

  const ids = new Set(parts.map(Number));
  if ([...ids].some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error("--refresh-crafts IDs must be positive safe integers");
  }

  return { kind: "ids", ids };
}

export function selectCraftsToSync<T extends CraftIndexEntry>(
  remoteCrafts: readonly T[],
  existingCraftIds: ReadonlySet<number>,
  selection: CraftRefreshSelection,
): T[] {
  if (selection.kind === "all") return [...remoteCrafts];
  if (selection.kind === "ids") {
    return remoteCrafts.filter((craft) => selection.ids.has(craft.id));
  }
  return remoteCrafts.filter((craft) => !existingCraftIds.has(craft.id));
}
