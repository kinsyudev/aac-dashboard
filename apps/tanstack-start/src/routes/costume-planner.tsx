import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { cn } from "@acme/ui";
import { Badge } from "@acme/ui/badge";
import { Button } from "@acme/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@acme/ui/card";
import { Checkbox } from "@acme/ui/checkbox";
import { Input } from "@acme/ui/input";

import type {
  GearKind,
  Grade,
  PlannerMaterialId,
  PlannerPrices,
} from "~/lib/costume-planner";
import {
  compareCurrentItem,
  getPlannerStats,
  GRADES,
  MATERIAL_LABELS,
  MATERIAL_PRICE_LOOKUP_NAMES,
  planTargetRoute,
  PRICE_LOOKUP_ITEM_NAMES,
} from "~/lib/costume-planner";
import { buildMetaTags, buildPageTitle } from "~/lib/metadata";
import { useTRPC } from "~/lib/trpc";
import { useUserData } from "~/lib/useUserData";

export const Route = createFileRoute("/costume-planner")({
  head: () => ({
    meta: buildMetaTags({
      title: buildPageTitle("Costume Planner"),
      description:
        "Plan ArcheAge Classic costume and undergarment upgrades, expected reroll cost, and restart decisions.",
    }),
  }),
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(
      context.trpc.items.byExactNames.queryOptions(PRICE_LOOKUP_ITEM_NAMES),
    );
  },
  component: CostumePlannerPage,
});

