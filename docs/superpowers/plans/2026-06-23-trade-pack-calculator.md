# Trade Pack Calculator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/trade-packs` page that ranks ArcheAge Classic trade packs by profit silver/labor and revenue, supports route filtering, and calculates custom route totals from curated static pack payout data plus existing craft, price override, and proficiency systems.

**Architecture:** Keep raw `pack_data.json` as the source input, generate a small app-local `trade-packs.generated.json` with origin/destination metadata, then fetch recipe and price data through a focused TRPC router. Put all math in `apps/tanstack-start/src/lib/trade-packs.ts` so the route component is mostly state, filtering, and display.

**Tech Stack:** TanStack Start file routes, React 19, TRPC, Drizzle/Postgres tables from `@acme/db`, existing `getItemPrice` and `getDiscountedLabor` helpers, Node script for JSON curation.

---

## File Structure

- Create `scripts/curate-trade-packs.mjs`
  - Reads `pack_data.json`.
  - Derives `origin`, `destination`, `route`, `isLarder`, and `isFreePack`.
  - Writes `apps/tanstack-start/src/data/trade-packs.generated.json`.
  - Fails if origin parsing fails, origin equals destination, or an unknown reward type appears.

- Create `apps/tanstack-start/src/data/trade-packs.generated.json`
  - Generated artifact committed to the repo so the app can import it without runtime filesystem access.

- Create `apps/tanstack-start/src/lib/trade-packs.ts`
  - Exports typed reward constants, generated data types, filtering helpers, reward valuation, material buy-cost calculation, labor calculation, ranking helpers, and custom route totals.

- Create `apps/tanstack-start/src/lib/trade-packs.test.ts`
  - Tests reward valuation, larder/free-pack handling, Commerce turn-in labor, filtering, and pack-count totals.

- Create `packages/api/src/router/trade-packs.ts`
  - Batch-fetches pack craft entries, material rows, latest market prices for materials and reward valuation items.
  - Keeps user price overrides in `profile.getUserData`; the frontend applies those with the existing override map.

- Modify `packages/api/src/root.ts`
  - Registers `tradePacks: tradePacksRouter`.

- Create `apps/tanstack-start/src/routes/trade-packs.tsx`
  - Adds the actual calculator page, global inputs, filters, top 10 tables, and custom route calculator.

- Modify `apps/tanstack-start/src/routes/__root.tsx`
  - Adds `Trade Packs` to member navigation.

- Modify `apps/tanstack-start/package.json`
  - Adds `test:trade-packs`.

- Modify root `package.json`
  - Adds `trade-packs:curate`.

---

### Task 1: Generate Curated Trade Pack Data

**Files:**
- Create: `scripts/curate-trade-packs.mjs`
- Create: `apps/tanstack-start/src/data/trade-packs.generated.json`
- Modify: `package.json`

- [ ] **Step 1: Write the curation script**

Create `scripts/curate-trade-packs.mjs`:

```js
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(repoRoot, "pack_data.json");
const outputPath = path.join(
  repoRoot,
  "apps/tanstack-start/src/data/trade-packs.generated.json",
);

const KNOWN_REWARDS = new Set([
  "Gold",
  "Charcoal Stabilizer",
  "Dragon Essence Stabilizer",
  "Gilda Star",
  "Lord's Pence",
]);

const LARDER_RE = /Aged Cheese|Aged Salve|Aged Honey/;
const FREE_PACK_ITEM_IDS = new Set([43323, 43324, 9000362, 9000414]);

function normalizeRawRow(row) {
  return {
    name: String(row.name_x),
    payout: Number(row.payout),
    rewardItemName: String(row.reward_item_name),
    destination: String(row.zone),
    itemId: Number(row.item_id),
    filename: row.filename == null ? null : String(row.filename),
  };
}

function deriveOrigin(name, zoneNames) {
  return zoneNames.find((zone) => name.startsWith(`${zone} `)) ?? null;
}

const raw = JSON.parse(await readFile(sourcePath, "utf8"));
if (!Array.isArray(raw)) {
  throw new Error("pack_data.json must contain a JSON array.");
}

const rows = raw.map(normalizeRawRow);
const zoneNames = [...new Set(rows.map((row) => row.destination))].sort(
  (a, b) => b.length - a.length || a.localeCompare(b),
);

const unknownRewards = new Set();
const unmatchedOrigins = [];
const sameOriginRows = [];

const packs = rows.map((row) => {
  if (!KNOWN_REWARDS.has(row.rewardItemName)) {
    unknownRewards.add(row.rewardItemName);
  }

  const origin = deriveOrigin(row.name, zoneNames);
  if (origin == null) {
    unmatchedOrigins.push(row);
  }
  if (origin === row.destination) {
    sameOriginRows.push(row);
  }

  return {
    ...row,
    origin,
    route: origin == null ? null : `${origin} -> ${row.destination}`,
    isLarder: LARDER_RE.test(row.name),
    isFreePack: FREE_PACK_ITEM_IDS.has(row.itemId),
  };
});

if (unknownRewards.size > 0) {
  throw new Error(
    `Unknown reward item names: ${[...unknownRewards].sort().join(", ")}`,
  );
}

if (unmatchedOrigins.length > 0) {
  const sample = unmatchedOrigins
    .slice(0, 20)
    .map((row) => `${row.itemId} ${row.name} -> ${row.destination}`)
    .join("\n");
  throw new Error(`Could not derive origins for ${unmatchedOrigins.length} rows:\n${sample}`);
}

if (sameOriginRows.length > 0) {
  const sample = sameOriginRows
    .slice(0, 20)
    .map((row) => `${row.itemId} ${row.name} -> ${row.destination}`)
    .join("\n");
  throw new Error(`Found ${sameOriginRows.length} same-origin rows:\n${sample}`);
}

const output = {
  generatedAt: new Date().toISOString(),
  source: "pack_data.json",
  packs,
};

await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);

console.log(`Generated ${packs.length} trade pack rows.`);
console.log(`Output: ${path.relative(repoRoot, outputPath)}`);
```

