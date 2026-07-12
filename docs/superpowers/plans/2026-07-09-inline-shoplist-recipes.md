# Inline Shoplist Recipes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add view-only inline recipe inspection to saved shoplist shopping-item rows for remaining craftable buy items.

**Architecture:** Keep backend data unchanged. Add a tested pure requirement flattener to `craft-optimizer.ts`, then use client-side lazy `crafts.forItem(itemId)` queries inside a local inline expansion component on `shoplists.$listId.tsx`. Expansion, recipe selection, Buy/Craft modes, and collapsed recipe cards remain local UI state keyed by item ID.

**Tech Stack:** TanStack Start, React 19, TanStack Query, tRPC, TypeScript, Node built-in test runner.

---

## File Structure

- Modify `apps/tanstack-start/src/lib/craft-optimizer.ts`: export a reusable `buildCraftRequirementSummary` helper that flattens raw materials, labor, produced quantity, batches, and material cost for a selected recipe tree.
- Create `apps/tanstack-start/src/lib/craft-optimizer.test.ts`: focused Node tests for batch rounding, selected subcraft variants, buy-mode fallback, price overrides, and proficiency discounts.
- Modify `apps/tanstack-start/package.json`: add `test:craft-optimizer`.
- Modify `apps/tanstack-start/src/routes/shoplists.$listId.tsx`: fetch craftable item IDs, add local inline recipe state, add the `Recipes` action to eligible item rows, and render the inline lazy recipe preview.

## Task 1: Add Failing Craft Requirement Tests

**Files:**
- Create: `apps/tanstack-start/src/lib/craft-optimizer.test.ts`
- Modify: `apps/tanstack-start/package.json`

- [ ] **Step 1: Add the test script**

In `apps/tanstack-start/package.json`, add this script after `test:trade-packs`:

```json
"test:craft-optimizer": "node --experimental-strip-types --test src/lib/craft-optimizer.test.ts",
```

- [ ] **Step 2: Create failing tests for requirement flattening**

Create `apps/tanstack-start/src/lib/craft-optimizer.test.ts` with:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildCraftRequirementSummary,
  type CraftEntryLike,
  type ModesMap,
  type SelectedCraftMap,
} from "./craft-optimizer.ts";

type TestEntry = CraftEntryLike & {
  materials: {
    item: { id: number; name: string; icon: string | null };
    amount: number;
  }[];
};

const priceMap = new Map([
  [100, { avg24h: "50", avg7d: null, avg30d: null }],
  [200, { avg24h: "9", avg7d: null, avg30d: null }],
  [300, { avg24h: "7", avg7d: null, avg30d: null }],
  [400, { avg24h: "2", avg7d: null, avg30d: null }],
  [500, { avg24h: "4", avg7d: null, avg30d: null }],
]);

const rootEntry: TestEntry = {
  craft: {
    id: 1,
    name: "Root Recipe",
    labor: 20,
    proficiency: "Alchemy",
  },
  materials: [
    { item: { id: 200, name: "Intermediate", icon: null }, amount: 3 },
    { item: { id: 300, name: "Direct Raw", icon: null }, amount: 1 },
  ],
  products: [{ item: { id: 100 }, amount: 2 }],
};

const childEntry: TestEntry = {
  craft: {
    id: 2,
    name: "Child Recipe",
    labor: 10,
    proficiency: "Metalwork",
  },
  materials: [{ item: { id: 400, name: "Ore", icon: null }, amount: 5 }],
  products: [{ item: { id: 200 }, amount: 4 }],
};

const alternateChildEntry: TestEntry = {
  craft: {
    id: 3,
    name: "Alternate Child Recipe",
    labor: 2,
    proficiency: "Metalwork",
  },
  materials: [{ item: { id: 500, name: "Alternate Ore", icon: null }, amount: 2 }],
  products: [{ item: { id: 200 }, amount: 1 }],
};

function summarize(options?: {
  modes?: ModesMap;
  selectedCrafts?: SelectedCraftMap;
  overrideMap?: Map<number, number>;
  proficiencyMap?: Map<string, number>;
}) {
  return buildCraftRequirementSummary({
    entry: rootEntry,
    producedItemId: 100,
    requiredQuantity: 3,
    subcraftMap: {
      200: [childEntry, alternateChildEntry],
    },
    modes: options?.modes ?? {},
    selectedCrafts: options?.selectedCrafts ?? {},
    priceMap,
    overrideMap: options?.overrideMap ?? new Map(),
    proficiencyMap: options?.proficiencyMap ?? new Map(),
  });
}

void test("flattens raw materials using ceil batches for root and crafted sub-ingredients", () => {
  const summary = summarize({ modes: { 200: "craft" } });

  assert.equal(summary.batches, 2);
  assert.equal(summary.producedAmount, 2);
  assert.equal(summary.producedQuantity, 4);
  assert.deepEqual(
    summary.materials.map((material) => ({
      itemId: material.item.id,
      amount: material.totalAmount,
    })),
    [
      { itemId: 300, amount: 2 },
      { itemId: 400, amount: 10 },
    ],
  );
  assert.deepEqual(summary.laborByProficiency, [
    { proficiency: "Alchemy", labor: 40 },
    { proficiency: "Metalwork", labor: 20 },
  ]);
  assert.equal(summary.materialCost, 34);
  assert.equal(summary.totalLabor, 60);
});

