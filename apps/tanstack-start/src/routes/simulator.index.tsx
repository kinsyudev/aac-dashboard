import type { inferProcedureOutput } from "@trpc/server";
import { Suspense, useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import type { AppRouter } from "@acme/api";

import { ItemIcon } from "~/component/item-icon";
import { StatCard } from "~/component/stat-card";
import type { ProficiencyMap } from "~/lib/proficiency";
import { SIMULATOR_TARGETS } from "~/lib/simulator-catalog";
import type { SimulatorTarget } from "~/lib/simulator-catalog";
import {
  pickPreferredSimulatorRecipe,
  useSimulatorCraftModePreferences,
  useSimulatorRecipePreferences,
} from "~/lib/simulator-recipe-preferences";
import { resolveDelphinadManaSealName } from "~/lib/mana-seal";
import { getDiscountedLabor } from "~/lib/proficiency";
import {
  computeResealLoopSimulation,
  computeSimulation,
  detectPieceAndTier,
} from "~/lib/simulator";
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
} from "~/lib/simulator-upgrade";
import { useTRPC } from "~/lib/trpc";
import { useUserData } from "~/lib/useUserData";

type ForItemOutput = NonNullable<
  inferProcedureOutput<AppRouter["crafts"]["forItem"]>
>;
type PriceMap = Map<
  number,
  { avg24h: string | null; avg7d: string | null; avg30d: string | null }
>;
type OverrideMap = Map<number, number>;
type CraftMode = "buy" | "craft";

export const Route = createFileRoute("/simulator/")({
  head: () => ({
    meta: [
      { title: "Simulator | AAC Dashboard" },
      {
        name: "description",
        content:
          "Compare canonical Sealed Delphinad simulator targets by salvage-focused expected value.",
      },
    ],
  }),
  loader: ({ context }) => {
    for (const target of SIMULATOR_TARGETS) {
      void context.queryClient.prefetchQuery(
        context.trpc.crafts.forItem.queryOptions(target.itemId),
      );
    }
  },
  component: SimulatorIndex,
});

function SimulatorIndex() {
  return (
    <main className="container py-16">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Craft Simulator</h1>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm">
          Compare the representative Sealed Delphinad craft for each mana wisp
          type using salvage-focused expected value.
        </p>
      </div>
      <Suspense
        fallback={
          <p className="text-muted-foreground text-sm">
            Loading simulator dashboard...
          </p>
        }
      >
        <SimulatorDashboard />
      </Suspense>
    </main>
  );
}

function SimulatorDashboard() {
  const trpc = useTRPC();
  const { overrideMap, proficiencyMap } = useUserData();
  const { preferences } = useSimulatorRecipePreferences();

  const results = useQueries({
    queries: SIMULATOR_TARGETS.map((target) =>
      trpc.crafts.forItem.queryOptions(target.itemId),
    ),
  });

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {results.map((result, index) => {
        const target = SIMULATOR_TARGETS[index];
        if (!target) return null;

        return (
          <SimulatorDashboardCard
            key={target.itemId}
            target={target}
            data={result.data ?? null}
            overrideMap={overrideMap}
            proficiencyMap={proficiencyMap}
            preferences={preferences}
          />
        );
      })}
    </div>
  );
}

