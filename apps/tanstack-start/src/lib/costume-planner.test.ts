import assert from "node:assert/strict";
import { test } from "node:test";

import {
  compareCurrentItem,
  compareCurrentStrategy,
  estimateBaseItemCost,
  estimateExpectedRerolls,
  getAvailableStatIds,
  getPlannerStats,
  GRADES,
  inferSubtype,
  planOptimalStrategy,
  planTargetRoute,
} from "./costume-planner.ts";

const prices = {
  clearSynthiumStone: 10,
  vividSynthiumStone: 20,
  lucidSynthiumStone: 40,
  radiantSynthiumStone: 80,
  charcoalStabilizer: 1,
  misagonsCrystal: 5,
  serendipityStone: 300,
  brilliantMornstone: 1,
};

const expectedCostumeStats = {
  "Physical Defense": "grand",
  "Magic Defense": "grand",
  "Max Health": "grand",
  "Move Speed": "grand",
  "Stealth Detection": "grand",
  "PvE Magic Skills": "grand",
  "PvE Melee Skills": "grand",
  "PvE Ranged Skills": "grand",
  "Backstab Melee Damage": "grand",
  "Backstab Magic Damage": "grand",
  "Backstab Ranged Damage": "grand",
  "Received Damage": "grand",
  "Melee Attack": "arcane",
  "Ranged Attack": "arcane",
  "Magic Attack": "arcane",
  "Healing Power": "arcane",
  "PvE Damage Reduction": "arcane",
  "Received Healing": "arcane",
  "Cast Time": "arcane",
  Evasion: "unique",
  "Parry Rate": "unique",
  "Shield Block Rate": "unique",
  Resilience: "unique",
  Toughness: "unique",
  Focus: "unique",
  "Defense Penetration": "celestial",
  "Magic Defense Penetration": "celestial",
  "Received Magic Damage": "divine",
  "Received Melee Damage": "divine",
  "Received Ranged Damage": "divine",
  "Magic Critical Damage": "divine",
  "Melee Critical Damage": "divine",
  "Ranged Critical Damage": "divine",
  "Critical Heal Bonus": "divine",
  "Melee Skill Damage": "epic",
  "Magic Skill Damage": "epic",
  "Ranged Skill Damage": "epic",
  Healing: "epic",
  "Melee Critical Rate": "legendary",
  "Magic Critical Rate": "legendary",
  "Ranged Critical Rate": "legendary",
  "Critical Heal Rate": "legendary",
} as const;

const expectedUndergarmentStats = {
  "Physical Defense": "grand",
  "Magic Defense": "grand",
  "Max Health": "grand",
  "Melee Attack": "grand",
  "Ranged Attack": "grand",
  "Magic Attack": "grand",
  "Healing Power": "grand",
  "Backstab Melee Damage": "grand",
  "Backstab Magic Damage": "grand",
  "Backstab Ranged Damage": "grand",
  Resilience: "arcane",
  Toughness: "arcane",
  Focus: "arcane",
  "Defense Penetration": "arcane",
  "Magic Defense Penetration": "arcane",
  "Received Magic Damage": "unique",
  "Received Melee Damage": "unique",
  "Received Ranged Damage": "unique",
  "Shield Defense Penetration Rate": "unique",
  "Melee Skill Damage": "divine",
  "Magic Skill Damage": "divine",
  "Ranged Skill Damage": "divine",
  Healing: "divine",
  "Melee Critical Rate": "legendary",
  "Magic Critical Rate": "legendary",
  "Ranged Critical Rate": "legendary",
  "Critical Heal Rate": "legendary",
} as const;

void test("costume stats match the builder sheet stat pool and unlock grades", () => {
  assertStatPool("costume", expectedCostumeStats);
});

void test("undergarment stats match the builder sheet stat pool and unlock grades", () => {
  assertStatPool("undergarment", expectedUndergarmentStats);
});

void test("backstab rolls are available from grand for costumes and undergarments", () => {
  const costumeGrand = getAvailableStatIds("costume", "grand", "melee");
  const undergarmentGrand = getAvailableStatIds(
    "undergarment",
    "grand",
    "melee",
  );

  assert.ok(costumeGrand.includes("backstab-melee-damage"));
  assert.ok(undergarmentGrand.includes("backstab-melee-damage"));
});

void test("infers ranged subtype from ranged offensive stats", () => {
  assert.deepEqual(inferSubtype(["ranged-attack", "ranged-critical-damage"]), {
    status: "inferred",
    subtype: "ranged",
  });
});

void test("rejects mixed typed offensive targets", () => {
  assert.deepEqual(inferSubtype(["magic-attack", "ranged-attack"]), {
    status: "conflict",
    subtypes: ["magic", "ranged"],
  });
});

void test("returns any subtype for tank-only targets", () => {
  assert.deepEqual(inferSubtype(["max-health", "toughness"]), {
    status: "any",
    subtype: "any",
  });
});

void test("grade list stops at mythic and does not expose eternal", () => {
  assert.equal(GRADES.at(-1), "mythic");
  assert.equal(GRADES.includes("eternal" as (typeof GRADES)[number]), false);
});

