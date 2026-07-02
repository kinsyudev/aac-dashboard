import regradeDataJson from "../../../../regrade_data/regrade.json" with {
  type: "json",
};

export type RegradeItemType = "weapon" | "armor" | "accessory" | "pet" | "ship";

export interface RegradeGrade {
  id: number;
  name: string;
  overlay: string;
}

export interface RegradeItem {
  id: number;
  name: string;
  type: RegradeItemType;
  icon: string;
  group: number;
  maxGrade: number;
  level: number;
  slot: number;
}

export interface RegradeRate {
  success: number;
  great: number;
  break: number;
  downgrade: number;
  cost: number;
  dmin: number;
  dmax: number;
}

export interface RegradeCharm {
  id: number;
  name: string;
  icon: string;
  gradeMin: number;
  gradeMax: number;
  successMul: number;
  successRatio: number;
  breakMul: number;
  downgradeMul: number;
  greatMul: number;
  preventDestroy: boolean;
  preventDowngrade: boolean;
  slot: RegradeItemType | null;
}

export interface RegradeScroll {
  id: number;
  name: string;
  icon: string;
  type: RegradeItemType;
  resplendent: boolean;
}

export interface RegradeData {
  grades: RegradeGrade[];
  groups: Record<string, Record<string, RegradeRate>>;
  items: RegradeItem[];
  charms: RegradeCharm[];
  scrolls: RegradeScroll[];
}

export type RegradeFamily = "obsidian-t1" | "magnificent";

export interface SupportedRegradeItem extends RegradeItem {
  family: RegradeFamily;
}

export const RECRAFT_START_GRADE = 2;
export const MANA_SEAL_USE_LABOR = 10;
const REGRADE_FEE_K = 0.0041636529;
const REGRADE_FEE_BASE_COPPER = 160000;
const COPPER_PER_GOLD = 10000;

export interface RegradeFeeInput {
  ratioCost: number;
  itemLevel: number;
  itemSlot: number;
}

export interface RegradeStepInput {
  item: RegradeItem;
  fromGrade: number;
  resplendent: boolean;
  charmId: number | null;
  data?: RegradeData;
}

export interface RegradeStep {
  item: RegradeItem;
  fromGrade: number;
  normalToGrade: number;
  greatToGrade: number;
  scroll: RegradeScroll | null;
  charm: RegradeCharm | null;
  successProbability: number;
  greatProbability: number;
  normalSuccessProbability: number;
  destroyProbability: number;
  downgradeProbability: number;
  stayProbability: number;
  downgradeGrade: number | null;
  feeGold: number;
  ratioCost: number;
}

export type ConsumablePriceMap = Map<number, number>;
export type GradeSaleValueMap = Map<number, number>;

export interface RegradeActionChoice {
  fromGrade: number;
  scroll: RegradeScroll;
  charm: RegradeCharm | null;
  expectedValueGold: number;
  attemptCostGold: number;
}

export interface ExpectedRegradeInput {
  item: RegradeItem;
  targetGrade: number;
  baseRecraftCostGold: number;
  baseRecraftLabor: number;
  upgradeCostGold: number;
  upgradeLabor: number;
  saleValuesByGrade: GradeSaleValueMap;
  consumablePrices: ConsumablePriceMap;
  candidateCharmIds: number[];
  startGrade?: number;
  data?: RegradeData;
}

export interface ExpectedRegradeResult {
  item: RegradeItem;
  targetGrade: number;
  expectedProfitGold: number;
  expectedCostGold: number;
  expectedRevenueGold: number;
  expectedLabor: number;
  silverPerLabor: number;
  selectedSteps: RegradeActionChoice[];
  skippedReasons: string[];
}

export interface MagnificentVariantParts {
  prefix: string;
  piece: string;
}

export const regradeData = regradeDataJson as RegradeData;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function basisPointsToProbability(value: number): number {
  return value / 10000;
}

