import assert from "node:assert/strict";
import { test } from "node:test";

import { STAT_POOLS } from "./costume-planner-pools.ts";
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
  getBoundRadiantSynthiumStonePrice,
  getMaterialPrice,
  getNextStatLineThreshold,
  getPlannerStats,
  getStatLineCount,
  getStatRollOdds,
  getStatUnlockGrade,
  getSynthiumStoneCost,
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

// aac-dashboard market averages on 2026-10-21
const livePrices = {
  clearSynthiumStone: 1.32,
  vividSynthiumStone: 52.85,
  lucidSynthiumStone: 168.89,
  radiantSynthiumStone: 191.43,
  clearSynthiumShard: 0.242,
  vividSynthiumShard: 4.02,
  lucidSynthiumShard: 7.0,
  radiantSynthiumShard: 25.0,
  charcoalStabilizer: 1.603,
  misagonsCrystal: 29.44,
  serendipityStone: 796.48,
  brilliantMornstone: 0.006,
};

const rangedCostumeTarget = [
  "ranged-attack",
  "ranged-critical-damage",
  "ranged-skill-damage",
  "ranged-critical-rate",
  "defense-penetration",
];

void test("every stat in the client pools has a planner label, unlocking at its earliest role", () => {
  for (const kind of ["costume", "undergarment"] as const) {
    const stats = new Map(getPlannerStats(kind).map((stat) => [stat.id, stat]));
    const pooled = new Map<string, number>();
    for (const pool of Object.values(STAT_POOLS[kind])) {
      for (const [statId, , unlockGrade] of pool) {
        const index = GRADES.indexOf(unlockGrade);
        pooled.set(statId, Math.min(pooled.get(statId) ?? 99, index));
      }
    }

    assert.deepEqual([...stats.keys()].sort(), [...pooled.keys()].sort());
    for (const [statId, index] of pooled) {
      assert.equal(
        stats.get(statId)?.unlockGradeByKind[kind],
        GRADES[index],
        statId,
      );
    }
  }
});

void test("ranged costume unlock grades follow the client tables", () => {
  const unlock = (statId: string) =>
    getStatUnlockGrade("costume", "ranged", statId);

  assert.equal(unlock("ranged-attack"), "arcane");
  assert.equal(unlock("focus"), "heroic");
  assert.equal(unlock("evasion"), "celestial");
  assert.equal(unlock("defense-penetration"), "celestial");
  assert.equal(unlock("ranged-critical-damage"), "divine");
  assert.equal(unlock("ranged-skill-damage"), "epic");
  assert.equal(unlock("ranged-critical-rate"), "legendary");
  assert.equal(unlock("melee-attack"), "legendary");
  assert.equal(unlock("melee-critical-damage"), undefined);
});

void test("each role's item rolls its own pool", () => {
  const meleeArcane = getAvailableStatIds("costume", "arcane", "melee");
  const meleeLegendary = getAvailableStatIds("costume", "legendary", "melee");
  const undergarmentGrand = getAvailableStatIds(
    "undergarment",
    "grand",
    "melee",
  );

  assert.ok(meleeArcane.includes("melee-attack"));
  assert.equal(meleeArcane.includes("ranged-attack"), false);
  assert.ok(meleeLegendary.includes("ranged-attack"));
  assert.equal(meleeLegendary.includes("ranged-critical-damage"), false);
  assert.deepEqual(undergarmentGrand.sort(), [
    "backstab-melee-damage",
    "magic-defense",
    "max-health",
    "melee-attack",
    "physical-defense",
  ]);
});

void test("infers the role from role-named stats", () => {
  assert.deepEqual(inferSubtype(["ranged-critical-damage"], "costume"), {
    status: "inferred",
    subtype: "ranged",
  });
  assert.deepEqual(
    inferSubtype(["ranged-attack", "ranged-critical-damage"], "costume"),
    { status: "inferred", subtype: "ranged" },
  );
  assert.deepEqual(inferSubtype(["magic-attack", "ranged-attack"], "costume"), {
    status: "conflict",
    subtypes: ["magic", "ranged"],
  });
  assert.deepEqual(inferSubtype(["max-health", "toughness"], "costume"), {
    status: "any",
    subtype: "any",
  });
  // every undergarment rolls every critical rate at legendary
  assert.deepEqual(inferSubtype(["melee-critical-rate"], "undergarment"), {
    status: "any",
    subtype: "any",
  });
});

