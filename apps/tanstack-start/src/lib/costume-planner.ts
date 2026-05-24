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
  SUBTYPE_ORDER,
  SYNTHESIS_MILESTONES,
} from "./costume-planner-data.ts";

export {
  GRADES,
  MATERIAL_LABELS,
  MATERIAL_PRICE_LOOKUP_NAMES,
  PLANNER_STATS,
  PRICE_LOOKUP_ITEM_NAMES,
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

export interface CurrentItemInput {
  grade: Grade;
  progress: number;
  statIds: string[];
  currentItemValue?: number;
}

export interface CurrentComparison {
  recommendation: "continue" | "restart";
  continueCost: CostBreakdown;
  restartCost: CostBreakdown;
  subtype: SubtypeInference;
  checkpoints: RouteCheckpoint[];
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

export function estimateExpectedRerolls({
  desiredStatIds,
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

  return {
    availableOutcomes: available.length,
    favorableOutcomes: favorable.length,
    expectedAttempts,
    expectedCost: expectedAttempts * serendipityPrice,
  };
}

export function planTargetRoute({
  desiredStatIds,
  kind,
  prices,
  targetGrade,
  targetProgress,
}: {
  kind: GearKind;
  targetGrade: Grade;
  targetProgress: number;
  desiredStatIds: string[];
  prices: PlannerPrices;
}): TargetRoute {
  const subtype = inferSubtype(desiredStatIds);
  const plannerSubtype = resolvePlannerSubtype(subtype);
  const serendipityPrice = getMaterialPrice("serendipityStone", prices);
  const kept: string[] = [];
  const checkpoints: RouteCheckpoint[] = [];
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
  const materialCost = getMaterialCost(synthesis.materials, prices);
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

export function compareCurrentItem({
  current,
  desiredStatIds,
  kind,
  prices,
  targetGrade,
  targetProgress,
}: {
  kind: GearKind;
  targetGrade: Grade;
  targetProgress: number;
  desiredStatIds: string[];
  current: CurrentItemInput;
  prices: PlannerPrices;
}): CurrentComparison {
  const route = planTargetRoute({
    kind,
    targetGrade,
    targetProgress,
    desiredStatIds,
    prices,
  });
  const plannerSubtype = resolvePlannerSubtype(route.subtype);
  const currentStatSet = new Set(current.statIds);
  const keptTargetStats = desiredStatIds.filter((statId) =>
    currentStatSet.has(statId),
  );
  const missingTargetStats = desiredStatIds.filter(
    (statId) => !currentStatSet.has(statId),
  );
  const serendipityPrice = getMaterialPrice("serendipityStone", prices);
  const synthesis = getSynthesisDifference(
    current.grade,
    current.progress,
    targetGrade,
    targetProgress,
  );
  const materialCost = getMaterialCost(synthesis.materials, prices);
  let expectedRerolls = 0;

  for (const statId of missingTargetStats) {
    const stat = statById.get(statId);
    const unlockGrade = stat?.unlockGradeByKind[kind] ?? current.grade;
    const rerollGrade =
      getGradeIndex(current.grade) > getGradeIndex(unlockGrade)
        ? current.grade
        : unlockGrade;
    const estimate = estimateExpectedRerolls({
      kind,
      grade: rerollGrade,
      subtype: plannerSubtype,
      desiredStatIds: [statId],
      keptStatIds: keptTargetStats,
      serendipityPrice,
    });
    expectedRerolls += estimate.expectedAttempts;
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

  return {
    recommendation:
      continueCost.totalCost <= restartCost.totalCost ? "continue" : "restart",
    continueCost,
    restartCost,
    subtype: route.subtype,
    checkpoints: route.checkpoints,
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
): number {
  return materials.reduce(
    (sum, material) =>
      sum + getMaterialPrice(material.id, prices) * material.amount,
    0,
  );
}

function getMaterialPrice(
  materialId: PlannerMaterialId,
  prices: PlannerPrices,
): number {
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
