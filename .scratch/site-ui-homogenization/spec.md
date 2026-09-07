# Site UI homogenization

Status: ready-for-agent

## Problem Statement

AAC Dashboard has grown into a suite of useful Tools, but its Player-facing interface no longer reads as one cohesive product. The redesigned Craft page establishes a clear information hierarchy: a consistent page heading, quiet sections separated by borders, compact summary metrics, explicit incomplete states, inline controls placed beside the values they affect, and a focused Recipe interaction that avoids recursively nesting bordered cards.

Other Tools still use several older presentation models. Similar pages use different widths, vertical spacing, title sizes, section headings, selected states, metrics, form controls, tooltips, loading messages, empty states, and card treatments. Several Tools still present recursive Recipes as nested bordered or dashed cards, recreating the visual noise that the Craft redesign removed. Similar concepts such as Missing Price, Currency, Profit Before Fees, Labor efficiency, and Price Override source are also described differently across Tools.

The inconsistency makes Players relearn the interface when moving between Crafting, Items, Simulations, Regrading, Costume Planning, Trade Packs, Shopping Lists, and Profile settings. It also makes responsive and accessible behavior uneven. On narrow screens, the fixed application chrome can become taller than the reserved content offset, dense tables and inline action groups may overflow, and route-specific controls do not always expose state consistently to assistive technology.

For maintainers, the drift is reinforced by duplicated route-local implementations of metrics, fields, native selects, tooltips, progress indicators, notices, and recursive Recipe displays. Visual changes must be repeated in multiple large route modules, increasing the risk of behavioral regressions and making further divergence likely.

## Solution

Turn the Craft page's current visual and interaction direction into the shared UI grammar for AAC Dashboard, then migrate every Player-facing Tool to that grammar in reviewable vertical slices.

The shared grammar will provide a small set of deep modules for page composition, section hierarchy, metrics, notices, fields, responsive rows, and focused Recipe navigation. It will distinguish structural page sections from genuinely independent cards: major page regions will normally use quiet border-separated sections, while cards remain available for independently selectable Saved Plans, linked Tool tiles, compact metrics, table frames, and other content whose containment communicates meaning.

Recipe-heavy Tools will replace recursive nested cards with the focused interaction established by Crafting. A Player will see one Recipe level at a time, retain a visible production path, compare explicit Recipe Choices, choose an Acquisition Mode, and inspect crafted Materials without expanding another panel inside the current Recipe. Tool-specific calculations and saved state remain owned by each Tool; the shared Recipe navigator owns the recurring presentation, semantics, keyboard behavior, and responsive layout.

The migration will preserve current calculations, route state, persistence, authorization, and backend contracts. Economic display rules will use the domain vocabulary: Missing Price is unknown rather than zero, Price Overrides remain distinct from Market Data, incomplete results are named and visible, Currency and Labor remain separate, and fee-unmodeled sale results use Profit Before Fees. The UI effort will consume the shared economy semantics when available rather than implementing a competing calculation model.

The work will be delivered one Tool family at a time. The Craft and Item surfaces will prove the shared page composition modules; Simulator and Shopping List preview will prove focused Recipe navigation; the remaining Recipe-heavy and data-dense Tools will follow; Shopping Lists, Profile, supporting status pages, home, and global chrome will complete the migration. Each slice will include responsive, accessibility, and visual verification before the next family adopts the shared interfaces.

## User Stories