- [ ] **Step 2: Add the root package script**

Modify `package.json` and add this script inside `"scripts"`:

```json
"trade-packs:curate": "node scripts/curate-trade-packs.mjs"
```

Keep the JSON comma placement valid with the surrounding scripts.

- [ ] **Step 3: Run the curation script**

Run:

```bash
pnpm trade-packs:curate
```

Expected:

```text
Generated 7998 trade pack rows.
Output: apps/tanstack-start/src/data/trade-packs.generated.json
```

- [ ] **Step 4: Commit**

Run:

```bash
git add package.json scripts/curate-trade-packs.mjs apps/tanstack-start/src/data/trade-packs.generated.json
git commit -m "feat: curate trade pack payout data"
```

---

### Task 2: Add Trade Pack Calculation Helpers

**Files:**
- Create: `apps/tanstack-start/src/lib/trade-packs.ts`
- Create: `apps/tanstack-start/src/lib/trade-packs.test.ts`
- Modify: `apps/tanstack-start/package.json`

- [ ] **Step 1: Add the trade pack test script**

Modify `apps/tanstack-start/package.json` and add this script inside `"scripts"`:

```json
"test:trade-packs": "node --experimental-strip-types --test src/lib/trade-packs.test.ts"
```

- [ ] **Step 2: Write failing tests for core calculations**

