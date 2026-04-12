type EntryWithProducts = {
  products: Array<{ item: { id: number }; amount: number }>;
};

type EntryWithMaterials = EntryWithProducts & {
  materials: Array<{ item: { id: number }; amount: number }>;
};

export function pickPreferredCraft<T extends EntryWithProducts>(
  entries: T[],
  itemId: number,
): T {
  return [...entries].sort((a, b) => {
    const amt = (e: T) =>
      e.products.find((p) => p.item.id === itemId)?.amount ?? 999;
    return amt(a) - amt(b);
  })[0]!;
}

export function pickCheapestCraft<T extends EntryWithMaterials>(
  entries: T[],
  itemId: number,
  getUnitCost: (entry: T, itemId: number) => number,
): T {
  return entries.reduce((best, entry) => {
    if (!best) return entry;

    const bestCost = getUnitCost(best, itemId);
    const entryCost = getUnitCost(entry, itemId);
    if (entryCost !== bestCost) {
      return entryCost < bestCost ? entry : best;
    }

    const getProducedAmount = (candidate: T) =>
      candidate.products.find((product) => product.item.id === itemId)?.amount ??
      Number.POSITIVE_INFINITY;

    return getProducedAmount(entry) < getProducedAmount(best) ? entry : best;
  }, entries[0]!);
}
