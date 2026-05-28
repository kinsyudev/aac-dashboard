import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

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
import { toast } from "@acme/ui/toast";

import type {
  GearKind,
  Grade,
  MaterialPricingOptions,
  PlannerMaterialId,
  PlannerPrices,
} from "~/lib/costume-planner";
import type { CostumePlannerState } from "~/lib/costume-planner-state";
import type {
  ModesMap,
  PriceMap,
  SelectedCraftMap,
} from "~/lib/craft-optimizer";
import { ItemIcon } from "~/component/item-icon";
import {
  CraftModeToggle,
  RecipeCardShell,
  RecipeCollapseToggle,
  RecipeHeader,
  RecipeItemRow,
} from "~/component/recipe-breakdown";
import {
  compareCurrentStrategy,
  getBoundRadiantSynthiumStonePrice,
  getPlannerStats,
  GRADES,
  MATERIAL_LABELS,
  MATERIAL_PRICE_LOOKUP_NAMES,
  planOptimalStrategy,
  PRICE_LOOKUP_ITEM_NAMES,
} from "~/lib/costume-planner";
import {
  normalizeCostumePlannerState,
  parseCostumePlannerSearch,
  serializeCostumePlannerSearch,
} from "~/lib/costume-planner-state";
import {
  computeManualCraftMetrics,
  getItemPrice,
  getSelectedEntry,
  MAX_CRAFT_DEPTH,
} from "~/lib/craft-optimizer";
import { buildMetaTags, buildPageTitle } from "~/lib/metadata";
import { useTRPC } from "~/lib/trpc";
import { useUserData } from "~/lib/useUserData";

const SERENDIPITY_ITEM_ID = 8001000;
const SERENDIPITY_CRAFT_ID = 9000059;
const COIN_ITEM_ID = 500;
const COIN_GOLD_VALUE = 1 / 10000;

export const Route = createFileRoute("/costume-planner")({
  validateSearch: (search) =>
    serializeCostumePlannerSearch(parseCostumePlannerSearch(search)),
  head: () => ({
    meta: buildMetaTags({
      title: buildPageTitle("Costume Planner"),
      description:
        "Plan ArcheAge Classic costume and undergarment upgrades, expected reroll cost, and restart decisions.",
    }),
  }),
  loader: async ({ context }) => {
    await context.queryClient.fetchQuery(
      context.trpc.auth.requireMember.queryOptions(),
    );
    void context.queryClient.prefetchQuery(
      context.trpc.items.byExactNames.queryOptions(PRICE_LOOKUP_ITEM_NAMES),
    );
    void context.queryClient.prefetchQuery(
      context.trpc.profile.listCostumePlannerLoadouts.queryOptions(),
    );
  },
  component: CostumePlannerPage,
});

