import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  ConsumableLaborMap,
  ConsumablePriceMap,
  GradeSaleValueMap,
} from "./regrade.ts";
import { resolveTieredManaSealName } from "./mana-seal.ts";
import {
  getApplicableCharms,
  getEffectiveSelectedRegradeTarget,
  getMagnificentGearTypes,
  getMagnificentSealedUpgradeNames,
  getMagnificentVariantNames,
  getObsidianT3Name,
  getReachableRegradeResults,
  getRegradeFeeGold,
  getRegradeStep,
  getRegradeTapProjection,
  getResplendentScrollRightClickRecipe,
  getSupportedRegradeItems,
  getUpgradeFamilyForItem,
  isSupportedMagnificentBase,
  isSupportedObsidianT1Base,
  parseMagnificentVariant,
  parseRegradeSearch,
  regradeData,
  serializeRegradeSearch,
  solveExpectedRegradeToTarget,
} from "./regrade.ts";

function getFirstRegradeItem() {
  const item = regradeData.items[0];
  assert.ok(item);
  return item;
}

void test("supported Obsidian bases include T1 only", () => {
  assert.equal(
    isSupportedObsidianT1Base({
      id: 34615,
      name: "Obsidian Bow",
      type: "weapon",
      icon: "icon.png",
      group: 4,
      maxGrade: 11,
      level: 46,
      slot: 13,
    }),
    true,
  );
  assert.equal(
    isSupportedObsidianT1Base({
      id: 34632,
      name: "Ominous Obsidian Bow",
      type: "weapon",
      icon: "icon.png",
      group: 4,
      maxGrade: 11,
      level: 48,
      slot: 13,
    }),
    false,
  );
  assert.equal(
    isSupportedObsidianT1Base({
      id: 34649,
      name: "Cursed Obsidian Bow",
      type: "weapon",
      icon: "icon.png",
      group: 4,
      maxGrade: 11,
      level: 50,
      slot: 13,
    }),
    false,
  );
});

void test("supported Magnificent bases exclude non-crafted lookalikes", () => {
  assert.equal(
    isSupportedMagnificentBase({
      id: 20465,
      name: "Magnificent Sunset Bow",
      type: "weapon",
      icon: "icon.png",
      group: 4,
      maxGrade: 11,
      level: 44,
      slot: 13,
    }),
    true,
  );
  assert.equal(
    isSupportedMagnificentBase({
      id: 1,
      name: "Magnificent Pet Collar",
      type: "pet",
      icon: "icon.png",
      group: 2,
      maxGrade: 11,
      level: 44,
      slot: 3,
    }),
    false,
  );
});

void test("supported item list contains concrete selectable bases", () => {
  const items = getSupportedRegradeItems();
  assert.ok(items.some((item) => item.name === "Obsidian Shield"));
  assert.ok(items.some((item) => item.name === "Magnificent Sunset Bow"));
  assert.ok(!items.some((item) => item.name === "Cursed Obsidian Bow"));
});

void test("regrade fee formula returns copper-derived gold", () => {
  assert.equal(
    getRegradeFeeGold({ ratioCost: 25, itemLevel: 46, itemSlot: 13 }),
    258.7518,
  );
});

void test("regrade step converts group rates from basis points", () => {
  const item = {
    id: 34615,
    name: "Obsidian Bow",
    type: "weapon" as const,
    icon: "icon.png",
    group: 4,
    maxGrade: 11,
    level: 46,
    slot: 13,
  };
  const step = getRegradeStep({
    item,
    fromGrade: 7,
    resplendent: false,
    charmId: null,
  });

  assert.equal(step.successProbability, 0.195);
  assert.equal(step.greatProbability, 0);
  assert.ok(Math.abs(step.destroyProbability - 0.4025) < 1e-9);
  assert.ok(Math.abs(step.downgradeProbability - 0.4025) < 1e-9);
  assert.equal(step.downgradeGrade, 4);
});

void test("resplendent scroll enables great success", () => {
  const item = {
    id: 34615,
    name: "Obsidian Bow",
    type: "weapon" as const,
    icon: "icon.png",
    group: 4,
    maxGrade: 11,
    level: 46,
    slot: 13,
  };
  const step = getRegradeStep({
    item,
    fromGrade: 6,
    resplendent: true,
    charmId: null,
  });

  assert.equal(step.successProbability, 0.228);
  assert.equal(step.greatProbability, 0.0456);
});

