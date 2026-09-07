# Craft page redesign

Status: ready-for-agent

## Problem Statement

The craft page does not currently give a Player a clear, trustworthy view of a Craft or its full production chain.

The page presents each Recipe as a bordered card and recursively nests more bordered cards for crafted Materials. Deep production chains become visually noisy and difficult to follow. A Player can see neither where they are in the chain nor which part of the overall Plan they are currently changing.

Recipe output is also under-specified. For example, one Craft of Faint Memory produces 10 Items, but the page can make it appear as though it produces one. This makes Material quantities, Craft Cost, and per-Item economics easy to misinterpret. The page must remain driven by a number of Crafts, not by a requested Product quantity: a Recipe consumes whole Material quantities and one Craft produces its complete output batch.

When a Material has multiple Recipes, the page currently chooses one without giving the Player a clear Recipe Choice. Mossy Pool, for example, has multiple distinct Recipes with different Materials, Labor, and output quantities. A Player needs to compare and select those Recipes at every level of the production chain. That problem repeats recursively because a selected Recipe may consume another craftable Material, such as Time's River.

The economic results are scattered and do not read as one summary of the entire Craft. A Player needs a persistent whole-Plan summary showing total Craft Cost, total Labor, and Profit per Labor, with per-Item metrics when the selected root Recipe produces more than one Product.

Finally, Game Data descriptions can expose formatting tokens and incorrect line breaks. The Faint Memory description currently exposes tokens such as `|nc;7` and splits phrases that should read naturally.

## Solution

Replace the nested-card craft page with a Craft-focused planning surface.

The Player chooses an integer number of Crafts, beginning at one. The page makes the selected Recipe's complete output explicit and scales its Materials, Currency, Labor, and economic results by that Craft count.

The page displays one focused Recipe level at a time. Its breadcrumb shows the production path from the root Product to the currently focused craftable Material. Immediate Materials appear in a quiet table. A craftable Material exposes its Acquisition Mode and, when set to craft, an action that moves focus into that Material without expanding another card inside the current level. The same interaction works recursively for arbitrarily deep production chains, subject to the application's existing cycle and maximum-depth protections.

At every focused craftable Item, all stored Recipes remain distinct Recipe Choices. Each choice identifies output per Craft, Labor, Craft Cost or Missing Price state, Cost per Item when applicable, and a concise Material signature that distinguishes similar Recipes. Changing a Recipe Choice updates the whole Plan and its summary. No Recipe is silently selected merely because it happened to arrive first from storage.

A persistent summary near the top of the page remains scoped to the entire root Plan while the Player navigates through nested Recipes. It shows total Craft Cost, total Labor, and Profit per Labor expressed as Silver per Labor. When the selected root Recipe produces more than one Product, it additionally shows Cost per Item and Profit per Item. Profit labels must follow the domain model: use Profit only when Net Revenue is known, and otherwise label the result Profit Before Fees.

Descriptions are parsed into readable text. Supported Game Data formatting tokens affect presentation rather than appearing literally, and line breaks reflect actual content rather than reset tokens.

## User Stories

