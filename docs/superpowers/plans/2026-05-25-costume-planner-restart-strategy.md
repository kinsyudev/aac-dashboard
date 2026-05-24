# Costume Planner Restart Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a restart-aware strategy model to the ArcheAge Classic costume planner so users can see when continuing, rerolling, synthesizing, or salvaging into a restart is cheapest in expectation.

**Architecture:** Keep `costume-planner.ts` as the pure planner engine and add small exported strategy functions/types there. Keep `costume-planner-data.ts` for static cost assumptions. Update `costume-planner.test.ts` test-first, then surface strategy checkpoints and base item assumptions in `costume-planner.tsx`.

**Tech Stack:** TypeScript, Node test runner, TanStack Start route component, existing planner data tables.

---

### Task 1: Add Base Item Cost Assumptions

**Files:**
- Modify: `apps/tanstack-start/src/lib/costume-planner-data.ts`
- Modify: `apps/tanstack-start/src/lib/costume-planner.ts`
- Test: `apps/tanstack-start/src/lib/costume-planner.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests proving costume and undergarment base item values:

```ts
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
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
TMPDIR=/tmp TEMP=/tmp TMP=/tmp PATH=/home/kinsyu/.nvm/versions/node/v22.21.0/bin:$PATH /home/kinsyu/.local/share/pnpm/pnpm -F @acme/tanstack-start test:planner
```

Expected: fail because `estimateBaseItemCost` is not exported.

- [ ] **Step 3: Implement base item costs**

Export `estimateBaseItemCost` from `costume-planner.ts`:

```ts
export interface BaseItemCostOptions {
  honorGoldPerThousand?: number;
}

export function estimateBaseItemCost({
  honorGoldPerThousand = 10,
  kind,
  prices,
}: {
  kind: GearKind;
  prices: PlannerPrices;
} & BaseItemCostOptions): number {
  if (kind === "costume") {
    return getMaterialPrice("misagonsCrystal", prices) * 20;
  }

  return 15 + 14 * honorGoldPerThousand;
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run the same `test:planner` command. Expected: all planner tests pass.

### Task 2: Add Restart-Aware Strategy Engine

**Files:**
- Modify: `apps/tanstack-start/src/lib/costume-planner.ts`
- Test: `apps/tanstack-start/src/lib/costume-planner.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests for optimal strategy behavior:

```ts
void test("restart-aware strategy includes base item cost in build from scratch", () => {
  const strategy = planOptimalStrategy({
    kind: "costume",
    targetGrade: "mythic",
    targetProgress: 100,
    desiredStatIds: ["ranged-attack"],
    prices,
  });

  assert.equal(strategy.baseItemCost, 100);
  assert.ok(strategy.targetCost.totalCost > strategy.baseItemCost);
});

void test("restart-aware comparison restarts bad early states when rerolls are expensive", () => {
  const strategy = compareCurrentStrategy({
    kind: "costume",
    targetGrade: "mythic",
    targetProgress: 100,
    desiredStatIds: ["ranged-attack", "ranged-critical-damage"],
    current: {
      grade: "grand",
      progress: 0,
      statIds: ["physical-defense", "max-health"],
    },
    prices: { ...prices, serendipityStone: 5000 },
  });

  assert.equal(strategy.recommendation, "restart");
});

void test("restart-aware comparison continues when target stats are already kept", () => {
  const strategy = compareCurrentStrategy({
    kind: "costume",
    targetGrade: "mythic",
    targetProgress: 100,
    desiredStatIds: ["ranged-attack", "ranged-critical-damage"],
    current: {
      grade: "grand",
      progress: 0,
      statIds: ["ranged-attack"],
    },
    prices: { ...prices, serendipityStone: 5000 },
  });

  assert.equal(strategy.recommendation, "continue");
  assert.ok(strategy.continueCost.totalCost < strategy.restartCost.totalCost);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run `test:planner`. Expected: fail because `planOptimalStrategy` and `compareCurrentStrategy` are not exported.

- [ ] **Step 3: Implement minimal strategy API**

Add exported types:

```ts
export type StrategyAction = "reroll" | "synth" | "continue" | "restart" | "complete";

export interface StrategyCheckpoint {
  grade: Grade;
  action: StrategyAction;
  label: string;
  expectedCost: number;
  restartCost?: number;
}

export interface OptimalStrategyRoute extends TargetRoute {
  baseItemCost: number;
  targetCost: CostBreakdown;
  strategyCheckpoints: StrategyCheckpoint[];
}
```

Implement `planOptimalStrategy` as the from-scratch baseline plus base item cost and checkpoints. Implement `compareCurrentStrategy` by comparing the current continuation cost against restart cost including base item cost and salvage credit. Keep the first pass deterministic and compatible with the existing cost model.

- [ ] **Step 4: Run tests and verify GREEN**

Run `test:planner`. Expected: all planner tests pass.

### Task 3: Surface Strategy in the UI

**Files:**
- Modify: `apps/tanstack-start/src/routes/costume-planner.tsx`

- [ ] **Step 1: Switch route calculations to strategy API**

Replace `planTargetRoute` and `compareCurrentItem` calls with `planOptimalStrategy` and `compareCurrentStrategy`, while preserving existing visible cost sections.

- [ ] **Step 2: Add honor-rate input**

Add state:

```ts
const [honorGoldPerThousand, setHonorGoldPerThousand] = useState("10");
```

Pass:

```ts
honorGoldPerThousand:
  parseOptionalNumber(honorGoldPerThousand) ?? 10
```

to strategy calls.

- [ ] **Step 3: Add strategy checkpoint card**

Render `strategyCheckpoints` with grade, label, expected cost, and restart cost when present.

- [ ] **Step 4: Run typecheck**

Run:

```bash
TMPDIR=/tmp TEMP=/tmp TMP=/tmp PATH=/home/kinsyu/.nvm/versions/node/v22.21.0/bin:$PATH /home/kinsyu/.local/share/pnpm/pnpm -F @acme/tanstack-start typecheck
```

Expected: pass.

### Task 4: Final Verification

**Files:**
- No planned edits.

- [ ] **Step 1: Run planner tests**

Run:

```bash
TMPDIR=/tmp TEMP=/tmp TMP=/tmp PATH=/home/kinsyu/.nvm/versions/node/v22.21.0/bin:$PATH /home/kinsyu/.local/share/pnpm/pnpm -F @acme/tanstack-start test:planner
```

Expected: pass.

- [ ] **Step 2: Run lint and build**

Run:

```bash
TMPDIR=/tmp TEMP=/tmp TMP=/tmp PATH=/home/kinsyu/.nvm/versions/node/v22.21.0/bin:$PATH /home/kinsyu/.local/share/pnpm/pnpm -F @acme/tanstack-start lint
TMPDIR=/tmp TEMP=/tmp TMP=/tmp PATH=/home/kinsyu/.nvm/versions/node/v22.21.0/bin:$PATH /home/kinsyu/.local/share/pnpm/pnpm -F @acme/tanstack-start build
```

Expected: pass, allowing the existing stale browser mapping advisory and chunk-size warnings.

## Self-Review

Spec coverage: base costs, restart-aware policy, UI checkpoints, and tests are covered.

Placeholder scan: no placeholder implementation steps remain.

Type consistency: strategy type names and call sites match the planned exports.
