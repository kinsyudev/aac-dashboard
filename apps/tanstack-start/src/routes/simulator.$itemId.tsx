import type { QueryClient } from "@tanstack/react-query";
import type { inferProcedureOutput } from "@trpc/server";
import type { FormEvent } from "react";
import { Fragment, Suspense, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { z } from "zod";

import type { AppRouter } from "@acme/api";
import { Button } from "@acme/ui/button";
import { Checkbox } from "@acme/ui/checkbox";
import { Input } from "@acme/ui/input";
import { toast } from "@acme/ui/toast";

import type { ProficiencyMap } from "~/lib/proficiency";
import type {
  ResealLoopSimulationResult,
  SalvageLoopSimulationResult,
  SimulationResult,
} from "~/lib/simulator";
import type { SimulatorTarget } from "~/lib/simulator-catalog";
import type { CraftModeMap, SimulationChain } from "~/lib/simulator-upgrade";
import { ItemIcon } from "~/component/item-icon";
import {
  CraftModeToggle,
  RecipeCardShell,
  RecipeHeader,
  RecipeItemRow,
  RecipeLegend,
} from "~/component/recipe-breakdown";
import { StatCard } from "~/component/stat-card";
import { pickCheapestCraft } from "~/lib/craft-helpers";
import { resolveDelphinadManaSealName } from "~/lib/mana-seal";
import { buildMetaTags, buildPageTitle, getItemIconUrl } from "~/lib/metadata";
import { getDiscountedLabor } from "~/lib/proficiency";
import { piecesMap } from "~/lib/salvage";
import {
  computeResealLoopSimulation,
  computeSimulation,
  detectPieceAndTier,
} from "~/lib/simulator";
import { getSimulatorTargetByItemId } from "~/lib/simulator-catalog";
import { parsePriceOverrideInput } from "~/lib/simulator-price-override";
import {
  pickPreferredSimulatorRecipe,
  useSimulatorCraftModePreferences,
  useSimulatorRecipePreferences,
} from "~/lib/simulator-recipe-preferences";
import {
  buildRecommendedModes,
  deepCraftCost,
  getCraftEntryUnitCost,
  getItemPrice,
  getMatchingAyanadName,
  getSimulationChain,
  isForcedAuctionHouseMaterial,
  mergePriceMaps,
  pickCheapestCraftForItem,
  useAyanadUpgradeData,
} from "~/lib/simulator-upgrade";
import { useTRPC } from "~/lib/trpc";
import { useUserData } from "~/lib/useUserData";

export const Route = createFileRoute("/simulator/$itemId")({
  params: {
    parse: (p) => ({ itemId: z.coerce.number().int().parse(p.itemId) }),
    stringify: (p) => ({ itemId: String(p.itemId) }),
  },
  loader: async ({ context, params }) => {
    const { trpc, queryClient } = context;
    const data = await queryClient.fetchQuery(
      trpc.crafts.forItem.queryOptions(params.itemId),
    );
    if (!data) {
      notFound({ throw: true });
      throw new Error("Simulator detail loader reached an impossible state.");
    }

    await queryClient.fetchQuery(trpc.profile.getUserData.queryOptions());

    const equip = detectPieceAndTier(data.item.name);
    const manaSealName = equip
      ? resolveDelphinadManaSealName({
          name: data.item.name,
          category: data.item.category,
          equip,
        })
      : null;
    const ayanadItemName = getMatchingAyanadName(data.item.name);

    await Promise.all([
      prefetchCraftDataByExactName(trpc, queryClient, manaSealName),
      prefetchCraftDataByExactName(trpc, queryClient, ayanadItemName),
    ]);

    return data;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const item = loaderData.item;
    return {
      meta: buildMetaTags({
        title: buildPageTitle(item.name, "Simulator"),
        description: `Simulate the crafting chain, costs, and profitability for ${item.name}.`,
        image: getItemIconUrl(item.icon),
      }),
    };
  },
  component: SimulatorItemPage,
});

function SimulatorItemPage() {
  return (
    <main className="container py-16">
      <Link
        to="/simulator"
        className="text-muted-foreground mb-6 flex items-center gap-1 text-sm hover:underline"
      >
        ← Back to simulator dashboard
      </Link>
      <Suspense fallback={<p>Loading...</p>}>
        <SimulatorDetail />
      </Suspense>
    </main>
  );
}

type ForItemOutput = NonNullable<
  inferProcedureOutput<AppRouter["crafts"]["forItem"]>
>;
type CraftMode = "buy" | "craft";
type CraftEntry = ForItemOutput["crafts"][number];
type PriceMap = Map<
  number,
  { avg24h: string | null; avg7d: string | null; avg30d: string | null }
>;
type OverrideMap = Map<number, number>;
type SubcraftMap = ForItemOutput["subcraftsByItemId"];

interface SimulationBaseData {
  chain: SimulationChain;
  mainCraft: CraftEntry;
  ayanadCraft: CraftEntry | null;
  attemptMaterials: CraftEntry["materials"];
  seedWispsPerAttempt: number;
  seedLabor: number;
  costPerAttempt: number;
  laborPerAttempt: number;
  upgradeMaterials: CraftEntry["materials"];
}

interface ResealStrategyData {
  result: ResealLoopSimulationResult | null;
  sealName: string | null;
  sealItem: ForItemOutput["item"] | null;
  sealCraft: CraftEntry | null;
  sealMaterials: CraftEntry["materials"];
  unsupportedReason: string | null;
}

async function prefetchCraftDataByExactName(
  trpc: ReturnType<typeof useTRPC>,
  queryClient: QueryClient,
  itemName: string | null,
) {
  if (!itemName) return null;

  const items = await queryClient.fetchQuery(
    trpc.items.byName.queryOptions(itemName),
  );
  const exactItem =
    items.find((item: { name: string }) => item.name === itemName) ?? null;

  if (exactItem) {
    await queryClient.fetchQuery(
      trpc.crafts.forItem.queryOptions(exactItem.id),
    );
  }

  return exactItem;
}

function formatGold(value: number): string {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}g`;
}

function formatCount(value: number): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  });
}

function serializePriceMap(map: PriceMap) {
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([itemId, price]) => ({ itemId, ...price }));
}

function serializeOverrideMap(map: OverrideMap) {
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([itemId, price]) => ({ itemId, price }));
}

function serializeCraftEntry(entry: CraftEntry | null) {
  if (!entry) return null;
  return {
    craft: {
      id: entry.craft.id,
      name: entry.craft.name,
      labor: entry.craft.labor,
      proficiency: entry.craft.proficiency,
    },
    products: entry.products.map(({ item, amount }) => ({
      itemId: item.id,
      name: item.name,
      amount,
    })),
    materials: entry.materials.map(({ item, amount }) => ({
      itemId: item.id,
      name: item.name,
      amount,
    })),
  };
}

function isManaWisp(name: string): boolean {
  return name.toLowerCase().includes("mana wisp");
}

function deepCraftLabor(
  itemId: number,
  subcraftMap: SubcraftMap,
  priceMap: PriceMap,
  overrideMap: OverrideMap,
  proficiencyMap: ProficiencyMap,
  modes: CraftModeMap = {},
  visited = new Set<number>(),
): number {
  if (visited.has(itemId)) return 0;
  visited.add(itemId);

  const entries = subcraftMap[itemId];
  if (!entries?.length) return 0;

  const entry = pickCheapestCraft(entries, itemId, (candidate, productItemId) =>
    getCraftEntryUnitCost(
      candidate,
      productItemId,
      subcraftMap,
      priceMap,
      overrideMap,
      modes,
      new Set(visited),
    ),
  );
  const produced =
    entry.products.find((p) => p.item.id === itemId)?.amount ?? 1;

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

function findWispInChain(
  data: ForItemOutput,
  priceMap: PriceMap,
  overrideMap: OverrideMap,
): { id: number; name: string; price: number } | null {
  const subcraftMap = data.subcraftsByItemId;
  const allMaterials: { id: number; name: string }[] = [];

  for (const craft of data.crafts) {
    for (const mat of craft.materials) {
      allMaterials.push({ id: mat.item.id, name: mat.item.name });
    }
  }
  for (const entries of Object.values(subcraftMap)) {
    for (const entry of entries) {
      for (const mat of entry.materials) {
        allMaterials.push({ id: mat.item.id, name: mat.item.name });
      }
    }
  }

  const wisp = allMaterials.find((m) =>
    m.name.toLowerCase().includes("mana wisp"),
  );
  if (!wisp) return null;

  return {
    id: wisp.id,
    name: wisp.name,
    price: getItemPrice(wisp.id, priceMap, overrideMap),
  };
}

function getChosenMaterialUnitCost(
  item: { id: number; name: string },
  subcraftMap: SubcraftMap,
  priceMap: PriceMap,
  overrideMap: OverrideMap,
  modes: CraftModeMap,
): number {
  const isCraftable = !!subcraftMap[item.id]?.length;
  const mode = modes[item.id] ?? "buy";
  if (isCraftable && mode === "craft" && !isForcedAuctionHouseMaterial(item)) {
    return deepCraftCost(item.id, subcraftMap, priceMap, overrideMap, modes);
  }
  return getItemPrice(item.id, priceMap, overrideMap);
}

function getChosenMaterialLabor(
  item: { id: number; name: string },
  subcraftMap: SubcraftMap,
  priceMap: PriceMap,
  overrideMap: OverrideMap,
  proficiencyMap: ProficiencyMap,
  modes: CraftModeMap,
): number {
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

function isConsumedUpgradeGearMaterial(
  material: { name: string; category?: string | null },
  source: { category: string },
  equip: NonNullable<ReturnType<typeof detectPieceAndTier>>,
): boolean {
  const lower = material.name.toLowerCase();
  if (!lower.includes("delphinad") && !lower.includes("ayanad")) return false;
  if (lower.includes("scroll")) return false;

  if (
    material.category != null &&
    material.category.toLowerCase() === source.category.toLowerCase()
  ) {
    return true;
  }

  if (equip.category === "armor" && equip.piece) {
    return piecesMap[equip.piece].some((token) => lower.includes(token));
  }

  return equip.pieceToken != null && lower.includes(equip.pieceToken);
}

function getSelectedCraftUnitLabor(
  entry: CraftEntry,
  itemId: number,
  subcraftMap: SubcraftMap,
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

function countManaWispsForItem(
  itemId: number,
  subcraftMap: SubcraftMap,
  priceMap: PriceMap,
  overrideMap: OverrideMap,
  modes: CraftModeMap,
  visited = new Set<number>(),
): number {
  if (visited.has(itemId)) return 0;
  visited.add(itemId);

  const subEntries = subcraftMap[itemId];
  if (!subEntries?.length) return 0;

  const entry = pickCheapestCraft(
    subEntries,
    itemId,
    (candidate, productItemId) =>
      getCraftEntryUnitCost(
        candidate,
        productItemId,
        subcraftMap,
        priceMap,
        overrideMap,
        modes,
        new Set(visited),
      ),
  );
  const produced =
    entry.products.find((p) => p.item.id === itemId)?.amount ?? 1;

  let total = 0;
  for (const { item, amount } of entry.materials) {
    if (isManaWisp(item.name)) {
      total += amount;
      continue;
    }
    if ((modes[item.id] ?? "craft") === "craft") {
      total +=
        countManaWispsForItem(
          item.id,
          subcraftMap,
          priceMap,
          overrideMap,
          modes,
          new Set(visited),
        ) * amount;
    }
  }

  return total / produced;
}

function serializeCraftModes(modes: CraftModeMap): string | undefined {
  const craftIds = Object.entries(modes)
    .filter(([, mode]) => mode === "craft")
    .map(([id]) => Number(id))
    .sort((a, b) => a - b);
  return craftIds.length ? craftIds.join(",") : undefined;
}

function SimulatorDetail() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const data = Route.useLoaderData();
  const { proficiencyMap, overrideMap } = useUserData();
  const simulatorTarget = useMemo(
    () => getSimulatorTargetByItemId(data.item.id),
    [data.item.id],
  );
  const { preferences, setRecipePreference } = useSimulatorRecipePreferences();
  const { modes, setCraftModePreference } = useSimulatorCraftModePreferences(
    simulatorTarget?.wispKey ?? "cloth",
  );
  const [collapsedCraftIds, setCollapsedCraftIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [glowingProcEnabled, setGlowingProcEnabled] = useState(false);
  const [debugCopyState, setDebugCopyState] = useState<string | null>(null);
  const [wispPriceInput, setWispPriceInput] = useState<{
    itemId: number;
    value: string;
  } | null>(null);

  const priceMap: PriceMap = useMemo(
    () => new Map(data.prices.map((p) => [p.itemId, p])),
    [data],
  );
  const equip = useMemo(() => detectPieceAndTier(data.item.name), [data]);
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

  const wisp = useMemo(
    () => findWispInChain(data, priceMap, overrideMap),
    [data, priceMap, overrideMap],
  );
  const currentWispPriceInput =
    wispPriceInput && wispPriceInput.itemId === wisp?.id
      ? wispPriceInput.value
      : wisp && wisp.price > 0
        ? String(wisp.price)
        : "";
  const manaSealName = useMemo(
    () =>
      equip
        ? resolveDelphinadManaSealName({
            name: data.item.name,
            category: data.item.category,
            equip,
          })
        : null,
    [data.item.category, data.item.name, equip],
  );
  const manaSealItemQuery = useQuery({
    ...trpc.items.byName.queryOptions(manaSealName ?? ""),
    enabled: !!manaSealName,
  });
  const manaSealItem = useMemo(
    () =>
      manaSealItemQuery.data?.find((item) => item.name === manaSealName) ??
      null,
    [manaSealItemQuery.data, manaSealName],
  );
  const manaSealCraftQuery = useQuery({
    ...trpc.crafts.forItem.queryOptions(manaSealItem?.id ?? -1),
    enabled: manaSealItem?.id != null,
  });
  const manaSealPriceMap: PriceMap = useMemo(
    () => new Map(manaSealCraftQuery.data?.prices.map((p) => [p.itemId, p])),
    [manaSealCraftQuery.data],
  );
  const { ayanadItem, ayanadCraftData } = useAyanadUpgradeData(data.item.name);
  const ayanadPriceMap: PriceMap = useMemo(
    () => new Map(ayanadCraftData?.prices.map((p) => [p.itemId, p])),
    [ayanadCraftData],
  );
  const upgradePriceMap = useMemo(
    () => mergePriceMaps(priceMap, ayanadPriceMap),
    [ayanadPriceMap, priceMap],
  );

  const selectedRecipeForModes = useMemo(() => {
    if (!simulatorTarget || !data.crafts.length) return null;
    return pickPreferredSimulatorRecipe(
      data.crafts,
      simulatorTarget.wispKey,
      preferences,
      (entry) =>
        getCraftEntryUnitCost(
          entry,
          data.item.id,
          data.subcraftsByItemId,
          priceMap,
          overrideMap,
          modes,
        ),
    );
  }, [data, modes, overrideMap, preferences, priceMap, simulatorTarget]);
  const preferredMainCraft = selectedRecipeForModes?.selected ?? null;

  const ayanadCraft = useMemo(() => {
    if (!ayanadCraftData?.crafts.length || ayanadItem == null || !equip) {
      return null;
    }
    const subcraftMap = ayanadCraftData.subcraftsByItemId;
    const upgradeCrafts = ayanadCraftData.crafts.filter((entry) =>
      entry.materials.some(({ item }) =>
        isConsumedUpgradeGearMaterial(item, data.item, equip),
      ),
    );
    return pickCheapestCraftForItem(
      upgradeCrafts.length ? upgradeCrafts : ayanadCraftData.crafts,
      ayanadItem.id,
      subcraftMap,
      upgradePriceMap,
      overrideMap,
      modes,
    );
  }, [
    ayanadCraftData,
    ayanadItem,
    data.item,
    equip,
    modes,
    overrideMap,
    upgradePriceMap,
  ]);
  const ayanadSubcraftMap = ayanadCraftData?.subcraftsByItemId;
  const manaSealCraft = useMemo(() => {
    if (!manaSealCraftQuery.data?.crafts.length || manaSealItem == null) {
      return null;
    }
    return pickCheapestCraftForItem(
      manaSealCraftQuery.data.crafts,
      manaSealItem.id,
      manaSealCraftQuery.data.subcraftsByItemId,
      manaSealPriceMap,
      overrideMap,
      modes,
    );
  }, [
    manaSealCraftQuery.data,
    manaSealItem,
    manaSealPriceMap,
    modes,
    overrideMap,
  ]);

  const recommendedModes = useMemo(() => {
    if (!preferredMainCraft || !equip) return {};
    const materials = [
      ...preferredMainCraft.materials,
      ...(manaSealCraft?.materials ?? []),
      ...(ayanadCraft?.materials.filter(
        ({ item }) => !isConsumedUpgradeGearMaterial(item, data.item, equip),
      ) ?? []),
    ];
    const subcraftMap = {
      ...data.subcraftsByItemId,
      ...(manaSealCraftQuery.data?.subcraftsByItemId ?? {}),
      ...(ayanadCraftData?.subcraftsByItemId ?? {}),
    };
    const prices = new Map([
      ...priceMap,
      ...manaSealPriceMap,
      ...ayanadPriceMap,
    ]);
    return buildRecommendedModes(materials, subcraftMap, prices, overrideMap);
  }, [
    ayanadCraft,
    ayanadCraftData,
    ayanadPriceMap,
    data,
    equip,
    preferredMainCraft,
    manaSealCraft,
    manaSealCraftQuery.data,
    manaSealPriceMap,
    priceMap,
    overrideMap,
  ]);
  const effectiveModes = useMemo(
    () => ({ ...recommendedModes, ...modes }),
    [recommendedModes, modes],
  );
  const selectedRecipe = useMemo(() => {
    if (!simulatorTarget || !data.crafts.length) return null;
    return pickPreferredSimulatorRecipe(
      data.crafts,
      simulatorTarget.wispKey,
      preferences,
      (entry) =>
        getCraftEntryUnitCost(
          entry,
          data.item.id,
          data.subcraftsByItemId,
          priceMap,
          overrideMap,
          effectiveModes,
        ),
    );
  }, [
    data,
    effectiveModes,
    overrideMap,
    preferences,
    priceMap,
    simulatorTarget,
  ]);
  const mainCraft = selectedRecipe?.selected ?? null;

  const simulationData = useMemo(() => {
    if (!equip || !mainCraft || !wisp) return null;

    const subcraftMap = data.subcraftsByItemId;
    const itemName = data.item.name.toLowerCase();

    if (equip.tier !== "delphinad" || !itemName.includes("sealed delphinad")) {
      return null;
    }

    const chain = getSimulationChain(mainCraft, subcraftMap);
    const attemptMaterials = mainCraft.materials.filter(
      ({ item }) => item.id !== chain.keyMaterialId,
    );
    const costPerAttempt = attemptMaterials.reduce(
      (sum, { item, amount }) =>
        sum +
        getChosenMaterialUnitCost(
          item,
          subcraftMap,
          priceMap,
          overrideMap,
          effectiveModes,
        ) *
          amount,
      0,
    );
    const upgradeMaterials = ayanadCraft
      ? ayanadCraft.materials.filter(
          ({ item }) => !isConsumedUpgradeGearMaterial(item, data.item, equip),
        )
      : [];
    const sealedUpgradeCost = upgradeMaterials.reduce(
      (sum, { item, amount }) =>
        sum +
        getChosenMaterialUnitCost(
          item,
          ayanadSubcraftMap ?? subcraftMap,
          upgradePriceMap,
          overrideMap,
          effectiveModes,
        ) *
          amount,
      0,
    );
    const sealedUpgradeLabor =
      (ayanadCraft
        ? getDiscountedLabor(
            ayanadCraft.craft.labor,
            ayanadCraft.craft.proficiency,
            proficiencyMap,
          )
        : 0) +
      upgradeMaterials.reduce(
        (sum, { item, amount }) =>
          sum +
          getChosenMaterialLabor(
            item,
            ayanadSubcraftMap ?? subcraftMap,
            upgradePriceMap,
            overrideMap,
            proficiencyMap,
            effectiveModes,
          ) *
            amount,
        0,
      );
    const seedWispsPerAttempt = chain.keyMaterialId
      ? countManaWispsForItem(
          chain.keyMaterialId,
          subcraftMap,
          priceMap,
          overrideMap,
          effectiveModes,
        )
      : 0;
    const seedLabor = chain.keyMaterialId
      ? deepCraftLabor(
          chain.keyMaterialId,
          subcraftMap,
          priceMap,
          overrideMap,
          proficiencyMap,
          effectiveModes,
        )
      : 0;
    const sealedCraftLabor =
      getDiscountedLabor(
        mainCraft.craft.labor,
        mainCraft.craft.proficiency,
        proficiencyMap,
      ) +
      attemptMaterials.reduce(
        (sum, { item, amount }) =>
          sum +
          getChosenMaterialLabor(
            item,
            subcraftMap,
            priceMap,
            overrideMap,
            proficiencyMap,
            effectiveModes,
          ) *
            amount,
        0,
      );
    const laborPerAttempt = seedLabor + sealedCraftLabor;

    const salvageResult = computeSimulation({
      costPerAttempt,
      sealedUpgradeCost,
      rngTier: equip.tier,
      equip,
      wispPrice: wisp.price,
      laborPerAttempt,
      sealedUpgradeLabor,
      seedWispsPerAttempt,
      glowingProcEnabled,
    });

    let reseal: ResealStrategyData = {
      result: null,
      sealName: manaSealName,
      sealItem: manaSealItem,
      sealCraft: manaSealCraft,
      sealMaterials: [],
      unsupportedReason: null,
    };

    if (!manaSealName) {
      reseal = {
        ...reseal,
        unsupportedReason: "No Delphinad mana seal mapping for this item.",
      };
    } else if (!manaSealItem) {
      reseal = {
        ...reseal,
        unsupportedReason: `Could not find ${manaSealName}.`,
      };
    } else if (!manaSealCraft) {
      reseal = {
        ...reseal,
        unsupportedReason: `No craft data found for ${manaSealName}.`,
      };
    } else {
      const sealSubcraftMap = manaSealCraftQuery.data?.subcraftsByItemId ?? {};
      const manaSealCost = getCraftEntryUnitCost(
        manaSealCraft,
        manaSealItem.id,
        sealSubcraftMap,
        manaSealPriceMap,
        overrideMap,
        effectiveModes,
      );
      const manaSealLabor = getSelectedCraftUnitLabor(
        manaSealCraft,
        manaSealItem.id,
        sealSubcraftMap,
        manaSealPriceMap,
        overrideMap,
        proficiencyMap,
        effectiveModes,
      );

      reseal = {
        result:
          manaSealCost > 0
            ? computeResealLoopSimulation({
                rngTier: equip.tier,
                equip,
                wispPrice: wisp.price,
                initialSeedCost: seedWispsPerAttempt * wisp.price,
                initialSealedCraftCost: costPerAttempt,
                initialSeedLabor: seedLabor,
                initialSealedCraftLabor: sealedCraftLabor,
                manaSealCost,
                manaSealLabor,
                sealedUpgradeCost,
                sealedUpgradeLabor,
                glowingProcEnabled,
              })
            : null,
        sealName: manaSealName,
        sealItem: manaSealItem,
        sealCraft: manaSealCraft,
        sealMaterials: manaSealCraft.materials,
        unsupportedReason:
          manaSealCost > 0
            ? null
            : `No usable ingredient price data for ${manaSealName}.`,
      };
    }

    const base: SimulationBaseData = {
      chain,
      mainCraft,
      ayanadCraft,
      attemptMaterials,
      seedWispsPerAttempt,
      seedLabor,
      costPerAttempt,
      laborPerAttempt,
      upgradeMaterials,
    };

    return {
      base,
      salvage: salvageResult,
      reseal,
    };
  }, [
    data,
    equip,
    mainCraft,
    effectiveModes,
    overrideMap,
    priceMap,
    proficiencyMap,
    wisp,
    glowingProcEnabled,
    ayanadCraft,
    ayanadSubcraftMap,
    upgradePriceMap,
    manaSealCraft,
    manaSealCraftQuery.data,
    manaSealItem,
    manaSealName,
    manaSealPriceMap,
  ]);

  if (!simulatorTarget) {
    return (
      <div className="rounded-md border border-dashed p-6">
        <h1 className="text-2xl font-semibold">Unsupported simulator item</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          The simulator dashboard currently supports the nine representative
          Sealed Delphinad wisp crafts only.
        </p>
        <Link
          to="/simulator"
          className="text-primary mt-4 inline-flex text-sm hover:underline"
        >
          Back to simulator dashboard
        </Link>
      </div>
    );
  }

  if (!equip) {
    return (
      <p className="text-muted-foreground text-sm">
        Could not detect tier/piece for this item.
      </p>
    );
  }

  const { item } = data;
  const exportModes = serializeCraftModes(effectiveModes);
  const isDevelopment = import.meta.env.DEV;
  const copyDebugState = () => {
    const reseal = simulationData?.reseal.result;
    const debugState = {
      capturedAt: new Date().toISOString(),
      item: {
        id: item.id,
        name: item.name,
        category: item.category,
      },
      detectedEquip: equip,
      selectedStrategy: reseal ? "reseal" : "salvage",
      wisp,
      modes: {
        manual: modes,
        recommended: recommendedModes,
        effective: effectiveModes,
        export: exportModes,
      },
      prices: {
        base: serializePriceMap(priceMap),
        manaSeal: serializePriceMap(manaSealPriceMap),
        overrides: serializeOverrideMap(overrideMap),
      },
      selectedCrafts: {
        mainCraft: serializeCraftEntry(mainCraft),
        ayanadCraft: serializeCraftEntry(ayanadCraft),
        manaSealCraft: serializeCraftEntry(manaSealCraft),
      },
      simulationBase: simulationData
        ? {
            chain: simulationData.base.chain,
            seedWispsPerAttempt: simulationData.base.seedWispsPerAttempt,
            seedLabor: simulationData.base.seedLabor,
            costPerAttempt: simulationData.base.costPerAttempt,
            laborPerAttempt: simulationData.base.laborPerAttempt,
            attemptMaterials: simulationData.base.attemptMaterials.map(
              ({ item, amount }) => ({
                itemId: item.id,
                name: item.name,
                amount,
                mode: effectiveModes[item.id] ?? "buy",
                unitCost: getChosenMaterialUnitCost(
                  item,
                  data.subcraftsByItemId,
                  priceMap,
                  overrideMap,
                  effectiveModes,
                ),
                unitLabor: getChosenMaterialLabor(
                  item,
                  data.subcraftsByItemId,
                  priceMap,
                  overrideMap,
                  proficiencyMap,
                  effectiveModes,
                ),
              }),
            ),
            upgradeMaterials: simulationData.base.upgradeMaterials.map(
              ({ item, amount }) => ({
                itemId: item.id,
                name: item.name,
                amount,
                mode: effectiveModes[item.id] ?? "buy",
                unitCost: getChosenMaterialUnitCost(
                  item,
                  ayanadSubcraftMap ?? data.subcraftsByItemId,
                  upgradePriceMap,
                  overrideMap,
                  effectiveModes,
                ),
                unitLabor: getChosenMaterialLabor(
                  item,
                  ayanadSubcraftMap ?? data.subcraftsByItemId,
                  upgradePriceMap,
                  overrideMap,
                  proficiencyMap,
                  effectiveModes,
                ),
              }),
            ),
          }
        : null,
      glowingProcEnabled,
      salvage: simulationData?.salvage ?? null,
      reseal: {
        result: reseal ?? null,
        sealName: simulationData?.reseal.sealName ?? manaSealName,
        unsupportedReason: simulationData?.reseal.unsupportedReason ?? null,
        sealItem: simulationData?.reseal.sealItem
          ? {
              id: simulationData.reseal.sealItem.id,
              name: simulationData.reseal.sealItem.name,
            }
          : null,
        sanity: reseal
          ? {
              expectedTotalCost:
                reseal.initialSetupCost +
                reseal.totalManaSealRetryCost +
                reseal.sealedUpgradeCost,
              totalEvSalvage: reseal.profitSalvage,
              evPerAttemptSalvage: reseal.expectedValueSalvage,
              silverPerLaborSalvage: reseal.silverPerLaborSalvage,
            }
          : null,
      },
    };
    const text = JSON.stringify(debugState, null, 2);
    console.info("Simulator debug state", debugState);

    const clearDebugCopyState = () =>
      window.setTimeout(() => setDebugCopyState(null), 2000);
    void navigator.clipboard.writeText(text).then(
      () => {
        setDebugCopyState("Copied");
        clearDebugCopyState();
      },
      () => {
        setDebugCopyState("Logged to console");
        clearDebugCopyState();
      },
    );
  };
  const saveWispPriceOverride = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!wisp) return;

    const parsed = parsePriceOverrideInput(currentWispPriceInput);
    if (parsed == null) return;

    setPriceOverride.mutate({ itemId: wisp.id, price: parsed });
  };

  const sealedUpgradeCostDetail = simulationData
    ? simulationData.base.upgradeMaterials
        .filter(({ item }) => isForcedAuctionHouseMaterial(item))
        .map(({ item, amount }) => {
          const lineTotal =
            getChosenMaterialUnitCost(
              item,
              ayanadSubcraftMap ?? data.subcraftsByItemId,
              upgradePriceMap,
              overrideMap,
              effectiveModes,
            ) * amount;
          const label =
            amount === 1 ? item.name : `${formatCount(amount)} × ${item.name}`;
          return `${label}: ${gold(lineTotal)}`;
        })
        .join(" + ") || null
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {item.icon && (
            <ItemIcon icon={item.icon} name={item.name} size="lg" />
          )}
          <div>
            <h1 className="text-3xl font-bold">{item.name}</h1>
            <p className="text-muted-foreground text-sm">
              {equip.category} &middot; {equip.tier}
              {equip.piece && ` · ${equip.piece}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {simulationData && mainCraft && (
            <>
              <Link
                to="/shoplist"
                search={{
                  craft: mainCraft.craft.id,
                  qty: 1,
                  simItem: item.id,
                  attempts: simulationData.salvage.variants,
                  strategy: "salvage",
                  sub: exportModes,
                }}
                className="text-muted-foreground text-xs hover:underline"
              >
                Export salvage shoplist →
              </Link>
              {simulationData.reseal.result ? (
                <Link
                  to="/shoplist"
                  search={{
                    craft: mainCraft.craft.id,
                    qty: 1,
                    simItem: item.id,
                    attempts: simulationData.reseal.result.variants - 1,
                    strategy: "reseal",
                    sub: exportModes,
                  }}
                  className="text-muted-foreground text-xs hover:underline"
                >
                  Export reseal shoplist →
                </Link>
              ) : null}
            </>
          )}
          <Link
            to="/craft/$itemId"
            params={{ itemId: item.id }}
            className="text-muted-foreground text-xs hover:underline"
          >
            View craft →
          </Link>
          {isDevelopment ? (
            <button
              type="button"
              onClick={copyDebugState}
              className="text-muted-foreground text-xs hover:underline"
            >
              {debugCopyState ?? "Dump debug state"}
            </button>
          ) : null}
        </div>
      </div>

      {wisp && (
        <form
          onSubmit={saveWispPriceOverride}
          className="flex flex-col gap-3 rounded-md border p-3 text-sm sm:flex-row sm:items-end sm:justify-between"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Wisp type:</span>
            <span className="font-medium">{wisp.name}</span>
            <span className="text-muted-foreground">·</span>
            <span className="font-medium tabular-nums">
              {wisp.price > 0
                ? `${wisp.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}g`
                : "no price data"}
            </span>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">
                Custom price (g)
              </span>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 1.5"
                value={currentWispPriceInput}
                onChange={(event) =>
                  setWispPriceInput({
                    itemId: wisp.id,
                    value: event.target.value,
                  })
                }
                className="w-full sm:w-36"
              />
            </label>
            <Button
              type="submit"
              disabled={parsePriceOverrideInput(currentWispPriceInput) == null}
              loading={setPriceOverride.isPending}
              loadingText="Saving..."
            >
              Save
            </Button>
          </div>
        </form>
      )}

      {simulationData ? (
        <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
          <Checkbox
            checked={glowingProcEnabled}
            onCheckedChange={(checked) =>
              setGlowingProcEnabled(checked === true)
            }
            aria-label="Glowing proc"
            className="mt-0.5"
          />
          <span className="flex min-w-0 flex-col gap-1">
            <span className="text-sm font-medium">Glowing proc</span>
            <span className="text-muted-foreground text-xs">
              Adds an independent 1/20 house-crafting chance to make a sealed
              Delphinad craft upgradable. Shoplist exports keep the existing
              full attempt counts.
            </span>
          </span>
        </label>
      ) : null}

      {data.crafts.length > 0 && (
        <div className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold">Craft breakdown</h2>
          {selectedRecipe ? (
            <RecipePicker
              crafts={data.crafts}
              itemId={data.item.id}
              priceMap={priceMap}
              overrideMap={overrideMap}
              subcraftMap={data.subcraftsByItemId}
              modes={effectiveModes}
              preferences={preferences}
              selectedRecipe={selectedRecipe}
              simulatorTarget={simulatorTarget}
              onSelectRecipe={setRecipePreference}
            />
          ) : null}
          {mainCraft ? (
            <SimulatorCraftBreakdown
              key={mainCraft.craft.id}
              entry={mainCraft}
              itemId={item.id}
              priceMap={priceMap}
              overrideMap={overrideMap}
              proficiencyMap={proficiencyMap}
              subcraftMap={data.subcraftsByItemId}
              modes={effectiveModes}
              setModes={setCraftModePreference}
              onSavePriceOverride={(itemId, price) =>
                setPriceOverride.mutate({ itemId, price })
              }
              collapsedCraftIds={collapsedCraftIds}
              toggleCollapsed={(craftId) =>
                setCollapsedCraftIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(craftId)) next.delete(craftId);
                  else next.add(craftId);
                  return next;
                })
              }
            />
          ) : null}
        </div>
      )}

      {simulationData ? (
        <SimulationResults
          salvage={simulationData.salvage}
          reseal={simulationData.reseal}
          sealedUpgradeCostDetail={sealedUpgradeCostDetail}
        />
      ) : (
        <p className="text-muted-foreground text-sm">
          {!wisp
            ? "Could not detect mana wisp type from craft chain."
            : equip.tier !== "delphinad" ||
                !data.item.name.toLowerCase().includes("sealed delphinad")
              ? "Simulator currently only supports Sealed Delphinad items."
              : wisp.price === 0
                ? "No market price found for " +
                  wisp.name +
                  ". Set a price override in your profile."
                : "Could not compute simulation — craft chain may not match expected pattern."}
        </p>
      )}
    </div>
  );
}