void test("resplendent scroll recipes use the matching normal scroll and lucky point", () => {
  const recipes = regradeData.scrolls.flatMap((scroll) => {
    const recipe = getResplendentScrollRightClickRecipe(scroll);
    return recipe ? [[scroll.name, recipe] as const] : [];
  });

  assert.deepEqual(
    recipes.map(([name, recipe]) => [
      name,
      recipe.normalScroll.name,
      recipe.luckyPoint.name,
    ]),
    [
      [
        "Resplendent Weapon Regrade Scroll",
        "Weapon Regrade Scroll",
        "Lucky Sunpoint",
      ],
      [
        "Resplendent Armor Regrade Scroll",
        "Armor Regrade Scroll",
        "Lucky Moonpoint",
      ],
      [
        "Resplendent Accessory Regrade Scroll",
        "Accessory Regrade Scroll",
        "Lucky Starpoint",
      ],
    ],
  );

  const normalWeaponScroll = regradeData.scrolls.find(
    (scroll) => scroll.name === "Weapon Regrade Scroll",
  );
  assert.equal(
    normalWeaponScroll
      ? getResplendentScrollRightClickRecipe(normalWeaponScroll)
      : null,
    null,
  );
});

void test("applicable charms exclude unobtainable white and destruction-prevention charms", () => {
  const item = {
    id: 34615,
    name: "Obsidian Bow",
    type: "weapon" as const,
    icon: "icon.png",
    group: 4,
    maxGrade: 11,
    level: 46,
    slot: 13,
  };
  const grandCharms = getApplicableCharms(item, 2).map((charm) => charm.name);
  const celestialCharms = getApplicableCharms(item, 7).map(
    (charm) => charm.name,
  );

  assert.ok(!grandCharms.includes("White Regrade Charm"));
  assert.ok(!celestialCharms.includes("Bound Destruction Preventive Charm"));
  assert.ok(!celestialCharms.includes("Celestial Weapon Anchoring Emblem"));
  assert.ok(celestialCharms.includes("Celestial Regrade Charm"));
});

void test("solver uses manual sale value for over-target great success", () => {
  const item = {
    id: 34615,
    name: "Obsidian Bow",
    type: "weapon" as const,
    icon: "icon.png",
    group: 4,
    maxGrade: 11,
    level: 46,
    slot: 13,
  };
  const prices: ConsumablePriceMap = new Map([
    [28296, 100],
    [28298, 10],
  ]);
  const saleValues: GradeSaleValueMap = new Map([
    [7, 1000],
    [8, 5000],
  ]);
  const result = solveExpectedRegradeToTarget({
    item,
    targetGrade: 7,
    baseRecraftCostGold: 100,
    baseRecraftLabor: 50,
    upgradeCostGold: 0,
    upgradeLabor: 0,
    saleValuesByGrade: saleValues,
    consumablePrices: prices,
    candidateCharmIds: [],
  });

  assert.ok(result.expectedProfitGold > -100000);
  assert.equal(result.targetGrade, 7);
  assert.ok(result.selectedSteps.length > 0);
  assert.ok(
    result.selectedSteps.every(
      (step) =>
        step.successProbability >= 0 &&
        step.successProbability <= 1 &&
        step.greatProbability >= 0 &&
        step.greatProbability <= step.successProbability,
    ),
  );
  assert.ok(result.revenueBreakdown.some((entry) => entry.grade === 7));
  assert.ok(result.revenueBreakdown.some((entry) => entry.grade === 8));
  assert.ok(
    Math.abs(
      result.revenueBreakdown.reduce(
        (sum, entry) => sum + entry.expectedRevenueGold,
        0,
      ) - result.expectedRevenueGold,
    ) < 0.000001,
  );
  assert.ok(
    Math.abs(
      result.revenueBreakdown.reduce(
        (sum, entry) => sum + entry.expectedCostGold,
        0,
      ) - result.expectedCostGold,
    ) < 0.000001,
  );
});

void test("solver reports skipped consumables with missing prices", () => {
  const item = {
    id: 34615,
    name: "Obsidian Bow",
    type: "weapon" as const,
    icon: "icon.png",
    group: 4,
    maxGrade: 11,
    level: 46,
    slot: 13,
  };
  const result = solveExpectedRegradeToTarget({
    item,
    targetGrade: 8,
    baseRecraftCostGold: 100,
    baseRecraftLabor: 50,
    upgradeCostGold: 0,
    upgradeLabor: 0,
    saleValuesByGrade: new Map([[8, 10000]]),
    consumablePrices: new Map([[28298, 10]]),
    candidateCharmIds: [38755, 42084],
  });

  assert.ok(
    result.skippedReasons.some((reason) =>
      reason.includes("Celestial Regrade Charm"),
    ),
  );
  assert.ok(
    !result.skippedReasons.some((reason) =>
      reason.includes("Celestial Weapon Anchoring Emblem"),
    ),
  );
});