void test("buy mode leaves craftable ingredients in the raw material list", () => {
  const summary = summarize({ modes: { 200: "buy" } });

  assert.deepEqual(
    summary.materials.map((material) => ({
      itemId: material.item.id,
      amount: material.totalAmount,
    })),
    [
      { itemId: 200, amount: 6 },
      { itemId: 300, amount: 2 },
    ],
  );
  assert.deepEqual(summary.laborByProficiency, [
    { proficiency: "Alchemy", labor: 40 },
  ]);
  assert.equal(summary.materialCost, 68);
});

void test("selected subcraft variants drive raw materials and labor", () => {
  const summary = summarize({
    modes: { 200: "craft" },
    selectedCrafts: { 200: 3 },
  });

  assert.deepEqual(
    summary.materials.map((material) => ({
      itemId: material.item.id,
      amount: material.totalAmount,
    })),
    [
      { itemId: 300, amount: 2 },
      { itemId: 500, amount: 12 },
    ],
  );
  assert.deepEqual(summary.laborByProficiency, [
    { proficiency: "Alchemy", labor: 40 },
    { proficiency: "Metalwork", labor: 12 },
  ]);
  assert.equal(summary.materialCost, 62);
});

void test("uses price overrides and discounted labor in the summary", () => {
  const summary = summarize({
    modes: { 200: "craft" },
    overrideMap: new Map([[400, 1]]),
    proficiencyMap: new Map([
      ["Alchemy", 230000],
      ["Metalwork", 50000],
    ]),
  });

  assert.deepEqual(summary.laborByProficiency, [
    { proficiency: "Alchemy", labor: 24 },
    { proficiency: "Metalwork", labor: 18 },
  ]);
  assert.equal(summary.materialCost, 24);
  assert.equal(summary.totalLabor, 42);
});
```

- [ ] **Step 3: Run the new test and confirm it fails**

Run:

```bash
pnpm -F @acme/tanstack-start test:craft-optimizer
```

Expected: FAIL because `buildCraftRequirementSummary` is not exported.

## Task 2: Implement Craft Requirement Summary Helper

**Files:**
- Modify: `apps/tanstack-start/src/lib/craft-optimizer.ts`
- Test: `apps/tanstack-start/src/lib/craft-optimizer.test.ts`

- [ ] **Step 1: Add exported requirement summary types**

In `apps/tanstack-start/src/lib/craft-optimizer.ts`, after `export interface AutoPlan<T extends CraftEntryLike>`, add:

```ts
export interface FlattenedMaterialRequirement<TItem = CraftMaterialLike["item"]> {
  item: TItem;
  totalAmount: number;
}

export interface LaborRequirement {
  proficiency: string;
  labor: number;
}

