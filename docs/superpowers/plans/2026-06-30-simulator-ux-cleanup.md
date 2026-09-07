# Simulator UX Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the simulator search flow with a canonical wisp dashboard and simplify simulator detail pages around saved recipe choice, salvage-only profitability, and inline account-wide price edits.

**Architecture:** Move simulator-specific catalog, recipe preference, and shared computation concerns out of route components into focused library modules. Keep the existing TanStack Start routes as UI composition layers, reusing existing TRPC craft/item/profile APIs and the existing recursive craft-pricing helpers. Dashboard and detail pages should compute from the same helper behavior so saved recipes, cheapest fallback, strategy selection, and salvage-only metrics stay consistent.

**Tech Stack:** TanStack Start, React 19, TanStack Query, TRPC, TypeScript, Node `node:test`, Tailwind, localStorage, existing `@acme/ui` components.

---

## File Structure

- Create `apps/tanstack-start/src/lib/simulator-catalog.ts`
  - Owns the nine canonical simulator targets, wisp keys, labels, item ids, and lookup helpers.
- Create `apps/tanstack-start/src/lib/simulator-recipe-preferences.ts`
  - Owns versioned local-storage parsing, serialization, and pure saved-versus-cheapest recipe selection helpers.
- Create `apps/tanstack-start/src/lib/simulator-recipe-preferences.test.ts`
  - Tests corrupt storage parsing, valid storage parsing, saved recipe selection, and cheapest fallback.
- Modify `apps/tanstack-start/src/lib/simulator.ts`
  - Removes sell fields from simulator input/result types and keeps salvage-only profitability.
- Modify `apps/tanstack-start/src/lib/simulator.test.ts`
  - Updates existing expectations for salvage-only result shape.
- Modify `apps/tanstack-start/src/routes/simulator.index.tsx`
  - Replaces search UI with a nine-card canonical dashboard.
- Modify `apps/tanstack-start/src/routes/simulator.$itemId.tsx`
  - Restricts detail route to canonical items, adds compact recipe picker, renders only selected recipe, removes sell/labor-by-proficiency clutter, and wires inline material price editing to profile overrides.

## Task 1: Add Canonical Simulator Catalog

**Files:**
- Create: `apps/tanstack-start/src/lib/simulator-catalog.ts`

- [ ] **Step 1: Create the catalog module**

Create `apps/tanstack-start/src/lib/simulator-catalog.ts` with:

```ts
export const SIMULATOR_TARGETS = [
  {
    wispKey: "cloth",
    wispLabel: "Cloth",
    representativeCraft: "Shirt",
    itemId: 23947,
    itemName: "Sealed Delphinad Shirt",
  },
  {
    wispKey: "leather",
    wispLabel: "Leather",
    representativeCraft: "Jerkin",
    itemId: 23975,
    itemName: "Sealed Delphinad Jerkin",
  },
  {
    wispKey: "plate",
    wispLabel: "Plate",
    representativeCraft: "Cuirass",
    itemId: 24003,
    itemName: "Sealed Delphinad Cuirass",
  },
  {
    wispKey: "one-hander",
    wispLabel: "One-Hander",
    representativeCraft: "Shortspear",
    itemId: 23885,
    itemName: "Sealed Delphinad Shortspear",
  },
  {
    wispKey: "two-hander",
    wispLabel: "Two-Hander",
    representativeCraft: "Longspear",
    itemId: 23912,
    itemName: "Sealed Delphinad Longspear",
  },
  {
    wispKey: "wooden",
    wispLabel: "Wooden",
    representativeCraft: "Bow",
    itemId: 23893,
    itemName: "Sealed Delphinad Bow",
  },
  {
    wispKey: "small-jewelry",
    wispLabel: "Small Jewelry",
    representativeCraft: "Ring",
    itemId: 24023,
    itemName: "Sealed Delphinad Ring",
  },
  {
    wispKey: "large-jewelry",
    wispLabel: "Large Jewelry",
    representativeCraft: "Necklace",
    itemId: 24018,
    itemName: "Sealed Delphinad Necklace",
  },
  {
    wispKey: "musical",
    wispLabel: "Musical",
    representativeCraft: "Lute",
    itemId: 23918,
    itemName: "Sealed Delphinad Lute",
  },
] as const;

export type SimulatorTarget = (typeof SIMULATOR_TARGETS)[number];
export type SimulatorWispKey = SimulatorTarget["wispKey"];

export const SIMULATOR_TARGET_ITEM_IDS = SIMULATOR_TARGETS.map(
  (target) => target.itemId,
);

export function getSimulatorTargetByItemId(
  itemId: number,
): SimulatorTarget | null {
  return SIMULATOR_TARGETS.find((target) => target.itemId === itemId) ?? null;
}

export function getSimulatorTargetByWispKey(
  wispKey: string,
): SimulatorTarget | null {
  return SIMULATOR_TARGETS.find((target) => target.wispKey === wispKey) ?? null;
}
```

