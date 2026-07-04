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
const MAX_SOLVER_ITERATIONS = 500;

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
export type ConsumableLaborMap = Map<number, number>;
export type GradeSaleValueMap = Map<number, number>;

export interface RegradeActionChoice {
  fromGrade: number;
  scroll: RegradeScroll;
  charm: RegradeCharm | null;
  expectedValueGold: number;
  attemptCostGold: number;
  attemptLabor: number;
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
  consumableLabor?: ConsumableLaborMap;
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

export interface RegradeSearchState {
  family: RegradeFamily;
  piece: string | null;
  obsidianItemId: number | null;
  selectedTargetGrade: number | null;
  ayanadTargetMode: "specific" | "any";
  ayanadTargetItemId: number | null;
  glowingProcEnabled: boolean;
  selectedSaleGrades: number[];
  saleValuesByGradeInput: Record<number, string>;
}

export interface RegradeSearchParams {
  family?: RegradeFamily;
  piece?: string;
  obsidian?: number;
  target?: number;
  ayanad?: "specific" | "any";
  ayanadItem?: number;
  glowing?: 1;
  sell?: string;
  [key: string]: unknown;
}

export const DEFAULT_REGRADE_SALE_GRADES = [8, 9, 10] as const;

const DEFAULT_REGRADE_SEARCH_STATE: RegradeSearchState = {
  family: "magnificent",
  piece: null,
  obsidianItemId: null,
  selectedTargetGrade: null,
  ayanadTargetMode: "specific",
  ayanadTargetItemId: null,
  glowingProcEnabled: false,
  selectedSaleGrades: [...DEFAULT_REGRADE_SALE_GRADES],
  saleValuesByGradeInput: {},
};

function readSearchString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readSearchFloat(value: unknown): number {
  const raw = readSearchString(value);
  if (!raw) return Number.NaN;
  const unquoted = raw.replace(/^"(.*)"$/, "$1");
  return Number.parseFloat(unquoted);
}

function readSearchNumber(value: unknown): number | null {
  const raw =
    typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

function readSearchNumberList(value: unknown): number[] {
  const raw = readSearchString(value);
  if (!raw) return [];

  return [
    ...new Set(
      raw
        .split(",")
        .map((part) => Number.parseInt(part.trim(), 10))
        .filter((grade) => Number.isFinite(grade) && grade > 0),
    ),
  ].sort((a, b) => a - b);
}

function sameNumberList(left: readonly number[], right: readonly number[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function parseRegradeSearch(
  search: Record<string, unknown>,
): RegradeSearchState {
  const family = search.family === "obsidian-t1" ? "obsidian-t1" : "magnificent";
  const ayanadTargetMode = search.ayanad === "any" ? "any" : "specific";
  const saleValuesByGradeInput: Record<number, string> = {};
  const selectedSaleGrades = readSearchNumberList(search.sell);

  for (const [key, value] of Object.entries(search)) {
    const match = /^g(\d+)$/.exec(key);
    const raw = readSearchString(value);
    if (!match || !raw) continue;
    const grade = Number.parseInt(match[1] ?? "", 10);
    const parsed = readSearchFloat(raw);
    if (Number.isFinite(grade) && Number.isFinite(parsed) && parsed > 0) {
      saleValuesByGradeInput[grade] = String(parsed);
    }
  }

  return {
    ...DEFAULT_REGRADE_SEARCH_STATE,
    family,
    piece: readSearchString(search.piece),
    obsidianItemId: readSearchNumber(search.obsidian),
    selectedTargetGrade: readSearchNumber(search.target),
    ayanadTargetMode,
    ayanadTargetItemId: readSearchNumber(search.ayanadItem),
    glowingProcEnabled: search.glowing === 1 || search.glowing === "1",
    selectedSaleGrades:
      selectedSaleGrades.length > 0
        ? selectedSaleGrades
        : [...DEFAULT_REGRADE_SALE_GRADES],
    saleValuesByGradeInput,
  };
}

export function serializeRegradeSearch(
  state: Partial<RegradeSearchState>,
): RegradeSearchParams {
  const resolved = { ...DEFAULT_REGRADE_SEARCH_STATE, ...state };
  const search: RegradeSearchParams = {};

  if (resolved.family !== DEFAULT_REGRADE_SEARCH_STATE.family) {
    search.family = resolved.family;
  }
  if (resolved.family === "magnificent" && resolved.piece) {
    search.piece = resolved.piece;
  }
  if (resolved.family === "obsidian-t1" && resolved.obsidianItemId != null) {
    search.obsidian = resolved.obsidianItemId;
  }
  if (resolved.selectedTargetGrade != null) {
    search.target = resolved.selectedTargetGrade;
  }
  if (resolved.ayanadTargetMode !== DEFAULT_REGRADE_SEARCH_STATE.ayanadTargetMode) {
    search.ayanad = resolved.ayanadTargetMode;
  }
  if (resolved.ayanadTargetItemId != null) {
    search.ayanadItem = resolved.ayanadTargetItemId;
  }
  if (resolved.glowingProcEnabled) {
    search.glowing = 1;
  }
  const selectedSaleGrades = [...new Set(resolved.selectedSaleGrades)].sort(
    (a, b) => a - b,
  );
  if (!sameNumberList(selectedSaleGrades, DEFAULT_REGRADE_SALE_GRADES)) {
    search.sell = selectedSaleGrades.join(",");
  }

  for (const [grade, raw] of Object.entries(resolved.saleValuesByGradeInput)) {
    const value = raw.trim();
    const parsed = Number.parseFloat(value);
    if (value && Number.isFinite(parsed) && parsed > 0) {
      search[`g${grade}`] = value;
    }
  }

  return search;
}

export function getEffectiveSelectedRegradeTarget(
  results: ExpectedRegradeResult[],
  selectedTargetGrade: number | null,
): number | null {
  if (
    selectedTargetGrade != null &&
    results.some((result) => result.targetGrade === selectedTargetGrade)
  ) {
    return selectedTargetGrade;
  }

  const finiteResults = results.filter((result) =>
    Number.isFinite(result.expectedProfitGold),
  );
  const candidates = finiteResults.length > 0 ? finiteResults : results;
  const best = candidates.reduce<ExpectedRegradeResult | null>(
    (currentBest, result) =>
      !currentBest || result.expectedProfitGold > currentBest.expectedProfitGold
        ? result
        : currentBest,
    null,
  );

  return best?.targetGrade ?? null;
}

export interface MagnificentVariantParts {
  prefix: string;
  piece: string;
}

export type MagnificentUpgradeTier = "Magnificent" | "Epherium" | "Delphinad";

export interface MagnificentGearType {
  piece: string;
  displayName: string;
  representativeItem: RegradeItem;
  variantNames: string[];
  sealedUpgradeNames: MagnificentSealedUpgradeNames;
}

export interface MagnificentSealedUpgradeNames {
  epherium: string;
  delphinad: string;
  ayanad: string;
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

interface SolverAction {
  step: RegradeStep;
  attemptCostGold: number;
  attemptLabor: number;
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

export function getMagnificentVariantNames(
  piece: string,
  tier: MagnificentUpgradeTier,
  data: RegradeData = regradeData,
): string[] {
  const suffix = ` ${piece}`.toLowerCase();
  return data.items
    .filter(
      (item) =>
        item.name.startsWith(`${tier} `) &&
        item.name.toLowerCase().endsWith(suffix) &&
        item.group === 4 &&
        (item.type === "weapon" ||
          item.type === "armor" ||
          item.type === "accessory"),
    )
    .map((item) => item.name)
    .sort((a, b) => a.localeCompare(b));
}

export function getMagnificentSealedUpgradeNames(
  piece: string,
): MagnificentSealedUpgradeNames {
  return {
    epherium: `Sealed Epherium ${piece}`,
    delphinad: `Sealed Delphinad ${piece}`,
    ayanad: `Sealed Ayanad ${piece}`,
  };
}

export function getMagnificentGearTypes(
  data: RegradeData = regradeData,
): MagnificentGearType[] {
  const byPiece = new Map<string, RegradeItem[]>();

  for (const item of data.items) {
    if (!isSupportedMagnificentBase(item)) continue;
    const parts = parseMagnificentVariant(item.name);
    if (!parts) continue;
    const items = byPiece.get(parts.piece) ?? [];
    items.push(item);
    byPiece.set(parts.piece, items);
  }

  return [...byPiece.entries()]
    .map(([piece, items]) => {
      const sortedItems = [...items].sort((a, b) => a.name.localeCompare(b.name));
      const representativeItem =
        sortedItems.find((item) => item.name.includes("Squall ")) ??
        sortedItems[0];

      if (!representativeItem) return null;

      return {
        piece,
        displayName: `Magnificent ${piece}`,
        representativeItem,
        variantNames: sortedItems.map((item) => item.name),
        sealedUpgradeNames: getMagnificentSealedUpgradeNames(piece),
      };
    })
    .filter((type): type is MagnificentGearType => type != null)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
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
  const stateGrades = Array.from(
    { length: Math.max(0, input.targetGrade - startGrade) },
    (_, index) => startGrade + index,
  );
  const impossibleValue: SolverValue = {
    value: Number.NEGATIVE_INFINITY,
    cost: Number.POSITIVE_INFINITY,
    revenue: 0,
    labor: 0,
    steps: [],
  };

  const terminalValue = (grade: number): SolverValue => {
    const saleValue = getSaleValueForLandingGrade(input.saleValuesByGrade, grade);
    return {
      value: saleValue - input.upgradeCostGold,
      cost: input.upgradeCostGold,
      revenue: saleValue,
      labor: input.upgradeLabor,
      steps: [],
    };
  };
  const valueForGrade = (
    grade: number,
    values: Map<number, SolverValue>,
  ): SolverValue => {
    if (grade >= input.targetGrade) {
      return terminalValue(grade);
    }
    return values.get(grade) ?? ZERO_SOLVER_VALUE;
  };
  const metricDelta = (next: number, previous: number): number => {
    if (next === previous) return 0;
    if (!Number.isFinite(next) || !Number.isFinite(previous)) {
      return Number.POSITIVE_INFINITY;
    }
    return Math.abs(next - previous);
  };

  const actionsByGrade = new Map<number, SolverAction[]>();
  for (const grade of stateGrades) {
    const scrollModes = [false, true];
    const charmIds = [null, ...input.candidateCharmIds] as (number | null)[];
    const actions: SolverAction[] = [];

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

        actions.push({
          step,
          attemptCostGold: step.feeGold + scrollPrice + charmPrice,
          attemptLabor:
            (input.consumableLabor?.get(step.scroll.id) ?? 0) +
            (step.charm ? (input.consumableLabor?.get(step.charm.id) ?? 0) : 0),
        });
      }
    }
    actionsByGrade.set(grade, actions);
  }

  const evaluateAction = (
    action: SolverAction,
    values: Map<number, SolverValue>,
  ): SolverValue => {
    const { attemptCostGold, attemptLabor, step } = action;
    const normal = valueForGrade(step.normalToGrade, values);
    const great =
      step.greatProbability > 0
        ? valueForGrade(step.greatToGrade, values)
        : ZERO_SOLVER_VALUE;
    const downgraded =
      step.downgradeProbability > 0 && step.downgradeGrade != null
        ? valueForGrade(step.downgradeGrade, values)
        : ZERO_SOLVER_VALUE;
    const restarted =
      step.destroyProbability > 0
        ? valueForGrade(startGrade, values)
        : ZERO_SOLVER_VALUE;

    const denominator = Math.max(0.000001, 1 - step.stayProbability);
    const expectedValue =
      (step.normalSuccessProbability * normal.value +
        step.greatProbability * great.value +
        step.destroyProbability * (restarted.value - input.baseRecraftCostGold) +
        step.downgradeProbability * downgraded.value -
        attemptCostGold) /
      denominator;
    const expectedCost =
      (attemptCostGold +
        step.normalSuccessProbability * normal.cost +
        step.greatProbability * great.cost +
        step.destroyProbability * (input.baseRecraftCostGold + restarted.cost) +
        step.downgradeProbability * downgraded.cost) /
      denominator;
    const expectedRevenue =
      (step.normalSuccessProbability * normal.revenue +
        step.greatProbability * great.revenue +
        step.destroyProbability * restarted.revenue +
        step.downgradeProbability * downgraded.revenue) /
      denominator;
    const expectedLabor =
      (attemptLabor +
        step.normalSuccessProbability * normal.labor +
        step.greatProbability * great.labor +
        step.destroyProbability * (input.baseRecraftLabor + restarted.labor) +
        step.downgradeProbability * downgraded.labor) /
      denominator;

    return {
      value: expectedValue,
      cost: expectedCost,
      revenue: expectedRevenue,
      labor: expectedLabor,
      steps: [],
    };
  };

  let values = new Map<number, SolverValue>(
    stateGrades.map((grade) => [grade, ZERO_SOLVER_VALUE] as const),
  );
  let selectedActions = new Map<number, SolverAction>();

  for (let iteration = 0; iteration < MAX_SOLVER_ITERATIONS; iteration += 1) {
    const nextValues = new Map<number, SolverValue>();
    const nextActions = new Map<number, SolverAction>();
    let maxDelta = 0;

    for (const grade of stateGrades) {
      let best: SolverValue | null = null;
      let bestAction: SolverAction | null = null;

      for (const action of actionsByGrade.get(grade) ?? []) {
        const candidate = evaluateAction(action, values);
        if (!best || candidate.value > best.value) {
          best = candidate;
          bestAction = action;
        }
      }

      const resolved = best ?? impossibleValue;
      nextValues.set(grade, resolved);
      if (bestAction) nextActions.set(grade, bestAction);

      const previous = values.get(grade) ?? ZERO_SOLVER_VALUE;
      maxDelta = Math.max(
        maxDelta,
        metricDelta(resolved.value, previous.value),
        metricDelta(resolved.cost, previous.cost),
        metricDelta(resolved.revenue, previous.revenue),
        metricDelta(resolved.labor, previous.labor),
      );
    }

    values = nextValues;
    selectedActions = nextActions;
    if (maxDelta < 0.000001) break;
  }

  const steps: RegradeActionChoice[] = [];
  const seenStepGrades = new Set<number>();
  let stepGrade = startGrade;
  while (stepGrade < input.targetGrade && !seenStepGrades.has(stepGrade)) {
    seenStepGrades.add(stepGrade);
    const action = selectedActions.get(stepGrade);
    if (!action?.step.scroll) break;
    const solvedAtGrade = values.get(stepGrade) ?? impossibleValue;
    steps.push({
      fromGrade: stepGrade,
      scroll: action.step.scroll,
      charm: action.step.charm,
      expectedValueGold: solvedAtGrade.value,
      attemptCostGold: action.attemptCostGold,
      attemptLabor: action.attemptLabor,
    });
    if (action.step.normalToGrade <= stepGrade) break;
    stepGrade = action.step.normalToGrade;
  }

  const solved =
    startGrade >= input.targetGrade
      ? terminalValue(startGrade)
      : (values.get(startGrade) ?? impossibleValue);
  const expectedLabor = solved.labor;

  return {
    item: input.item,
    targetGrade: input.targetGrade,
    expectedProfitGold: solved.value,
    expectedCostGold: solved.cost,
    expectedRevenueGold: solved.revenue,
    expectedLabor,
    silverPerLabor:
      expectedLabor > 0 && Number.isFinite(solved.value)
        ? (solved.value * 100) / expectedLabor
        : 0,
    selectedSteps: steps,
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
