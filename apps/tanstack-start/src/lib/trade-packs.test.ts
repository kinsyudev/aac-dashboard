import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

import type {
  PriceMap,
  RewardItemName,
  TradePack,
  TradePackCraftData,
} from "./trade-packs.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("~/")) {
      const srcUrl = new URL("../", import.meta.url);
      return nextResolve(new URL(`${specifier.slice(2)}.ts`, srcUrl).href, {
        ...context,
        parentURL: import.meta.url,
      });
    }

    return nextResolve(specifier, context);
  },
});

const {
  REWARD_ITEM_IDS,
  calculateMaterialCost,
  calculatePackMetrics,
  filterTradePacks,
  getRewardUnitValue,
  getTopPacksByProfitSilverPerLabor,
  getTopPacksByRevenue,
  summarizePackRun,
} = await import("./trade-packs.ts");

// @ts-expect-error RewardItemName is intentionally limited to known rewards.
const invalidRewardItemName: RewardItemName = "Unknown Reward";
void invalidRewardItemName;

const priceMap: PriceMap = new Map([
  [32103, { avg24h: "2.50", avg7d: null, avg30d: null }],
  [32106, { avg24h: "8.00", avg7d: null, avg30d: null }],
  [26880, { avg24h: "100.00", avg7d: null, avg30d: null }],
  [10, { avg24h: "3.00", avg7d: null, avg30d: null }],
]);

const basePack: TradePack = {
  name: "Solis Alchemy Oil",
  payout: 19.5,
  rewardItemName: "Gold",
  destination: "Arcum Iris",
  itemId: 31842,
  filename: "solis-alchemy-oil.json",
  origin: "Solis",
  route: "Solis -> Arcum Iris",
  isLarder: false,
  isFreePack: false,
};

const nullableFilenamePack: TradePack = {
  ...basePack,
  filename: null,
};
void nullableFilenamePack;

const baseCraft: TradePackCraftData = {
  labor: 125,
  proficiency: "Alchemy",
  materials: [{ itemId: 10, amount: 2 }],
};

void test("getRewardUnitValue returns direct and item-backed reward values", () => {
  assert.deepEqual(REWARD_ITEM_IDS, {
    charcoalStabilizer: 32103,
    dragonEssenceStabilizer: 32106,
    lordsCoin: 26880,
  });
  assert.equal(getRewardUnitValue("Gold", { priceMap }), 1);
  assert.equal(getRewardUnitValue("Charcoal Stabilizer", { priceMap }), 2.5);
  assert.equal(
    getRewardUnitValue("Dragon Essence Stabilizer", { priceMap }),
    8,
  );
  assert.equal(
    getRewardUnitValue("Gilda Star", { priceMap, gildaStarValue: 7.25 }),
    7.25,
  );
  assert.equal(getRewardUnitValue("Lord's Pence", { priceMap }), 1);
});

void test("getRewardUnitValue applies item-backed reward overrides", () => {
  const overrideMap = new Map([
    [32103, 3.75],
    [26880, 125],
  ]);

  assert.equal(
    getRewardUnitValue("Charcoal Stabilizer", { priceMap, overrideMap }),
    3.75,
  );
  assert.equal(
    getRewardUnitValue("Lord's Pence", { priceMap, overrideMap }),
    1.25,
  );
});

void test("calculateMaterialCost uses buy-price craft materials", () => {
  assert.equal(
    calculateMaterialCost({
      craft: baseCraft,
      priceMap,
      overrideMap: new Map([[10, 4]]),
    }),
    8,
  );
});

void test("calculateMaterialCost converts coin materials from copper to gold", () => {
  assert.equal(
    calculateMaterialCost({
      craft: {
        ...baseCraft,
        materials: [{ itemId: 500, amount: 12500 }],
      },
      priceMap,
    }),
    1.25,
  );
});

void test("calculateMaterialCost throws when a material price is missing", () => {
  assert.throws(
    () =>
      calculateMaterialCost({
        craft: {
          ...baseCraft,
          materials: [{ itemId: 999, amount: 1 }],
        },
        priceMap,
      }),
    /Missing material price for trade pack item 999/,
  );
});

void test("calculateMaterialCost accepts user overrides for missing market prices", () => {
  assert.equal(
    calculateMaterialCost({
      craft: {
        ...baseCraft,
        materials: [{ itemId: 999, amount: 3 }],
      },
      priceMap,
      overrideMap: new Map([[999, 2]]),
    }),
    6,
  );
});

void test("calculatePackMetrics uses buy-price materials and Commerce turn-in labor", () => {
  const metrics = calculatePackMetrics({
    pack: basePack,
    craft: baseCraft,
    priceMap,
  });

  assert.equal(metrics.revenue, 19.5);
  assert.equal(metrics.cost, 6);
  assert.equal(metrics.profit, 13.5);
  assert.equal(metrics.labor, 235);
  assert.equal(metrics.silverPerLabor, (13.5 * 100) / 235);
});

