import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseSimulatorCraftModePreferences,
  parseSimulatorRecipePreferences,
  pickPreferredSimulatorRecipe,
  serializeSimulatorCraftModePreferences,
  serializeSimulatorRecipePreferences,
} from "./simulator-recipe-preferences.ts";

const entries = [
  { craft: { id: 10 }, cost: 30 },
  { craft: { id: 20 }, cost: 15 },
  { craft: { id: 30 }, cost: 25 },
];

void test("parseSimulatorRecipePreferences ignores invalid JSON", () => {
  assert.deepEqual(parseSimulatorRecipePreferences("{bad json"), {});
});

void test("parseSimulatorRecipePreferences keeps only finite numeric craft ids", () => {
  assert.deepEqual(
    parseSimulatorRecipePreferences(
      JSON.stringify({
        cloth: 10,
        leather: "20",
        plate: null,
        wooden: Number.NaN,
        musical: 30.5,
      }),
    ),
    { cloth: 10, leather: 20, musical: 30.5 },
  );
});

void test("serializeSimulatorRecipePreferences writes stable JSON", () => {
  assert.equal(
    serializeSimulatorRecipePreferences({ leather: 20, cloth: 10 }),
    JSON.stringify({ cloth: 10, leather: 20 }),
  );
});

void test("parseSimulatorCraftModePreferences keeps only integer item ids and valid modes", () => {
  assert.deepEqual(
    parseSimulatorCraftModePreferences(
      JSON.stringify({
        plate: {
          10: "buy",
          20: "craft",
          nope: "buy",
          30: "invalid",
        },
        cloth: [],
        leather: "bad",
      }),
    ),
    { plate: { 10: "buy", 20: "craft" } },
  );
});

void test("serializeSimulatorCraftModePreferences writes stable JSON", () => {
  assert.equal(
    serializeSimulatorCraftModePreferences({
      plate: { 20: "craft", 10: "buy" },
      cloth: {},
    }),
    JSON.stringify({ plate: { 10: "buy", 20: "craft" } }),
  );
});

void test("pickPreferredSimulatorRecipe uses saved craft id when present", () => {
  const result = pickPreferredSimulatorRecipe(
    entries,
    "cloth",
    { cloth: 30 },
    (entry) => entry.cost,
  );

  assert.ok(result);
  assert.equal(result.selected.craft.id, 30);
  assert.equal(result.cheapest.craft.id, 20);
  assert.equal(result.source, "saved");
});

void test("pickPreferredSimulatorRecipe falls back to cheapest when saved craft id is missing", () => {
  const result = pickPreferredSimulatorRecipe(
    entries,
    "cloth",
    { cloth: 999 },
    (entry) => entry.cost,
  );

  assert.ok(result);
  assert.equal(result.selected.craft.id, 20);
  assert.equal(result.cheapest.craft.id, 20);
  assert.equal(result.source, "cheapest");
});