function SimulatorCraftBreakdown({
  entry,
  itemId,
  priceMap,
  overrideMap,
  proficiencyMap,
  subcraftMap,
  modes,
  setModes,
  onSavePriceOverride,
  collapsedCraftIds,
  toggleCollapsed,
  depth = 0,
}: {
  entry: CraftEntry;
  itemId: number;
  priceMap: PriceMap;
  overrideMap: OverrideMap;
  proficiencyMap: ProficiencyMap;
  subcraftMap: SubcraftMap;
  modes: CraftModeMap;
  setModes: (itemId: number, mode: CraftMode) => void;
  onSavePriceOverride: (itemId: number, price: number) => void;
  collapsedCraftIds: Set<number>;
  toggleCollapsed: (craftId: number) => void;
  depth?: number;
}) {
  const { craft, materials } = entry;
  const isCollapsed = collapsedCraftIds.has(craft.id);

  const total = materials.reduce((sum, { item, amount }) => {
    const unit = getChosenMaterialUnitCost(
      item,
      subcraftMap,
      priceMap,
      overrideMap,
      modes,
    );
    return sum + unit * amount;
  }, 0);

  const hasPrices = priceMap.size > 0 || overrideMap.size > 0;
  const hasCraftable = materials.some(
    ({ item }) => !!subcraftMap[item.id]?.length,
  );

  return (
    <RecipeCardShell depth={depth}>
      <RecipeHeader
        depth={depth}
        title={craft.name}
        proficiency={craft.proficiency}
        laborLabel={
          craft.labor > 0
            ? `${getDiscountedLabor(craft.labor, craft.proficiency, proficiencyMap)} labor`
            : null
        }
        materialsLabel={hasPrices ? formatGold(total) : null}
        collapseToggle={
          <button
            type="button"
            onClick={() => toggleCollapsed(craft.id)}
            className="text-muted-foreground hover:text-foreground shrink-0 text-xs"
            aria-label={isCollapsed ? "Expand craft" : "Collapse craft"}
          >
            {isCollapsed ? "▶" : "▼"}
          </button>
        }
        action={
          depth === 0 ? (
            <Link
              to="/craft/$itemId"
              params={{ itemId }}
              className="text-muted-foreground text-xs hover:underline"
            >
              Full craft →
            </Link>
          ) : null
        }
      />

      {!isCollapsed && (
        <>
          <ul className="flex flex-col gap-1">
            {materials.map(({ item, amount }) => {
              const isCraftable = !!subcraftMap[item.id]?.length;
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
                      subcraftMap,
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
              const subEntries = subcraftMap[item.id];
              const subEntry =
                isCraftable && subEntries?.length
                  ? pickCheapestCraft(
                      subEntries,
                      item.id,
                      (candidate, productItemId) =>
                        getCraftEntryUnitCost(
                          candidate,
                          productItemId,
                          subcraftMap,
                          priceMap,
                          overrideMap,
                          modes,
                        ),
                    )
                  : null;
              const subLabor = subEntry
                ? getChosenMaterialLabor(
                    item,
                    subcraftMap,
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
                      isCraftable ? (
                        <CraftModeToggle
                          mode={mode}
                          onBuy={() => setModes(item.id, "buy")}
                          onCraft={() => setModes(item.id, "craft")}
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
                              const parsed = Number.parseFloat(
                                event.currentTarget.value,
                              );
                              if (
                                Number.isFinite(parsed) &&
                                parsed > 0 &&
                                parsed !== buyUnit
                              ) {
                                onSavePriceOverride(item.id, parsed);
                              }
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.currentTarget.blur();
                              }
                            }}
                            className="bg-background w-24 rounded-md border px-2 py-1 text-right text-xs tabular-nums"
                          />
                          {isCustom && mode === "buy" ? (
                            <span className="text-primary mr-1 text-xs">
                              (custom)
                            </span>
                          ) : null}
                          {mode === "craft" &&
                          isCraftable &&
                          !forceBuy &&
                          subLabor > 0 ? (
                            <span className="mr-1 text-xs text-amber-500">
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
                            <span className="text-foreground ml-1.5 font-medium">
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

                  {mode === "craft" &&
                    isCraftable &&
                    !isForcedAuctionHouseMaterial(item) &&
                    subEntry && (
                      <li className="border-muted-foreground/20 my-0.5 ml-3 border-l-2 pl-3">
                        <SimulatorCraftBreakdown
                          entry={subEntry}
                          itemId={itemId}
                          priceMap={priceMap}
                          overrideMap={overrideMap}
                          proficiencyMap={proficiencyMap}
                          subcraftMap={subcraftMap}
                          modes={modes}
                          setModes={setModes}
                          onSavePriceOverride={onSavePriceOverride}
                          collapsedCraftIds={collapsedCraftIds}
                          toggleCollapsed={toggleCollapsed}
                          depth={depth + 1}
                        />
                      </li>
                    )}
                </Fragment>
              );
            })}
          </ul>

          {depth === 0 && hasCraftable ? <RecipeLegend /> : null}
        </>
      )}
    </RecipeCardShell>
  );
}