interface SolverValue {
  value: number;
  cost: number;
  revenue: number;
  labor: number;
  steps: RegradeActionChoice[];
}

const ZERO_SOLVER_VALUE: SolverValue = {
  value: 0,
  cost: 0,
  revenue: 0,
  labor: 0,
  steps: [],
};

function getPricedConsumable(
  consumable: { id: number; name: string } | null,
  prices: ConsumablePriceMap,
  skippedReasons: string[],
): number | null {
  if (!consumable) return 0;
  const price = prices.get(consumable.id);
  if (price == null || !Number.isFinite(price) || price <= 0) {
    skippedReasons.push(`Skipped ${consumable.name}: missing price.`);
    return null;
  }
  return price;
}

function getSaleValueForLandingGrade(
  saleValuesByGrade: GradeSaleValueMap,
  grade: number,
): number {
  return saleValuesByGrade.get(grade) ?? 0;
}

export function isSupportedObsidianT1Base(item: RegradeItem): boolean {
  return (
    item.name.startsWith("Obsidian ") &&
    item.group === 4 &&
    item.level === 46 &&
    (item.type === "weapon" || item.type === "armor")
  );
}

export function isSupportedMagnificentBase(item: RegradeItem): boolean {
  return (
    item.name.toLowerCase().includes("magnificent") &&
    item.group === 4 &&
    item.level === 44 &&
    (item.type === "weapon" ||
      item.type === "armor" ||
      item.type === "accessory")
  );
}

