export interface CraftMaterialRow {
  craftId: number;
  itemId: number;
  amount: number;
}

export interface CraftProductRow extends CraftMaterialRow {
  rate: number;
}

function relationKey(row: Pick<CraftMaterialRow, "craftId" | "itemId">) {
  return `${row.craftId}:${row.itemId}`;
}

export function dedupeCraftMaterials<T extends CraftMaterialRow>(
  rows: readonly T[],
): T[] {
  const unique = new Map<string, T>();
  for (const row of rows) {
    const key = relationKey(row);
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, row);
      continue;
    }
    if (existing.amount !== row.amount) {
      throw new Error(
        `Conflicting duplicate craft material ${key}: amounts ${existing.amount} and ${row.amount}`,
      );
    }
  }
  return [...unique.values()];
}

export function dedupeCraftProducts<T extends CraftProductRow>(
  rows: readonly T[],
): T[] {
  const unique = new Map<string, T>();
  for (const row of rows) {
    const key = relationKey(row);
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, row);
      continue;
    }
    if (existing.amount !== row.amount || existing.rate !== row.rate) {
      throw new Error(
        `Conflicting duplicate craft product ${key}: values ${existing.amount}@${existing.rate} and ${row.amount}@${row.rate}`,
      );
    }
  }
  return [...unique.values()];
}
