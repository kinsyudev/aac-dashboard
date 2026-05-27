import type { GearKind, Grade } from "./costume-planner.ts";
import { getPlannerStats, GRADES } from "./costume-planner.ts";

export interface CostumePlannerState {
  kind: GearKind;
  targetGrade: Grade;
  targetProgress: number;
  targetStats: string[];
  currentEnabled: boolean;
  currentGrade: Grade;
  currentProgress: number;
  currentStats: string[];
  serendipityOverride: string;
  currentItemValue: string;
  honorGoldPerThousand: string;
}

export interface CostumePlannerSearch {
  k?: GearKind;
  tg?: Grade;
  tp?: number;
  ts?: string;
  ce?: true;
  cg?: Grade;
  cp?: number;
  cs?: string;
  sp?: string;
  cv?: string;
  h?: string;
}

export const DEFAULT_COSTUME_PLANNER_STATE: CostumePlannerState = {
  kind: "costume",
  targetGrade: "mythic",
  targetProgress: 100,
  targetStats: [
    "ranged-attack",
    "ranged-critical-damage",
    "ranged-skill-damage",
    "ranged-critical-rate",
    "defense-penetration",
  ],
  currentEnabled: false,
  currentGrade: "legendary",
  currentProgress: 0,
  currentStats: [],
  serendipityOverride: "",
  currentItemValue: "",
  honorGoldPerThousand: "10",
};

const GEAR_KINDS = ["costume", "undergarment"] as const;
const MAX_STATS = 5;

export function normalizeCostumePlannerState(
  input: Partial<CostumePlannerState>,
): CostumePlannerState {
  const kind = isGearKind(input.kind)
    ? input.kind
    : DEFAULT_COSTUME_PLANNER_STATE.kind;

  return {
    kind,
    targetGrade: isGrade(input.targetGrade)
      ? input.targetGrade
      : DEFAULT_COSTUME_PLANNER_STATE.targetGrade,
    targetProgress: clampNumber(
      input.targetProgress,
      0,
      100,
      DEFAULT_COSTUME_PLANNER_STATE.targetProgress,
    ),
    targetStats: normalizeStats(
      input.targetStats ?? DEFAULT_COSTUME_PLANNER_STATE.targetStats,
      kind,
    ),
    currentEnabled: input.currentEnabled === true,
    currentGrade: isGrade(input.currentGrade)
      ? input.currentGrade
      : DEFAULT_COSTUME_PLANNER_STATE.currentGrade,
    currentProgress: clampNumber(
      input.currentProgress,
      0,
      100,
      DEFAULT_COSTUME_PLANNER_STATE.currentProgress,
    ),
    currentStats: normalizeStats(input.currentStats, kind),
    serendipityOverride: normalizeOptionalText(input.serendipityOverride),
    currentItemValue: normalizeOptionalText(input.currentItemValue),
    honorGoldPerThousand:
      normalizeOptionalText(input.honorGoldPerThousand) ||
      DEFAULT_COSTUME_PLANNER_STATE.honorGoldPerThousand,
  };
}

export function parseCostumePlannerSearch(
  search: Record<string, unknown> | CostumePlannerSearch,
): CostumePlannerState {
  const params = search as Record<string, unknown>;

  return normalizeCostumePlannerState({
    kind: readGearKind(params.k),
    targetGrade: readGrade(params.tg),
    targetProgress: readNumber(params.tp),
    targetStats: readList(params.ts),
    currentEnabled: readBoolean(params.ce),
    currentGrade: readGrade(params.cg),
    currentProgress: readNumber(params.cp),
    currentStats: readList(params.cs),
    serendipityOverride: readString(params.sp),
    currentItemValue: readString(params.cv),
    honorGoldPerThousand: readString(params.h),
  });
}

export function serializeCostumePlannerSearch(
  input: Partial<CostumePlannerState>,
): CostumePlannerSearch {
  const state = normalizeCostumePlannerState(input);
  const result: CostumePlannerSearch = {};

  if (state.kind !== DEFAULT_COSTUME_PLANNER_STATE.kind) result.k = state.kind;
  if (state.targetGrade !== DEFAULT_COSTUME_PLANNER_STATE.targetGrade) {
    result.tg = state.targetGrade;
  }
  if (state.targetProgress !== DEFAULT_COSTUME_PLANNER_STATE.targetProgress) {
    result.tp = state.targetProgress;
  }
  if (!sameList(state.targetStats, DEFAULT_COSTUME_PLANNER_STATE.targetStats)) {
    result.ts = state.targetStats.join(",");
  }
  if (state.currentEnabled) result.ce = true;
  if (state.currentGrade !== DEFAULT_COSTUME_PLANNER_STATE.currentGrade) {
    result.cg = state.currentGrade;
  }
  if (state.currentProgress !== DEFAULT_COSTUME_PLANNER_STATE.currentProgress) {
    result.cp = state.currentProgress;
  }
  if (state.currentStats.length > 0) result.cs = state.currentStats.join(",");
  if (state.serendipityOverride) result.sp = state.serendipityOverride;
  if (state.currentItemValue) result.cv = state.currentItemValue;
  if (
    state.honorGoldPerThousand !==
    DEFAULT_COSTUME_PLANNER_STATE.honorGoldPerThousand
  ) {
    result.h = state.honorGoldPerThousand;
  }

  return result;
}

function normalizeStats(value: string[] | undefined, kind: GearKind): string[] {
  const allowed = new Set(getPlannerStats(kind).map((stat) => stat.id));
  const seen = new Set<string>();
  const stats: string[] = [];

  for (const statId of value ?? []) {
    if (!allowed.has(statId) || seen.has(statId)) continue;
    seen.add(statId);
    stats.push(statId);
    if (stats.length >= MAX_STATS) break;
  }

  return stats;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readGearKind(value: unknown): GearKind | undefined {
  return isGearKind(value) ? value : undefined;
}

function readGrade(value: unknown): Grade | undefined {
  return isGrade(value) ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value !== "string") return undefined;
  return value.split(",").filter(Boolean);
}

function readBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === "1";
}

function normalizeOptionalText(value: string | undefined): string {
  return value?.trim() ?? "";
}

function isGearKind(value: unknown): value is GearKind {
  return GEAR_KINDS.includes(value as GearKind);
}

function isGrade(value: unknown): value is Grade {
  return GRADES.includes(value as Grade);
}

function clampNumber(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function sameList(left: string[], right: string[]): boolean {
  return (
    left.length === right.length && left.every((item, i) => item === right[i])
  );
}