function SimulatorDashboardCard({
  target,
  data,
  overrideMap,
  proficiencyMap,
  preferences,
}: {
  target: SimulatorTarget;
  data: ForItemOutput | null;
  overrideMap: OverrideMap;
  proficiencyMap: ProficiencyMap;
  preferences: Record<string, number | undefined>;
}) {
  const trpc = useTRPC();
  const { modes } = useSimulatorCraftModePreferences(target.wispKey);
  const equip = useMemo(
    () => (data ? detectPieceAndTier(data.item.name) : null),
    [data],
  );
  const priceMap = useMemo<PriceMap>(
    () => new Map(data?.prices.map((price) => [price.itemId, price]) ?? []),
    [data],
  );
  const preferredRecipe = useMemo(() => {
    if (!data) return null;
    return pickPreferredSimulatorRecipe(
      data.crafts,
      target.wispKey,
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
  }, [data, modes, overrideMap, preferences, priceMap, target.wispKey]);
  const preferredMainCraft = preferredRecipe?.selected ?? null;
  const wisp = useMemo(
    () => (data ? findWispInChain(data, priceMap, overrideMap) : null),
    [data, overrideMap, priceMap],
  );

  const ayanadItemName = useMemo(
    () => (data ? getMatchingAyanadName(data.item.name) : null),
    [data],
  );
  const ayanadItemQuery = useQuery({
    ...trpc.items.byName.queryOptions(ayanadItemName ?? ""),
    enabled: !!ayanadItemName,
  });
  const ayanadItem = useMemo(
    () =>
      ayanadItemQuery.data?.find((item) => item.name === ayanadItemName) ??
      null,
    [ayanadItemName, ayanadItemQuery.data],
  );
  const ayanadCraftQuery = useQuery({
    ...trpc.crafts.forItem.queryOptions(ayanadItem?.id ?? -1),
    enabled: ayanadItem?.id != null,
  });
  const ayanadCraftData = ayanadCraftQuery.data ?? null;
  const ayanadPriceMap = useMemo<PriceMap>(
    () =>
      new Map(ayanadCraftData?.prices.map((price) => [price.itemId, price]) ?? []),
    [ayanadCraftData],
  );
  const upgradePriceMap = useMemo(
    () => mergePriceMaps(priceMap, ayanadPriceMap),
    [ayanadPriceMap, priceMap],
  );

  const manaSealName = useMemo(
    () =>
      data && equip
        ? resolveDelphinadManaSealName({
            name: data.item.name,
            category: data.item.category,
            equip,
          })
        : null,
    [data, equip],
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
  const manaSealPriceMap = useMemo<PriceMap>(
    () =>
      new Map(
        manaSealCraftQuery.data?.prices.map((price) => [price.itemId, price]) ??
          [],
      ),
    [manaSealCraftQuery.data],
  );
  const ayanadCraft = useMemo(() => {
    if (!ayanadCraftData?.crafts.length || ayanadItem == null || !equip) {
      return null;
    }
    return pickCheapestCraftForItem(
      ayanadCraftData.crafts.filter((entry) =>
        entry.materials.some(({ item }) =>
          isConsumedUpgradeGearMaterial(item, data.item, equip),
        ),
      ),
      ayanadItem.id,
      ayanadCraftData.subcraftsByItemId,
      upgradePriceMap,
      overrideMap,
      modes,
    );
  }, [
    ayanadCraftData,
    ayanadItem,
    data,
    equip,
    modes,
    overrideMap,
    upgradePriceMap,
  ]);
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
    manaSealCraft,
    manaSealCraftQuery.data,
    manaSealPriceMap,
    overrideMap,
    preferredMainCraft,
    priceMap,
  ]);
  const effectiveModes = useMemo(
    () => ({ ...recommendedModes, ...modes }),
    [recommendedModes, modes],
  );
  const selectedRecipe = useMemo(() => {
    if (!data) return null;
    return pickPreferredSimulatorRecipe(
      data.crafts,
      target.wispKey,
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
    target.wispKey,
  ]);
  const mainCraft = selectedRecipe?.selected ?? null;

  const card = useMemo(() => {
    if (!data || !equip || !mainCraft || !wisp) return null;

    const subcraftMap = data.subcraftsByItemId;
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
          ayanadCraftData?.subcraftsByItemId ?? subcraftMap,
          upgradePriceMap,
          overrideMap,
          effectiveModes,
        ) *
          amount,
      0,
    );
    const sealedUpgradeLabor = ayanadCraft
      ? getDiscountedLabor(
          ayanadCraft.craft.labor,
          ayanadCraft.craft.proficiency,
          proficiencyMap,
        ) +
        upgradeMaterials.reduce(
          (sum, { item, amount }) =>
            sum +
            getChosenMaterialLabor(
              item,
              ayanadCraftData?.subcraftsByItemId ?? subcraftMap,
              upgradePriceMap,
              overrideMap,
              proficiencyMap,
              effectiveModes,
            ) *
              amount,
          0,
        )
      : 0;

    const salvage = computeSimulation({
      rngTier: equip.tier,
      equip,
      wispPrice: wisp.price,
      costPerAttempt,
      sealedUpgradeCost,
      laborPerAttempt: laborPerAttempt + seedLabor,
      sealedUpgradeLabor,
      seedWispsPerAttempt,
    });

    let reseal = null;
    if (manaSealItem && manaSealCraftQuery.data?.crafts.length) {
      const sealCraft = manaSealCraft;
      const manaSealCost = getCraftEntryUnitCost(
        sealCraft,
        manaSealItem.id,
        manaSealCraftQuery.data.subcraftsByItemId,
        manaSealPriceMap,
        overrideMap,
        effectiveModes,
      );
      const manaSealLabor = getSelectedCraftUnitLabor(
        sealCraft,
        manaSealItem.id,
        manaSealCraftQuery.data.subcraftsByItemId,
        manaSealPriceMap,
        overrideMap,
        proficiencyMap,
        effectiveModes,
      );
      if (manaSealCost > 0) {
        reseal = computeResealLoopSimulation({
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
        });
      }
    }

    const result =
      reseal && reseal.expectedValueSalvage > salvage.expectedValueSalvage
        ? reseal
        : salvage;
    const delphinadCost =
      result.strategy === "reseal"
        ? result.initialSealedCraftCost
        : result.costPerAttempt;
    const expectedDetail =
      result.strategy === "reseal"
        ? `Retries: ${gold(result.totalManaSealRetryCost)}`
        : `Expected: ${gold(result.expectedAttemptsCost)}`;

    return { result, delphinadCost, expectedDetail };
  }, [
    ayanadCraftData,
    ayanadItem,
    data,
    effectiveModes,
    equip,
    mainCraft,
    manaSealCraft,
    manaSealCraftQuery.data,
    manaSealItem,
    manaSealPriceMap,
    overrideMap,
    priceMap,
    proficiencyMap,
    upgradePriceMap,
    wisp,
  ]);

  return (
    <Link
      to="/simulator/$itemId"
      params={{ itemId: target.itemId }}
      className="rounded-lg border p-4 transition-colors hover:bg-muted/30"
    >
      <div className="mb-4 flex items-center gap-3">
        {data?.item.icon ? (
          <ItemIcon icon={data.item.icon} name={data.item.name} size="md" />
        ) : null}
        <div>
          <p className="text-sm font-semibold">{target.wispLabel}</p>
          <p className="text-muted-foreground text-xs">{target.itemName}</p>
        </div>
      </div>

      {card ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <StatCard label="Initial Seed" value={gold(card.result.initialSeedCost)} />
          <StatCard
            label="Delphinad Craft Cost"
            value={gold(card.delphinadCost)}
            detail={card.expectedDetail}
          />
          <StatCard
            label="Ayanad Craft Cost"
            value={gold(card.result.sealedUpgradeCost)}
          />
          <StatCard
            label="EV per attempt"
            value={gold(card.result.expectedValueSalvage)}
            variant={resultVariant(card.result.expectedValueSalvage)}
          />
          <StatCard
            label="Silver per labor"
            value={card.result.silverPerLaborSalvage.toFixed(2)}
            variant={resultVariant(card.result.silverPerLaborSalvage)}
          />
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          Missing craft or price data for this simulator target.
        </p>
      )}
    </Link>
  );
}