Create `apps/tanstack-start/src/lib/trade-packs.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import type { TradePack } from "./trade-packs.ts";
import {
  calculatePackMetrics,
  filterTradePacks,
  getRewardUnitValue,
  getTopPacksByProfitSilverPerLabor,
  getTopPacksByRevenue,
  summarizePackRun,
} from "./trade-packs.ts";

const priceMap = new Map([
  [32103, { avg24h: "2.50", avg7d: null, avg30d: null }],
  [32106, { avg24h: "8.00", avg7d: null, avg30d: null }],
  [26880, { avg24h: "100.00", avg7d: null, avg30d: null }],
  [10, { avg24h: "3.00", avg7d: null, avg30d: null }],
]);

const overrideMap = new Map<number, number>();
const proficiencyMap = new Map<string, number>([["Commerce", 0]]);

const basePack: TradePack = {
  name: "Solis Alchemy Oil",
  payout: 19.5,
  rewardItemName: "Gold",
  destination: "Arcum Iris",
  itemId: 31842,
  filename: "icon.dds",
  origin: "Solis",
  route: "Solis -> Arcum Iris",
  isLarder: false,
  isFreePack: false,
};

test("getRewardUnitValue prices reward item types", () => {
  assert.equal(
    getRewardUnitValue("Gold", {
      gildaStarValue: 4,
      priceMap,
      overrideMap,
    }),
    1,
  );
  assert.equal(
    getRewardUnitValue("Charcoal Stabilizer", {
      gildaStarValue: 4,
      priceMap,
      overrideMap,
    }),
    2.5,
  );
  assert.equal(
    getRewardUnitValue("Dragon Essence Stabilizer", {
      gildaStarValue: 4,
      priceMap,
      overrideMap,
    }),
    8,
  );
  assert.equal(
    getRewardUnitValue("Gilda Star", {
      gildaStarValue: 4,
      priceMap,
      overrideMap,
    }),
    4,
  );
  assert.equal(
    getRewardUnitValue("Lord's Pence", {
      gildaStarValue: 4,
      priceMap,
      overrideMap,
    }),
    1,
  );
});

test("calculatePackMetrics uses buy-price materials and Commerce turn-in labor", () => {
  const metrics = calculatePackMetrics({
    pack: basePack,
    craft: {
      labor: 125,
      proficiency: "Alchemy",
      materials: [{ itemId: 10, amount: 2 }],
    },
    priceMap,
    overrideMap,
    proficiencyMap,
    gildaStarValue: 4,
    larderCostPerPack: 12,
    larderLaborPerPack: 75,
    turnInLabor: 110,
  });

  assert.equal(metrics.revenue, 19.5);
  assert.equal(metrics.cost, 6);
  assert.equal(metrics.profit, 13.5);
  assert.equal(metrics.labor, 235);
  assert.equal(metrics.silverPerLabor, (13.5 * 100) / 235);
});

test("calculatePackMetrics applies larder cost and larder labor override", () => {
  const metrics = calculatePackMetrics({
    pack: { ...basePack, name: "Solis Aged Honey", isLarder: true },
    craft: null,
    priceMap,
    overrideMap,
    proficiencyMap,
    gildaStarValue: 4,
    larderCostPerPack: 12,
    larderLaborPerPack: 75,
    turnInLabor: 110,
  });

  assert.equal(metrics.cost, 12);
  assert.equal(metrics.labor, 185);
});

test("calculatePackMetrics applies turn-in labor only to free packs", () => {
  const metrics = calculatePackMetrics({
    pack: {
      ...basePack,
      itemId: 9000362,
      name: "Fish Food Supplies",
      rewardItemName: "Lord's Pence",
      payout: 99.3148,
      isFreePack: true,
    },
    craft: null,
    priceMap,
    overrideMap,
    proficiencyMap,
    gildaStarValue: 4,
    larderCostPerPack: 12,
    larderLaborPerPack: 75,
    turnInLabor: 110,
  });

  assert.equal(metrics.cost, 0);
  assert.equal(metrics.labor, 110);
  assert.equal(metrics.profit, 99.3148);
});

test("filterTradePacks filters origin, destination, and reward", () => {
  const rows = [
    basePack,
    {
      ...basePack,
      itemId: 2,
      origin: "Falcorth",
      destination: "Two Crowns",
      route: "Falcorth -> Two Crowns",
      rewardItemName: "Charcoal Stabilizer",
    },
  ];

  assert.deepEqual(
    filterTradePacks(rows, {
      origin: "Solis",
      destination: "Arcum Iris",
      rewardItemName: "Gold",
    }).map((pack) => pack.itemId),
    [31842],
  );
});

test("rankings sort by profit silver/labor and single-pack revenue", () => {
  const rows = [
    {
      pack: basePack,
      metrics: {
        revenue: 20,
        cost: 5,
        profit: 15,
        labor: 100,
        silverPerLabor: 15,
      },
    },
    {
      pack: { ...basePack, itemId: 2, name: "Other Pack" },
      metrics: {
        revenue: 50,
        cost: 45,
        profit: 5,
        labor: 100,
        silverPerLabor: 5,
      },
    },
  ];

  assert.equal(getTopPacksByProfitSilverPerLabor(rows, 1)[0]?.pack.itemId, 31842);
  assert.equal(getTopPacksByRevenue(rows, 1)[0]?.pack.itemId, 2);
});

test("summarizePackRun multiplies per-pack metrics by count", () => {
  const summary = summarizePackRun(
    {
      revenue: 10,
      cost: 3,
      profit: 7,
      labor: 5,
      silverPerLabor: 140,
    },
    4,
  );

  assert.equal(summary.revenue, 40);
  assert.equal(summary.cost, 12);
  assert.equal(summary.profit, 28);
  assert.equal(summary.labor, 20);
  assert.equal(summary.silverPerLabor, 140);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
pnpm -F @acme/tanstack-start test:trade-packs
```

Expected: FAIL because `src/lib/trade-packs.ts` does not exist yet.

- [ ] **Step 4: Implement calculation helpers**

Create `apps/tanstack-start/src/lib/trade-packs.ts`:

```ts
import { getItemPrice } from "~/lib/craft-optimizer";
import { getDiscountedLabor } from "~/lib/proficiency";

export const REWARD_ITEM_IDS = {
  charcoalStabilizer: 32103,
  dragonEssenceStabilizer: 32106,
  lordsCoin: 26880,
} as const;

export type RewardItemName =
  | "Gold"
  | "Charcoal Stabilizer"
  | "Dragon Essence Stabilizer"
  | "Gilda Star"
  | "Lord's Pence";

export interface TradePack {
  name: string;
  payout: number;
  rewardItemName: RewardItemName;
  destination: string;
  itemId: number;
  filename: string | null;
  origin: string;
  route: string;
  isLarder: boolean;
  isFreePack: boolean;
}

export interface CuratedTradePackData {
  generatedAt: string;
  source: string;
  packs: TradePack[];
}

export type PriceMap = Map<
  number,
  { avg24h: string | null; avg7d: string | null; avg30d: string | null }
>;
export type OverrideMap = Map<number, number>;
export type ProficiencyMap = Map<string, number>;

export interface TradePackCraftData {
  labor: number;
  proficiency: string | null;
  materials: { itemId: number; amount: number }[];
}

export interface TradePackInputs {
  gildaStarValue: number;
  larderCostPerPack: number;
  larderLaborPerPack: number;
  turnInLabor: number;
}

export interface TradePackMetrics {
  revenue: number;
  cost: number;
  profit: number;
  labor: number;
  silverPerLabor: number | null;
}

export interface TradePackResult {
  pack: TradePack;
  metrics: TradePackMetrics;
}

export interface TradePackFilters {
  origin: string;
  destination: string;
  rewardItemName: string;
}

export function getRewardUnitValue(
  rewardItemName: RewardItemName,
  context: {
    gildaStarValue: number;
    priceMap: PriceMap;
    overrideMap: OverrideMap;
  },
): number {
  switch (rewardItemName) {
    case "Gold":
      return 1;
    case "Charcoal Stabilizer":
      return getItemPrice(
        REWARD_ITEM_IDS.charcoalStabilizer,
        context.priceMap,
        context.overrideMap,
      );
    case "Dragon Essence Stabilizer":
      return getItemPrice(
        REWARD_ITEM_IDS.dragonEssenceStabilizer,
        context.priceMap,
        context.overrideMap,
      );
    case "Gilda Star":
      return context.gildaStarValue;
    case "Lord's Pence":
      return (
        getItemPrice(
          REWARD_ITEM_IDS.lordsCoin,
          context.priceMap,
          context.overrideMap,
        ) / 100
      );
  }
}

export function calculateMaterialCost(
  craft: TradePackCraftData,
  priceMap: PriceMap,
  overrideMap: OverrideMap,
): number {
  return craft.materials.reduce(
    (sum, material) =>
      sum + getItemPrice(material.itemId, priceMap, overrideMap) * material.amount,
    0,
  );
}

export function calculatePackMetrics(input: {
  pack: TradePack;
  craft: TradePackCraftData | null;
  priceMap: PriceMap;
  overrideMap: OverrideMap;
  proficiencyMap: ProficiencyMap;
} & TradePackInputs): TradePackMetrics {
  const rewardUnitValue = getRewardUnitValue(input.pack.rewardItemName, input);
  const revenue = input.pack.payout * rewardUnitValue;
  const turnInLabor = getDiscountedLabor(
    input.turnInLabor,
    "Commerce",
    input.proficiencyMap,
  );

  let cost = 0;
  let labor = turnInLabor;

  if (input.pack.isLarder) {
    cost = input.larderCostPerPack;
    labor += input.larderLaborPerPack;
  } else if (input.pack.isFreePack) {
    cost = 0;
  } else if (input.craft != null) {
    cost = calculateMaterialCost(input.craft, input.priceMap, input.overrideMap);
    labor += getDiscountedLabor(
      input.craft.labor,
      input.craft.proficiency,
      input.proficiencyMap,
    );
  } else {
    return {
      revenue,
      cost: 0,
      profit: revenue,
      labor,
      silverPerLabor: labor > 0 ? (revenue * 100) / labor : null,
    };
  }

  const profit = revenue - cost;
  return {
    revenue,
    cost,
    profit,
    labor,
    silverPerLabor: labor > 0 ? (profit * 100) / labor : null,
  };
}

export function filterTradePacks(
  packs: TradePack[],
  filters: TradePackFilters,
): TradePack[] {
  return packs.filter((pack) => {
    if (filters.origin !== "all" && pack.origin !== filters.origin) return false;
    if (filters.destination !== "all" && pack.destination !== filters.destination) {
      return false;
    }
    if (
      filters.rewardItemName !== "all" &&
      pack.rewardItemName !== filters.rewardItemName
    ) {
      return false;
    }
    return true;
  });
}

export function getTopPacksByProfitSilverPerLabor(
  rows: TradePackResult[],
  limit: number,
): TradePackResult[] {
  return [...rows]
    .filter((row) => row.metrics.silverPerLabor != null)
    .sort(
      (a, b) =>
        (b.metrics.silverPerLabor ?? Number.NEGATIVE_INFINITY) -
        (a.metrics.silverPerLabor ?? Number.NEGATIVE_INFINITY),
    )
    .slice(0, limit);
}

export function getTopPacksByRevenue(
  rows: TradePackResult[],
  limit: number,
): TradePackResult[] {
  return [...rows]
    .sort((a, b) => b.metrics.revenue - a.metrics.revenue)
    .slice(0, limit);
}

export function summarizePackRun(
  metrics: TradePackMetrics,
  packCount: number,
): TradePackMetrics {
  const count = Math.max(1, Math.floor(packCount));
  const revenue = metrics.revenue * count;
  const cost = metrics.cost * count;
  const profit = metrics.profit * count;
  const labor = metrics.labor * count;
  return {
    revenue,
    cost,
    profit,
    labor,
    silverPerLabor: labor > 0 ? (profit * 100) / labor : null,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
pnpm -F @acme/tanstack-start test:trade-packs
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/tanstack-start/package.json apps/tanstack-start/src/lib/trade-packs.ts apps/tanstack-start/src/lib/trade-packs.test.ts
git commit -m "feat: add trade pack calculation helpers"
```

---

### Task 3: Add Trade Pack Data API

**Files:**
- Create: `packages/api/src/router/trade-packs.ts`
- Modify: `packages/api/src/root.ts`

- [ ] **Step 1: Create the trade packs router**

Create `packages/api/src/router/trade-packs.ts`:

