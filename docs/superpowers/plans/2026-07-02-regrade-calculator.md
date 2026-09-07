# Regrade Calculator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin-only Regrade page that calculates expected cost, expected value, and silver per labor for regrading selected Obsidian T1 and Magnificent gear, then upgrading it to the configured final tier.

**Architecture:** Add a focused regrade calculation library with typed adapters around `regrade_data/regrade.json`, then build a TanStack Start route that uses existing item, craft, price, override, recipe-selection, and mana-seal patterns from the simulator. Keep domain math in `src/lib/regrade.ts`; keep route state and display in `src/routes/regrade.tsx`.

**Tech Stack:** TanStack Start, React, tRPC, Drizzle-backed item/craft/price APIs, Node test runner with `--experimental-strip-types`, existing `@acme/ui` components.

---

## File Structure

- Create `apps/tanstack-start/src/lib/regrade.ts`
  - Owns regrade data types, supported-item filtering, fee calculation, charm/scroll application, expected retry-path solver, upgrade-path descriptors, and small pure helpers.
- Create `apps/tanstack-start/src/lib/regrade.test.ts`
  - Pure unit tests for the fee formula, rates, charm behavior, solver behavior, mana-seal naming, missing-price exclusion, and revenue selection.
- Create `apps/tanstack-start/src/routes/regrade.tsx`
  - Admin-only route, item selector, target mode controls, manual sale value inputs, results table, and selected-row details.
- Modify `apps/tanstack-start/src/routes/__root.tsx`
  - Add admin nav item `{ to: "/regrade", label: "Regrade", access: "admin" }`.
- Modify `apps/tanstack-start/src/lib/mana-seal.ts`
  - Add tier-aware seal resolution while preserving `resolveDelphinadManaSealName`.
- Modify `apps/tanstack-start/package.json`
  - Add `test:regrade`.

## Locked Product Decisions

- Route is `/regrade`; nav label is `Regrade`; access is admin-only.
- Supported base item families:
  - Obsidian T1: exact T1 records from `regrade.json`, meaning names beginning `Obsidian `, `group === 4`, `level === 46`, and type `weapon | armor`.
  - Magnificent: normal crafted records from `regrade.json`, meaning names containing `Magnificent`, `group === 4`, `level === 44`, and type `weapon | armor | accessory`.
- New/recrafted base starts at `Grand`.
- Expected regrade model is full retry path from Grand to at least the target grade.
- On destruction, pay base recraft cost and restart at Grand.
- Base recraft cost uses the direct base craft recipe and buys its materials.
- Upgrade costs use simulator-style recipe selection and material craft/buy behavior.
- Magnificent final upgrade chain is `Magnificent -> Epherium -> Delphinad -> Ayanad`.
- Obsidian final upgrade chain is `Obsidian T1 -> Ominous Obsidian T2 -> Cursed Obsidian T3`.
- Consumable strategy is automatic and optimizes max EV after final upgrade.
- Missing priced consumables, materials, or recipes are excluded and displayed as skipped reasons.
- Final revenue is manual per grade because the existing price data is item-ID-only, not grade-specific.
- Resplendent over-target great success keeps the higher actual landing-grade sale value.
- Magnificent Ayanad mode supports:
  - `specific`: user picks a target Ayanad variant, includes expected Ayanad mana-seal rerolls.
  - `any`: accepts any Ayanad variant and values output using the cheapest available variant price.
- Applying one mana-seal reroll costs 10 labor.
- Glowing proc is optional.

## Task 1: Regrade Domain Types and Static Data

**Files:**
- Create: `apps/tanstack-start/src/lib/regrade.ts`
- Test: `apps/tanstack-start/src/lib/regrade.test.ts`
- Modify: `apps/tanstack-start/package.json`

- [ ] **Step 1: Add the test script**

Modify `apps/tanstack-start/package.json` scripts to include:

```json
"test:regrade": "node --experimental-strip-types --test src/lib/regrade.test.ts"
```

- [ ] **Step 2: Write failing tests for supported item filtering**

Create `apps/tanstack-start/src/lib/regrade.test.ts` with:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
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
```

- [ ] **Step 3: Run the failing tests**

Run:

```bash
pnpm -F @acme/tanstack-start test:regrade
```

Expected: fail because `src/lib/regrade.ts` does not exist yet.

- [ ] **Step 4: Implement regrade data types and filters**

Create `apps/tanstack-start/src/lib/regrade.ts` with:

```ts
import regradeDataJson from "../../../../regrade_data/regrade.json";

export type RegradeItemType = "weapon" | "armor" | "accessory" | "pet" | "ship";

export interface RegradeGrade {
  id: number;
  name: string;
  overlay: string;
}

export interface RegradeItem {
  id: number;
  name: string;
  type: RegradeItemType;
  icon: string;
  group: number;
  maxGrade: number;
  level: number;
  slot: number;
}

export interface RegradeRate {
  success: number;
  great: number;
  break: number;
  downgrade: number;
  cost: number;
  dmin: number;
  dmax: number;
}

export interface RegradeCharm {
  id: number;
  name: string;
  icon: string;
  gradeMin: number;
  gradeMax: number;
  successMul: number;
  successRatio: number;
  breakMul: number;
  downgradeMul: number;
  greatMul: number;
  preventDestroy: boolean;
  preventDowngrade: boolean;
  slot: RegradeItemType | null;
}