void test("solver handles destructive retry loops above Celestial", () => {
  const item = {
    id: 34615,
    name: "Obsidian Bow",
    type: "weapon" as const,
    icon: "icon.png",
    group: 4,
    maxGrade: 11,
    level: 46,
    slot: 13,
  };
  const result = solveExpectedRegradeToTarget({
    item,
    targetGrade: 8,
    baseRecraftCostGold: 100,
    baseRecraftLabor: 50,
    upgradeCostGold: 500,
    upgradeLabor: 100,
    saleValuesByGrade: new Map([[8, 10000]]),
    consumablePrices: new Map([
      [28296, 100],
      [28298, 10],
      [42084, 200],
    ]),
    candidateCharmIds: [42084],
  });

  assert.ok(Number.isFinite(result.expectedProfitGold));
  assert.ok(Number.isFinite(result.expectedCostGold));
  assert.ok(Number.isFinite(result.silverPerLabor));
  assert.ok(result.selectedSteps.length > 0);
});

void test("solver reports expected regrade attempts", () => {
  const item = {
    id: 34615,
    name: "Obsidian Bow",
    type: "weapon" as const,
    icon: "icon.png",
    group: 4,
    maxGrade: 11,
    level: 46,
    slot: 13,
  };
  const result = solveExpectedRegradeToTarget({
    item,
    targetGrade: 3,
    baseRecraftCostGold: 0,
    baseRecraftLabor: 0,
    upgradeCostGold: 0,
    upgradeLabor: 0,
    saleValuesByGrade: new Map([[3, 1000]]),
    consumablePrices: new Map([[28296, 100]]),
    candidateCharmIds: [],
  });

  assert.ok(result.expectedAttempts > 0);
});

void test("solver stops at selected sale tiers before higher targets", () => {
  const item = {
    id: 34615,
    name: "Obsidian Bow",
    type: "weapon" as const,
    icon: "icon.png",
    group: 4,
    maxGrade: 11,
    level: 46,
    slot: 13,
  };
  const result = solveExpectedRegradeToTarget({
    item,
    targetGrade: 10,
    baseRecraftCostGold: 100,
    baseRecraftLabor: 50,
    upgradeCostGold: 500,
    upgradeLabor: 100,
    saleValuesByGrade: new Map([
      [9, 10000],
      [10, 50000],
    ]),
    consumablePrices: new Map([
      [28296, 100],
      [28298, 10],
      [42084, 200],
    ]),
    candidateCharmIds: [42084],
  });

  assert.ok(result.selectedSteps.length > 0);
  assert.ok(!result.selectedSteps.some((step) => step.fromGrade >= 9));
});

void test("solver includes crafted consumable labor in regrade attempts", () => {
  const item = {
    id: 34615,
    name: "Obsidian Bow",
    type: "weapon" as const,
    icon: "icon.png",
    group: 4,
    maxGrade: 11,
    level: 46,
    slot: 13,
  };
  const prices: ConsumablePriceMap = new Map([[28296, 100]]);
  const labor: ConsumableLaborMap = new Map([[28296, 12]]);
  const result = solveExpectedRegradeToTarget({
    item,
    targetGrade: 3,
    baseRecraftCostGold: 0,
    baseRecraftLabor: 0,
    upgradeCostGold: 0,
    upgradeLabor: 0,
    saleValuesByGrade: new Map([[3, 1000]]),
    consumablePrices: prices,
    consumableLabor: labor,
    candidateCharmIds: [],
  });

  assert.equal(result.selectedSteps[0]?.attemptLabor, 12);
  assert.ok(result.expectedLabor >= 12);
});

void test("tap projection estimates taps needed for target grade", () => {
  const projection = getRegradeTapProjection(
    {
      normalToGrade: 9,
      greatToGrade: 10,
      successProbability: 0.3,
      greatProbability: 0.06,
    },
    9,
    1,
  );

  assert.equal(projection.targetGrade, 9);
  assert.ok(Math.abs(projection.requiredTaps - 3.3333333333333335) < 1e-9);
  assert.ok(Math.abs(projection.expectedTargetOrBetter - 1) < 1e-9);
  assert.ok(Math.abs(projection.expectedNormalHits - 0.8) < 1e-9);
  assert.ok(Math.abs(projection.expectedLuckyHits - 0.2) < 1e-9);
  assert.ok(Math.abs(projection.expectedFailures - 2.3333333333333335) < 1e-9);
});