```ts
import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { desc, eq, getTableColumns, inArray } from "@acme/db";
import { craftMaterials, crafts, items, prices } from "@acme/db/schema";

import { memberProcedure } from "../trpc";
import {
  hasUnsupportedCraftName,
  type CraftWithMaterialsAndProducts,
} from "./crafts";

const REWARD_PRICE_ITEM_IDS = [32103, 32106, 26880] as const;

export const tradePacksRouter = {
  dataForItems: memberProcedure
    .input(z.object({ itemIds: z.array(z.number().int()).min(1) }))
    .query(async ({ ctx, input }) => {
      const itemIds = [...new Set(input.itemIds)];

      const craftRows = await ctx.db
        .select()
        .from(crafts)
        .where(inArray(crafts.primaryProductId, itemIds))
        .then((rows) =>
          rows.filter((craft) => !hasUnsupportedCraftName(craft.name)),
        );

      const craftIds = craftRows.map((craft) => craft.id);

      const materialRows =
        craftIds.length > 0
          ? await ctx.db
              .select({
                craftId: craftMaterials.craftId,
                amount: craftMaterials.amount,
                item: getTableColumns(items),
              })
              .from(craftMaterials)
              .innerJoin(items, eq(items.id, craftMaterials.itemId))
              .where(inArray(craftMaterials.craftId, craftIds))
          : [];

      const materialItemIds = materialRows.map((row) => row.item.id);
      const pricedItemIds = [
        ...new Set([...materialItemIds, ...REWARD_PRICE_ITEM_IDS]),
      ];

      const latestPrices =
        pricedItemIds.length > 0
          ? await ctx.db
              .selectDistinctOn([prices.itemId], {
                itemId: prices.itemId,
                avg24h: prices.avg24h,
                avg7d: prices.avg7d,
                avg30d: prices.avg30d,
              })
              .from(prices)
              .where(inArray(prices.itemId, pricedItemIds))
              .orderBy(prices.itemId, desc(prices.fetchedAt))
          : [];

      const materialsByCraftId = materialRows.reduce(
        (acc, row) => {
          (acc[row.craftId] ??= []).push({
            craftId: row.craftId,
            amount: row.amount,
            item: row.item,
          });
          return acc;
        },
        {} as Record<
          number,
          CraftWithMaterialsAndProducts["materials"]
        >,
      );

      const craftsByItemId = craftRows.reduce(
        (acc, craft) => {
          if (craft.primaryProductId == null) return acc;
          (acc[craft.primaryProductId] ??= []).push({
            craft,
            materials: materialsByCraftId[craft.id] ?? [],
            products: [],
          });
          return acc;
        },
        {} as Record<number, CraftWithMaterialsAndProducts[]>,
      );

      return {
        craftsByItemId,
        prices: latestPrices,
      };
    }),
} satisfies TRPCRouterRecord;
```

- [ ] **Step 2: Register the router**

Modify `packages/api/src/root.ts`:

```ts
import { tradePacksRouter } from "./router/trade-packs";
```

and add the router:

```ts
tradePacks: tradePacksRouter,
```

The final router object should include:

```ts
export const appRouter = createTRPCRouter({
  auth: authRouter,
  post: postRouter,
  items: itemsRouter,
  crafts: craftsRouter,
  profile: profileRouter,
  shoppingLists: shoppingListsRouter,
  tradePacks: tradePacksRouter,
});
```

- [ ] **Step 3: Typecheck the API package**

Run:

```bash
pnpm -F @acme/api typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add packages/api/src/router/trade-packs.ts packages/api/src/root.ts
git commit -m "feat: expose trade pack recipe data"
```

---

### Task 4: Add the Trade Pack Page

**Files:**
- Create: `apps/tanstack-start/src/routes/trade-packs.tsx`
- Modify: `apps/tanstack-start/src/routes/__root.tsx`

- [ ] **Step 1: Create the route page**

Create `apps/tanstack-start/src/routes/trade-packs.tsx` with these responsibilities:

