import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

void test("CraftModeToggle buttons are non-submit buttons", () => {
  const source = readFileSync(
    new URL("./recipe-breakdown.tsx", import.meta.url),
    "utf8",
  );
  const toggleSource = source.slice(
    source.indexOf("export function CraftModeToggle"),
    source.indexOf("export function RecipeItemRow"),
  );

  assert.equal(toggleSource.match(/type="button"/g)?.length, 2);
  assert.equal(toggleSource.match(/event\.preventDefault\(\)/g)?.length, 2);
});