- [ ] **Step 2: Typecheck the new module**

Run:

```bash
pnpm -F @acme/tanstack-start typecheck
```

Expected: the command may still expose unrelated existing errors, but there should be no error mentioning `simulator-catalog.ts`.

- [ ] **Step 3: Commit**

```bash
git add apps/tanstack-start/src/lib/simulator-catalog.ts
git commit -m "feat: add simulator canonical target catalog"
```

## Task 2: Add Recipe Preference Storage With Tests

**Files:**
- Create: `apps/tanstack-start/src/lib/simulator-recipe-preferences.ts`
- Create: `apps/tanstack-start/src/lib/simulator-recipe-preferences.test.ts`

- [ ] **Step 1: Write failing tests for preference parsing and selection**

Create `apps/tanstack-start/src/lib/simulator-recipe-preferences.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseSimulatorRecipePreferences,
  pickPreferredSimulatorRecipe,
  serializeSimulatorRecipePreferences,
} from "./simulator-recipe-preferences.ts";

const entries = [
  { craft: { id: 10 }, cost: 30 },
  { craft: { id: 20 }, cost: 15 },
  { craft: { id: 30 }, cost: 25 },
];

void test("parseSimulatorRecipePreferences ignores invalid JSON", () => {
  assert.deepEqual(parseSimulatorRecipePreferences("{bad json"), {});
});

void test("parseSimulatorRecipePreferences keeps only finite numeric craft ids", () => {
  assert.deepEqual(
    parseSimulatorRecipePreferences(
      JSON.stringify({
        cloth: 10,
        leather: "20",
        plate: null,
        wooden: Number.NaN,
        musical: 30.5,
      }),
    ),
    { cloth: 10, leather: 20, musical: 30.5 },
  );
});

void test("serializeSimulatorRecipePreferences writes stable JSON", () => {
  assert.equal(
    serializeSimulatorRecipePreferences({ leather: 20, cloth: 10 }),
    JSON.stringify({ cloth: 10, leather: 20 }),
  );
});

void test("pickPreferredSimulatorRecipe uses saved craft id when present", () => {
  const result = pickPreferredSimulatorRecipe(
    entries,
    "cloth",
    { cloth: 30 },
    (entry) => entry.cost,
  );

  assert.equal(result.selected.craft.id, 30);
  assert.equal(result.cheapest.craft.id, 20);
  assert.equal(result.source, "saved");
});

void test("pickPreferredSimulatorRecipe falls back to cheapest when saved craft id is missing", () => {
  const result = pickPreferredSimulatorRecipe(
    entries,
    "cloth",
    { cloth: 999 },
    (entry) => entry.cost,
  );

  assert.equal(result.selected.craft.id, 20);
  assert.equal(result.cheapest.craft.id, 20);
  assert.equal(result.source, "cheapest");
});
```

- [ ] **Step 2: Run tests and verify they fail because the module is missing**

Run:

```bash
cd apps/tanstack-start
node --experimental-strip-types --test src/lib/simulator-recipe-preferences.test.ts
```

Expected: FAIL with a module-not-found error for `simulator-recipe-preferences.ts`.

- [ ] **Step 3: Implement preference helpers**

Create `apps/tanstack-start/src/lib/simulator-recipe-preferences.ts`:

