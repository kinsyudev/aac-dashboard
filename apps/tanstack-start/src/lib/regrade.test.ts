import assert from "node:assert/strict";
import { test } from "node:test";

import type { ConsumablePriceMap, GradeSaleValueMap } from "./regrade.ts";
import { resolveTieredManaSealName } from "./mana-seal.ts";
import {
  getObsidianT3Name,
  getApplicableCharms,
  getRegradeFeeGold,
  getRegradeStep,
  getUpgradeFamilyForItem,
  parseMagnificentVariant,
  solveExpectedRegradeToTarget,
  getSupportedRegradeItems,
  isSupportedMagnificentBase,
  isSupportedObsidianT1Base,
} from "./regrade.ts";

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

void test("destruction-preventing charms zero destruction when applicable", () => {
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
  const charms = getApplicableCharms(item, 7).map((charm) => charm.name);
  assert.ok(charms.includes("Celestial Weapon Anchoring Emblem"));

  const step = getRegradeStep({
    item,
    fromGrade: 7,
    resplendent: false,
    charmId: 42084,
  });

  assert.equal(step.destroyProbability, 0);
  assert.ok(Math.abs(step.downgradeProbability - 0.805) < 1e-9);
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
    candidateCharmIds: [42084],
  });

  assert.ok(
    result.skippedReasons.some((reason) =>
      reason.includes("Celestial Weapon Anchoring Emblem"),
    ),
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

void test("upgrade family identifies selected bases", () => {
  assert.equal(getUpgradeFamilyForItem("Obsidian Shield"), "obsidian-t1");
  assert.equal(getUpgradeFamilyForItem("Magnificent Sunset Bow"), "magnificent");
});
