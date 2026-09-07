# AAC Dashboard

AAC Dashboard is an evolving suite of tools for ArcheAge Classic players. It helps players make data-informed economic decisions and makes cumbersome game-related tasks easier.

## Language

### Product and identity

**Player**:
A person who uses AAC Dashboard to make data-informed economic decisions or simplify tasks related to playing ArcheAge Classic.
_Avoid_: User, except in technical authentication or persistence contexts

**Account**:
An authenticated AAC Dashboard identity used to persist a Player's settings and data across Tools.
_Avoid_: Player when referring specifically to an authentication or persistence record

**Discord Identity**:
A Player's Discord identity, which may be linked to an Account but can use Discord-native Tools without one.

**Tool**:
A focused AAC Dashboard capability that either helps a Player make a data-informed decision or makes a game-related task easier.

### Data and pricing

**Game Data**:
Reference facts about ArcheAge Classic content and mechanics, imported from external sources and amended by deliberate local corrections when those sources are incomplete or inaccurate.

**Market Data**:
Auction House price and traded-volume statistics for an Item, summarized over defined time windows. The ingestion path is not part of the domain model.
_Avoid_: Market Price when referring to the complete price-and-volume dataset

**Market Snapshot**:
Market Data associated with the time it was observed. Stale data remains known historical data rather than becoming a Missing Price.

**Price Override**:
A Player-supplied per-unit Gold value for an Item that takes precedence over Market Data in calculations. Its economic interpretation belongs to the Player.

**Missing Price**:
An unknown Item value caused by absent Market Data and no Price Override. It is never equivalent to a zero price and must not be treated as a free input to a calculation.

### Items and crafting

**Item**:
A distinct ArcheAge Classic in-game object identified by its game item ID. An Item may be tradeable, craftable, used as a Material, or none of those.
_Avoid_: Product or Material when referring to an Item outside a crafting relationship

**Material**:
The role an Item plays when it is consumed by a Craft.

**Product**:
The role an Item plays when it is produced by a Craft.

**Recipe**:
A game-defined production rule specifying the Materials, Labor, and Currency consumed to produce one or more Products.
_Avoid_: Craft when referring to the production rule

**Craft**:
One execution of a Recipe.
_Avoid_: Recipe when referring to an execution

**Currency**:
ArcheAge Classic money, expressed in Gold, Silver, and Copper. One Gold equals 100 Silver or 10,000 Copper.
_Avoid_: Coins

**Labor**:
A replenishing Player resource consumed by Crafts and other economic actions. Labor is an economic constraint but has no universal Currency value.

**Labor Value**:
A Player-supplied minimum Currency value per Labor point, commonly expressed as Silver per Labor, representing the opportunity cost of spending Labor.

**Proficiency**:
A Player's progression in a game activity, which can reduce the Labor consumed by related actions.

**Craft Cost**:
The Currency value of Materials plus any Currency directly consumed by a Craft, normally displayed in Gold and using Price Overrides where present and otherwise Market Data. Owned Materials retain their value; Labor is reported separately and is never silently converted into Craft Cost.

**Remaining Spend**:
The additional Currency a Player must spend to complete a Plan after accounting for Materials already obtained. Owned Materials reduce Remaining Spend but not Craft Cost.

### Planning and optimization

**Target**:
The desired in-game outcome a Plan is intended to reach, such as an Item quantity, Grade, or stat configuration.

**Acquisition Mode**:
The chosen way to obtain an Item for a Plan: buy it or produce it through a Recipe. Acquisition Modes may apply recursively to intermediate Materials.

**Recipe Choice**:
The specific Recipe selected to produce an Item when multiple Recipes are available.

**Optimization Goal**:
The Player-selected criterion used to compare valid Plans, such as lowest Craft Cost, lowest Labor, highest Profit, or highest Profit per Labor.

**Plan**:
A concrete set of quantities, Acquisition Modes, Recipe Choices, and assumptions for reaching a Target.

**Recommendation**:
A Tool-proposed Plan selected for a stated Optimization Goal. Recommendations remain explainable and editable by the Player.