```tsx
import { Suspense, useMemo, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { Badge } from "@acme/ui/badge";
import { Input } from "@acme/ui/input";
import { Label } from "@acme/ui/label";

import tradePackData from "~/data/trade-packs.generated.json";
import {
  calculatePackMetrics,
  filterTradePacks,
  getTopPacksByProfitSilverPerLabor,
  getTopPacksByRevenue,
  summarizePackRun,
  type CuratedTradePackData,
  type PriceMap,
  type RewardItemName,
  type TradePack,
  type TradePackCraftData,
  type TradePackFilters,
  type TradePackResult,
} from "~/lib/trade-packs";
import { useTRPC } from "~/lib/trpc";
import { useUserData } from "~/lib/useUserData";

const curatedData = tradePackData as CuratedTradePackData;
const allPacks = curatedData.packs;

export const Route = createFileRoute("/trade-packs")({
  head: () => ({
    meta: [
      { title: "Trade Packs | AAC Dashboard" },
      {
        name: "description",
        content:
          "Compare trade pack revenue, profit, and silver per labor by route, destination, and reward type.",
      },
    ],
  }),
  loader: async ({ context }) => {
    await context.queryClient.fetchQuery(
      context.trpc.auth.requireMember.queryOptions(),
    );
  },
  component: TradePacksPage,
});

function TradePacksPage() {
  return (
    <main className="container py-16">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Trade Packs</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Compare pack routes using material buy prices, price overrides, and
          Commerce-adjusted turn-in labor.
        </p>
      </div>
      <Suspense fallback={<p>Loading trade pack data...</p>}>
        <TradePacksContent />
      </Suspense>
    </main>
  );
}

function TradePacksContent() {
  const trpc = useTRPC();
  const { overrideMap, proficiencyMap } = useUserData();
  const [gildaStarValue, setGildaStarValue] = useState("4");
  const [larderCostPerPack, setLarderCostPerPack] = useState("0");
  const [larderLaborPerPack, setLarderLaborPerPack] = useState("75");
  const [turnInLabor, setTurnInLabor] = useState("110");
  const [filters, setFilters] = useState<TradePackFilters>({
    origin: "all",
    destination: "all",
    rewardItemName: "all",
  });
  const [selectedRoute, setSelectedRoute] = useState("all");
  const [selectedPackKey, setSelectedPackKey] = useState("");
  const [packCount, setPackCount] = useState("1");

  const recipeItemIds = useMemo(
    () =>
      [
        ...new Set(
          allPacks
            .filter((pack) => !pack.isLarder && !pack.isFreePack)
            .map((pack) => pack.itemId),
        ),
      ],
    [],
  );

  const { data } = useSuspenseQuery(
    trpc.tradePacks.dataForItems.queryOptions({ itemIds: recipeItemIds }),
  );

  const priceMap = useMemo<PriceMap>(
    () => new Map(data.prices.map((price) => [price.itemId, price])),
    [data.prices],
  );

  const craftMap = useMemo(() => {
    const map = new Map<number, TradePackCraftData>();
    for (const [itemId, entries] of Object.entries(data.craftsByItemId)) {
      const entry = entries[0];
      if (!entry) continue;
      map.set(Number(itemId), {
        labor: entry.craft.labor,
        proficiency: entry.craft.proficiency,
        materials: entry.materials.map((material) => ({
          itemId: material.item.id,
          amount: material.amount,
        })),
      });
    }
    return map;
  }, [data.craftsByItemId]);

  const inputs = {
    gildaStarValue: parseNumericInput(gildaStarValue),
    larderCostPerPack: parseNumericInput(larderCostPerPack),
    larderLaborPerPack: parseNumericInput(larderLaborPerPack),
    turnInLabor: parseNumericInput(turnInLabor),
  };

  const filteredPacks = useMemo(
    () => filterTradePacks(allPacks, filters),
    [filters],
  );

  const results = useMemo<TradePackResult[]>(
    () =>
      filteredPacks.map((pack) => ({
        pack,
        metrics: calculatePackMetrics({
          pack,
          craft: craftMap.get(pack.itemId) ?? null,
          priceMap,
          overrideMap,
          proficiencyMap,
          ...inputs,
        }),
      })),
    [craftMap, filteredPacks, inputs, overrideMap, priceMap, proficiencyMap],
  );

  const topSilverLabor = getTopPacksByProfitSilverPerLabor(results, 10);
  const topRevenue = getTopPacksByRevenue(results, 10);
  const origins = getOptions(allPacks.map((pack) => pack.origin));
  const destinations = getOptions(allPacks.map((pack) => pack.destination));
  const rewards = getOptions(allPacks.map((pack) => pack.rewardItemName));
  const routes = getOptions(filteredPacks.map((pack) => pack.route));
  const routePacks = filteredPacks.filter(
    (pack) => selectedRoute === "all" || pack.route === selectedRoute,
  );
  const selectedPack =
    routePacks.find((pack) => getPackKey(pack) === selectedPackKey) ??
    routePacks[0] ??
    null;
  const selectedMetrics =
    selectedPack == null
      ? null
      : calculatePackMetrics({
          pack: selectedPack,
          craft: craftMap.get(selectedPack.itemId) ?? null,
          priceMap,
          overrideMap,
          proficiencyMap,
          ...inputs,
        });
  const runSummary =
    selectedMetrics == null
      ? null
      : summarizePackRun(selectedMetrics, parseNumericInput(packCount, 1));

  return (
    <div className="flex flex-col gap-10">
      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <NumberField
          label="Gilda Star value"
          value={gildaStarValue}
          onChange={setGildaStarValue}
        />
        <NumberField
          label="Larder cost"
          value={larderCostPerPack}
          onChange={setLarderCostPerPack}
        />
        <NumberField
          label="Larder labor"
          value={larderLaborPerPack}
          onChange={setLarderLaborPerPack}
        />
        <NumberField
          label="Turn-in labor"
          value={turnInLabor}
          onChange={setTurnInLabor}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <SelectField
          label="Origin"
          value={filters.origin}
          options={origins}
          onChange={(origin) => setFilters((current) => ({ ...current, origin }))}
        />
        <SelectField
          label="Destination"
          value={filters.destination}
          options={destinations}
          onChange={(destination) =>
            setFilters((current) => ({ ...current, destination }))
          }
        />
        <SelectField
          label="Reward"
          value={filters.rewardItemName}
          options={rewards}
          onChange={(rewardItemName) =>
            setFilters((current) => ({ ...current, rewardItemName }))
          }
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <RankingTable title="Top Profit Silver/Labor" rows={topSilverLabor} />
        <RankingTable title="Top Revenue" rows={topRevenue} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Route Calculator</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <SelectField
            label="Route"
            value={selectedRoute}
            options={routes}
            onChange={(route) => {
              setSelectedRoute(route);
              setSelectedPackKey("");
            }}
          />
          <SelectField
            label="Pack"
            value={selectedPack == null ? "" : getPackKey(selectedPack)}
            options={routePacks.map((pack) => ({
              value: getPackKey(pack),
              label: `${pack.name} (${pack.rewardItemName})`,
            }))}
            onChange={setSelectedPackKey}
            includeAll={false}
          />
          <NumberField label="Pack count" value={packCount} onChange={setPackCount} />
        </div>
        {selectedPack != null && selectedMetrics != null && runSummary != null ? (
          <MetricsSummary
            pack={selectedPack}
            perPack={selectedMetrics}
            total={runSummary}
          />
        ) : (
          <p className="text-muted-foreground text-sm">
            No packs match the selected filters.
          </p>
        )}
      </section>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <Input
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  includeAll = true,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  includeAll?: boolean;
}) {
  const renderedOptions = includeAll
    ? [{ value: "all", label: "All" }, ...options]
    : options;
  return (
    <label className="flex flex-col gap-2 text-sm font-medium">
      {label}
      <select
        className="border-input bg-background rounded-md border px-3 py-2 text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {renderedOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function RankingTable({ title, rows }: { title: string; rows: TradePackResult[] }) {
  return (
    <div className="rounded-md border">
      <div className="border-b px-4 py-3">
        <h2 className="font-semibold">{title}</h2>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-muted-foreground px-4 py-3 text-left font-medium">
              Pack
            </th>
            <th className="text-muted-foreground px-4 py-3 text-left font-medium">
              Route
            </th>
            <th className="text-muted-foreground px-4 py-3 text-right font-medium">
              Revenue
            </th>
            <th className="text-muted-foreground px-4 py-3 text-right font-medium">
              Profit
            </th>
            <th className="text-muted-foreground px-4 py-3 text-right font-medium">
              S/L
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ pack, metrics }) => (
            <tr key={getPackKey(pack)} className="border-b last:border-0">
              <td className="px-4 py-3">
                <div className="flex flex-col gap-1">
                  <span className="font-medium">{pack.name}</span>
                  <Badge variant="secondary">{pack.rewardItemName}</Badge>
                </div>
              </td>
              <td className="px-4 py-3">{pack.route}</td>
              <td className="px-4 py-3 text-right">{formatGold(metrics.revenue)}</td>
              <td className="px-4 py-3 text-right">{formatGold(metrics.profit)}</td>
              <td className="px-4 py-3 text-right">
                {formatNumber(metrics.silverPerLabor)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MetricsSummary({
  pack,
  perPack,
  total,
}: {
  pack: TradePack;
  perPack: ReturnType<typeof calculatePackMetrics>;
  total: ReturnType<typeof summarizePackRun>;
}) {
  return (
    <div className="rounded-md border p-4">
      <div className="mb-4 flex flex-col gap-1">
        <h3 className="font-semibold">{pack.name}</h3>
        <p className="text-muted-foreground text-sm">{pack.route}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-5">
        <Metric label="Revenue" value={formatGold(total.revenue)} sub={formatGold(perPack.revenue)} />
        <Metric label="Cost" value={formatGold(total.cost)} sub={formatGold(perPack.cost)} />
        <Metric label="Profit" value={formatGold(total.profit)} sub={formatGold(perPack.profit)} />
        <Metric label="Labor" value={formatNumber(total.labor)} sub={formatNumber(perPack.labor)} />
        <Metric label="Silver/Labor" value={formatNumber(total.silverPerLabor)} sub="per run" />
      </div>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs uppercase">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-muted-foreground text-xs">{sub} per pack</p>
    </div>
  );
}

function getOptions(values: string[]) {
  return [...new Set(values)]
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ value, label: value }));
}

function getPackKey(pack: TradePack) {
  return `${pack.itemId}:${pack.origin}:${pack.destination}:${pack.rewardItemName}:${pack.payout}`;
}

function parseNumericInput(value: string, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatGold(value: number) {
  return `${value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })}g`;
}

function formatNumber(value: number | null) {
  if (value == null) return "N/A";
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
```

