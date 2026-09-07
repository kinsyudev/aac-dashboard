# Domain model alignment plan

## Outcome

Align AAC Dashboard's calculations and saved planning behavior with the domain rules in `CONTEXT.md`:

- Missing Price is unknown, never zero.
- Market Snapshot freshness reaches every Tool that uses Market Data.
- Profit is fee-aware; fee-free results are labeled Profit Before Fees.
- Player-supplied Labor Value participates in Effective Cost, Effective Profit, and Effective Expected Value.
- Invalid saved Acquisition Modes or Recipe Choices make a Plan incomplete instead of silently changing it.

This effort changes economic semantics, so correctness and transparent incomplete states take priority over preserving existing numeric fallbacks.

## Architectural seam

Create a pure workspace package, `@acme/economy`, as the deep module for shared economic behavior. Its interface is the test surface for callers in the API and web app; it must not depend on React, tRPC, Drizzle, or a database.

The package interface should stay small:

1. Resolve an Item's effective price from a fixed Currency value, Price Override, or Market Snapshot.
2. Calculate fee-aware and Labor-aware economic metrics from explicit inputs.
3. Return incomplete results with structured diagnostics instead of using numeric sentinels or throwing for expected missing data.

Database queries remain adapters. They load rows and translate them into the module's input types, including `fetchedAt`. Tool-specific algorithms such as Regrading and Resealing remain outside the package and consume its resolved prices and metric results.

Use a discriminated result rather than `0 | null`:

```ts
type PriceResolution =
  | {
      kind: "priced";
      valueGold: number;
      source: "fixed" | "override" | "market";
      observedAt: string | null;
    }
  | { kind: "missing"; itemId: number };
```

Calculations that need several prices should collect every missing Item and return one incomplete result. This gives the Player one actionable list instead of failing one Material at a time.

## Work packages

### 1. Establish the economy module and explicit price resolution

Create `packages/economy` and move the duplicated parsing, price precedence, fixed Currency conversion, and missing-price behavior behind its interface.

Migrate these duplicated helpers first:

- `apps/tanstack-start/src/lib/simulator-upgrade-pricing.ts`
- `apps/tanstack-start/src/lib/craft-optimizer.ts`
- `packages/api/src/lib/shopping-list-state.ts`
- `apps/tanstack-start/src/routes/shoplists.combine.tsx`
- `apps/tanstack-start/src/routes/costume-planner.tsx`
- `apps/tanstack-start/src/lib/trade-packs.ts`

The backend-only Coin Item mapping belongs in an adapter and enters the module as a fixed Currency value. It must not leak into player-facing domain types.

Acceptance criteria:

- No shared price resolver returns zero for absent Market Data.
- A real zero value can only come from an explicit fixed value or Price Override policy that permits it.
- Override, Market Data, fixed Currency, and Missing Price cases are covered through the package interface.
- Recursive Recipe calculations return all missing Item IDs and names without producing a misleading cost.
- Old helper tests are replaced by package-interface tests rather than duplicated alongside them.

### 2. Propagate Market Snapshot freshness

Add `fetchedAt` to every latest-price projection returned to a Tool. Update price maps and the economy module input type to preserve it.

For a result that combines multiple market-priced Items, expose the oldest contributing observation as the conservative `marketDataAsOf` value. Retain per-Item timestamps for detailed breakdowns. Do not introduce a universal stale threshold.

Acceptance criteria:

- Crafting, Shopping Lists, Simulations, Regrading, Costume Planning, and Trade Packs receive timestamps with Market Data.
- Every complete economic result can state when its oldest contributing Market Data was observed.
- Price Overrides are identified as overrides and do not pretend to have a Market Snapshot timestamp.
- Stale Market Data remains usable and visibly dated; it does not become Missing Price automatically.

### 3. Make incomplete calculations explicit in every Tool

Migrate each Tool from numeric fallbacks to a common complete/incomplete result shape. Reuse the Trade Pack behavior that already detects missing Material prices, but return structured diagnostics instead of matching error-message strings.

UI behavior for an incomplete result:

- Name every Item with a Missing Price.
- Suppress rankings, Profit, Expected Value, and Recommendations that depend on the missing inputs.
- Offer the existing Price Override workflow where applicable.
- Preserve unaffected breakdown data so the Player can understand the Plan.

Acceptance criteria:

- No unpriced Material can win an optimizer or appear as free.
- Tools never show a partial number as a complete Craft Cost, Profit, or Expected Value.
- Missing-price behavior is consistent across all economic Tools.
- Route-level tests cover both complete and incomplete rendering states.

