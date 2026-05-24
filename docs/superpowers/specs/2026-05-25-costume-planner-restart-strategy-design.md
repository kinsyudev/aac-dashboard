# Costume Planner Restart Strategy Design

## Goal

Refine the costume and undergarment planner so it recommends a practical upgrade strategy, including when salvaging and restarting has a lower expected cost than continuing to reroll the same item.

## Scope

The planner should keep the current uniform reroll model, target stat selection, subtype inference, material pricing, salvage pricing, and current item comparison. It should add an optimal restart-aware policy that produces strategy checkpoints rather than only a forced average reroll count.

Restart means salvaging the current item with a Brilliant Mornstone and starting again from Grand 0% with no target stats kept.

## Base Item Costs

Costumes have an acquisition value of 200 prestige. Prestige is valued at one tenth of a Misagon's Crystal, so the default costume base item cost is:

```ts
20 * misagonCrystalPrice
```

Undergarments cost 15g plus 14,000 honor. Honor defaults to 10g per 1,000 honor, so the default undergarment base item cost is:

```ts
15 + 14 * honorGoldPerThousand
```

With the default honor rate, that is 155g.

## Strategy Model

The engine should evaluate item states by grade, progress, and kept target stats:

```ts
type StrategyState = {
  grade: Grade;
  progress: number;
  keptTargetStatIds: string[];
};
```

For each state, the planner compares:

```ts
bestCost(state) = min(continueCost(state), restartCost(state))
```

`continueCost` accounts for the remaining synthesis path and rerolls for missing target stats. `restartCost` accounts for salvage credit, Brilliant Mornstone cost, base item acquisition cost, and the optimal cost of a fresh item from Grand 0%.

The first implementation should expose a deterministic checkpoint strategy. Monte Carlo risk ranges are out of scope.

## UI

The route should add a strategy checkpoint section that explains the best action at each relevant grade/state:

- roll for useful stats when that is cheaper than restarting
- synth forward when no useful target stats unlock at the current grade
- restart when the expected cost of continuing from an unfavorable state is worse than starting over

The recommendation panel should show base item cost assumptions alongside salvage credit so restart calculations are auditable.

## Testing

Tests should prove:

- costume base item cost uses `20 * misagonCrystalPrice`
- undergarment base item cost defaults to `155g`
- restarting includes base item acquisition cost
- high Serendipity Stone prices make poor early states restart
- kept target stats reduce the expected remaining optimal cost
- the existing forced route behavior remains available for baseline cost display