- [ ] **Step 2: Add navigation**

Modify `apps/tanstack-start/src/routes/__root.tsx` and add the new member nav item:

```ts
{ to: "/trade-packs", label: "Trade Packs", access: "member" },
```

Place it near `Craft` and `Items` so the top nav groups calculation tools together:

```ts
const NAV_ITEMS = [
  { to: "/craft", label: "Craft", access: "member" },
  { to: "/item", label: "Items", access: "member" },
  { to: "/trade-packs", label: "Trade Packs", access: "member" },
  { to: "/costume-planner", label: "Costume Planner", access: "member" },
  { to: "/simulator", label: "Simulator", access: "admin" },
  { to: "/shoplists", label: "Shopping Lists", access: "member" },
  { to: "/profile", label: "Profile", access: "member" },
] as const;
```

- [ ] **Step 3: Typecheck the TanStack app**

Run:

```bash
pnpm -F @acme/tanstack-start typecheck
```

Expected: PASS. If the route tree generator needs to refresh first, start the app once with:

```bash
pnpm -F @acme/tanstack-start dev
```

Then stop the server after `src/routeTree.gen.ts` updates.

- [ ] **Step 4: Commit**

Run:

```bash
git add apps/tanstack-start/src/routes/trade-packs.tsx apps/tanstack-start/src/routes/__root.tsx apps/tanstack-start/src/routeTree.gen.ts
git commit -m "feat: add trade pack calculator page"
```