void test("effective selected target follows best EV when no target is pinned", () => {
  const item = getFirstRegradeItem();
  const target = getEffectiveSelectedRegradeTarget(
    [
      {
        item,
        targetGrade: 7,
        expectedProfitGold: -6310,
        expectedCostGold: 6310,
        expectedRevenueGold: 0,
        expectedLabor: 14759,
        expectedAttempts: 12,
        revenueBreakdown: [],
        silverPerLabor: -42,
        selectedSteps: [],
        skippedReasons: [],
      },
      {
        item,
        targetGrade: 9,
        expectedProfitGold: 21280,
        expectedCostGold: 63004,
        expectedRevenueGold: 84285,
        expectedLabor: 17090,
        expectedAttempts: 34,
        revenueBreakdown: [],
        silverPerLabor: 124,
        selectedSteps: [],
        skippedReasons: [],
      },
    ],
    null,
  );

  assert.equal(target, 9);
});

void test("effective selected target keeps an explicitly pinned target", () => {
  const item = getFirstRegradeItem();
  const target = getEffectiveSelectedRegradeTarget(
    [
      {
        item,
        targetGrade: 7,
        expectedProfitGold: -6310,
        expectedCostGold: 6310,
        expectedRevenueGold: 0,
        expectedLabor: 14759,
        expectedAttempts: 12,
        revenueBreakdown: [],
        silverPerLabor: -42,
        selectedSteps: [],
        skippedReasons: [],
      },
      {
        item,
        targetGrade: 9,
        expectedProfitGold: 21280,
        expectedCostGold: 63004,
        expectedRevenueGold: 84285,
        expectedLabor: 17090,
        expectedAttempts: 34,
        revenueBreakdown: [],
        silverPerLabor: 124,
        selectedSteps: [],
        skippedReasons: [],
      },
    ],
    7,
  );

  assert.equal(target, 7);
});

void test("effective selected target can prefer sale-valued targets by default", () => {
  const item = getFirstRegradeItem();
  const costOnlyResult = {
    item,
    targetGrade: 3,
    expectedProfitGold: -329,
    expectedCostGold: 329,
    expectedRevenueGold: 0,
    expectedLabor: 480,
    expectedAttempts: 1,
    revenueBreakdown: [],
    silverPerLabor: -68,
    selectedSteps: [],
    skippedReasons: [],
  };
  const saleResult = {
    item,
    targetGrade: 9,
    expectedProfitGold: -1436,
    expectedCostGold: 48724,
    expectedRevenueGold: 47287,
    expectedLabor: 3506,
    expectedAttempts: 141,
    revenueBreakdown: [],
    silverPerLabor: -41,
    selectedSteps: [],
    skippedReasons: [],
  };

  assert.equal(
    getEffectiveSelectedRegradeTarget([costOnlyResult, saleResult], null, [
      saleResult,
    ]),
    9,
  );
});

void test("reachable regrade results hide targets blocked by earlier sale tiers", () => {
  const item = getFirstRegradeItem();
  const results = [8, 9, 10, 11].map((targetGrade) => ({
    item,
    targetGrade,
    expectedProfitGold: targetGrade * 100,
    expectedCostGold: 0,
    expectedRevenueGold: 0,
    expectedLabor: 0,
    expectedAttempts: 0,
    revenueBreakdown: [],
    silverPerLabor: 0,
    selectedSteps: [],
    skippedReasons: [],
  }));

  assert.deepEqual(
    getReachableRegradeResults(results, new Map([[9, 10000]])).map(
      (result) => result.targetGrade,
    ),
    [8, 9],
  );
});

void test("regrade search parser restores compact URL state", () => {
  assert.deepEqual(
    parseRegradeSearch({
      family: "obsidian-t1",
      obsidian: "34615",
      target: "9",
      ayanad: "any",
      ayanadItem: "123",
      glowing: "1",
      g9: "75000",
      g10: "300000",
    }),
    {
      family: "obsidian-t1",
      piece: null,
      obsidianItemId: 34615,
      selectedTargetGrade: 9,
      ayanadTargetMode: "any",
      ayanadTargetItemId: 123,
      glowingProcEnabled: true,
      selectedSaleGrades: [8, 9, 10],
      saleValuesByGradeInput: {
        9: "75000",
        10: "300000",
      },
    },
  );
});

