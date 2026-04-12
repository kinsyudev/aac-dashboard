interface EntryWithProducts {
  products: { item: { id: number }; amount: number }[];
}

type EntryWithMaterials = EntryWithProducts & {
  materials: { item: { id: number }; amount: number }[];
};

export function pickPreferredCraft<T extends EntryWithProducts>(
  entries: T[],
  itemId: number,
): T {
  const preferred = [...entries].sort((a, b) => {
    const amt = (e: T) =>
      e.products.find((p) => p.item.id === itemId)?.amount ?? 999;
    return amt(a) - amt(b);
  })[0];

  if (!preferred) {
    throw new Error("No craft entries available");
  }

  return preferred;
}

export function pickCheapestCraft<T extends EntryWithMaterials>(
  entries: T[],
  itemId: number,
  getUnitCost: (entry: T, itemId: number) => number,
): T {
  const firstEntry = entries[0];
  if (!firstEntry) {
    throw new Error("No craft entries available");
  }

  return entries.reduce((best, entry) => {
    const bestCost = getUnitCost(best, itemId);
    const entryCost = getUnitCost(entry, itemId);
    if (entryCost !== bestCost) {
      return entryCost < bestCost ? entry : best;
    }

    const getProducedAmount = (candidate: T) =>
      candidate.products.find((product) => product.item.id === itemId)
        ?.amount ?? Number.POSITIVE_INFINITY;

    return getProducedAmount(entry) < getProducedAmount(best) ? entry : best;
  }, firstEntry);
}