void test("reroll expectation only uses stats unlocked at the current grade", () => {
  const heroicStats = getAvailableStatIds("costume", "heroic", "ranged");
  const estimate = estimateExpectedRerolls({
    kind: "costume",
    grade: "heroic",
    subtype: "ranged",
    desiredStatIds: ["ranged-attack", "ranged-critical-damage"],
    keptStatIds: [],
  });

  assert.equal(heroicStats.includes("ranged-critical-damage"), false);
  assert.equal(estimate.favorableOutcomes, 1);
  assert.equal(estimate.availableOutcomes, heroicStats.length);
  assert.equal(estimate.expectedAttempts, heroicStats.length);
});

void test("already kept target stats are excluded from future reroll outcomes", () => {
  const divineStats = getAvailableStatIds("costume", "divine", "ranged");
  const estimate = estimateExpectedRerolls({
    kind: "costume",
    grade: "divine",
    subtype: "ranged",
    desiredStatIds: ["ranged-attack", "ranged-critical-damage"],
    keptStatIds: ["ranged-attack"],
  });

  assert.equal(estimate.favorableOutcomes, 1);
  assert.equal(estimate.availableOutcomes, divineStats.length - 1);
  assert.equal(estimate.expectedAttempts, divineStats.length - 1);
});

void test("current item comparison recommends restart when salvage-adjusted restart is cheaper", () => {
  const result = compareCurrentItem({
    kind: "costume",
    targetGrade: "mythic",
    targetProgress: 100,
    desiredStatIds: ["ranged-attack", "ranged-critical-damage"],
    current: {
      grade: "legendary",
      progress: 0,
      statIds: ["physical-defense", "max-health"],
    },
    prices,
  });

  assert.equal(result.recommendation, "restart");
  assert.ok(result.restartCost.totalCost < result.continueCost.totalCost);
});

void test("current item comparison recommends continue when target stats are already kept", () => {
  const target = planTargetRoute({
    kind: "costume",
    targetGrade: "mythic",
    targetProgress: 100,
    desiredStatIds: ["ranged-attack", "ranged-critical-damage"],
    prices,
  });
  const result = compareCurrentItem({
    kind: "costume",
    targetGrade: "mythic",
    targetProgress: 100,
    desiredStatIds: ["ranged-attack", "ranged-critical-damage"],
    current: {
      grade: "legendary",
      progress: 0,
      statIds: ["ranged-attack", "ranged-critical-damage"],
    },
    prices,
  });

  assert.equal(target.subtype.status, "inferred");
  assert.equal(result.recommendation, "continue");
  assert.ok(result.continueCost.totalCost < result.restartCost.totalCost);
});

void test("costume base item cost values 200 prestige at one tenth Misagon crystal", () => {
  assert.equal(
    estimateBaseItemCost({
      kind: "costume",
      prices: { misagonsCrystal: 5 },
    }),
    100,
  );
});

void test("undergarment base item cost defaults to 155g", () => {
  assert.equal(
    estimateBaseItemCost({
      kind: "undergarment",
      prices,
    }),
    155,
  );
});

void test("restart-aware strategy includes base item cost in build from scratch", () => {
  const strategy = planOptimalStrategy({
    kind: "costume",
    targetGrade: "mythic",
    targetProgress: 100,
    desiredStatIds: ["ranged-attack"],
    prices,
  });

  assert.equal(strategy.baseItemCost, 100);
  assert.ok(strategy.targetCost.totalCost > strategy.baseItemCost);
});

void test("restart-aware comparison restarts bad upgraded states when rerolls are expensive", () => {
  const strategy = compareCurrentStrategy({
    kind: "costume",
    targetGrade: "mythic",
    targetProgress: 100,
    desiredStatIds: ["ranged-attack", "ranged-critical-damage"],
    current: {
      grade: "legendary",
      progress: 0,
      statIds: ["physical-defense", "max-health"],
    },
    prices: { ...prices, serendipityStone: 5000 },
  });

  assert.equal(strategy.recommendation, "restart");
});

void test("restart-aware comparison continues when target stats are already kept", () => {
  const strategy = compareCurrentStrategy({
    kind: "costume",
    targetGrade: "mythic",
    targetProgress: 100,
    desiredStatIds: ["ranged-attack", "ranged-critical-damage"],
    current: {
      grade: "grand",
      progress: 0,
      statIds: ["ranged-attack"],
    },
    prices: { ...prices, serendipityStone: 5000 },
  });

  assert.equal(strategy.recommendation, "continue");
  assert.ok(strategy.continueCost.totalCost < strategy.restartCost.totalCost);
});

function assertStatPool(
  kind: "costume" | "undergarment",
  expected: Record<string, (typeof GRADES)[number]>,
) {
  const actual = new Map(
    getPlannerStats(kind).map((stat) => [
      stat.label,
      stat.unlockGradeByKind[kind],
    ]),
  );

  assert.deepEqual([...actual.keys()].sort(), Object.keys(expected).sort());

  for (const [label, unlockGrade] of Object.entries(expected)) {
    assert.equal(actual.get(label), unlockGrade, label);
  }
}