void test("regrade search serializer omits defaults and writes sale values", () => {
  assert.deepEqual(
    serializeRegradeSearch({
      family: "magnificent",
      piece: "Longspear",
      selectedTargetGrade: null,
      selectedSaleGrades: [8, 9, 10],
      saleValuesByGradeInput: {
        8: "",
        9: "75000",
        10: "300000",
      },
    }),
    {
      piece: "Longspear",
      g9: "75000",
      g10: "300000",
    },
  );
});

void test("regrade search parser restores selected sell tiers", () => {
  assert.deepEqual(
    parseRegradeSearch({
      sell: "9,10",
      g8: "15000",
      g9: "75000",
      g10: "300000",
    }),
    {
      family: "magnificent",
      piece: null,
      obsidianItemId: null,
      selectedTargetGrade: null,
      ayanadTargetMode: "specific",
      ayanadTargetItemId: null,
      glowingProcEnabled: false,
      selectedSaleGrades: [9, 10],
      saleValuesByGradeInput: {
        8: "15000",
        9: "75000",
        10: "300000",
      },
    },
  );
});

void test("regrade search serializer writes non-default sell tiers", () => {
  assert.deepEqual(
    serializeRegradeSearch({
      selectedSaleGrades: [9, 10],
      saleValuesByGradeInput: {
        8: "15000",
        9: "75000",
        10: "300000",
      },
    }),
    {
      sell: "9,10",
      g8: "15000",
      g9: "75000",
      g10: "300000",
    },
  );
});

void test("tiered mana seal resolver returns Ayanad weapon seals", () => {
  assert.equal(
    resolveTieredManaSealName("ayanad", {
      name: "Ayanad Volcano Bow",
      category: "Bow",
      equip: {
        tier: "ayanad",
        category: "weapon",
        piece: null,
        pieceToken: null,
      },
    }),
    "Ayanad Wooden Mana Seal",
  );
});

void test("tiered mana seal resolver returns Ayanad armor seals", () => {
  assert.equal(
    resolveTieredManaSealName("ayanad", {
      name: "Ayanad Lake Shirt",
      category: "Cloth Shirt",
      equip: {
        tier: "ayanad",
        category: "armor",
        piece: "chest",
        pieceToken: "shirt",
      },
    }),
    "Ayanad Cloth Chest Mana Seal",
  );
});

void test("Obsidian T1 maps to Cursed Obsidian T3 name", () => {
  assert.equal(getObsidianT3Name("Obsidian Shield"), "Cursed Obsidian Shield");
});

void test("Magnificent variant parser extracts variant and piece", () => {
  assert.deepEqual(parseMagnificentVariant("Magnificent Sunset Bow"), {
    prefix: "Sunset",
    piece: "Bow",
  });
});

void test("Magnificent gear types collapse variants by piece", () => {
  const types = getMagnificentGearTypes();
  const longspear = types.find((type) => type.piece === "Longspear");

  assert.ok(longspear);
  assert.equal(longspear.displayName, "Magnificent Longspear");
  assert.equal(
    longspear.representativeItem.name,
    "Magnificent Squall Longspear",
  );
  assert.ok(
    longspear.variantNames.some(
      (name) => name === "Magnificent Earth Longspear",
    ),
  );
  assert.ok(
    !types.some((type) => type.displayName === "Magnificent Earth Longspear"),
  );
});

void test("Magnificent sealed upgrade names are derived from gear type", () => {
  assert.deepEqual(getMagnificentSealedUpgradeNames("Longspear"), {
    epherium: "Sealed Epherium Longspear",
    delphinad: "Sealed Delphinad Longspear",
    ayanad: "Sealed Ayanad Longspear",
  });
});

void test("Magnificent stage variant names include matching revealed tiers", () => {
  assert.ok(
    getMagnificentVariantNames("Longspear", "Delphinad").includes(
      "Delphinad Squall Longspear",
    ),
  );
});

void test("upgrade family identifies selected bases", () => {
  assert.equal(getUpgradeFamilyForItem("Obsidian Shield"), "obsidian-t1");
  assert.equal(
    getUpgradeFamilyForItem("Magnificent Sunset Bow"),
    "magnificent",
  );
});