1. As a Player, I want the craft page to begin with one Craft, so that the quantities match one execution of the selected Recipe.
2. As a Player, I want to enter an integer number of Crafts, so that I can plan repeated executions without translating from a target Item quantity.
3. As a Player, I want the Craft count to reject or normalize zero, negative, fractional, and invalid values, so that the Plan always represents executable Crafts.
4. As a Player, I want to see how many Products one Craft produces, so that a ten-Item batch is not mistaken for a single Item.
5. As a Player, I want total output to scale with the Craft count, so that the page states the exact number of Products the Plan creates.
6. As a Player, I want Material quantities to scale by whole Crafts, so that the page never implies that I can consume a fraction of an indivisible Material.
7. As a Player, I want Currency consumed directly by a Recipe to scale with the Craft count, so that total Craft Cost includes the complete Recipe input.
8. As a Player, I want Labor to scale with the Craft count, so that I can judge whether I have enough Labor for the Plan.
9. As a Player, I want every Recipe that produces the focused Item to remain a distinct Recipe Choice, so that bulk and alternative-material Recipes are not hidden or merged.
10. As a Player, I want each Recipe Choice to show its output per Craft, so that I can compare normal and bulk Recipes correctly.
11. As a Player, I want each Recipe Choice to show its Labor, so that I can compare its non-monetary resource requirement.
12. As a Player, I want each Recipe Choice to show its Craft Cost or Missing Price state, so that an unpriced Recipe never appears free.
13. As a Player, I want Cost per Item on multi-output Recipe Choices, so that differently sized batches remain comparable without implying fractional Material consumption.
14. As a Player, I want each Recipe Choice to show a concise Material signature, so that Recipes with equal output are still distinguishable.
15. As a Player, I want my explicit Recipe Choice to drive the Plan, so that the application does not substitute an arbitrary Recipe.
16. As a Player, I want an application Recommendation to be identified as a Recommendation rather than my choice, so that I understand why a default Plan is shown.
17. As a Player, I want to choose whether a craftable Material is bought or crafted, so that the Plan reflects my intended Acquisition Mode.
18. As a Player, I want buying a Material to use its Price Override or Market Data, so that the Plan values the selected Acquisition Mode correctly.
19. As a Player, I want crafting a Material to use the selected Recipe and whole nested Crafts, so that nested quantities and Labor are executable in game.
20. As a Player, I want a crafted Material to offer an Inspect action, so that I can change its Recipe without expanding another nested card.
21. As a Player, I want only one Recipe level open at a time, so that deep production chains remain readable.
22. As a Player, I want a breadcrumb from the root Product to the focused Material, so that I always know where I am in the production chain.
23. As a Player, I want every breadcrumb level to be navigable, so that I can move back to a parent Recipe without losing the Plan.
24. As a Player, I want the same drill-down interaction to work for Time's River, Meadow Stream, and further craftable Materials, so that nesting depth does not introduce a new UI pattern.
25. As a Player, I want changing a parent Recipe to remove invalid descendant focus state, so that the breadcrumb never points through a Material the parent no longer consumes.
26. As a Player, I want the whole-Plan summary to remain visible while inspecting a nested Recipe, so that I can see how local choices affect the root Craft.
27. As a Player, I want to see total Craft Cost, so that I know the Currency value of every Material and direct Currency input in the Plan.
28. As a Player, I want owned Materials to retain their economic value in Craft Cost, so that the summary does not confuse Craft Cost with Remaining Spend.
29. As a Player, I want to see total Labor separately from Craft Cost, so that Labor is not silently assigned a universal Currency value.
30. As a Player, I want to see Profit per Labor expressed as Silver per Labor, so that I can compare the Plan's Labor efficiency.
31. As a Player, I want Profit per Labor to use the entire recursive Plan's Labor and monetary result, so that crafted intermediate Materials are not omitted.
32. As a Player, I want to see Cost per Item when the root Recipe produces multiple Products, so that the batch economics are easy to compare.
33. As a Player, I want to see Profit per Item when the root Recipe produces multiple Products, so that I understand the economic result of each deterministic Product.
34. As a Player, I want per-Item metrics omitted when the root Recipe produces one Product, so that the summary does not repeat identical batch values.
35. As a Player, I want Profit to account for transaction fees when Net Revenue is known, so that it matches the domain definition.
36. As a Player, I want fee-unmodeled sale calculations labeled Profit Before Fees, so that a gross result is not presented as final Profit.
37. As a Player, I want a temporary Sale Price input to remain available, so that I can evaluate a sale assumption without changing persistent Market Data or a Price Override.
38. As a Player, I want Price Overrides to take precedence over Market Data, so that the summary reflects my explicit assumptions.
39. As a Player, I want every Missing Price named, so that I know which input prevents a complete result.
40. As a Player, I want totals and dependent profitability metrics suppressed when a required price is missing, so that partial costs are never presented as complete.
41. As a Player, I want changing Craft count, Acquisition Mode, or Recipe Choice to update quantities and summary metrics immediately, so that I can compare Plans interactively.
42. As a Player, I want Currency displayed as Gold, Silver, and Copper rather than backend Coins, so that values match the game language.
43. As a Player, I want the Item description to render supported color and emphasis tokens, so that formatting metadata does not appear as text.
44. As a Player, I want reset tokens to end formatting without creating paragraph breaks, so that sentences remain intact.
45. As a Player, I want actual description line breaks and lists to remain readable, so that fixing inline tokens does not flatten structured descriptions.
46. As a Player, I want the page to remain usable on narrow screens, so that the breadcrumb, controls, table, and summary do not overlap or require nested horizontal panels.
47. As a keyboard user, I want Recipe, Acquisition Mode, breadcrumb, and Inspect controls to use native interactive elements, so that the production chain is navigable without a pointer.
48. As a Player, I want the existing Shopping List handoff to preserve the Craft count, Acquisition Modes, and Recipe Choices, so that the Plan I reviewed is the Plan I continue with.

