import type {
  GearKind,
  GearSubtype,
  Grade,
  PlannerMaterialAmount,
  PlannerMaterialId,
  PlannerStat,
  PlannerSubtype,
} from "./costume-planner-data.ts";
import {
  GRADES,
  MATERIAL_LABELS,
  MATERIAL_PRICE_LOOKUP_NAMES,
  PLANNER_STATS,
  PRICE_LOOKUP_ITEM_NAMES,
  SALVAGE_OUTPUTS,
  STAT_LINE_THRESHOLDS,
  SUBTYPE_ORDER,
  SYNTHESIS_MILESTONES,
} from "./costume-planner-data.ts";

export {
  GRADES,
  MATERIAL_LABELS,
  MATERIAL_PRICE_LOOKUP_NAMES,
  PLANNER_STATS,
  PRICE_LOOKUP_ITEM_NAMES,
  STAT_LINE_THRESHOLDS,
};
export type {
  GearKind,
  GearSubtype,
  Grade,
  PlannerMaterialAmount,
  PlannerMaterialId,
  PlannerStat,
  PlannerSubtype,
};

export type SubtypeInference =
  | { status: "inferred"; subtype: GearSubtype }
  | { status: "any"; subtype: "any" }
  | { status: "conflict"; subtypes: GearSubtype[] };

export type PlannerPrices = Partial<Record<PlannerMaterialId, number>>;

export interface RerollEstimate {
  availableOutcomes: number;
  favorableOutcomes: number;
  expectedAttempts: number;
  expectedCost: number;
}

export interface BaseItemCostOptions {
  honorGoldPerThousand?: number;
}

export interface MaterialPricingOptions {
  boundSynthiumForEpicPlus?: boolean;
  serendipityStonePrice?: number;
}

