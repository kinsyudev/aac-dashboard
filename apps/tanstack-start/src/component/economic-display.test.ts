import { describe, expect, it } from "vitest";

import { describePrice } from "~/component/economic-display";

describe("economic display", () => {
  it("names a Missing Price instead of presenting an unknown value as zero", () => {
    expect(
      describePrice({ status: "missing", itemName: "Sturdy Ingot" }),
    ).toEqual({
      value: "Missing Price",
      detail: "Sturdy Ingot",
      incomplete: true,
    });
  });

  it.each(["Price Override", "Market Data"] as const)(
    "identifies %s as the source of a resolved price",
    (source) => {
      expect(
        describePrice({ status: "resolved", value: 12.5, source }),
      ).toEqual({
        value: "12.5g",
        detail: source,
        incomplete: false,
      });
    },
  );
});