## Implementation Decisions

- The root quantity control represents a number of Crafts, not a Target Product quantity. It defaults to one and accepts positive integers only.
- Calculations start from the selected root Recipe and the Craft count. Total root output is `Craft count × Recipe output`; Materials, direct Currency, and direct Labor scale by the same whole Craft count.
- Nested production continues to use whole Crafts. When a parent requires a Material, the selected child Recipe is executed enough whole times to cover that requirement. No UI divides a parent Material requirement into fractional per-Product inputs.
- Replace recursively rendered Recipe cards with a focused-level interaction. The focused level contains the selected Recipe, its immediate inputs, its direct output, and the controls relevant to that level.
- Represent navigation as a path of Item and Recipe context from the root Product to the focused craftable Material. A breadcrumb renders this path and allows navigation to any ancestor.
- Inspecting a crafted Material appends it to the focus path. Returning to an ancestor truncates the path. Changing a Recipe or Acquisition Mode truncates any descendant path that is no longer valid.
- Acquisition Mode remains a per-Item Plan choice. Buy uses the Item's Price Override or Market Data. Craft uses the selected Recipe and exposes that Item as an inspectable next level.
- All stored Recipes remain distinct. Normal and bulk Recipes are not normalized into one synthetic Recipe, even when their Materials are proportional.
- A focused Item with multiple Recipes displays an explicit Recipe selector or compact comparison control. Each choice exposes output per Craft, Labor, completeness or Craft Cost, Cost per Item when output exceeds one, and a Material signature.
- Storage order is not a valid reason to select a Recipe. If the Player has not made a Recipe Choice, the Tool may show a deterministic Recommendation, but it must label the Recommendation and keep alternatives visible.
- The page owns one shared Plan state for the root Recipe Choice, root Craft count, recursive Acquisition Modes, recursive Recipe Choices, temporary Sale Price, and focused breadcrumb path. Navigating between levels does not create independent nested state.
- The summary is scoped to the whole root Plan, not the focused Recipe level. It remains near the top of the page while the Player navigates the production path.
- The primary summary contains total Craft Cost, total Labor, and Profit per Labor expressed as Silver per Labor.
- Profit per Labor uses the monetary result divided by total Labor across the complete recursive Plan. If fees are not modeled, both the profit basis and the displayed label state that it is Profit Before Fees.
- When the selected root Recipe produces more than one Product, the summary additionally shows Cost per Item and Profit per Item. These are deterministic allocations of whole-batch results across the complete output, not fractional Craft inputs.
- The summary states the selected number of Crafts and total root output so that batch and per-Item metrics cannot be confused.
- Currency is formatted for Players as Gold, Silver, and Copper. Backend Coin identifiers and terminology do not appear in the page.
- Existing Price Override precedence and Proficiency-adjusted Labor behavior are preserved.
- Missing Price is an incomplete input, never zero. A Plan with required Missing Prices names them and does not show a partial total as complete. Profitability metrics dependent on the incomplete total are suppressed.
- The existing temporary Sale Price capability is retained but made visually subordinate to the summary. It affects only the current page state and does not persist as a Price Override.
- Existing automatic Optimization Goals may remain available, but they must produce explainable Recommendations and update the same shared Plan state rather than opening or duplicating nested Recipe cards.
- The Shopping List handoff continues to receive the root Recipe, Craft count, recursive Acquisition Modes, and recursive Recipe Choices.
- Description parsing recognizes the Game Data token family used by the affected description, including indexed color/emphasis tokens such as `|nc;7`, reset tokens such as `|r`, and existing ARGB color tokens. Reset tokens change formatting state; they are not structural line breaks.
- Description block construction uses actual newlines and explicit list/stat syntax for structure. Formatting resets inside a sentence do not split it into separate paragraphs or rows.
- The redesign is a presentation and Plan-state change built on the existing craft calculation behavior where that behavior matches the domain model. It does not introduce database schema changes or rename backend craft tables.
- The page must remain responsive and accessible. Recipe selectors, Acquisition Mode controls, breadcrumbs, Inspect actions, and Craft count use semantic form controls and buttons with accessible names.
- The accepted prototype is a design reference, not production code. Production implementation should reproduce its information hierarchy and interaction model using the application's component system.