void test("grade list stops at mythic and does not expose eternal", () => {
  assert.equal(GRADES.at(-1), "mythic");
  assert.equal(GRADES.includes("eternal" as (typeof GRADES)[number]), false);
});

void test("stat lines open at grand, arcane, heroic, unique and legendary", () => {
  for (const kind of ["costume", "undergarment"] as const) {
    assert.deepEqual(STAT_LINE_THRESHOLDS[kind], [
      "grand",
      "arcane",
      "heroic",
      "unique",
      "legendary",
    ]);
  }
  assert.equal(getStatLineCount("costume", "rare"), 1);
  assert.equal(getStatLineCount("costume", "heroic"), 3);
  assert.equal(getStatLineCount("costume", "epic"), 4);
  assert.equal(getStatLineCount("costume", "mythic"), 5);
  assert.equal(
    getNextStatLineThreshold("costume", "arcane", "mythic"),
    "heroic",
  );
});

void test("a reroll picks by weight and skips every stat on the item", () => {
  // grand melee undergarment: five stats of weight 40, one line
  const grand = estimateExpectedRerolls({
    kind: "undergarment",
    grade: "grand",
    subtype: "melee",
    desiredStatIds: ["melee-attack"],
    keptStatIds: [],
  });
  assert.equal(grand.successChance, 40 / 160);
  assert.equal(grand.expectedAttempts, 4);

  // arcane adds five stats of weight 120 and a second line; the kept attack and the other line are skipped
  const arcane = estimateExpectedRerolls({
    kind: "undergarment",
    grade: "arcane",
    subtype: "melee",
    desiredStatIds: ["focus"],
    keptStatIds: ["melee-attack"],
  });
  const junkWeight = (4 * 40 * 40 + 4 * 120 * 120) / (4 * 40 + 4 * 120);
  assert.equal(arcane.successChance, 120 / (800 - 40 - junkWeight));
});

void test("free rolls reduce the paid attempts", () => {
  const paid = estimateExpectedRerolls({
    kind: "undergarment",
    grade: "grand",
    subtype: "melee",
    desiredStatIds: ["melee-attack"],
    keptStatIds: [],
    freeAttempts: 1,
    serendipityPrice: 100,
  });

  assert.equal(paid.expectedAttempts, 3);
  assert.equal(paid.expectedCost, 300);
});

void test("synthesis costs every grade's exp bar from basic", () => {
  const grand = planTargetRoute({
    kind: "costume",
    targetGrade: "grand",
    targetProgress: 0,
    desiredStatIds: [],
    prices,
  });
  assert.deepEqual(grand.targetCost.materials, [
    { id: "clearSynthiumStone", amount: 4 },
  ]);
  assert.equal(grand.targetCost.craftGold, 100);

  const mythic = planTargetRoute({
    kind: "costume",
    targetGrade: "mythic",
    targetProgress: 100,
    desiredStatIds: [],
    prices,
  });
  assert.deepEqual(mythic.targetCost.materials, [
    { id: "clearSynthiumStone", amount: 12 },
    { id: "vividSynthiumStone", amount: 28 },
    { id: "lucidSynthiumStone", amount: 104 },
    { id: "radiantSynthiumStone", amount: 120 },
  ]);
});

void test("synthium stones cost the cheaper of buying and crafting up", () => {
  // live prices: Vivid and Lucid are cheaper crafted up from Clear, Radiant is cheaper bought
  assert.deepEqual(getSynthiumStoneCost("clear", livePrices), {
    price: 1.32,
    source: "market",
  });
  const vivid = getSynthiumStoneCost("vivid", livePrices);
  assert.equal(vivid.source, "crafted");
  assert.ok(Math.abs(vivid.price - (1.32 + 10 + 20 * 1.603)) < 1e-9);
  const lucid = getSynthiumStoneCost("lucid", livePrices);
  assert.equal(lucid.source, "crafted");
  assert.ok(
    Math.abs(lucid.price - (vivid.price + 10 + 29.44 + 20 * 1.603)) < 1e-9,
  );
  assert.deepEqual(getSynthiumStoneCost("radiant", livePrices), {
    price: 191.43,
    source: "market",
  });
});

