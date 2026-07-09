# Inline Shoplist Recipes Design

## Context

The saved shoplist detail page at `apps/tanstack-start/src/routes/shoplists.$listId.tsx` currently shows flattened shopping items, craft stock, progress controls, and buy-cost estimates. The richer `/shoplist` creation flow already supports recipe inspection, Buy/Craft toggles, raw material flattening, prices, and labor summaries.

Users want to inspect craftable items that are currently listed as buy items inside a saved shoplist, without changing the saved list definition.

## Goals

- Add an inline, view-only recipe preview for craftable shopping items.
- Keep item progress editing and saved-list generation behavior unchanged.
- Let users inspect alternative recipes and temporary sub-ingredient Buy/Craft choices.
- Calculate recipe requirements from each row's remaining quantity.
- Avoid loading full recipe trees for every item by default.

## Non-Goals

- Do not persist recipe choices from the saved shoplist detail page.
- Do not regenerate or mutate the shoplist when users inspect recipes.
- Do not encode expanded rows or temporary recipe choices in the URL.
- Do not add progress controls inside the calculated raw-material preview.

## UX

Shopping item rows keep their current item link behavior. For rows where `remainingQuantity > 0` and the item is known to be craftable, show a separate `Recipes` action near the row controls.

Clicking `Recipes` expands a preview directly below that item row. Multiple rows may be expanded at once. Collapsing an item hides the preview but preserves that row's temporary choices until page refresh or navigation.

The expanded preview contains:

- A compact recipe selector when the item has multiple recipes.
- One selected recipe tree at a time.
- Temporary Buy/Craft toggles for craftable sub-ingredients.
- A buy-vs-craft comparison for the remaining item quantity.
- Total estimated material cost.
- Labor badges by proficiency.
- A pure calculated raw-material list.

Rows with `remainingQuantity === 0` do not show the `Recipes` action.

## Data Flow

Use client-side lazy loading:

1. Load `items.craftable` on the saved shoplist page and create a set of craftable item IDs.
2. Show `Recipes` only for shopping item rows that are in that set and have nonzero remaining quantity.
3. When a row expands, fetch `crafts.forItem(itemId)` for that item.
4. Use the returned craft variants, subcraft map, and prices to render the local preview.
5. Combine returned prices with profile overrides from `useUserData`.

No changes are required to `shoppingLists.getById`.

## Local State

The page keeps local state keyed by item ID:

- Expanded item IDs.
- Selected top-level recipe ID.
- Selected subcraft recipe IDs.
- Temporary craft-mode item IDs.
- Collapsed nested recipe cards if needed by the reused recipe tree UI.

Initial temporary craft modes come from `data.list.craftModeItemIds` so the first view reflects the saved list's assumptions. User edits remain local.

## Calculations

The selected top-level recipe is scaled by batches:

```ts
batches = Math.ceil(remainingQuantity / producedAmount)
```

This intentionally overproduces when a recipe output quantity does not divide the remaining requirement. The preview should make the batch count and resulting produced quantity visible enough to explain overproduction.

Raw materials are flattened using the same semantics as the `/shoplist` creation flow:

- Buy-mode ingredients appear directly in the raw-material list.
- Craft-mode ingredients recurse into the selected subcraft recipe.
- Quantities are rounded up for final shopping requirements.
- Labor is accumulated by discounted proficiency using the user's proficiency settings.
- Costs use profile overrides first, then latest market prices.

The buy-vs-craft comparison uses:

- Buy cost: `remainingQuantity * item unit price`.
- Craft cost: calculated raw material cost for required batches.
- Labor: total discounted labor for required batches and selected subcrafts.

## Component Strategy

Prefer a targeted implementation in `shoplists.$listId.tsx` with reuse of existing shared pieces:

- `CraftModeToggle`, `RecipeCardShell`, `RecipeHeader`, `RecipeItemRow`, `RecipeLegend`, and `RecipeCollapseToggle` from `~/component/recipe-breakdown`.
- Existing calculation helpers from `~/lib/craft-optimizer` where they fit.
- Existing `ItemIcon` and `ProficiencyBadge` components.

Only extract new shared helpers if doing so keeps duplication small without forcing a broad refactor of `/shoplist`.

## Error And Loading States

- While a row's craft data is loading, show a small inline loading message below the row.
- If `crafts.forItem` returns no craft variants despite the craftable check, show a compact "No recipes available" message for that expansion.
- If prices are missing, omit unavailable gold totals rather than blocking recipe display.
- If nested subcraft data is missing for a locally selected craft mode, fall back to buy-mode cost for that ingredient.

## Testing

Add focused coverage for pure calculation helpers if new helpers are extracted.

Manual verification should cover:

- Craftable rows with nonzero remaining quantity show `Recipes`.
- Completed rows hide `Recipes`.
- Multiple rows can be expanded simultaneously.
- Recipe selector changes the displayed recipe and recalculates raw materials.
- Temporary Buy/Craft toggles recalculate cost, labor, and raw materials without mutating the saved list.
- Collapsing and reopening preserves local choices until refresh.
- Item links and progress inputs continue to work.
