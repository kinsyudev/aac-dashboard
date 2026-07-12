import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

void test("resplendent scroll recipe nests the same preferred normal scroll craft", () => {
  const source = readFileSync(
    new URL("../routes/regrade.tsx", import.meta.url),
    "utf8",
  );
  const builderSource = source.slice(
    source.indexOf("function buildResplendentScrollRightClickCraftData"),
    source.indexOf("function buildRegradeConsumableCraftItem"),
  );

  assert.match(builderSource, /pickPreferredRegradeConsumableCraft\(/);
  assert.match(
    builderSource,
    /\[recipe\.normalScroll\.id\]: normalScrollCraft \? \[normalScrollCraft\] : \[\]/,
  );
});