```ts
import { useCallback, useState } from "react";

import type { SimulatorWispKey } from "./simulator-catalog";

export const SIMULATOR_RECIPE_PREFERENCES_STORAGE_KEY =
  "simulator:recipe-selection:v1";

export type SimulatorRecipePreferences = Partial<
  Record<SimulatorWispKey, number>
>;

export function parseSimulatorRecipePreferences(
  value: string | null,
): SimulatorRecipePreferences {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed)
        .map(([key, raw]) => {
          const value =
            typeof raw === "number"
              ? raw
              : typeof raw === "string"
                ? Number(raw)
                : Number.NaN;
          return [key, value] as const;
        })
        .filter((entry): entry is [SimulatorWispKey, number] =>
          Number.isFinite(entry[1]),
        )
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  } catch {
    return {};
  }
}

export function serializeSimulatorRecipePreferences(
  preferences: SimulatorRecipePreferences,
): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(preferences)
        .filter((entry): entry is [SimulatorWispKey, number] =>
          Number.isFinite(entry[1]),
        )
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
}

export function pickPreferredSimulatorRecipe<T extends { craft: { id: number } }>(
  entries: T[],
  wispKey: SimulatorWispKey,
  preferences: SimulatorRecipePreferences,
  getCost: (entry: T) => number,
): { selected: T; cheapest: T; source: "saved" | "cheapest" } | null {
  if (entries.length === 0) return null;

  const cheapest = [...entries].sort((a, b) => getCost(a) - getCost(b))[0];
  const savedCraftId = preferences[wispKey];
  const saved = entries.find((entry) => entry.craft.id === savedCraftId);

  return saved
    ? { selected: saved, cheapest, source: "saved" }
    : { selected: cheapest, cheapest, source: "cheapest" };
}

function readPreferences(): SimulatorRecipePreferences {
  try {
    return parseSimulatorRecipePreferences(
      localStorage.getItem(SIMULATOR_RECIPE_PREFERENCES_STORAGE_KEY),
    );
  } catch {
    return {};
  }
}

function writePreferences(preferences: SimulatorRecipePreferences) {
  try {
    localStorage.setItem(
      SIMULATOR_RECIPE_PREFERENCES_STORAGE_KEY,
      serializeSimulatorRecipePreferences(preferences),
    );
  } catch {
    // localStorage can be unavailable in private or SSR-like environments.
  }
}

export function useSimulatorRecipePreferences() {
  const [preferences, setPreferences] =
    useState<SimulatorRecipePreferences>(readPreferences);

  const setRecipePreference = useCallback(
    (wispKey: SimulatorWispKey, craftId: number) => {
      setPreferences((prev) => {
        const next = { ...prev, [wispKey]: craftId };
        writePreferences(next);
        return next;
      });
    },
    [],
  );

  return { preferences, setRecipePreference };
}
```

- [ ] **Step 4: Run the new tests and verify they pass**

Run:

```bash
cd apps/tanstack-start
node --experimental-strip-types --test src/lib/simulator-recipe-preferences.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/tanstack-start/src/lib/simulator-recipe-preferences.ts apps/tanstack-start/src/lib/simulator-recipe-preferences.test.ts
git commit -m "feat: persist simulator recipe preferences"
```

## Task 3: Convert Simulator Math to Salvage-Only Results

**Files:**
- Modify: `apps/tanstack-start/src/lib/simulator.ts`
- Modify: `apps/tanstack-start/src/lib/simulator.test.ts`

- [ ] **Step 1: Update tests to assert sell fields are gone**

In `apps/tanstack-start/src/lib/simulator.test.ts`, remove every `sellPrice` input and add assertions like:

```ts
assert.equal("expectedValueSell" in result, false);
assert.equal("profitSell" in result, false);
assert.equal("silverPerLaborSell" in result, false);
```

Apply those assertions to at least one salvage-loop result and one reseal-loop result.

- [ ] **Step 2: Run tests and verify they fail on the old API**

Run:

```bash
cd apps/tanstack-start
node --experimental-strip-types --test src/lib/simulator.test.ts
```

Expected: FAIL because `sellPrice` is still required by TypeScript-stripped runtime call sites or sell fields still exist on the result.

- [ ] **Step 3: Update simulator result types and calculations**

In `apps/tanstack-start/src/lib/simulator.ts`:

- Remove `sellPrice` from `BaseSimulationInput`.
- Remove `revenueSell`, `profitSell`, `expectedValueSell`, and `silverPerLaborSell` from `BaseSimulationResult`.
- Change `getFinalRevenue` to return only `{ salvageWisps, revenueSalvage }`.
- Change `getBaseResult` so it computes only:

```ts
const profitSalvage = revenueSalvage - totalCost;
const expectedValueSalvage = profitSalvage / expectedAttempts;
```

- Return only `silverPerLaborSalvage` for silver/labor.

- [ ] **Step 4: Run simulator tests**

Run:

```bash
cd apps/tanstack-start
node --experimental-strip-types --test src/lib/simulator.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/tanstack-start/src/lib/simulator.ts apps/tanstack-start/src/lib/simulator.test.ts
git commit -m "refactor: make simulator math salvage only"
```

## Task 4: Simplify Detail Page Around Selected Recipe

**Files:**
- Modify: `apps/tanstack-start/src/routes/simulator.$itemId.tsx`

- [ ] **Step 1: Import catalog and preferences**

Add imports:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@acme/ui/toast";
import {
  getSimulatorTargetByItemId,
  type SimulatorTarget,
} from "~/lib/simulator-catalog";
import {
  pickPreferredSimulatorRecipe,
  useSimulatorRecipePreferences,
} from "~/lib/simulator-recipe-preferences";
```

If `useQueryClient` or `useMutation` already exist in the import list, merge rather than duplicate.

- [ ] **Step 2: Add unsupported state for non-canonical items**

Inside `SimulatorDetail`, derive:

```ts
const simulatorTarget = getSimulatorTargetByItemId(data.item.id);
```

Before normal simulator rendering, return an unsupported panel when it is null:

```tsx
if (!simulatorTarget) {
  return (
    <div className="rounded-md border border-dashed p-6">
      <h1 className="text-2xl font-semibold">Unsupported simulator item</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        The simulator dashboard currently supports the nine representative
        Sealed Delphinad wisp crafts only.
      </p>
      <Link to="/simulator" className="text-primary mt-4 inline-flex text-sm hover:underline">
        Back to simulator dashboard
      </Link>
    </div>
  );
}
```

- [ ] **Step 3: Replace cheapest-only `mainCraft` with preferred selected recipe**

Add:

```ts
const { preferences, setRecipePreference } = useSimulatorRecipePreferences();
```

Build craft cost previews with existing `getCraftEntryUnitCost`, then use `pickPreferredSimulatorRecipe`.

The selected top-level craft must be:

```ts
const selectedRecipe = useMemo(() => {
  if (!simulatorTarget || !data.crafts.length) return null;
  return pickPreferredSimulatorRecipe(
    data.crafts,
    simulatorTarget.wispKey,
    preferences,
    (entry) =>
      getCraftEntryUnitCost(
        entry,
        data.item.id,
        data.subcraftsByItemId,
        priceMap,
        overrideMap,
        effectiveModes,
      ),
  );
}, [data, effectiveModes, overrideMap, preferences, priceMap, simulatorTarget]);