void test("Activity Token synthium makes stones from tokens and upgrades bound Lucid to Radiant", () => {
  const pricing = { boundSynthiumForEpicPlus: true };
  assert.deepEqual(getSynthiumStoneCost("lucid", livePrices, pricing), {
    price: 0,
    source: "activityTokens",
  });
  const radiant = 10 + 2 * 29.44 + 5 * 1.603;
  assert.ok(
    Math.abs(
      getMaterialPrice("radiantSynthiumStone", livePrices, pricing) - radiant,
    ) < 1e-9,
  );
  assert.ok(
    Math.abs(getBoundRadiantSynthiumStonePrice(livePrices) - radiant) < 1e-9,
  );
  // valued tokens: 20 for the Bound Lucid
  assert.ok(
    Math.abs(
      getBoundRadiantSynthiumStonePrice(livePrices, 3) - (60 + radiant),
    ) < 1e-9,
  );
  // when tokens are worth more than the market stone, buy it
  assert.equal(
    getSynthiumStoneCost("clear", livePrices, {
      ...pricing,
      activityTokenPrice: 1,
    }).source,
    "market",
  );
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

void test("from scratch, the plan restarts where the exact optimizer does", () => {
  // the exact optimizer (client-DB mechanics, live prices) restarts a ranged costume at heroic when the free rolls
  // missed Ranged Attack, and a melee undergarment at rare without Melee Attack
  const costume = planOptimalStrategy({
    kind: "costume",
    targetGrade: "mythic",
    targetProgress: 0,
    desiredStatIds: rangedCostumeTarget,
    prices: livePrices,
  });
  assert.deepEqual(costume.restartGrades, ["heroic"]);
  assert.ok(costume.expectedRestarts > 1 && costume.expectedRestarts < 2);
  assert.equal(costume.strategyCheckpoints[1]?.action, "restart");

  const undergarment = planOptimalStrategy({
    kind: "undergarment",
    targetGrade: "mythic",
    targetProgress: 0,
    desiredStatIds: [
      "melee-attack",
      "focus",
      "defense-penetration",
      "melee-skill-damage",
      "melee-critical-rate",
    ],
    prices: livePrices,
  });
  assert.deepEqual(undergarment.restartGrades, ["rare"]);
});

void test("restart-aware cost adds up its parts", () => {
  const strategy = planOptimalStrategy({
    kind: "costume",
    targetGrade: "mythic",
    targetProgress: 0,
    desiredStatIds: rangedCostumeTarget,
    prices: livePrices,
  });
  const cost = strategy.targetCost;

  assert.ok(
    Math.abs(
      cost.materialCost +
        cost.craftGold +
        cost.rerollCost +
        (cost.baseItemCost ?? 0) -
        cost.salvageCredit -
        cost.totalCost,
    ) < 1e-6,
  );
  assert.ok(
    Math.abs(
      (cost.baseItemCost ?? 0) -
        strategy.baseItemCost * (1 + (cost.expectedRestarts ?? 0)),
    ) < 1e-6,
  );
});

void test("a fresh item that never restarts costs synthesis plus rerolls", () => {
  const route = planTargetRoute({
    kind: "costume",
    targetGrade: "mythic",
    targetProgress: 100,
    desiredStatIds: ["ranged-attack"],
    prices,
  });

  assert.equal(route.subtype.status, "inferred");
  assert.ok(route.targetCost.expectedRerolls > 0);
  assert.equal(
    route.targetCost.totalCost,
    route.targetCost.materialCost +
      route.targetCost.craftGold +
      route.targetCost.rerollCost,
  );
});

void test("current item with junk lines at legendary restarts", () => {
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
  assert.ok(strategy.restartCost.totalCost <= strategy.continueCost.totalCost);
  assert.equal(
    strategy.strategyCheckpoints[1]?.label,
    "Salvage and start over rather than buy Ranged Attack.",
  );
});

void test("current item that has its targets continues", () => {
  const strategy = compareCurrentStrategy({
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

  assert.equal(strategy.recommendation, "continue");
  assert.equal(strategy.continueCost.expectedRerolls, 0);
  assert.ok(strategy.continueCost.totalCost < strategy.restartCost.totalCost);
});

void test("current item synthesizes on when nothing it needs can roll yet", () => {
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
  assert.equal(strategy.synthGrade, "rare");
  assert.ok(strategy.synthCost);
  assert.deepEqual(strategy.synthCost.materials, [
    { id: "clearSynthiumStone", amount: 8 },
  ]);
  assert.equal(strategy.synthCost.craftGold, 200);
});

void test("restart credits the salvage of the current grade", () => {
  const restartAt = (grade: "grand" | "mythic") =>
    compareCurrentItem({
      kind: "costume",
      targetGrade: "mythic",
      targetProgress: 100,
      desiredStatIds: ["ranged-attack"],
      current: { grade, progress: 0, statIds: ["max-health"] },
      prices: livePrices,
    }).restartCost.totalCost;
  // Brilliant Mornstone salvage: grand 20 Clear shards, mythic 60 Clear, 230 Vivid, 770 Lucid and 580 Radiant
  const mythicSalvage = 60 * 0.242 + 230 * 4.02 + 770 * 7 + 580 * 25;
  const grandSalvage = 20 * 0.242;

  assert.ok(
    Math.abs(
      restartAt("grand") - restartAt("mythic") - (mythicSalvage - grandSalvage),
    ) < 1e-6,
  );
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

  assert.equal(
    marketRoute.targetCost.rerollCost,
    marketRoute.targetCost.expectedRerolls * 300,
  );
  assert.equal(
    craftedRoute.targetCost.expectedRerolls,
    marketRoute.targetCost.expectedRerolls,
  );
  assert.equal(
    craftedRoute.targetCost.rerollCost,
    craftedRoute.targetCost.expectedRerolls * 42,
  );
});

void test("the chosen role sets the stat pool and is kept in links only when the stats don't imply it", () => {
  const healing = normalizeCostumePlannerState({
    kind: "costume",
    role: "healing",
    targetGrade: "mythic",
    targetStats: ["evasion", "ranged-critical-damage", "healing-power"],
  });
  assert.deepEqual(healing.targetStats, ["evasion", "healing-power"]);
  assert.equal(serializeCostumePlannerSearch(healing).r, undefined);

  const magicTank = normalizeCostumePlannerState({
    kind: "costume",
    role: "magic",
    targetStats: ["toughness", "focus"],
  });
  assert.equal(serializeCostumePlannerSearch(magicTank).r, "magic");
  assert.deepEqual(
    parseCostumePlannerSearch(serializeCostumePlannerSearch(magicTank)),
    magicTank,
  );

  // saved states without a role take the one their stats imply
  assert.equal(
    normalizeCostumePlannerState({
      kind: "costume",
      targetStats: ["magic-attack", "focus"],
    }).role,
    "magic",
  );
});

void test("a chosen role changes the plan's unlock grades", () => {
  const plan = (role: "melee" | "magic") =>
    planOptimalStrategy({
      kind: "costume",
      targetGrade: "mythic",
      targetProgress: 0,
      desiredStatIds: ["focus"],
      prices: livePrices,
      role,
    });

  assert.equal(getStatUnlockGrade("costume", "melee", "focus"), "heroic");
  assert.equal(getStatUnlockGrade("costume", "magic", "focus"), "celestial");
  assert.deepEqual(plan("magic").subtype, {
    status: "inferred",
    subtype: "magic",
  });
  assert.ok(
    plan("magic").checkpoints[0]?.grade !== plan("melee").checkpoints[0]?.grade,
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
      role: "ranged",
      targetProgress: 100,
      currentProgress: 0,
      // melee attack never rolls on a ranged undergarment
      targetStats: [
        "ranged-attack",
        "ranged-skill-damage",
        "ranged-critical-rate",
        "defense-penetration",
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

void test("roll odds are weight shares of the stats unlocked at the grade, skipping the item's stats", () => {
  const pool = STAT_POOLS.costume.healing.filter(([, , unlock]) =>
    ["grand", "arcane", "heroic"].includes(unlock),
  );
  const total = pool.reduce((sum, [, weight]) => sum + weight, 0);
  const odds = getStatRollOdds({
    kind: "costume",
    role: "healing",
    grade: "heroic",
  });

  assert.equal(odds.length, pool.length);
  assert.ok(Math.abs(odds.reduce((sum, e) => sum + e.chance, 0) - 1) < 1e-9);
  assert.equal(
    odds.find((e) => e.statId === "healing-power")?.chance,
    50 / total,
  );
  assert.equal(
    odds.find((e) => e.statId === "evasion"),
    undefined,
  );

  const skipped = getStatRollOdds({
    kind: "costume",
    role: "healing",
    grade: "heroic",
    excludedStatIds: ["healing-power", "move-speed"],
  });
  assert.equal(skipped.length, pool.length - 2);
  assert.equal(
    skipped.find((e) => e.statId === "resilience")?.chance,
    50 / (total - 100),
  );
});
