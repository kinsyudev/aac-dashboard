interface IndexEntry {
  id: number;
  name: string;
}

export const SUPPLEMENTAL_ITEM_INDEX = [
  { id: 9000121, name: "Ayanad Plate Small Mana Seal" },
] as const satisfies readonly IndexEntry[];

export const SUPPLEMENTAL_CRAFT_INDEX = [
  { id: 9000110, name: "Ayanad Plate Small Mana Seal" },
] as const satisfies readonly IndexEntry[];

const ITEM_NAME_OVERRIDES = new Map<number, string>(
  SUPPLEMENTAL_ITEM_INDEX.map((item) => [item.id, item.name]),
);

export function mergeSupplementalIndexEntries<T extends IndexEntry>(
  indexed: readonly T[],
  supplemental: readonly IndexEntry[],
): IndexEntry[] {
  return [
    ...new Map(
      [...indexed, ...supplemental].map((entry) => [entry.id, { ...entry }]),
    ).values(),
  ];
}

export function getSyncedItemName(itemId: number, upstreamName: string) {
  return ITEM_NAME_OVERRIDES.get(itemId) ?? upstreamName;
}