export interface RegradeScroll {
  id: number;
  name: string;
  icon: string;
  type: RegradeItemType;
  resplendent: boolean;
}

export interface RegradeData {
  grades: RegradeGrade[];
  groups: Record<string, Record<string, RegradeRate>>;
  items: RegradeItem[];
  charms: RegradeCharm[];
  scrolls: RegradeScroll[];
}

export type RegradeFamily = "obsidian-t1" | "magnificent";

export interface SupportedRegradeItem extends RegradeItem {
  family: RegradeFamily;
}

export const RECRAFT_START_GRADE = 2;
export const MANA_SEAL_USE_LABOR = 10;

export const regradeData = regradeDataJson as RegradeData;

export function isSupportedObsidianT1Base(item: RegradeItem): boolean {
  return (
    item.name.startsWith("Obsidian ") &&
    item.group === 4 &&
    item.level === 46 &&
    (item.type === "weapon" || item.type === "armor")
  );
}

export function isSupportedMagnificentBase(item: RegradeItem): boolean {
  return (
    item.name.toLowerCase().includes("magnificent") &&
    item.group === 4 &&
    item.level === 44 &&
    (item.type === "weapon" ||
      item.type === "armor" ||
      item.type === "accessory")
  );
}

export function getSupportedRegradeItems(
  data: RegradeData = regradeData,
): SupportedRegradeItem[] {
  return data.items
    .flatMap((item): SupportedRegradeItem[] => {
      if (isSupportedObsidianT1Base(item)) {
        return [{ ...item, family: "obsidian-t1" }];
      }
      if (isSupportedMagnificentBase(item)) {
        return [{ ...item, family: "magnificent" }];
      }
      return [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 5: Run the tests**

Run:

```bash
pnpm -F @acme/tanstack-start test:regrade
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/tanstack-start/package.json apps/tanstack-start/src/lib/regrade.ts apps/tanstack-start/src/lib/regrade.test.ts
git commit -m "feat: add regrade data model"
```

## Task 2: Regrade Step Math

**Files:**
- Modify: `apps/tanstack-start/src/lib/regrade.ts`
- Modify: `apps/tanstack-start/src/lib/regrade.test.ts`

- [ ] **Step 1: Add failing tests for fees, charms, and scroll outcomes**

Append to `apps/tanstack-start/src/lib/regrade.test.ts`:

```ts
import {
  getApplicableCharms,
  getRegradeFeeGold,
  getRegradeStep,
} from "./regrade.ts";

void test("regrade fee formula returns copper-derived gold", () => {
  assert.equal(getRegradeFeeGold({ ratioCost: 25, itemLevel: 46, itemSlot: 13 }), 467.6388);
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
  assert.equal(step.destroyProbability, 0.5);
  assert.equal(step.downgradeProbability, 0.5);
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
  assert.equal(step.downgradeProbability, 0.805);
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
pnpm -F @acme/tanstack-start test:regrade
```

Expected: fail because the step functions are not implemented.

- [ ] **Step 3: Implement fee and step math**

Append to `apps/tanstack-start/src/lib/regrade.ts`:

```ts
const REGRADE_FEE_K = 0.0041636529;
const REGRADE_FEE_BASE_COPPER = 160000;
const COPPER_PER_GOLD = 10000;

export interface RegradeFeeInput {
  ratioCost: number;
  itemLevel: number;
  itemSlot: number;
}

export interface RegradeStepInput {
  item: RegradeItem;
  fromGrade: number;
  resplendent: boolean;
  charmId: number | null;
  data?: RegradeData;
}

export interface RegradeStep {
  item: RegradeItem;
  fromGrade: number;
  normalToGrade: number;
  greatToGrade: number;
  scroll: RegradeScroll | null;
  charm: RegradeCharm | null;
  successProbability: number;
  greatProbability: number;
  normalSuccessProbability: number;
  destroyProbability: number;
  downgradeProbability: number;
  stayProbability: number;
  downgradeGrade: number | null;
  feeGold: number;
  ratioCost: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function basisPointsToProbability(value: number): number {
  return value / 10000;
}

export function getRegradeFeeGold(input: RegradeFeeInput): number {
  const copper =
    Math.round(
      REGRADE_FEE_K *
        Math.pow(input.itemLevel * input.ratioCost, 2.5) *
        input.itemSlot,
    ) + REGRADE_FEE_BASE_COPPER;

  return copper / COPPER_PER_GOLD;
}

export function charmApplies(
  charm: RegradeCharm,
  item: RegradeItem,
  fromGrade: number,
): boolean {
  if (charm.slot && charm.slot !== item.type) return false;
  if (charm.gradeMin >= 0 && fromGrade < charm.gradeMin) return false;
  if (charm.gradeMax >= 0 && fromGrade > charm.gradeMax) return false;
  return true;
}

export function getApplicableCharms(
  item: RegradeItem,
  fromGrade: number,
  data: RegradeData = regradeData,
): RegradeCharm[] {
  return data.charms.filter((charm) => charmApplies(charm, item, fromGrade));
}

export function getRegradeRate(
  item: RegradeItem,
  fromGrade: number,
  data: RegradeData = regradeData,
): RegradeRate | null {
  return data.groups[String(item.group)]?.[String(fromGrade)] ?? null;
}

export function getRegradeScroll(
  item: RegradeItem,
  resplendent: boolean,
  data: RegradeData = regradeData,
): RegradeScroll | null {
  return (
    data.scrolls.find(
      (scroll) => scroll.type === item.type && scroll.resplendent === resplendent,
    ) ?? null
  );
}

export function getRegradeStep(input: RegradeStepInput): RegradeStep {
  const data = input.data ?? regradeData;
  const rate = getRegradeRate(input.item, input.fromGrade, data);
  if (!rate) {
    throw new Error(`Missing regrade rate for group ${input.item.group}, grade ${input.fromGrade}`);
  }

  const scroll = getRegradeScroll(input.item, input.resplendent, data);
  const charm =
    input.charmId == null
      ? null
      : data.charms.find((candidate) => candidate.id === input.charmId) ?? null;
  const effectiveCharm =
    charm && charmApplies(charm, input.item, input.fromGrade) ? charm : null;

  let success = basisPointsToProbability(rate.success);
  let destroy = basisPointsToProbability(rate.break);
  let downgrade = basisPointsToProbability(rate.downgrade);
  let great = input.resplendent ? basisPointsToProbability(rate.great) : 0;

  if (effectiveCharm) {
    success =
      success * (1 + effectiveCharm.successMul / 100) +
      basisPointsToProbability(effectiveCharm.successRatio);
    destroy *= 1 + effectiveCharm.breakMul / 100;
    downgrade *= 1 + effectiveCharm.downgradeMul / 100;
    great *= 1 + effectiveCharm.greatMul / 100;
    if (effectiveCharm.preventDestroy) destroy = 0;
    if (effectiveCharm.preventDowngrade) downgrade = 0;
  }

  success = clamp01(success);
  great = clamp01(Math.min(great, success));
  destroy = clamp01(destroy);
  downgrade = clamp01(downgrade);

  const failureProbability = 1 - success;
  const destroyProbability = failureProbability * destroy;
  const downgradeProbability = failureProbability * (1 - destroy) * downgrade;
  const stayProbability = Math.max(
    0,
    1 - success - destroyProbability - downgradeProbability,
  );

  return {
    item: input.item,
    fromGrade: input.fromGrade,
    normalToGrade: Math.min(input.fromGrade + 1, input.item.maxGrade),
    greatToGrade: Math.min(input.fromGrade + 2, input.item.maxGrade),
    scroll,
    charm: effectiveCharm,
    successProbability: success,
    greatProbability: great,
    normalSuccessProbability: Math.max(0, success - great),
    destroyProbability,
    downgradeProbability,
    stayProbability,
    downgradeGrade: rate.dmin >= 0 ? rate.dmin : Math.max(0, input.fromGrade - 1),
    feeGold: getRegradeFeeGold({
      ratioCost: rate.cost,
      itemLevel: input.item.level,
      itemSlot: input.item.slot,
    }),
    ratioCost: rate.cost,
  };
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm -F @acme/tanstack-start test:regrade
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/tanstack-start/src/lib/regrade.ts apps/tanstack-start/src/lib/regrade.test.ts
git commit -m "feat: calculate regrade steps"
```

## Task 3: Expected Retry Solver and Consumable Optimization

**Files:**
- Modify: `apps/tanstack-start/src/lib/regrade.ts`
- Modify: `apps/tanstack-start/src/lib/regrade.test.ts`

- [ ] **Step 1: Add failing tests for solver behavior**

Append to `apps/tanstack-start/src/lib/regrade.test.ts`:

```ts
import {
  solveExpectedRegradeToTarget,
  type ConsumablePriceMap,
  type GradeSaleValueMap,
} from "./regrade.ts";

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

  assert.ok(result.skippedReasons.some((reason) => reason.includes("Celestial Weapon Anchoring Emblem")));
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
pnpm -F @acme/tanstack-start test:regrade
```

Expected: fail because the solver is not implemented.

- [ ] **Step 3: Implement solver interfaces and recursion**

Append to `apps/tanstack-start/src/lib/regrade.ts`:

```ts
export type ConsumablePriceMap = Map<number, number>;
export type GradeSaleValueMap = Map<number, number>;

export interface RegradeActionChoice {
  fromGrade: number;
  scroll: RegradeScroll;
  charm: RegradeCharm | null;
  expectedValueGold: number;
  attemptCostGold: number;
}

export interface ExpectedRegradeInput {
  item: RegradeItem;
  targetGrade: number;
  baseRecraftCostGold: number;
  baseRecraftLabor: number;
  upgradeCostGold: number;
  upgradeLabor: number;
  saleValuesByGrade: GradeSaleValueMap;
  consumablePrices: ConsumablePriceMap;
  candidateCharmIds: number[];
  startGrade?: number;
  data?: RegradeData;
}

export interface ExpectedRegradeResult {
  item: RegradeItem;
  targetGrade: number;
  expectedProfitGold: number;
  expectedCostGold: number;
  expectedRevenueGold: number;
  expectedLabor: number;
  silverPerLabor: number;
  selectedSteps: RegradeActionChoice[];
  skippedReasons: string[];
}

interface SolverValue {
  value: number;
  cost: number;
  revenue: number;
  labor: number;
  steps: RegradeActionChoice[];
}

function getPricedConsumable(
  consumable: { id: number; name: string } | null,
  prices: ConsumablePriceMap,
  skippedReasons: string[],
): number | null {
  if (!consumable) return 0;
  const price = prices.get(consumable.id);
  if (price == null || !Number.isFinite(price) || price <= 0) {
    skippedReasons.push(`Skipped ${consumable.name}: missing price.`);
    return null;
  }
  return price;
}

function getSaleValueForLandingGrade(
  saleValuesByGrade: GradeSaleValueMap,
  grade: number,
): number {
  return saleValuesByGrade.get(grade) ?? 0;
}

export function solveExpectedRegradeToTarget(
  input: ExpectedRegradeInput,
): ExpectedRegradeResult {
  const data = input.data ?? regradeData;
  const startGrade = input.startGrade ?? RECRAFT_START_GRADE;
  const skippedReasons: string[] = [];
  const memo = new Map<number, SolverValue>();
  const visiting = new Set<number>();

  const solve = (grade: number): SolverValue => {
    if (grade >= input.targetGrade) {
      const revenue =
        getSaleValueForLandingGrade(input.saleValuesByGrade, grade) -
        input.upgradeCostGold;
      return {
        value: revenue,
        cost: input.upgradeCostGold,
        revenue: getSaleValueForLandingGrade(input.saleValuesByGrade, grade),
        labor: input.upgradeLabor,
        steps: [],
      };
    }

    const existing = memo.get(grade);
    if (existing) return existing;
    if (visiting.has(grade)) {
      return { value: -Infinity, cost: Infinity, revenue: 0, labor: 0, steps: [] };
    }
    visiting.add(grade);

    const scrollModes = [false, true];
    const charmIds = [null, ...input.candidateCharmIds] as (number | null)[];
    let best: SolverValue | null = null;

    for (const resplendent of scrollModes) {
      for (const charmId of charmIds) {
        const step = getRegradeStep({
          item: input.item,
          fromGrade: grade,
          resplendent,
          charmId,
          data,
        });
        const scrollPrice = getPricedConsumable(
          step.scroll,
          input.consumablePrices,
          skippedReasons,
        );
        const charmPrice = getPricedConsumable(
          step.charm,
          input.consumablePrices,
          skippedReasons,
        );
        if (step.scroll == null || scrollPrice == null || charmPrice == null) {
          continue;
        }

        const attemptCost = step.feeGold + scrollPrice + charmPrice;
        const normal = solve(step.normalToGrade);
        const great = solve(step.greatToGrade);
        const downgraded =
          step.downgradeGrade == null ? solve(grade) : solve(step.downgradeGrade);
        const restarted = solve(startGrade);

        const nonStayValue =
          step.normalSuccessProbability * normal.value +
          step.greatProbability * great.value +
          step.destroyProbability *
            (restarted.value - input.baseRecraftCostGold) +
          step.downgradeProbability * downgraded.value -
          attemptCost;
        const denominator = Math.max(0.000001, 1 - step.stayProbability);
        const expectedValue = nonStayValue / denominator;

        const nonStayCost =
          attemptCost +
          step.normalSuccessProbability * normal.cost +
          step.greatProbability * great.cost +
          step.destroyProbability *
            (input.baseRecraftCostGold + restarted.cost) +
          step.downgradeProbability * downgraded.cost;
        const expectedCost = nonStayCost / denominator;

        const expectedRevenue =
          (step.normalSuccessProbability * normal.revenue +
            step.greatProbability * great.revenue +
            step.destroyProbability * restarted.revenue +
            step.downgradeProbability * downgraded.revenue) /
          denominator;
        const expectedLabor =
          (step.normalSuccessProbability * normal.labor +
            step.greatProbability * great.labor +
            step.destroyProbability *
              (input.baseRecraftLabor + restarted.labor) +
            step.downgradeProbability * downgraded.labor) /
          denominator;

        const candidate: SolverValue = {
          value: expectedValue,
          cost: expectedCost,
          revenue: expectedRevenue,
          labor: expectedLabor,
          steps: [
            {
              fromGrade: grade,
              scroll: step.scroll,
              charm: step.charm,
              expectedValueGold: expectedValue,
              attemptCostGold: attemptCost,
            },
            ...normal.steps,
          ],
        };

        if (!best || candidate.value > best.value) {
          best = candidate;
        }
      }
    }

    visiting.delete(grade);
    const resolved =
      best ?? { value: -Infinity, cost: Infinity, revenue: 0, labor: 0, steps: [] };
    memo.set(grade, resolved);
    return resolved;
  };

  const solved = solve(startGrade);
  const expectedLabor = solved.labor;
  return {
    item: input.item,
    targetGrade: input.targetGrade,
    expectedProfitGold: solved.value,
    expectedCostGold: solved.cost,
    expectedRevenueGold: solved.revenue,
    expectedLabor,
    silverPerLabor: expectedLabor > 0 ? (solved.value * 100) / expectedLabor : 0,
    selectedSteps: solved.steps,
    skippedReasons: [...new Set(skippedReasons)],
  };
}
```

- [ ] **Step 4: Run tests and fix any recursion edge case**

Run:

```bash
pnpm -F @acme/tanstack-start test:regrade
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/tanstack-start/src/lib/regrade.ts apps/tanstack-start/src/lib/regrade.test.ts
git commit -m "feat: solve expected regrade paths"
```

## Task 4: Tier-Aware Mana Seal Resolution

**Files:**
- Modify: `apps/tanstack-start/src/lib/mana-seal.ts`
- Modify: `apps/tanstack-start/src/lib/regrade.test.ts`

- [ ] **Step 1: Add failing tests for Ayanad seal names**

Append to `apps/tanstack-start/src/lib/regrade.test.ts`:

```ts
import { resolveTieredManaSealName } from "./mana-seal.ts";

void test("tiered mana seal resolver returns Ayanad weapon seals", () => {
  assert.equal(
    resolveTieredManaSealName("ayanad", {
      name: "Ayanad Volcano Bow",
      category: "Bow",
      equip: { tier: "ayanad", category: "weapon", piece: null, pieceToken: null },
    }),
    "Ayanad Wooden Mana Seal",
  );
});

void test("tiered mana seal resolver returns Ayanad armor seals", () => {
  assert.equal(
    resolveTieredManaSealName("ayanad", {
      name: "Ayanad Lake Shirt",
      category: "Cloth Shirt",
      equip: { tier: "ayanad", category: "armor", piece: "chest", pieceToken: "shirt" },
    }),
    "Ayanad Cloth Chest Mana Seal",
  );
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
pnpm -F @acme/tanstack-start test:regrade
```

Expected: fail because `resolveTieredManaSealName` does not exist.

- [ ] **Step 3: Add tier-aware resolver**

Modify `apps/tanstack-start/src/lib/mana-seal.ts` by adding:

```ts
export type ManaSealTier = "delphinad" | "ayanad";

function titleCaseTier(tier: ManaSealTier): "Delphinad" | "Ayanad" {
  return tier === "delphinad" ? "Delphinad" : "Ayanad";
}

export function resolveTieredManaSealName(
  tier: ManaSealTier,
  context: ManaSealItemContext,
): string | null {
  const { category, equip, name } = context;
  const prefix = titleCaseTier(tier);

  if (equip.tier !== tier) return null;

  if (equip.category === "armor") {
    if (!equip.piece) return null;

    const armorMaterial = getArmorMaterial(category);
    if (!armorMaterial) return null;

    return `${prefix} ${armorMaterial} ${sealToGearMap.armor[equip.piece]}`;
  }

  if (equip.category === "weapon") {
    const weaponType = getWeaponType(name, category);
    if (!weaponType) return null;

    return `${prefix} ${sealToGearMap.weapon[weaponType]}`;
  }

  const accessoryType = getAccessoryType(name, category);
  if (!accessoryType) return null;

  return `${prefix} ${sealToGearMap.jewelry[accessoryType]}`;
}
```

Then replace the body of `resolveDelphinadManaSealName` with:

```ts
export function resolveDelphinadManaSealName(
  context: ManaSealItemContext,
): string | null {
  return resolveTieredManaSealName("delphinad", context);
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm -F @acme/tanstack-start test:regrade
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/tanstack-start/src/lib/mana-seal.ts apps/tanstack-start/src/lib/regrade.test.ts
git commit -m "feat: resolve ayanad mana seals"
```

## Task 5: Upgrade Chain Descriptors

**Files:**
- Modify: `apps/tanstack-start/src/lib/regrade.ts`
- Modify: `apps/tanstack-start/src/lib/regrade.test.ts`

- [ ] **Step 1: Add tests for deterministic name mapping**

Append to `apps/tanstack-start/src/lib/regrade.test.ts`:

```ts
import {
  getObsidianT3Name,
  getUpgradeFamilyForItem,
  parseMagnificentVariant,
} from "./regrade.ts";

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
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
pnpm -F @acme/tanstack-start test:regrade
```

Expected: fail because mapping helpers are missing.

- [ ] **Step 3: Add name mapping helpers**

Append to `apps/tanstack-start/src/lib/regrade.ts`:

```ts
export interface MagnificentVariantParts {
  prefix: string;
  piece: string;
}

export function getUpgradeFamilyForItem(name: string): RegradeFamily | null {
  if (name.startsWith("Obsidian ")) return "obsidian-t1";
  if (name.includes("Magnificent ")) return "magnificent";
  return null;
}

export function getObsidianT2Name(name: string): string | null {
  if (!name.startsWith("Obsidian ")) return null;
  return name.replace(/^Obsidian /, "Ominous Obsidian ");
}

export function getObsidianT3Name(name: string): string | null {
  if (!name.startsWith("Obsidian ")) return null;
  return name.replace(/^Obsidian /, "Cursed Obsidian ");
}

export function parseMagnificentVariant(
  name: string,
): MagnificentVariantParts | null {
  const match = /^Magnificent\s+(.+?)\s+([^ ]+)$/.exec(name.trim());
  if (!match) return null;
  return {
    prefix: match[1] ?? "",
    piece: match[2] ?? "",
  };
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm -F @acme/tanstack-start test:regrade
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/tanstack-start/src/lib/regrade.ts apps/tanstack-start/src/lib/regrade.test.ts
git commit -m "feat: map regrade upgrade targets"
```

## Task 6: Regrade Route Shell and Admin Navigation

**Files:**
- Create: `apps/tanstack-start/src/routes/regrade.tsx`
- Modify: `apps/tanstack-start/src/routes/__root.tsx`

- [ ] **Step 1: Create route shell**

Create `apps/tanstack-start/src/routes/regrade.tsx`:

```tsx
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { Badge } from "@acme/ui/badge";
import { Input } from "@acme/ui/input";
import { Label } from "@acme/ui/label";

import { ItemIcon } from "~/component/item-icon";
import { buildMetaTags, buildPageTitle } from "~/lib/metadata";
import { getSupportedRegradeItems } from "~/lib/regrade";

export const Route = createFileRoute("/regrade")({
  head: () => ({
    meta: buildMetaTags({
      title: buildPageTitle("Regrade"),
      description:
        "Calculate regrade cost, expected value, and silver per labor for selected gear.",
    }),
  }),
  loader: async ({ context }) => {
    await context.queryClient.fetchQuery(
      context.trpc.auth.requireAdmin.queryOptions(),
    );
    await context.queryClient.fetchQuery(
      context.trpc.profile.getUserData.queryOptions(),
    );
  },
  component: RegradePage,
});

function RegradePage() {
  const supportedItems = useMemo(() => getSupportedRegradeItems(), []);
  const [query, setQuery] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<number | null>(
    supportedItems[0]?.id ?? null,
  );
  const selectedItem =
    supportedItems.find((item) => item.id === selectedItemId) ??
    supportedItems[0] ??
    null;
  const filteredItems = supportedItems.filter((item) =>
    item.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <main className="container py-10">
      <div className="mb-6 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Regrade</h1>
          <Badge variant="secondary">
            {supportedItems.length.toLocaleString()} bases
          </Badge>
        </div>
        <p className="text-muted-foreground max-w-3xl text-sm">
          Compare expected regrade cost, upgrade cost, EV, and silver per labor
          for Obsidian T1 and Magnificent gear.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="regrade-item-search">Base item</Label>
            <Input
              id="regrade-item-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search Obsidian Shield..."
            />
          </div>
          <div className="max-h-[560px] overflow-auto rounded-md border">
            {filteredItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedItemId(item.id)}
                className={`flex w-full items-center gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 ${
                  selectedItem?.id === item.id ? "bg-muted" : "hover:bg-muted/60"
                }`}
              >
                <ItemIcon icon={item.icon} name={item.name} size="sm" />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <span className="text-muted-foreground text-xs">
                  {item.family === "obsidian-t1" ? "Obsidian" : "Magnificent"}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="rounded-md border p-4">
          {selectedItem ? (
            <div className="flex items-center gap-3">
              <ItemIcon
                icon={selectedItem.icon}
                name={selectedItem.name}
                size="lg"
              />
              <div>
                <h2 className="text-xl font-semibold">{selectedItem.name}</h2>
                <p className="text-muted-foreground text-sm">
                  {selectedItem.type} · level {selectedItem.level} · slot{" "}
                  {selectedItem.slot}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              No supported regrade item found.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Add nav item**

Modify `NAV_ITEMS` in `apps/tanstack-start/src/routes/__root.tsx`:

```ts
const NAV_ITEMS = [
  { to: "/craft", label: "Craft", access: "member" },
  { to: "/item", label: "Items", access: "member" },
  { to: "/trade-packs", label: "Trade Packs", access: "member" },
  { to: "/costume-planner", label: "Costume Planner", access: "member" },
  { to: "/simulator", label: "Simulator", access: "admin" },
  { to: "/regrade", label: "Regrade", access: "admin" },
  { to: "/shoplists", label: "Shopping Lists", access: "member" },
  { to: "/profile", label: "Profile", access: "member" },
] as const;
```

- [ ] **Step 3: Typecheck**

Run:

```bash
pnpm -F @acme/tanstack-start typecheck
```

Expected: pass. TanStack route generation may update `routeTree.gen.ts`; include it if generated.

- [ ] **Step 4: Commit**

```bash
git add apps/tanstack-start/src/routes/regrade.tsx apps/tanstack-start/src/routes/__root.tsx apps/tanstack-start/src/routeTree.gen.ts
git commit -m "feat: add regrade route"
```

## Task 7: Wire Prices, Revenue Inputs, and Result Rows

**Files:**
- Modify: `apps/tanstack-start/src/routes/regrade.tsx`

- [ ] **Step 1: Add route data queries and local state**

In `RegradePage`, add `useTRPC`, `useUserData`, `useQuery`, and state for:

```ts
const TARGET_GRADES = [3, 4, 5, 6, 7, 8, 9, 10, 11] as const;
const [saleValuesByGradeInput, setSaleValuesByGradeInput] = useState<
  Record<number, string>
>({});
const [glowingProcEnabled, setGlowingProcEnabled] = useState(false);
const [ayanadTargetMode, setAyanadTargetMode] = useState<"specific" | "any">(
  "specific",
);
const [ayanadTargetItemId, setAyanadTargetItemId] = useState<number | null>(null);
```

- [ ] **Step 2: Fetch consumable prices**

Use `regradeData.scrolls` and `regradeData.charms` IDs:

```ts
const consumableItemIds = useMemo(
  () => [
    ...regradeData.scrolls.map((scroll) => scroll.id),
    ...regradeData.charms.map((charm) => charm.id),
  ],
  [],
);
const { data: consumablePrices = [] } = useQuery(
  trpc.items.pricesBatch.queryOptions(consumableItemIds),
);
const consumablePriceMap = useMemo<ConsumablePriceMap>(() => {
  return new Map(
    consumablePrices.flatMap((price) => {
      const override = overrideMap.get(price.itemId);
      const resolved = override ?? getMarketPrice(price);
      return resolved > 0 ? [[price.itemId, resolved] as const] : [];
    }),
  );
}, [consumablePrices, overrideMap]);
```

Use `getMarketPrice` from the existing simulator upgrade pricing helper.

- [ ] **Step 3: Build manual sale value map**

Add:

```ts
const saleValuesByGrade = useMemo<GradeSaleValueMap>(() => {
  return new Map(
    Object.entries(saleValuesByGradeInput).flatMap(([grade, raw]) => {
      const value = Number.parseFloat(raw);
      return Number.isFinite(value) && value > 0
        ? [[Number(grade), value] as const]
        : [];
    }),
  );
}, [saleValuesByGradeInput]);
```

- [ ] **Step 4: Render sale value inputs and placeholder results**

Below the selected item header, render:

```tsx
<div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
  {TARGET_GRADES.map((grade) => (
    <label key={grade} className="space-y-1 text-sm">
      <span className="text-muted-foreground">
        {regradeData.grades[grade]?.name ?? `Grade ${grade}`} sale value
      </span>
      <Input
        inputMode="decimal"
        value={saleValuesByGradeInput[grade] ?? ""}
        onChange={(event) =>
          setSaleValuesByGradeInput((current) => ({
            ...current,
            [grade]: event.target.value,
          }))
        }
        placeholder="Gold"
      />
    </label>
  ))}
</div>
```

- [ ] **Step 5: Commit**

```bash
git add apps/tanstack-start/src/routes/regrade.tsx
git commit -m "feat: add regrade pricing inputs"
```

## Task 8: Craft and Upgrade Cost Integration

**Files:**
- Modify: `apps/tanstack-start/src/routes/regrade.tsx`
- Optionally modify: `apps/tanstack-start/src/lib/regrade.ts`

- [ ] **Step 1: Fetch base craft data**

When `selectedItem` exists:

```ts
const baseCraftQuery = useQuery({
  ...trpc.crafts.forItem.queryOptions(selectedItem?.id ?? -1),
  enabled: selectedItem != null,
});
```

- [ ] **Step 2: Compute direct base recraft cost**

Use the cheapest craft from `baseCraftQuery.data.crafts`, direct materials only, and `getItemPrice` from `simulator-upgrade-pricing`.

Implementation shape:

```ts
const baseRecraft = useMemo(() => {
  const data = baseCraftQuery.data;
  if (!selectedItem || !data?.crafts.length) return null;
  const priceMap = new Map(data.prices.map((price) => [price.itemId, price]));
  const craft = pickCheapestCraftForItem(
    data.crafts,
    selectedItem.id,
    {},
    priceMap,
    overrideMap,
    {},
  );
  const cost = craft.materials.reduce(
    (sum, { item, amount }) =>
      sum + getItemPrice(item.id, priceMap, overrideMap) * amount,
    0,
  );
  return {
    craft,
    costGold: cost,
    labor: getDiscountedLabor(
      craft.craft.labor,
      craft.craft.proficiency,
      proficiencyMap,
    ),
  };
}, [baseCraftQuery.data, overrideMap, proficiencyMap, selectedItem]);
```

- [ ] **Step 3: Fetch upgrade craft data**

For Obsidian:
- look up `getObsidianT2Name(selectedItem.name)` and `getObsidianT3Name(selectedItem.name)` using `trpc.items.byName`.
- fetch `crafts.forItem` for each exact item.

For Magnificent:
- find upgrade crafts by reverse craft materials:
  - For v1 route code, query `crafts.forItem` for known sealed target item names discovered through item search and filter crafts whose materials contain the currently upgraded item.
  - If this becomes too awkward in the route, add an API helper in a follow-up task rather than hardcoding recipes.

- [ ] **Step 4: Compute upgrade cost**

Use simulator-style helpers:
- `pickCheapestCraftForItem`
- `getCraftEntryUnitCost`
- `deepCraftCost`
- `mergePriceMaps`
- `buildRecommendedModes`

Exclude the consumed gear material from each upgrade step before summing cost/labor.

- [ ] **Step 5: Add unavailable state**

If base recraft or upgrade chain cannot be resolved, show:

```tsx
<p className="text-muted-foreground mt-4 text-sm">
  Missing craft or price data for this upgrade path.
</p>
```

- [ ] **Step 6: Commit**

```bash
git add apps/tanstack-start/src/routes/regrade.tsx apps/tanstack-start/src/lib/regrade.ts
git commit -m "feat: cost regrade upgrade chains"
```

## Task 9: Result Table and Details

**Files:**
- Modify: `apps/tanstack-start/src/routes/regrade.tsx`

- [ ] **Step 1: Compute target-grade results**

Use `solveExpectedRegradeToTarget`:

```ts
const regradeResults = useMemo(() => {
  if (!selectedItem || !baseRecraft || !upgradeCost) return [];
  return TARGET_GRADES.map((targetGrade) =>
    solveExpectedRegradeToTarget({
      item: selectedItem,
      targetGrade,
      baseRecraftCostGold: baseRecraft.costGold,
      baseRecraftLabor: baseRecraft.labor,
      upgradeCostGold: upgradeCost.costGold,
      upgradeLabor: upgradeCost.labor,
      saleValuesByGrade,
      consumablePrices: consumablePriceMap,
      candidateCharmIds: regradeData.charms.map((charm) => charm.id),
    }),
  );
}, [
  baseRecraft,
  consumablePriceMap,
  saleValuesByGrade,
  selectedItem,
  upgradeCost,
]);
```

- [ ] **Step 2: Render result table**

Render a table with:
- Target
- Expected cost
- Upgrade cost
- Expected revenue
- EV
- Labor
- Silver/labor
- Strategy

Use existing table classes or `@acme/ui/table` if nearby pages use it.

- [ ] **Step 3: Render skipped reasons**

For selected row:

```tsx
{selectedResult.skippedReasons.length ? (
  <div className="mt-4 rounded-md border border-dashed p-3">
    <h3 className="text-sm font-medium">Skipped options</h3>
    <ul className="text-muted-foreground mt-2 space-y-1 text-sm">
      {selectedResult.skippedReasons.map((reason) => (
        <li key={reason}>{reason}</li>
      ))}
    </ul>
  </div>
) : null}
```

- [ ] **Step 4: Render selected steps**

Show each selected step with from grade, scroll, charm, attempt cost, and expected value.

- [ ] **Step 5: Commit**

```bash
git add apps/tanstack-start/src/routes/regrade.tsx
git commit -m "feat: show regrade expected value table"
```

## Task 10: Ayanad Variant Mode and Reroll Cost

**Files:**
- Modify: `apps/tanstack-start/src/routes/regrade.tsx`
- Modify: `apps/tanstack-start/src/lib/regrade.ts`

- [ ] **Step 1: Add Ayanad mode controls**

Show only when `selectedItem.family === "magnificent"`:

```tsx
<div className="mt-4 flex flex-wrap items-center gap-3">
  <Button
    type="button"
    variant={ayanadTargetMode === "specific" ? "default" : "outline"}
    onClick={() => setAyanadTargetMode("specific")}
  >
    Specific Ayanad
  </Button>
  <Button
    type="button"
    variant={ayanadTargetMode === "any" ? "default" : "outline"}
    onClick={() => setAyanadTargetMode("any")}
  >
    Any Ayanad
  </Button>
</div>
```

- [ ] **Step 2: Implement any-mode revenue**

For Magnificent `any`, resolve all possible Ayanad variants for the piece and use the cheapest manually priced variant. If no variants are priced, mark result unavailable for EV.

- [ ] **Step 3: Implement specific-mode reroll expected cost**

For specific Ayanad:
- variant count is `variantsByTier.ayanad` from `salvage.ts`.
- expected failed rerolls is `variantsByTier.ayanad - 1`.
- reroll material cost is expected failed rerolls times resolved Ayanad mana seal cost.
- reroll labor is expected failed rerolls times `(sealCraftLabor + MANA_SEAL_USE_LABOR)`.
- Include optional Glowing proc with the existing effective success formula if enabled.

- [ ] **Step 4: Commit**

```bash
git add apps/tanstack-start/src/routes/regrade.tsx apps/tanstack-start/src/lib/regrade.ts
git commit -m "feat: add ayanad reroll modes"
```

## Task 11: Final Verification

**Files:**
- All touched files

- [ ] **Step 1: Run regrade tests**

Run:

```bash
pnpm -F @acme/tanstack-start test:regrade
```

Expected: pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm -F @acme/tanstack-start typecheck
```

Expected: pass.

- [ ] **Step 3: Run lint**

Run:

```bash
pnpm -F @acme/tanstack-start lint
```

Expected: pass.

- [ ] **Step 4: Manually smoke test**

Run the dev server:

```bash
pnpm -F @acme/tanstack-start dev
```

Open `/regrade` as an admin user and verify:
- nav item appears for admin users.
- `Obsidian Shield` can be selected.
- `Magnificent Sunset Bow` can be selected.
- sale value inputs update EV rows.
- missing price explanations render instead of silently using zero.
- target rows show values for Rare through Mythic.
- Magnificent-specific Ayanad mode controls appear.
- Obsidian does not show Ayanad controls.

- [ ] **Step 5: Commit final fixes**

```bash
git add apps/tanstack-start
git commit -m "chore: verify regrade calculator"
```

## Acceptance Criteria

- `/regrade` is admin-only and visible in admin nav.
- User can select a concrete supported base item.
- Obsidian T1 candidates exclude Ominous and Cursed Obsidian.
- Magnificent candidates exclude pet and non-normal Magnificent records.
- Results start from Grand and compare target grades Rare through Mythic.
- Destruction restarts from Grand and includes direct base recraft cost.
- Missing prices exclude affected options and are displayed.
- EV uses manual grade-specific sale values.
- Resplendent over-target results use the actual landing grade value.
- Magnificent upgrades through Epherium, Delphinad, then Ayanad.
- Obsidian upgrades to Cursed Obsidian T3.
- Specific Ayanad mode includes expected mana-seal reroll cost and 10 labor per seal use.
- Any Ayanad mode uses cheapest priced variant value.
