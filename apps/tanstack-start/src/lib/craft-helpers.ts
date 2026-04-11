type EntryWithProducts = {
  products: Array<{ item: { id: number }; amount: number }>;
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
