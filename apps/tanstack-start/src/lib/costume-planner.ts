import type {
  GearKind,
  GearSubtype,
  Grade,
  PlannerMaterialAmount,
  PlannerMaterialId,
  PlannerStat,
  PlannerSubtype,
  SynthesisBar,
  SynthiumTier,
} from "./costume-planner-data.ts";
import {
  BASIC_SYNTHESIS_BAR,
  GRADES,
  MATERIAL_LABELS,
  MATERIAL_PRICE_LOOKUP_NAMES,
  PLANNER_STATS,
  PRICE_LOOKUP_ITEM_NAMES,
  SALVAGE_OUTPUTS,
  STAT_LINE_THRESHOLDS,
  SUBTYPE_ORDER,
  SYNTHESIS_BARS,
  SYNTHIUM_CRAFTS,
  SYNTHIUM_STONE_IDS,
} from "./costume-planner-data.ts";
import { STAT_POOLS } from "./costume-planner-pools.ts";

export {
  GRADES,
  MATERIAL_LABELS,
  MATERIAL_PRICE_LOOKUP_NAMES,
  PLANNER_STATS,
  PRICE_LOOKUP_ITEM_NAMES,
  STAT_LINE_THRESHOLDS,
  SYNTHESIS_BARS,
};
export type {
  GearKind,
  GearSubtype,
  Grade,
  PlannerMaterialAmount,
  PlannerMaterialId,
  PlannerStat,
  PlannerSubtype,
  SynthiumTier,
};

export type SubtypeInference =
  | { status: "inferred"; subtype: GearSubtype }
  | { status: "any"; subtype: "any" }
  | { status: "conflict"; subtypes: GearSubtype[] };

export type PlannerPrices = Partial<Record<PlannerMaterialId, number>>;

export interface RerollEstimate {
  availableOutcomes: number;
  favorableOutcomes: number;
  successChance: number;
  expectedAttempts: number;
  expectedCost: number;
}

export interface BaseItemCostOptions {
  honorGoldPerThousand?: number;
}

export interface MaterialPricingOptions {
  // also price synthium stones through the bound recipes that start from Activity Tokens, when cheaper
  boundSynthiumForEpicPlus?: boolean;
  // gold value of one Activity Token (they can't be traded; defaults to 0)
  activityTokenPrice?: number;
  serendipityStonePrice?: number;
}

export type SynthiumSource = "market" | "crafted" | "activityTokens";

export interface CostBreakdown {
  materialCost: number;
  craftGold: number;
  rerollCost: number;
  salvageCredit: number;
  totalCost: number;
  expectedRerolls: number;
  materials: PlannerMaterialAmount[];
  // base items bought, counting restarts (included in totalCost)
  baseItemCost?: number;
  expectedRestarts?: number;
}

export interface RouteCheckpoint {
  grade: Grade;
  action: string;
  expectedRerolls: number;
}

export interface TargetRoute {
  subtype: SubtypeInference;
  targetCost: CostBreakdown;
  checkpoints: RouteCheckpoint[];
}

export type StrategyAction =
  | "reroll"
  | "synth"
  | "continue"
  | "restart"
  | "complete";

export interface StrategyCheckpoint {
  grade: Grade;
  action: StrategyAction;
  label: string;
  expectedCost: number;
  restartCost?: number;
}

export interface OptimalStrategyRoute extends TargetRoute {
  baseItemCost: number;
  // includes the base item of every attempt, salvage and expected restarts
  targetCost: CostBreakdown;
  // grades where a fresh item is salvaged if its free rolls miss
  restartGrades: Grade[];
  expectedRestarts: number;
  strategyCheckpoints: StrategyCheckpoint[];
}

export interface CurrentItemInput {
  grade: Grade;
  progress: number;
  statIds: string[];
  currentItemValue?: number;
}

export interface CurrentComparison {
  recommendation: "continue" | "restart" | "synth";
  continueCost: CostBreakdown;
  restartCost: CostBreakdown;
  synthCost?: CostBreakdown;
  synthGrade?: Grade;
  synthReason?: "statLine" | "gradeReroll";
  subtype: SubtypeInference;
  checkpoints: RouteCheckpoint[];
}

export interface CurrentStrategyComparison extends CurrentComparison {
  baseItemCost: number;
  strategyCheckpoints: StrategyCheckpoint[];
}

const statById = new Map(PLANNER_STATS.map((stat) => [stat.id, stat]));

export function inferSubtype(
  statIds: string[],
  kind: GearKind,
): SubtypeInference {
  let candidates: GearSubtype[] | undefined;
  const named = new Set<GearSubtype>();

  for (const statId of statIds) {
    const subtypes = statById.get(statId)?.subtypesByKind[kind];
    if (!subtypes) continue;
    for (const subtype of subtypes) named.add(subtype);
    candidates = (candidates ?? subtypes).filter((subtype) =>
      subtypes.includes(subtype),
    );
  }

  if (!candidates) return { status: "any", subtype: "any" };
  const [only, ...rest] = SUBTYPE_ORDER.filter((subtype) =>
    candidates.includes(subtype),
  );
  if (only && rest.length === 0) return { status: "inferred", subtype: only };
  if (only) return { status: "any", subtype: "any" };

  return {
    status: "conflict",
    subtypes: SUBTYPE_ORDER.filter((subtype) => named.has(subtype)),
  };
}

