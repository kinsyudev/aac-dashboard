import type { inferProcedureOutput } from "@trpc/server";
import { Fragment, Suspense, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { z } from "zod";

import type { AppRouter } from "@acme/api";

import type { ProficiencyMap } from "~/lib/proficiency";
import type { SimulationResult } from "~/lib/simulator";
import { ItemIcon } from "~/component/item-icon";
import { ProficiencyBadge } from "~/component/proficiency";
import {
  CraftModeToggle,
  RecipeCardShell,
  RecipeHeader,
  RecipeItemRow,
  RecipeLegend,
} from "~/component/recipe-breakdown";
import { StatCard } from "~/component/stat-card";
import { pickCheapestCraft } from "~/lib/craft-helpers";
import { buildMetaTags, buildPageTitle, getItemIconUrl } from "~/lib/metadata";
import { getDiscountedLabor } from "~/lib/proficiency";
import { computeSimulation, detectPieceAndTier } from "~/lib/simulator";
import {
  deepCraftCost,
  getCraftEntryUnitCost,
  getItemPrice,
  getMarketPrice,
  getSimulationChain,
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
        ← Back to search
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
type SubcraftEntry = ForItemOutput["subcraftsByItemId"][number][number];
type PriceMap = Map<
  number,
  { avg24h: string | null; avg7d: string | null; avg30d: string | null }
>;
type OverrideMap = Map<number, number>;
type SubcraftMap = ForItemOutput["subcraftsByItemId"];

interface CraftExecution {
  craftId: number;
  name: string;
  proficiency: string | null;
  batches: number;
  laborPerBatch: number;
}

function formatGold(value: number): string {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}g`;
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
  modes: Record<number, CraftMode> = {},
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
    if (subEntries?.length && mode === "craft") {
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
  itemId: number,
  subcraftMap: SubcraftMap,
  priceMap: PriceMap,
  overrideMap: OverrideMap,
  modes: Record<number, CraftMode>,
): number {
  const isCraftable = !!subcraftMap[itemId]?.length;
  const mode = modes[itemId] ?? "buy";
  if (isCraftable && mode === "craft") {
    return deepCraftCost(itemId, subcraftMap, priceMap, overrideMap, modes);
  }
  return getItemPrice(itemId, priceMap, overrideMap);
}

function getChosenMaterialLabor(
  itemId: number,
  subcraftMap: SubcraftMap,
  priceMap: PriceMap,
  overrideMap: OverrideMap,
  proficiencyMap: ProficiencyMap,
  modes: Record<number, CraftMode>,
): number {
  const isCraftable = !!subcraftMap[itemId]?.length;
  const mode = modes[itemId] ?? "buy";
  if (isCraftable && mode === "craft") {
    return deepCraftLabor(
      itemId,
      subcraftMap,
      priceMap,
      overrideMap,
      proficiencyMap,
      modes,
    );
  }
  return 0;
}

function buildRecommendedModes(
  materials: { item: { id: number } }[],
  subcraftMap: SubcraftMap,
  priceMap: PriceMap,
  overrideMap: OverrideMap,
): Record<number, CraftMode> {
  const acc: Record<number, CraftMode> = {};
  const visited = new Set<number>();

  const visit = (itemId: number) => {
    if (visited.has(itemId)) return;
    visited.add(itemId);

    const subEntries = subcraftMap[itemId];
    if (!subEntries?.length) return;

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
        ),
    );
    for (const mat of entry.materials) {
      visit(mat.item.id);
    }

    const buyUnit = getItemPrice(itemId, priceMap, overrideMap);
    const craftUnit = deepCraftCost(itemId, subcraftMap, priceMap, overrideMap);
    acc[itemId] = buyUnit > 0 && craftUnit < buyUnit ? "craft" : "buy";
  };

  for (const mat of materials) {
    visit(mat.item.id);
  }

  return acc;
}

function countManaWispsForItem(
  itemId: number,
  subcraftMap: SubcraftMap,
  priceMap: PriceMap,
  overrideMap: OverrideMap,
  modes: Record<number, CraftMode>,
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

function serializeCraftModes(
  modes: Record<number, CraftMode>,
): string | undefined {
  const craftIds = Object.entries(modes)
    .filter(([, mode]) => mode === "craft")
    .map(([id]) => Number(id))
    .sort((a, b) => a - b);
  return craftIds.length ? craftIds.join(",") : undefined;
}

function collectCraftExecutionsForItem(
  itemId: number,
  requiredUnits: number,
  subcraftMap: SubcraftMap,
  priceMap: PriceMap,
  overrideMap: OverrideMap,
  proficiencyMap: ProficiencyMap,
  modes: Record<number, CraftMode>,
  acc: Map<number, CraftExecution>,
  visited = new Set<number>(),
) {
  const subEntries = subcraftMap[itemId];
  if (!subEntries?.length || visited.has(itemId)) return;

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
  const batches = Math.ceil(requiredUnits / produced);

  const existing = acc.get(entry.craft.id);
  if (existing) existing.batches += batches;
  else {
    acc.set(entry.craft.id, {
      craftId: entry.craft.id,
      name: entry.craft.name,
      proficiency: entry.craft.proficiency,
      batches,
      laborPerBatch: getDiscountedLabor(
        entry.craft.labor,
        entry.craft.proficiency,
        proficiencyMap,
      ),
    });
  }

  visited.add(itemId);
  for (const { item, amount } of entry.materials) {
    if ((modes[item.id] ?? "buy") === "craft") {
      collectCraftExecutionsForItem(
        item.id,
        amount * batches,
        subcraftMap,
        priceMap,
        overrideMap,
        proficiencyMap,
        modes,
        acc,
        new Set(visited),
      );
    }
  }
}

function SimulatorDetail() {
  const trpc = useTRPC();
  const data = Route.useLoaderData();
  const { proficiencyMap, overrideMap } = useUserData();
  const [modes, setModes] = useState<Record<number, CraftMode>>({});
  const [collapsedCraftIds, setCollapsedCraftIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [localSalePrice, setLocalSalePrice] = useState("");

  const priceMap: PriceMap = useMemo(
    () => new Map(data.prices.map((p) => [p.itemId, p])),
    [data],
  );

  const equip = useMemo(() => detectPieceAndTier(data.item.name), [data]);

  const wisp = useMemo(
    () => findWispInChain(data, priceMap, overrideMap),
    [data, priceMap, overrideMap],
  );
  const { ayanadItem, ayanadCraftData } = useAyanadUpgradeData(data.item.name);
  const ayanadPriceQuery = useQuery({
    ...trpc.items.price.queryOptions(ayanadItem?.id ?? -1),
    enabled: ayanadItem?.id != null,
  });
  const ayanadMarketPrice = useMemo(
    () => getMarketPrice(ayanadPriceQuery.data),
    [ayanadPriceQuery.data],
  );
  const defaultSalePrice = useMemo(() => {
    if (ayanadItem == null) return 0;
    return overrideMap.get(ayanadItem.id) ?? ayanadMarketPrice;
  }, [ayanadItem, ayanadMarketPrice, overrideMap]);
  const effectiveSalePrice = useMemo(() => {
    const parsed = parseFloat(localSalePrice);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultSalePrice;
  }, [defaultSalePrice, localSalePrice]);

  const mainCraft = useMemo(() => {
    if (!data.crafts.length) return null;
    const subcraftMap = data.subcraftsByItemId;
    return pickCheapestCraftForItem(
      data.crafts,
      data.item.id,
      subcraftMap,
      priceMap,
      overrideMap,
      modes,
    );
  }, [data, modes, overrideMap, priceMap]);

  const ayanadCraft = useMemo(() => {
    if (!ayanadCraftData?.crafts.length || ayanadItem == null) return null;
    const subcraftMap = ayanadCraftData.subcraftsByItemId;
    return pickCheapestCraftForItem(
      ayanadCraftData.crafts,
      ayanadItem.id,
      subcraftMap,
      priceMap,
      overrideMap,
      modes,
    );
  }, [ayanadCraftData, ayanadItem, modes, overrideMap, priceMap]);
  const ayanadSubcraftMap = ayanadCraftData?.subcraftsByItemId;

  const recommendedModes = useMemo(() => {
    if (!mainCraft) return {};
    return buildRecommendedModes(
      mainCraft.materials,
      data.subcraftsByItemId,
      priceMap,
      overrideMap,
    );
  }, [data, mainCraft, priceMap, overrideMap]);
  const effectiveModes = useMemo(
    () => ({ ...recommendedModes, ...modes }),
    [recommendedModes, modes],
  );

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
          item.id,
          subcraftMap,
          priceMap,
          overrideMap,
          effectiveModes,
        ) *
          amount,
      0,
    );
    const upgradeMaterials = ayanadCraft
      ? ayanadCraft.materials.filter(({ item }) => {
          const lower = item.name.toLowerCase();
          return !(lower.includes("delphinad") || lower.includes("ayanad"));
        })
      : [];
    const sealedUpgradeCost = upgradeMaterials.reduce(
      (sum, { item, amount }) =>
        sum +
        getChosenMaterialUnitCost(
          item.id,
          ayanadSubcraftMap ?? subcraftMap,
          priceMap,
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
            item.id,
            ayanadSubcraftMap ?? subcraftMap,
            priceMap,
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
    const laborPerAttempt =
      getDiscountedLabor(
        mainCraft.craft.labor,
        mainCraft.craft.proficiency,
        proficiencyMap,
      ) +
      (chain.keyMaterialId
        ? deepCraftLabor(
            chain.keyMaterialId,
            subcraftMap,
            priceMap,
            overrideMap,
            proficiencyMap,
            effectiveModes,
          )
        : 0) +
      attemptMaterials.reduce(
        (sum, { item, amount }) =>
          sum +
          getChosenMaterialLabor(
            item.id,
            subcraftMap,
            priceMap,
            overrideMap,
            proficiencyMap,
            effectiveModes,
          ) *
            amount,
        0,
      );

    const result = computeSimulation({
      costPerAttempt,
      sealedUpgradeCost,
      rngTier: equip.tier,
      equip,
      wispPrice: wisp.price,
      sellPrice: effectiveSalePrice,
      laborPerAttempt,
      sealedUpgradeLabor,
      seedWispsPerAttempt,
    });

    return {
      result,
      chain,
      mainCraft,
      ayanadCraft,
      attemptMaterials,
      seedWispsPerAttempt,
      upgradeMaterials,
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
    effectiveSalePrice,
    ayanadCraft,
    ayanadSubcraftMap,
  ]);

  const craftExecutions = useMemo(() => {
    if (!simulationData) return [];

    const acc = new Map<number, CraftExecution>();
    const subcraftMap = data.subcraftsByItemId;
    const {
      chain,
      result,
      mainCraft,
      ayanadCraft,
      attemptMaterials,
      upgradeMaterials,
    } = simulationData;

    if (chain.keyMaterialId) {
      collectCraftExecutionsForItem(
        chain.keyMaterialId,
        result.variants,
        subcraftMap,
        priceMap,
        overrideMap,
        proficiencyMap,
        effectiveModes,
        acc,
      );
    }

    for (const { item, amount } of attemptMaterials) {
      if ((effectiveModes[item.id] ?? "buy") === "craft") {
        collectCraftExecutionsForItem(
          item.id,
          amount * result.variants,
          subcraftMap,
          priceMap,
          overrideMap,
          proficiencyMap,
          effectiveModes,
          acc,
        );
      }
    }

    const existing = acc.get(mainCraft.craft.id);
    if (existing) existing.batches += result.variants;
    else {
      acc.set(mainCraft.craft.id, {
        craftId: mainCraft.craft.id,
        name: mainCraft.craft.name,
        proficiency: mainCraft.craft.proficiency,
        batches: result.variants,
        laborPerBatch: getDiscountedLabor(
          mainCraft.craft.labor,
          mainCraft.craft.proficiency,
          proficiencyMap,
        ),
      });
    }

    if (ayanadCraft) {
      const existingUpgrade = acc.get(ayanadCraft.craft.id);
      if (existingUpgrade) existingUpgrade.batches += 1;
      else {
        acc.set(ayanadCraft.craft.id, {
          craftId: ayanadCraft.craft.id,
          name: ayanadCraft.craft.name,
          proficiency: ayanadCraft.craft.proficiency,
          batches: 1,
          laborPerBatch: getDiscountedLabor(
            ayanadCraft.craft.labor,
            ayanadCraft.craft.proficiency,
            proficiencyMap,
          ),
        });
      }
    }

    const upgradeSubcraftMap =
      ayanadCraftData?.subcraftsByItemId ?? subcraftMap;
    for (const { item, amount } of upgradeMaterials) {
      if ((effectiveModes[item.id] ?? "buy") === "craft") {
        collectCraftExecutionsForItem(
          item.id,
          amount,
          upgradeSubcraftMap,
          priceMap,
          overrideMap,
          proficiencyMap,
          effectiveModes,
          acc,
        );
      }
    }

    for (const craft of acc.values()) {
      if (craft.laborPerBatch > 0) continue;
      const subEntry = Object.values(upgradeSubcraftMap)
        .flat()
        .find((entry) => entry.craft.id === craft.craftId);
      if (!subEntry) continue;
      craft.laborPerBatch = getDiscountedLabor(
        subEntry.craft.labor,
        subEntry.craft.proficiency,
        proficiencyMap,
      );
    }

    return [...acc.values()].sort((a, b) => b.batches - a.batches);
  }, [
    ayanadCraftData,
    data,
    effectiveModes,
    overrideMap,
    priceMap,
    proficiencyMap,
    simulationData,
  ]);

  const laborByProficiency = useMemo(() => {
    const acc = new Map<string, number>();
    for (const craft of craftExecutions) {
      if (!craft.proficiency || craft.laborPerBatch <= 0) continue;
      acc.set(
        craft.proficiency,
        (acc.get(craft.proficiency) ?? 0) + craft.laborPerBatch * craft.batches,
      );
    }
    return [...acc.entries()].sort((a, b) => b[1] - a[1]);
  }, [craftExecutions]);

  if (!equip) {
    return (
      <p className="text-muted-foreground text-sm">
        Could not detect tier/piece for this item.
      </p>
    );
  }

  const { item } = data;
  const exportModes = serializeCraftModes(effectiveModes);

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
            <Link
              to="/shoplist"
              search={{
                craft: mainCraft.craft.id,
                qty: 1,
                simItem: item.id,
                attempts: simulationData.result.variants,
                sub: exportModes,
              }}
              className="text-muted-foreground text-xs hover:underline"
            >
              Export shoplist →
            </Link>
          )}
          <Link
            to="/craft/$itemId"
            params={{ itemId: item.id }}
            className="text-muted-foreground text-xs hover:underline"
          >
            View craft →
          </Link>
        </div>
      </div>

      {wisp && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Wisp type:</span>
          <span className="font-medium">{wisp.name}</span>
          <span className="text-muted-foreground">·</span>
          <span className="font-medium tabular-nums">
            {wisp.price > 0
              ? `${wisp.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}g`
              : "no price data"}
          </span>
        </div>
      )}

      {ayanadItem && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border p-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{ayanadItem.name} sale price</p>
            <p className="text-muted-foreground text-xs">
              Uses market or profile override by default. Enter a local value to
              override this simulation.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              step="0.01"
              value={localSalePrice}
              onChange={(e) => setLocalSalePrice(e.target.value)}
              placeholder={
                defaultSalePrice > 0 ? String(defaultSalePrice) : "0"
              }
              className="bg-background w-32 rounded-md border px-3 py-1.5 text-sm tabular-nums"
            />
            <span className="text-muted-foreground text-sm">g</span>
          </div>
        </div>
      )}

      {craftExecutions.length > 0 && (
        <div className="rounded-md border p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Crafts being done</h2>
            {simulationData && (
              <p className="text-muted-foreground text-sm">
                Expected attempts:{" "}
                <span className="text-foreground font-medium">
                  ×{simulationData.result.variants}
                </span>
              </p>
            )}
          </div>
          {laborByProficiency.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {laborByProficiency.map(([proficiency, labor]) => (
                <ProficiencyBadge
                  key={proficiency}
                  proficiency={proficiency}
                  suffix={` ${labor.toLocaleString()} labor`}
                />
              ))}
            </div>
          )}
          <ul className="flex flex-col gap-2">
            {craftExecutions.map((craft) => (
              <li
                key={craft.craftId}
                className="hover:bg-muted/40 flex items-center justify-between gap-3 rounded px-2 py-1.5 text-sm"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="font-medium">{craft.name}</span>
                  <ProficiencyBadge proficiency={craft.proficiency} />
                </div>
                <div className="text-muted-foreground flex items-center gap-3 tabular-nums">
                  {craft.laborPerBatch > 0 && (
                    <span>
                      {(craft.laborPerBatch * craft.batches).toLocaleString()}L
                    </span>
                  )}
                  <span>×{craft.batches.toLocaleString()}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.crafts.length > 0 && (
        <div className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold">Craft breakdown</h2>
          {data.crafts.map((entry) => (
            <SimulatorCraftBreakdown
              key={entry.craft.id}
              entry={entry}
              itemId={item.id}
              priceMap={priceMap}
              overrideMap={overrideMap}
              proficiencyMap={proficiencyMap}
              subcraftMap={data.subcraftsByItemId}
              modes={effectiveModes}
              setModes={setModes}
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
          ))}
        </div>
      )}

      {simulationData ? (
        <SimulationResults result={simulationData.result} />
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
  collapsedCraftIds,
  toggleCollapsed,
  depth = 0,
}: {
  entry: CraftEntry | SubcraftEntry;
  itemId: number;
  priceMap: PriceMap;
  overrideMap: OverrideMap;
  proficiencyMap: ProficiencyMap;
  subcraftMap: SubcraftMap;
  modes: Record<number, CraftMode>;
  setModes: React.Dispatch<React.SetStateAction<Record<number, CraftMode>>>;
  collapsedCraftIds: Set<number>;
  toggleCollapsed: (craftId: number) => void;
  depth?: number;
}) {
  const { craft, materials } = entry;
  const isCollapsed = collapsedCraftIds.has(craft.id);

  const total = materials.reduce((sum, { item, amount }) => {
    const unit = getChosenMaterialUnitCost(
      item.id,
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
              const craftUnit = isCraftable
                ? deepCraftCost(
                    item.id,
                    subcraftMap,
                    priceMap,
                    overrideMap,
                    modes,
                  )
                : 0;
              const unit =
                mode === "craft" && isCraftable ? craftUnit : buyUnit;
              const lineTotal = unit * amount;
              const hasPrice = isCustom || !!price;
              const totalDiff =
                isCraftable && hasPrice ? (buyUnit - craftUnit) * amount : null;
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
                    item.id,
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
                          onBuy={() =>
                            setModes((prev) => ({ ...prev, [item.id]: "buy" }))
                          }
                          onCraft={() =>
                            setModes((prev) => ({
                              ...prev,
                              [item.id]: "craft",
                            }))
                          }
                        />
                      ) : null
                    }
                    value={
                      hasPrice || mode === "craft" ? (
                        <span className="text-muted-foreground shrink-0 tabular-nums">
                          {isCustom && mode === "buy" ? (
                            <span className="text-primary mr-1 text-xs">
                              (custom)
                            </span>
                          ) : null}
                          {mode === "craft" && isCraftable && subLabor > 0 ? (
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

                  {mode === "craft" && isCraftable && subEntry && (
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

function gold(value: number): string {
  return formatGold(value);
}

function pct(value: number): string {
  return (value * 100).toFixed(1) + "%";
}

function SimulationResults({ result }: { result: SimulationResult }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Success rate"
          value={`1/${result.variants} (${pct(result.successRate)})`}
        />
        <StatCard label="Total cost" value={gold(result.totalCost)} />
        <StatCard
          label="Profit (salvage)"
          value={gold(result.profitSalvage)}
          variant={
            result.profitSalvage > 0
              ? "positive"
              : result.profitSalvage < 0
                ? "negative"
                : "neutral"
          }
        />
        <StatCard
          label="Profit (sell)"
          value={gold(result.profitSell)}
          variant={
            result.profitSell > 0
              ? "positive"
              : result.profitSell < 0
                ? "negative"
                : "neutral"
          }
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard
          label="Cost per attempt"
          value={gold(result.costPerAttempt)}
        />
        <StatCard
          label={`Expected attempts (×${result.variants})`}
          value={gold(result.expectedAttemptsCost)}
        />
        <StatCard
          label="Initial seed wisps"
          value={gold(result.initialSeedCost)}
        />
        <StatCard
          label="Fail salvage"
          value={`${result.failSalvageWisps} wisps = ${gold(result.failRecoveryPerAttempt)}`}
          variant="positive"
        />
        <StatCard
          label="Net cost per fail"
          value={gold(result.costPerAttempt - result.failNetRecoveryPerAttempt)}
        />
        <StatCard
          label="Sealed upgrade cost"
          value={gold(result.sealedUpgradeCost)}
        />
        <StatCard
          label={`Net fail recovery (×${result.variants - 1})`}
          value={`${result.failSurplusWisps} × ${result.variants - 1} = ${gold(result.totalFailNetRecovery)}`}
          variant="positive"
        />
        <StatCard label="Salvage wisps" value={`${result.salvageWisps}`} />
        <StatCard
          label="Revenue (salvage)"
          value={gold(result.revenueSalvage)}
        />
        <StatCard label="Revenue (sell)" value={gold(result.revenueSell)} />
        <StatCard
          label="Total labor"
          value={result.totalLabor.toLocaleString()}
        />
        <StatCard
          label="Silver/labor (salvage)"
          value={result.silverPerLaborSalvage.toFixed(2)}
          variant={
            result.silverPerLaborSalvage > 0
              ? "positive"
              : result.silverPerLaborSalvage < 0
                ? "negative"
                : "neutral"
          }
        />
        <StatCard
          label="Silver/labor (sell)"
          value={result.silverPerLaborSell.toFixed(2)}
          variant={
            result.silverPerLaborSell > 0
              ? "positive"
              : result.silverPerLaborSell < 0
                ? "negative"
                : "neutral"
          }
        />
      </div>
    </div>
  );
}
