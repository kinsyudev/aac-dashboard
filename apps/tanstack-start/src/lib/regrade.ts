import regradeDataJson from "../data/regrade.json" with { type: "json" };

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

export interface RegradeConsumableRecipeItem {
  id: number;
  name: string;
  icon: string;
}

export interface ResplendentScrollRightClickRecipe {
  normalScroll: RegradeConsumableRecipeItem;
  luckyPoint: RegradeConsumableRecipeItem;
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
const MAX_POLICY_ITERATIONS = 100;
const LINEAR_SOLVER_EPSILON = 1e-12;
const SOLVER_VALIDATION_TOLERANCE = 1e-7;
const POLICY_TIE_TOLERANCE = 1e-10;

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
  successProbability: number;
  greatProbability: number;
  normalToGrade: number;
  greatToGrade: number;
}

export interface RegradeTapProjection {
  targetGrade: number;
  desiredTargetCount: number;
  targetProbability: number;
  requiredStartingTaps: number;
  requiredTaps: number;
  expectedNormalHits: number;
  expectedLuckyHits: number;
  expectedTargetOrBetter: number;
  expectedFailures: number;
  tapBreakdown: RegradeTapProjectionTapBreakdownEntry[];
  gradeOutcomes: RegradeTapProjectionGradeOutcome[];
}

export interface RegradeTapProjectionTapBreakdownEntry {
  fromGrade: number;
  expectedTaps: number;
}

export interface RegradeTapProjectionGradeOutcome {
  grade: number;
  expectedCount: number;
  isTargetOrBetter: boolean;
}