function RecipePicker({
  crafts,
  itemId,
  priceMap,
  overrideMap,
  subcraftMap,
  modes,
  preferences,
  selectedRecipe,
  simulatorTarget,
  onSelectRecipe,
}: {
  crafts: CraftEntry[];
  itemId: number;
  priceMap: PriceMap;
  overrideMap: OverrideMap;
  subcraftMap: SubcraftMap;
  modes: CraftModeMap;
  preferences: Record<string, number | undefined>;
  selectedRecipe: NonNullable<
    ReturnType<typeof pickPreferredSimulatorRecipe<CraftEntry>>
  >;
  simulatorTarget: SimulatorTarget;
  onSelectRecipe: (
    wispKey: SimulatorTarget["wispKey"],
    craftId: number,
  ) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {crafts.map((entry, index) => {
        const cost = getCraftEntryUnitCost(
          entry,
          itemId,
          subcraftMap,
          priceMap,
          overrideMap,
          modes,
        );
        const isSelected = entry.craft.id === selectedRecipe.selected.craft.id;
        const isCheapest = entry.craft.id === selectedRecipe.cheapest.craft.id;
        const isSaved = entry.craft.id === preferences[simulatorTarget.wispKey];

        return (
          <button
            key={entry.craft.id}
            type="button"
            onClick={() =>
              onSelectRecipe(simulatorTarget.wispKey, entry.craft.id)
            }
            className={`rounded-md border p-3 text-left transition-colors ${
              isSelected ? "border-primary bg-primary/5" : "hover:bg-muted/40"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Recipe {index + 1}</p>
                <p className="text-muted-foreground text-xs">
                  {entry.craft.name}
                </p>
              </div>
              <p className="text-sm font-semibold tabular-nums">{gold(cost)}</p>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {isCheapest ? (
                <span className="rounded bg-green-500/10 px-1.5 py-0.5 text-[11px] font-medium text-green-700 dark:text-green-400">
                  Cheapest
                </span>
              ) : null}
              {isSaved ? (
                <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 dark:text-blue-400">
                  Saved
                </span>
              ) : null}
              {isSelected ? (
                <span className="bg-primary/10 text-primary rounded px-1.5 py-0.5 text-[11px] font-medium">
                  Selected
                </span>
              ) : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function gold(value: number): string {
  return formatGold(value);
}

function pct(value: number): string {
  return (value * 100).toFixed(1) + "%";
}

function resultVariant(value: number) {
  return value > 0 ? "positive" : value < 0 ? "negative" : "neutral";
}

function StrategySummaryCard({
  title,
  result,
}: {
  title: string;
  result: SimulationResult;
}) {
  const successLabel =
    result.glowingProcChance > 0
      ? `${pct(result.successRate)} success`
      : `1/${result.variants} (${pct(result.successRate)})`;

  return (
    <div className="rounded-md border p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-semibold">{title}</h3>
        <span className="text-muted-foreground text-sm">{successLabel}</span>
      </div>
      {result.glowingProcChance > 0 ? (
        <p className="text-muted-foreground mb-3 text-xs">
          Includes {pct(result.glowingProcChance)} Glowing proc chance.
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard
          label="EV / attempt"
          value={gold(result.expectedValueSalvage)}
          variant={resultVariant(result.expectedValueSalvage)}
        />
        <StatCard
          label="Silver/labor"
          value={result.silverPerLaborSalvage.toFixed(2)}
          variant={resultVariant(result.silverPerLaborSalvage)}
        />
        <StatCard
          label="Total labor"
          value={result.totalLabor.toLocaleString()}
        />
      </div>
    </div>
  );
}

function SalvageLoopDetails({
  result,
  sealedUpgradeCostDetail,
}: {
  result: SalvageLoopSimulationResult;
  sealedUpgradeCostDetail: string | null;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <StatCard label="Initial Seed" value={gold(result.initialSeedCost)} />
      <StatCard
        label="Delphinad Craft Cost"
        value={gold(result.costPerAttempt)}
        detail={`Expected: ${gold(result.expectedAttemptsCost)}`}
      />
      <StatCard
        label="Ayanad Craft Cost"
        value={gold(result.sealedUpgradeCost)}
        detail={sealedUpgradeCostDetail}
      />
      <StatCard
        label="EV per attempt"
        value={gold(result.expectedValueSalvage)}
        variant={resultVariant(result.expectedValueSalvage)}
      />
      <StatCard
        label="Silver per labor"
        value={result.silverPerLaborSalvage.toFixed(2)}
        variant={resultVariant(result.silverPerLaborSalvage)}
      />
    </div>
  );
}

function ResealLoopDetails({
  result,
  sealedUpgradeCostDetail,
}: {
  result: ResealLoopSimulationResult;
  sealedUpgradeCostDetail: string | null;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <StatCard label="Initial Seed" value={gold(result.initialSeedCost)} />
      <StatCard
        label="Delphinad Craft Cost"
        value={gold(result.initialSealedCraftCost)}
        detail={`Retries: ${gold(result.totalManaSealRetryCost)}`}
      />
      <StatCard
        label="Ayanad Craft Cost"
        value={gold(result.sealedUpgradeCost)}
        detail={sealedUpgradeCostDetail}
      />
      <StatCard
        label="EV per attempt"
        value={gold(result.expectedValueSalvage)}
        variant={resultVariant(result.expectedValueSalvage)}
      />
      <StatCard
        label="Silver per labor"
        value={result.silverPerLaborSalvage.toFixed(2)}
        variant={resultVariant(result.silverPerLaborSalvage)}
      />
    </div>
  );
}

function SimulationResults({
  salvage,
  reseal,
  sealedUpgradeCostDetail,
}: {
  salvage: SalvageLoopSimulationResult;
  reseal: ResealStrategyData;
  sealedUpgradeCostDetail: string | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <StrategySummaryCard title="Salvage Loop" result={salvage} />
        {reseal.result ? (
          <StrategySummaryCard title="Reseal Loop" result={reseal.result} />
        ) : (
          <div className="rounded-md border border-dashed p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="font-semibold">Reseal Loop</h3>
              <span className="text-muted-foreground text-sm">Unsupported</span>
            </div>
            <p className="text-muted-foreground text-sm">
              {reseal.unsupportedReason ??
                "Could not compute the reseal strategy for this item."}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Salvage Loop details</h2>
        <SalvageLoopDetails
          result={salvage}
          sealedUpgradeCostDetail={sealedUpgradeCostDetail}
        />
      </div>

      {reseal.result && reseal.sealName ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Reseal Loop details</h2>
          <ResealLoopDetails
            result={reseal.result}
            sealedUpgradeCostDetail={sealedUpgradeCostDetail}
          />
        </div>
      ) : null}
    </div>
  );
}