export interface CraftRequirementSummary<TItem = CraftMaterialLike["item"]> {
  batches: number;
  producedAmount: number;
  producedQuantity: number;
  materials: FlattenedMaterialRequirement<TItem>[];
  laborByProficiency: LaborRequirement[];
  materialCost: number;
  totalLabor: number;
}
```

- [ ] **Step 2: Add a helper to increment maps**

In `apps/tanstack-start/src/lib/craft-optimizer.ts`, after `mergeSelectedCrafts`, add:

```ts
function addMapValue<TKey>(map: Map<TKey, number>, key: TKey, amount: number) {
  map.set(key, (map.get(key) ?? 0) + amount);
}
```

- [ ] **Step 3: Add `buildCraftRequirementSummary`**

In `apps/tanstack-start/src/lib/craft-optimizer.ts`, after `getSelectedEntry`, add:

```ts
export function buildCraftRequirementSummary<T extends CraftEntryLike>(input: {
  entry: T;
  producedItemId: number;
  requiredQuantity: number;
  subcraftMap: SubcraftMap<T>;
  modes: ModesMap;
  selectedCrafts: SelectedCraftMap;
  priceMap: PriceMap;
  overrideMap: OverrideMap;
  proficiencyMap: ProficiencyMap;
  maxDepth?: number;
}): CraftRequirementSummary<T["materials"][number]["item"]> {
  const maxDepth = input.maxDepth ?? MAX_CRAFT_DEPTH;
  const materialMap = new Map<
    number,
    FlattenedMaterialRequirement<T["materials"][number]["item"]>
  >();
  const laborMap = new Map<string, number>();

  const addRawMaterial = (
    item: T["materials"][number]["item"],
    amount: number,
  ) => {
    const roundedAmount = Math.ceil(Math.max(0, amount));
    if (roundedAmount <= 0) return;
    const existing = materialMap.get(item.id);
    if (existing) {
      existing.totalAmount += roundedAmount;
      return;
    }
    materialMap.set(item.id, { item, totalAmount: roundedAmount });
  };

  const visitEntry = (
    entry: T,
    producedItemId: number,
    requiredQuantity: number,
    depth: number,
    visited: Set<string>,
  ) => {
    const producedAmount = getProducedAmount(entry, producedItemId);
    const batches = Math.ceil(
      Math.max(0, requiredQuantity) / Math.max(1, producedAmount),
    );
    if (batches <= 0) return;

    if (entry.craft.labor > 0) {
      addMapValue(
        laborMap,
        entry.craft.proficiency ?? "Unknown",
        batches *
          getDiscountedLabor(
            entry.craft.labor,
            entry.craft.proficiency,
            input.proficiencyMap,
          ),
      );
    }

    for (const { item, amount } of entry.materials) {
      const requiredMaterialAmount = amount * batches;
      const isCraftable = depth < maxDepth && !!input.subcraftMap[item.id]?.length;
      const mode = input.modes[item.id] ?? "buy";
      const cycleKey = `${item.id}:${input.selectedCrafts[item.id] ?? "preferred"}`;

      if (!isCraftable || mode === "buy" || visited.has(cycleKey)) {
        addRawMaterial(item, requiredMaterialAmount);
        continue;
      }

      const subEntry = getSelectedEntry(
        item.id,
        input.subcraftMap,
        input.selectedCrafts,
      );
      if (!subEntry) {
        addRawMaterial(item, requiredMaterialAmount);
        continue;
      }

      visitEntry(
        subEntry,
        item.id,
        requiredMaterialAmount,
        depth + 1,
        new Set([...visited, cycleKey]),
      );
    }
  };

  const producedAmount = getProducedAmount(input.entry, input.producedItemId);
  const batches = Math.ceil(
    Math.max(0, input.requiredQuantity) / Math.max(1, producedAmount),
  );
  visitEntry(input.entry, input.producedItemId, input.requiredQuantity, 0, new Set());

  const materials = Array.from(materialMap.values()).sort((left, right) =>
    (left.item.name ?? "").localeCompare(right.item.name ?? "") ||
    left.item.id - right.item.id,
  );
  const laborByProficiency = Array.from(laborMap.entries())
    .map(([proficiency, labor]) => ({ proficiency, labor }))
    .sort((left, right) => left.proficiency.localeCompare(right.proficiency));
  const materialCost = materials.reduce(
    (sum, material) =>
      sum +
      material.totalAmount *
        getItemPrice(material.item.id, input.priceMap, input.overrideMap),
    0,
  );
  const totalLabor = laborByProficiency.reduce(
    (sum, entry) => sum + entry.labor,
    0,
  );

  return {
    batches,
    producedAmount,
    producedQuantity: batches * producedAmount,
    materials,
    laborByProficiency,
    materialCost,
    totalLabor,
  };
}
```

- [ ] **Step 4: Run the helper test and confirm it passes**

Run:

```bash
pnpm -F @acme/tanstack-start test:craft-optimizer
```

Expected: PASS.

- [ ] **Step 5: Commit the helper**

Run:

```bash
git add apps/tanstack-start/src/lib/craft-optimizer.ts apps/tanstack-start/src/lib/craft-optimizer.test.ts apps/tanstack-start/package.json
git commit -m "Add craft requirement summary helper"
```

## Task 3: Add Inline Recipe State And Craftable Affordance

**Files:**
- Modify: `apps/tanstack-start/src/routes/shoplists.$listId.tsx`

- [ ] **Step 1: Extend imports**

In `apps/tanstack-start/src/routes/shoplists.$listId.tsx`, change imports so the file has:

```ts
import type { inferProcedureOutput } from "@trpc/server";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Fragment, useMemo, useState } from "react";
```

Add:

```ts
import type { AppRouter } from "@acme/api";
```

Add recipe component imports:

```ts
import { ProficiencyBadge } from "~/component/proficiency";
import {
  CraftModeToggle,
  RecipeCardShell,
  RecipeCollapseToggle,
  RecipeHeader,
  RecipeItemRow,
  RecipeLegend,
} from "~/component/recipe-breakdown";
```

Add optimizer imports:

```ts
import type {
  ModesMap,
  PriceMap,
  SelectedCraftMap,
} from "~/lib/craft-optimizer";
import {
  buildCraftRequirementSummary,
  computeManualCraftMetrics,
  getItemPrice,
  getProducedAmount,
  getSelectedEntry,
  MAX_CRAFT_DEPTH,
} from "~/lib/craft-optimizer";
```

- [ ] **Step 2: Remove duplicate local price helpers**

Delete local `parseFinitePrice` and `getMarketPrice` from `shoplists.$listId.tsx`. Replace remaining local `getMarketPrice` usage with the imported `getItemPrice(itemId, priceMap, overrideMap)` where an item ID, price map, and override map are available.

- [ ] **Step 3: Add route-level craftable and expansion state**

Inside `ShoppingListDetailPage`, after `const { overrideMap } = useUserData();`, change it to:

```ts
const { proficiencyMap, overrideMap } = useUserData();
```

Then add:

```ts
const [expandedRecipeItemIds, setExpandedRecipeItemIds] = useState<Set<number>>(
  () => new Set(),
);
const [recipeCraftModes, setRecipeCraftModes] = useState<Record<number, ModesMap>>(
  () => ({}),
);
const [recipeSelectedCrafts, setRecipeSelectedCrafts] = useState<
  Record<number, SelectedCraftMap>
