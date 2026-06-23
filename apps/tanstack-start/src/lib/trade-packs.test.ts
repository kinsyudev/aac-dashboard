import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

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

type PriceMap = import("./trade-packs.ts").PriceMap;
type RewardItemName = import("./trade-packs.ts").RewardItemName;
type TradePack = import("./trade-packs.ts").TradePack;
type TradePackCraftData = import("./trade-packs.ts").TradePackCraftData;

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
