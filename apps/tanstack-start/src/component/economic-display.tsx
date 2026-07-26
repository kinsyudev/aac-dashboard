export type PriceDisplay =
  | {
      status: "resolved";
      value: number;
      source: "Price Override" | "Market Data";
    }
  | { status: "missing"; itemName: string };

export function formatCompactGold(value: number) {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}g`;
}

export function describePrice(price: PriceDisplay) {
  if (price.status === "missing") {
    return { value: "Missing Price", detail: price.itemName, incomplete: true };
  }

  return {
    value: formatCompactGold(price.value),
    detail: price.source,
    incomplete: false,
  };
}
