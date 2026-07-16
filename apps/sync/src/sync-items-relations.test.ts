import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dedupeCraftMaterials,
  dedupeCraftProducts,
} from "./sync-items-relations";

void test("duplicate upstream craft materials collapse to one database row", () => {
  assert.deepEqual(
    dedupeCraftMaterials([
      { craftId: 9444, itemId: 500, amount: 1 },
      { craftId: 9444, itemId: 500, amount: 1 },
      { craftId: 9444, itemId: 16327, amount: 5 },
    ]),
    [
      { craftId: 9444, itemId: 500, amount: 1 },
      { craftId: 9444, itemId: 16327, amount: 5 },
    ],
  );
});

void test("duplicate upstream craft products collapse to one database row", () => {
  assert.deepEqual(
    dedupeCraftProducts([
      { craftId: 10, itemId: 20, amount: 1, rate: 100 },
      { craftId: 10, itemId: 20, amount: 1, rate: 100 },
    ]),
    [{ craftId: 10, itemId: 20, amount: 1, rate: 100 }],
  );
});

void test("conflicting duplicate relations fail instead of silently losing data", () => {
  assert.throws(
    () =>
      dedupeCraftMaterials([
        { craftId: 9444, itemId: 500, amount: 1 },
        { craftId: 9444, itemId: 500, amount: 2 },
      ]),
    /Conflicting duplicate craft material 9444:500/,
  );
  assert.throws(
    () =>
      dedupeCraftProducts([
        { craftId: 10, itemId: 20, amount: 1, rate: 100 },
        { craftId: 10, itemId: 20, amount: 2, rate: 100 },
      ]),
    /Conflicting duplicate craft product 10:20/,
  );
});