export interface ExpectedRevenueBreakdownEntry {
  grade: number;
  probability: number;
  saleValueGold: number;
  expectedRevenueGold: number;
  expectedCostGold: number;
  expectedProfitGold: number;
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
  expectedAttempts: number;
  revenueBreakdown: ExpectedRevenueBreakdownEntry[];
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
  const family =
    search.family === "obsidian-t1" ? "obsidian-t1" : "magnificent";
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
  if (
    resolved.ayanadTargetMode !== DEFAULT_REGRADE_SEARCH_STATE.ayanadTargetMode
  ) {
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
  preferredResults: ExpectedRegradeResult[] = results,
): number | null {
  if (
    selectedTargetGrade != null &&
    results.some((result) => result.targetGrade === selectedTargetGrade)
  ) {
    return selectedTargetGrade;
  }

  const defaultResults =
    preferredResults.length > 0 ? preferredResults : results;
  const finiteResults = defaultResults.filter((result) =>
    Number.isFinite(result.expectedProfitGold),
  );
  const candidates = finiteResults.length > 0 ? finiteResults : defaultResults;
  const best = candidates.reduce<ExpectedRegradeResult | null>(
    (currentBest, result) =>
      !currentBest || result.expectedProfitGold > currentBest.expectedProfitGold
        ? result
        : currentBest,
    null,
  );

  return best?.targetGrade ?? null;
}

export function getReachableRegradeResults<T extends { targetGrade: number }>(
  results: T[],
  saleValuesByGrade: GradeSaleValueMap,
): T[] {
  const saleGrades = [...saleValuesByGrade.keys()].sort((a, b) => a - b);
  return results.filter((result) => {
    const blockingSaleGrade = saleGrades.find(
      (grade) => grade < result.targetGrade,
    );
    return blockingSaleGrade == null;
  });
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

const RESPLENDENT_SCROLL_RIGHT_CLICK_RECIPES: Partial<
  Record<RegradeItemType, ResplendentScrollRightClickRecipe>
> = {
  weapon: {
    normalScroll: {
      id: 28298,
      name: "Weapon Regrade Scroll",
      icon: "icon_item_1268.png",
    },
    luckyPoint: {
      id: 28300,
      name: "Lucky Sunpoint",
      icon: "icon_item_1263.png",
    },
  },
  armor: {
    normalScroll: {
      id: 28299,
      name: "Armor Regrade Scroll",
      icon: "icon_item_1269.png",
    },
    luckyPoint: {
      id: 28308,
      name: "Lucky Moonpoint",
      icon: "icon_item_1266.png",
    },
  },
  accessory: {
    normalScroll: {
      id: 31928,
      name: "Accessory Regrade Scroll",
      icon: "icon_item_1695.png",
    },
    luckyPoint: {
      id: 31930,
      name: "Lucky Starpoint",
      icon: "icon_item_1694.png",
    },
  },
};

export function getResplendentScrollRightClickRecipe(
  scroll: RegradeScroll,
): ResplendentScrollRightClickRecipe | null {
  if (!scroll.resplendent) return null;
  return RESPLENDENT_SCROLL_RIGHT_CLICK_RECIPES[scroll.type] ?? null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function basisPointsToProbability(value: number): number {
  return value / 10000;
}

export function getRegradeTapProjection(
  step: Pick<
    RegradeActionChoice,
    | "fromGrade"
    | "normalToGrade"
    | "greatToGrade"
    | "successProbability"
    | "greatProbability"
  >,
  targetGrade: number,
  desiredTargetCount: number,
  continuationSteps: readonly Pick<
    RegradeActionChoice,
    | "fromGrade"
    | "normalToGrade"
    | "greatToGrade"
    | "successProbability"
    | "greatProbability"
  >[] = [step],
): RegradeTapProjection {
  const perStartingTap = getRegradeTapProjectionUnitValue(
    step,
    targetGrade,
    new Map(continuationSteps.map((entry) => [entry.fromGrade, entry])),
    new Set(),
  );
  const desiredCount =
    Number.isFinite(desiredTargetCount) && desiredTargetCount > 0
      ? desiredTargetCount
      : 0;
  const requiredStartingTaps =
    perStartingTap.targetOrBetter > 0
      ? desiredCount / perStartingTap.targetOrBetter
      : 0;
  const scale = requiredStartingTaps;
  const tapBreakdown = [...perStartingTap.tapBreakdown.entries()]
    .map(([fromGrade, expectedTaps]) => ({
      fromGrade,
      expectedTaps: expectedTaps * scale,
    }))
    .sort((left, right) => left.fromGrade - right.fromGrade);
  const gradeOutcomes = [...perStartingTap.gradeOutcomes.entries()]
    .map(([grade, expectedCount]) => ({
      grade,
      expectedCount: expectedCount * scale,
      isTargetOrBetter: grade >= targetGrade,
    }))
    .sort((left, right) => left.grade - right.grade);

  return {
    targetGrade,
    desiredTargetCount: desiredCount,
    targetProbability: perStartingTap.targetOrBetter,
    requiredStartingTaps,
    requiredTaps: tapBreakdown.reduce(
      (sum, entry) => sum + entry.expectedTaps,
      0,
    ),
    expectedNormalHits: requiredStartingTaps * perStartingTap.normalHits,
    expectedLuckyHits: requiredStartingTaps * perStartingTap.luckyHits,
    expectedTargetOrBetter:
      requiredStartingTaps * perStartingTap.targetOrBetter,
    expectedFailures: requiredStartingTaps * perStartingTap.failures,
    tapBreakdown,
    gradeOutcomes,
  };
}

interface RegradeTapProjectionUnitValue {
  targetOrBetter: number;
  failures: number;
  normalHits: number;
  luckyHits: number;
  tapBreakdown: Map<number, number>;
  gradeOutcomes: Map<number, number>;
}

function getRegradeTapProjectionUnitValue(
  step: Pick<
    RegradeActionChoice,
    | "fromGrade"
    | "normalToGrade"
    | "greatToGrade"
    | "successProbability"
    | "greatProbability"
  >,
  targetGrade: number,
  continuationStepsByFromGrade: Map<
    number,
    Pick<
      RegradeActionChoice,
      | "fromGrade"
      | "normalToGrade"
      | "greatToGrade"
      | "successProbability"
      | "greatProbability"
    >
  >,
  visitedFromGrades: Set<number>,
): RegradeTapProjectionUnitValue {
  const value: RegradeTapProjectionUnitValue = {
    targetOrBetter: 0,
    failures: Math.max(0, 1 - step.successProbability),
    normalHits: 0,
    luckyHits: 0,
    tapBreakdown: new Map([[step.fromGrade, 1]]),
    gradeOutcomes: new Map(),
  };
  const normalProbability = Math.max(
    0,
    step.successProbability - step.greatProbability,
  );

  addTapProjectionOutcome(
    value,
    step.normalToGrade,
    normalProbability,
    targetGrade,
    continuationStepsByFromGrade,
    visitedFromGrades,
    "normal",
  );
  if (step.greatProbability > 0) {
    addTapProjectionOutcome(
      value,
      step.greatToGrade,
      step.greatProbability,
      targetGrade,
      continuationStepsByFromGrade,
      visitedFromGrades,
      "lucky",
    );
  }

  return value;
}

function addTapProjectionOutcome(
  value: RegradeTapProjectionUnitValue,
  grade: number,
  probability: number,
  targetGrade: number,
  continuationStepsByFromGrade: Map<
    number,
    Pick<
      RegradeActionChoice,
      | "fromGrade"
      | "normalToGrade"
      | "greatToGrade"
      | "successProbability"
      | "greatProbability"
    >
  >,
  visitedFromGrades: Set<number>,
  outcomeType: "normal" | "lucky",
) {
  if (probability <= 0) return;

  if (outcomeType === "normal") {
    value.normalHits += probability;
  } else {
    value.luckyHits += probability;
  }

  if (grade >= targetGrade || visitedFromGrades.has(grade)) {
    addTapProjectionGradeOutcome(value, grade, probability, targetGrade);
    return;
  }

  const continuationStep = continuationStepsByFromGrade.get(grade);
  if (!continuationStep) {
    addTapProjectionGradeOutcome(value, grade, probability, targetGrade);
    return;
  }

  const continuationValue = getRegradeTapProjectionUnitValue(
    continuationStep,
    targetGrade,
    continuationStepsByFromGrade,
    new Set([...visitedFromGrades, continuationStep.fromGrade]),
  );
  mergeScaledTapProjectionValue(value, continuationValue, probability);
}

function addTapProjectionGradeOutcome(
  value: RegradeTapProjectionUnitValue,
  grade: number,
  probability: number,
  targetGrade: number,
) {
  value.gradeOutcomes.set(
    grade,
    (value.gradeOutcomes.get(grade) ?? 0) + probability,
  );
  if (grade >= targetGrade) {
    value.targetOrBetter += probability;
  }
}

function mergeScaledTapProjectionValue(
  target: RegradeTapProjectionUnitValue,
  source: RegradeTapProjectionUnitValue,
  scale: number,
) {
  target.targetOrBetter += source.targetOrBetter * scale;
  target.failures += source.failures * scale;
  target.normalHits += source.normalHits * scale;
  target.luckyHits += source.luckyHits * scale;

  for (const [fromGrade, expectedTaps] of source.tapBreakdown) {
    target.tapBreakdown.set(
      fromGrade,
      (target.tapBreakdown.get(fromGrade) ?? 0) + expectedTaps * scale,
    );
  }
  for (const [grade, expectedCount] of source.gradeOutcomes) {
    target.gradeOutcomes.set(
      grade,
      (target.gradeOutcomes.get(grade) ?? 0) + expectedCount * scale,
    );
  }
}

interface SolverAction {
  step: RegradeStep;
  attemptCostGold: number;
  attemptLabor: number;
}

interface SolverPolicyEvaluation {
  values: number[];
  costs: number[];
  revenues: number[];
  labor: number[];
  attempts: number[];
  landingProbabilities: number[][];
  costContributions: number[][];
}

interface LinearFactorization {
  lu: number[][];
  pivotRows: number[];
}

function factorLinearSystem(matrix: number[][]): LinearFactorization | null {
  const size = matrix.length;
  const lu = matrix.map((row) => [...row]);
  if (lu.some((row) => row.length !== size)) return null;
  const pivotRows: number[] = [];

  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;
    let pivotMagnitude = Math.abs(lu[column]?.[column] ?? 0);
    for (let row = column + 1; row < size; row += 1) {
      const magnitude = Math.abs(lu[row]?.[column] ?? 0);
      if (magnitude > pivotMagnitude) {
        pivotMagnitude = magnitude;
        pivotRow = row;
      }
    }
    if (
      !Number.isFinite(pivotMagnitude) ||
      pivotMagnitude < LINEAR_SOLVER_EPSILON
    ) {
      return null;
    }

    pivotRows.push(pivotRow);
    if (pivotRow !== column) {
      const columnRow = lu[column];
      const selectedPivotRow = lu[pivotRow];
      if (!columnRow || !selectedPivotRow) return null;
      lu[column] = selectedPivotRow;
      lu[pivotRow] = columnRow;
    }

    const pivotData = lu[column];
    if (!pivotData) return null;
    const pivot = pivotData[column] ?? 0;
    for (let row = column + 1; row < size; row += 1) {
      const rowData = lu[row];
      if (!rowData) return null;
      const multiplier = (rowData[column] ?? 0) / pivot;
      rowData[column] = multiplier;
      for (let nextColumn = column + 1; nextColumn < size; nextColumn += 1) {
        rowData[nextColumn] =
          (rowData[nextColumn] ?? 0) -
          multiplier * (pivotData[nextColumn] ?? 0);
      }
    }
  }

  return { lu, pivotRows };
}

function solveFactoredLinearSystem(
  factorization: LinearFactorization,
  rightHandSides: number[][],
): number[][] | null {
  const { lu, pivotRows } = factorization;
  const size = lu.length;
  if (rightHandSides.length !== size) return null;
  const width = rightHandSides[0]?.length ?? 0;
  const solution = rightHandSides.map((row) => [...row]);
  if (solution.some((row) => row.length !== width)) return null;

  for (let column = 0; column < size; column += 1) {
    const pivotRow = pivotRows[column] ?? column;
    if (pivotRow !== column) {
      const columnValues = solution[column];
      const pivotValues = solution[pivotRow];
      if (!columnValues || !pivotValues) return null;
      solution[column] = pivotValues;
      solution[pivotRow] = columnValues;
    }
  }
  for (let column = 0; column < size; column += 1) {
    const pivotValues = solution[column];
    if (!pivotValues) return null;
    for (let row = column + 1; row < size; row += 1) {
      const rowValues = solution[row];
      if (!rowValues) return null;
      const multiplier = lu[row]?.[column] ?? 0;
      for (let rhs = 0; rhs < width; rhs += 1) {
        rowValues[rhs] =
          (rowValues[rhs] ?? 0) - multiplier * (pivotValues[rhs] ?? 0);
      }
    }
  }

  for (let row = size - 1; row >= 0; row -= 1) {
    const rowValues = solution[row];
    if (!rowValues) return null;
    const pivot = lu[row]?.[row] ?? 0;
    if (!Number.isFinite(pivot) || Math.abs(pivot) < LINEAR_SOLVER_EPSILON) {
      return null;
    }
    for (let rhs = 0; rhs < width; rhs += 1) {
      let value = solution[row]?.[rhs] ?? 0;
      for (let column = row + 1; column < size; column += 1) {
        value -= (lu[row]?.[column] ?? 0) * (solution[column]?.[rhs] ?? 0);
      }
      rowValues[rhs] = value / pivot;
    }
  }

  return solution.every((row) => row.every(Number.isFinite)) ? solution : null;
}

function nearlyEqual(left: number, right: number, tolerance: number): boolean {
  return (
    Math.abs(left - right) <=
    tolerance * Math.max(1, Math.abs(left), Math.abs(right))
  );
}

function hasAcceptableLinearResidual(
  matrix: number[][],
  solution: number[][],
  rightHandSides: number[][],
): boolean {
  return matrix.every((row, rowIndex) =>
    (rightHandSides[rowIndex] ?? []).every((expected, rhsIndex) => {
      const actual = row.reduce(
        (sum, coefficient, columnIndex) =>
          sum + coefficient * (solution[columnIndex]?.[rhsIndex] ?? 0),
        0,
      );
      return nearlyEqual(actual, expected, SOLVER_VALIDATION_TOLERANCE);
    }),
  );
}

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
      const sortedItems = [...items].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
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

export function isObtainableRegradeCharm(charm: RegradeCharm): boolean {
  if (charm.preventDestroy) return false;
  return !charm.name.includes("White Regrade Charm");
}

export function getObtainableRegradeCharms(
  data: RegradeData = regradeData,
): RegradeCharm[] {
  return data.charms.filter(isObtainableRegradeCharm);
}

export function getApplicableCharms(
  item: RegradeItem,
  fromGrade: number,
  data: RegradeData = regradeData,
): RegradeCharm[] {
  return getObtainableRegradeCharms(data).filter((charm) =>
    charmApplies(charm, item, fromGrade),
  );
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
      : (data.charms.find((candidate) => candidate.id === input.charmId) ??
        null);
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
    downgradeGrade:
      rate.dmin >= 0 ? rate.dmin : Math.max(0, input.fromGrade - 1),
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
  const isTerminalGrade = (grade: number): boolean =>
    grade >= input.targetGrade || input.saleValuesByGrade.has(grade);
  const unavailableResult = (reason: string): ExpectedRegradeResult => ({
    item: input.item,
    targetGrade: input.targetGrade,
    expectedProfitGold: Number.NEGATIVE_INFINITY,
    expectedCostGold: Number.POSITIVE_INFINITY,
    expectedRevenueGold: 0,
    expectedLabor: 0,
    expectedAttempts: 0,
    revenueBreakdown: [],
    silverPerLabor: 0,
    selectedSteps: [],
    skippedReasons: [...new Set([...skippedReasons, reason])],
  });

  if (isTerminalGrade(startGrade)) {
    const saleValueGold = getSaleValueForLandingGrade(
      input.saleValuesByGrade,
      startGrade,
    );
    return {
      item: input.item,
      targetGrade: input.targetGrade,
      expectedProfitGold: saleValueGold - input.upgradeCostGold,
      expectedCostGold: input.upgradeCostGold,
      expectedRevenueGold: saleValueGold,
      expectedLabor: input.upgradeLabor,
      expectedAttempts: 0,
      revenueBreakdown: [
        {
          grade: startGrade,
          probability: 1,
          saleValueGold,
          expectedRevenueGold: saleValueGold,
          expectedCostGold: input.upgradeCostGold,
          expectedProfitGold: saleValueGold - input.upgradeCostGold,
        },
      ],
      silverPerLabor:
        input.upgradeLabor > 0
          ? ((saleValueGold - input.upgradeCostGold) * 100) / input.upgradeLabor
          : 0,
      selectedSteps: [],
      skippedReasons: [],
    };
  }

  const stateGrades = Array.from(
    { length: Math.max(0, input.targetGrade - startGrade) },
    (_, index) => startGrade + index,
  ).filter((grade) => !isTerminalGrade(grade));
  const terminalGrades = Array.from(
    { length: input.item.maxGrade + 1 },
    (_, grade) => grade,
  ).filter(isTerminalGrade);
  const stateIndexByGrade = new Map(
    stateGrades.map((grade, index) => [grade, index] as const),
  );
  const terminalIndexByGrade = new Map(
    terminalGrades.map((grade, index) => [grade, index] as const),
  );
  const startIndex = stateIndexByGrade.get(startGrade);
  if (startIndex == null || terminalGrades.length === 0) {
    return unavailableResult("Unable to build a terminating regrade strategy.");
  }

  const obtainableCharmIds = new Set(
    getObtainableRegradeCharms(data).map((charm) => charm.id),
  );

  const actionsByGrade = new Map<number, SolverAction[]>();
  for (const grade of stateGrades) {
    if (isTerminalGrade(grade)) {
      actionsByGrade.set(grade, []);
      continue;
    }

    const scrollModes = [false, true];
    const charmIds = [
      null,
      ...input.candidateCharmIds.filter((charmId) =>
        obtainableCharmIds.has(charmId),
      ),
    ] as (number | null)[];
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
  if (stateGrades.some((grade) => !(actionsByGrade.get(grade)?.length ?? 0))) {
    return unavailableResult(
      "No priced regrade action is available at every required grade.",
    );
  }

  interface SolverTransition {
    grade: number;
    probability: number;
    extraCostGold: number;
    extraLabor: number;
  }

  const getTransitions = (action: SolverAction): SolverTransition[] => {
    const { step } = action;
    return [
      {
        grade: step.fromGrade,
        probability: step.stayProbability,
        extraCostGold: 0,
        extraLabor: 0,
      },
      {
        grade: step.normalToGrade,
        probability: step.normalSuccessProbability,
        extraCostGold: 0,
        extraLabor: 0,
      },
      {
        grade: step.greatToGrade,
        probability: step.greatProbability,
        extraCostGold: 0,
        extraLabor: 0,
      },
      {
        grade: startGrade,
        probability: step.destroyProbability,
        extraCostGold: input.baseRecraftCostGold,
        extraLabor: input.baseRecraftLabor,
      },
      {
        grade: step.downgradeGrade ?? step.fromGrade,
        probability: step.downgradeProbability,
        extraCostGold: 0,
        extraLabor: 0,
      },
    ].filter((transition) => transition.probability > 0);
  };

  const evaluatePolicy = (
    policy: ReadonlyMap<number, SolverAction>,
  ): SolverPolicyEvaluation | null => {
    const stateCount = stateGrades.length;
    const terminalCount = terminalGrades.length;
    const continuation = Array.from({ length: stateCount }, () =>
      Array<number>(stateCount).fill(0),
    );
    const terminalTransitions = Array.from({ length: stateCount }, () =>
      Array<number>(terminalCount).fill(0),
    );
    const immediateCosts = Array<number>(stateCount).fill(0);
    const immediateRevenue = Array<number>(stateCount).fill(0);
    const immediateLabor = Array<number>(stateCount).fill(0);

    for (const [stateIndex, grade] of stateGrades.entries()) {
      const action = policy.get(grade);
      if (!action) return null;
      immediateCosts[stateIndex] = action.attemptCostGold;
      immediateLabor[stateIndex] = action.attemptLabor;

      for (const transition of getTransitions(action)) {
        immediateCosts[stateIndex] +=
          transition.probability * transition.extraCostGold;
        immediateLabor[stateIndex] +=
          transition.probability * transition.extraLabor;
        if (isTerminalGrade(transition.grade)) {
          const terminalIndex = terminalIndexByGrade.get(transition.grade);
          const terminalRow = terminalTransitions[stateIndex];
          if (terminalIndex == null || !terminalRow) return null;
          terminalRow[terminalIndex] =
            (terminalRow[terminalIndex] ?? 0) + transition.probability;
          immediateCosts[stateIndex] +=
            transition.probability * input.upgradeCostGold;
          immediateLabor[stateIndex] +=
            transition.probability * input.upgradeLabor;
          immediateRevenue[stateIndex] =
            (immediateRevenue[stateIndex] ?? 0) +
            transition.probability *
              getSaleValueForLandingGrade(
                input.saleValuesByGrade,
                transition.grade,
              );
        } else {
          const nextStateIndex = stateIndexByGrade.get(transition.grade);
          const continuationRow = continuation[stateIndex];
          if (nextStateIndex == null || !continuationRow) return null;
          continuationRow[nextStateIndex] =
            (continuationRow[nextStateIndex] ?? 0) + transition.probability;
        }
      }
    }

    const matrix = continuation.map((row, rowIndex) =>
      row.map((probability, columnIndex) =>
        rowIndex === columnIndex ? 1 - probability : -probability,
      ),
    );
    const factorization = factorLinearSystem(matrix);
    if (!factorization) return null;
    const rightHandSides = stateGrades.map((_, stateIndex) => [
      immediateCosts[stateIndex] ?? 0,
      immediateRevenue[stateIndex] ?? 0,
      immediateLabor[stateIndex] ?? 0,
      1,
      ...(terminalTransitions[stateIndex] ?? []),
    ]);
    const solved = solveFactoredLinearSystem(factorization, rightHandSides);
    if (
      !solved ||
      !hasAcceptableLinearResidual(matrix, solved, rightHandSides)
    ) {
      return null;
    }

    const costs = solved.map((row) => row[0] ?? 0);
    const revenues = solved.map((row) => row[1] ?? 0);
    const labor = solved.map((row) => row[2] ?? 0);
    const attempts = solved.map((row) => row[3] ?? 0);
    const landingProbabilities = solved.map((row) =>
      row.slice(4, 4 + terminalCount),
    );
    const values = revenues.map(
      (revenue, stateIndex) => revenue - (costs[stateIndex] ?? 0),
    );

    if (
      landingProbabilities.some(
        (probabilities) =>
          probabilities.some(
            (probability) =>
              probability < -SOLVER_VALIDATION_TOLERANCE ||
              probability > 1 + SOLVER_VALIDATION_TOLERANCE,
          ) ||
          !nearlyEqual(
            probabilities.reduce((sum, probability) => sum + probability, 0),
            1,
            SOLVER_VALIDATION_TOLERANCE,
          ),
      )
    ) {
      return null;
    }

    const contributionRightHandSides = stateGrades.map((grade, stateIndex) => {
      const action = policy.get(grade);
      if (!action) return terminalGrades.map(() => Number.NaN);
      return terminalGrades.map((terminalGrade, terminalIndex) => {
        let contribution =
          action.attemptCostGold *
          (landingProbabilities[stateIndex]?.[terminalIndex] ?? 0);
        for (const transition of getTransitions(action)) {
          if (isTerminalGrade(transition.grade)) {
            if (transition.grade === terminalGrade) {
              contribution +=
                transition.probability *
                (transition.extraCostGold + input.upgradeCostGold);
            }
          } else {
            const nextStateIndex = stateIndexByGrade.get(transition.grade);
            if (nextStateIndex == null) return Number.NaN;
            contribution +=
              transition.probability *
              transition.extraCostGold *
              (landingProbabilities[nextStateIndex]?.[terminalIndex] ?? 0);
          }
        }
        return contribution;
      });
    });
    const costContributions = solveFactoredLinearSystem(
      factorization,
      contributionRightHandSides,
    );
    if (
      !costContributions ||
      !hasAcceptableLinearResidual(
        matrix,
        costContributions,
        contributionRightHandSides,
      )
    ) {
      return null;
    }

    for (const [stateIndex, probabilities] of landingProbabilities.entries()) {
      const expectedRevenue = probabilities.reduce(
        (sum, probability, terminalIndex) => {
          const terminalGrade = terminalGrades[terminalIndex];
          if (terminalGrade == null) return Number.NaN;
          return (
            sum +
            probability *
              getSaleValueForLandingGrade(
                input.saleValuesByGrade,
                terminalGrade,
              )
          );
        },
        0,
      );
      const attributedCost =
        costContributions[stateIndex]?.reduce(
          (sum, contribution) => sum + contribution,
          0,
        ) ?? 0;
      if (
        !nearlyEqual(
          expectedRevenue,
          revenues[stateIndex] ?? 0,
          SOLVER_VALIDATION_TOLERANCE,
        ) ||
        !nearlyEqual(
          attributedCost,
          costs[stateIndex] ?? 0,
          SOLVER_VALIDATION_TOLERANCE,
        )
      ) {
        return null;
      }
    }

    return {
      values,
      costs,
      revenues,
      labor,
      attempts,
      landingProbabilities,
      costContributions,
    };
  };

  const scoreAction = (
    action: SolverAction,
    values: readonly number[],
  ): number => {
    let score = -action.attemptCostGold;
    for (const transition of getTransitions(action)) {
      score -= transition.probability * transition.extraCostGold;
      if (isTerminalGrade(transition.grade)) {
        score +=
          transition.probability *
          (getSaleValueForLandingGrade(
            input.saleValuesByGrade,
            transition.grade,
          ) -
            input.upgradeCostGold);
      } else {
        const nextStateIndex = stateIndexByGrade.get(transition.grade);
        if (nextStateIndex == null) return Number.NEGATIVE_INFINITY;
        score += transition.probability * (values[nextStateIndex] ?? 0);
      }
    }
    return score;
  };

  let selectedActions = new Map<number, SolverAction>();
  for (const grade of stateGrades) {
    const initialAction = actionsByGrade.get(grade)?.[0];
    if (!initialAction) {
      return unavailableResult(
        "No priced regrade action is available at every required grade.",
      );
    }
    selectedActions.set(grade, initialAction);
  }
  let evaluation: SolverPolicyEvaluation | null = null;
  let converged = false;
  const seenPolicies = new Set<string>();

  for (let iteration = 0; iteration < MAX_POLICY_ITERATIONS; iteration += 1) {
    const fingerprint = stateGrades
      .map((grade) => {
        const selectedAction = selectedActions.get(grade);
        return selectedAction
          ? (actionsByGrade.get(grade) ?? []).indexOf(selectedAction)
          : -1;
      })
      .join(",");
    if (seenPolicies.has(fingerprint)) break;
    seenPolicies.add(fingerprint);

    evaluation = evaluatePolicy(selectedActions);
    if (!evaluation) break;
    const nextActions = new Map(selectedActions);
    let changed = false;

    for (const [stateIndex, grade] of stateGrades.entries()) {
      const currentAction = selectedActions.get(grade);
      if (!currentAction) {
        return unavailableResult(
          "The regrade strategy solver produced an incomplete strategy.",
        );
      }
      let bestAction = currentAction;
      let bestScore = scoreAction(currentAction, evaluation.values);
      for (const action of actionsByGrade.get(grade) ?? []) {
        const score = scoreAction(action, evaluation.values);
        const tolerance =
          POLICY_TIE_TOLERANCE *
          Math.max(1, Math.abs(score), Math.abs(bestScore));
        if (score > bestScore + tolerance) {
          bestAction = action;
          bestScore = score;
        }
      }
      if (bestAction !== currentAction) {
        nextActions.set(grade, bestAction);
        changed = true;
      }
      if (!Number.isFinite(evaluation.values[stateIndex])) break;
    }

    if (!changed) {
      converged = true;
      break;
    }
    selectedActions = nextActions;
  }

  if (!converged || !evaluation) {
    return unavailableResult(
      "The regrade strategy solver could not find a stable terminating strategy.",
    );
  }

  const steps: RegradeActionChoice[] = [];
  const seenStepGrades = new Set<number>();
  let stepGrade = startGrade;
  while (stepGrade < input.targetGrade && !seenStepGrades.has(stepGrade)) {
    if (input.saleValuesByGrade.has(stepGrade)) break;
    seenStepGrades.add(stepGrade);
    const action = selectedActions.get(stepGrade);
    if (!action?.step.scroll) break;
    const solvedAtGradeIndex = stateIndexByGrade.get(stepGrade);
    if (solvedAtGradeIndex == null) break;
    steps.push({
      fromGrade: stepGrade,
      scroll: action.step.scroll,
      charm: action.step.charm,
      expectedValueGold: evaluation.values[solvedAtGradeIndex] ?? 0,
      attemptCostGold: action.attemptCostGold,
      attemptLabor: action.attemptLabor,
      successProbability: action.step.successProbability,
      greatProbability: action.step.greatProbability,
      normalToGrade: action.step.normalToGrade,
      greatToGrade: action.step.greatToGrade,
    });
    if (action.step.normalToGrade <= stepGrade) break;
    stepGrade = action.step.normalToGrade;
  }

  const expectedCostGold = evaluation.costs[startIndex] ?? 0;
  const expectedRevenueGold = evaluation.revenues[startIndex] ?? 0;
  const expectedProfitGold = expectedRevenueGold - expectedCostGold;
  const expectedLabor = evaluation.labor[startIndex] ?? 0;
  const expectedAttempts = evaluation.attempts[startIndex] ?? 0;
  const revenueBreakdown = terminalGrades
    .map((grade, terminalIndex) => {
      const probability =
        evaluation.landingProbabilities[startIndex]?.[terminalIndex] ?? 0;
      const saleValueGold = getSaleValueForLandingGrade(
        input.saleValuesByGrade,
        grade,
      );
      const expectedCostGold =
        evaluation.costContributions[startIndex]?.[terminalIndex] ?? 0;
      return {
        grade,
        probability,
        saleValueGold,
        expectedRevenueGold: probability * saleValueGold,
        expectedCostGold,
        expectedProfitGold: probability * saleValueGold - expectedCostGold,
      };
    })
    .filter(
      (entry) => entry.probability > 0.000001 || entry.expectedRevenueGold > 0,
    )
    .sort((left, right) => left.grade - right.grade);

  return {
    item: input.item,
    targetGrade: input.targetGrade,
    expectedProfitGold,
    expectedCostGold,
    expectedRevenueGold,
    expectedLabor,
    expectedAttempts,
    revenueBreakdown,
    silverPerLabor:
      expectedLabor > 0 && Number.isFinite(expectedProfitGold)
        ? (expectedProfitGold * 100) / expectedLabor
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