void test("calculatePackMetrics throws when normal pack craft data is missing", () => {
  assert.throws(
    () =>
      calculatePackMetrics({
        pack: basePack,
        craft: null,
        priceMap,
      }),
    /Missing craft data for trade pack item 31842/,
  );
});

void test("calculatePackMetrics discounts Commerce turn-in labor", () => {
  const metrics = calculatePackMetrics({
    pack: { ...basePack, isFreePack: true },
    craft: null,
    priceMap,
    proficiencyMap: new Map([["Commerce", 10000]]),
  });

  assert.equal(metrics.labor, 105);
});

void test("calculatePackMetrics applies larder cost and labor overrides", () => {
  const metrics = calculatePackMetrics({
    pack: { ...basePack, isLarder: true },
    craft: baseCraft,
    priceMap,
    larderCostPerPack: 12,
    larderLaborPerPack: 75,
  });

  assert.equal(metrics.cost, 12);
  assert.equal(metrics.labor, 185);
});

void test("calculatePackMetrics allows larders without craft data", () => {
  const metrics = calculatePackMetrics({
    pack: { ...basePack, isLarder: true },
    craft: null,
    priceMap,
    larderCostPerPack: 12,
    larderLaborPerPack: 75,
  });

  assert.equal(metrics.cost, 12);
  assert.equal(metrics.labor, 185);
});

void test("calculatePackMetrics uses zero cost and turn-in labor only for free packs", () => {
  const metrics = calculatePackMetrics({
    pack: {
      ...basePack,
      name: "Fish-Food Free Pack",
      payout: 99.3148,
      rewardItemName: "Lord's Pence",
      isFreePack: true,
    },
    craft: baseCraft,
    priceMap,
  });

  assert.equal(metrics.revenue, 99.3148);
  assert.equal(metrics.cost, 0);
  assert.equal(metrics.labor, 110);
  assert.equal(metrics.profit, 99.3148);
});

void test("calculatePackMetrics allows free packs without craft data", () => {
  const metrics = calculatePackMetrics({
    pack: {
      ...basePack,
      name: "Fish-Food Free Pack",
      payout: 99.3148,
      rewardItemName: "Lord's Pence",
      isFreePack: true,
    },
    craft: null,
    priceMap,
  });

  assert.equal(metrics.cost, 0);
  assert.equal(metrics.labor, 110);
});

void test("filterTradePacks filters by origin, destination, and reward item name", () => {
  const packs: TradePack[] = [
    basePack,
    {
      ...basePack,
      name: "Solis Charcoal",
      rewardItemName: "Charcoal Stabilizer",
    },
    {
      ...basePack,
      name: "Gweonid Alchemy Oil",
      origin: "Gweonid",
      destination: "Two Crowns",
    },
  ];

  assert.deepEqual(
    filterTradePacks(packs, {
      origin: "Solis",
      destination: "Arcum Iris",
      rewardItemName: "Gold",
    }).map((pack) => pack.name),
    ["Solis Alchemy Oil"],
  );
  assert.equal(filterTradePacks(packs, { origin: "all" }).length, 3);
});

void test("rankings sort by profit silver per labor and single-pack revenue", () => {
  const lowerRevenueBetterProfitLabor = {
    pack: { ...basePack, name: "Lean Pack" },
    metrics: {
      revenue: 15,
      cost: 1,
      profit: 14,
      labor: 10,
      silverPerLabor: 140,
    },
  };
  const higherRevenueWorseProfitLabor = {
    pack: { ...basePack, name: "Rich Pack" },
    metrics: {
      revenue: 30,
      cost: 25,
      profit: 5,
      labor: 10,
      silverPerLabor: 50,
    },
  };

  assert.equal(
    getTopPacksByProfitSilverPerLabor([
      higherRevenueWorseProfitLabor,
      lowerRevenueBetterProfitLabor,
    ])[0]?.pack.name,
    "Lean Pack",
  );
  assert.equal(
    getTopPacksByRevenue([
      lowerRevenueBetterProfitLabor,
      higherRevenueWorseProfitLabor,
    ])[0]?.pack.name,
    "Rich Pack",
  );
});

void test("summarizePackRun multiplies totals by count and preserves silver per labor", () => {
  const summary = summarizePackRun(
    {
      revenue: 15,
      cost: 1,
      profit: 14,
      labor: 10,
      silverPerLabor: 140,
    },
    4,
  );

  assert.deepEqual(summary, {
    count: 4,
    revenue: 60,
    cost: 4,
    profit: 56,
    labor: 40,
    silverPerLabor: 140,
  });
});