export function getPlannerStats(kind: GearKind): PlannerStat[] {
  return PLANNER_STATS.filter((stat) => stat.kinds.includes(kind));
}

// Stats that can roll at `grade`. "any" is every role's item together.
export function getAvailableStatIds(
  kind: GearKind,
  grade: Grade,
  subtype: PlannerSubtype,
): string[] {
  const gradeIndex = getGradeIndex(grade);
  const roles = subtype === "any" ? SUBTYPE_ORDER : [subtype];
  const available = new Set<string>();

  for (const role of roles) {
    for (const [statId, , unlockGrade] of STAT_POOLS[kind][role]) {
      if (getGradeIndex(unlockGrade) <= gradeIndex) available.add(statId);
    }
  }

  return getPlannerStats(kind)
    .map((stat) => stat.id)
    .filter((statId) => available.has(statId));
}

// The grade a role's item first rolls a stat at.
export function getStatUnlockGrade(
  kind: GearKind,
  subtype: PlannerSubtype,
  statId: string,
): Grade | undefined {
  if (subtype === "any") return statById.get(statId)?.unlockGradeByKind[kind];
  return STAT_POOLS[kind][subtype].find(([id]) => id === statId)?.[2];
}

export function getStatLineCount(kind: GearKind, grade: Grade): number {
  const gradeIndex = getGradeIndex(grade);

  return STAT_LINE_THRESHOLDS[kind].filter(
    (threshold) => getGradeIndex(threshold) <= gradeIndex,
  ).length;
}

export function getNextStatLineThreshold(
  kind: GearKind,
  currentGrade: Grade,
  targetGrade: Grade,
): Grade | undefined {
  const currentGradeIndex = getGradeIndex(currentGrade);
  const targetGradeIndex = getGradeIndex(targetGrade);

  return STAT_LINE_THRESHOLDS[kind].find((threshold) => {
    const thresholdIndex = getGradeIndex(threshold);
    return (
      thresholdIndex > currentGradeIndex && thresholdIndex <= targetGradeIndex
    );
  });
}

