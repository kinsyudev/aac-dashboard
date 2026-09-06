import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCropAliases,
  parseGrowthTimerSeconds,
  resolveCropAlias,
  stripArcheAgeMarkup,
} from "./crop-timers";

const items = [
  {
    id: 15661,
    name: "Carrot Seed",
    description:
      "Plants a |cFFf5CB65carrot seed|r.\n\nMatures in approx. 43 m\nClimate: Temperate",
  },
  {
    id: 26449,
    name: "Carrot Seed Bundle",
    description:
      "Plants a bundle of carrot seeds.\n\nMatures in approx. |cFFFF9C275 h 43 m|r\nClimate: Temperate",
  },
  {
    id: 35187,
    name: "Carrot Greenhouse",
    description:
      "Plants a greenhouse.\n\nMatures in approx. |cFFFF9C272 h|r",
  },
  {
    id: 15664,
    name: "Cucumber Seed",
    description: "Matures in approx. 10 m",
  },
  {
    id: 40001,
    name: "Radiant Archeum Tree Sapling",
    description: "Can be planted.\n\nMatures in approx. 16 h",
  },
  {
    id: 40002,
    name: "Regrade Brazier",
    description: "Can be placed.\n\nMatures in approx. 12 h",
  },
];

function getItemDescription(index: number) {
  const item = items[index];
  assert.ok(item);
  return item.description;
}

function expectMatchId(
  value: ReturnType<typeof resolveCropAlias>,
  expectedId: number,
) {
  assert.ok(value);
  assert.equal(value.kind, "match");
  assert.equal(value.item.id, expectedId);
}

void test("strips ArcheAge color markup", () => {
  assert.equal(stripArcheAgeMarkup("|cFFFF9C275 h 43 m|r"), "5 h 43 m");
});

void test("parses growth timers from item descriptions", () => {
  assert.equal(parseGrowthTimerSeconds(getItemDescription(0)), 43 * 60);
  assert.equal(
    parseGrowthTimerSeconds(getItemDescription(1)),
    5 * 60 * 60 + 43 * 60,
  );
  assert.equal(parseGrowthTimerSeconds(getItemDescription(2)), 2 * 60 * 60);
  assert.equal(parseGrowthTimerSeconds("No timer here"), null);
  assert.equal(parseGrowthTimerSeconds("Matures in approx. 5h43m"), 5 * 3600 + 43 * 60);
});

void test("builds aliases for seed, bundle, and greenhouse items", () => {
  const aliases = buildCropAliases(items);

  expectMatchId(resolveCropAlias(aliases, "carrot"), 15661);
  expectMatchId(resolveCropAlias(aliases, "carrot seed"), 15661);
  expectMatchId(resolveCropAlias(aliases, "carrot bundle"), 26449);
  expectMatchId(resolveCropAlias(aliases, "carrot seed bundle"), 26449);
  expectMatchId(resolveCropAlias(aliases, "carrot greenhouse"), 35187);
  expectMatchId(resolveCropAlias(aliases, "radiant archeum tree"), 40001);
  expectMatchId(resolveCropAlias(aliases, "radiant archeum tree sapling"), 40001);
  expectMatchId(resolveCropAlias(aliases, "regrade"), 40002);
  expectMatchId(resolveCropAlias(aliases, "regrade brazier"), 40002);
});

void test("rejects ambiguous aliases", () => {
  const aliases = buildCropAliases([
    ...items,
    { id: 1, name: "Blue Seed", description: "Matures in approx. 1 h" },
    { id: 2, name: "Blue Seed", description: "Matures in approx. 2 h" },
  ]);

  assert.equal(resolveCropAlias(aliases, "blue")?.kind, "ambiguous");
});