**Saved Plan**:
Persisted Plan inputs and Player choices that recalculate against the latest available Market Snapshot when reopened.

**Plan Snapshot**:
An immutable capture of a Plan's inputs, Market Snapshot, and results at a specific time, used when historical reproducibility is required.

**Incomplete Plan**:
A Plan with a missing or invalid required input, Acquisition Mode, or Recipe Choice. A Tool may offer a replacement Recommendation but must not silently change the Player's Plan.

### Economic results

**Effective Cost**:
A Player-specific comparison value equal to Craft Cost plus Labor valued at the Player's Labor Value. It does not replace the separately reported Craft Cost and Labor totals.

**Revenue**:
The Currency value returned by an outcome before its costs are deducted.

**Sale Price**:
The gross Currency amount paid for an Item before transaction fees.

**Net Revenue**:
Sale Price or other Revenue after applicable transaction fees are deducted.

**Profit**:
Net Revenue minus Currency costs. Labor is excluded.

**Profit Before Fees**:
Sale Price or other gross Revenue minus Currency costs when applicable transaction fees have not been modeled.

**Effective Profit**:
Profit minus the opportunity cost expressed by the Player's Labor Value.

**Expected Value**:
The probability-weighted average monetary result of a Simulation across repeated identical scenarios. It is neither the most likely result nor a guarantee for one attempt.

**Effective Expected Value**:
Expected Value adjusted to include the opportunity cost expressed by the Player's Labor Value.

**Simulation**:
A reproducible calculation of possible or expected game outcomes from explicit Game Data, Market Data, Price Overrides, and Player-selected assumptions. It is decision support, not a prediction or guarantee of an individual outcome.

### Shopping and collaboration

**Shopping List**:
A persistent, optionally shared Plan for acquiring Materials and completing Crafts needed for one or more Targets. It tracks requirements, progress, and Acquisition Modes.
_Avoid_: Shoplist

**Shared Shopping List**:
A Shopping List accessible to multiple Players whose requirements and progress are common to everyone with access. It is not a collection of per-Player copies.

### Farming

**Farm**:
A Player-defined representation of an in-game planting location, used to group crop timing and notification preferences; within Discord, a Farm belongs to one server and is separate from that Player's Farms in other servers. A Farm is optional and does not itself contain or own active timers.

**Farm Timer**:
A reminder schedule for one planted Item, beginning at its recorded planting time and ending when it is expected to be ready. Within Discord, a Farm Timer belongs to one server, where it is managed and announced.

### Trade

**Trade Pack**:
An Item produced for delivery through ArcheAge Classic's trade system, whose reward depends on where and under what conditions it is delivered.

**Trade Route**:
The origin-and-destination pairing used to evaluate a Trade Pack's Revenue, Profit, and Labor efficiency.

### Equipment progression

**Grade**:
An Item's quality tier in the ArcheAge Classic progression hierarchy.

**Regrading**:
ArcheAge Classic's probabilistic equipment-progression process. It consumes a Regrade Scroll, a Currency fee, and optionally a Regrade Charm to attempt to change an Item's Grade.

**Regrade Attempt**:
One execution of Regrading, resulting in normal success, great success, no change, downgrade, or destruction.

**Regrade Strategy**:
A policy for repeated Regrade Attempts, including consumable choices, Target Grade, and what to do after downgrade or destruction.

**Resealing**:
The process of consuming a matching Mana Seal to return an unwanted revealed equipment variant to its sealed form, allowing its variant to be rolled again without recreating the base Item.

**Reseal Loop**:
Repeatedly reveal and reseal the same Item until the Target variant is obtained. Each unsuccessful reveal consumes another Mana Seal.

**Salvaging**:
Irreversibly destroying an equipment Item to recover Mana Wisps. The recovered quantity depends on the Item's tier, category, and equipment piece.

**Salvage Value**:
The Currency value of recovered Mana Wisps, using their Price Override or Market Data.

**Salvage Loop**:
Repeatedly Craft a new sealed Item, salvage each unwanted result, and use the recovered Mana Wisps toward the next attempt until the Target variant is obtained.
