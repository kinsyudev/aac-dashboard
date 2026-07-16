import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getSyncedItemName,
  mergeSupplementalIndexEntries,
  SUPPLEMENTAL_CRAFT_INDEX,
  SUPPLEMENTAL_ITEM_INDEX,
} from "./sync-items-supplements";

void test("supplemental indexes include the unindexed Ayanad plate small seal", () => {
  assert.deepEqual(SUPPLEMENTAL_ITEM_INDEX, [
    { id: 9000121, name: "Ayanad Plate Small Mana Seal" },
  ]);
  assert.deepEqual(SUPPLEMENTAL_CRAFT_INDEX, [
    { id: 9000110, name: "Ayanad Plate Small Mana Seal" },
  ]);
});

void test("supplemental entries merge by ID and override malformed index names", () => {
  assert.deepEqual(
    mergeSupplementalIndexEntries(
      [
        { id: 1, name: "Normal" },
        { id: 9000121, name: "Ayanad Plate Small Small Seal" },
      ],
      SUPPLEMENTAL_ITEM_INDEX,
    ),
    [
      { id: 1, name: "Normal" },
      { id: 9000121, name: "Ayanad Plate Small Mana Seal" },
    ],
  );
});

void test("item detail normalization fixes the upstream double-Small typo", () => {
  assert.equal(
    getSyncedItemName(9000121, "Ayanad Plate Small Small Seal"),
    "Ayanad Plate Small Mana Seal",
  );
  assert.equal(getSyncedItemName(1, "Normal"), "Normal");
});
