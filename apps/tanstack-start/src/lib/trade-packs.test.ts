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
  calculatePackMetrics,
  filterTradePacks,
  getRewardUnitValue,
  getTopPacksByProfitSilverPerLabor,
  getTopPacksByRevenue,
  summarizePackRun,
} = await import("./trade-packs.ts");

type PriceMap = import("./trade-packs.ts").PriceMap;
type TradePack = import("./trade-packs.ts").TradePack;
type TradePackCraftData = import("./trade-packs.ts").TradePackCraftData;

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

const baseCraft: TradePackCraftData = {
  labor: 125,
  proficiency: "Alchemy",
  materials: [{ itemId: 10, amount: 2 }],
};

void test("getRewardUnitValue returns direct and item-backed reward values", () => {
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

void test("calculatePackMetrics uses buy-price materials and Commerce turn-in labor", () => {
  const metrics = calculatePackMetrics(basePack, {
    priceMap,
    craftDataByItemId: new Map([[31842, baseCraft]]),
  });

  assert.equal(metrics.revenue, 19.5);
  assert.equal(metrics.cost, 6);
  assert.equal(metrics.profit, 13.5);
  assert.equal(metrics.labor, 235);
  assert.equal(metrics.silverPerLabor, (13.5 * 100) / 235);
});

void test("calculatePackMetrics applies larder cost and labor overrides", () => {
  const metrics = calculatePackMetrics(
    { ...basePack, isLarder: true },
    {
      priceMap,
      craftDataByItemId: new Map([[31842, baseCraft]]),
      larderCost: 12,
      larderLabor: 75,
    },
  );

  assert.equal(metrics.cost, 12);
  assert.equal(metrics.labor, 185);
});

void test("calculatePackMetrics uses zero cost and turn-in labor only for free packs", () => {
  const metrics = calculatePackMetrics(
    {
      ...basePack,
      name: "Fish-Food Free Pack",
      payout: 99.3148,
      rewardItemName: "Lord's Pence",
      isFreePack: true,
    },
    { priceMap, craftDataByItemId: new Map([[31842, baseCraft]]) },
  );

  assert.equal(metrics.revenue, 99.3148);
  assert.equal(metrics.cost, 0);
  assert.equal(metrics.labor, 110);
  assert.equal(metrics.profit, 99.3148);
});

void test("filterTradePacks filters by origin, destination, and reward", () => {
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
      reward: "Gold",
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