1. As a Player, I want every Tool to feel like part of AAC Dashboard, so that moving between Tools does not require relearning the interface.
2. As a Player, I want each page to have one obvious title, so that I can immediately understand where I am.
3. As a Player, I want page subtitles to describe the current Tool or Item context consistently, so that the purpose of the page is clear.
4. As a Player, I want Item-focused pages to use the same icon, title, and category arrangement, so that Item identity is recognizable across Tools.
5. As a Player, I want back navigation to appear in the same location and style, so that returning to the parent page is predictable.
6. As a Player, I want page actions to appear beside the heading without crowding it, so that primary actions are easy to find.
7. As a Player, I want page actions to wrap below the heading on narrow screens, so that long titles and actions do not overlap.
8. As a Player, I want normal, wide, narrow, and landing-page layouts to share the same spacing rhythm, so that intentional width differences do not feel like different products.
9. As a Player, I want major page sections to use a consistent heading level, so that I can scan the page quickly.
10. As a Player, I want major sections to include concise descriptions when their purpose is not obvious, so that controls and results are understandable before I use them.
11. As a Player, I want major sections to be separated quietly rather than enclosed in repeated large cards, so that the information hierarchy remains calm.
12. As a Player, I want independent objects and choices to remain visually contained, so that cards continue to communicate meaningful grouping.
13. As a Player, I want nested cards avoided, so that deep content does not become a stack of competing borders and backgrounds.
14. As a Player, I want row-based Material and Item lists to use consistent spacing and separators, so that quantities, prices, and actions are easy to compare.
15. As a Player, I want hover treatment only on interactive rows, so that I can distinguish links and controls from static information.
16. As a Player, I want row actions to stay associated with the correct Item, so that I do not edit or inspect the wrong entry.
17. As a Player, I want row actions to move beneath row details on narrow screens when necessary, so that controls remain usable without horizontal scrolling.
18. As a Player, I want summary metrics to use the same label, value, detail, and emphasis hierarchy, so that results are comparable between Tools.
19. As a Player, I want positive, negative, neutral, warning, and incomplete metric states to have consistent visual meaning, so that color does not change meaning between Tools.
20. As a Player, I want metrics to use tabular number alignment, so that changing values remain easy to compare.
21. As a Player, I want metric grids to adapt to available width, so that values remain readable on phones and large displays.
22. As a Player, I want form labels, descriptions, controls, and errors to follow one layout, so that inputs are predictable across Tools.
23. As a Player, I want selects to look and behave consistently, so that choosing a Recipe, Grade, route, or saved loadout feels familiar.
24. As a Player, I want number inputs to use consistent sizing, focus treatment, and validation states, so that economic and quantity inputs are easier to use.
25. As a Player, I want checkbox and toggle choices to expose their selected state consistently, so that I can tell which options are active.
26. As a Player, I want discrete choice tiles to use one selected-state convention, so that highlighted borders, fills, and badges do not compete.
27. As a Player, I want paired Acquisition Mode controls to use one selected-state convention, so that Buy and Craft choices are immediately recognizable.
28. As a Player, I want action hierarchy to be consistent, so that primary, secondary, quiet, and destructive actions have predictable emphasis.
29. As a Player, I want destructive actions to remain visually distinct and require deliberate activation, so that I do not accidentally delete saved data.
30. As a Player, I want help icons and tooltips to behave consistently with a pointer, keyboard, and assistive technology, so that explanatory content is available to everyone.
31. As a Player, I want inline editing controls to appear beside the value being edited, so that the scope of an edit is unambiguous.
32. As a Player, I want Save and Cancel behavior to remain consistent for inline edits, so that I can confidently commit or discard a change.
33. As a Player, I want Price Override editing to use the same affordance in every Tool, so that I can correct a Missing Price without leaving my current work unnecessarily.
34. As a Player, I want a Price Override to be identified as an override, so that it is not confused with Market Data.
35. As a Player, I want Market Data sources and observation context to be presented consistently when available, so that I understand the basis of an economic result.
36. As a Player, I want every Missing Price to use the same wording, so that unknown values are never confused with zero or free Materials.
37. As a Player, I want incomplete results to name every affected Item, so that I know which Price Overrides or Market Data are needed.
38. As a Player, I want totals and dependent profitability results suppressed when required prices are missing, so that partial results are never presented as complete.
39. As a Player, I want incomplete calculations to preserve unaffected breakdown information, so that I can still understand the Plan.
40. As a Player, I want Currency formatting to be consistent across economic summaries, so that values can be compared between Tools.
41. As a Player, I want exact Gold, Silver, and Copper displays retained where exact Currency units matter, so that compact formatting does not hide meaningful denominations.
42. As a Player, I want Labor displayed separately from Currency, so that the interface does not imply a universal Labor Value.
43. As a Player, I want Labor efficiency to use the same Silver per Labor wording, so that results mean the same thing across Tools.
44. As a Player, I want fee-unmodeled sale calculations labeled Profit Before Fees, so that gross results are not mistaken for final Profit.
45. As a Player, I want direct reward calculations to use Profit only when their Revenue is already net, so that economic labels follow the domain model.
46. As a Player, I want one focused Recipe level at a time, so that a deep production chain remains understandable.
47. As a Player, I want to see the production path from the root Product to the focused Material, so that I always know which part of the Plan I am changing.
48. As a Player, I want every ancestor in the production path to be navigable, so that I can return to a parent Recipe without discarding my Plan.
49. As a Player, I want each stored Recipe to remain a distinct Recipe Choice, so that alternative and bulk Recipes are not hidden.
50. As a Player, I want Recipe Choices to display output, Labor, Craft Cost or Missing Price, and per-Item cost when applicable, so that alternatives can be compared accurately.
51. As a Player, I want a Recommendation to be visually distinct from my explicit Recipe Choice, so that the Tool does not imply that I made a choice I did not make.
52. As a Player, I want Acquisition Mode controls on craftable Materials, so that I can choose whether each Item is bought or produced through a Recipe.
53. As a Player, I want crafted Materials to expose an Inspect action, so that I can edit their Recipe Choice without opening nested cards.
54. As a Player, I want the same Recipe interaction in Crafting, Simulations, Shopping Lists, Costume Planning, and Regrading, so that production planning works consistently across Tools.
55. As a Player, I want Tool-specific calculations to remain unchanged during the visual migration, so that familiar results and saved Plans remain trustworthy.
56. As a Player, I want my URL-backed Craft count, Recipe Choices, Acquisition Modes, and simulation settings preserved, so that shared links continue to reproduce the same state.
57. As a Player, I want Saved Plans, Shopping Lists, loadouts, and Profile settings preserved, so that a UI update does not discard my work.
58. As a Player, I want dense rankings and economic tables to remain tables where comparison is important, so that visual consistency does not reduce information density.
59. As a Player, I want dense tables to scroll or adapt intentionally on narrow screens, so that content is not clipped by the viewport.
60. As a Player, I want important Item rows to receive a mobile presentation when a wide table would be unusable, so that I can complete the same task on a phone.
61. As a mobile Player, I want the application header to reserve its actual height, so that navigation never covers page content.
62. As a mobile Player, I want navigation and account controls to remain reachable without excessive wrapping, so that I can move between Tools efficiently.
63. As a mobile Player, I want fixed controls and the footer to avoid covering page content, so that the bottom of every Tool remains usable.
64. As a keyboard Player, I want all choices, links, tooltips, and inline edits reachable in a logical order, so that I can operate every Tool without a pointer.
65. As a keyboard Player, I want visible focus treatment on every interactive element, so that I always know where input will go.
66. As a keyboard Player, I want selected choices communicated through native state or accessible attributes, so that visual emphasis is not the only indication.
67. As a screen-reader Player, I want major sections associated with their headings, so that page landmarks and heading navigation describe the interface accurately.
68. As a screen-reader Player, I want controls to have accessible names that include their Item or setting context, so that repeated Save, Edit, and Remove actions are distinguishable.
69. As a Player, I want loading states to use consistent language and polite status announcements, so that I know when a Tool is still working.
70. As a Player, I want empty states to explain what is absent and what I can do next, so that an empty page does not feel broken.
71. As a Player, I want unavailable and unsupported states distinguished from errors, so that I understand whether changing input can resolve the problem.
72. As a Player, I want not-found, sign-in-required, access-denied, and server-error pages to use the same restrained hierarchy as the rest of the site, so that failures still feel integrated.
73. As a Player using dark theme, I want every semantic state to remain readable and equivalent to light theme, so that meaning is not lost after changing theme.
74. As a Player, I want the home page to retain its role as a Tool launcher while using the shared spacing and interaction grammar, so that it feels distinctive without feeling disconnected.
75. As a Player, I want saved Shopping Lists to remain visually distinct as independently selectable objects, so that flattening sections does not erase meaningful list boundaries.
76. As a Player, I want Shopping List progress to use the same progress presentation everywhere, so that completion is easy to compare.
77. As a Player, I want Profile tables and inline editors to work on narrow screens, so that I can manage Proficiency and Price Overrides from any device.
78. As a Player, I want invite acceptance to use the same page heading, status, and action hierarchy as other account flows, so that collaboration feels trustworthy.
79. As a maintainer, I want page composition encoded behind a small shared interface, so that hierarchy and responsive behavior can be corrected once.
80. As a maintainer, I want generic controls to live in the shared UI package and AAC-specific composition to live in the application, so that module ownership remains clear.
81. As a maintainer, I want route modules to stop defining local copies of metrics, selects, tooltips, fields, progress indicators, and notices, so that UI behavior does not drift again.
82. As a maintainer, I want the focused Recipe navigator to own recurring presentation and interaction behavior, so that Tool-specific calculations do not duplicate recursive UI code.
83. As a maintainer, I want large Tool migrations delivered independently, so that visual changes can be reviewed without obscuring calculation regressions.
84. As a maintainer, I want visual, responsive, and accessibility acceptance criteria applied to every migrated Tool, so that completion is measurable.
85. As a maintainer, I want tests to assert Player-observable behavior rather than Tailwind classes or source strings, so that internal refactors do not create meaningless test churn.