>(() => ({}));
const [collapsedRecipeCraftIds, setCollapsedRecipeCraftIds] = useState<
  Record<number, Set<number>>
>(() => ({}));
```

After the existing `pricesBatch` query, add:

```ts
const { data: craftableItems = [] } = useQuery(
  trpc.items.craftable.queryOptions(),
);
```

Add these derived values:

```ts
const craftableItemIds = useMemo(
  () => new Set(craftableItems.map((item) => item.id)),
  [craftableItems],
);
const savedCraftModes = useMemo<ModesMap>(
  () =>
    Object.fromEntries(
      data.list.craftModeItemIds.map((itemId) => [itemId, "craft" as const]),
    ),
  [data.list.craftModeItemIds],
);
```

- [ ] **Step 4: Add local state mutators**

Inside `ShoppingListDetailPage`, before `commitItemProgress`, add:

```ts
const toggleRecipeExpansion = (itemId: number) => {
  setExpandedRecipeItemIds((current) => {
    const next = new Set(current);
    if (next.has(itemId)) next.delete(itemId);
    else next.add(itemId);
    return next;
  });
};

const setInlineCraftModes = (itemId: number, modes: ModesMap) => {
  setRecipeCraftModes((current) => ({
    ...current,
    [itemId]: modes,
  }));
};

const setInlineSelectedCrafts = (
  itemId: number,
  selectedCrafts: SelectedCraftMap,
) => {
  setRecipeSelectedCrafts((current) => ({
    ...current,
    [itemId]: selectedCrafts,
  }));
};

const toggleInlineCollapsedCraft = (itemId: number, craftId: number) => {
  setCollapsedRecipeCraftIds((current) => {
    const nextSet = new Set(current[itemId] ?? []);
    if (nextSet.has(craftId)) nextSet.delete(craftId);
    else nextSet.add(craftId);
    return {
      ...current,
      [itemId]: nextSet,
    };
  });
};
```

- [ ] **Step 5: Typecheck the state changes**

Run:

```bash
pnpm -F @acme/tanstack-start typecheck
```

Expected: PASS or existing unrelated errors only. If unrelated errors exist, capture the first error line before continuing.

## Task 4: Implement Inline Recipe Preview Components

**Files:**
- Modify: `apps/tanstack-start/src/routes/shoplists.$listId.tsx`

- [ ] **Step 1: Add tRPC output types**

Near the helper type section in `shoplists.$listId.tsx`, after constants, add:

```ts
type ForItemOutput = NonNullable<
  inferProcedureOutput<AppRouter["crafts"]["forItem"]>
