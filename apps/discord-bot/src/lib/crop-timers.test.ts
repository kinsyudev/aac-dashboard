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
];

function expectMatchId(
  value: ReturnType<typeof resolveCropAlias>,
  expectedId: number,
) {
  assert.ok(value);
  assert.equal(value.kind, "match");
  assert.equal(value.item.id, expectedId);
}

test("strips ArcheAge color markup", () => {
  assert.equal(stripArcheAgeMarkup("|cFFFF9C275 h 43 m|r"), "5 h 43 m");
});

test("parses growth timers from item descriptions", () => {
  assert.equal(parseGrowthTimerSeconds(items[0]!.description), 43 * 60);
  assert.equal(parseGrowthTimerSeconds(items[1]!.description), 5 * 60 * 60 + 43 * 60);
  assert.equal(parseGrowthTimerSeconds(items[2]!.description), 2 * 60 * 60);
  assert.equal(parseGrowthTimerSeconds("No timer here"), null);
});

test("builds aliases for seed, bundle, and greenhouse items", () => {
  const aliases = buildCropAliases(items);

  expectMatchId(resolveCropAlias(aliases, "carrot"), 15661);
  expectMatchId(resolveCropAlias(aliases, "carrot seed"), 15661);
  expectMatchId(resolveCropAlias(aliases, "carrot bundle"), 26449);
  expectMatchId(resolveCropAlias(aliases, "carrot seed bundle"), 26449);
  expectMatchId(resolveCropAlias(aliases, "carrot greenhouse"), 35187);
});

test("rejects ambiguous aliases", () => {
  const aliases = buildCropAliases([
    ...items,
    { id: 1, name: "Blue Seed", description: "Matures in approx. 1 h" },
    { id: 2, name: "Blue Seed", description: "Matures in approx. 2 h" },
  ]);

  assert.equal(resolveCropAlias(aliases, "blue")?.kind, "ambiguous");
});
