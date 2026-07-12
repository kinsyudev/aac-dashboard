import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  CraftEntryLike,
  ModesMap,
  SelectedCraftMap,
} from "./craft-optimizer.ts";
import { buildCraftRequirementSummary } from "./craft-optimizer.ts";

type TestEntry = CraftEntryLike & {
  materials: {
    item: { id: number; name: string; icon: string | null };
    amount: number;
  }[];
};

const priceMap = new Map([
  [100, { avg24h: "50", avg7d: null, avg30d: null }],
  [200, { avg24h: "9", avg7d: null, avg30d: null }],
  [300, { avg24h: "7", avg7d: null, avg30d: null }],
  [400, { avg24h: "2", avg7d: null, avg30d: null }],
  [500, { avg24h: "4", avg7d: null, avg30d: null }],
]);

const rootEntry: TestEntry = {
  craft: {
    id: 1,
    name: "Root Recipe",
    labor: 20,
    proficiency: "Alchemy",
  },
  materials: [
    { item: { id: 200, name: "Intermediate", icon: null }, amount: 3 },
    { item: { id: 300, name: "Direct Raw", icon: null }, amount: 1 },
  ],
  products: [{ item: { id: 100 }, amount: 2 }],
};

const childEntry: TestEntry = {
  craft: {
    id: 2,
    name: "Child Recipe",
    labor: 10,
    proficiency: "Metalwork",
  },
  materials: [{ item: { id: 400, name: "Ore", icon: null }, amount: 5 }],
  products: [{ item: { id: 200 }, amount: 4 }],
};

const alternateChildEntry: TestEntry = {
  craft: {
    id: 3,
    name: "Alternate Child Recipe",
    labor: 2,
    proficiency: "Metalwork",
  },
  materials: [
    { item: { id: 500, name: "Alternate Ore", icon: null }, amount: 2 },
  ],
  products: [{ item: { id: 200 }, amount: 1 }],
};

function summarize(options?: {
  modes?: ModesMap;
  selectedCrafts?: SelectedCraftMap;
  overrideMap?: Map<number, number>;
  proficiencyMap?: Map<string, number>;
}) {
  return buildCraftRequirementSummary({
    entry: rootEntry,
    producedItemId: 100,
    requiredQuantity: 3,
    subcraftMap: {
      200: [childEntry, alternateChildEntry],
    },
    modes: options?.modes ?? {},
    selectedCrafts: options?.selectedCrafts ?? {},
    priceMap,
    overrideMap: options?.overrideMap ?? new Map<number, number>(),
    proficiencyMap: options?.proficiencyMap ?? new Map<string, number>(),
  });
}

void test("flattens raw materials using ceil batches for root and crafted sub-ingredients", () => {
  const summary = summarize({
    modes: { 200: "craft" },
    selectedCrafts: { 200: 2 },
  });

  assert.equal(summary.batches, 2);
  assert.equal(summary.producedAmount, 2);
  assert.equal(summary.producedQuantity, 4);
  assert.deepEqual(
    summary.materials.map((material) => ({
      itemId: material.item.id,
      amount: material.totalAmount,
    })),
    [
      { itemId: 300, amount: 2 },
      { itemId: 400, amount: 10 },
    ],
  );
  assert.deepEqual(summary.laborByProficiency, [
    { proficiency: "Alchemy", labor: 40 },
    { proficiency: "Metalwork", labor: 20 },
  ]);
  assert.equal(summary.materialCost, 34);
  assert.equal(summary.totalLabor, 60);
});

void test("buy mode leaves craftable ingredients in the raw material list", () => {
  const summary = summarize({ modes: { 200: "buy" } });

  assert.deepEqual(
    summary.materials.map((material) => ({
      itemId: material.item.id,
      amount: material.totalAmount,
    })),
    [
      { itemId: 300, amount: 2 },
      { itemId: 200, amount: 6 },
    ],
  );
  assert.deepEqual(summary.laborByProficiency, [
    { proficiency: "Alchemy", labor: 40 },
  ]);
  assert.equal(summary.materialCost, 68);
});

void test("selected subcraft variants drive raw materials and labor", () => {
  const summary = summarize({
    modes: { 200: "craft" },
    selectedCrafts: { 200: 3 },
  });

  assert.deepEqual(
    summary.materials.map((material) => ({
      itemId: material.item.id,
      amount: material.totalAmount,
    })),
    [
      { itemId: 500, amount: 12 },
      { itemId: 300, amount: 2 },
    ],
  );
  assert.deepEqual(summary.laborByProficiency, [
    { proficiency: "Alchemy", labor: 40 },
    { proficiency: "Metalwork", labor: 12 },
  ]);
  assert.equal(summary.materialCost, 62);
});

void test("uses price overrides and discounted labor in the summary", () => {
  const summary = summarize({
    modes: { 200: "craft" },
    selectedCrafts: { 200: 2 },
    overrideMap: new Map([[400, 1]]),
    proficiencyMap: new Map([
      ["Alchemy", 230000],
      ["Metalwork", 50000],
    ]),
  });

  assert.deepEqual(summary.laborByProficiency, [
    { proficiency: "Alchemy", labor: 24 },
    { proficiency: "Metalwork", labor: 18 },
  ]);
  assert.equal(summary.materialCost, 24);
  assert.equal(summary.totalLabor, 42);
});