## Testing Decisions

- Tests verify Player-observable behavior through public interfaces. They do not assert component source strings, internal hook calls, Tailwind class lists, private helper order, or the exact markup tree.
- The preferred primary seam is one public, pure craft-page Plan interface that accepts the root Recipe, root Craft count, Market Data and Price Overrides, Proficiency, Acquisition Modes, Recipe Choices, Sale Price state, and focus path. It returns the complete whole-Plan summary plus the focused Recipe level and breadcrumb. This seam may extend or wrap the existing craft requirement summary rather than duplicating recursive calculation logic.
- Tests at the primary seam cover one Craft with multi-Item output, multiple root Crafts, whole nested batches, alternative Recipe Choices, bulk Recipe output, recursive Acquisition Modes, a chain at least three Recipes deep, breadcrumb truncation after a parent change, total Craft Cost, total Labor, Profit per Labor, conditional per-Item metrics, and Shopping List state serialization.
- Worked examples use literal expected values calculated independently from the implementation. Tests must not reproduce the implementation's recursive algorithm to generate their expected results.
- Missing Price tests verify that a required unpriced Material produces an Incomplete Plan with named Items and no complete Craft Cost or dependent profitability result.
- Recipe selection tests verify that storage order cannot silently determine an unlabeled Player choice. Tests distinguish a Player Recipe Choice from a Recommendation.
- The public `ItemDescription` rendering seam is tested separately because description markup is independent of craft planning. Rendered output tests verify that indexed formatting tokens are absent from visible text, reset tokens do not split sentences, and genuine multiline/list/stat descriptions preserve their structure.
- Existing craft optimizer and requirement-summary tests are prior art for recursive Material quantities, whole-batch rounding, Recipe Choices, Acquisition Modes, Price Overrides, and Proficiency-adjusted Labor. New tests should build on that style while moving upward to the consolidated page-Plan seam.
- Existing source-text tests are not prior art for this feature's behavior tests. The redesign should avoid adding more source-regex assertions.
- Route wiring is verified with the highest practical rendered interaction test available in the current stack. If no browser-like test harness exists, the pure page-Plan seam carries behavior coverage while typechecking, linting, and a focused manual route check verify React integration.
- Responsive behavior is checked at desktop and narrow widths during the focused manual route verification, including long Item names and a production path at least four levels deep.

## Out of Scope

- Changing the craft page from Craft-count planning to Target-quantity planning.
- Allowing fractional Crafts or fractional Recipe Materials.
- Merging proportional normal and bulk Recipes into one synthetic Recipe.
- Choosing or hard-coding an Auction House transaction fee rate.
- Implementing the broader shared economy-module migration, Market Snapshot freshness work, Labor Value persistence, or cross-Tool economic alignment described in the separate domain-model alignment effort.
- Redesigning Shopping Lists beyond preserving the current craft-page Plan during handoff.
- Persisting the craft page as a Saved Plan or Plan Snapshot.
- Changing Game Data ingestion or correcting source descriptions in the database when the issue can be handled by the shared description renderer.
- Redesigning Item, Simulation, Regrading, Resealing, Salvaging, Trade Pack, or Costume Planning pages.
- Automating any in-game Craft or other in-game action.

## Further Notes

- The source code and current Game Data are the source of truth; older repository documentation must not override them.
- Faint Memory is the reference scenario for acceptance: Recipe 9251 consumes 25 Labor and produces 10 Faint Memory per Craft.
- Mossy Pool is the reference multiple-Recipe scenario. Its stored Recipes include different Material routes and both 10-output and 100-output Recipes; all remain selectable.
- Time's River is the reference recursive scenario. It is itself craftable and leads into further craftable Materials such as Meadow Stream and Morning Dew, demonstrating why a finite set of nested panels is not sufficient.
- The reference Faint Memory description includes indexed formatting tokens around “rank 7,” “small mana,” and “21 seconds.” It should read as one natural sentence with no raw tokens.
- The accepted interaction direction is the focused craft flow from the final prototype: a persistent whole-Plan summary, breadcrumb navigation, one visible Recipe level, and Inspect actions on crafted Materials.
- This spec supersedes the earlier implementation start. No production code or tests were changed before this specification was published.