const mainCraft = selectedRecipe?.selected ?? null;
```

Remove the previous `mainCraft` memo that always called `pickCheapestCraftForItem`.

- [ ] **Step 4: Add compact recipe picker**

Render a `RecipePicker` above the craft breakdown. It should show one button per `data.crafts` entry, with:

- Recipe label: `Recipe 1`, `Recipe 2`, `Recipe 3`.
- Cost preview from `getCraftEntryUnitCost`.
- `Cheapest` badge when craft id equals `selectedRecipe.cheapest.craft.id`.
- `Saved` badge when craft id equals `preferences[simulatorTarget.wispKey]`.

Clicking a recipe calls:

```ts
setRecipePreference(simulatorTarget.wispKey, entry.craft.id);
```

- [ ] **Step 5: Render only the selected recipe breakdown**

Replace:

```tsx
{data.crafts.map((entry) => (
  <SimulatorCraftBreakdown ... />
))}
```

with:

```tsx
{mainCraft ? (
  <SimulatorCraftBreakdown
    key={mainCraft.craft.id}
    entry={mainCraft}
    itemId={item.id}
    priceMap={priceMap}
    overrideMap={overrideMap}
    proficiencyMap={proficiencyMap}
    subcraftMap={data.subcraftsByItemId}
    modes={effectiveModes}
    setModes={setModes}
    collapsedCraftIds={collapsedCraftIds}
    toggleCollapsed={toggleCollapsed}
  />
) : null}
```

- [ ] **Step 6: Remove sell-price UI and sell debug fields**

Remove:

- `localSalePrice`
- `ayanadPriceQuery`
- `ayanadMarketPrice`
- `defaultSalePrice`
- `effectiveSalePrice`
- the Ayanad sale price input panel
- sell fields from `debugState`
- all `sellPrice: effectiveSalePrice` inputs to simulator math

- [ ] **Step 7: Remove labor-by-proficiency summary strip**

Keep `craftExecutions` only if still used for the concise “Crafts being done” list. Remove:

```ts
const laborByProficiency = useMemo(...)
```

Remove the badge strip that maps `laborByProficiency`.

- [ ] **Step 8: Add inline profile price editing to recipe rows**

Use existing TRPC mutation:

```ts
const queryClient = useQueryClient();
const setPriceOverride = useMutation(
  trpc.profile.setPriceOverride.mutationOptions({
    onSuccess: async () => {
      await queryClient.invalidateQueries(trpc.profile.getUserData.pathFilter());
      toast.success("Price override saved.");
    },
    onError: () => toast.error("Failed to save price override."),
  }),
);
```

Pass an `onSavePriceOverride` callback into `SimulatorCraftBreakdown`. In each `RecipeItemRow`, render a compact numeric input for the material unit price and save on blur or Enter:

```tsx
<input
  type="number"
  min="0"
  step="0.01"
  defaultValue={unit > 0 ? unit.toFixed(2) : ""}
  onBlur={(event) => {
    const parsed = Number.parseFloat(event.currentTarget.value);
    if (Number.isFinite(parsed) && parsed > 0 && parsed !== buyUnit) {
      onSavePriceOverride(item.id, parsed);
    }
  }}
  onKeyDown={(event) => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    }
  }}
  className="bg-background w-24 rounded-md border px-2 py-1 text-right text-xs tabular-nums"