## Implementation Decisions

- The current Craft page is the design reference for hierarchy and interaction direction. Its embedded styling is not copied route by route; it is first expressed through shared modules while preserving its Player-visible behavior.
- A short UI conventions document records the shared grammar: page widths, vertical rhythm, heading hierarchy, section structure, card usage, row treatment, selection states, semantic states, form layout, responsive behavior, and Currency presentation.
- The shared page-composition module exposes a small interface for a page shell, page heading, and major section. It owns container width, responsive padding, heading structure, back-navigation placement, section heading IDs, accessible labelling, separators, descriptions, and action wrapping.
- The page shell supports intentional normal, wide, narrow, and landing variants. Data-dense Tools may use the wide variant, while invite and status flows may use the narrow variant. Variants do not redefine typography or spacing independently.
- The page heading accepts a title, optional subtitle, optional leading identity such as an Item icon, optional badges, optional back navigation, and optional actions. It remains the only level-one heading on a normal page.
- The major section interface accepts a title, optional description, optional actions, and content. It renders a labelled semantic section and uses the Craft page's quiet separator treatment by default.
- Cards are reserved for independently selectable or linked objects, compact metrics, table or chart frames that need containment, and small decision panels. A card is not the default wrapper for every major section, and recursively nested Recipe cards are prohibited.
- A shared responsive row pattern covers Item and Material identity, primary metadata, secondary metadata, values, status, and actions. It uses separators for static collections and hover surfaces only for interactive rows.
- The existing metric presentation is deepened into one shared metric and metric-grid module. Its interface supports label, value, optional detail, optional help, and a small semantic tone set. Route-local metric variants are removed as their callers migrate.
- Semantic tone values are represented by shared success, warning, destructive, muted, and incomplete styles. Domain-specific Grade colors remain intentional exceptions and retain their Game Data meaning.
- A shared notice or inline-state module represents loading, empty, unavailable, incomplete, warning, and error states. It owns accessible status roles, consistent typography, and optional next actions.
- Generic native select and accessible tooltip modules are added to the shared UI package. Existing shared Field, Input, Button, Checkbox, Table, Progress, Badge, and Accordion modules are preferred over route-local styling.
- AAC-specific page composition, Item rows, economic display, and Recipe navigation remain application modules because they encode product vocabulary and Tool behavior. Generic form and interaction primitives remain in the shared UI package.
- A shared economic display adapter presents resolved prices, Price Override source, Market Data source, Missing Price, Currency values, Labor efficiency, and complete or incomplete result status. It consumes structured economy results when that module is available and does not decide calculation semantics itself.
- Compact Gold notation is used for ordinary economic summaries to match the current Craft page. Exact Gold, Silver, and Copper formatting remains available where exact Currency denominations are part of the Player's task, such as Currency progress. Backend Coin terminology is never Player-facing.
- Missing Price is never rendered as zero, free, `N/A`, or an empty metric. Incomplete results name affected Items and suppress dependent totals, rankings, Profit, Expected Value, and Recommendations while preserving unaffected explanatory breakdowns.
- Profit terminology follows the domain model. Sale calculations without modeled fees use Profit Before Fees. Direct rewards may use Profit when Revenue is already net. Labor remains a separate result unless an explicit Labor Value is applied by economy behavior outside this UI effort.
- The focused Recipe-navigation module presents one Recipe level at a time. Its interface receives the production path, focused Item and Recipe, explicit Recipe Choices, Material rows, Acquisition Modes, price status, and allowed actions; it emits Recipe Choice, Acquisition Mode, focus, and Price Override events.
- Tool-specific calculation state is adapted into the Recipe-navigation interface. The navigator does not own Simulator, Regrading, Costume Planning, Shopping List, or Craft calculation rules and does not create an alternate Plan model.
- Changing a parent Recipe Choice or Acquisition Mode truncates invalid descendant focus state through the Tool's existing Plan behavior. The navigator reflects the resulting valid path rather than maintaining independent nested state.
- Recipe Choices use the same selected-state pattern, Recommendation labelling, output, Labor, cost completeness, per-Item comparison, and distinguishing Material information across every Tool.
- Buy and Craft Acquisition Modes use one segmented selection treatment and expose state through native or ARIA selection semantics. A crafted Material exposes an Inspect action when a deeper Recipe level is available.
- Existing shared URL state, local persistence, Saved Plans, Shopping Lists, loadouts, Price Overrides, mutations, authorization, and backend contracts remain unchanged unless a separate domain effort explicitly changes them.
- Dense comparison tables remain tables. Shared table primitives provide consistent headings, cells, row states, overflow behavior, and mobile fallbacks when a table cannot remain usable at narrow width.
- Global application chrome measures or structurally reserves its responsive header height rather than assuming a fixed single-row height. Mobile navigation, account controls, theme controls, footer behavior, and page offsets are updated together to prevent content overlap.
- The home page remains an intentional landing variant. Tool launcher tiles may remain cards because each tile is an independent destination, but their typography, radii, hover states, and spacing follow the shared grammar.
- Status and invitation pages use the narrow page variant and shared notices/actions instead of a separate decorative visual language.
- Large Tool modules are split along presentation seams as part of migration when extraction reduces risk and duplication. Calculation modules are not reorganized solely for visual consistency.
- The delivery order is: establish conventions and shared modules; migrate Craft and Item surfaces; prove Recipe navigation in Simulator and Shopping List preview; migrate remaining Recipe-heavy Tools; migrate data-dense calculators; migrate Shopping Lists and Profile; finish supporting pages, home, and global chrome.
- Each Tool family is a separate reviewable delivery slice. A slice preserves behavior, removes the local UI duplication it replaces, and completes responsive and accessibility verification before the next family adopts the interface.
- Shared modules are not introduced as pass-through wrappers. Their deletion should cause page hierarchy, accessibility, responsive behavior, or semantic-state logic to reappear across multiple callers; otherwise the abstraction is not justified.
- This effort does not conflict with the decision to keep automation outside the game client. It changes only companion-tool presentation and interaction.

