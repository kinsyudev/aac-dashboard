import assert from "node:assert/strict";
import test from "node:test";

import {
  findFarmSuggestions,
  getPlantAutocompleteSuggestions,
} from "./plant-autocomplete";

void test("plant autocomplete loads farm suggestions when farm is focused", async () => {
  const requested: string[] = [];
  const suggestions = await getPlantAutocompleteSuggestions(
    { focusedName: "farm", query: "main" },
    {
      crops: () => Promise.resolve([]),
      farms: (query) => {
        requested.push(query);
        return Promise.resolve([{ name: "Main Farm", value: "main-farm" }]);
      },
    },
  );

  assert.deepEqual(requested, ["main"]);
  assert.deepEqual(suggestions, [{ name: "Main Farm", value: "main-farm" }]);
});

void test("farm suggestions match names and slugs and preserve the slug value", () => {
  assert.deepEqual(
    findFarmSuggestions(
      [
        { name: "Main Farm", slug: "home" },
        { name: "Ocean Plot", slug: "main-island" },
        { name: "Hidden Plot", slug: "hidden" },
      ],
      "main",
    ),
    [
      { name: "Main Farm (home)", value: "home" },
      { name: "Ocean Plot (main-island)", value: "main-island" },
    ],
  );
});
