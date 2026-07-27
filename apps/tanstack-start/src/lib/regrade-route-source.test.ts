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

void test("regrade rerolls use the shared reseal expectation", () => {
  const source = readFileSync(
    new URL("../routes/regrade.tsx", import.meta.url),
    "utf8",
  );

  assert.equal(source.match(/getExpectedResealRetries\(/g)?.length, 2);
});

void test("outcome breakdown separates conditional results from EV contribution", () => {
  const source = readFileSync(
    new URL("../routes/regrade.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /label="Cost if outcome"/);
  assert.match(source, /label="Profit if outcome"/);
  assert.match(source, /label="EV contribution"/);
  assert.match(source, /entry\.expectedCostGold \/ entry\.probability/);
  assert.match(source, /entry\.saleValueGold - costIfOutcome/);
  assert.match(
    source,
    /Probability multiplied by Profit if outcome\. All contributions add up to total EV\./,
  );
});