export interface CostBreakdown {
  materialCost: number;
  craftGold: number;
  rerollCost: number;
  salvageCredit: number;
  totalCost: number;
  expectedRerolls: number;
  materials: PlannerMaterialAmount[];
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
  targetCost: CostBreakdown;
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

export function inferSubtype(statIds: string[]): SubtypeInference {
  const subtypes = new Set<GearSubtype>();

  for (const statId of statIds) {
    const stat = statById.get(statId);
    for (const subtype of stat?.subtypes ?? []) {
      subtypes.add(subtype);
    }
  }

  if (subtypes.size === 0) return { status: "any", subtype: "any" };
  if (subtypes.size === 1) {
    const subtype = SUBTYPE_ORDER.find((candidate) => subtypes.has(candidate));
    if (subtype) return { status: "inferred", subtype };
  }

  return {
    status: "conflict",
    subtypes: SUBTYPE_ORDER.filter((subtype) => subtypes.has(subtype)),
  };
}

export function getPlannerStats(kind: GearKind): PlannerStat[] {
  return PLANNER_STATS.filter((stat) => stat.kinds.includes(kind));
}

export function getAvailableStatIds(
  kind: GearKind,
  grade: Grade,
  subtype: PlannerSubtype,
): string[] {
  const gradeIndex = getGradeIndex(grade);

  return getPlannerStats(kind)
    .filter((stat) => {
      const unlockGrade = stat.unlockGradeByKind[kind];
      if (unlockGrade == null) return false;
      if (getGradeIndex(unlockGrade) > gradeIndex) return false;
      if (!stat.subtypes?.length) return true;
      if (subtype === "any") return true;
      return stat.subtypes.includes(subtype);
    })
    .map((stat) => stat.id);
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
  const kept = new Set(keptStatIds);
  const available = getAvailableStatIds(kind, grade, subtype).filter(
    (statId) => !kept.has(statId),
  );
  const availableSet = new Set(available);
  const favorable = desiredStatIds.filter(
    (statId) => !kept.has(statId) && availableSet.has(statId),
  );
  const expectedAttempts =
    favorable.length > 0 ? available.length / favorable.length : 0;
  const successChance =
    available.length > 0 ? favorable.length / available.length : 0;
  const paidAttempts =
    successChance > 0
      ? Math.pow(1 - successChance, freeAttempts) * expectedAttempts
      : 0;

  return {
    availableOutcomes: available.length,
    favorableOutcomes: favorable.length,
    expectedAttempts: paidAttempts,
    expectedCost: paidAttempts * serendipityPrice,
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

export function planTargetRoute({
  desiredStatIds,
  kind,
  materialPricing,
  prices,
  targetGrade,
  targetProgress,
}: {
  kind: GearKind;
  targetGrade: Grade;
  targetProgress: number;
  desiredStatIds: string[];
  prices: PlannerPrices;
  materialPricing?: MaterialPricingOptions;
}): TargetRoute {
  const subtype = inferSubtype(desiredStatIds);
  const plannerSubtype = resolvePlannerSubtype(subtype);
  const serendipityPrice = getMaterialPrice(
    "serendipityStone",
    prices,
    materialPricing,
  );
  const kept: string[] = [];
  const checkpoints: RouteCheckpoint[] = [];
  const freeRerollGrades = getGradeUpRerollGrades("grand", targetGrade);
  let expectedRerolls = 0;

  for (const grade of GRADES) {
    if (getGradeIndex(grade) > getGradeIndex(targetGrade)) break;

    const desiredAtGrade = desiredStatIds.filter((statId) => {
      const stat = statById.get(statId);
      return stat?.unlockGradeByKind[kind] === grade;
    });
    if (!desiredAtGrade.length) continue;

    let gradeRerolls = 0;
    for (const statId of desiredAtGrade) {
      const estimate = estimateExpectedRerolls({
        kind,
        grade,
        subtype: plannerSubtype,
        desiredStatIds: [statId],
        freeAttempts: consumeUsableFreeRerolls(freeRerollGrades, grade),
        keptStatIds: kept,
        serendipityPrice,
      });
      gradeRerolls += estimate.expectedAttempts;
      kept.push(statId);
    }
    expectedRerolls += gradeRerolls;
    checkpoints.push({
      grade,
      action: `Reroll for ${formatStatList(desiredAtGrade)}.`,
      expectedRerolls: gradeRerolls,
    });
  }

  const synthesis = getSynthesisDifference(
    "grand",
    0,
    targetGrade,
    targetProgress,
  );
  const materialCost = getMaterialCost(
    synthesis.materials,
    prices,
    materialPricing,
  );
  const rerollCost = expectedRerolls * serendipityPrice;

  return {
    subtype,
    checkpoints,
    targetCost: {
      materialCost,
      craftGold: synthesis.craftGold,
      rerollCost,
      salvageCredit: 0,
      totalCost: materialCost + synthesis.craftGold + rerollCost,
      expectedRerolls,
      materials: synthesis.materials,
    },
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
}: {
  kind: GearKind;
  targetGrade: Grade;
  targetProgress: number;
  desiredStatIds: string[];
  prices: PlannerPrices;
  materialPricing?: MaterialPricingOptions;
} & BaseItemCostOptions): OptimalStrategyRoute {
  const route = planTargetRoute({
    kind,
    targetGrade,
    targetProgress,
    desiredStatIds,
    prices,
    materialPricing,
  });
  const baseItemCost = estimateBaseItemCost({
    kind,
    prices,
    honorGoldPerThousand,
  });
  const targetCost = addFlatCost(route.targetCost, baseItemCost);

  return {
    ...route,
    baseItemCost,
    targetCost,
    strategyCheckpoints: buildStrategyCheckpoints({
      baseRoute: route,
      baseItemCost,
      serendipityPrice: getMaterialPrice(
        "serendipityStone",
        prices,
        materialPricing,
      ),
      targetGrade,
      targetCost,
    }),
  };
}

export function compareCurrentItem({
  current,
  desiredStatIds,
  kind,
  prices,
  targetGrade,
  targetProgress,
  materialPricing,
}: {
  kind: GearKind;
  targetGrade: Grade;
  targetProgress: number;
  desiredStatIds: string[];
  current: CurrentItemInput;
  prices: PlannerPrices;
  materialPricing?: MaterialPricingOptions;
}): CurrentComparison {
  const route = planTargetRoute({
    kind,
    targetGrade,
    targetProgress,
    desiredStatIds,
    prices,
    materialPricing,
  });
  const plannerSubtype = resolvePlannerSubtype(route.subtype);
  const currentStatSet = new Set(current.statIds);
  const keptTargetStats = desiredStatIds.filter((statId) =>
    currentStatSet.has(statId),
  );
  const missingTargetStats = desiredStatIds
    .filter((statId) => !currentStatSet.has(statId))
    .sort(
      (left, right) =>
        getGradeIndex(getRerollGrade(kind, current.grade, left)) -
        getGradeIndex(getRerollGrade(kind, current.grade, right)),
    );
  const serendipityPrice = getMaterialPrice(
    "serendipityStone",
    prices,
    materialPricing,
  );
  const synthesis = getSynthesisDifference(
    current.grade,
    current.progress,
    targetGrade,
    targetProgress,
  );
  const materialCost = getMaterialCost(
    synthesis.materials,
    prices,
    materialPricing,
  );
  const freeRerollGrades = getGradeUpRerollGrades(current.grade, targetGrade);
  let expectedRerolls = 0;

  const estimatedKeptTargetStats = [...keptTargetStats];
  for (const statId of missingTargetStats) {
    const rerollGrade = getRerollGrade(kind, current.grade, statId);
    const estimate = estimateExpectedRerolls({
      kind,
      grade: rerollGrade,
      subtype: plannerSubtype,
      desiredStatIds: [statId],
      freeAttempts: consumeUsableFreeRerolls(freeRerollGrades, rerollGrade),
      keptStatIds: estimatedKeptTargetStats,
      serendipityPrice,
    });
    expectedRerolls += estimate.expectedAttempts;
    estimatedKeptTargetStats.push(statId);
  }

  const continueCost = buildCostBreakdown({
    materials: synthesis.materials,
    materialCost,
    craftGold: synthesis.craftGold,
    expectedRerolls,
    rerollCost: expectedRerolls * serendipityPrice,
    salvageCredit: 0,
  });
  const salvageCredit =
    getMaterialCost(SALVAGE_OUTPUTS[current.grade] ?? [], prices) +
    (current.currentItemValue ?? 0) -
    getMaterialPrice("brilliantMornstone", prices);
  const restartCost = {
    ...route.targetCost,
    salvageCredit,
    totalCost: route.targetCost.totalCost - salvageCredit,
  };
  const synthCheckpoint = getNextUsefulSynthCheckpoint({
    current,
    desiredStatIds,
    keptTargetStatCount: keptTargetStats.length,
    kind,
    subtype: plannerSubtype,
    targetGrade,
  });
  const synthGrade = synthCheckpoint?.grade;
  const synthCost =
    synthCheckpoint && missingTargetStats.length > 0
      ? buildSynthCost({
          current,
          materialPricing,
          prices,
          synthGrade: synthCheckpoint.grade,
        })
      : undefined;
  const baseRecommendation =
    continueCost.totalCost <= restartCost.totalCost ? "continue" : "restart";
  const recommendation =
    synthCost &&
    (baseRecommendation === "restart" || keptTargetStats.length === 0) &&
    synthCost.totalCost < restartCost.totalCost
      ? "synth"
      : baseRecommendation;

  return {
    recommendation,
    continueCost,
    restartCost,
    synthCost,
    synthGrade,
    synthReason: synthCheckpoint?.reason,
    subtype: route.subtype,
    checkpoints: route.checkpoints,
  };
}

export function compareCurrentStrategy({
  current,
  desiredStatIds,
  honorGoldPerThousand,
  kind,
  prices,
  targetGrade,
  targetProgress,
  materialPricing,
}: {
  kind: GearKind;
  targetGrade: Grade;
  targetProgress: number;
  desiredStatIds: string[];
  current: CurrentItemInput;
  prices: PlannerPrices;
  materialPricing?: MaterialPricingOptions;
} & BaseItemCostOptions): CurrentStrategyComparison {
  const comparison = compareCurrentItem({
    kind,
    targetGrade,
    targetProgress,
    desiredStatIds,
    current,
    prices,
    materialPricing,
  });
  const baseItemCost = estimateBaseItemCost({
    kind,
    prices,
    honorGoldPerThousand,
  });
  const restartCost = addFlatCost(comparison.restartCost, baseItemCost);
  const recommendation =
    comparison.recommendation === "synth"
      ? "synth"
      : comparison.continueCost.totalCost <= restartCost.totalCost
        ? "continue"
        : "restart";

  return {
    ...comparison,
    recommendation,
    restartCost,
    baseItemCost,
    strategyCheckpoints: buildCurrentStrategyCheckpoints({
      comparison: {
        ...comparison,
        recommendation,
        restartCost,
      },
      current,
      serendipityPrice: getMaterialPrice(
        "serendipityStone",
        prices,
        materialPricing,
      ),
    }),
  };
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

function addFlatCost(cost: CostBreakdown, amount: number): CostBreakdown {
  return {
    ...cost,
    totalCost: cost.totalCost + amount,
  };
}

function getGradeUpRerollGrades(fromGrade: Grade, toGrade: Grade): Grade[] {
  const fromGradeIndex = getGradeIndex(fromGrade);
  const toGradeIndex = getGradeIndex(toGrade);

  return GRADES.filter((grade) => {
    const gradeIndex = getGradeIndex(grade);
    return gradeIndex > fromGradeIndex && gradeIndex <= toGradeIndex;
  });
}

function consumeUsableFreeRerolls(
  freeRerollGrades: Grade[],
  minimumGrade: Grade,
): number {
  const minimumGradeIndex = getGradeIndex(minimumGrade);

  for (let index = 0; index < freeRerollGrades.length; ) {
    const grade = freeRerollGrades[index];
    if (!grade) break;
    if (getGradeIndex(grade) < minimumGradeIndex) {
      index += 1;
      continue;
    }

    freeRerollGrades.splice(index, 1);
    return 1;
  }

  return 0;
}

function getRerollGrade(
  kind: GearKind,
  currentGrade: Grade,
  statId: string,
): Grade {
  const stat = statById.get(statId);
  const unlockGrade = stat?.unlockGradeByKind[kind] ?? currentGrade;

  return getGradeIndex(currentGrade) > getGradeIndex(unlockGrade)
    ? currentGrade
    : unlockGrade;
}

function buildStrategyCheckpoints({
  baseItemCost,
  baseRoute,
  serendipityPrice,
  targetGrade,
  targetCost,
}: {
  baseRoute: TargetRoute;
  baseItemCost: number;
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

  for (const checkpoint of baseRoute.checkpoints) {
    checkpoints.push({
      grade: checkpoint.grade,
      action: checkpoint.expectedRerolls > 0 ? "reroll" : "synth",
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

function getNextUsefulSynthCheckpoint({
  current,
  desiredStatIds,
  keptTargetStatCount,
  kind,
  subtype,
  targetGrade,
}: {
  kind: GearKind;
  current: CurrentItemInput;
  targetGrade: Grade;
  desiredStatIds: string[];
  keptTargetStatCount: number;
  subtype: PlannerSubtype;
}): { grade: Grade; reason: "statLine" | "gradeReroll" } | undefined {
  const currentStats = new Set(current.statIds);

  for (const grade of GRADES) {
    const gradeIndex = getGradeIndex(grade);
    if (gradeIndex <= getGradeIndex(current.grade)) continue;
    if (gradeIndex > getGradeIndex(targetGrade)) break;

    const available = getAvailableStatIds(kind, grade, subtype).filter(
      (statId) => !currentStats.has(statId),
    );
    const availableSet = new Set(available);
    const hasUsefulTarget = desiredStatIds.some(
      (statId) => !currentStats.has(statId) && availableSet.has(statId),
    );

    if (!hasUsefulTarget) continue;

    const isStatLineThreshold = STAT_LINE_THRESHOLDS[kind].includes(grade);
    if (
      isStatLineThreshold &&
      canReassessAfterStatLine({
        keptTargetStatCount,
        kind,
        synthGrade: grade,
      })
    ) {
      return { grade, reason: "statLine" };
    }

    if (
      keptTargetStatCount > 0 &&
      canReassessAfterGradeUpReroll({
        currentGrade: current.grade,
        keptTargetStatCount,
        kind,
      })
    ) {
      return { grade, reason: "gradeReroll" };
    }
  }

  return undefined;
}

function canReassessAfterStatLine({
  keptTargetStatCount,
  kind,
  synthGrade,
}: {
  kind: GearKind;
  synthGrade: Grade;
  keptTargetStatCount: number;
}): boolean {
  const statLinesAfterSynth = getStatLineCount(kind, synthGrade);
  return keptTargetStatCount + 1 >= statLinesAfterSynth - 1;
}

function canReassessAfterGradeUpReroll({
  currentGrade,
  keptTargetStatCount,
  kind,
}: {
  kind: GearKind;
  currentGrade: Grade;
  keptTargetStatCount: number;
}): boolean {
  return keptTargetStatCount + 1 >= getStatLineCount(kind, currentGrade);
}

function buildSynthCost({
  current,
  materialPricing,
  prices,
  synthGrade,
}: {
  current: CurrentItemInput;
  synthGrade: Grade;
  prices: PlannerPrices;
  materialPricing?: MaterialPricingOptions;
}): CostBreakdown {
  const synthesis = getSynthesisDifference(
    current.grade,
    current.progress,
    synthGrade,
    0,
  );
  const materialCost = getMaterialCost(
    synthesis.materials,
    prices,
    materialPricing,
  );

  return buildCostBreakdown({
    materials: synthesis.materials,
    materialCost,
    craftGold: synthesis.craftGold,
    expectedRerolls: 0,
    rerollCost: 0,
    salvageCredit: 0,
  });
}

function getSynthesisDifference(
  fromGrade: Grade,
  fromProgress: number,
  toGrade: Grade,
  toProgress: number,
): { materials: PlannerMaterialAmount[]; craftGold: number } {
  const from = getCumulativeRequirement(fromGrade, fromProgress);
  const to = getCumulativeRequirement(toGrade, toProgress);
  const materialTotals = new Map<PlannerMaterialId, number>();

  for (const targetMaterial of to.materials) {
    const currentAmount =
      from.materials.find((material) => material.id === targetMaterial.id)
        ?.amount ?? 0;
    const amount = Math.max(0, targetMaterial.amount - currentAmount);
    if (amount > 0) materialTotals.set(targetMaterial.id, amount);
  }

  return {
    materials: [...materialTotals].map(([id, amount]) => ({ id, amount })),
    craftGold: Math.max(0, to.craftGold - from.craftGold),
  };
}

function getCumulativeRequirement(
  grade: Grade,
  progress: number,
): { materials: PlannerMaterialAmount[]; craftGold: number } {
  const normalizedProgress = clamp(progress, 0, 100);
  const exact = SYNTHESIS_MILESTONES.find(
    (milestone) =>
      milestone.grade === grade && milestone.progress === normalizedProgress,
  );
  if (exact) return exact;

  const gradeMilestone = SYNTHESIS_MILESTONES.find(
    (milestone) => milestone.grade === grade && milestone.progress === 0,
  );
  if (!gradeMilestone) return { materials: [], craftGold: 0 };
  if (normalizedProgress === 0) return gradeMilestone;

  const next = getNextMilestone(grade);
  if (!next) return gradeMilestone;

  return interpolateMilestones(gradeMilestone, next, normalizedProgress / 100);
}

function getNextMilestone(grade: Grade) {
  const gradeIndex = GRADES.indexOf(grade);
  if (grade === "mythic") {
    return SYNTHESIS_MILESTONES.find(
      (milestone) => milestone.grade === "mythic" && milestone.progress === 100,
    );
  }
  const nextGrade = GRADES[gradeIndex + 1];
  return SYNTHESIS_MILESTONES.find(
    (milestone) => milestone.grade === nextGrade && milestone.progress === 0,
  );
}

function interpolateMilestones(
  from: { materials: PlannerMaterialAmount[]; craftGold: number },
  to: { materials: PlannerMaterialAmount[]; craftGold: number },
  ratio: number,
): { materials: PlannerMaterialAmount[]; craftGold: number } {
  const materialIds = new Set([
    ...from.materials.map((material) => material.id),
    ...to.materials.map((material) => material.id),
  ]);

  return {
    materials: [...materialIds].map((id) => {
      const fromAmount =
        from.materials.find((material) => material.id === id)?.amount ?? 0;
      const toAmount =
        to.materials.find((material) => material.id === id)?.amount ?? 0;
      return {
        id,
        amount: fromAmount + (toAmount - fromAmount) * ratio,
      };
    }),
    craftGold: from.craftGold + (to.craftGold - from.craftGold) * ratio,
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

function getMaterialPrice(
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
  if (
    materialId === "radiantSynthiumStone" &&
    materialPricing?.boundSynthiumForEpicPlus
  ) {
    return getBoundRadiantSynthiumStonePrice(prices);
  }

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

export function getBoundRadiantSynthiumStonePrice(
  prices: PlannerPrices,
): number {
  return (
    getMaterialPrice("charcoalStabilizer", prices) * 5 +
    getMaterialPrice("misagonsCrystal", prices) * 2 +
    10
  );
}

function resolvePlannerSubtype(subtype: SubtypeInference): PlannerSubtype {
  if (subtype.status === "inferred") return subtype.subtype;
  return "any";
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