function CostumePlannerPage() {
  const trpc = useTRPC();
  const { overrideMap } = useUserData();
  const { data: priceRows = [] } = useQuery(
    trpc.items.byExactNames.queryOptions(PRICE_LOOKUP_ITEM_NAMES),
  );
  const [kind, setKind] = useState<GearKind>("costume");
  const [targetGrade, setTargetGrade] = useState<Grade>("mythic");
  const [targetProgress, setTargetProgress] = useState(100);
  const [targetStats, setTargetStats] = useState<string[]>([
    "ranged-attack",
    "ranged-critical-damage",
    "ranged-skill-damage",
    "ranged-critical-rate",
    "defense-penetration",
  ]);
  const [currentEnabled, setCurrentEnabled] = useState(false);
  const [currentGrade, setCurrentGrade] = useState<Grade>("legendary");
  const [currentProgress, setCurrentProgress] = useState(0);
  const [currentStats, setCurrentStats] = useState<string[]>([]);
  const [serendipityOverride, setSerendipityOverride] = useState("");
  const [currentItemValue, setCurrentItemValue] = useState("");
  const statOptions = useMemo(() => getPlannerStats(kind), [kind]);
  const currentStatOptions = statOptions;
  const prices = useMemo<PlannerPrices>(() => {
    const byName = new Map(priceRows.map((row) => [row.item.name, row]));
    const next: PlannerPrices = {};

    for (const [materialId, names] of Object.entries(
      MATERIAL_PRICE_LOOKUP_NAMES,
    ) as [PlannerMaterialId, string[]][]) {
      const row = names.map((name) => byName.get(name)).find(Boolean);
      if (!row) continue;

      const custom = overrideMap.get(row.item.id);
      const market = getMarketPrice(row.price);
      const resolved = custom ?? market;
      if (resolved != null) next[materialId] = resolved;
    }

    const customSerendipity = parseOptionalNumber(serendipityOverride);
    if (customSerendipity != null) {
      next.serendipityStone = customSerendipity;
    }

    return next;
  }, [overrideMap, priceRows, serendipityOverride]);
  const route = useMemo(
    () =>
      targetStats.length > 0
        ? planTargetRoute({
            kind,
            targetGrade,
            targetProgress,
            desiredStatIds: targetStats,
            prices,
          })
        : null,
    [kind, prices, targetGrade, targetProgress, targetStats],
  );
  const comparison = useMemo(() => {
    if (!currentEnabled || targetStats.length === 0) return null;

    return compareCurrentItem({
      kind,
      targetGrade,
      targetProgress,
      desiredStatIds: targetStats,
      current: {
        grade: currentGrade,
        progress: currentProgress,
        statIds: currentStats,
        currentItemValue: parseOptionalNumber(currentItemValue) ?? undefined,
      },
      prices,
    });
  }, [
    currentEnabled,
    currentGrade,
    currentItemValue,
    currentProgress,
    currentStats,
    kind,
    prices,
    targetGrade,
    targetProgress,
    targetStats,
  ]);
  const activeCost = comparison?.continueCost ?? route?.targetCost ?? null;
  const restartCost = comparison?.restartCost ?? null;
  const subtype = comparison?.subtype ?? route?.subtype ?? null;
  const conflict = subtype?.status === "conflict";

  function resetForKind(nextKind: GearKind) {
    setKind(nextKind);
    setTargetStats([]);
    setCurrentStats([]);
  }

  return (
    <main className="container py-16">
      <div className="mb-8 flex max-w-4xl flex-col gap-3">
        <p className="text-primary text-sm font-semibold tracking-[0.2em] uppercase">
          ArcheAge Classic 3.5
        </p>
        <h1 className="text-3xl font-bold tracking-tight">
          Costume and Undergarment Planner
        </h1>
        <p className="text-muted-foreground text-sm leading-6">
          Pick target stats, compare a current item, and estimate whether
          rerolling or salvaging into a restart is cheaper. Rerolls use a
          uniform chance over currently unlocked stats.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Target item</CardTitle>
              <CardDescription>
                Subtype is inferred from selected typed stats. Pick up to five
                stats.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Kind">
                  <select
                    value={kind}
                    onChange={(event) =>
                      resetForKind(event.target.value as GearKind)
                    }
                    className={selectClassName}
                  >
                    <option value="costume">Costume</option>
                    <option value="undergarment">Undergarments</option>
                  </select>
                </Field>
                <Field label="Target grade">
                  <select
                    value={targetGrade}
                    onChange={(event) =>
                      setTargetGrade(event.target.value as Grade)
                    }
                    className={selectClassName}
                  >
                    {GRADES.map((grade) => (
                      <option key={grade} value={grade}>
                        {formatGrade(grade)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Target progress %">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={targetProgress}
                    onChange={(event) =>
                      setTargetProgress(clampNumber(event.target.value, 0, 100))
                    }
                  />
                </Field>
              </div>

              <StatPicker
                options={statOptions}
                selected={targetStats}
                onToggle={(statId) =>
                  setTargetStats((prev) => toggleStat(prev, statId))
                }
                max={5}
              />

              <SubtypeBadge subtype={subtype} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>Current item comparison</CardTitle>
                  <CardDescription>
                    Optional. Add current grade and stats to compare continuing
                    against salvaging and restarting.
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant={currentEnabled ? "default" : "outline"}
                  onClick={() => setCurrentEnabled((value) => !value)}
                >
                  {currentEnabled ? "Enabled" : "Enable"}
                </Button>
              </div>
            </CardHeader>
            {currentEnabled ? (
              <CardContent className="flex flex-col gap-5">
                <div className="grid gap-4 md:grid-cols-4">
                  <Field label="Current grade">
                    <select
                      value={currentGrade}
                      onChange={(event) =>
                        setCurrentGrade(event.target.value as Grade)
                      }
                      className={selectClassName}
                    >
                      {GRADES.map((grade) => (
                        <option key={grade} value={grade}>
                          {formatGrade(grade)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Current progress %">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={currentProgress}
                      onChange={(event) =>
                        setCurrentProgress(
                          clampNumber(event.target.value, 0, 100),
                        )
                      }
                    />
                  </Field>
                  <Field label="Serendipity price">
                    <Input
                      type="number"
                      min={0}
                      placeholder="Market"
                      value={serendipityOverride}
                      onChange={(event) =>
                        setSerendipityOverride(event.target.value)
                      }
                    />
                  </Field>
                  <Field label="Current item value">
                    <Input
                      type="number"
                      min={0}
                      placeholder="Optional"
                      value={currentItemValue}
                      onChange={(event) =>
                        setCurrentItemValue(event.target.value)
                      }
                    />
                  </Field>
                </div>

                <StatPicker
                  options={currentStatOptions}
                  selected={currentStats}
                  onToggle={(statId) =>
                    setCurrentStats((prev) => toggleStat(prev, statId))
                  }
                  max={5}
                />
              </CardContent>
            ) : null}
          </Card>
        </div>

        <aside className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Recommendation</CardTitle>
              <CardDescription>
                Uses current market prices, then profile overrides.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {conflict ? (
                <p className="text-destructive text-sm">
                  Selected stats require conflicting subtypes. Remove mixed
                  typed stats to calculate a route.
                </p>
              ) : comparison ? (
                <div className="flex flex-col gap-3">
                  <Badge
                    variant={
                      comparison.recommendation === "continue"
                        ? "default"
                        : "secondary"
                    }
                    className="w-fit"
                  >
                    {comparison.recommendation === "continue"
                      ? "Continue rerolling"
                      : "Salvage and restart"}
                  </Badge>
                  <CostLine
                    label="Continue"
                    value={comparison.continueCost.totalCost}
                  />
                  <CostLine
                    label="Restart"
                    value={comparison.restartCost.totalCost}
                  />
                  <CostLine
                    label="Salvage credit"
                    value={comparison.restartCost.salvageCredit}
                  />
                </div>
              ) : route ? (
                <div className="flex flex-col gap-3">
                  <Badge className="w-fit">Build from scratch</Badge>
                  <CostLine
                    label="Expected total"
                    value={route.targetCost.totalCost}
                  />
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">
                  Select target stats to calculate a route.
                </p>
              )}
            </CardContent>
          </Card>

          {activeCost ? (
            <Card>
              <CardHeader>
                <CardTitle>Expected cost</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <CostLine label="Materials" value={activeCost.materialCost} />
                <CostLine label="Craft gold" value={activeCost.craftGold} />
                <CostLine label="Rerolls" value={activeCost.rerollCost} />
                <div className="text-muted-foreground text-xs">
                  {formatNumber(activeCost.expectedRerolls)} expected
                  serendipity stones
                </div>
              </CardContent>
            </Card>
          ) : null}

          {restartCost ? (
            <Card>
              <CardHeader>
                <CardTitle>Restart cost</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <CostLine
                  label="Expected total"
                  value={restartCost.totalCost}
                />
                <CostLine label="Rerolls" value={restartCost.rerollCost} />
                <CostLine
                  label="Salvage credit"
                  value={restartCost.salvageCredit}
                />
              </CardContent>
            </Card>
          ) : null}
        </aside>
      </div>

      {route && !conflict ? (
        <section className="mt-6 grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Upgrade checkpoints</CardTitle>
            </CardHeader>
            <CardContent>
              {route.checkpoints.length > 0 ? (
                <ul className="divide-y">
                  {route.checkpoints.map((checkpoint) => (
                    <li
                      key={`${checkpoint.grade}-${checkpoint.action}`}
                      className="py-3"
                    >
                      <p className="font-medium">
                        {formatGrade(checkpoint.grade)}
                      </p>
                      <p className="text-muted-foreground text-sm">
                        {checkpoint.action}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {formatNumber(checkpoint.expectedRerolls)} expected
                        rerolls
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">
                  No selected target stats require rerolling.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Required materials</CardTitle>
            </CardHeader>
            <CardContent>
              {activeCost?.materials.length ? (
                <ul className="divide-y">
                  {activeCost.materials.map((material) => (
                    <li
                      key={material.id}
                      className="flex items-center justify-between gap-4 py-3"
                    >
                      <div>
                        <p className="font-medium">
                          {MATERIAL_LABELS[material.id]}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {formatNumber(material.amount)} needed
                        </p>
                      </div>
                      <p className="text-sm font-medium">
                        {formatGold(
                          (prices[material.id] ?? 0) * material.amount,
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">
                  No remaining synthesis materials for this target.
                </p>
              )}
            </CardContent>
          </Card>
        </section>
      ) : null}
    </main>
  );
}

const selectClassName =
  "border-input bg-background h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]";

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="flex flex-col gap-2 text-sm font-medium">
      {label}
      {children}
    </label>
  );
}

function StatPicker({
  max,
  onToggle,
  options,
  selected,
}: {
  options: { id: string; label: string }[];
  selected: string[];
  onToggle: (statId: string) => void;
  max: number;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {options.map((stat) => {
        const checked = selected.includes(stat.id);
        const disabled = !checked && selected.length >= max;

        return (
          <button
            key={stat.id}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(stat.id)}
            className={cn(
              "hover:bg-muted/60 flex min-h-10 items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-45",
              checked && "border-primary bg-primary/10",
            )}
          >
            <Checkbox checked={checked} tabIndex={-1} aria-hidden />
            <span>{stat.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function SubtypeBadge({
  subtype,
}: {
  subtype:
    | { status: "inferred"; subtype: string }
    | { status: "any"; subtype: "any" }
    | { status: "conflict"; subtypes: string[] }
    | null;
}) {
  if (!subtype) return null;

  if (subtype.status === "conflict") {
    return (
      <Badge variant="destructive" className="w-fit">
        Conflicting subtypes: {subtype.subtypes.join(", ")}
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" className="w-fit">
      Inferred subtype:{" "}
      {subtype.status === "any" ? "Any" : capitalize(subtype.subtype)}
    </Badge>
  );
}

function CostLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{formatGold(value)}</span>
    </div>
  );
}

function toggleStat(current: string[], statId: string): string[] {
  if (current.includes(statId)) {
    return current.filter((id) => id !== statId);
  }
  if (current.length >= 5) return current;
  return [...current, statId];
}

function getMarketPrice(
  price: {
    avg24h: string | null;
    avg7d: string | null;
    avg30d: string | null;
  } | null,
): number | null {
  return (
    parseOptionalNumber(price?.avg24h ?? "") ??
    parseOptionalNumber(price?.avg7d ?? "") ??
    parseOptionalNumber(price?.avg30d ?? "")
  );
}

function parseOptionalNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampNumber(value: string, min: number, max: number): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
}

function formatGrade(grade: Grade): string {
  return capitalize(grade);
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function formatGold(value: number): string {
  return `${value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })}g`;
}

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