/>
```

Keep the existing formatted line total next to the input. Do not store simulator-local price overrides.

- [ ] **Step 9: Replace result cards with reduced salvage-only cards**

Remove `EV / attempt (sell)`, `Revenue (sell)`, `Total EV (sell)`, and `Silver/labor (sell)` from all result components.

The visible details should be:

- Initial Seed
- Delphinad Craft Cost
- Ayanad Craft Cost
- EV per attempt
- Silver per labor

For Delphinad Craft Cost:

- Salvage Loop main value: `result.costPerAttempt`
- Salvage Loop detail: `Expected: ${gold(result.expectedAttemptsCost)}`
- Reseal Loop main value: `result.initialSealedCraftCost`
- Reseal Loop detail: `Retries: ${gold(result.totalManaSealRetryCost)}`

- [ ] **Step 10: Run typecheck**

Run:

```bash
pnpm -F @acme/tanstack-start typecheck
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add apps/tanstack-start/src/routes/simulator.\$itemId.tsx
git commit -m "feat: simplify simulator detail recipes"
```

## Task 5: Replace Simulator Search With Dashboard

**Files:**
- Modify: `apps/tanstack-start/src/routes/simulator.index.tsx`

- [ ] **Step 1: Replace search imports with dashboard imports**

Remove:

```ts
import { Suspense, useDeferredValue, useMemo, useState } from "react";
import { Badge } from "@acme/ui/badge";
import { ItemSearchResultList, SearchPageShell } from "~/component/item-search";
```

Add:

```ts
import { Suspense, useMemo } from "react";
import { useQueries, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { ItemIcon } from "~/component/item-icon";
import { StatCard } from "~/component/stat-card";
import { SIMULATOR_TARGETS } from "~/lib/simulator-catalog";
import { useSimulatorRecipePreferences } from "~/lib/simulator-recipe-preferences";
```

Keep `useTRPC`.

- [ ] **Step 2: Prefetch canonical craft data**

Change the route loader to prefetch `trpc.crafts.forItem` for every canonical item id:

```ts
loader: ({ context }) => {
  for (const target of SIMULATOR_TARGETS) {
    void context.queryClient.prefetchQuery(
      context.trpc.crafts.forItem.queryOptions(target.itemId),
    );
  }
},
```

- [ ] **Step 3: Render dashboard shell**

Implement:

```tsx
function SimulatorIndex() {
  return (
    <main className="container py-16">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Craft Simulator</h1>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm">
          Compare the representative Sealed Delphinad craft for each mana wisp
          type using salvage-focused expected value.
        </p>
      </div>
      <Suspense fallback={<p className="text-muted-foreground text-sm">Loading simulator dashboard...</p>}>
        <SimulatorDashboard />
      </Suspense>
    </main>
  );
}
```

- [ ] **Step 4: Load all canonical cards**

Inside `SimulatorDashboard`, use `useQueries` to load `trpc.crafts.forItem` for all targets. Reuse existing detail-page helpers where possible after Task 4. If reusable computation was not extracted yet, extract only the minimum shared pure helper needed to avoid duplicate strategy-selection logic.

Each card should link to:

```tsx
<Link to="/simulator/$itemId" params={{ itemId: target.itemId }}>
```

- [ ] **Step 5: Show best supported salvage strategy**

For each target:

- Compute the selected recipe from local-storage preferences, falling back to cheapest.
- Compute Salvage Loop and Reseal Loop with salvage-only math.
- Pick the result with higher `expectedValueSalvage`, ignoring unsupported null results.
- Render:

```tsx
<StatCard label="Initial Seed" value={gold(result.initialSeedCost)} />
<StatCard label="Delphinad Craft Cost" value={gold(delphinadCost)} detail={expectedDetail} />
<StatCard label="Ayanad Craft Cost" value={gold(result.sealedUpgradeCost)} />
<StatCard label="EV per attempt" value={gold(result.expectedValueSalvage)} variant={resultVariant(result.expectedValueSalvage)} />
<StatCard label="Silver per labor" value={result.silverPerLaborSalvage.toFixed(2)} variant={resultVariant(result.silverPerLaborSalvage)} />
```

- [ ] **Step 6: Run typecheck**

Run:

```bash
pnpm -F @acme/tanstack-start typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/tanstack-start/src/routes/simulator.index.tsx
git commit -m "feat: add simulator wisp dashboard"
```

## Task 6: Final Verification

**Files:**
- Verify all simulator files changed in previous tasks.

- [ ] **Step 1: Run simulator unit tests**

Run:

```bash
cd apps/tanstack-start
node --experimental-strip-types --test src/lib/simulator.test.ts src/lib/simulator-recipe-preferences.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm -F @acme/tanstack-start typecheck
```

Expected: PASS.

- [ ] **Step 3: Run lint**

Run:

```bash
pnpm -F @acme/tanstack-start lint
```

Expected: PASS.

- [ ] **Step 4: Manual browser verification**

Run:

```bash
pnpm -F @acme/tanstack-start dev
```

Verify:

- `/simulator` shows nine cards and no search input.
- Each card links to the expected `/simulator/$itemId`.
- Best-strategy card metrics are salvage-only.
- `/simulator/23947` shows the compact recipe picker and one recipe breakdown.
- Selecting a different recipe persists after refresh.
- Editing a material price saves a profile override and updates calculated costs.
- A non-canonical URL such as `/simulator/1` shows the unsupported simulator state.

- [ ] **Step 5: Final status**

Run:

```bash
git status --short
```

Expected: only intended simulator files are modified or staged. Unrelated pre-existing files such as `pack_data.json:Zone.Identifier` must remain untouched.

## Self-Review Checklist

- [ ] `/simulator` search UI removed.
- [ ] Dashboard contains exactly the nine canonical representative crafts.
- [ ] Recipe preferences use `simulator:recipe-selection:v1`.
- [ ] Detail route rejects non-canonical simulator items.
- [ ] Detail route shows only one full recipe breakdown.
- [ ] Compact recipe picker has `Cheapest` and `Saved` indicators.
- [ ] Sell-price math and UI are removed from simulator.
- [ ] Labor-by-proficiency strip is removed.
- [ ] Inline item price edits save account-wide profile overrides.
- [ ] Dashboard cards use best supported strategy by salvage EV.
- [ ] Reduced cards consistently show Initial Seed, Delphinad Craft Cost, Ayanad Craft Cost, EV per attempt, and Silver per labor.
