import type { inferProcedureOutput } from "@trpc/server";
import type {
  ConsumableLaborMap,
  ConsumablePriceMap,
  GradeSaleValueMap,
  RegradeActionChoice,
  RegradeSearchState,
  SupportedRegradeItem,
} from "~/lib/regrade";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Info } from "lucide-react";

import type { AppRouter } from "@acme/api";
import { Badge } from "@acme/ui/badge";
import { Button } from "@acme/ui/button";
import { Input } from "@acme/ui/input";
import { Label } from "@acme/ui/label";
import { toast } from "@acme/ui/toast";

import type { ProficiencyMap } from "~/lib/proficiency";
import { ItemIcon } from "~/component/item-icon";
import {
  CraftModeToggle,
  RecipeCardShell,
  RecipeHeader,
  RecipeItemRow,
  RecipeLegend,
} from "~/component/recipe-breakdown";
import { resolveTieredManaSealName } from "~/lib/mana-seal";
import { buildMetaTags, buildPageTitle } from "~/lib/metadata";
import { getDiscountedLabor } from "~/lib/proficiency";
import {
  MANA_SEAL_USE_LABOR,
  RECRAFT_START_GRADE,
  getEffectiveSelectedRegradeTarget,
  getApplicableCharms,
  getMagnificentGearTypes,
  getMagnificentVariantNames,
  getObsidianT2Name,
  getObsidianT3Name,
  getSupportedRegradeItems,
  parseRegradeSearch,
  regradeData,
  serializeRegradeSearch,
  solveExpectedRegradeToTarget,
} from "~/lib/regrade";
import { variantsByTier } from "~/lib/salvage";
import { parsePriceOverrideInput } from "~/lib/simulator-price-override";
import {
  GLOWING_PROC_RATE,
  detectPieceAndTier,
  getEffectiveCraftSuccessRate,
} from "~/lib/simulator";
import {
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
type ForItemsOutput = inferProcedureOutput<AppRouter["crafts"]["forItems"]>;
type PriceMap = Map<
  number,
  { avg24h: string | null; avg7d: string | null; avg30d: string | null }
>;
type OverrideMap = Map<number, number>;
type CraftMode = "buy" | "craft";
type CraftModeMap = Partial<Record<number, CraftMode>>;
type ItemSearchRow = inferProcedureOutput<AppRouter["items"]["byName"]>[number];
type SubcraftMap = ForItemOutput["subcraftsByItemId"];
type SubcraftEntry = NonNullable<SubcraftMap[number]>[number];

const REGRADE_CRAFT_MODE_STORAGE_KEY = "regrade:craft-modes:v1";

interface RecraftSummary {
  craft: ForItemOutput["crafts"][number];
  costGold: number;
  labor: number;
}

interface UpgradeStageSummary {
  itemId: number;
  itemName: string;
  consumedItemId: number;
  consumedItemName: string;
  consumedItemCategory: string;
  craft: ForItemOutput["crafts"][number];
  costGold: number;
  labor: number;
}

interface RerollCostSummary {
  tier: "delphinad" | "ayanad";
  itemId: number;
  itemName: string;
  sealName: string;
  craft: ForItemOutput["crafts"][number];
  costGold: number;
  labor: number;
  expectedFailedRerolls: number;
  successRate: number;
}

interface UpgradeCostSummary {
  costGold: number;
  labor: number;
  stages: UpgradeStageSummary[];
  ayanadTargetName: string | null;
  rerolls: RerollCostSummary[];
  ayanadRerollCostGold: number;
  ayanadRerollLabor: number;
}

export const Route = createFileRoute("/regrade")({
  validateSearch: (search) =>
    serializeRegradeSearch(parseRegradeSearch(search)),
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
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: "/regrade" });
  const search = Route.useSearch();
  const regradeSearch = useMemo(() => parseRegradeSearch(search), [search]);
  const { overrideMap, proficiencyMap } = useUserData();
  const supportedItems = useMemo(() => getSupportedRegradeItems(), []);
  const obsidianItems = useMemo(
    () => supportedItems.filter((item) => item.family === "obsidian-t1"),
    [supportedItems],
  );
  const magnificentGearTypes = useMemo(() => getMagnificentGearTypes(), []);
  const selectedFamily = regradeSearch.family;
  const selectedMagnificentPiece =
    regradeSearch.piece ?? magnificentGearTypes[0]?.piece ?? null;
  const selectedObsidianItemId =
    regradeSearch.obsidianItemId ??
    obsidianItems.find((item) => item.name === "Obsidian Shield")?.id ??
    obsidianItems[0]?.id ??
    null;
  const selectedResultGrade = regradeSearch.selectedTargetGrade;
  const glowingProcEnabled = regradeSearch.glowingProcEnabled;
  const ayanadTargetMode = regradeSearch.ayanadTargetMode;
  const ayanadTargetItemId = regradeSearch.ayanadTargetItemId;
  const craftModeScope = [
    selectedFamily,
    selectedMagnificentPiece ?? selectedObsidianItemId ?? "none",
    ayanadTargetMode,
    ayanadTargetItemId ?? "any",
  ].join(":");
  const { modes: manualCraftModes, setCraftModePreference } =
    useRegradeCraftModePreferences(craftModeScope);
  const [collapsedCraftIds, setCollapsedCraftIds] = useState<Set<number>>(
    () => new Set(),
  );
  const setPriceOverride = useMutation(
    trpc.profile.setPriceOverride.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(
          trpc.profile.getUserData.pathFilter(),
        );
        toast.success("Price override saved.");
      },
      onError: () => toast.error("Failed to save price override."),
    }),
  );

  const toggleCollapsedCraft = useCallback((craftId: number) => {
    setCollapsedCraftIds((current) => {
      const next = new Set(current);
      if (next.has(craftId)) {
        next.delete(craftId);
      } else {
        next.add(craftId);
      }
      return next;
    });
  }, []);

  const updateRegradeSearch = useCallback(
    (patch: Partial<RegradeSearchState>) => {
      void navigate({
        replace: true,
        search: (previous) =>
          serializeRegradeSearch({
            ...parseRegradeSearch(previous),
            ...patch,
          }),
      });
    },
    [navigate],
  );

  const commitSaleValues = useCallback(
    (saleValuesByGradeInput: Record<number, string>) => {
      updateRegradeSearch({ saleValuesByGradeInput });
    },
    [updateRegradeSearch],
  );
  const commitSelectedSaleGrades = useCallback(
    (selectedSaleGrades: number[]) => {
      updateRegradeSearch({ selectedSaleGrades });
    },
    [updateRegradeSearch],
  );

  const selectedMagnificentType =
    magnificentGearTypes.find((type) => type.piece === selectedMagnificentPiece) ??
    magnificentGearTypes[0] ??
    null;
  const selectedObsidianItem =
    obsidianItems.find((item) => item.id === selectedObsidianItemId) ??
    obsidianItems[0] ??
    null;
  const selectedItem: SupportedRegradeItem | null =
    selectedFamily === "magnificent"
      ? selectedMagnificentType
        ? { ...selectedMagnificentType.representativeItem, family: "magnificent" }
        : null
      : selectedObsidianItem;
  const selectedDisplayName =
    selectedFamily === "magnificent"
      ? (selectedMagnificentType?.displayName ?? "Magnificent")
      : (selectedItem?.name ?? "Obsidian");

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

  const saleValuesByGrade = useMemo<GradeSaleValueMap>(() => {
    const selectedSaleGrades = new Set(regradeSearch.selectedSaleGrades);
    return new Map(
      Object.entries(regradeSearch.saleValuesByGradeInput).flatMap(
        ([grade, raw]) => {
          if (!selectedSaleGrades.has(Number(grade))) return [];
          const value = Number.parseFloat(raw);
          return Number.isFinite(value) && value > 0
            ? [[Number(grade), value] as const]
            : [];
        },
      ),
    );
  }, [regradeSearch.saleValuesByGradeInput, regradeSearch.selectedSaleGrades]);

  const exactUpgradeNames = useMemo(() => {
    if (!selectedItem) return [] as string[];
    if (selectedItem.family === "obsidian-t1") {
      return [
        getObsidianT2Name(selectedItem.name),
        getObsidianT3Name(selectedItem.name),
      ].filter((name): name is string => !!name);
    }
    if (!selectedMagnificentType) return [];
    return [
      selectedMagnificentType.sealedUpgradeNames.epherium,
      selectedMagnificentType.sealedUpgradeNames.delphinad,
      selectedMagnificentType.sealedUpgradeNames.ayanad,
      ...getMagnificentVariantNames(selectedMagnificentType.piece, "Magnificent"),
      ...getMagnificentVariantNames(selectedMagnificentType.piece, "Epherium"),
      ...getMagnificentVariantNames(selectedMagnificentType.piece, "Delphinad"),
    ];
  }, [selectedItem, selectedMagnificentType]);

  const exactUpgradeQuery = useQuery({
    ...trpc.items.byExactNames.queryOptions(exactUpgradeNames),
    enabled: exactUpgradeNames.length > 0,
  });
  const exactUpgradeRows = exactUpgradeQuery.data ?? [];
  const exactUpgradeMap = useMemo(() => {
    return new Map(exactUpgradeRows.map((row) => [row.item.name, row.item]));
  }, [exactUpgradeRows]);

  const ayanadSearchPattern =
    selectedItem?.family === "magnificent" && selectedMagnificentType
      ? `Ayanad%${selectedMagnificentType.piece}`
      : "";
  const ayanadSearchQuery = useQuery({
    ...trpc.items.byName.queryOptions(ayanadSearchPattern),
    enabled: !!ayanadSearchPattern,
  });
  const ayanadSearchResults = ayanadSearchQuery.data ?? [];
  const ayanadCandidates = useMemo(() => {
    if (!selectedItem || !selectedMagnificentType) return [] as ItemSearchRow[];
    const suffix = ` ${selectedMagnificentType.piece}`.toLowerCase();
    return ayanadSearchResults.filter(
      (item) =>
        item.name.startsWith("Ayanad ") &&
        item.name.toLowerCase().endsWith(suffix),
    );
  }, [ayanadSearchResults, selectedMagnificentType, selectedItem]);

  const effectiveAyanadTargetItemId =
    selectedItem?.family === "magnificent" &&
    ayanadCandidates.some((item) => item.id === ayanadTargetItemId)
      ? ayanadTargetItemId
      : (ayanadCandidates[0]?.id ?? null);

  const upgradeQueryItems = useMemo(() => {
    if (selectedItem?.family === "magnificent" && selectedMagnificentType) {
      return dedupeItemsById(
        [
          selectedMagnificentType.sealedUpgradeNames.epherium,
          selectedMagnificentType.sealedUpgradeNames.delphinad,
          selectedMagnificentType.sealedUpgradeNames.ayanad,
        ].flatMap((name) => {
          const item = exactUpgradeMap.get(name);
          return item ? [item] : [];
        }),
      );
    }
    return dedupeItemsById([...exactUpgradeMap.values()]);
  }, [exactUpgradeMap, selectedItem, selectedMagnificentType]);
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
  const ayanadSealQuery = useQuery({
    ...trpc.items.byExactNames.queryOptions(ayanadSealName ? [ayanadSealName] : []),
    enabled: !!ayanadSealName,
  });
  const ayanadSealRows = ayanadSealQuery.data ?? [];
  const ayanadSealItem = ayanadSealRows[0]?.item ?? null;
  const delphinadSealNames = useMemo(() => {
    if (!selectedMagnificentType) return [] as string[];
    return [
      ...new Set(
        getMagnificentVariantNames(selectedMagnificentType.piece, "Delphinad")
          .flatMap((name) => {
            const item = exactUpgradeMap.get(name);
            if (!item) return [];
            const equip = detectPieceAndTier(item.name);
            if (!equip) return [];
            const sealName = resolveTieredManaSealName("delphinad", {
              name: item.name,
              category: item.category,
              equip,
            });
            return sealName ? [sealName] : [];
          }),
      ),
    ];
  }, [exactUpgradeMap, selectedMagnificentType]);
  const delphinadSealQuery = useQuery({
    ...trpc.items.byExactNames.queryOptions(delphinadSealNames),
    enabled: delphinadSealNames.length > 0,
  });
  const delphinadSealRows = delphinadSealQuery.data ?? [];
  const delphinadSealItemsByName = useMemo(() => {
    return new Map(delphinadSealRows.map((row) => [row.item.name, row.item]));
  }, [delphinadSealRows]);
  const craftedConsumableItemIds = useMemo(
    () =>
      consumableItemIds.filter(
        (itemId) => (manualCraftModes[itemId] ?? "buy") === "craft",
      ),
    [consumableItemIds, manualCraftModes],
  );
  const craftDataItemIds = useMemo(
    () =>
      [
        ...new Set(
          [
            ...craftedConsumableItemIds,
            selectedItem?.id,
            ...upgradeQueryItems.map((item) => item.id),
            ayanadSealItem?.id,
            ...delphinadSealRows.map((row) => row.item.id),
          ].filter((id): id is number => Number.isInteger(id)),
        ),
      ],
    [
      ayanadSealItem,
      craftedConsumableItemIds,
      delphinadSealRows,
      selectedItem,
      upgradeQueryItems,
    ],
  );
  const craftDataDependenciesReady =
    !exactUpgradeQuery.isFetching &&
    !ayanadSearchQuery.isFetching &&
    !ayanadSealQuery.isFetching &&
    !delphinadSealQuery.isFetching;
  const { data: craftDataByItemIdOutput = {} } = useQuery({
    ...trpc.crafts.forItems.queryOptions(craftDataItemIds),
    enabled: craftDataItemIds.length > 0 && craftDataDependenciesReady,
    staleTime: 5 * 60 * 1000,
  });
  const craftDataByItemId = useMemo(() => {
    const data = craftDataByItemIdOutput as ForItemsOutput;
    return new Map(
      Object.entries(data).flatMap(([itemId, craftData]) =>
        craftData ? [[Number(itemId), craftData] as const] : [],
      ),
    );
  }, [craftDataByItemIdOutput]);
  const baseCraftData =
    selectedItem != null
      ? (craftDataByItemId.get(selectedItem.id) ?? null)
      : null;
  const ayanadSealCraftData =
    ayanadSealItem != null
      ? (craftDataByItemId.get(ayanadSealItem.id) ?? null)
      : null;
  const upgradeCraftDataByItemId = craftDataByItemId;
  const delphinadSealCraftDataByItemId = craftDataByItemId;
  const consumableCraftDataByItemId = craftDataByItemId;

  const consumablePriceMap = useMemo<ConsumablePriceMap>(() => {
    return new Map(
      consumablePrices.flatMap((price) => {
        const override = overrideMap.get(price.itemId);
        const buyPrice = override ?? getMarketPrice(price);
        const craftData = consumableCraftDataByItemId.get(price.itemId);
        const resolved =
          (manualCraftModes[price.itemId] ?? "buy") === "craft" && craftData
            ? getConsumableCraftUnitCost(
                price.itemId,
                craftData,
                overrideMap,
                manualCraftModes,
              )
            : buyPrice;
        return resolved > 0 ? [[price.itemId, resolved] as const] : [];
      }),
    );
  }, [
    consumableCraftDataByItemId,
    consumablePrices,
    manualCraftModes,
    overrideMap,
  ]);
  const consumableLaborMap = useMemo<ConsumableLaborMap>(() => {
    return new Map(
      consumableItemIds.flatMap((itemId) => {
        const craftData = consumableCraftDataByItemId.get(itemId);
        if ((manualCraftModes[itemId] ?? "buy") !== "craft" || !craftData) {
          return [];
        }
        const labor = getConsumableCraftUnitLabor(
          itemId,
          craftData,
          overrideMap,
          proficiencyMap,
          manualCraftModes,
        );
        return labor > 0 ? [[itemId, labor] as const] : [];
      }),
    );
  }, [
    consumableCraftDataByItemId,
    consumableItemIds,
    manualCraftModes,
    overrideMap,
    proficiencyMap,
  ]);

  const baseRecraft = useMemo<RecraftSummary | null>(() => {
    if (!selectedItem || !baseCraftData?.crafts.length) return null;

    const priceMap = buildPriceMap(baseCraftData.prices);
    const defaultBuyModes = getDefaultBuyCraftModes(
      baseCraftData.subcraftsByItemId,
      manualCraftModes,
    );
    const craft = pickCheapestCraftForItem(
      baseCraftData.crafts,
      selectedItem.id,
      baseCraftData.subcraftsByItemId,
      priceMap,
      overrideMap,
      defaultBuyModes,
    );
    const modes = getEffectiveCraftModes(
      craft.materials,
      baseCraftData.subcraftsByItemId,
      priceMap,
      overrideMap,
      defaultBuyModes,
    );
    const costGold = getCraftEntryUnitCost(
      craft,
      selectedItem.id,
      baseCraftData.subcraftsByItemId,
      priceMap,
      overrideMap,
      modes,
    );
    if (!Number.isFinite(costGold)) return null;

    return {
      craft,
      costGold,
      labor: getSelectedCraftUnitLabor(
        craft,
        selectedItem.id,
        baseCraftData.subcraftsByItemId,
        priceMap,
        overrideMap,
        proficiencyMap,
        modes,
      ),
    };
  }, [
    baseCraftData,
    manualCraftModes,
    overrideMap,
    proficiencyMap,
    selectedItem,
  ]);

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
        manualCraftModes,
        overrideMap,
        proficiencyMap,
      });
      if (!stage1) return null;

      const stage2 = resolveUpgradeStage({
        craftData: upgradeCraftDataByItemId.get(t3Item.id) ?? null,
        targetItemId: t3Item.id,
        targetItemName: t3Item.name,
        consumedItemId: t2Item.id,
        manualCraftModes,
        overrideMap,
        proficiencyMap,
      });
      if (!stage2) return null;

      return {
        costGold: stage1.costGold + stage2.costGold,
        labor: stage1.labor + stage2.labor,
        stages: [stage1, stage2],
        ayanadTargetName: null,
        rerolls: [],
        ayanadRerollCostGold: 0,
        ayanadRerollLabor: 0,
      };
    }

    if (!selectedMagnificentType) return null;
    const sealedNames = selectedMagnificentType.sealedUpgradeNames;
    const epheriumItem = exactUpgradeMap.get(sealedNames.epherium);
    const delphinadItem = exactUpgradeMap.get(sealedNames.delphinad);
    const ayanadItem = exactUpgradeMap.get(sealedNames.ayanad);
    if (!epheriumItem || !delphinadItem || !ayanadItem) return null;

    const magnificentConsumedIds = getExistingItemIds(
      getMagnificentVariantNames(selectedMagnificentType.piece, "Magnificent"),
      exactUpgradeMap,
    );
    const epheriumConsumedIds = getExistingItemIds(
      getMagnificentVariantNames(selectedMagnificentType.piece, "Epherium"),
      exactUpgradeMap,
    );
    const delphinadConsumedIds = getExistingItemIds(
      getMagnificentVariantNames(selectedMagnificentType.piece, "Delphinad"),
      exactUpgradeMap,
    );

    const stage1 = resolveUpgradeStage({
      craftData: upgradeCraftDataByItemId.get(epheriumItem.id) ?? null,
      targetItemId: epheriumItem.id,
      targetItemName: epheriumItem.name,
      consumedItemIds: magnificentConsumedIds,
      manualCraftModes,
      overrideMap,
      proficiencyMap,
    });
    if (!stage1) return null;

    const stage2 = resolveUpgradeStage({
      craftData: upgradeCraftDataByItemId.get(delphinadItem.id) ?? null,
      targetItemId: delphinadItem.id,
      targetItemName: delphinadItem.name,
      consumedItemIds: epheriumConsumedIds,
      manualCraftModes,
      overrideMap,
      proficiencyMap,
    });
    if (!stage2) return null;

    const finalStage = resolveUpgradeStage({
      craftData: upgradeCraftDataByItemId.get(ayanadItem.id) ?? null,
      targetItemId: ayanadItem.id,
      targetItemName: ayanadItem.name,
      consumedItemIds: delphinadConsumedIds,
      manualCraftModes,
      overrideMap,
      proficiencyMap,
    });
    if (!finalStage) return null;

    const delphinadReroll = resolveIntermediateRerollCost({
      tier: "delphinad",
      itemName: finalStage.consumedItemName,
      itemCategory: finalStage.consumedItemCategory,
      sealItemsByName: delphinadSealItemsByName,
      sealCraftDataByItemId: delphinadSealCraftDataByItemId,
      glowingProcEnabled,
      manualCraftModes,
      overrideMap,
      proficiencyMap,
    });
    if (!delphinadReroll) return null;

    let ayanadRerollCostGold = 0;
    let ayanadRerollLabor = 0;
    const rerolls: RerollCostSummary[] = [delphinadReroll];
    if (ayanadTargetMode === "specific") {
      const sealSummary = resolveAyanadSealSummary({
        craftData: ayanadSealCraftData,
        itemId: ayanadSealItem?.id ?? null,
        manualCraftModes,
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
      if (ayanadSealName && ayanadSealItem) {
        rerolls.push({
          tier: "ayanad",
          itemId: ayanadSealItem.id,
          itemName: ayanadSealItem.name,
          sealName: ayanadSealName,
          craft: sealSummary.craft,
          costGold: ayanadRerollCostGold,
          labor: ayanadRerollLabor,
          expectedFailedRerolls,
          successRate,
        });
      }
    }

    return {
      costGold:
        stage1.costGold +
        stage2.costGold +
        finalStage.costGold +
        delphinadReroll.costGold +
        ayanadRerollCostGold,
      labor:
        stage1.labor +
        stage2.labor +
        finalStage.labor +
        delphinadReroll.labor +
        ayanadRerollLabor,
      stages: [stage1, stage2, finalStage],
      ayanadTargetName:
        ayanadTargetMode === "specific" && ayanadTargetItem
          ? ayanadTargetItem.name
          : finalStage.itemName,
      rerolls,
      ayanadRerollCostGold,
      ayanadRerollLabor,
    };
  }, [
    ayanadSealCraftData,
    ayanadSealItem,
    ayanadSealName,
    ayanadTargetItem,
    ayanadTargetMode,
    delphinadSealCraftDataByItemId,
    delphinadSealItemsByName,
    exactUpgradeMap,
    glowingProcEnabled,
    manualCraftModes,
    overrideMap,
    proficiencyMap,
    selectedMagnificentType,
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
        consumableLabor: consumableLaborMap,
        candidateCharmIds: regradeData.charms.map((charm) => charm.id),
      }),
    );
  }, [
    baseRecraft,
    consumableLaborMap,
    consumablePriceMap,
    saleValuesByGrade,
    selectedItem,
    upgradeCost,
  ]);

  const effectiveSelectedResultGrade = getEffectiveSelectedRegradeTarget(
    regradeResults,
    selectedResultGrade,
  );
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
          <div className="flex gap-2">
            <Button
              type="button"
              className="flex-1"
              variant={selectedFamily === "magnificent" ? "default" : "outline"}
              onClick={() => updateRegradeSearch({ family: "magnificent" })}
            >
              Magnificent
            </Button>
            <Button
              type="button"
              className="flex-1"
              variant={selectedFamily === "obsidian-t1" ? "default" : "outline"}
              onClick={() => updateRegradeSearch({ family: "obsidian-t1" })}
            >
              Obsidian T1
            </Button>
          </div>

          {selectedFamily === "magnificent" ? (
            <div className="space-y-2">
              <Label htmlFor="regrade-magnificent-piece">Gear type</Label>
              <select
                id="regrade-magnificent-piece"
                className="bg-background w-full rounded-md border px-3 py-2 text-sm"
                value={selectedMagnificentType?.piece ?? ""}
                onChange={(event) =>
                  updateRegradeSearch({ piece: event.target.value })
                }
              >
                {magnificentGearTypes.map((type) => (
                  <option key={type.piece} value={type.piece}>
                    {type.piece}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="max-h-[560px] overflow-auto rounded-md border">
              {obsidianItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => updateRegradeSearch({ obsidianItemId: item.id })}
                  className={`flex w-full items-center gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 ${
                    selectedItem?.id === item.id ? "bg-muted" : "hover:bg-muted/60"
                  }`}
                >
                  <ItemIcon icon={item.icon} name={item.name} size="sm" />
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                </button>
              ))}
            </div>
          )}

          {baseRecraft && upgradeCost && baseCraftData ? (
            <RegradeMaterialsSection
              selectedItem={selectedItem}
              selectedTargetGrade={selectedResult?.targetGrade ?? null}
              baseRecraft={baseRecraft}
              baseCraftData={baseCraftData}
              upgradeCost={upgradeCost}
              selectedSteps={selectedResult?.selectedSteps ?? []}
              consumablePriceMap={consumablePriceMap}
              consumableLaborMap={consumableLaborMap}
              consumableCraftDataByItemId={consumableCraftDataByItemId}
              upgradeCraftDataByItemId={upgradeCraftDataByItemId}
              delphinadSealCraftDataByItemId={delphinadSealCraftDataByItemId}
              ayanadSealCraftData={ayanadSealCraftData}
              overrideMap={overrideMap}
              proficiencyMap={proficiencyMap}
              manualCraftModes={manualCraftModes}
              setCraftMode={setCraftModePreference}
              onSavePriceOverride={(itemId, price) =>
                setPriceOverride.mutate({ itemId, price })
              }
              collapsedCraftIds={collapsedCraftIds}
              toggleCollapsed={toggleCollapsedCraft}
            />
          ) : null}
        </aside>

        <section className="rounded-md border p-4">
          {selectedItem ? (
            <>
              <div className="flex items-center gap-3">
                <ItemIcon
                  icon={selectedItem.icon}
                  name={selectedDisplayName}
                  size="lg"
                />
                <div>
                  <h2 className="text-xl font-semibold">{selectedDisplayName}</h2>
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
                    onClick={() =>
                      updateRegradeSearch({ ayanadTargetMode: "specific" })
                    }
                  >
                    Specific Ayanad
                  </Button>
                  <Button
                    type="button"
                    variant={ayanadTargetMode === "any" ? "default" : "outline"}
                    onClick={() => updateRegradeSearch({ ayanadTargetMode: "any" })}
                  >
                    Any Ayanad
                  </Button>
                  <InfoTooltip text="Specific Ayanad values a named Ayanad variant and adds expected Ayanad mana-seal failures. Any Ayanad stops at Sealed Ayanad, but the chain still includes expected Delphinad rerolls needed to craft Sealed Ayanad." />
                  {ayanadTargetMode === "specific" ? (
                    <select
                      className="bg-background rounded-md border px-3 py-2 text-sm"
                      value={effectiveAyanadTargetItemId ?? ""}
                      onChange={(event) =>
                        updateRegradeSearch({
                          ayanadTargetItemId: Number(event.target.value) || null,
                        })
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
                        updateRegradeSearch({
                          glowingProcEnabled: event.target.checked,
                        })
                      }
                    />
                    Glowing proc
                    <InfoTooltip text="Adds the configured glowing proc chance to mana-seal variant rolls. This affects expected Delphinad and Ayanad reroll counts." />
                  </label>
                </div>
              ) : null}

              <SaleValueInputs
                values={regradeSearch.saleValuesByGradeInput}
                selectedGrades={regradeSearch.selectedSaleGrades}
                onCommit={commitSaleValues}
                onSelectedGradesChange={commitSelectedSaleGrades}
              />

              {!baseRecraft || !upgradeCost ? (
                <p className="text-muted-foreground mt-4 text-sm">
                  Missing craft or price data for this upgrade path.
                </p>
              ) : (
                <>
                  {selectedItem.family === "magnificent" && selectedMagnificentType ? (
                    <div className="mt-6 rounded-md border p-3 text-sm">
                      <div className="text-muted-foreground flex items-center gap-1.5 text-xs uppercase">
                        <span>Resolved chain</span>
                        <InfoTooltip text="The abstract Magnificent gear type is resolved to the sealed upgrade chain used for costing. Intermediate revealed variants are selected from the craft recipes that produce the next sealed tier." />
                      </div>
                      <div className="mt-1 font-medium">
                        {selectedMagnificentType.displayName} -{" "}
                        {selectedMagnificentType.sealedUpgradeNames.epherium} -{" "}
                        {selectedMagnificentType.sealedUpgradeNames.delphinad} -{" "}
                        {selectedMagnificentType.sealedUpgradeNames.ayanad}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-6 grid gap-3 md:grid-cols-3">
                    <SummaryCard
                      label="Base recraft"
                      value={formatGold(baseRecraft.costGold)}
                      detail={`${baseRecraft.labor.toFixed(1)} labor`}
                      helpText="Cost to craft the selected base item again after a destructive regrade failure. This uses the cheapest known craft materials and your labor discounts."
                    />
                    <SummaryCard
                      label="Upgrade chain"
                      value={formatGold(upgradeCost.costGold)}
                      detail={`${upgradeCost.labor.toFixed(1)} labor`}
                      helpText="One-time cost added when a regrade lands on the target grade: base-to-upgrade crafts plus required variant rerolls. For Magnificent gear this includes sealed Epherium, sealed Delphinad, sealed Ayanad, and Delphinad/Ayanad mana-seal reroll costs when applicable."
                    />
                    <SummaryCard
                      label="Ayanad target"
                      value={upgradeCost.ayanadTargetName ?? "n/a"}
                      detail={
                        upgradeCost.rerolls.length
                          ? `${upgradeCost.rerolls.length} reroll stage${upgradeCost.rerolls.length === 1 ? "" : "s"} included`
                          : "No reroll cost"
                      }
                      helpText="The Ayanad result being valued. Any Ayanad stops at the sealed Ayanad item. Specific Ayanad also adds expected Ayanad mana-seal failures. The chain always includes expected Delphinad variant rerolls when a specific Delphinad variant is needed for sealed Ayanad."
                    />
                  </div>

                  <UpgradeCostBreakdown upgradeCost={upgradeCost} />

                  <div className="mt-6 overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr className="text-left">
                          <TableHeader
                            label="Target"
                            helpText="Grade you are trying to reach before selling or stopping. Click a target row to inspect the selected policy steps for that target."
                          />
                          <TableHeader
                            label="Expected cost"
                            helpText="Expected gold spent from Grand to this target, including regrade scrolls, charms, fees, destructive base recrafts, and the upgrade-chain cost once the target grade is reached."
                          />
                          <TableHeader
                            label="Expected revenue"
                            helpText="Expected sale value after reaching the target. Great successes can overshoot into higher selected sale tiers, so this can differ from the exact target tier sale value."
                          />
                          <TableHeader
                            label="EV"
                            helpText="Expected value: expected revenue minus expected cost. Positive means the modeled strategy is profitable before any market risk or sale fees not entered here."
                          />
                          <TableHeader
                            label="Labor"
                            helpText="Expected labor consumed by regrade retries, destructive recrafts, upgrade crafts, and included mana-seal rerolls."
                          />
                          <TableHeader
                            label="Silver/labor"
                            helpText="EV converted to silver and divided by expected labor. This is EV * 100 / labor."
                          />
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
                                onClick={() =>
                                  updateRegradeSearch({
                                    selectedTargetGrade: result.targetGrade,
                                  })
                                }
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
                      <div className="flex items-center gap-1.5">
                        <h3 className="text-sm font-medium">Selected steps</h3>
                        <InfoTooltip text="Best action selected at each grade along the normal-success path for the clicked target. EV shown on each step is the solved expected value from that grade onward, including retries, downgrades, breaks, recrafts, and sale outcomes." />
                      </div>
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
                              {step.attemptLabor > 0 ? (
                                <div className="text-muted-foreground">
                                  {step.attemptLabor.toLocaleString(undefined, {
                                    maximumFractionDigits: 1,
                                  })}{" "}
                                  craft labor
                                </div>
                              ) : null}
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
  helpText,
}: {
  label: string;
  value: string;
  detail?: string;
  helpText?: string;
}) {
  return (
    <div className="rounded-md border p-4">
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs uppercase">
        <span>{label}</span>
        {helpText ? <InfoTooltip text={helpText} /> : null}
      </div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      {detail ? <div className="text-muted-foreground mt-1 text-sm">{detail}</div> : null}
    </div>
  );
}

function UpgradeCostBreakdown({
  upgradeCost,
}: {
  upgradeCost: UpgradeCostSummary;
}) {
  const stageCostGold = upgradeCost.stages.reduce(
    (sum, stage) => sum + stage.costGold,
    0,
  );
  const stageLabor = upgradeCost.stages.reduce(
    (sum, stage) => sum + stage.labor,
    0,
  );
  const rerollCostGold = sumRerollCost(upgradeCost.rerolls);
  const rerollLabor = upgradeCost.rerolls.reduce(
    (sum, reroll) => sum + reroll.labor,
    0,
  );

  return (
    <div className="mt-4 rounded-md border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-medium">Upgrade cost breakdown</h3>
          <InfoTooltip text="Fixed cost added when the regrade target is reached. Craft stages are deterministic recipe costs. Reroll stages are expected mana-seal failures needed to hit the required variant." />
        </div>
        <div className="text-muted-foreground text-sm">
          {formatGold(upgradeCost.costGold)} · {upgradeCost.labor.toFixed(1)} labor
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <div className="text-muted-foreground text-xs uppercase">
            Craft stages
          </div>
          <div className="mt-2 divide-y rounded-md border">
            {upgradeCost.stages.map((stage) => (
              <div
                key={stage.itemId}
                className="flex flex-wrap items-start justify-between gap-3 px-3 py-2 text-sm"
              >
                <div>
                  <div className="font-medium">{stage.itemName}</div>
                  <div className="text-muted-foreground">
                    consumes {stage.consumedItemName}
                  </div>
                </div>
                <div className="text-right">
                  <div>{formatGold(stage.costGold)}</div>
                  <div className="text-muted-foreground">
                    {stage.labor.toFixed(1)} labor
                  </div>
                </div>
              </div>
            ))}
            <div className="bg-muted/30 flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm font-medium">
              <span>Craft subtotal</span>
              <span>
                {formatGold(stageCostGold)} · {stageLabor.toFixed(1)} labor
              </span>
            </div>
          </div>
        </div>

        <div>
          <div className="text-muted-foreground text-xs uppercase">
            Reroll stages
          </div>
          <div className="mt-2 divide-y rounded-md border">
            {upgradeCost.rerolls.length ? (
              upgradeCost.rerolls.map((reroll) => (
                <div key={reroll.tier} className="px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">
                        {formatTierName(reroll.tier)} rerolls
                      </div>
                      <div className="text-muted-foreground">
                        {reroll.sealName}
                      </div>
                    </div>
                    <div className="text-right">
                      <div>{formatGold(reroll.costGold)}</div>
                      <div className="text-muted-foreground">
                        {reroll.labor.toFixed(1)} labor
                      </div>
                    </div>
                  </div>
                  <div className="text-muted-foreground mt-2 grid gap-1 text-xs sm:grid-cols-2">
                    <div>
                      Expected rerolls:{" "}
                      {reroll.expectedFailedRerolls.toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })}
                    </div>
                    <div>
                      Success chance: {formatPercent(reroll.successRate)}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-muted-foreground px-3 py-2 text-sm">
                No rerolls included.
              </div>
            )}
            <div className="bg-muted/30 flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm font-medium">
              <span>Reroll subtotal</span>
              <span>
                {formatGold(rerollCostGold)} · {rerollLabor.toFixed(1)} labor
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TableHeader({
  label,
  helpText,
}: {
  label: string;
  helpText: string;
}) {
  return (
    <th className="px-3 py-2">
      <span className="flex items-center gap-1.5">
        {label}
        <InfoTooltip text={helpText} placement="bottom" />
      </span>
    </th>
  );
}

function InfoTooltip({
  text,
  placement = "top",
}: {
  text: string;
  placement?: "top" | "bottom";
}) {
  const placementClass =
    placement === "bottom" ? "top-full mt-2" : "bottom-full mb-2";

  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={text}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 rounded-full outline-none focus-visible:ring-[3px]"
      >
        <Info className="size-3.5" aria-hidden="true" />
      </button>
      <span
        className={`bg-popover text-popover-foreground pointer-events-none absolute left-1/2 z-20 hidden w-72 -translate-x-1/2 rounded-md border px-3 py-2 text-xs leading-relaxed normal-case shadow-md group-focus-within:block group-hover:block ${placementClass}`}
      >
        {text}
      </span>
    </span>
  );
}

function SaleValueInputs({
  values,
  selectedGrades,
  onCommit,
  onSelectedGradesChange,
}: {
  values: Record<number, string>;
  selectedGrades: number[];
  onCommit: (values: Record<number, string>) => void;
  onSelectedGradesChange: (grades: number[]) => void;
}) {
  const [draftValues, setDraftValues] = useState(values);
  const valuesKey = useMemo(() => JSON.stringify(values), [values]);
  const draftValuesKey = useMemo(() => JSON.stringify(draftValues), [draftValues]);
  const previousValuesKeyRef = useRef(valuesKey);
  const selectedGradeSet = useMemo(
    () => new Set(selectedGrades),
    [selectedGrades],
  );

  useEffect(() => {
    if (previousValuesKeyRef.current === valuesKey) return;
    previousValuesKeyRef.current = valuesKey;
    setDraftValues(values);
  }, [values, valuesKey]);

  useEffect(() => {
    if (draftValuesKey === valuesKey) return;
    const timeoutId = window.setTimeout(() => {
      onCommit(draftValues);
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [draftValues, draftValuesKey, onCommit, valuesKey]);

  function updateDraftValue(grade: number, value: string) {
    setDraftValues((current) => ({
      ...current,
      [grade]: value,
    }));
  }

  function toggleSelectedGrade(grade: number) {
    const nextGrades = selectedGradeSet.has(grade)
      ? selectedGrades.filter((selectedGrade) => selectedGrade !== grade)
      : [...selectedGrades, grade].sort((a, b) => a - b);

    if (nextGrades.length === 0) return;
    onSelectedGradesChange(nextGrades);
  }

  return (
    <div className="mt-6 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-muted-foreground flex items-center gap-1.5 text-sm">
          <span>Sell tiers</span>
          <InfoTooltip text="Only selected tiers are treated as sale outcomes in the EV calculation. Values for hidden tiers are kept so toggling them back on restores the input." />
        </div>
        {TARGET_GRADES.map((grade) => (
          <Button
            key={grade}
            type="button"
            size="sm"
            variant={selectedGradeSet.has(grade) ? "default" : "outline"}
            onClick={() => toggleSelectedGrade(grade)}
          >
            {regradeData.grades[grade]?.name ?? `Grade ${grade}`}
          </Button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TARGET_GRADES.filter((grade) => selectedGradeSet.has(grade)).map(
          (grade) => (
            <label key={grade} className="space-y-1 text-sm">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <span>
                  {regradeData.grades[grade]?.name ?? `Grade ${grade}`} sale value
                </span>
                <InfoTooltip text="Gold you expect to receive if the item is sold at this grade. This value is only used while this tier is selected in Sell tiers." />
              </span>
              <Input
                inputMode="decimal"
                value={draftValues[grade] ?? ""}
                onChange={(event) => updateDraftValue(grade, event.target.value)}
                placeholder="Gold"
              />
            </label>
          ),
        )}
      </div>
    </div>
  );
}

function RegradeMaterialsSection({
  selectedItem,
  selectedTargetGrade,
  baseRecraft,
  baseCraftData,
  upgradeCost,
  selectedSteps,
  consumablePriceMap,
  consumableLaborMap,
  consumableCraftDataByItemId,
  upgradeCraftDataByItemId,
  delphinadSealCraftDataByItemId,
  ayanadSealCraftData,
  overrideMap,
  proficiencyMap,
  manualCraftModes,
  setCraftMode,
  onSavePriceOverride,
  collapsedCraftIds,
  toggleCollapsed,
}: {
  selectedItem: SupportedRegradeItem;
  selectedTargetGrade: number | null;
  baseRecraft: RecraftSummary;
  baseCraftData: ForItemOutput;
  upgradeCost: UpgradeCostSummary;
  selectedSteps: RegradeActionChoice[];
  consumablePriceMap: ConsumablePriceMap;
  consumableLaborMap: ConsumableLaborMap;
  consumableCraftDataByItemId: ReadonlyMap<number, ForItemOutput>;
  upgradeCraftDataByItemId: ReadonlyMap<number, ForItemOutput>;
  delphinadSealCraftDataByItemId: ReadonlyMap<number, ForItemOutput>;
  ayanadSealCraftData: ForItemOutput | null;
  overrideMap: OverrideMap;
  proficiencyMap: ProficiencyMap;
  manualCraftModes: CraftModeMap;
  setCraftMode: (itemId: number, mode: CraftMode) => void;
  onSavePriceOverride: (itemId: number, price: number) => void;
  collapsedCraftIds: Set<number>;
  toggleCollapsed: (craftId: number) => void;
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="mb-3 flex items-center gap-1.5">
        <h2 className="text-sm font-medium">Materials</h2>
        <InfoTooltip text="Recipe materials used by the current regrade path. Buy/Craft choices and price overrides update the costs used by the EV table." />
      </div>

      <div className="space-y-3">
        <RegradeCraftBreakdown
          title="Base recraft"
          entry={baseRecraft.craft}
          itemId={baseCraftData.item.id}
          craftData={baseCraftData}
          overrideMap={overrideMap}
          proficiencyMap={proficiencyMap}
          manualCraftModes={manualCraftModes}
          setCraftMode={setCraftMode}
          onSavePriceOverride={onSavePriceOverride}
          collapsedCraftIds={collapsedCraftIds}
          toggleCollapsed={toggleCollapsed}
        />

        {upgradeCost.stages.map((stage) => {
          const craftData = upgradeCraftDataByItemId.get(stage.itemId);
          return craftData ? (
            <RegradeCraftBreakdown
              key={`stage-${stage.itemId}`}
              title={stage.itemName}
              entry={stage.craft}
              itemId={stage.itemId}
              craftData={craftData}
              excludedItemIds={[stage.consumedItemId]}
              overrideMap={overrideMap}
              proficiencyMap={proficiencyMap}
              manualCraftModes={manualCraftModes}
              setCraftMode={setCraftMode}
              onSavePriceOverride={onSavePriceOverride}
              collapsedCraftIds={collapsedCraftIds}
              toggleCollapsed={toggleCollapsed}
            />
          ) : null;
        })}

        {upgradeCost.rerolls.map((reroll) => {
          const craftData =
            reroll.tier === "ayanad"
              ? ayanadSealCraftData
              : delphinadSealCraftDataByItemId.get(reroll.itemId);
          return craftData ? (
            <RegradeCraftBreakdown
              key={`reroll-${reroll.tier}-${reroll.itemId}`}
              title={`${formatTierName(reroll.tier)} seal`}
              entry={reroll.craft}
              itemId={reroll.itemId}
              craftData={craftData}
              overrideMap={overrideMap}
              proficiencyMap={proficiencyMap}
              manualCraftModes={manualCraftModes}
              setCraftMode={setCraftMode}
              onSavePriceOverride={onSavePriceOverride}
              collapsedCraftIds={collapsedCraftIds}
              toggleCollapsed={toggleCollapsed}
            />
          ) : null;
        })}

        <RegradeConsumablesBreakdown
          selectedSteps={selectedSteps}
          selectedItem={selectedItem}
          selectedTargetGrade={selectedTargetGrade}
          consumablePriceMap={consumablePriceMap}
          consumableLaborMap={consumableLaborMap}
          consumableCraftDataByItemId={consumableCraftDataByItemId}
          overrideMap={overrideMap}
          proficiencyMap={proficiencyMap}
          manualCraftModes={manualCraftModes}
          setCraftMode={setCraftMode}
          onSavePriceOverride={onSavePriceOverride}
          collapsedCraftIds={collapsedCraftIds}
          toggleCollapsed={toggleCollapsed}
        />
      </div>
    </div>
  );
}

function RegradeConsumablesBreakdown({
  selectedSteps,
  selectedItem,
  selectedTargetGrade,
  consumablePriceMap,
  consumableLaborMap,
  consumableCraftDataByItemId,
  overrideMap,
  proficiencyMap,
  manualCraftModes,
  setCraftMode,
  onSavePriceOverride,
  collapsedCraftIds,
  toggleCollapsed,
}: {
  selectedSteps: RegradeActionChoice[];
  selectedItem: SupportedRegradeItem;
  selectedTargetGrade: number | null;
  consumablePriceMap: ConsumablePriceMap;
  consumableLaborMap: ConsumableLaborMap;
  consumableCraftDataByItemId: ReadonlyMap<number, ForItemOutput>;
  overrideMap: OverrideMap;
  proficiencyMap: ProficiencyMap;
  manualCraftModes: CraftModeMap;
  setCraftMode: (itemId: number, mode: CraftMode) => void;
  onSavePriceOverride: (itemId: number, price: number) => void;
  collapsedCraftIds: Set<number>;
  toggleCollapsed: (craftId: number) => void;
}) {
  const selectedConsumableIds = new Set(
    selectedSteps.flatMap((step) => [
      step.scroll.id,
      ...(step.charm ? [step.charm.id] : []),
    ]),
  );
  const availableScrolls = regradeData.scrolls.filter(
    (scroll) => scroll.type === selectedItem.type,
  );
  const applicableGrades = Array.from(
    {
      length: Math.max(
        0,
        (selectedTargetGrade ?? RECRAFT_START_GRADE + 1) - RECRAFT_START_GRADE,
      ),
    },
    (_, index) => RECRAFT_START_GRADE + index,
  );
  const availableCharms = [
    ...new Map(
      applicableGrades
        .flatMap((grade) => getApplicableCharms(selectedItem, grade))
        .map((charm) => [charm.id, charm] as const),
    ).values(),
  ];

  return (
    <div className="rounded-md border p-3">
      <div className="mb-2.5 flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="truncate font-semibold">Regrade consumables</p>
          <InfoTooltip text="Scrolls and charms available for this item and target. The solver only uses priced consumables, and selected policy items are marked below." />
        </div>
        <p className="text-muted-foreground text-xs">
          {availableScrolls.length + availableCharms.length} available
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <div className="text-muted-foreground mb-1 text-xs uppercase">
            Scrolls
          </div>
          <ul className="flex flex-col gap-1">
            {availableScrolls.map((scroll) => (
              <RegradeConsumableRow
                key={scroll.id}
                consumable={scroll}
                selected={selectedConsumableIds.has(scroll.id)}
                unitPrice={consumablePriceMap.get(scroll.id) ?? 0}
                unitLabor={consumableLaborMap.get(scroll.id) ?? 0}
                craftData={consumableCraftDataByItemId.get(scroll.id)}
                overrideMap={overrideMap}
                proficiencyMap={proficiencyMap}
                manualCraftModes={manualCraftModes}
                setCraftMode={setCraftMode}
                onSavePriceOverride={onSavePriceOverride}
                collapsedCraftIds={collapsedCraftIds}
                toggleCollapsed={toggleCollapsed}
              />
            ))}
          </ul>
        </div>

        <div>
          <div className="text-muted-foreground mb-1 text-xs uppercase">
            Charms
          </div>
          {availableCharms.length ? (
            <ul className="flex flex-col gap-1">
              {availableCharms.map((charm) => (
                <RegradeConsumableRow
                  key={charm.id}
                  consumable={charm}
                  selected={selectedConsumableIds.has(charm.id)}
                  unitPrice={consumablePriceMap.get(charm.id) ?? 0}
                  unitLabor={consumableLaborMap.get(charm.id) ?? 0}
                  craftData={consumableCraftDataByItemId.get(charm.id)}
                  overrideMap={overrideMap}
                  proficiencyMap={proficiencyMap}
                  manualCraftModes={manualCraftModes}
                  setCraftMode={setCraftMode}
                  onSavePriceOverride={onSavePriceOverride}
                  collapsedCraftIds={collapsedCraftIds}
                  toggleCollapsed={toggleCollapsed}
                />
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">
              No charms apply before the selected target.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function RegradeConsumableRow({
  consumable,
  selected,
  unitPrice,
  unitLabor,
  craftData,
  overrideMap,
  proficiencyMap,
  manualCraftModes,
  setCraftMode,
  onSavePriceOverride,
  collapsedCraftIds,
  toggleCollapsed,
}: {
  consumable: {
    id: number;
    name: string;
    icon: string;
  };
  selected: boolean;
  unitPrice: number;
  unitLabor: number;
  craftData?: ForItemOutput;
  overrideMap: OverrideMap;
  proficiencyMap: ProficiencyMap;
  manualCraftModes: CraftModeMap;
  setCraftMode: (itemId: number, mode: CraftMode) => void;
  onSavePriceOverride: (itemId: number, price: number) => void;
  collapsedCraftIds: Set<number>;
  toggleCollapsed: (craftId: number) => void;
}) {
  const isCustom = overrideMap.has(consumable.id);
  const isCraftable = !!craftData?.crafts.length;
  const mode = manualCraftModes[consumable.id] ?? "buy";
  const craft =
    isCraftable && craftData
      ? pickPreferredRegradeConsumableCraft(
          consumable.id,
          craftData,
          overrideMap,
          manualCraftModes,
        )
      : null;

  return (
    <Fragment>
      <RecipeItemRow
        icon={<ItemIcon icon={consumable.icon} name={consumable.name} />}
        name={consumable.name}
        amount={selected ? 1 : undefined}
        controls={
          isCraftable ? (
            <CraftModeToggle
              mode={mode}
              onBuy={() => setCraftMode(consumable.id, "buy")}
              onCraft={() => setCraftMode(consumable.id, "craft")}
            />
          ) : null
        }
        value={
          <span className="text-muted-foreground flex shrink-0 items-center gap-2 tabular-nums">
            <input
              type="number"
              min="0"
              step="0.01"
              defaultValue={unitPrice > 0 ? unitPrice.toFixed(2) : ""}
              onBlur={(event) => {
                const parsed = parsePriceOverrideInput(event.currentTarget.value);
                if (parsed != null && parsed !== unitPrice) {
                  onSavePriceOverride(consumable.id, parsed);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
              className="bg-background w-20 rounded-md border px-2 py-1 text-right text-xs tabular-nums"
            />
            {isCustom && mode === "buy" ? (
              <span className="text-primary text-xs">(custom)</span>
            ) : null}
            {selected ? (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                selected
              </span>
            ) : null}
            {unitLabor > 0 ? (
              <span className="text-xs text-amber-500">
                {unitLabor.toLocaleString(undefined, {
                  maximumFractionDigits: 1,
                })}
                L
              </span>
            ) : null}
            <span className="text-foreground/70">{formatGold(unitPrice)}</span>
          </span>
        }
      />

      {mode === "craft" && craftData && craft ? (
        <li className="border-muted-foreground/20 my-0.5 ml-3 border-l-2 pl-3">
          <RegradeCraftBreakdown
            entry={craft}
            itemId={consumable.id}
            craftData={craftData}
            overrideMap={overrideMap}
            proficiencyMap={proficiencyMap}
            manualCraftModes={manualCraftModes}
            setCraftMode={setCraftMode}
            onSavePriceOverride={onSavePriceOverride}
            collapsedCraftIds={collapsedCraftIds}
            toggleCollapsed={toggleCollapsed}
            depth={1}
          />
        </li>
      ) : null}
    </Fragment>
  );
}

function RegradeCraftBreakdown({
  title,
  entry,
  itemId,
  craftData,
  excludedItemIds = [],
  overrideMap,
  proficiencyMap,
  manualCraftModes,
  setCraftMode,
  onSavePriceOverride,
  collapsedCraftIds,
  toggleCollapsed,
  depth = 0,
}: {
  title?: string;
  entry: ForItemOutput["crafts"][number] | SubcraftEntry;
  itemId: number;
  craftData: ForItemOutput;
  excludedItemIds?: number[];
  overrideMap: OverrideMap;
  proficiencyMap: ProficiencyMap;
  manualCraftModes: CraftModeMap;
  setCraftMode: (itemId: number, mode: CraftMode) => void;
  onSavePriceOverride: (itemId: number, price: number) => void;
  collapsedCraftIds: Set<number>;
  toggleCollapsed: (craftId: number) => void;
  depth?: number;
}) {
  const priceMap = buildPriceMap(craftData.prices);
  const excludedIds = new Set(excludedItemIds);
  const materials = entry.materials.filter(({ item }) => !excludedIds.has(item.id));
  const isCollapsed =
    depth === 0
      ? !collapsedCraftIds.has(entry.craft.id)
      : collapsedCraftIds.has(entry.craft.id);
  const modes = isCollapsed
    ? manualCraftModes
    : getEffectiveCraftModes(
        materials,
        craftData.subcraftsByItemId,
        priceMap,
        overrideMap,
        manualCraftModes,
      );
  const total = isCollapsed
    ? 0
    : materials.reduce((sum, { item, amount }) => {
        const unit = getChosenMaterialUnitCost(
          item,
          craftData.subcraftsByItemId,
          priceMap,
          overrideMap,
          modes,
        );
        return sum + unit * amount;
      }, 0);
  const hasPrices = !isCollapsed && (priceMap.size > 0 || overrideMap.size > 0);
  const hasCraftable =
    !isCollapsed &&
    materials.some(({ item }) => !!craftData.subcraftsByItemId[item.id]?.length);

  return (
    <RecipeCardShell depth={depth}>
      <RecipeHeader
        depth={depth}
        title={title ?? entry.craft.name}
        proficiency={entry.craft.proficiency}
        laborLabel={
          !isCollapsed && entry.craft.labor > 0
            ? `${getSelectedCraftUnitLabor(
                entry,
                itemId,
                craftData.subcraftsByItemId,
                priceMap,
                overrideMap,
                proficiencyMap,
                modes,
              ).toLocaleString(undefined, { maximumFractionDigits: 1 })} labor`
            : null
        }
        materialsLabel={hasPrices ? formatGold(total) : null}
        collapseToggle={
          <button
            type="button"
            onClick={() => toggleCollapsed(entry.craft.id)}
            className="text-muted-foreground hover:text-foreground shrink-0 text-xs"
            aria-label={isCollapsed ? "Expand craft" : "Collapse craft"}
          >
            {isCollapsed ? "▶" : "▼"}
          </button>
        }
      />

      {!isCollapsed ? (
        <>
          <ul className="flex flex-col gap-1">
            {materials.map(({ item, amount }) => {
              const isCraftable = !!craftData.subcraftsByItemId[item.id]?.length;
              const mode = modes[item.id] ?? "buy";
              const customPrice = overrideMap.get(item.id);
              const price = priceMap.get(item.id);
              const isCustom = customPrice != null;
              const buyUnit = getItemPrice(item.id, priceMap, overrideMap);
              const forceBuy = isForcedAuctionHouseMaterial(item);
              const craftUnit =
                isCraftable && !forceBuy
                  ? deepCraftCost(
                      item.id,
                      craftData.subcraftsByItemId,
                      priceMap,
                      overrideMap,
                      modes,
                    )
                  : 0;
              const unit =
                mode === "craft" && isCraftable && !forceBuy
                  ? craftUnit
                  : buyUnit;
              const lineTotal = unit * amount;
              const hasPrice = isCustom || !!price;
              const totalDiff =
                isCraftable && !forceBuy && hasPrice
                  ? (buyUnit - craftUnit) * amount
                  : null;
              const subEntries = craftData.subcraftsByItemId[item.id];
              const subEntry =
                isCraftable && subEntries?.length
                  ? pickCheapestCraftForItem(
                      subEntries,
                      item.id,
                      craftData.subcraftsByItemId,
                      priceMap,
                      overrideMap,
                      modes,
                    )
                  : null;
              const subLabor = subEntry
                ? getChosenMaterialLabor(
                    item,
                    craftData.subcraftsByItemId,
                    priceMap,
                    overrideMap,
                    proficiencyMap,
                    modes,
                  )
                : 0;

              return (
                <Fragment key={item.id}>
                  <RecipeItemRow
                    icon={<ItemIcon icon={item.icon} name={item.name} />}
                    name={item.name}
                    amount={amount}
                    controls={
                      isCraftable && !forceBuy ? (
                        <CraftModeToggle
                          mode={mode}
                          onBuy={() => setCraftMode(item.id, "buy")}
                          onCraft={() => setCraftMode(item.id, "craft")}
                        />
                      ) : null
                    }
                    value={
                      hasPrice || mode === "craft" ? (
                        <span className="text-muted-foreground flex shrink-0 items-center gap-2 tabular-nums">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            defaultValue={unit > 0 ? unit.toFixed(2) : ""}
                            onBlur={(event) => {
                              const parsed = parsePriceOverrideInput(
                                event.currentTarget.value,
                              );
                              if (parsed != null && parsed !== buyUnit) {
                                onSavePriceOverride(item.id, parsed);
                              }
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.currentTarget.blur();
                              }
                            }}
                            className="bg-background w-20 rounded-md border px-2 py-1 text-right text-xs tabular-nums"
                          />
                          {isCustom && mode === "buy" ? (
                            <span className="text-primary text-xs">(custom)</span>
                          ) : null}
                          {mode === "craft" &&
                          isCraftable &&
                          !forceBuy &&
                          subLabor > 0 ? (
                            <span className="text-xs text-amber-500">
                              {subLabor.toLocaleString(undefined, {
                                maximumFractionDigits: 0,
                              })}
                              L +
                            </span>
                          ) : null}
                          <span className="text-foreground/70">
                            {formatGold(unit)}
                          </span>
                          {amount > 1 ? (
                            <span className="text-foreground font-medium">
                              = {formatGold(lineTotal)}
                            </span>
                          ) : null}
                        </span>
                      ) : null
                    }
                    diff={
                      totalDiff !== null ? (
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium tabular-nums ${
                            totalDiff > 0
                              ? "bg-green-500/10 text-green-600 dark:text-green-400"
                              : totalDiff < 0
                                ? "bg-red-500/10 text-red-500"
                                : "text-muted-foreground"
                          }`}
                        >
                          {totalDiff > 0
                            ? `↓ ${formatGold(totalDiff)}`
                            : totalDiff < 0
                              ? `↑ ${formatGold(Math.abs(totalDiff))}`
                              : "="}
                        </span>
                      ) : null
                    }
                  />

                  {mode === "craft" && isCraftable && !forceBuy && subEntry ? (
                    <li className="border-muted-foreground/20 my-0.5 ml-3 border-l-2 pl-3">
                      <RegradeCraftBreakdown
                        entry={subEntry}
                        itemId={item.id}
                        craftData={craftData}
                        overrideMap={overrideMap}
                        proficiencyMap={proficiencyMap}
                        manualCraftModes={manualCraftModes}
                        setCraftMode={setCraftMode}
                        onSavePriceOverride={onSavePriceOverride}
                        collapsedCraftIds={collapsedCraftIds}
                        toggleCollapsed={toggleCollapsed}
                        depth={depth + 1}
                      />
                    </li>
                  ) : null}
                </Fragment>
              );
            })}
          </ul>

          {depth === 0 && hasCraftable ? <RecipeLegend /> : null}
        </>
      ) : null}
    </RecipeCardShell>
  );
}

function useRegradeCraftModePreferences(scope: string) {
  const [preferences, setPreferences] = useState<Record<string, CraftModeMap>>(
    readRegradeCraftModePreferences,
  );
  const modes = preferences[scope] ?? {};

  const setCraftModePreference = useCallback(
    (itemId: number, mode: CraftMode) => {
      setPreferences((current) => {
        const next = {
          ...current,
          [scope]: { ...(current[scope] ?? {}), [itemId]: mode },
        };
        writeRegradeCraftModePreferences(next);
        return next;
      });
    },
    [scope],
  );

  return { modes, setCraftModePreference };
}

function readRegradeCraftModePreferences(): Record<string, CraftModeMap> {
  try {
    const raw = localStorage.getItem(REGRADE_CRAFT_MODE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).flatMap(([scope, rawModes]) => {
        if (!rawModes || typeof rawModes !== "object" || Array.isArray(rawModes)) {
          return [];
        }

        const modes = Object.fromEntries(
          Object.entries(rawModes as Record<string, unknown>)
            .map(([itemId, mode]) => [Number(itemId), mode] as const)
            .filter(
              (entry): entry is [number, CraftMode] =>
                Number.isInteger(entry[0]) &&
                (entry[1] === "buy" || entry[1] === "craft"),
            )
            .sort(([a], [b]) => a - b),
        );

        return Object.keys(modes).length ? [[scope, modes] as const] : [];
      }),
    );
  } catch {
    return {};
  }
}

function writeRegradeCraftModePreferences(
  preferences: Record<string, CraftModeMap>,
) {
  try {
    localStorage.setItem(
      REGRADE_CRAFT_MODE_STORAGE_KEY,
      JSON.stringify(preferences),
    );
  } catch {
    // localStorage can be unavailable in private or SSR-like environments.
  }
}

function buildPriceMap(prices: ForItemOutput["prices"]): PriceMap {
  return new Map(prices.map((price) => [price.itemId, price]));
}

function dedupeItemsById<T extends { id: number }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function getExistingItemIds<T extends { id: number }>(
  names: string[],
  itemMap: ReadonlyMap<string, T>,
): number[] {
  return names.flatMap((name) => {
    const item = itemMap.get(name);
    return item ? [item.id] : [];
  });
}

function getEffectiveCraftModes(
  _materials: { item: { id: number; name: string } }[],
  subcraftMap: SubcraftMap,
  _priceMap: PriceMap,
  _overrideMap: OverrideMap,
  manualCraftModes: CraftModeMap,
): CraftModeMap {
  return getDefaultBuyCraftModes(subcraftMap, manualCraftModes);
}

function getDefaultBuyCraftModes(
  subcraftMap: SubcraftMap,
  manualCraftModes: CraftModeMap,
): CraftModeMap {
  return {
    ...Object.fromEntries(
      Object.keys(subcraftMap).map((itemId) => [Number(itemId), "buy" as const]),
    ),
    ...manualCraftModes,
  };
}

function pickPreferredRegradeConsumableCraft(
  itemId: number,
  craftData: ForItemOutput,
  overrideMap: OverrideMap,
  manualCraftModes: CraftModeMap,
): ForItemOutput["crafts"][number] {
  const itemName = craftData.item.name.toLowerCase();
  const preferredMaterial =
    itemName.includes("weapon regrade scroll")
      ? "sunpoint"
      : itemName.includes("armor regrade scroll")
        ? "moonpoint"
        : null;

  if (preferredMaterial) {
    const preferredCraft = craftData.crafts.find((craft) =>
      craft.materials.some((material) =>
        material.item.name.toLowerCase().includes(preferredMaterial),
      ),
    );
    if (preferredCraft) return preferredCraft;
  }

  return pickCheapestCraftForItem(
    craftData.crafts,
    itemId,
    craftData.subcraftsByItemId,
    buildPriceMap(craftData.prices),
    overrideMap,
    getDefaultBuyCraftModes(craftData.subcraftsByItemId, manualCraftModes),
  );
}

function getConsumableCraftUnitCost(
  itemId: number,
  craftData: ForItemOutput,
  overrideMap: OverrideMap,
  manualCraftModes: CraftModeMap,
): number {
  if (!craftData.crafts.length) return 0;
  const priceMap = buildPriceMap(craftData.prices);
  const craft = pickPreferredRegradeConsumableCraft(
    itemId,
    craftData,
    overrideMap,
    manualCraftModes,
  );
  const modes = getEffectiveCraftModes(
    craft.materials,
    craftData.subcraftsByItemId,
    priceMap,
    overrideMap,
    manualCraftModes,
  );
  return getCraftEntryUnitCost(
    craft,
    itemId,
    craftData.subcraftsByItemId,
    priceMap,
    overrideMap,
    modes,
  );
}

function getConsumableCraftUnitLabor(
  itemId: number,
  craftData: ForItemOutput,
  overrideMap: OverrideMap,
  proficiencyMap: ProficiencyMap,
  manualCraftModes: CraftModeMap,
): number {
  if (!craftData.crafts.length) return 0;
  const priceMap = buildPriceMap(craftData.prices);
  const craft = pickPreferredRegradeConsumableCraft(
    itemId,
    craftData,
    overrideMap,
    manualCraftModes,
  );
  const modes = getEffectiveCraftModes(
    craft.materials,
    craftData.subcraftsByItemId,
    priceMap,
    overrideMap,
    manualCraftModes,
  );
  return getSelectedCraftUnitLabor(
    craft,
    itemId,
    craftData.subcraftsByItemId,
    priceMap,
    overrideMap,
    proficiencyMap,
    modes,
  );
}

function sumRerollCost(rerolls: RerollCostSummary[]): number {
  return rerolls.reduce((sum, reroll) => sum + reroll.costGold, 0);
}

function formatTierName(tier: RerollCostSummary["tier"]): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
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
  entry: ForItemOutput["crafts"][number] | SubcraftEntry,
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
  consumedItemId?: number;
  consumedItemIds?: number[];
  manualCraftModes: CraftModeMap;
  overrideMap: OverrideMap;
  proficiencyMap: ProficiencyMap;
}): UpgradeStageSummary | null {
  const {
    craftData,
    consumedItemId,
    consumedItemIds,
    manualCraftModes,
    overrideMap,
    proficiencyMap,
    targetItemId,
    targetItemName,
  } = input;
  if (!craftData?.crafts.length) return null;
  const consumedIds = new Set(
    consumedItemIds ?? (consumedItemId == null ? [] : [consumedItemId]),
  );
  if (consumedIds.size === 0) return null;

  const candidateCrafts = craftData.crafts.filter((entry) =>
    entry.materials.some(({ item }) => consumedIds.has(item.id)),
  );
  if (!candidateCrafts.length) return null;

  const priceMap = buildPriceMap(craftData.prices);
  const defaultBuyModes = getDefaultBuyCraftModes(
    craftData.subcraftsByItemId,
    manualCraftModes,
  );
  const selectedCraft = pickCheapestCraftForItem(
    candidateCrafts,
    targetItemId,
    craftData.subcraftsByItemId,
    priceMap,
    overrideMap,
    defaultBuyModes,
  );
  const consumedMaterial = selectedCraft.materials.find(({ item }) =>
    consumedIds.has(item.id),
  );
  if (!consumedMaterial) return null;
  const filteredMaterials = selectedCraft.materials.filter(
    ({ item }) => !consumedIds.has(item.id),
  );
  const modes = getEffectiveCraftModes(
    filteredMaterials,
    craftData.subcraftsByItemId,
    priceMap,
    overrideMap,
    manualCraftModes,
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
    consumedItemId: consumedMaterial.item.id,
    consumedItemName: consumedMaterial.item.name,
    consumedItemCategory: consumedMaterial.item.category,
    craft: selectedCraft,
    costGold,
    labor,
  };
}

function resolveIntermediateRerollCost(input: {
  tier: "delphinad";
  itemName: string;
  itemCategory: string;
  sealItemsByName: ReadonlyMap<string, { id: number; name: string }>;
  sealCraftDataByItemId: ReadonlyMap<number, ForItemOutput>;
  glowingProcEnabled: boolean;
  manualCraftModes: CraftModeMap;
  overrideMap: OverrideMap;
  proficiencyMap: ProficiencyMap;
}): RerollCostSummary | null {
  const equip = detectPieceAndTier(input.itemName);
  if (!equip) return null;
  const sealName = resolveTieredManaSealName(input.tier, {
    name: input.itemName,
    category: input.itemCategory,
    equip,
  });
  if (!sealName) return null;
  const sealItem = input.sealItemsByName.get(sealName);
  if (!sealItem) return null;
  const sealSummary = resolveAyanadSealSummary({
    craftData: input.sealCraftDataByItemId.get(sealItem.id) ?? null,
    itemId: sealItem.id,
    manualCraftModes: input.manualCraftModes,
    overrideMap: input.overrideMap,
    proficiencyMap: input.proficiencyMap,
  });
  if (!sealSummary) return null;

  const procRate = input.glowingProcEnabled ? GLOWING_PROC_RATE : 0;
  const successRate = getEffectiveCraftSuccessRate(
    variantsByTier[input.tier],
    procRate,
  );
  const expectedFailedRerolls = Math.max(0, 1 / successRate - 1);

  return {
    tier: input.tier,
    itemId: sealItem.id,
    itemName: sealItem.name,
    sealName,
    craft: sealSummary.craft,
    costGold: sealSummary.costGold * expectedFailedRerolls,
    labor: (sealSummary.labor + MANA_SEAL_USE_LABOR) * expectedFailedRerolls,
    expectedFailedRerolls,
    successRate,
  };
}

function resolveAyanadSealSummary(input: {
  craftData: ForItemOutput | null;
  itemId: number | null;
  manualCraftModes: CraftModeMap;
  overrideMap: OverrideMap;
  proficiencyMap: ProficiencyMap;
}) {
  const { craftData, itemId, manualCraftModes, overrideMap, proficiencyMap } =
    input;
  if (!craftData?.crafts.length || itemId == null) return null;
  const priceMap = buildPriceMap(craftData.prices);
  const defaultBuyModes = getDefaultBuyCraftModes(
    craftData.subcraftsByItemId,
    manualCraftModes,
  );
  const craft = pickCheapestCraftForItem(
    craftData.crafts,
    itemId,
    craftData.subcraftsByItemId,
    priceMap,
    overrideMap,
    defaultBuyModes,
  );
  const modes = getEffectiveCraftModes(
    craft.materials,
    craftData.subcraftsByItemId,
    priceMap,
    overrideMap,
    manualCraftModes,
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
  return { craft, costGold, labor };
}

function formatGold(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}g`;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  return `${(value * 100).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })}%`;
}