// Serendipity Stones to roll any one of `desiredStatIds` onto a non-target line at `grade`. A roll picks a stat
// with chance weight / total weight of the stats unlocked at that grade, and never one already on the item: the
// kept targets, the other non-target lines and the line being replaced are all excluded.
export function estimateExpectedRerolls({
  desiredStatIds,
  freeAttempts = 0,
  grade,
  keptStatIds,
  kind,
  serendipityPrice = 0,
  subtype,
}: {
  kind: GearKind;
  grade: Grade;
  subtype: PlannerSubtype;
  desiredStatIds: string[];
  keptStatIds: string[];
  freeAttempts?: number;
  serendipityPrice?: number;
}): RerollEstimate {
  const role = resolveRole(kind, subtype, [...desiredStatIds, ...keptStatIds]);
  const gradeIndex = getGradeIndex(grade);
  const pool = STAT_POOLS[kind][role].filter(
    ([, , unlockGrade]) => getGradeIndex(unlockGrade) <= gradeIndex,
  );
  const weightOf = new Map(pool.map(([statId, weight]) => [statId, weight]));
  const kept = new Set(keptStatIds.filter((statId) => weightOf.has(statId)));
  const favorable = [
    ...new Set(desiredStatIds.filter((statId) => !kept.has(statId))),
  ].filter((statId) => weightOf.has(statId));
  const otherLines = Math.max(1, getStatLineCount(kind, grade) - kept.size);
  const sum = (statIds: Iterable<string>) =>
    [...statIds].reduce(
      (total, statId) => total + (weightOf.get(statId) ?? 0),
      0,
    );
  // a non-target line holds a stat rolled by weight, so its expected weight is sum(w^2) / sum(w)
  const junk = [...weightOf].filter(
    ([statId]) => !kept.has(statId) && !favorable.includes(statId),
  );
  const junkWeight =
    junk.reduce((total, [, weight]) => total + weight * weight, 0) /
    Math.max(
      1,
      junk.reduce((total, [, weight]) => total + weight, 0),
    );
  const totalWeight = Math.max(
    sum(weightOf.keys()) - sum(kept) - otherLines * junkWeight,
    sum(favorable),
  );
  const successChance = totalWeight > 0 ? sum(favorable) / totalWeight : 0;
  const expectedAttempts =
    successChance > 0
      ? Math.pow(1 - successChance, freeAttempts) / successChance
      : 0;

  return {
    availableOutcomes: pool.length - kept.size - otherLines,
    favorableOutcomes: favorable.length,
    successChance,
    expectedAttempts,
    expectedCost: expectedAttempts * serendipityPrice,
  };
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

// Route for a fresh item that never restarts: synthesis from basic plus expected Serendipity Stones.
export function planTargetRoute(input: {
  kind: GearKind;
  targetGrade: Grade;
  targetProgress: number;
  desiredStatIds: string[];
  prices: PlannerPrices;
  materialPricing?: MaterialPricingOptions;
  // the item's role; inferred from the stats when left out
  role?: GearSubtype;
}): TargetRoute {
  const context = createPlanContext(input);
  const plan = planFromState(
    context,
    { grade: "basic", progress: 0, keptStatIds: [] },
    Infinity,
  );
  const materials = [...plan.materials].map(([id, amount]) => ({
    id,
    amount,
  }));
  const materialCost = getMaterialCost(
    materials,
    input.prices,
    input.materialPricing,
  );
  const rerollCost = plan.rerolls * context.serendipityPrice;

  return {
    subtype: context.subtype,
    checkpoints: plan.checkpoints,
    targetCost: buildCostBreakdown({
      materials,
      materialCost,
      craftGold: plan.craftGold,
      expectedRerolls: plan.rerolls,
      rerollCost,
      salvageCredit: 0,
    }),
  };
}

export function planOptimalStrategy({
  desiredStatIds,
  honorGoldPerThousand,
  kind,
  prices,
  targetGrade,
  targetProgress,
  materialPricing,
  role,
}: {
  kind: GearKind;
  targetGrade: Grade;
  targetProgress: number;
  desiredStatIds: string[];
  prices: PlannerPrices;
  materialPricing?: MaterialPricingOptions;
  // the item's role; inferred from the stats when left out
  role?: GearSubtype;
} & BaseItemCostOptions): OptimalStrategyRoute {
  const baseItemCost = estimateBaseItemCost({
    kind,
    prices,
    honorGoldPerThousand,
  });
  const context = createPlanContext({
    kind,
    targetGrade,
    targetProgress,
    desiredStatIds,
    role,
    prices,
    materialPricing,
  });
  const fresh = planFreshRoute(context, baseItemCost);

  return {
    subtype: context.subtype,
    checkpoints: fresh.checkpoints,
    baseItemCost,
    targetCost: fresh.cost,
    restartGrades: fresh.restartGrades,
    expectedRestarts: fresh.expectedRestarts,
    strategyCheckpoints: buildStrategyCheckpoints({
      checkpoints: fresh.checkpoints,
      baseItemCost,
      restartGrades: fresh.restartGrades,
      serendipityPrice: context.serendipityPrice,
      targetGrade,
      targetCost: fresh.cost,
    }),
  };
}

// The current item against salvaging it and starting over. Without a base item cost, a fresh item is free.
export function compareCurrentItem(
  input: {
    kind: GearKind;
    targetGrade: Grade;
    targetProgress: number;
    desiredStatIds: string[];
    current: CurrentItemInput;
    prices: PlannerPrices;
    materialPricing?: MaterialPricingOptions;
    // the item's role; inferred from the stats when left out
    role?: GearSubtype;
  },
  baseItemCost = 0,
): CurrentComparison {
  const { current } = input;
  const context = createPlanContext(input);
  const fresh = planFreshRoute(context, baseItemCost);
  const currentStats = new Set(current.statIds);
  const start = {
    grade: current.grade,
    progress: current.progress,
    keptStatIds: input.desiredStatIds.filter((statId) =>
      currentStats.has(statId),
    ),
  };
  // the best plan, which may salvage right away, and the best one that keeps the item for now
  const plan = planFromState(context, start, fresh.cost.totalCost);
  const keepPlan = planFromState(context, start, fresh.cost.totalCost, false);
  const continueCost = combineAttempts(
    keepPlan,
    fresh.cost,
    context,
    keepPlan.restartChance,
  );
  const salvageCredit =
    salvageValue(current.grade, context) + (current.currentItemValue ?? 0);
  const restartCost: CostBreakdown = {
    ...fresh.cost,
    salvageCredit: fresh.cost.salvageCredit + salvageCredit,
    totalCost: fresh.cost.totalCost - salvageCredit,
  };
  const missing = input.desiredStatIds.some(
    (statId) => !currentStats.has(statId),
  );
  const synthGrade =
    missing && !plan.rerollNow && plan.nextGrade !== current.grade
      ? plan.nextGrade
      : undefined;
  const recommendation =
    plan.restartNow || restartCost.totalCost < continueCost.totalCost
      ? "restart"
      : synthGrade
        ? "synth"
        : "continue";
  const synthesis = synthGrade
    ? getSynthesisRequirement(current.grade, current.progress, synthGrade, 0)
    : undefined;

  return {
    recommendation,
    continueCost,
    restartCost,
    synthCost: synthesis
      ? buildCostBreakdown({
          materials: synthesis.materials,
          materialCost: getMaterialCost(
            synthesis.materials,
            context.prices,
            context.materialPricing,
          ),
          craftGold: synthesis.craftGold,
          expectedRerolls: 0,
          rerollCost: 0,
          salvageCredit: 0,
        })
      : undefined,
    synthGrade,
    synthReason: synthGrade
      ? STAT_LINE_THRESHOLDS[input.kind].includes(synthGrade)
        ? "statLine"
        : "gradeReroll"
      : undefined,
    subtype: context.subtype,
    checkpoints: plan.checkpoints,
  };
}

export function compareCurrentStrategy({
  honorGoldPerThousand,
  ...input
}: {
  kind: GearKind;
  targetGrade: Grade;
  targetProgress: number;
  desiredStatIds: string[];
  current: CurrentItemInput;
  prices: PlannerPrices;
  materialPricing?: MaterialPricingOptions;
  // the item's role; inferred from the stats when left out
  role?: GearSubtype;
} & BaseItemCostOptions): CurrentStrategyComparison {
  const baseItemCost = estimateBaseItemCost({
    kind: input.kind,
    prices: input.prices,
    honorGoldPerThousand,
  });
  const comparison = compareCurrentItem(input, baseItemCost);

  return {
    ...comparison,
    baseItemCost,
    strategyCheckpoints: buildCurrentStrategyCheckpoints({
      comparison,
      current: input.current,
      serendipityPrice: getMaterialPrice(
        "serendipityStone",
        input.prices,
        input.materialPricing,
      ),
    }),
  };
}

interface PlanContext {
  kind: GearKind;
  role: GearSubtype;
  subtype: SubtypeInference;
  targetGrade: Grade;
  targetProgress: number;
  desiredStatIds: string[];
  prices: PlannerPrices;
  materialPricing?: MaterialPricingOptions;
  serendipityPrice: number;
}

function createPlanContext(input: {
  kind: GearKind;
  targetGrade: Grade;
  targetProgress: number;
  desiredStatIds: string[];
  prices: PlannerPrices;
  materialPricing?: MaterialPricingOptions;
  // the item's role; inferred from the stats when left out
  role?: GearSubtype;
}): PlanContext {
  const subtype: SubtypeInference = input.role
    ? { status: "inferred", subtype: input.role }
    : inferSubtype(input.desiredStatIds, input.kind);

  return {
    ...input,
    subtype,
    role: resolveRole(input.kind, subtype, input.desiredStatIds),
    serendipityPrice: getMaterialPrice(
      "serendipityStone",
      input.prices,
      input.materialPricing,
    ),
  };
}

interface StatePlan {
  // expected gold from this state to the target, a restart priced at the fresh cost minus salvage
  cost: number;
  // chance this item gets salvaged on the way, and what this item spends before finishing or salvage
  restartChance: number;
  materials: Map<PlannerMaterialId, number>;
  craftGold: number;
  rerolls: number;
  salvage: number;
  checkpoints: RouteCheckpoint[];
  restartGrades: Grade[];
  // whether the next step is buying Serendipity Stones at the current grade, else the grade to synthesize to
  rerollNow: boolean;
  restartNow: boolean;
  nextGrade: Grade;
}

// Fresh route: a new base item at basic, restarting when it pays. The fresh cost and the plan depend on each
// other (a restart costs a fresh start): solve for the fixed point.
interface FreshRoute {
  cost: CostBreakdown;
  checkpoints: RouteCheckpoint[];
  restartGrades: Grade[];
  expectedRestarts: number;
}

// the same fresh route is asked for again for every current-item comparison
const freshRouteCache = new Map<string, FreshRoute>();

function planFreshRoute(
  context: PlanContext,
  baseItemCost: number,
): FreshRoute {
  const key = JSON.stringify([
    context.kind,
    context.role,
    context.targetGrade,
    context.targetProgress,
    context.desiredStatIds,
    context.prices,
    context.materialPricing,
    baseItemCost,
  ]);
  const cached = freshRouteCache.get(key);
  if (cached) return cached;
  const route = solveFreshRoute(context, baseItemCost);
  if (freshRouteCache.size >= 64) freshRouteCache.clear();
  freshRouteCache.set(key, route);
  return route;
}

function solveFreshRoute(
  context: PlanContext,
  baseItemCost: number,
): FreshRoute {
  const start = { grade: "basic" as const, progress: 0, keptStatIds: [] };
  // The plan's cost grows with the fresh cost at a rate equal to its restart chance, piecewise linearly, so
  // Newton steps reach the fixed point in a few iterations.
  let freshCost = baseItemCost + planFromState(context, start, Infinity).cost;
  let plan = planFromState(context, start, freshCost);
  for (let iteration = 0; iteration < 50; iteration += 1) {
    const slope = Math.min(plan.restartChance, 1 - 1e-9);
    const updated =
      (baseItemCost + plan.cost - slope * freshCost) / (1 - slope);
    const converged = Math.abs(updated - freshCost) < 1e-6;
    freshCost = updated;
    plan = planFromState(context, start, freshCost);
    if (converged) break;
  }

  const attempts = 1 / Math.max(1e-9, 1 - plan.restartChance);
  const materials = [...plan.materials].map(([id, amount]) => ({
    id,
    amount: amount * attempts,
  }));
  const expectedRerolls = plan.rerolls * attempts;

  return {
    cost: {
      materials,
      materialCost: getMaterialCost(
        materials,
        context.prices,
        context.materialPricing,
      ),
      craftGold: plan.craftGold * attempts,
      rerollCost: expectedRerolls * context.serendipityPrice,
      salvageCredit: plan.salvage * attempts,
      expectedRerolls,
      baseItemCost: baseItemCost * attempts,
      expectedRestarts: attempts - 1,
      totalCost: freshCost,
    },
    checkpoints: plan.checkpoints,
    restartGrades: plan.restartGrades,
    expectedRestarts: attempts - 1,
  };
}

// What finishing from a state costs, with this item's own spend plus a fresh route for the chance it restarts.
function combineAttempts(
  plan: StatePlan,
  fresh: CostBreakdown,
  context: PlanContext,
  restartChance: number,
): CostBreakdown {
  const materials = new Map(plan.materials);
  for (const material of fresh.materials) {
    materials.set(
      material.id,
      (materials.get(material.id) ?? 0) + material.amount * restartChance,
    );
  }
  const amounts = [...materials].map(([id, amount]) => ({ id, amount }));
  const expectedRerolls = plan.rerolls + fresh.expectedRerolls * restartChance;
  const materialCost = getMaterialCost(
    amounts,
    context.prices,
    context.materialPricing,
  );
  const craftGold = plan.craftGold + fresh.craftGold * restartChance;
  const rerollCost = expectedRerolls * context.serendipityPrice;
  const salvageCredit = plan.salvage + fresh.salvageCredit * restartChance;

  return {
    materials: amounts,
    materialCost,
    craftGold,
    rerollCost,
    salvageCredit,
    expectedRerolls,
    baseItemCost: (fresh.baseItemCost ?? 0) * restartChance,
    expectedRestarts: restartChance * (1 + (fresh.expectedRestarts ?? 0)),
    totalCost: plan.cost,
  };
}

// Plan from an item state, one missing target at a time in the order they unlock. Reaching a grade gives free
// rolls: the new line, if the grade adds one, and the free replacement. For each target the plan picks the grade
// at which, if no free roll has hit it yet, it is either bought with Serendipity Stones or the item is salvaged
// for a fresh start costing `freshCost`. A roll counts as a hit on any target still missing that can roll there.
function planFromState(
  context: PlanContext,
  start: {
    grade: Grade | "basic";
    progress: number;
    keptStatIds: string[];
  },
  freshCost: number,
  // false: the item is never salvaged at its current grade (the "continue" cost); later grades may still restart
  salvageNow = true,
): StatePlan {
  const { kind, prices, materialPricing, role, serendipityPrice } = context;
  const { targetGrade, targetProgress } = context;
  const pool = STAT_POOLS[kind][role].map(([statId, weight, unlockGrade]) => ({
    statId,
    weight,
    unlockIndex: getGradeIndex(unlockGrade),
  }));
  const kept = start.keptStatIds.filter((statId) =>
    pool.some((entry) => entry.statId === statId),
  );
  const missing = pool
    .filter(
      (entry) =>
        context.desiredStatIds.includes(entry.statId) &&
        !kept.includes(entry.statId),
    )
    .sort(
      (left, right) =>
        left.unlockIndex - right.unlockIndex || right.weight - left.weight,
    );
  const missingIds = missing.map((entry) => entry.statId);
  const startIndex = start.grade === "basic" ? -1 : getGradeIndex(start.grade);
  const targetIndex = getGradeIndex(targetGrade);
  const gradeOf = (index: number): Grade => GRADES[index] ?? targetGrade;
  const gradeAt = (index: number): Grade | "basic" =>
    index < 0 ? "basic" : gradeOf(index);
  const lines = (index: number) =>
    index < 0 ? 0 : getStatLineCount(kind, gradeOf(index));

  // from one grade to another; `final` runs on to the target progress
  const synthesis = (fromIndex: number, toIndex: number, final: boolean) =>
    getSynthesisRequirement(
      gradeAt(fromIndex),
      fromIndex === startIndex ? start.progress : 0,
      gradeOf(toIndex),
      final ? targetProgress : 0,
    );
  const synthesisCache = new Map<string, number>();
  const synthCost = (fromIndex: number, toIndex: number, final: boolean) => {
    const key = `${fromIndex}:${toIndex}:${final}`;
    let cost = synthesisCache.get(key);
    if (cost == null) {
      const required = synthesis(fromIndex, toIndex, final);
      cost =
        getMaterialCost(required.materials, prices, materialPricing) +
        required.craftGold;
      synthesisCache.set(key, cost);
    }
    return cost;
  };

  // chance one roll at `gradeIndex` gets the step's target, or another missing one from the same unlock tier
  // (same tier, same weight: whichever comes first is kept), and the free rolls on reaching that grade
  const rollChance = (step: number, gradeIndex: number) => {
    const owned = kept.length + step;
    if (lines(gradeIndex) <= owned) return 0;
    const tier = missing[step]?.unlockIndex;
    return estimateExpectedRerolls({
      kind,
      grade: gradeOf(gradeIndex),
      subtype: role,
      desiredStatIds: missing
        .slice(step)
        .filter((entry) => entry.unlockIndex === tier)
        .map((entry) => entry.statId),
      keptStatIds: [...kept, ...missingIds.slice(0, step)],
    }).successChance;
  };
  const freeRolls = (step: number, gradeIndex: number) => {
    const owned = kept.length + step;
    const before = lines(gradeIndex - 1);
    return lines(gradeIndex) - before + (before > owned ? 1 : 0);
  };

  // best[step][fromIndex]: expected cost to finish from `step` with the item at grade `fromIndex`, whose free
  // rolls are spent
  const memo = new Map<string, PlanChoice>();
  const best = (step: number, fromIndex: number): PlanChoice => {
    const key = `${step}:${fromIndex}`;
    const cached = memo.get(key);
    if (cached) return cached;

    let result: PlanChoice;
    if (step === missing.length) {
      result = {
        cost: synthCost(fromIndex, targetIndex, true),
        decisionIndex: targetIndex,
        missChance: 0,
        payRerolls: 0,
        restart: false,
      };
    } else {
      result = {
        cost: Infinity,
        decisionIndex: targetIndex,
        missChance: 1,
        payRerolls: Infinity,
        restart: false,
      };
      let missChance = 1;
      const firstIndex = Math.max(fromIndex, 0);
      for (let index = firstIndex; index <= targetIndex; index += 1) {
        const chance = rollChance(step, index);
        if (index > fromIndex) {
          missChance *= Math.pow(1 - chance, freeRolls(step, index));
        }
        if (chance <= 0) continue;
        const payRerolls = 1 / chance;
        const after = best(step + 1, index).cost;
        const keepGoing = payRerolls * serendipityPrice + after;
        const startOver =
          salvageNow || index > startIndex
            ? freshCost - salvageValue(gradeOf(index), context)
            : Infinity;
        const cost =
          (index > fromIndex ? synthCost(fromIndex, index, false) : 0) +
          (1 - missChance) * after +
          missChance * Math.min(keepGoing, startOver);
        if (cost < result.cost - 1e-9) {
          result = {
            cost,
            decisionIndex: index,
            missChance,
            payRerolls,
            restart: startOver < keepGoing,
          };
        }
      }
      if (!Number.isFinite(result.cost)) {
        // a target this item can't roll: plan the rest without it
        result = { ...best(step + 1, fromIndex), missChance: 0 };
      }
    }

    memo.set(key, result);
    return result;
  };

  const plan: StatePlan = {
    cost: best(0, startIndex).cost,
    restartChance: 0,
    materials: new Map(),
    craftGold: 0,
    rerolls: 0,
    salvage: 0,
    checkpoints: [],
    restartGrades: [],
    rerollNow: false,
    restartNow: false,
    nextGrade: targetGrade,
  };
  const addSynthesis = (
    fromIndex: number,
    toIndex: number,
    share: number,
    final = false,
  ) => {
    if (toIndex < fromIndex || share <= 0) return;
    const used = synthesis(fromIndex, toIndex, final);
    for (const material of used.materials) {
      plan.materials.set(
        material.id,
        (plan.materials.get(material.id) ?? 0) + material.amount * share,
      );
    }
    plan.craftGold += used.craftGold * share;
  };

  // follow the plan forward: what this item spends before it finishes or is salvaged
  let reach = 1;
  let fromIndex = startIndex;
  for (let step = 0; step < missing.length; step += 1) {
    const choice = best(step, fromIndex);
    const decisionIndex = choice.decisionIndex;
    const grade = gradeOf(decisionIndex);
    if (decisionIndex > fromIndex)
      addSynthesis(fromIndex, decisionIndex, reach);
    const miss = reach * choice.missChance;
    const statList = formatStatList(missingIds.slice(step, step + 1));

    if (step === 0) {
      plan.rerollNow = decisionIndex === startIndex && !choice.restart;
      plan.restartNow = decisionIndex === startIndex && choice.restart;
      plan.nextGrade =
        decisionIndex === startIndex ? grade : gradeOf(startIndex + 1);
    }
    const previous = plan.checkpoints.at(-1);
    if (choice.restart) {
      plan.restartGrades.push(grade);
      plan.restartChance += miss;
      plan.salvage += miss * salvageValue(grade, context);
      reach -= miss;
      plan.checkpoints.push({
        grade,
        action:
          decisionIndex === startIndex
            ? `Salvage and start over rather than buy ${statList}.`
            : `Use the free rolls up to ${formatGrade(grade)} for ${statList}; if they all miss, salvage and start over.`,
        expectedRerolls: 0,
      });
    } else {
      const rerolls = miss * choice.payRerolls;
      plan.rerolls += rerolls;
      if (previous?.grade === grade && previous.expectedRerolls > 0) {
        previous.action = previous.action.replace(/\.$/, `, ${statList}.`);
        previous.expectedRerolls += rerolls / Math.max(reach, 1e-9);
      } else {
        plan.checkpoints.push({
          grade,
          action: `Reroll for ${statList}.`,
          expectedRerolls: rerolls / Math.max(reach, 1e-9),
        });
      }
    }
    fromIndex = decisionIndex;
  }
  addSynthesis(fromIndex, targetIndex, reach, true);

  return plan;
}

interface PlanChoice {
  cost: number;
  decisionIndex: number;
  missChance: number;
  payRerolls: number;
  restart: boolean;
}

function salvageValue(grade: Grade, context: PlanContext): number {
  return (
    getMaterialCost(SALVAGE_OUTPUTS[grade] ?? [], context.prices) -
    getMaterialPrice("brilliantMornstone", context.prices)
  );
}

function buildCostBreakdown({
  craftGold,
  expectedRerolls,
  materialCost,
  materials,
  rerollCost,
  salvageCredit,
}: {
  materials: PlannerMaterialAmount[];
  materialCost: number;
  craftGold: number;
  expectedRerolls: number;
  rerollCost: number;
  salvageCredit: number;
}): CostBreakdown {
  return {
    materials,
    materialCost,
    craftGold,
    expectedRerolls,
    rerollCost,
    salvageCredit,
    totalCost: materialCost + craftGold + rerollCost - salvageCredit,
  };
}

// The role an item with these stats is planned as: the one the stats name (the first one's, if they name
// several), or else the one whose item rolls them all earliest.
export function getPlannerRole(kind: GearKind, statIds: string[]): GearSubtype {
  const subtype = inferSubtype(statIds, kind);
  if (subtype.status === "conflict") {
    // stats from different roles: go with the first one picked
    const first = statIds
      .map((statId) => statById.get(statId)?.subtypesByKind[kind]?.[0])
      .find(Boolean);
    if (first) return first;
  }
  return resolveRole(kind, subtype, statIds);
}

// The role whose item to plan for. Without one named by the stats, the role whose item rolls all of them
// earliest.
function resolveRole(
  kind: GearKind,
  subtype: SubtypeInference | PlannerSubtype,
  statIds: string[],
): GearSubtype {
  if (typeof subtype === "string") {
    if (subtype !== "any") return subtype;
  } else if (subtype.status === "inferred") {
    return subtype.subtype;
  }

  const score = (role: GearSubtype) => {
    const pool = new Map(
      STAT_POOLS[kind][role]
        .filter(([, weight]) => weight > 1)
        .map(([statId, , unlockGrade]) => [statId, getGradeIndex(unlockGrade)]),
    );
    const missing = statIds.filter((statId) => !pool.has(statId)).length;
    const unlock = statIds.reduce(
      (total, statId) => total + (pool.get(statId) ?? 0),
      0,
    );
    return missing * 1000 + unlock;
  };

  return SUBTYPE_ORDER.reduce((best, role) =>
    score(role) < score(best) ? role : best,
  );
}

function buildStrategyCheckpoints({
  baseItemCost,
  checkpoints: routeCheckpoints,
  restartGrades,
  serendipityPrice,
  targetGrade,
  targetCost,
}: {
  checkpoints: RouteCheckpoint[];
  baseItemCost: number;
  restartGrades: Grade[];
  serendipityPrice: number;
  targetGrade: Grade;
  targetCost: CostBreakdown;
}): StrategyCheckpoint[] {
  const checkpoints: StrategyCheckpoint[] = [
    {
      grade: "grand",
      action: "continue",
      label: `Start with a fresh base item valued at ${formatGold(baseItemCost)}.`,
      expectedCost: targetCost.totalCost,
    },
  ];

  for (const checkpoint of routeCheckpoints) {
    checkpoints.push({
      grade: checkpoint.grade,
      action: restartGrades.includes(checkpoint.grade)
        ? "restart"
        : checkpoint.expectedRerolls > 0
          ? "reroll"
          : "synth",
      label: checkpoint.action,
      expectedCost: checkpoint.expectedRerolls * serendipityPrice,
    });
  }

  checkpoints.push({
    grade: targetGrade,
    action: "complete",
    label: "Finish synthesis to the selected target.",
    expectedCost: targetCost.totalCost,
  });

  return checkpoints;
}

function buildCurrentStrategyCheckpoints({
  comparison,
  current,
  serendipityPrice,
}: {
  comparison: CurrentComparison;
  current: CurrentItemInput;
  serendipityPrice: number;
}): StrategyCheckpoint[] {
  const checkpoints: StrategyCheckpoint[] = [
    {
      grade:
        comparison.recommendation === "synth" && comparison.synthGrade
          ? comparison.synthGrade
          : current.grade,
      action: comparison.recommendation,
      label:
        comparison.recommendation === "continue"
          ? "Continue this item; its expected remaining cost is lower than salvaging into a fresh start."
          : comparison.recommendation === "synth" && comparison.synthGrade
            ? comparison.synthReason === "gradeReroll"
              ? `Synth to ${formatGrade(comparison.synthGrade)} and reassess after the grade-up reroll.`
              : `Synth to ${formatGrade(comparison.synthGrade)} and reassess after the new stat line.`
            : "Salvage this item and restart; the fresh route is cheaper in expectation after salvage credit.",
      expectedCost:
        comparison.recommendation === "continue"
          ? comparison.continueCost.totalCost
          : comparison.recommendation === "synth" && comparison.synthCost
            ? comparison.synthCost.totalCost
            : comparison.restartCost.totalCost,
      restartCost: comparison.restartCost.totalCost,
    },
  ];

  for (const checkpoint of comparison.checkpoints) {
    checkpoints.push({
      grade: checkpoint.grade,
      action: checkpoint.expectedRerolls > 0 ? "reroll" : "synth",
      label: checkpoint.action,
      expectedCost: checkpoint.expectedRerolls * serendipityPrice,
      restartCost: comparison.restartCost.totalCost,
    });
  }

  return checkpoints;
}

// Stones and fees to synthesize from (fromGrade, fromProgress %) to (toGrade, toProgress %): the rest of the
// current grade's bar, every bar in between and the part of the target grade's bar. "basic" is a fresh item.
function getSynthesisRequirement(
  fromGrade: Grade | "basic",
  fromProgress: number,
  toGrade: Grade,
  toProgress: number,
): { materials: PlannerMaterialAmount[]; craftGold: number } {
  const from = clamp(fromProgress, 0, 100) / 100;
  const to = clamp(toProgress, 0, 100) / 100;
  const toIndex = getGradeIndex(toGrade);
  const parts: [SynthesisBar, number][] = [];

  if (fromGrade === "basic") {
    parts.push([BASIC_SYNTHESIS_BAR, 1 - from]);
    for (const grade of GRADES.slice(0, toIndex)) {
      parts.push([SYNTHESIS_BARS[grade], 1]);
    }
    parts.push([SYNTHESIS_BARS[toGrade], to]);
  } else {
    const fromIndex = getGradeIndex(fromGrade);
    if (fromIndex === toIndex) {
      parts.push([SYNTHESIS_BARS[toGrade], Math.max(0, to - from)]);
    } else if (fromIndex < toIndex) {
      parts.push([SYNTHESIS_BARS[fromGrade], 1 - from]);
      for (const grade of GRADES.slice(fromIndex + 1, toIndex)) {
        parts.push([SYNTHESIS_BARS[grade], 1]);
      }
      parts.push([SYNTHESIS_BARS[toGrade], to]);
    }
  }

  const stones = new Map<PlannerMaterialId, number>();
  let craftGold = 0;
  for (const [bar, share] of parts) {
    if (share <= 0) continue;
    const id = SYNTHIUM_STONE_IDS[bar.stone];
    stones.set(id, (stones.get(id) ?? 0) + bar.stones * share);
    craftGold += bar.fee * share;
  }

  return {
    materials: [...stones].map(([id, amount]) => ({ id, amount })),
    craftGold,
  };
}

function getMaterialCost(
  materials: PlannerMaterialAmount[],
  prices: PlannerPrices,
  materialPricing?: MaterialPricingOptions,
): number {
  return materials.reduce(
    (sum, material) =>
      sum +
      getMaterialPrice(material.id, prices, materialPricing) * material.amount,
    0,
  );
}

export function getMaterialPrice(
  materialId: PlannerMaterialId,
  prices: PlannerPrices,
  materialPricing?: MaterialPricingOptions,
): number {
  if (
    materialId === "serendipityStone" &&
    materialPricing?.serendipityStonePrice != null
  ) {
    return materialPricing.serendipityStonePrice;
  }

  const tier = SYNTHIUM_TIER_BY_ID.get(materialId);
  if (tier) return getSynthiumStoneCost(tier, prices, materialPricing).price;

  const direct = prices[materialId];
  if (direct != null) return direct;

  if (materialId === "clearSynthiumShard") {
    return (prices.clearSynthiumStone ?? 0) / 10;
  }
  if (materialId === "vividSynthiumShard") {
    return (prices.vividSynthiumStone ?? 0) / 10;
  }
  if (materialId === "lucidSynthiumShard") {
    return (prices.lucidSynthiumStone ?? 0) / 10;
  }
  if (materialId === "radiantSynthiumShard") {
    return (prices.radiantSynthiumStone ?? 0) / 10;
  }

  return 0;
}

const SYNTHIUM_TIERS: SynthiumTier[] = ["clear", "vivid", "lucid", "radiant"];
const SYNTHIUM_TIER_BY_ID = new Map(
  SYNTHIUM_TIERS.map((tier) => [SYNTHIUM_STONE_IDS[tier], tier]),
);

// Cheapest way to get one synthium stone of `tier`: buy it, or buy a lower tier and craft it up; with bound
// synthium on, also make it from Activity Tokens and craft the bound stone up.
export function getSynthiumStoneCost(
  tier: SynthiumTier,
  prices: PlannerPrices,
  materialPricing?: MaterialPricingOptions,
): { price: number; source: SynthiumSource } {
  const { bound, unbound } = getSynthiumChains(
    tier,
    prices,
    materialPricing?.activityTokenPrice ?? 0,
  );
  if (materialPricing?.boundSynthiumForEpicPlus && bound <= unbound.price) {
    return { price: bound, source: "activityTokens" };
  }

  return Number.isFinite(unbound.price)
    ? unbound
    : { price: 0, source: "market" };
}

// Bound Radiant Synthium Stone from Activity Tokens: 20 tokens make a Bound Lucid, which takes 10g, 2 Misagon's
// Crystals and 5 Charcoal Stabilizers to upgrade.
export function getBoundRadiantSynthiumStonePrice(
  prices: PlannerPrices,
  activityTokenPrice = 0,
): number {
  return getSynthiumChains("radiant", prices, activityTokenPrice).bound;
}

function getSynthiumChains(
  tier: SynthiumTier,
  prices: PlannerPrices,
  activityTokenPrice: number,
): { unbound: { price: number; source: SynthiumSource }; bound: number } {
  const charcoal = prices.charcoalStabilizer ?? 0;
  const misagon = prices.misagonsCrystal ?? 0;
  const craftCost = (recipe: {
    gold: number;
    charcoal: number;
    misagon: number;
  }) => recipe.gold + recipe.charcoal * charcoal + recipe.misagon * misagon;
  let unbound: { price: number; source: SynthiumSource } = {
    price: Infinity,
    source: "market",
  };
  let bound = Infinity;

  for (const current of SYNTHIUM_TIERS) {
    const market = prices[SYNTHIUM_STONE_IDS[current]] ?? Infinity;
    const crafted =
      current === "clear"
        ? Infinity
        : unbound.price + craftCost(SYNTHIUM_CRAFTS.upgrade[current]);
    unbound =
      crafted < market
        ? { price: crafted, source: "crafted" }
        : { price: market, source: "market" };

    const fromTokens =
      current === "radiant"
        ? Infinity
        : SYNTHIUM_CRAFTS.boundFromTokens[current] * activityTokenPrice;
    const boundCrafted =
      current === "clear"
        ? Infinity
        : bound + craftCost(SYNTHIUM_CRAFTS.boundUpgrade[current]);
    bound = Math.min(fromTokens, boundCrafted);

    if (current === tier) break;
  }

  return { unbound, bound };
}

function getGradeIndex(grade: Grade): number {
  return GRADES.indexOf(grade);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatStatList(statIds: string[]): string {
  return statIds
    .map((statId) => statById.get(statId)?.label ?? statId)
    .join(", ");
}

function formatGold(value: number): string {
  return `${value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })}g`;
}

function formatGrade(grade: Grade): string {
  return grade.charAt(0).toUpperCase() + grade.slice(1);
}
