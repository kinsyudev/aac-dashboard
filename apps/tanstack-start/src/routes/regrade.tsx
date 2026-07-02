import type { inferProcedureOutput } from "@trpc/server";
import type {
  ConsumablePriceMap,
  GradeSaleValueMap,
  RegradeActionChoice,
} from "~/lib/regrade";
import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import type { AppRouter } from "@acme/api";
import { Badge } from "@acme/ui/badge";
import { Button } from "@acme/ui/button";
import { Input } from "@acme/ui/input";
import { Label } from "@acme/ui/label";

import type { ProficiencyMap } from "~/lib/proficiency";
import { ItemIcon } from "~/component/item-icon";
import { resolveTieredManaSealName } from "~/lib/mana-seal";
import { buildMetaTags, buildPageTitle } from "~/lib/metadata";
import { getDiscountedLabor } from "~/lib/proficiency";
import {
  MANA_SEAL_USE_LABOR,
  getObsidianT2Name,
  getObsidianT3Name,
  getSupportedRegradeItems,
  parseMagnificentVariant,
  regradeData,
  solveExpectedRegradeToTarget,
} from "~/lib/regrade";
import { variantsByTier } from "~/lib/salvage";
import {
  GLOWING_PROC_RATE,
  detectPieceAndTier,
  getEffectiveCraftSuccessRate,
} from "~/lib/simulator";
import {
  buildRecommendedModes,
  deepCraftCost,
  getCraftEntryUnitCost,
  getItemPrice,
  getMarketPrice,
  isForcedAuctionHouseMaterial,
  pickCheapestCraftForItem,
} from "~/lib/simulator-upgrade";
import { useTRPC } from "~/lib/trpc";
import { useUserData } from "~/lib/useUserData";