function findWispInChain(
  data: ForItemOutput,
  priceMap: PriceMap,
  overrideMap: OverrideMap,
) {
  const allMaterials = data.crafts.flatMap((craft) =>
    craft.materials.map((material) => material.item),
  );
  const wisp = allMaterials.find((item) =>
    item.name.toLowerCase().includes("mana wisp"),
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
  subcraftMap: ForItemOutput["subcraftsByItemId"],
  priceMap: PriceMap,
  overrideMap: OverrideMap,
  modes: Record<number, CraftMode>,
) {
  const isCraftable = !!subcraftMap[item.id]?.length;
  const mode = modes[item.id] ?? "buy";
  if (isCraftable && mode === "craft" && !isForcedAuctionHouseMaterial(item)) {
    return deepCraftCost(item.id, subcraftMap, priceMap, overrideMap, modes);
  }
  return getItemPrice(item.id, priceMap, overrideMap);
}

function deepCraftLabor(
  itemId: number,
  subcraftMap: ForItemOutput["subcraftsByItemId"],
  priceMap: PriceMap,
  overrideMap: OverrideMap,
  proficiencyMap: ProficiencyMap,
  modes: Record<number, CraftMode>,
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

function getChosenMaterialLabor(
  item: { id: number; name: string },
  subcraftMap: ForItemOutput["subcraftsByItemId"],
  priceMap: PriceMap,
  overrideMap: OverrideMap,
  proficiencyMap: ProficiencyMap,
  modes: Record<number, CraftMode>,
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

function getSelectedCraftUnitLabor(
  entry: ForItemOutput["crafts"][number],
  itemId: number,
  subcraftMap: ForItemOutput["subcraftsByItemId"],
  priceMap: PriceMap,
  overrideMap: OverrideMap,
  proficiencyMap: ProficiencyMap,
  modes: Record<number, CraftMode>,
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
  subcraftMap: ForItemOutput["subcraftsByItemId"],
  priceMap: PriceMap,
  overrideMap: OverrideMap,
  modes: Record<number, CraftMode>,
  visited = new Set<number>(),
): number {
  if (visited.has(itemId)) return 0;
  visited.add(itemId);

  const subEntries = subcraftMap[itemId];
  if (!subEntries?.length) return 0;

  const entry = pickCheapestCraftForItem(
    subEntries,
    itemId,
    subcraftMap,
    priceMap,
    overrideMap,
    modes,
  );
  const produced =
    entry.products.find((product) => product.item.id === itemId)?.amount ?? 1;

  let total = 0;
  for (const { item, amount } of entry.materials) {
    if (item.name.toLowerCase().includes("mana wisp")) {
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

function isConsumedUpgradeGearMaterial(
  material: { name: string; category?: string | null },
  source: { category: string },
  equip: NonNullable<ReturnType<typeof detectPieceAndTier>>,
) {
  const lower = material.name.toLowerCase();
  if (!lower.includes("delphinad") && !lower.includes("ayanad")) return false;
  if (lower.includes("scroll")) return false;

  if (
    material.category != null &&
    material.category.toLowerCase() === source.category.toLowerCase()
  ) {
    return true;
  }

  return equip.pieceToken != null && lower.includes(equip.pieceToken);
}

function gold(value: number) {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}g`;
}

function resultVariant(value: number) {
  return value > 0 ? "positive" : value < 0 ? "negative" : "neutral";
}