---

### Task 5: Verify Against Real Data

**Files:**
- Modify only files that fail verification from earlier tasks.

- [ ] **Step 1: Regenerate curated data**

Run:

```bash
pnpm trade-packs:curate
```

Expected:

```text
Generated 7998 trade pack rows.
Output: apps/tanstack-start/src/data/trade-packs.generated.json
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm -F @acme/tanstack-start test:trade-packs
```

Expected: PASS.

- [ ] **Step 3: Run package typechecks**

Run:

```bash
pnpm -F @acme/api typecheck
pnpm -F @acme/tanstack-start typecheck
```

Expected: both PASS.

- [ ] **Step 4: Run workspace lint**

Run:

```bash
pnpm lint
```

Expected: PASS.

- [ ] **Step 5: Manual browser verification**

Run:

```bash
pnpm -F @acme/tanstack-start dev
```

Open the local URL printed by Vite and verify:

- `/trade-packs` is visible in the top nav for member users.
- Filtering `Destination = Arcum Iris` updates both top 10 tables.
- Filtering `Reward = Lord's Pence` shows fish-food supply rows valued from `Lord's Coin / 100`.
- A normal pack such as `Solis Alchemy Oil` uses material buy prices plus craft labor plus Commerce turn-in labor.
- A larder such as `Solis Aged Honey` uses the larder cost and larder labor inputs plus Commerce turn-in labor.
- `Nuian Cargo`, `Haranyan Cargo`, `Fish Food Supplies`, and `Fish Food Supply Pack` use cost `0` and only Commerce turn-in labor.
- Pack count in the route calculator multiplies revenue, cost, profit, and labor while leaving silver/labor unchanged.

- [ ] **Step 6: Commit verification fixes**

If verification required code changes, run:

```bash
git add apps/tanstack-start packages/api package.json scripts/curate-trade-packs.mjs
git commit -m "fix: verify trade pack calculator data flow"
```

If no files changed after verification, skip this commit.

---

## Self-Review

- Spec coverage:
  - Top 10 packs by profit silver/labor: Task 4 ranking table using `getTopPacksByProfitSilverPerLabor`.
  - Top 10 pack revenue: Task 4 ranking table using `getTopPacksByRevenue`.
  - Gilda Star arbitrary value: Task 4 `Gilda Star value` input and Task 2 reward valuation.
  - Custom route selection: Task 4 route and pack selectors.
  - Pack count totals: Task 2 `summarizePackRun` and Task 4 `MetricsSummary`.
  - Origin derivation from names: Task 1 longest-prefix script using dataset zones.
  - Larder classification: Task 1 `Aged Cheese`, `Aged Salve`, `Aged Honey`.
  - Larder arbitrary cost and labor: Task 2 inputs and Task 4 controls.
  - Price overrides: Task 2 uses `getItemPrice` with `overrideMap`.
  - Charcoal, Dragon Essence, and Lord's Pence values: Task 2 reward valuation constants.
  - Commerce turn-in labor: Task 2 `getDiscountedLabor(turnInLabor, "Commerce", proficiencyMap)`.
  - Buy-price material cost: Task 2 `calculateMaterialCost`.
  - Free missing-recipe packs: Task 1 `FREE_PACK_ITEM_IDS` and Task 2 free-pack labor/cost behavior.
  - Origin, destination, and reward filters: Task 4 filter controls.

- Placeholder scan:
  - The plan contains no deferred implementation markers.
  - Every changed file has concrete content or exact insertion snippets.
  - Every verification step has exact commands and expected outcomes.

- Type consistency:
  - `RewardItemName`, `TradePack`, `TradePackMetrics`, and `TradePackCraftData` are defined in Task 2 and reused by Task 4.
  - TRPC router name `tradePacks.dataForItems` is registered in Task 3 and consumed by Task 4.
  - Generated JSON fields match Task 1 output and Task 2 `TradePack` type.