## Testing Decisions

- Tests assert Player-observable behavior through rendered interfaces. They do not assert exact Tailwind class strings, private helper order, source-text fragments, or an exact markup tree.
- The highest primary seam is representative rendered route behavior. Route tests verify that pages compose the shared shell, heading, sections, controls, states, and navigation into a complete Player workflow.
- The shared page-composition interface is a focused rendered seam. Tests verify one level-one heading, labelled major sections, optional back navigation, actions, normal and wide layouts, and responsive action placement through accessible queries rather than source inspection.
- The focused Recipe-navigation interface is the second focused rendered seam. Tests exercise production-path navigation, explicit Recipe Choice, Recommendation labelling, Acquisition Mode changes, Inspect behavior, ancestor navigation, invalid-descendant truncation supplied by the caller, Missing Price presentation, and keyboard operation.
- Existing pure Plan and calculation interfaces remain the test surface for quantities, Craft Cost, Labor, Profit Before Fees, Expected Value, Recipe selection, and recursive production math. UI tests do not reproduce those algorithms.
- The existing craft-page Plan tests are prior art for a high pure seam over Recipe Choices, Acquisition Modes, production path, whole Craft quantities, and incomplete results.
- Existing Item-description rendered tests are prior art for Player-visible formatted content without asserting implementation details.
- Existing Craft optimizer, Trade Pack, Costume Planner, Regrading, Simulator, and Shopping List tests remain responsible for their Tool-specific calculation behavior during migration.
- Existing source-regex tests for shared Recipe controls are not prior art for the new interface. They are replaced by rendered interaction tests once an appropriate harness exists.
- Each migrated route receives coverage for the states it supports: loading, empty, populated, incomplete, unavailable, unsupported, error, and permission-dependent behavior.
- Economic display tests verify that Missing Price is named, is not rendered as zero, suppresses dependent metrics, distinguishes Price Override from Market Data, and uses Profit Before Fees where fees are unmodeled.
- Accessibility tests verify heading order, section labelling, accessible control names, selected-state semantics, status announcements, keyboard reachability, focus visibility, tooltip access, and sufficient semantic distinction without relying on color alone.
- Responsive checks cover at least 390, 768, and 1440 CSS-pixel widths. Representative pages include a long Item name, wrapped actions, a deep production path, dense metrics, a wide comparison table, a large Shopping List, and authenticated application chrome.
- Light and dark themes are covered for semantic tones, borders, muted surfaces, charts, selection states, warnings, destructive actions, and focus rings.
- Visual regression coverage is added for representative public, member, and administrator routes after shared page composition stabilizes. Baselines are updated only for reviewed intentional changes.
- Route integration checks verify that navigation targets, search parameters, shared links, Saved Plans, Shopping List destinations, loadouts, and mutations retain their existing behavior.
- Manual keyboard verification accompanies automated accessibility checks for the focused Recipe navigator, dense data tables, inline Price Override editing, global navigation, and action menus.
- No-horizontal-overflow checks are performed at narrow width, except inside an explicitly labelled table scroll container. Header and footer overlap checks verify that the first and last interactive content remain visible.
- Each delivery slice runs its affected calculation tests, application typecheck, lint, and production build. The complete effort runs all Tool-specific suites before it is considered finished.
- Tests are added at shared interfaces before broad route migration so later slices can rely on the same behavioral contract rather than duplicating route-specific assertions.