>;
type InlineRecipeEntry = ForItemOutput["crafts"][number];
type InlineSubcraftEntry = ForItemOutput["subcraftsByItemId"][number][number];
type InlineSubcraftMap = Record<number, InlineSubcraftEntry[]>;
type InlineRecipeLike = InlineRecipeEntry | InlineSubcraftEntry;
```

- [ ] **Step 2: Add recipe selection helper**

Add below `RowLinkOrContent`:

```ts
function getInlineSelectedEntry(
  itemId: number,
  entries: InlineRecipeEntry[],
  selectedCrafts: SelectedCraftMap,
): InlineRecipeEntry | null {
  const selectedCraftId = selectedCrafts[itemId];
  if (selectedCraftId != null) {
    const selected = entries.find((entry) => entry.craft.id === selectedCraftId);
    if (selected) return selected;
  }
  return entries[0] ?? null;
}
```

- [ ] **Step 3: Add `InlineRecipePreview`**

Add this component above `HeaderActionMenu`:

```tsx
function InlineRecipePreview({
  itemId,
  itemName,
  remainingQuantity,
  initialModes,
  modes,
  selectedCrafts,
  collapsedCraftIds,
  priceMap,
  overrideMap,
  proficiencyMap,
  setModes,
  setSelectedCrafts,
  toggleCollapsed,
}: {
  itemId: number;
  itemName: string;
  remainingQuantity: number;
  initialModes: ModesMap;
  modes?: ModesMap;
  selectedCrafts?: SelectedCraftMap;
  collapsedCraftIds?: Set<number>;
  priceMap: PriceMap;
  overrideMap: Map<number, number>;
  proficiencyMap: Map<string, number>;
  setModes: (modes: ModesMap) => void;
  setSelectedCrafts: (selectedCrafts: SelectedCraftMap) => void;
  toggleCollapsed: (craftId: number) => void;
}) {
  const trpc = useTRPC();
  const effectiveModes = modes ?? initialModes;
  const effectiveSelectedCrafts = selectedCrafts ?? {};
  const craftQuery = useQuery(trpc.crafts.forItem.queryOptions(itemId));
  const craftData = craftQuery.data ?? null;

  if (craftQuery.isLoading) {
    return (
      <div className="bg-muted/20 rounded-lg border px-3 py-3 text-sm">
        Loading recipes for {itemName}...
      </div>
    );
  }

  if (craftQuery.isError) {
    return (
      <div className="bg-muted/20 rounded-lg border px-3 py-3 text-sm">
        Could not load recipes for {itemName}.
      </div>
    );
  }

  if (!craftData || craftData.crafts.length === 0) {
    return (
      <div className="bg-muted/20 rounded-lg border px-3 py-3 text-sm">
        No recipes available.
      </div>
    );
  }

  const selectedEntry =
    getInlineSelectedEntry(itemId, craftData.crafts, effectiveSelectedCrafts) ??
    craftData.crafts[0];
  if (!selectedEntry) {
    return (
      <div className="bg-muted/20 rounded-lg border px-3 py-3 text-sm">
        No recipes available.
      </div>
    );
  }

  const mergedPriceMap: PriceMap = new Map([
    ...priceMap,
    ...craftData.prices.map((price) => [price.itemId, price] as const),
  ]);
  const producedAmount = getProducedAmount(selectedEntry, itemId);
  const summary = buildCraftRequirementSummary({
    entry: selectedEntry,
    producedItemId: itemId,
    requiredQuantity: remainingQuantity,
    subcraftMap: craftData.subcraftsByItemId,
    modes: effectiveModes,
    selectedCrafts: effectiveSelectedCrafts,
    priceMap: mergedPriceMap,
    overrideMap,
    proficiencyMap,
  });
  const buyCost = remainingQuantity * getItemPrice(itemId, mergedPriceMap, overrideMap);
  const craftCost = summary.materialCost;
  const diff = craftCost - buyCost;

  const selectTopRecipe = (craftId: number) => {
    setSelectedCrafts({
      ...effectiveSelectedCrafts,
      [itemId]: craftId,
    });
  };
  const setItemMode = (modeItemId: number, mode: "buy" | "craft") => {
    setModes({
      ...effectiveModes,
      [modeItemId]: mode,
    });
  };

  return (
    <div className="bg-muted/10 rounded-lg border px-3 py-3">
      <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-semibold">Recipe preview</p>
          <p className="text-muted-foreground text-xs">
            {remainingQuantity.toLocaleString()} needed • {summary.batches.toLocaleString()} batch{summary.batches === 1 ? "" : "es"} • produces {summary.producedQuantity.toLocaleString()}
            {summary.producedQuantity > remainingQuantity
              ? ` (${(summary.producedQuantity - remainingQuantity).toLocaleString()} extra)`
              : ""}
          </p>
        </div>
        {craftData.crafts.length > 1 ? (
          <label className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Recipe</span>
            <select
              className="bg-background rounded-md border px-2 py-1 text-sm"
              value={selectedEntry.craft.id}
              onChange={(event) => selectTopRecipe(Number(event.target.value))}
            >
              {craftData.crafts.map((entry) => (
                <option key={entry.craft.id} value={entry.craft.id}>
                  {entry.craft.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(260px,0.75fr)]">
        <InlineRecipeTree
          entry={selectedEntry}
          producedItemId={itemId}
          priceMap={mergedPriceMap}
          overrideMap={overrideMap}
          proficiencyMap={proficiencyMap}
          subcraftMap={craftData.subcraftsByItemId}
          modes={effectiveModes}
          selectedCrafts={effectiveSelectedCrafts}
          setItemMode={setItemMode}
          setSelectedCrafts={setSelectedCrafts}
          collapsedCraftIds={collapsedCraftIds ?? new Set()}
          toggleCollapsed={toggleCollapsed}
        />

        <div className="flex flex-col gap-3">
          <div className="rounded-md border p-3">
            <p className="text-sm font-semibold">Buy vs craft</p>
            <div className="mt-2 flex flex-col gap-1 text-sm tabular-nums">
              <p className="flex justify-between gap-3">
                <span className="text-muted-foreground">Buy remaining</span>
                <span>{buyCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}g</span>
              </p>
              <p className="flex justify-between gap-3">
                <span className="text-muted-foreground">Craft materials</span>
                <span>{craftCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}g</span>
              </p>
              <p className="flex justify-between gap-3 font-medium">
                <span>Difference</span>
                <span className={diff <= 0 ? "text-green-600 dark:text-green-400" : "text-red-500"}>
                  {diff <= 0 ? "Saves " : "Costs "}
                  {Math.abs(diff).toLocaleString(undefined, { maximumFractionDigits: 0 })}g
                </span>
              </p>
            </div>
          </div>

          <div className="rounded-md border p-3">
            <p className="text-sm font-semibold">Raw materials</p>
            {summary.materials.length === 0 ? (
              <p className="text-muted-foreground mt-2 text-sm">No raw materials.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1">
                {summary.materials.map((material) => (
                  <RecipeItemRow
                    key={material.item.id}
                    icon={<ItemIcon icon={"icon" in material.item ? (material.item.icon ?? null) : null} name={material.item.name ?? `Item ${material.item.id}`} />}
                    name={material.item.name ?? `Item ${material.item.id}`}
                    amount={material.totalAmount}
                    value={
                      <span className="text-muted-foreground tabular-nums">
                        {(material.totalAmount * getItemPrice(material.item.id, mergedPriceMap, overrideMap)).toLocaleString(undefined, { maximumFractionDigits: 0 })}g
                      </span>
                    }
                  />
                ))}
              </ul>
            )}
          </div>

          {summary.laborByProficiency.length > 0 ? (
            <div className="rounded-md border p-3">
              <p className="text-sm font-semibold">Labor</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {summary.laborByProficiency.map((entry) => (
                  <span key={entry.proficiency} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs">
                    <ProficiencyBadge proficiency={entry.proficiency} />
                    <span className="tabular-nums">{entry.labor.toLocaleString()}L</span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <RecipeLegend />
    </div>
  );
}
```

- [ ] **Step 4: Add `InlineRecipeTree`**

Add this component below `InlineRecipePreview`:

```tsx
function InlineRecipeTree({
  entry,
  producedItemId,
  priceMap,
  overrideMap,
  proficiencyMap,
  subcraftMap,
  modes,
  selectedCrafts,
  setItemMode,
  setSelectedCrafts,
  collapsedCraftIds,
  toggleCollapsed,
  depth = 0,
}: {
  entry: InlineRecipeLike;
  producedItemId: number;
  priceMap: PriceMap;
  overrideMap: Map<number, number>;
  proficiencyMap: Map<string, number>;
  subcraftMap: InlineSubcraftMap;
  modes: ModesMap;
  selectedCrafts: SelectedCraftMap;
  setItemMode: (itemId: number, mode: "buy" | "craft") => void;
  setSelectedCrafts: (selectedCrafts: SelectedCraftMap) => void;
  collapsedCraftIds: Set<number>;
  toggleCollapsed: (craftId: number) => void;
  depth?: number;
}) {
  const isCollapsed = collapsedCraftIds.has(entry.craft.id);
  const metrics = computeManualCraftMetrics(
    entry,
    producedItemId,
    getItemPrice(producedItemId, priceMap, overrideMap),
    {
      subcraftMap,
      priceMap,
      overrideMap,
      proficiencyMap,
      maxDepth: MAX_CRAFT_DEPTH,
    },
    modes,
    selectedCrafts,
    depth,
  );

  return (
    <RecipeCardShell depth={depth}>
      <RecipeHeader
        depth={depth}
        title={entry.craft.name}
        proficiency={entry.craft.proficiency}
        laborLabel={
          entry.craft.labor > 0
            ? `${metrics.directLabor.toLocaleString()} labor`
            : null
        }
        materialsLabel={`${metrics.materialsCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}g`}
        collapseToggle={
          <RecipeCollapseToggle
            collapsed={isCollapsed}
            onToggle={() => toggleCollapsed(entry.craft.id)}
          />
        }
      />

      {!isCollapsed ? (
        <ul className="flex flex-col gap-1">
          {entry.materials.map(({ item, amount }) => {
            const isCraftable =
              depth < MAX_CRAFT_DEPTH && !!subcraftMap[item.id]?.length;
            const mode = modes[item.id] ?? "buy";
            const subEntry = isCraftable
              ? getSelectedEntry(item.id, subcraftMap, selectedCrafts)
              : null;
            const buyUnit = getItemPrice(item.id, priceMap, overrideMap);
            const craftedMetrics = subEntry
              ? computeManualCraftMetrics(
                  subEntry,
                  item.id,
                  buyUnit,
                  {
                    subcraftMap,
                    priceMap,
                    overrideMap,
                    proficiencyMap,
                    maxDepth: MAX_CRAFT_DEPTH,
                  },
                  modes,
                  selectedCrafts,
                  depth + 1,
                )
              : null;
            const craftUnit = craftedMetrics?.costPerUnit ?? 0;
            const unit = mode === "craft" && isCraftable ? craftUnit : buyUnit;
            const totalDiff =
              isCraftable && buyUnit > 0 ? (buyUnit - craftUnit) * amount : null;

            return (
              <Fragment key={item.id}>
                <RecipeItemRow
                  icon={<ItemIcon icon={item.icon} name={item.name} />}
                  name={item.name}
                  amount={amount}
                  controls={
                    isCraftable ? (
                      <span className="inline-flex items-center gap-2">
                        <CraftModeToggle
                          mode={mode}
                          onBuy={() => setItemMode(item.id, "buy")}
                          onCraft={() => setItemMode(item.id, "craft")}
                        />
                        {mode === "craft" && (subcraftMap[item.id]?.length ?? 0) > 1 ? (
                          <select
                            className="bg-background rounded-md border px-2 py-0.5 text-xs"
                            value={subEntry?.craft.id ?? ""}
                            onChange={(event) =>
                              setSelectedCrafts({
                                ...selectedCrafts,
                                [item.id]: Number(event.target.value),
                              })
                            }
                          >
                            {(subcraftMap[item.id] ?? []).map((candidate) => (
                              <option key={candidate.craft.id} value={candidate.craft.id}>
                                {candidate.craft.name}
                              </option>
                            ))}
                          </select>
                        ) : null}
                      </span>
                    ) : null
                  }
                  value={
                    <span className="text-muted-foreground tabular-nums">
                      {unit.toLocaleString(undefined, { maximumFractionDigits: 0 })}g
                    </span>
                  }
                  diff={
                    totalDiff !== null ? (
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium tabular-nums ${
                          totalDiff > 0
                            ? "bg-green-500/10 text-green-600 dark:text-green-400"
                            : totalDiff < 0
                              ? "bg-red-500/10 text-red-500"
                              : "text-muted-foreground"
                        }`}
                      >
                        {totalDiff > 0
                          ? `↓ ${totalDiff.toLocaleString(undefined, { maximumFractionDigits: 0 })}g`
                          : totalDiff < 0
                            ? `↑ ${Math.abs(totalDiff).toLocaleString(undefined, { maximumFractionDigits: 0 })}g`
                            : "="}
                      </span>
                    ) : null
                  }
                />

                {mode === "craft" && isCraftable && subEntry ? (
                  <li className="border-muted-foreground/20 my-0.5 ml-3 border-l-2 pl-3">
                    <InlineRecipeTree
                      entry={subEntry}
                      producedItemId={item.id}
                      priceMap={priceMap}
                      overrideMap={overrideMap}
                      proficiencyMap={proficiencyMap}
                      subcraftMap={subcraftMap}
                      modes={modes}
                      selectedCrafts={selectedCrafts}
                      setItemMode={setItemMode}
                      setSelectedCrafts={setSelectedCrafts}
                      collapsedCraftIds={collapsedCraftIds}
                      toggleCollapsed={toggleCollapsed}
                      depth={depth + 1}
                    />
                  </li>
                ) : null}
              </Fragment>
            );
          })}
        </ul>
      ) : null}
    </RecipeCardShell>
  );
}
```

- [ ] **Step 5: Typecheck the component additions**

Run:

```bash
pnpm -F @acme/tanstack-start typecheck
```

Expected: PASS or actionable type errors in the added component. Fix only errors caused by this task.

## Task 5: Integrate Preview Into Shopping Item Rows

**Files:**
- Modify: `apps/tanstack-start/src/routes/shoplists.$listId.tsx`

- [ ] **Step 1: Replace the shopping item row map**

In the `Shopping Items` section of `shoplists.$listId.tsx`, replace the `sortedItems.map((itemRow) => (...))` body with:

```tsx
{sortedItems.map((itemRow) => {
  const canShowRecipes =
    itemRow.remainingQuantity > 0 && craftableItemIds.has(itemRow.itemId);
  const isRecipeExpanded = expandedRecipeItemIds.has(itemRow.itemId);

  return (
    <div key={itemRow.itemId} className="flex flex-col gap-2">
      <div
        className={`flex items-center justify-between gap-4 rounded-lg px-2 py-2 transition-opacity ${
          itemRow.remainingQuantity === 0 ? "opacity-45" : ""
        }`}
      >
        <RowLinkOrContent to="/item/$itemId" itemId={itemRow.itemId}>
          <ItemIcon
            icon={itemRow.item.icon}
            name={itemRow.item.name}
            size="md"
          />
          <div className="min-w-0">
            <p className="truncate font-medium hover:underline">
              {itemRow.item.name}
            </p>
            <p className="text-muted-foreground text-sm">
              {itemRow.remainingQuantity.toLocaleString()} remaining •{" "}
              {itemRow.stockQuantity.toLocaleString()} stock •{" "}
              {itemRow.usedQuantity.toLocaleString()} used •{" "}
              {itemRow.totalQuantity.toLocaleString()} total
            </p>
            <ItemCost
              itemId={itemRow.itemId}
              remainingQuantity={itemRow.remainingQuantity}
              overrideMap={overrideMap}
              priceMap={priceMap}
            />
          </div>
        </RowLinkOrContent>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {canShowRecipes ? (
            <Button
              type="button"
              size="sm"
              variant={isRecipeExpanded ? "secondary" : "outline"}
              onClick={() => toggleRecipeExpansion(itemRow.itemId)}
            >
              {isRecipeExpanded ? "Hide recipes" : "Recipes"}
            </Button>
          ) : null}
          <Input
            type="number"
            min="0"
            max={String(itemRow.totalQuantity)}
            disabled={!data.canWrite}
            className={STOCK_INPUT_CLASS_NAME}
            value={
              itemDrafts[itemRow.itemId] ?? String(itemRow.stockQuantity)
            }
            onChange={(event) =>
              setDraftValue(
                setItemDrafts,
                itemRow.itemId,
                event.target.value,
              )
            }
            onBlur={() =>
              commitItemProgress(itemRow.itemId, itemRow.totalQuantity)
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
              if (event.key === "Escape") {
                resetItemDraft(itemRow.itemId);
                event.currentTarget.blur();
              }
            }}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!data.canWrite}
            loading={
              updateItemProgress.isPending &&
              updateItemProgress.variables.itemId === itemRow.itemId
            }
            onClick={() => {
              setDraftValue(
                setItemDrafts,
                itemRow.itemId,
                String(itemRow.totalQuantity),
              );
              updateItemProgress.mutate({
                listId,
                itemId: itemRow.itemId,
                obtainedQuantity: itemRow.totalQuantity,
              });
            }}
          >
            Fill
          </Button>
        </div>
      </div>

      {isRecipeExpanded && canShowRecipes ? (
        <div className="pl-2">
          <InlineRecipePreview
            itemId={itemRow.itemId}
            itemName={itemRow.item.name}
            remainingQuantity={itemRow.remainingQuantity}
            initialModes={savedCraftModes}
            modes={recipeCraftModes[itemRow.itemId]}
            selectedCrafts={recipeSelectedCrafts[itemRow.itemId]}
            collapsedCraftIds={collapsedRecipeCraftIds[itemRow.itemId]}
            priceMap={priceMap}
            overrideMap={overrideMap}
            proficiencyMap={proficiencyMap}
            setModes={(modes) => setInlineCraftModes(itemRow.itemId, modes)}
            setSelectedCrafts={(selectedCrafts) =>
              setInlineSelectedCrafts(itemRow.itemId, selectedCrafts)
            }
            toggleCollapsed={(craftId) =>
              toggleInlineCollapsedCraft(itemRow.itemId, craftId)
            }
          />
        </div>
      ) : null}
    </div>
  );
})}
```

- [ ] **Step 2: Update `ItemCost` to use shared price helper**

In `ItemCost`, replace the local unit-price block with:

```ts
const override = overrideMap.get(itemId);
const unitPrice = getItemPrice(itemId, priceMap, overrideMap);
```

Keep the existing `(override)` display behavior.

- [ ] **Step 3: Update outstanding buy-cost sorting**

In `outstandingBuyCost` and `sortedItems`, replace local override/market price calculations with:

```ts
const unitPrice = getItemPrice(itemRow.itemId, priceMap, overrideMap);
```

and:

```ts
const leftUnitPrice = getItemPrice(left.itemId, priceMap, overrideMap);
const rightUnitPrice = getItemPrice(right.itemId, priceMap, overrideMap);
```

- [ ] **Step 4: Typecheck the integrated UI**

Run:

```bash
pnpm -F @acme/tanstack-start typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the route integration**

Run:

```bash
git add 'apps/tanstack-start/src/routes/shoplists.$listId.tsx'
git commit -m "Add inline shoplist recipe previews"
```

## Task 6: Final Verification

**Files:**
- Verify: `apps/tanstack-start/src/lib/craft-optimizer.ts`
- Verify: `apps/tanstack-start/src/lib/craft-optimizer.test.ts`
- Verify: `apps/tanstack-start/src/routes/shoplists.$listId.tsx`

- [ ] **Step 1: Run focused helper tests**

Run:

```bash
pnpm -F @acme/tanstack-start test:craft-optimizer
```

Expected: PASS.

- [ ] **Step 2: Run existing affected app tests**

Run:

```bash
pnpm -F @acme/tanstack-start test:shoplist-destinations
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm -F @acme/tanstack-start typecheck
```

Expected: PASS.

- [ ] **Step 4: Inspect the final diff**

Run:

```bash
git diff --stat HEAD
git diff -- apps/tanstack-start/src/lib/craft-optimizer.ts apps/tanstack-start/src/lib/craft-optimizer.test.ts apps/tanstack-start/package.json 'apps/tanstack-start/src/routes/shoplists.$listId.tsx'
```

Expected: the diff only contains the helper, tests, package script, and inline saved-shoplist UI.

- [ ] **Step 5: Commit any final fixes**

If Task 6 required changes after the Task 2 and Task 5 commits, run:

```bash
git add apps/tanstack-start/src/lib/craft-optimizer.ts apps/tanstack-start/src/lib/craft-optimizer.test.ts apps/tanstack-start/package.json 'apps/tanstack-start/src/routes/shoplists.$listId.tsx'
git commit -m "Verify inline shoplist recipe previews"
```

Expected: no commit is created if there were no final fixes.

## Self-Review

- Spec coverage: The plan covers view-only inline expansion, craftable-only affordance, remaining quantity, compact recipe selector, Buy/Craft toggles, local state, overproduction display, raw material summary, cost comparison, labor summary, multiple expanded rows, and no backend mutation.
- Red-flag scan: No task contains incomplete-marker text or open-ended deferred work.
- Type consistency: The plan uses the existing `CraftEntryLike`, `ModesMap`, `SelectedCraftMap`, `PriceMap`, `ProficiencyMap`, `crafts.forItem`, and recipe-breakdown component names already present in the codebase.