function CostumePlannerPage() {
  const trpc = useTRPC();
  const navigate = useNavigate({ from: "/costume-planner" });
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const { overrideMap, proficiencyMap } = useUserData();
  const { data: priceRows = [] } = useQuery(
    trpc.items.byExactNames.queryOptions(PRICE_LOOKUP_ITEM_NAMES),
  );
  const { data: savedLoadouts = [] } = useQuery(
    trpc.profile.listCostumePlannerLoadouts.queryOptions(),
  );
  const plannerState = useMemo(
    () => parseCostumePlannerSearch(search),
    [search],
  );
  const {
    currentEnabled,
    currentGrade,
    currentItemValue,
    currentProgress,
    currentStats,
    boundSynthiumForEpicPlus,
    craftedSerendipities,
    honorGoldPerThousand,
    kind,
    serendipityOverride,
    serendipityCraftModes,
    serendipitySelectedCrafts,
    targetGrade,
    targetProgress,
    targetStats,
  } = plannerState;
  const serendipityCraftQuery = useQuery({
    ...trpc.crafts.forItem.queryOptions(SERENDIPITY_ITEM_ID),
    enabled: craftedSerendipities,
  });
  const [selectedLoadoutId, setSelectedLoadoutId] = useState("");
  const [loadoutName, setLoadoutName] = useState("");
  const statOptions = useMemo(() => getPlannerStats(kind), [kind]);
  const currentStatOptions = statOptions;
  const honorRate = parseOptionalNumber(honorGoldPerThousand) ?? 10;
  const serendipityCraftData = serendipityCraftQuery.data ?? null;
  const serendipityPriceMap = useMemo<PriceMap>(
    () => buildPriceMap(serendipityCraftData?.prices ?? []),
    [serendipityCraftData],
  );
  const serendipityCraftEntry = useMemo(
    () =>
      serendipityCraftData?.crafts.find(
        (entry) => entry.craft.id === SERENDIPITY_CRAFT_ID,
      ) ?? null,
    [serendipityCraftData],
  );
  const serendipityCraftCost = useMemo(() => {
    if (!craftedSerendipities || !serendipityCraftEntry) return null;

    return computeManualCraftMetrics(
      serendipityCraftEntry,
      SERENDIPITY_ITEM_ID,
      0,
      {
        subcraftMap: serendipityCraftData?.subcraftsByItemId ?? {},
        priceMap: serendipityPriceMap,
        overrideMap,
        proficiencyMap,
        maxDepth: MAX_CRAFT_DEPTH,
      },
      serendipityCraftModes,
      serendipitySelectedCrafts,
    ).costPerUnit;
  }, [
    craftedSerendipities,
    overrideMap,
    proficiencyMap,
    serendipityCraftData,
    serendipityCraftEntry,
    serendipityCraftModes,
    serendipityPriceMap,
    serendipitySelectedCrafts,
  ]);
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
    if (!craftedSerendipities && customSerendipity != null) {
      next.serendipityStone = customSerendipity;
    }

    return next;
  }, [craftedSerendipities, overrideMap, priceRows, serendipityOverride]);
  const materialPricing = useMemo<MaterialPricingOptions>(
    () => ({
      boundSynthiumForEpicPlus,
      serendipityStonePrice:
        craftedSerendipities && serendipityCraftCost != null
          ? serendipityCraftCost
          : undefined,
    }),
    [boundSynthiumForEpicPlus, craftedSerendipities, serendipityCraftCost],
  );
  const route = useMemo(
    () =>
      targetStats.length > 0
        ? planOptimalStrategy({
            kind,
            targetGrade,
            targetProgress,
            desiredStatIds: targetStats,
            prices,
            honorGoldPerThousand: honorRate,
            materialPricing,
          })
        : null,
    [
      honorRate,
      kind,
      materialPricing,
      prices,
      targetGrade,
      targetProgress,
      targetStats,
    ],
  );
  const comparison = useMemo(() => {
    if (!currentEnabled || targetStats.length === 0) return null;

    return compareCurrentStrategy({
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
      honorGoldPerThousand: honorRate,
      materialPricing,
    });
  }, [
    currentEnabled,
    currentGrade,
    currentItemValue,
    currentProgress,
    currentStats,
    honorRate,
    kind,
    materialPricing,
    prices,
    targetGrade,
    targetProgress,
    targetStats,
  ]);
  const activeCost = comparison
    ? comparison.recommendation === "restart"
      ? comparison.restartCost
      : comparison.continueCost
    : (route?.targetCost ?? null);
  const activeBaseItemCost = comparison
    ? comparison.recommendation === "restart"
      ? comparison.baseItemCost
      : 0
    : (route?.baseItemCost ?? 0);
  const activeSerendipityUnitCost =
    materialPricing.serendipityStonePrice ?? prices.serendipityStone ?? 0;
  const restartCost = comparison?.restartCost ?? null;
  const subtype = comparison?.subtype ?? route?.subtype ?? null;
  const conflict = subtype?.status === "conflict";
  const strategyCheckpoints =
    comparison?.strategyCheckpoints ?? route?.strategyCheckpoints ?? [];
  const createLoadout = useMutation(
    trpc.profile.createCostumePlannerLoadout.mutationOptions({
      onSuccess: async (created) => {
        await queryClient.invalidateQueries(
          trpc.profile.listCostumePlannerLoadouts.pathFilter(),
        );
        setSelectedLoadoutId(created.id);
        setLoadoutName(created.name);
        toast.success("Loadout saved.");
      },
      onError: () => toast.error("Failed to save loadout."),
    }),
  );
  const updateLoadout = useMutation(
    trpc.profile.updateCostumePlannerLoadout.mutationOptions({
      onSuccess: async (updated) => {
        await queryClient.invalidateQueries(
          trpc.profile.listCostumePlannerLoadouts.pathFilter(),
        );
        setSelectedLoadoutId(updated.id);
        setLoadoutName(updated.name);
        toast.success("Loadout updated.");
      },
      onError: () => toast.error("Failed to update loadout."),
    }),
  );
  const selectedLoadout =
    savedLoadouts.find((loadout) => loadout.id === selectedLoadoutId) ?? null;

  function resetForKind(nextKind: GearKind) {
    updatePlannerState({ kind: nextKind, targetStats: [], currentStats: [] });
  }

  function updatePlannerState(patch: Partial<CostumePlannerState>) {
    void navigate({
      search: (prev) =>
        serializeCostumePlannerSearch({
          ...parseCostumePlannerSearch(prev),
          ...patch,
        }),
    });
  }

  function replacePlannerState(nextState: Partial<CostumePlannerState>) {
    void navigate({
      search: serializeCostumePlannerSearch(
        normalizeCostumePlannerState(nextState),
      ),
    });
  }

  function saveAsNewLoadout() {
    const name = loadoutName.trim();
    if (!name) {
      toast.error("Enter a loadout name.");
      return;
    }

    createLoadout.mutate({ name, state: plannerState });
  }

  function updateSelectedLoadout() {
    const trimmedName = loadoutName.trim();
    const name =
      trimmedName.length > 0
        ? trimmedName
        : (selectedLoadout?.name ?? "").trim();
    if (!selectedLoadoutId || !name) {
      toast.error("Select a saved loadout to update.");
      return;
    }

    updateLoadout.mutate({ id: selectedLoadoutId, name, state: plannerState });
  }

  function loadSelectedLoadout() {
    if (!selectedLoadout) {
      toast.error("Select a saved loadout to load.");
      return;
    }

    replacePlannerState(selectedLoadout.state);
    setLoadoutName(selectedLoadout.name);
    toast.success("Loadout loaded.");
  }

  function copyShareLink() {
    void navigator.clipboard.writeText(window.location.href).then(
      () => toast.success("Share link copied."),
      () => toast.error("Failed to copy share link."),
    );
  }

  return (
    <main className="container py-16">
      <div className="mb-8 flex max-w-4xl flex-col gap-3">
        <p className="text-primary text-sm font-semibold tracking-[0.2em] uppercase">
          ArcheAge Classic
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
              <div className="grid gap-4 md:grid-cols-4">
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
                      updatePlannerState({
                        targetGrade: event.target.value as Grade,
                      })
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
                      updatePlannerState({
                        targetProgress: clampNumber(event.target.value, 0, 100),
                      })
                    }
                  />
                </Field>
                <Field label="Honor gold / 1k">
                  <Input
                    type="number"
                    min={0}
                    value={honorGoldPerThousand}
                    onChange={(event) =>
                      updatePlannerState({
                        honorGoldPerThousand: event.target.value,
                      })
                    }
                  />
                </Field>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <PlannerOptionToggle
                  checked={craftedSerendipities}
                  label="Crafted Serendipities"
                  description="Use craft 9000059 for Serendipity Stone reroll cost."
                  onToggle={() =>
                    updatePlannerState({
                      craftedSerendipities: !craftedSerendipities,
                    })
                  }
                />
                <PlannerOptionToggle
                  checked={boundSynthiumForEpicPlus}
                  label="Bound Synthium for Epic+"
                  description="Price Radiant Synthium through the bound Radiant recipe."
                  onToggle={() =>
                    updatePlannerState({
                      boundSynthiumForEpicPlus: !boundSynthiumForEpicPlus,
                    })
                  }
                />
              </div>

              {craftedSerendipities ? (
                <SerendipityRecipeSelector
                  entry={serendipityCraftEntry}
                  loading={serendipityCraftQuery.isLoading}
                  priceMap={serendipityPriceMap}
                  overrideMap={overrideMap}
                  proficiencyMap={proficiencyMap}
                  subcraftMap={serendipityCraftData?.subcraftsByItemId ?? {}}
                  modes={serendipityCraftModes}
                  selectedCrafts={serendipitySelectedCrafts}
                  unitCost={serendipityCraftCost}
                  setModes={(nextModes) =>
                    updatePlannerState({ serendipityCraftModes: nextModes })
                  }
                  setSelectedCrafts={(nextSelectedCrafts) =>
                    updatePlannerState({
                      serendipitySelectedCrafts: nextSelectedCrafts,
                    })
                  }
                />
              ) : null}

              <StatPicker
                options={statOptions}
                selected={targetStats}
                onToggle={(statId) =>
                  updatePlannerState({
                    targetStats: toggleStat(targetStats, statId),
                  })
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
                  onClick={() =>
                    updatePlannerState({ currentEnabled: !currentEnabled })
                  }
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
                        updatePlannerState({
                          currentGrade: event.target.value as Grade,
                        })
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
                        updatePlannerState({
                          currentProgress: clampNumber(
                            event.target.value,
                            0,
                            100,
                          ),
                        })
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
                        updatePlannerState({
                          serendipityOverride: event.target.value,
                        })
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
                        updatePlannerState({
                          currentItemValue: event.target.value,
                        })
                      }
                    />
                  </Field>
                </div>

                <StatPicker
                  options={currentStatOptions}
                  selected={currentStats}
                  onToggle={(statId) =>
                    updatePlannerState({
                      currentStats: toggleStat(currentStats, statId),
                    })
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
              <CardTitle>Saved loadouts</CardTitle>
              <CardDescription>
                Save named costume and undergarment planner snapshots.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Field label="Loadout">
                <select
                  value={selectedLoadoutId}
                  onChange={(event) => {
                    const nextId = event.target.value;
                    const nextLoadout =
                      savedLoadouts.find((loadout) => loadout.id === nextId) ??
                      null;
                    setSelectedLoadoutId(nextId);
                    setLoadoutName(nextLoadout?.name ?? "");
                  }}
                  className={selectClassName}
                >
                  <option value="">Select saved loadout</option>
                  {savedLoadouts.map((loadout) => (
                    <option key={loadout.id} value={loadout.id}>
                      {loadout.name} ({formatKind(loadout.kind)})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Name">
                <Input
                  value={loadoutName}
                  maxLength={120}
                  placeholder="e.g. Ranged mythic costume"
                  onChange={(event) => setLoadoutName(event.target.value)}
                />
              </Field>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  type="button"
                  onClick={saveAsNewLoadout}
                  loading={createLoadout.isPending}
                  loadingText="Saving..."
                >
                  Save as new
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!selectedLoadoutId}
                  onClick={updateSelectedLoadout}
                  loading={updateLoadout.isPending}
                  loadingText="Updating..."
                >
                  Update saved
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!selectedLoadoutId}
                  onClick={loadSelectedLoadout}
                >
                  Load
                </Button>
                <Button type="button" variant="outline" onClick={copyShareLink}>
                  Copy share link
                </Button>
              </div>
            </CardContent>
          </Card>

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
                  <CostLine
                    label="Fresh base item"
                    value={comparison.baseItemCost}
                  />
                </div>
              ) : route ? (
                <div className="flex flex-col gap-3">
                  <Badge className="w-fit">Build from scratch</Badge>
                  <CostLine
                    label="Expected total"
                    value={route.targetCost.totalCost}
                  />
                  <CostLine
                    label="Fresh base item"
                    value={route.baseItemCost}
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
                <CostLine
                  label={
                    craftedSerendipities ? "Crafted Serendipity" : "Serendipity"
                  }
                  value={activeSerendipityUnitCost}
                />
                {activeBaseItemCost > 0 ? (
                  <CostLine
                    label="Fresh base item"
                    value={activeBaseItemCost}
                  />
                ) : null}
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
                  label="Fresh base item"
                  value={comparison?.baseItemCost ?? 0}
                />
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
              <CardTitle>Strategy checkpoints</CardTitle>
            </CardHeader>
            <CardContent>
              {strategyCheckpoints.length > 0 ? (
                <ul className="divide-y">
                  {strategyCheckpoints.map((checkpoint, index) => (
                    <li
                      key={`${checkpoint.grade}-${checkpoint.action}-${index}`}
                      className="py-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">
                          {formatGrade(checkpoint.grade)}
                        </p>
                        <Badge variant="secondary" className="capitalize">
                          {checkpoint.action}
                        </Badge>
                      </div>
                      <p className="text-muted-foreground text-sm">
                        {checkpoint.label}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {formatGold(checkpoint.expectedCost)} expected
                        checkpoint cost
                        {checkpoint.restartCost != null
                          ? `; restart is ${formatGold(checkpoint.restartCost)}`
                          : ""}
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
                          getPlannerMaterialUnitPrice(
                            material.id,
                            prices,
                            materialPricing,
                          ) * material.amount,
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

interface PlannerRecipeItem {
  id: number;
  name: string;
  icon?: string | null;
}

interface PlannerRecipeEntry {
  craft: {
    id: number;
    name: string;
    labor: number;
    proficiency: string | null;
  };
  materials: { amount: number; item: PlannerRecipeItem }[];
  products: { amount: number; item: { id: number } }[];
}

type PlannerSubcraftMap = Record<number, PlannerRecipeEntry[]>;

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="flex flex-col gap-2 text-sm font-medium">
      {label}
      {children}
    </label>
  );
}

function PlannerOptionToggle({
  checked,
  description,
  label,
  onToggle,
}: {
  checked: boolean;
  description: string;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "hover:bg-muted/60 flex min-h-16 items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors",
        checked && "border-primary bg-primary/10",
      )}
    >
      <Checkbox checked={checked} tabIndex={-1} aria-hidden />
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-muted-foreground text-xs leading-5">
          {description}
        </span>
      </span>
    </button>
  );
}

function SerendipityRecipeSelector({
  entry,
  loading,
  modes,
  overrideMap,
  priceMap,
  proficiencyMap,
  selectedCrafts,
  setModes,
  setSelectedCrafts,
  subcraftMap,
  unitCost,
}: {
  entry: PlannerRecipeEntry | null;
  loading: boolean;
  priceMap: PriceMap;
  overrideMap: Map<number, number>;
  proficiencyMap: Map<string, number>;
  subcraftMap: PlannerSubcraftMap;
  modes: ModesMap;
  selectedCrafts: SelectedCraftMap;
  unitCost: number | null;
  setModes: (modes: ModesMap) => void;
  setSelectedCrafts: (selectedCrafts: SelectedCraftMap) => void;
}) {
  const [collapsedCraftIds, setCollapsedCraftIds] = useState<Set<number>>(
    () => new Set(),
  );

  function toggleCollapsed(craftId: number) {
    setCollapsedCraftIds((prev) => {
      const next = new Set(prev);
      if (next.has(craftId)) next.delete(craftId);
      else next.add(craftId);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="text-muted-foreground rounded-md border p-3 text-sm">
        Loading Serendipity recipe...
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="text-destructive rounded-md border p-3 text-sm">
        Serendipity Stone craft 9000059 is unavailable.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Serendipity craft cost</p>
          <p className="text-muted-foreground text-xs">
            Top-level craft is locked to craft 9000059.
          </p>
        </div>
        <Badge variant="secondary">
          {unitCost == null ? "No cost" : `${formatGold(unitCost)} each`}
        </Badge>
      </div>
      <SerendipityRecipeTree
        entry={entry}
        producedItemId={SERENDIPITY_ITEM_ID}
        priceMap={priceMap}
        overrideMap={overrideMap}
        proficiencyMap={proficiencyMap}
        subcraftMap={subcraftMap}
        modes={modes}
        selectedCrafts={selectedCrafts}
        setModes={setModes}
        setSelectedCrafts={setSelectedCrafts}
        collapsedCraftIds={collapsedCraftIds}
        toggleCollapsed={toggleCollapsed}
      />
    </div>
  );
}

function SerendipityRecipeTree({
  collapsedCraftIds,
  depth = 0,
  entry,
  modes,
  overrideMap,
  priceMap,
  producedItemId,
  proficiencyMap,
  selectedCrafts,
  setModes,
  setSelectedCrafts,
  subcraftMap,
  toggleCollapsed,
}: {
  entry: PlannerRecipeEntry;
  producedItemId: number;
  priceMap: PriceMap;
  overrideMap: Map<number, number>;
  proficiencyMap: Map<string, number>;
  subcraftMap: PlannerSubcraftMap;
  modes: ModesMap;
  selectedCrafts: SelectedCraftMap;
  setModes: (modes: ModesMap) => void;
  setSelectedCrafts: (selectedCrafts: SelectedCraftMap) => void;
  collapsedCraftIds: Set<number>;
  toggleCollapsed: (craftId: number) => void;
  depth?: number;
}) {
  const isCollapsed = collapsedCraftIds.has(entry.craft.id);
  const metrics = computeManualCraftMetrics(
    entry,
    producedItemId,
    0,
    {
      subcraftMap,
      priceMap,
      overrideMap,
      proficiencyMap,
      maxDepth: MAX_CRAFT_DEPTH,
    },
    modes,
    selectedCrafts,
    depth,
  );

  return (
    <RecipeCardShell depth={depth}>
      <RecipeHeader
        depth={depth}
        title={entry.craft.name}
        proficiency={entry.craft.proficiency}
        laborLabel={entry.craft.labor > 0 ? `${entry.craft.labor} labor` : null}
        materialsLabel={formatGold(metrics.materialsCost)}
        collapseToggle={
          <RecipeCollapseToggle
            collapsed={isCollapsed}
            onToggle={() => toggleCollapsed(entry.craft.id)}
          />
        }
      />
      {isCollapsed ? null : (
        <ul className="flex flex-col gap-1">
          {entry.materials.map(({ amount, item }) => {
            const subEntries =
              depth < MAX_CRAFT_DEPTH ? (subcraftMap[item.id] ?? []) : [];
            const isCraftable = subEntries.length > 0;
            const mode = modes[item.id] ?? "buy";
            const selectedSubEntry = isCraftable
              ? getSelectedEntry(item.id, subcraftMap, selectedCrafts)
              : null;
            const buyUnit = getItemPrice(item.id, priceMap, overrideMap);
            const craftUnit = selectedSubEntry
              ? computeManualCraftMetrics(
                  selectedSubEntry,
                  item.id,
                  0,
                  {
                    subcraftMap,
                    priceMap,
                    overrideMap,
                    proficiencyMap,
                    maxDepth: MAX_CRAFT_DEPTH,
                  },
                  modes,
                  selectedCrafts,
                  depth + 1,
                ).costPerUnit
              : 0;
            const unit =
              mode === "craft" && selectedSubEntry ? craftUnit : buyUnit;
            const lineTotal = unit * amount;

            return (
              <li key={item.id} className="flex flex-col gap-1">
                <RecipeItemRow
                  icon={<ItemIcon icon={item.icon ?? null} name={item.name} />}
                  name={item.name}
                  amount={amount}
                  controls={
                    isCraftable ? (
                      <div className="flex items-center gap-2">
                        {subEntries.length > 1 ? (
                          <select
                            value={selectedSubEntry?.craft.id ?? ""}
                            onChange={(event) =>
                              setSelectedCrafts({
                                ...selectedCrafts,
                                [item.id]: Number(event.target.value),
                              })
                            }
                            className={cn(selectClassName, "h-8 w-40")}
                          >
                            {subEntries.map((subEntry) => (
                              <option
                                key={subEntry.craft.id}
                                value={subEntry.craft.id}
                              >
                                {subEntry.craft.name}
                              </option>
                            ))}
                          </select>
                        ) : null}
                        <CraftModeToggle
                          mode={mode}
                          onBuy={() => setModes({ ...modes, [item.id]: "buy" })}
                          onCraft={() =>
                            setModes({ ...modes, [item.id]: "craft" })
                          }
                        />
                      </div>
                    ) : null
                  }
                  value={
                    <span className="text-muted-foreground shrink-0 tabular-nums">
                      <span className="text-foreground/70">
                        {formatGold(unit)}
                      </span>
                      {amount > 1 ? (
                        <span className="text-foreground ml-1.5 font-medium">
                          = {formatGold(lineTotal)}
                        </span>
                      ) : null}
                    </span>
                  }
                />
                {mode === "craft" && selectedSubEntry ? (
                  <div className="border-muted-foreground/20 ml-3 border-l-2 pl-3">
                    <SerendipityRecipeTree
                      entry={selectedSubEntry}
                      producedItemId={item.id}
                      priceMap={priceMap}
                      overrideMap={overrideMap}
                      proficiencyMap={proficiencyMap}
                      subcraftMap={subcraftMap}
                      modes={modes}
                      selectedCrafts={selectedCrafts}
                      setModes={setModes}
                      setSelectedCrafts={setSelectedCrafts}
                      collapsedCraftIds={collapsedCraftIds}
                      toggleCollapsed={toggleCollapsed}
                      depth={depth + 1}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </RecipeCardShell>
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

function getPlannerMaterialUnitPrice(
  materialId: PlannerMaterialId,
  prices: PlannerPrices,
  materialPricing: MaterialPricingOptions,
): number {
  if (
    materialId === "radiantSynthiumStone" &&
    materialPricing.boundSynthiumForEpicPlus
  ) {
    return getBoundRadiantSynthiumStonePrice(prices);
  }
  if (
    materialId === "serendipityStone" &&
    materialPricing.serendipityStonePrice != null
  ) {
    return materialPricing.serendipityStonePrice;
  }
  return prices[materialId] ?? 0;
}

function buildPriceMap(
  prices: {
    itemId: number;
    avg24h: string | null;
    avg7d: string | null;
    avg30d: string | null;
  }[],
): PriceMap {
  const priceMap: PriceMap = new Map(
    prices.map((price) => [price.itemId, price]),
  );
  priceMap.set(COIN_ITEM_ID, {
    avg24h: String(COIN_GOLD_VALUE),
    avg7d: null,
    avg30d: null,
  });
  return priceMap;
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

function formatKind(kind: GearKind): string {
  return kind === "costume" ? "Costume" : "Undergarment";
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