const TARGET_GRADES = [3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

type ForItemOutput = NonNullable<
  inferProcedureOutput<AppRouter["crafts"]["forItem"]>
>;
type PriceMap = Map<
  number,
  { avg24h: string | null; avg7d: string | null; avg30d: string | null }
>;
type OverrideMap = Map<number, number>;
type CraftMode = "buy" | "craft";
type CraftModeMap = Partial<Record<number, CraftMode>>;
type ItemSearchRow = inferProcedureOutput<AppRouter["items"]["byName"]>[number];

interface RecraftSummary {
  craft: ForItemOutput["crafts"][number];
  costGold: number;
  labor: number;
}

interface UpgradeStageSummary {
  itemId: number;
  itemName: string;
  craft: ForItemOutput["crafts"][number];
  costGold: number;
  labor: number;
}

interface UpgradeCostSummary {
  costGold: number;
  labor: number;
  stages: UpgradeStageSummary[];
  ayanadTargetName: string | null;
  ayanadRerollCostGold: number;
  ayanadRerollLabor: number;
}

export const Route = createFileRoute("/regrade")({
  head: () => ({
    meta: buildMetaTags({
      title: buildPageTitle("Regrade"),
      description:
        "Calculate regrade cost, expected value, and silver per labor for selected gear.",
    }),
  }),
  loader: async ({ context }) => {
    await context.queryClient.fetchQuery(
      context.trpc.auth.requireAdmin.queryOptions(),
    );
    await context.queryClient.fetchQuery(
      context.trpc.profile.getUserData.queryOptions(),
    );
  },
  component: RegradePage,
});

function RegradePage() {
  const trpc = useTRPC();
  const { overrideMap, proficiencyMap } = useUserData();
  const supportedItems = useMemo(() => getSupportedRegradeItems(), []);
  const [query, setQuery] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<number | null>(
    supportedItems[0]?.id ?? null,
  );
  const [saleValuesByGradeInput, setSaleValuesByGradeInput] = useState<
    Record<number, string>
  >({});
  const [selectedResultGrade, setSelectedResultGrade] = useState<number | null>(
    7,
  );
  const [glowingProcEnabled, setGlowingProcEnabled] = useState(false);
  const [ayanadTargetMode, setAyanadTargetMode] = useState<"specific" | "any">(
    "specific",
  );
  const [ayanadTargetItemId, setAyanadTargetItemId] = useState<number | null>(
    null,
  );

  const selectedItem =
    supportedItems.find((item) => item.id === selectedItemId) ??
    supportedItems[0] ??
    null;
  const filteredItems = supportedItems.filter((item) =>
    item.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const magnificentParts = useMemo(
    () =>
      selectedItem?.family === "magnificent"
        ? parseMagnificentVariant(selectedItem.name)
        : null,
    [selectedItem],
  );

  const consumableItemIds = useMemo(
    () => [
      ...regradeData.scrolls.map((scroll) => scroll.id),
      ...regradeData.charms.map((charm) => charm.id),
    ],
    [],
  );
  const { data: consumablePrices = [] } = useQuery(
    trpc.items.pricesBatch.queryOptions(consumableItemIds),
  );
  const consumablePriceMap = useMemo<ConsumablePriceMap>(() => {
    return new Map(
      consumablePrices.flatMap((price) => {
        const override = overrideMap.get(price.itemId);
        const resolved = override ?? getMarketPrice(price);
        return resolved > 0 ? [[price.itemId, resolved] as const] : [];
      }),
    );
  }, [consumablePrices, overrideMap]);

  const saleValuesByGrade = useMemo<GradeSaleValueMap>(() => {
    return new Map(
      Object.entries(saleValuesByGradeInput).flatMap(([grade, raw]) => {
        const value = Number.parseFloat(raw);
        return Number.isFinite(value) && value > 0
          ? [[Number(grade), value] as const]
          : [];
      }),
    );
  }, [saleValuesByGradeInput]);

  const baseCraftQuery = useQuery({
    ...trpc.crafts.forItem.queryOptions(selectedItem?.id ?? -1),
    enabled: selectedItem != null,
  });
  const baseCraftData = baseCraftQuery.data ?? null;

  const exactUpgradeNames = useMemo(() => {
    if (!selectedItem) return [] as string[];
    if (selectedItem.family === "obsidian-t1") {
      return [
        getObsidianT2Name(selectedItem.name),
        getObsidianT3Name(selectedItem.name),
      ].filter((name): name is string => !!name);
    }
    if (!magnificentParts) return [];
    return [
      `Epherium ${magnificentParts.prefix} ${magnificentParts.piece}`,
      `Delphinad ${magnificentParts.prefix} ${magnificentParts.piece}`,
    ];
  }, [magnificentParts, selectedItem]);

  const { data: exactUpgradeRows = [] } = useQuery({
    ...trpc.items.byExactNames.queryOptions(exactUpgradeNames),
    enabled: exactUpgradeNames.length > 0,
  });
  const exactUpgradeMap = useMemo(() => {
    return new Map(exactUpgradeRows.map((row) => [row.item.name, row.item]));
  }, [exactUpgradeRows]);

  const ayanadSearchPattern =
    selectedItem?.family === "magnificent" && magnificentParts
      ? `Ayanad%${magnificentParts.piece}`
      : "";
  const { data: ayanadSearchResults = [] } = useQuery({
    ...trpc.items.byName.queryOptions(ayanadSearchPattern),
    enabled: !!ayanadSearchPattern,
  });
  const ayanadCandidates = useMemo(() => {
    if (!selectedItem || !magnificentParts) return [] as ItemSearchRow[];
    const suffix = ` ${magnificentParts.piece}`.toLowerCase();
    return ayanadSearchResults.filter(
      (item) =>
        item.name.startsWith("Ayanad ") &&
        item.name.toLowerCase().endsWith(suffix),
    );
  }, [ayanadSearchResults, magnificentParts, selectedItem]);

  const effectiveAyanadTargetItemId =
    selectedItem?.family === "magnificent" &&
    ayanadCandidates.some((item) => item.id === ayanadTargetItemId)
      ? ayanadTargetItemId
      : (ayanadCandidates[0]?.id ?? null);

  const upgradeQueryItems = useMemo(() => {
    const items = [...exactUpgradeMap.values()];
    if (selectedItem?.family === "magnificent") {
      items.push(...ayanadCandidates);
    }
    return dedupeItemsById(items);
  }, [ayanadCandidates, exactUpgradeMap, selectedItem]);
  const upgradeCraftResults = useQueries({
    queries: upgradeQueryItems.map((item) => ({
      ...trpc.crafts.forItem.queryOptions(item.id),
      enabled: true,
    })),
  });
  const upgradeCraftDataByItemId = useMemo(() => {
    return new Map(
      upgradeQueryItems.flatMap((item, index) => {
        const data = upgradeCraftResults[index]?.data ?? null;
        return data ? [[item.id, data] as const] : [];
      }),
    );
  }, [upgradeCraftResults, upgradeQueryItems]);

  const ayanadTargetItem =
    ayanadCandidates.find((item) => item.id === effectiveAyanadTargetItemId) ??
    null;
  const ayanadSealName = useMemo(() => {
    if (!ayanadTargetItem) return null;
    const equip =
      detectPieceAndTier(ayanadTargetItem.name) ?? {
        tier: "ayanad" as const,
        category:
          selectedItem?.type === "accessory"
            ? "jewelry"
            : selectedItem?.type === "armor"
              ? "armor"
              : "weapon",
        piece: null,
        pieceToken: null,
      };
    return resolveTieredManaSealName("ayanad", {
      name: ayanadTargetItem.name,
      category: ayanadTargetItem.category,
      equip,
    });
  }, [ayanadTargetItem, selectedItem?.type]);
  const { data: ayanadSealRows = [] } = useQuery({
    ...trpc.items.byExactNames.queryOptions(ayanadSealName ? [ayanadSealName] : []),
    enabled: !!ayanadSealName,
  });
  const ayanadSealItem = ayanadSealRows[0]?.item ?? null;
  const ayanadSealCraftQuery = useQuery({
    ...trpc.crafts.forItem.queryOptions(ayanadSealItem?.id ?? -1),
    enabled: ayanadSealItem != null,
  });
  const ayanadSealCraftData = ayanadSealCraftQuery.data ?? null;

  const baseRecraft = useMemo<RecraftSummary | null>(() => {
    if (!selectedItem || !baseCraftData?.crafts.length) return null;

    const priceMap = buildPriceMap(baseCraftData.prices);
    const craft = pickCheapestCraftForItem(
      baseCraftData.crafts,
      selectedItem.id,
      {},
      priceMap,
      overrideMap,
      {},
    );
    const costGold = craft.materials.reduce((sum, { item, amount }) => {
      const materialPrice = getItemPrice(item.id, priceMap, overrideMap);
      if (materialPrice <= 0) return Number.NaN;
      return sum + materialPrice * amount;
    }, 0);
    if (!Number.isFinite(costGold)) return null;

    return {
      craft,
      costGold,
      labor: getDiscountedLabor(
        craft.craft.labor,
        craft.craft.proficiency,
        proficiencyMap,
      ),
    };
  }, [baseCraftData, overrideMap, proficiencyMap, selectedItem]);

  const upgradeCost = useMemo<UpgradeCostSummary | null>(() => {
    if (!selectedItem) return null;

    if (selectedItem.family === "obsidian-t1") {
      const t2 = getObsidianT2Name(selectedItem.name);
      const t3 = getObsidianT3Name(selectedItem.name);
      if (!t2 || !t3) return null;
      const t2Item = exactUpgradeMap.get(t2);
      const t3Item = exactUpgradeMap.get(t3);
      if (!t2Item || !t3Item) return null;

      const stage1 = resolveUpgradeStage({
        craftData: upgradeCraftDataByItemId.get(t2Item.id) ?? null,
        targetItemId: t2Item.id,
        targetItemName: t2Item.name,
        consumedItemId: selectedItem.id,
        overrideMap,
        proficiencyMap,
      });
      if (!stage1) return null;

      const stage2 = resolveUpgradeStage({
        craftData: upgradeCraftDataByItemId.get(t3Item.id) ?? null,
        targetItemId: t3Item.id,
        targetItemName: t3Item.name,
        consumedItemId: t2Item.id,
        overrideMap,
        proficiencyMap,
      });
      if (!stage2) return null;

      return {
        costGold: stage1.costGold + stage2.costGold,
        labor: stage1.labor + stage2.labor,
        stages: [stage1, stage2],
        ayanadTargetName: null,
        ayanadRerollCostGold: 0,
        ayanadRerollLabor: 0,
      };
    }

    if (!magnificentParts) return null;
    const epheriumName = `Epherium ${magnificentParts.prefix} ${magnificentParts.piece}`;
    const delphinadName = `Delphinad ${magnificentParts.prefix} ${magnificentParts.piece}`;
    const epheriumItem = exactUpgradeMap.get(epheriumName);
    const delphinadItem = exactUpgradeMap.get(delphinadName);
    if (!epheriumItem || !delphinadItem) return null;

    const stage1 = resolveUpgradeStage({
      craftData: upgradeCraftDataByItemId.get(epheriumItem.id) ?? null,
      targetItemId: epheriumItem.id,
      targetItemName: epheriumItem.name,
      consumedItemId: selectedItem.id,
      overrideMap,
      proficiencyMap,
    });
    if (!stage1) return null;

    const stage2 = resolveUpgradeStage({
      craftData: upgradeCraftDataByItemId.get(delphinadItem.id) ?? null,
      targetItemId: delphinadItem.id,
      targetItemName: delphinadItem.name,
      consumedItemId: epheriumItem.id,
      overrideMap,
      proficiencyMap,
    });
    if (!stage2) return null;

    const ayanadStageCandidates =
      ayanadTargetMode === "specific" && ayanadTargetItem
        ? [ayanadTargetItem]
        : ayanadCandidates;
    const ayanadStages = ayanadStageCandidates
      .map((item) =>
        resolveUpgradeStage({
          craftData: upgradeCraftDataByItemId.get(item.id) ?? null,
          targetItemId: item.id,
          targetItemName: item.name,
          consumedItemId: delphinadItem.id,
          overrideMap,
          proficiencyMap,
        }),
      )
      .filter((stage): stage is UpgradeStageSummary => stage != null);
    if (!ayanadStages.length) return null;

    const finalStage = ayanadStages.reduce((best, current) =>
      current.costGold < best.costGold ? current : best,
    );

    let ayanadRerollCostGold = 0;
    let ayanadRerollLabor = 0;
    if (ayanadTargetMode === "specific") {
      const sealSummary = resolveAyanadSealSummary({
        craftData: ayanadSealCraftData,
        itemId: ayanadSealItem?.id ?? null,
        overrideMap,
        proficiencyMap,
      });
      if (!sealSummary) return null;
      const procRate = glowingProcEnabled ? GLOWING_PROC_RATE : 0;
      const successRate = getEffectiveCraftSuccessRate(
        variantsByTier.ayanad,
        procRate,
      );
      const expectedFailedRerolls = Math.max(0, 1 / successRate - 1);
      ayanadRerollCostGold = sealSummary.costGold * expectedFailedRerolls;
      ayanadRerollLabor =
        (sealSummary.labor + MANA_SEAL_USE_LABOR) * expectedFailedRerolls;
    }

    return {
      costGold:
        stage1.costGold +
        stage2.costGold +
        finalStage.costGold +
        ayanadRerollCostGold,
      labor:
        stage1.labor + stage2.labor + finalStage.labor + ayanadRerollLabor,
      stages: [stage1, stage2, finalStage],
      ayanadTargetName: finalStage.itemName,
      ayanadRerollCostGold,
      ayanadRerollLabor,
    };
  }, [
    ayanadCandidates,
    ayanadSealCraftData,
    ayanadSealItem,
    ayanadTargetItem,
    ayanadTargetMode,
    exactUpgradeMap,
    glowingProcEnabled,
    magnificentParts,
    overrideMap,
    proficiencyMap,
    selectedItem,
    upgradeCraftDataByItemId,
  ]);

  const regradeResults = useMemo(() => {
    if (!selectedItem || !baseRecraft || !upgradeCost) return [];
    return TARGET_GRADES.map((targetGrade) =>
      solveExpectedRegradeToTarget({
        item: selectedItem,
        targetGrade,
        baseRecraftCostGold: baseRecraft.costGold,
        baseRecraftLabor: baseRecraft.labor,
        upgradeCostGold: upgradeCost.costGold,
        upgradeLabor: upgradeCost.labor,
        saleValuesByGrade,
        consumablePrices: consumablePriceMap,
        candidateCharmIds: regradeData.charms.map((charm) => charm.id),
      }),
    );
  }, [
    baseRecraft,
    consumablePriceMap,
    saleValuesByGrade,
    selectedItem,
    upgradeCost,
  ]);

  const effectiveSelectedResultGrade = regradeResults.some(
    (result) => result.targetGrade === selectedResultGrade,
  )
    ? selectedResultGrade
    : (regradeResults[0]?.targetGrade ?? null);
  const selectedResult =
    regradeResults.find(
      (result) => result.targetGrade === effectiveSelectedResultGrade,
    ) ??
    regradeResults[0] ??
    null;

  return (
    <main className="container py-10">
      <div className="mb-6 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Regrade</h1>
          <Badge variant="secondary">
            {supportedItems.length.toLocaleString()} bases
          </Badge>
          <Badge variant="outline">
            {consumablePriceMap.size.toLocaleString()} priced consumables
          </Badge>
        </div>
        <p className="text-muted-foreground max-w-3xl text-sm">
          Compare expected regrade cost, upgrade cost, EV, and silver per labor
          for Obsidian T1 and Magnificent gear.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="regrade-item-search">Base item</Label>
            <Input
              id="regrade-item-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search Obsidian Shield..."
            />
          </div>
          <div className="max-h-[560px] overflow-auto rounded-md border">
            {filteredItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedItemId(item.id)}
                className={`flex w-full items-center gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 ${
                  selectedItem?.id === item.id ? "bg-muted" : "hover:bg-muted/60"
                }`}
              >
                <ItemIcon icon={item.icon} name={item.name} size="sm" />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <span className="text-muted-foreground text-xs">
                  {item.family === "obsidian-t1" ? "Obsidian" : "Magnificent"}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="rounded-md border p-4">
          {selectedItem ? (
            <>
              <div className="flex items-center gap-3">
                <ItemIcon icon={selectedItem.icon} name={selectedItem.name} size="lg" />
                <div>
                  <h2 className="text-xl font-semibold">{selectedItem.name}</h2>
                  <p className="text-muted-foreground text-sm">
                    {selectedItem.type} · level {selectedItem.level} · slot{" "}
                    {selectedItem.slot}
                  </p>
                </div>
              </div>

              {selectedItem.family === "magnificent" ? (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant={ayanadTargetMode === "specific" ? "default" : "outline"}
                    onClick={() => setAyanadTargetMode("specific")}
                  >
                    Specific Ayanad
                  </Button>
                  <Button
                    type="button"
                    variant={ayanadTargetMode === "any" ? "default" : "outline"}
                    onClick={() => setAyanadTargetMode("any")}
                  >
                    Any Ayanad
                  </Button>
                  {ayanadTargetMode === "specific" ? (
                    <select
                      className="bg-background rounded-md border px-3 py-2 text-sm"
                      value={effectiveAyanadTargetItemId ?? ""}
                      onChange={(event) =>
                        setAyanadTargetItemId(Number(event.target.value) || null)
                      }
                    >
                      <option value="">Select target Ayanad</option>
                      {ayanadCandidates.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={glowingProcEnabled}
                      onChange={(event) =>
                        setGlowingProcEnabled(event.target.checked)
                      }
                    />
                    Glowing proc
                  </label>
                </div>
              ) : null}

              <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {TARGET_GRADES.map((grade) => (
                  <label key={grade} className="space-y-1 text-sm">
                    <span className="text-muted-foreground">
                      {regradeData.grades[grade]?.name ?? `Grade ${grade}`} sale value
                    </span>
                    <Input
                      inputMode="decimal"
                      value={saleValuesByGradeInput[grade] ?? ""}
                      onChange={(event) =>
                        setSaleValuesByGradeInput((current) => ({
                          ...current,
                          [grade]: event.target.value,
                        }))
                      }
                      placeholder="Gold"
                    />
                  </label>
                ))}
              </div>

              {!baseRecraft || !upgradeCost ? (
                <p className="text-muted-foreground mt-4 text-sm">
                  Missing craft or price data for this upgrade path.
                </p>
              ) : (
                <>
                  <div className="mt-6 grid gap-3 md:grid-cols-3">
                    <SummaryCard
                      label="Base recraft"
                      value={formatGold(baseRecraft.costGold)}
                      detail={`${baseRecraft.labor.toFixed(1)} labor`}
                    />
                    <SummaryCard
                      label="Upgrade chain"
                      value={formatGold(upgradeCost.costGold)}
                      detail={`${upgradeCost.labor.toFixed(1)} labor`}
                    />
                    <SummaryCard
                      label="Ayanad target"
                      value={upgradeCost.ayanadTargetName ?? "n/a"}
                      detail={
                        upgradeCost.ayanadRerollCostGold > 0
                          ? `${formatGold(upgradeCost.ayanadRerollCostGold)} rerolls`
                          : "No reroll cost"
                      }
                    />
                  </div>

                  <div className="mt-6 overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr className="text-left">
                          <th className="px-3 py-2">Target</th>
                          <th className="px-3 py-2">Expected cost</th>
                          <th className="px-3 py-2">Expected revenue</th>
                          <th className="px-3 py-2">EV</th>
                          <th className="px-3 py-2">Labor</th>
                          <th className="px-3 py-2">Silver/labor</th>
                          <th className="px-3 py-2">Strategy</th>
                        </tr>
                      </thead>
                      <tbody>
                        {regradeResults.map((result) => (
                          <tr
                            key={result.targetGrade}
                            className={`border-t ${
                              selectedResult?.targetGrade === result.targetGrade
                                ? "bg-muted/40"
                                : ""
                            }`}
                          >
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                className="font-medium hover:underline"
                                onClick={() => setSelectedResultGrade(result.targetGrade)}
                              >
                                {regradeData.grades[result.targetGrade]?.name ??
                                  `Grade ${result.targetGrade}`}
                              </button>
                            </td>
                            <td className="px-3 py-2">
                              {formatGold(result.expectedCostGold)}
                            </td>
                            <td className="px-3 py-2">
                              {formatGold(result.expectedRevenueGold)}
                            </td>
                            <td className="px-3 py-2">
                              {formatGold(result.expectedProfitGold)}
                            </td>
                            <td className="px-3 py-2">
                              {result.expectedLabor.toFixed(1)}
                            </td>
                            <td className="px-3 py-2">
                              {result.silverPerLabor.toFixed(2)}
                            </td>
                            <td className="px-3 py-2">
                              {formatStrategy(result.selectedSteps)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {selectedResult?.skippedReasons.length ? (
                    <div className="mt-4 rounded-md border border-dashed p-3">
                      <h3 className="text-sm font-medium">Skipped options</h3>
                      <ul className="text-muted-foreground mt-2 space-y-1 text-sm">
                        {selectedResult.skippedReasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {selectedResult ? (
                    <div className="mt-4 rounded-md border p-4">
                      <h3 className="text-sm font-medium">Selected steps</h3>
                      <div className="mt-3 space-y-2">
                        {selectedResult.selectedSteps.map((step) => (
                          <div
                            key={`${step.fromGrade}-${step.scroll.id}-${step.charm?.id ?? "none"}`}
                            className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                          >
                            <div>
                              <div className="font-medium">
                                {regradeData.grades[step.fromGrade]?.name ??
                                  `Grade ${step.fromGrade}`}
                              </div>
                              <div className="text-muted-foreground">
                                {step.scroll.name}
                                {step.charm ? ` + ${step.charm.name}` : ""}
                              </div>
                            </div>
                            <div className="text-right">
                              <div>{formatGold(step.attemptCostGold)}</div>
                              <div className="text-muted-foreground">
                                EV {formatGold(step.expectedValueGold)}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              No supported regrade item found.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-md border p-4">
      <div className="text-muted-foreground text-xs uppercase">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      {detail ? <div className="text-muted-foreground mt-1 text-sm">{detail}</div> : null}
    </div>
  );
}

function buildPriceMap(prices: ForItemOutput["prices"]): PriceMap {
  return new Map(prices.map((price) => [price.itemId, price]));
}

function dedupeItemsById<T extends { id: number }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function deepCraftLabor(
  itemId: number,
  subcraftMap: ForItemOutput["subcraftsByItemId"],
  priceMap: PriceMap,
  overrideMap: OverrideMap,
  proficiencyMap: ProficiencyMap,
  modes: CraftModeMap,
  visited = new Set<number>(),
): number {
  if (visited.has(itemId)) return 0;
  visited.add(itemId);

  const entries = subcraftMap[itemId];
  if (!entries?.length) return 0;

  const entry = pickCheapestCraftForItem(
    entries,
    itemId,
    subcraftMap,
    priceMap,
    overrideMap,
    modes,
  );
  const produced =
    entry.products.find((product) => product.item.id === itemId)?.amount ?? 1;

  let labor = getDiscountedLabor(
    entry.craft.labor,
    entry.craft.proficiency,
    proficiencyMap,
  );

  for (const { item, amount } of entry.materials) {
    const subEntries = subcraftMap[item.id];
    const mode = modes[item.id] ?? "craft";
    if (
      subEntries?.length &&
      mode === "craft" &&
      !isForcedAuctionHouseMaterial(item)
    ) {
      labor +=
        deepCraftLabor(
          item.id,
          subcraftMap,
          priceMap,
          overrideMap,
          proficiencyMap,
          modes,
          new Set(visited),
        ) * amount;
    }
  }

  return labor / produced;
}

function getChosenMaterialUnitCost(
  item: { id: number; name: string },
  subcraftMap: ForItemOutput["subcraftsByItemId"],
  priceMap: PriceMap,
  overrideMap: OverrideMap,
  modes: CraftModeMap,
) {
  const isCraftable = !!subcraftMap[item.id]?.length;
  const mode = modes[item.id] ?? "buy";
  if (isCraftable && mode === "craft" && !isForcedAuctionHouseMaterial(item)) {
    return deepCraftCost(item.id, subcraftMap, priceMap, overrideMap, modes);
  }
  return getItemPrice(item.id, priceMap, overrideMap);
}

function getChosenMaterialLabor(
  item: { id: number; name: string },
  subcraftMap: ForItemOutput["subcraftsByItemId"],
  priceMap: PriceMap,
  overrideMap: OverrideMap,
  proficiencyMap: ProficiencyMap,
  modes: CraftModeMap,
) {
  const isCraftable = !!subcraftMap[item.id]?.length;
  const mode = modes[item.id] ?? "buy";
  if (isCraftable && mode === "craft" && !isForcedAuctionHouseMaterial(item)) {
    return deepCraftLabor(
      item.id,
      subcraftMap,
      priceMap,
      overrideMap,
      proficiencyMap,
      modes,
    );
  }
  return 0;
}

function getSelectedCraftUnitLabor(
  entry: ForItemOutput["crafts"][number],
  itemId: number,
  subcraftMap: ForItemOutput["subcraftsByItemId"],
  priceMap: PriceMap,
  overrideMap: OverrideMap,
  proficiencyMap: ProficiencyMap,
  modes: CraftModeMap,
): number {
  const produced =
    entry.products.find((product) => product.item.id === itemId)?.amount ?? 1;

  const batchLabor =
    getDiscountedLabor(
      entry.craft.labor,
      entry.craft.proficiency,
      proficiencyMap,
    ) +
    entry.materials.reduce(
      (sum, { item, amount }) =>
        sum +
        getChosenMaterialLabor(
          item,
          subcraftMap,
          priceMap,
          overrideMap,
          proficiencyMap,
          modes,
        ) *
          amount,
      0,
    );

  return batchLabor / produced;
}

function resolveUpgradeStage(input: {
  craftData: ForItemOutput | null;
  targetItemId: number;
  targetItemName: string;
  consumedItemId: number;
  overrideMap: OverrideMap;
  proficiencyMap: ProficiencyMap;
}): UpgradeStageSummary | null {
  const { craftData, consumedItemId, overrideMap, proficiencyMap, targetItemId, targetItemName } =
    input;
  if (!craftData?.crafts.length) return null;

  const candidateCrafts = craftData.crafts.filter((entry) =>
    entry.materials.some(({ item }) => item.id === consumedItemId),
  );
  if (!candidateCrafts.length) return null;

  const priceMap = buildPriceMap(craftData.prices);
  const selectedCraft = pickCheapestCraftForItem(
    candidateCrafts,
    targetItemId,
    craftData.subcraftsByItemId,
    priceMap,
    overrideMap,
    {},
  );
  const filteredMaterials = selectedCraft.materials.filter(
    ({ item }) => item.id !== consumedItemId,
  );
  const modes = buildRecommendedModes(
    filteredMaterials,
    craftData.subcraftsByItemId,
    priceMap,
    overrideMap,
  );
  const costGold = filteredMaterials.reduce((sum, { item, amount }) => {
    const unitCost = getChosenMaterialUnitCost(
      item,
      craftData.subcraftsByItemId,
      priceMap,
      overrideMap,
      modes,
    );
    if (unitCost <= 0) return Number.NaN;
    return sum + unitCost * amount;
  }, 0);
  if (!Number.isFinite(costGold)) return null;

  const labor =
    getDiscountedLabor(
      selectedCraft.craft.labor,
      selectedCraft.craft.proficiency,
      proficiencyMap,
    ) +
    filteredMaterials.reduce(
      (sum, { item, amount }) =>
        sum +
        getChosenMaterialLabor(
          item,
          craftData.subcraftsByItemId,
          priceMap,
          overrideMap,
          proficiencyMap,
          modes,
        ) *
          amount,
      0,
    );

  return {
    itemId: targetItemId,
    itemName: targetItemName,
    craft: selectedCraft,
    costGold,
    labor,
  };
}

function resolveAyanadSealSummary(input: {
  craftData: ForItemOutput | null;
  itemId: number | null;
  overrideMap: OverrideMap;
  proficiencyMap: ProficiencyMap;
}) {
  const { craftData, itemId, overrideMap, proficiencyMap } = input;
  if (!craftData?.crafts.length || itemId == null) return null;
  const priceMap = buildPriceMap(craftData.prices);
  const craft = pickCheapestCraftForItem(
    craftData.crafts,
    itemId,
    craftData.subcraftsByItemId,
    priceMap,
    overrideMap,
    {},
  );
  const modes = buildRecommendedModes(
    craft.materials,
    craftData.subcraftsByItemId,
    priceMap,
    overrideMap,
  );
  const costGold = getCraftEntryUnitCost(
    craft,
    itemId,
    craftData.subcraftsByItemId,
    priceMap,
    overrideMap,
    modes,
  );
  if (!Number.isFinite(costGold) || costGold <= 0) return null;
  const labor = getSelectedCraftUnitLabor(
    craft,
    itemId,
    craftData.subcraftsByItemId,
    priceMap,
    overrideMap,
    proficiencyMap,
    modes,
  );
  return { costGold, labor };
}

function formatGold(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}g`;
}

function formatStrategy(steps: RegradeActionChoice[]): string {
  const first = steps[0];
  if (!first) return "n/a";
  return first.charm ? `${first.scroll.name} + charm` : first.scroll.name;
}
