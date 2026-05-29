import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_COSTUME_PLANNER_STATE,
  normalizeCostumePlannerState,
  parseCostumePlannerSearch,
  serializeCostumePlannerSearch,
} from "./costume-planner-state.ts";
import {
  compareCurrentItem,
  compareCurrentStrategy,
  estimateBaseItemCost,
  estimateExpectedRerolls,
  getAvailableStatIds,
  getNextStatLineThreshold,
  getPlannerStats,
  getStatLineCount,
  GRADES,
  inferSubtype,
  planOptimalStrategy,
  planTargetRoute,
  STAT_LINE_THRESHOLDS,
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

void test("only attack and healing power stats are exclusive to the selected subtype", () => {
  const meleeCostumeArcane = getAvailableStatIds("costume", "arcane", "melee");
  const meleeCostumeDivine = getAvailableStatIds("costume", "divine", "melee");
  const meleeUndergarmentDivine = getAvailableStatIds(
    "undergarment",
    "divine",
    "melee",
  );

  assert.ok(meleeCostumeArcane.includes("melee-attack"));
  assert.equal(meleeCostumeArcane.includes("magic-attack"), false);
  assert.equal(meleeCostumeArcane.includes("ranged-attack"), false);
  assert.equal(meleeCostumeArcane.includes("healing-power"), false);

  assert.ok(meleeCostumeDivine.includes("magic-critical-damage"));
  assert.ok(meleeCostumeDivine.includes("ranged-critical-damage"));
  assert.ok(meleeCostumeDivine.includes("critical-heal-bonus"));

  assert.ok(meleeUndergarmentDivine.includes("magic-skill-damage"));
  assert.ok(meleeUndergarmentDivine.includes("ranged-skill-damage"));
  assert.ok(meleeUndergarmentDivine.includes("healing"));
});

void test("non-exclusive typed stats do not infer a planner subtype", () => {
  assert.deepEqual(inferSubtype(["ranged-critical-damage"]), {
    status: "any",
    subtype: "any",
  });
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

void test("grade-up rerolls reduce paid serendipity attempts but keep synthesis cost", () => {
  const route = planTargetRoute({
    kind: "costume",
    targetGrade: "arcane",
    targetProgress: 0,
    desiredStatIds: ["ranged-attack"],
    prices,
  });

  assert.equal(route.targetCost.expectedRerolls, 15);
  assert.equal(route.targetCost.rerollCost, 4500);
  assert.ok(route.targetCost.materialCost > 0);
  assert.ok(route.targetCost.craftGold > 0);
});

void test("current continuation uses grade-up rerolls before paid serendipities", () => {
  const strategy = compareCurrentStrategy({
    kind: "costume",
    targetGrade: "arcane",
    targetProgress: 0,
    desiredStatIds: ["ranged-attack"],
    current: {
      grade: "grand",
      progress: 0,
      statIds: ["physical-defense"],
    },
    prices,
  });

  assert.equal(strategy.continueCost.expectedRerolls, 15);
  assert.equal(strategy.continueCost.rerollCost, 4500);
  assert.ok(strategy.continueCost.materialCost > 0);
  assert.ok(strategy.continueCost.craftGold > 0);
});

void test("stat line thresholds apply to costumes and undergarments", () => {
  assert.deepEqual(STAT_LINE_THRESHOLDS.costume, [
    "grand",
    "arcane",
    "unique",
    "divine",
    "legendary",
  ]);
  assert.deepEqual(STAT_LINE_THRESHOLDS.undergarment, [
    "grand",
    "arcane",
    "unique",
    "divine",
    "legendary",
  ]);
  assert.equal(getStatLineCount("costume", "heroic"), 2);
  assert.equal(
    getNextStatLineThreshold("costume", "grand", "mythic"),
    "arcane",
  );
});

void test("grand miss recommends synthesizing to the next stat line before restart", () => {
  const strategy = compareCurrentStrategy({
    kind: "costume",
    targetGrade: "mythic",
    targetProgress: 100,
    desiredStatIds: ["ranged-attack", "ranged-critical-damage"],
    current: {
      grade: "grand",
      progress: 0,
      statIds: ["physical-defense"],
    },
    prices,
  });

  assert.equal(strategy.recommendation, "synth");
  assert.equal(strategy.synthCost?.materials[0]?.id, "vividSynthiumStone");
  assert.equal(strategy.synthCost?.materials[0]?.amount, 12);
  assert.equal(strategy.synthCost?.materials[1]?.id, "charcoalStabilizer");
  assert.equal(strategy.synthCost?.materials[1]?.amount, 240);
  assert.equal(strategy.synthCost?.craftGold, 458);
  assert.equal(strategy.strategyCheckpoints[0]?.grade, "arcane");
});

void test("unique zero-of-three target stats restarts instead of synthesizing to divine", () => {
  const strategy = compareCurrentStrategy({
    kind: "costume",
    targetGrade: "mythic",
    targetProgress: 100,
    desiredStatIds: [
      "physical-defense",
      "max-health",
      "received-damage",
      "received-healing",
      "resilience",
    ],
    current: {
      grade: "unique",
      progress: 0,
      statIds: ["magic-defense", "move-speed", "stealth-detection"],
    },
    prices,
    materialPricing: { boundSynthiumForEpicPlus: true },
  });

  assert.equal(strategy.recommendation, "restart");
});

void test("arcane one-of-two target stats synthesizes to grade-up reroll checkpoint", () => {
  const strategy = compareCurrentStrategy({
    kind: "costume",
    targetGrade: "mythic",
    targetProgress: 100,
    desiredStatIds: [
      "physical-defense",
      "max-health",
      "received-damage",
      "received-healing",
      "resilience",
    ],
    current: {
      grade: "arcane",
      progress: 0,
      statIds: ["magic-defense", "max-health"],
    },
    prices,
    materialPricing: { boundSynthiumForEpicPlus: true },
  });

  assert.equal(strategy.recommendation, "synth");
  assert.equal(strategy.synthGrade, "heroic");
  assert.equal(
    strategy.strategyCheckpoints[0]?.label,
    "Synth to Heroic and reassess after the grade-up reroll.",
  );
});

void test("current continuation keeps newly estimated target stats for later rerolls", () => {
  const strategy = compareCurrentStrategy({
    kind: "costume",
    targetGrade: "mythic",
    targetProgress: 100,
    desiredStatIds: ["ranged-attack", "ranged-critical-damage"],
    current: {
      grade: "grand",
      progress: 0,
      statIds: ["physical-defense"],
    },
    prices,
  });

  assert.equal(strategy.continueCost.expectedRerolls, 44);
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

void test("crafted serendipity price replaces the market reroll price", () => {
  const marketRoute = planTargetRoute({
    kind: "costume",
    targetGrade: "arcane",
    targetProgress: 0,
    desiredStatIds: ["ranged-attack"],
    prices,
  });
  const craftedRoute = planTargetRoute({
    kind: "costume",
    targetGrade: "arcane",
    targetProgress: 0,
    desiredStatIds: ["ranged-attack"],
    prices,
    materialPricing: { serendipityStonePrice: 42 },
  });

  assert.equal(marketRoute.targetCost.rerollCost, 4500);
  assert.equal(craftedRoute.targetCost.expectedRerolls, 15);
  assert.equal(craftedRoute.targetCost.rerollCost, 630);
});

void test("bound synthium pricing changes radiant synthesis without changing lucid synthesis", () => {
  const epicMarketRoute = planTargetRoute({
    kind: "costume",
    targetGrade: "epic",
    targetProgress: 0,
    desiredStatIds: ["ranged-attack"],
    prices,
  });
  const epicBoundRoute = planTargetRoute({
    kind: "costume",
    targetGrade: "epic",
    targetProgress: 0,
    desiredStatIds: ["ranged-attack"],
    prices,
    materialPricing: { boundSynthiumForEpicPlus: true },
  });
  const mythicMarketRoute = planTargetRoute({
    kind: "costume",
    targetGrade: "mythic",
    targetProgress: 100,
    desiredStatIds: ["ranged-attack"],
    prices,
  });
  const mythicBoundRoute = planTargetRoute({
    kind: "costume",
    targetGrade: "mythic",
    targetProgress: 100,
    desiredStatIds: ["ranged-attack"],
    prices,
    materialPricing: { boundSynthiumForEpicPlus: true },
  });

  assert.equal(
    epicBoundRoute.targetCost.materialCost,
    epicMarketRoute.targetCost.materialCost,
  );
  assert.equal(
    mythicMarketRoute.targetCost.materialCost -
      mythicBoundRoute.targetCost.materialCost,
    44 * (80 - 25),
  );
});

void test("costume planner state defaults match the route defaults", () => {
  assert.deepEqual(normalizeCostumePlannerState({}), {
    ...DEFAULT_COSTUME_PLANNER_STATE,
  });
  assert.equal(DEFAULT_COSTUME_PLANNER_STATE.craftedSerendipities, false);
  assert.equal(DEFAULT_COSTUME_PLANNER_STATE.boundSynthiumForEpicPlus, false);
  assert.deepEqual(DEFAULT_COSTUME_PLANNER_STATE.serendipityCraftModes, {});
  assert.deepEqual(DEFAULT_COSTUME_PLANNER_STATE.serendipitySelectedCrafts, {});
});

void test("costume planner state clamps numbers and filters stats for selected kind", () => {
  assert.deepEqual(
    normalizeCostumePlannerState({
      kind: "undergarment",
      targetProgress: 150,
      currentProgress: -10,
      targetStats: [
        "move-speed",
        "ranged-attack",
        "ranged-critical-damage",
        "ranged-skill-damage",
        "ranged-critical-rate",
        "defense-penetration",
        "melee-attack",
      ],
      currentStats: ["stealth-detection", "max-health"],
    }),
    {
      ...DEFAULT_COSTUME_PLANNER_STATE,
      kind: "undergarment",
      targetProgress: 100,
      currentProgress: 0,
      targetStats: [
        "ranged-attack",
        "ranged-skill-damage",
        "ranged-critical-rate",
        "defense-penetration",
        "melee-attack",
      ],
      currentStats: ["max-health"],
    },
  );
});

void test("costume planner state trims selected stats to the grade stat line cap", () => {
  const state = normalizeCostumePlannerState({
    kind: "costume",
    targetGrade: "divine",
    targetStats: [
      "physical-defense",
      "magic-defense",
      "max-health",
      "received-damage",
      "received-magic-damage",
    ],
  });

  assert.deepEqual(state.targetStats, [
    "physical-defense",
    "magic-defense",
    "max-health",
    "received-damage",
  ]);
});

void test("costume planner state removes stats not unlocked at the selected grade", () => {
  const state = normalizeCostumePlannerState({
    kind: "costume",
    targetGrade: "unique",
    targetStats: [
      "physical-defense",
      "ranged-skill-damage",
      "resilience",
      "ranged-critical-rate",
    ],
    currentGrade: "arcane",
    currentStats: ["physical-defense", "resilience", "ranged-critical-rate"],
  });

  assert.deepEqual(state.targetStats, ["physical-defense", "resilience"]);
  assert.deepEqual(state.currentStats, ["physical-defense"]);
});

void test("costume planner search serialization round-trips full planner state", () => {
  const state = normalizeCostumePlannerState({
    kind: "undergarment",
    targetGrade: "legendary",
    targetProgress: 75,
    targetStats: ["ranged-attack", "ranged-critical-rate"],
    currentEnabled: true,
    currentGrade: "unique",
    currentProgress: 25,
    currentStats: ["max-health"],
    serendipityOverride: "123.45",
    currentItemValue: "88",
    honorGoldPerThousand: "12.5",
    craftedSerendipities: true,
    boundSynthiumForEpicPlus: true,
    serendipityCraftModes: { 16323: "craft", 19410: "buy" },
    serendipitySelectedCrafts: { 16323: 118, 19410: 4297 },
  });

  const serialized = serializeCostumePlannerSearch(state);

  assert.deepEqual(parseCostumePlannerSearch(serialized), state);
  assert.deepEqual(serialized, {
    k: "undergarment",
    tg: "legendary",
    tp: 75,
    ts: "ranged-attack,ranged-critical-rate",
    ce: true,
    cg: "unique",
    cp: 25,
    cs: "max-health",
    sp: "123.45",
    cv: "88",
    h: "12.5",
    cse: true,
    bse: true,
    scm: "16323:craft,19410:buy",
    scs: "16323:118,19410:4297",
  });
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