### 4. Correct Profit semantics and add fee inputs

Introduce shared metric inputs and outputs in `@acme/economy`:

- Sale Price
- transaction fee state: modeled amount/rate or explicitly unmodeled
- Net Revenue
- Currency cost
- Profit or Profit Before Fees

Do not hard-code an Auction House fee rate until its rule is represented in trusted Game Data or explicitly configured. Existing calculations without a modeled fee must rename their output to Profit Before Fees. Tools that do not involve a sale fee, such as a direct Trade Pack reward, may produce Profit when their Revenue is already net.

Acceptance criteria:

- `Profit` is only returned when Net Revenue is known.
- Fee-free sale calculations return `Profit Before Fees`, including their fee status in the result type.
- Regrading, crafting profitability, and salvage-value simulations use the same definitions.
- User-facing labels and help text match `CONTEXT.md`.
- Tests cover fixed fees, percentage fees, unmodeled fees, and fee-free reward paths.

### 5. Persist Labor Value and calculate effective metrics

Add an Account-level economic preference for Labor Value, stored as Silver per Labor. Expose it through the existing profile user-data query and profile UI. Treat an unset value differently from an explicit zero value.

Replace the optimizer's string-only objective with an explicit Optimization Goal input. Cost-based comparisons use:

```text
Effective Cost = Craft Cost + Labor × Labor Value
Effective Profit = Profit − Labor × Labor Value
```

Expected-value Tools apply the same opportunity cost to produce Effective Expected Value. Raw Currency totals and Labor totals remain visible alongside effective metrics.

Acceptance criteria:

- A Player can set, update, clear, and retrieve Labor Value.
- The same Plan may rank differently when Labor Value changes, with tests demonstrating the change.
- Crafting, Simulations, Regrading, Costume Planning, and Trade Packs receive Labor Value explicitly rather than reading global state inside calculation functions.
- Raw and effective metrics are separately named and displayed.
- Saved Plan inputs preserve any Tool-level Labor Value override if per-Plan overrides are introduced later.

### 6. Reject invalid saved choices instead of substituting silently

Change saved-choice resolvers to distinguish three states:

- No Player choice exists: a Tool may create a Recommendation.
- The saved choice is valid: use it.
- The saved choice references a missing Recipe or invalid Acquisition Mode: return an Incomplete Plan.

Remove the tested behavior that replaces a missing saved Recipe with the cheapest Recipe. The UI may display the new cheapest Recipe as a Recommendation, but applying it requires an explicit Player action.

Apply the same validation rule to URL state, local storage, saved loadouts, and persisted Shopping Lists.

Acceptance criteria:

- A stale saved Recipe ID never changes the Plan silently.
- The Player sees which choice became invalid and why.
- A suggested replacement is visually distinct from the saved Plan and requires confirmation.
- Tests cover no preference, valid preference, stale preference, invalid Acquisition Mode, and deleted Recipe cases.

## Delivery order

Implement the work packages in order. Packages 1–3 establish price correctness and must land before new profitability behavior. Package 4 establishes metric names before Package 5 adds Labor-aware variants. Package 6 can be developed after Package 1 but should ship after the shared incomplete-result UI exists.

For safer review, use these pull-request-sized slices:

1. `@acme/economy` price interface and tests.
2. Timestamp adapters and one end-to-end crafting migration.
3. Remaining Tool migrations and incomplete-result UI.
4. Fee semantics and label corrections.
5. Labor Value persistence and effective metrics.
6. Saved-choice validation and explicit replacement flow.

Do not combine all Tool migrations into one change; migrate one vertical slice first and use it to prove the interface before repeating the pattern.

## Verification

Each slice must run the affected package's unit tests, typecheck, and lint. Before the effort is complete, run:

```sh
pnpm -F @acme/economy test
pnpm -F @acme/economy typecheck
pnpm -F @acme/tanstack-start test:craft-optimizer
pnpm -F @acme/tanstack-start test:trade-packs
pnpm -F @acme/tanstack-start test:planner
pnpm -F @acme/tanstack-start test:regrade
pnpm -F @acme/tanstack-start typecheck
pnpm -F @acme/api typecheck
pnpm lint
```

Add or adjust script names as part of the first slice so every command above is real and non-interactive.

## Out of scope

- Choosing or researching the canonical Auction House fee rate.
- Automatically expiring stale Market Data.
- Building immutable Plan Snapshot persistence.
- Renaming backend tables and existing internal `craft` identifiers to `recipe`.
- Changing Regrading, Resealing, or Salvaging mechanics beyond consuming the corrected economic inputs.
