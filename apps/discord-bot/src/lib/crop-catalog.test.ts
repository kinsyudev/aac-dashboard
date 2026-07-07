import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCropCatalog,
  findCropSuggestions,
  resolveCatalogItem,
} from "./crop-catalog";

const items = [
  {
    id: 15661,
    name: "Carrot Seed",
    description: "Matures in approx. 43 m",
  },
  {
    id: 35301,
    name: "Radiant Archeum Tree Sapling",
    description: "Matures in approx. 16 h",
  },
  {
    id: 15983,
    name: "Regrade Brazier",
    description: "Matures in approx. 12 h",
  },
];

void test("autocomplete returns exact alias suggestions", () => {
  const catalog = buildCropCatalog(items);

  assert.deepEqual(findCropSuggestions(catalog, "radiant archeum tree"), [
    { name: "Radiant Archeum Tree Sapling", value: "Radiant Archeum Tree Sapling" },
  ]);
  assert.deepEqual(findCropSuggestions(catalog, "regrade"), [
    { name: "Regrade Brazier", value: "Regrade Brazier" },
  ]);
});

void test("autocomplete returns fuzzy matches for small typos", () => {
  const catalog = buildCropCatalog(items);

  assert.deepEqual(findCropSuggestions(catalog, "regrade brzier"), [
    { name: "Regrade Brazier", value: "Regrade Brazier" },
  ]);
});

void test("autocomplete can suggest plantables without parseable timer text", () => {
  const catalog = buildCropCatalog([
    {
      id: 15983,
      name: "Regrade Brazier",
      description: "Places a Regrade Brazier imbued with the magic of Auroria.",
    },
  ]);

  assert.deepEqual(findCropSuggestions(catalog, "regrade"), [
    { name: "Regrade Brazier", value: "Regrade Brazier" },
  ]);
});

void test("empty autocomplete query falls back to alphabetical suggestions", () => {
  const catalog = buildCropCatalog(items);

  assert.deepEqual(findCropSuggestions(catalog, ""), [
    { name: "Carrot Seed", value: "Carrot Seed" },
    { name: "Radiant Archeum Tree Sapling", value: "Radiant Archeum Tree Sapling" },
    { name: "Regrade Brazier", value: "Regrade Brazier" },
  ]);
});

void test("catalog resolution supports exact alias matches even without timer text", () => {
  const catalog = buildCropCatalog([
    {
      id: 15983,
      name: "Regrade Brazier",
      description: "Places a Regrade Brazier imbued with the magic of Auroria.",
    },
  ]);

  const result = resolveCatalogItem(catalog, "regrade brazier");
  assert.ok(result);
  assert.equal(result.kind, "match");
  assert.equal(result.item.id, 15983);
});