export function getSupportedRegradeItems(
  data: RegradeData = regradeData,
): SupportedRegradeItem[] {
  return data.items
    .flatMap((item): SupportedRegradeItem[] => {
      if (isSupportedObsidianT1Base(item)) {
        return [{ ...item, family: "obsidian-t1" }];
      }
      if (isSupportedMagnificentBase(item)) {
        return [{ ...item, family: "magnificent" }];
      }
      return [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getRegradeFeeGold(input: RegradeFeeInput): number {
  const copper =
    Math.round(
      REGRADE_FEE_K *
        Math.pow(input.itemLevel * input.ratioCost, 2.5) *
        input.itemSlot,
    ) + REGRADE_FEE_BASE_COPPER;

  return copper / COPPER_PER_GOLD;
}

export function charmApplies(
  charm: RegradeCharm,
  item: RegradeItem,
  fromGrade: number,
): boolean {
  if (charm.slot && charm.slot !== item.type) return false;
  if (charm.gradeMin >= 0 && fromGrade < charm.gradeMin) return false;
  if (charm.gradeMax >= 0 && fromGrade > charm.gradeMax) return false;
  return true;
}

export function getApplicableCharms(
  item: RegradeItem,
  fromGrade: number,
  data: RegradeData = regradeData,
): RegradeCharm[] {
  return data.charms.filter((charm) => charmApplies(charm, item, fromGrade));
}

export function getRegradeRate(
  item: RegradeItem,
  fromGrade: number,
  data: RegradeData = regradeData,
): RegradeRate | null {
  return data.groups[String(item.group)]?.[String(fromGrade)] ?? null;
}

export function getRegradeScroll(
  item: RegradeItem,
  resplendent: boolean,
  data: RegradeData = regradeData,
): RegradeScroll | null {
  return (
    data.scrolls.find(
      (scroll) =>
        scroll.type === item.type && scroll.resplendent === resplendent,
    ) ?? null
  );
}

export function getRegradeStep(input: RegradeStepInput): RegradeStep {
  const data = input.data ?? regradeData;
  const rate = getRegradeRate(input.item, input.fromGrade, data);
  if (!rate) {
    throw new Error(
      `Missing regrade rate for group ${input.item.group}, grade ${input.fromGrade}`,
    );
  }

  const scroll = getRegradeScroll(input.item, input.resplendent, data);
  const charm =
    input.charmId == null
      ? null
      : data.charms.find((candidate) => candidate.id === input.charmId) ?? null;
  const effectiveCharm =
    charm && charmApplies(charm, input.item, input.fromGrade) ? charm : null;

  let success = basisPointsToProbability(rate.success);
  let destroy = basisPointsToProbability(rate.break);
  let downgrade = basisPointsToProbability(rate.downgrade);
  let greatRate = input.resplendent ? basisPointsToProbability(rate.great) : 0;

  if (effectiveCharm) {
    success =
      success * (1 + effectiveCharm.successMul / 100) +
      basisPointsToProbability(effectiveCharm.successRatio);
    destroy *= 1 + effectiveCharm.breakMul / 100;
    downgrade *= 1 + effectiveCharm.downgradeMul / 100;
    greatRate *= 1 + effectiveCharm.greatMul / 100;
    if (effectiveCharm.preventDestroy) destroy = 0;
    if (effectiveCharm.preventDowngrade) downgrade = 0;
  }

  success = clamp01(success);
  greatRate = clamp01(greatRate);
  const great = clamp01(success * greatRate);
  destroy = clamp01(destroy);
  downgrade = clamp01(downgrade);

  const failureProbability = 1 - success;
  const destroyProbability = failureProbability * destroy;
  const downgradeProbability = failureProbability * (1 - destroy) * downgrade;
  const stayProbability = Math.max(
    0,
    1 - success - destroyProbability - downgradeProbability,
  );

  return {
    item: input.item,
    fromGrade: input.fromGrade,
    normalToGrade: Math.min(input.fromGrade + 1, input.item.maxGrade),
    greatToGrade: Math.min(input.fromGrade + 2, input.item.maxGrade),
    scroll,
    charm: effectiveCharm,
    successProbability: success,
    greatProbability: great,
    normalSuccessProbability: Math.max(0, success - great),
    destroyProbability,
    downgradeProbability,
    stayProbability,
    downgradeGrade: rate.dmin >= 0 ? rate.dmin : Math.max(0, input.fromGrade - 1),
    feeGold: getRegradeFeeGold({
      ratioCost: rate.cost,
      itemLevel: input.item.level,
      itemSlot: input.item.slot,
    }),
    ratioCost: rate.cost,
  };
}

export function solveExpectedRegradeToTarget(
  input: ExpectedRegradeInput,
): ExpectedRegradeResult {
  const data = input.data ?? regradeData;
  const startGrade = input.startGrade ?? RECRAFT_START_GRADE;
  const skippedReasons: string[] = [];
  const memo = new Map<number, SolverValue>();
  const visiting = new Set<number>();

  const solve = (grade: number): SolverValue => {
    if (grade >= input.targetGrade) {
      const saleValue = getSaleValueForLandingGrade(input.saleValuesByGrade, grade);
      return {
        value: saleValue - input.upgradeCostGold,
        cost: input.upgradeCostGold,
        revenue: saleValue,
        labor: input.upgradeLabor,
        steps: [],
      };
    }

    const existing = memo.get(grade);
    if (existing) return existing;
    if (visiting.has(grade)) {
      return {
        value: Number.NEGATIVE_INFINITY,
        cost: Number.POSITIVE_INFINITY,
        revenue: 0,
        labor: 0,
        steps: [],
      };
    }
    visiting.add(grade);

    const scrollModes = [false, true];
    const charmIds = [null, ...input.candidateCharmIds] as (number | null)[];
    let best: SolverValue | null = null;

    for (const resplendent of scrollModes) {
      for (const charmId of charmIds) {
        const step = getRegradeStep({
          item: input.item,
          fromGrade: grade,
          resplendent,
          charmId,
          data,
        });
        const scrollPrice = getPricedConsumable(
          step.scroll,
          input.consumablePrices,
          skippedReasons,
        );
        const charmPrice = getPricedConsumable(
          step.charm,
          input.consumablePrices,
          skippedReasons,
        );
        if (step.scroll == null || scrollPrice == null || charmPrice == null) {
          continue;
        }

        const attemptCost = step.feeGold + scrollPrice + charmPrice;
        const normal = solve(step.normalToGrade);
        const great =
          step.greatProbability > 0
            ? solve(step.greatToGrade)
            : ZERO_SOLVER_VALUE;
        const downgraded =
          step.downgradeProbability > 0 && step.downgradeGrade != null
            ? solve(step.downgradeGrade)
            : ZERO_SOLVER_VALUE;
        const restarted =
          step.destroyProbability > 0 ? solve(startGrade) : ZERO_SOLVER_VALUE;

        const nonStayValue =
          step.normalSuccessProbability * normal.value +
          step.greatProbability * great.value +
          step.destroyProbability *
            (restarted.value - input.baseRecraftCostGold) +
          step.downgradeProbability * downgraded.value -
          attemptCost;
        const denominator = Math.max(0.000001, 1 - step.stayProbability);
        const expectedValue = nonStayValue / denominator;

        const nonStayCost =
          attemptCost +
          step.normalSuccessProbability * normal.cost +
          step.greatProbability * great.cost +
          step.destroyProbability *
            (input.baseRecraftCostGold + restarted.cost) +
          step.downgradeProbability * downgraded.cost;
        const expectedCost = nonStayCost / denominator;

        const expectedRevenue =
          (step.normalSuccessProbability * normal.revenue +
            step.greatProbability * great.revenue +
            step.destroyProbability * restarted.revenue +
            step.downgradeProbability * downgraded.revenue) /
          denominator;
        const expectedLabor =
          (step.normalSuccessProbability * normal.labor +
            step.greatProbability * great.labor +
            step.destroyProbability *
              (input.baseRecraftLabor + restarted.labor) +
            step.downgradeProbability * downgraded.labor) /
          denominator;

        const candidate: SolverValue = {
          value: expectedValue,
          cost: expectedCost,
          revenue: expectedRevenue,
          labor: expectedLabor,
          steps: [
            {
              fromGrade: grade,
              scroll: step.scroll,
              charm: step.charm,
              expectedValueGold: expectedValue,
              attemptCostGold: attemptCost,
            },
            ...normal.steps,
          ],
        };

        if (!best || candidate.value > best.value) {
          best = candidate;
        }
      }
    }

    visiting.delete(grade);
    const resolved =
      best ?? {
        value: Number.NEGATIVE_INFINITY,
        cost: Number.POSITIVE_INFINITY,
        revenue: 0,
        labor: 0,
        steps: [],
      };
    memo.set(grade, resolved);
    return resolved;
  };

  const solved = solve(startGrade);
  const expectedLabor = solved.labor;

  return {
    item: input.item,
    targetGrade: input.targetGrade,
    expectedProfitGold: solved.value,
    expectedCostGold: solved.cost,
    expectedRevenueGold: solved.revenue,
    expectedLabor,
    silverPerLabor: expectedLabor > 0 ? (solved.value * 100) / expectedLabor : 0,
    selectedSteps: solved.steps,
    skippedReasons: [...new Set(skippedReasons)],
  };
}

export function getUpgradeFamilyForItem(name: string): RegradeFamily | null {
  if (name.startsWith("Obsidian ")) return "obsidian-t1";
  if (name.includes("Magnificent ")) return "magnificent";
  return null;
}

export function getObsidianT2Name(name: string): string | null {
  if (!name.startsWith("Obsidian ")) return null;
  return name.replace(/^Obsidian /, "Ominous Obsidian ");
}

export function getObsidianT3Name(name: string): string | null {
  if (!name.startsWith("Obsidian ")) return null;
  return name.replace(/^Obsidian /, "Cursed Obsidian ");
}

export function parseMagnificentVariant(
  name: string,
): MagnificentVariantParts | null {
  const match = /^Magnificent\s+(.+?)\s+([^ ]+)$/.exec(name.trim());
  if (!match) return null;
  return {
    prefix: match[1] ?? "",
    piece: match[2] ?? "",
  };
}
