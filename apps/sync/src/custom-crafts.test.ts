import assert from "node:assert/strict";
import { test } from "node:test";

import { CUSTOM_CRAFTS, customCraftItemIds } from "./custom-crafts";

void test("custom crafts use 200 of the material for 1,500 labor", () => {
  assert.deepEqual(
    CUSTOM_CRAFTS.map((craft) => [
      craft.product.itemId,
      craft.materials.map((material) => [material.itemId, material.amount]),
      craft.labor,
    ]),
    [
      [43131, [[43128, 200]], 1500],
      [43130, [[43129, 200]], 1500],
    ],
  );
});

void test("custom craft IDs are unique and outside the upstream range", () => {
  const ids = CUSTOM_CRAFTS.map((craft) => craft.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.ok(id >= 990_000_000 && id <= 2_147_483_647);
});

void test("custom craft item IDs cover products and materials once each", () => {
  assert.deepEqual(customCraftItemIds(CUSTOM_CRAFTS), [43131, 43128, 43130, 43129]);
});
