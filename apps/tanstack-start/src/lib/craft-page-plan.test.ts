import assert from "node:assert/strict";
import { test } from "node:test";

import type { CraftEntryLike } from "./craft-optimizer.ts";
import { buildCraftPagePlan } from "./craft-page-plan.ts";

type Entry = CraftEntryLike & {
  materials: { item: { id: number; name: string }; amount: number }[];
};

const root: Entry = {
  craft: { id: 1, name: "Faint Memory", labor: 25, proficiency: null },
  materials: [{ item: { id: 2, name: "Mossy Pool" }, amount: 3 }],
  products: [{ item: { id: 1 }, amount: 10 }],
};
const mossyPool: Entry = {
  craft: { id: 2, name: "Mossy Pool", labor: 4, proficiency: null },
  materials: [{ item: { id: 3, name: "Water" }, amount: 2 }],
  products: [{ item: { id: 2 }, amount: 2 }],
};

void test("plans whole root and nested Crafts from an explicit Craft count", () => {
  const plan = buildCraftPagePlan({
    rootEntry: root,
    rootItemId: 1,
    craftCount: 2,
    subcraftMap: { 2: [mossyPool] },
    modes: { 2: "craft" },
    selectedCrafts: { 2: 2 },
    priceMap: new Map([[3, { avg24h: "5", avg7d: null, avg30d: null }]]),
    overrideMap: new Map(),
    proficiencyMap: new Map(),
    salePrice: 20,
    focusPath: [1, 2],
  });

  assert.equal(plan.craftCount, 2);
  assert.equal(plan.summary.totalOutput, 20);
  assert.equal(plan.summary.craftCost, 30);
  assert.equal(plan.summary.totalLabor, 62);
  assert.equal(plan.summary.costPerItem, 1.5);
  assert.equal(plan.focused.itemId, 2);
  assert.deepEqual(
    plan.breadcrumb.map((level) => level.itemId),
    [1, 2],
  );
});

void test("marks a Plan incomplete instead of pricing an unpriced Material at zero", () => {
  const plan = buildCraftPagePlan({
    rootEntry: root,
    rootItemId: 1,
    craftCount: 1,
    subcraftMap: {},
    modes: {},
    selectedCrafts: {},
    priceMap: new Map(),
    overrideMap: new Map(),
    proficiencyMap: new Map(),
    focusPath: [1],
  });

  assert.equal(plan.summary.craftCost, null);
  assert.deepEqual(plan.summary.missingPriceItems, ["Mossy Pool"]);
});