## Out of Scope

- Changing Recipe, Simulation, Regrading, Resealing, Salvaging, Trade Pack, Costume Planning, or Shopping List calculation rules.
- Implementing the shared economy module, Market Snapshot freshness propagation, transaction fee policy, Labor Value persistence, or invalid Saved Plan correction described by the separate domain-model alignment effort.
- Choosing a canonical Auction House transaction fee.
- Changing database schemas, tRPC contracts, authentication providers, authorization roles, or persistence formats solely for this UI migration.
- Renaming backend craft tables or internal identifiers to match Player-facing Recipe and Craft terminology.
- Replacing every dense table with cards or reducing information density where comparison is the primary task.
- Rebranding AAC Dashboard, replacing its existing theme palette, changing its typography family, or redesigning Item icons.
- Creating a general-purpose visual page builder or a highly configurable catch-all card module.
- Adding new Tools or changing home-page product messaging beyond what is needed for consistent presentation.
- Redesigning Game Data ingestion or correcting source descriptions beyond continuing to use the shared description renderer.
- Automating Crafts, purchases, inventory changes, or any other in-game action.

## Further Notes

- The current Craft page is the source of truth for the desired direction, including its latest compact Gold formatting and section hierarchy. The earlier Craft redesign spec remains authoritative for focused Recipe interaction, explicit Recipe Choices, Acquisition Modes, incomplete results, accessibility, and responsive behavior.
- This specification intentionally expands beyond the earlier Craft redesign's out-of-scope boundary by applying its accepted conventions to other Tools. It does not change the earlier Craft feature's calculation or Plan-state decisions.
- The existing theme tokens, Geist typography, Button, Input, Badge, Checkbox, Field, Table, Progress, Accordion, Item icon, and metric work provide a strong base. The goal is consolidation and consistent composition rather than replacement of the entire UI package.
- Data-dense Tools need intentional wide layouts. Homogenization means they share hierarchy, semantics, controls, states, and spacing—not that every Tool receives the same column count or maximum width.
- Saved Shopping Lists and Tool launcher tiles are legitimate card use cases because each card represents an independent object or destination. Structural sections and recursively nested Recipes are not.
- The separate domain-model alignment effort should land shared economic result semantics before or alongside broad economic-state migration. Until then, the UI work must not normalize missing values to zero or invent new economic rules.
- The two proposed focused test seams are shared page composition and focused Recipe navigation, with representative rendered routes above both. This keeps the interface count small while respecting that general page hierarchy and recursive Recipe interaction vary for different reasons.
- No existing ADR is contradicted by this specification.
