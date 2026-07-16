import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseCraftRefreshSelection,
  selectCraftsToSync,
} from "./sync-items-options";

const crafts = [
  { id: 10, name: "Existing" },
  { id: 20, name: "New" },
  { id: 30, name: "Also existing" },
];
const existingIds = new Set([10, 30]);

void test("default sync selects only missing crafts", () => {
  assert.deepEqual(
    selectCraftsToSync(crafts, existingIds, parseCraftRefreshSelection([])).map(
      (craft) => craft.id,
    ),
    [20],
  );
});

void test("bare refresh option selects every upstream craft", () => {
  assert.deepEqual(
    selectCraftsToSync(
      crafts,
      existingIds,
      parseCraftRefreshSelection(["--refresh-crafts"]),
    ).map((craft) => craft.id),
    [10, 20, 30],
  );
});

void test("targeted refresh selects only requested upstream craft IDs", () => {
  const selection = parseCraftRefreshSelection(["--refresh-crafts=30, 10,30"]);
  assert.deepEqual(
    selectCraftsToSync(crafts, existingIds, selection).map((craft) => craft.id),
    [10, 30],
  );
});

void test("refresh rejects malformed craft IDs", () => {
  assert.throws(
    () => parseCraftRefreshSelection(["--refresh-crafts=10,nope"]),
    /comma-separated list of craft IDs/,
  );
  assert.throws(
    () => parseCraftRefreshSelection(["--refresh-crafts="]),
    /comma-separated list of craft IDs/,
  );
});
