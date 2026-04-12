import type { inferProcedureOutput } from "@trpc/server";
import { Fragment, Suspense, useEffect, useMemo, useState } from "react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { z } from "zod";

import type { AppRouter } from "@acme/api";

import { ItemIcon } from "~/component/item-icon";
import { ProficiencyBadge } from "~/component/proficiency";
import { pickPreferredCraft } from "~/lib/craft-helpers";
import { getDiscountedLabor } from "~/lib/proficiency";
import type { ProficiencyMap } from "~/lib/proficiency";
import { computeSimulation, detectPieceAndTier } from "~/lib/simulator";
import type { SimulationResult } from "~/lib/simulator";
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
    if (!data) throw notFound();
  },
  component: SimulatorItemPage,
  notFoundComponent: () => <p>Item not found.</p>,
});

function SimulatorItemPage() {
  const { itemId } = Route.useParams();
  return (
    <main className="container py-16">
      <Link
        to="/simulator"
        className="text-muted-foreground mb-6 flex items-center gap-1 text-sm hover:underline"
      >
        ← Back to search
      </Link>
      <Suspense fallback={<p>Loading...</p>}>
        <SimulatorDetail itemId={itemId} />
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
type PriceMap = Map<number, { avg24h: string | null; avg7d: string | null }>;
type OverrideMap = Map<number, number>;
type SubcraftMap = ForItemOutput["subcraftsByItemId"];

type SimulationChain = {
  keyMaterialId: number | null;
  keyMaterialName: string | null;
  upgradeMaterials: CraftEntry["materials"];
};

type CraftExecution = {
  craftId: number;
  name: string;
  proficiency: string | null;
  batches: number;
  laborPerBatch: number;
};

function getItemPrice(
  itemId: number,
  priceMap: PriceMap,
  overrideMap: OverrideMap,
): number {
  const custom = overrideMap.get(itemId);
  if (custom != null) return custom;
  const price = priceMap.get(itemId);
  return parseFloat(price?.avg24h ?? price?.avg7d ?? "0");
}

function craftMaterialCost(
  materials: { item: { id: number }; amount: number }[],
  priceMap: PriceMap,
  overrideMap: OverrideMap,
): number {
  return materials.reduce(
    (sum, { item, amount }) =>
      sum + getItemPrice(item.id, priceMap, overrideMap) * amount,
    0,
  );
}

function isManaWisp(name: string): boolean {
  return name.toLowerCase().includes("mana wisp");
}

function getMatchingAyanadName(name: string): string | null {
  if (!name.toLowerCase().includes("sealed delphinad")) return null;
  return name.replace(/delphinad/i, "Ayanad");
}

function deepCraftCost(
  itemId: number,
  subcraftMap: SubcraftMap,
  priceMap: PriceMap,
  overrideMap: OverrideMap,
  modes: Record<number, CraftMode> = {},
  visited = new Set<number>(),
): number {
  if (visited.has(itemId)) return getItemPrice(itemId, priceMap, overrideMap);
  visited.add(itemId);

  const entries = subcraftMap[itemId];
  if (!entries?.length) return getItemPrice(itemId, priceMap, overrideMap);

  const entry = pickPreferredCraft(entries, itemId);
  const produced =
    entry.products.find((p) => p.item.id === itemId)?.amount ?? 1;

  const batchCost = entry.materials.reduce((sum, { item, amount }) => {
    const subEntries = subcraftMap[item.id];
    const mode = modes[item.id] ?? "craft";
    const unitCost =
      subEntries?.length && mode === "craft"
        ? deepCraftCost(
            item.id,
            subcraftMap,
            priceMap,
            overrideMap,
            modes,
            new Set(visited),
          )
        : getItemPrice(item.id, priceMap, overrideMap);
    return sum + unitCost * amount;
  }, 0);

  return batchCost / produced;
}

function deepCraftLabor(
  itemId: number,
  subcraftMap: SubcraftMap,
  proficiencyMap: ProficiencyMap,
  modes: Record<number, CraftMode> = {},
  visited = new Set<number>(),
): number {
  if (visited.has(itemId)) return 0;
  visited.add(itemId);

  const entries = subcraftMap[itemId];
  if (!entries?.length) return 0;

  const entry = pickPreferredCraft(entries, itemId);
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
  const subcraftMap = data.subcraftsByItemId ?? {};
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

function getSimulationChain(
  mainCraft: CraftEntry,
  subcraftMap: SubcraftMap,
): SimulationChain {
  const tierList = [
    "illustrious",
    "magnificent",
    "epherium",
    "delphinad",
    "ayanad",
  ] as const;

  let keyMaterialId: number | null = null;
  let keyMaterialName: string | null = null;

  for (const mat of mainCraft.materials) {
    const n = mat.item.name.toLowerCase();
    if (tierList.some((t) => n.includes(t))) {
      keyMaterialId = mat.item.id;
      keyMaterialName = mat.item.name;
      break;
    }
  }

  if (!keyMaterialId) {
    for (const mat of mainCraft.materials) {
      if (subcraftMap[mat.item.id]?.length) {
        keyMaterialId = mat.item.id;
        keyMaterialName = mat.item.name;
        break;
      }
    }
  }

  return {
    keyMaterialId,
    keyMaterialName,
    upgradeMaterials: mainCraft.materials.filter(
      ({ item }) => item.id !== keyMaterialId,
    ),
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
  proficiencyMap: ProficiencyMap,
  modes: Record<number, CraftMode>,
): number {
  const isCraftable = !!subcraftMap[itemId]?.length;
  const mode = modes[itemId] ?? "buy";
  if (isCraftable && mode === "craft") {
    return deepCraftLabor(itemId, subcraftMap, proficiencyMap, modes);
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

    const entry = pickPreferredCraft(subEntries, itemId);
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
  modes: Record<number, CraftMode>,
  visited = new Set<number>(),
): number {
  if (visited.has(itemId)) return 0;
  visited.add(itemId);

  const subEntries = subcraftMap[itemId];
  if (!subEntries?.length) return 0;

  const entry = pickPreferredCraft(subEntries, itemId);
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
        countManaWispsForItem(item.id, subcraftMap, modes, new Set(visited)) *
        amount;
    }
  }

  return total / produced;
}

function serializeCraftModes(modes: Record<number, CraftMode>): string | undefined {
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
  modes: Record<number, CraftMode>,
  acc: Map<number, CraftExecution>,
  visited = new Set<number>(),
) {
  const subEntries = subcraftMap[itemId];
  if (!subEntries?.length || visited.has(itemId)) return;

  const entry = pickPreferredCraft(subEntries, itemId);
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
      laborPerBatch: 0,
    });
  }

  visited.add(itemId);
  for (const { item, amount } of entry.materials) {
    if ((modes[item.id] ?? "buy") === "craft") {
      collectCraftExecutionsForItem(
        item.id,
        amount * batches,
        subcraftMap,
        modes,
        acc,
        new Set(visited),
      );
    }
  }
}

function SimulatorDetail({ itemId }: { itemId: number }) {
  const trpc = useTRPC();
  const { data } = useSuspenseQuery(trpc.crafts.forItem.queryOptions(itemId));
  const { proficiencyMap, overrideMap } = useUserData();
  const [modes, setModes] = useState<Record<number, CraftMode>>({});
  const [collapsedCraftIds, setCollapsedCraftIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [localSalePrice, setLocalSalePrice] = useState("");

  const priceMap: PriceMap = useMemo(
    () => new Map(data?.prices.map((p) => [p.itemId, p])),
    [data],
  );

  const equip = useMemo(
    () => (data ? detectPieceAndTier(data.item.name) : null),
    [data],
  );

  const wisp = useMemo(
    () => (data ? findWispInChain(data, priceMap, overrideMap) : null),
    [data, priceMap, overrideMap],
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
      ayanadItemQuery.data?.find((item) => item.name === ayanadItemName) ?? null,
    [ayanadItemName, ayanadItemQuery.data],
  );
  const ayanadCraftQuery = useQuery({
    ...trpc.crafts.forItem.queryOptions(ayanadItem?.id ?? -1),
    enabled: ayanadItem?.id != null,
  });
  const ayanadCraftData = ayanadCraftQuery.data ?? null;
  const ayanadPriceQuery = useQuery({
    ...trpc.items.price.queryOptions(ayanadItem?.id ?? -1),
    enabled: ayanadItem?.id != null,
  });
  const ayanadMarketPrice = useMemo(
    () => parseFloat(ayanadPriceQuery.data?.avg24h ?? ayanadPriceQuery.data?.avg7d ?? "0"),
    [ayanadPriceQuery.data],
  );
  const defaultSalePrice = useMemo(
    () =>
      ayanadItem?.id != null
        ? (overrideMap.get(ayanadItem.id) ?? ayanadMarketPrice)
        : 0,
    [ayanadItem?.id, ayanadMarketPrice, overrideMap],
  );
  const effectiveSalePrice = useMemo(() => {
    const parsed = parseFloat(localSalePrice);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultSalePrice;
  }, [defaultSalePrice, localSalePrice]);

  const recommendedModes = useMemo(() => {
    if (!data?.crafts.length) return {};
    return buildRecommendedModes(
      data.crafts[0]!.materials,
      data.subcraftsByItemId ?? {},
      priceMap,
      overrideMap,
    );
  }, [data, priceMap, overrideMap]);

  useEffect(() => {
    setModes((prev) => {
      const next = { ...recommendedModes, ...prev };
      const same =
        Object.keys(next).length === Object.keys(prev).length &&
        Object.entries(next).every(([id, mode]) => prev[Number(id)] === mode);
      return same ? prev : next;
    });
  }, [recommendedModes]);

  const simulationData = useMemo(() => {
    if (!data || !equip || data.crafts.length === 0 || !wisp) return null;

    const subcraftMap = data.subcraftsByItemId ?? {};
    const mainCraft = data.crafts[0]!;
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
          modes,
        ) *
          amount,
      0,
    );
    const ayanadCraft = ayanadCraftData?.crafts[0] ?? null;
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
          ayanadCraftData?.subcraftsByItemId ?? subcraftMap,
          priceMap,
          overrideMap,
          modes,
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
            ayanadCraftData?.subcraftsByItemId ?? subcraftMap,
            proficiencyMap,
            modes,
          ) *
            amount,
        0,
      );
    const seedWispsPerAttempt = chain.keyMaterialId
      ? countManaWispsForItem(chain.keyMaterialId, subcraftMap, modes)
      : 0;
    const laborPerAttempt =
      getDiscountedLabor(
        mainCraft.craft.labor,
        mainCraft.craft.proficiency,
        proficiencyMap,
      ) +
      (chain.keyMaterialId
        ? deepCraftLabor(chain.keyMaterialId, subcraftMap, proficiencyMap, modes)
        : 0) +
      attemptMaterials.reduce(
        (sum, { item, amount }) =>
          sum +
          getChosenMaterialLabor(item.id, subcraftMap, proficiencyMap, modes) *
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
      seedWispsPerAttempt,
      upgradeMaterials,
    };
  }, [
    ayanadCraftData,
    data,
    equip,
    itemId,
    modes,
    overrideMap,
    priceMap,
    proficiencyMap,
    wisp,
    effectiveSalePrice,
  ]);

  const craftExecutions = useMemo(() => {
    if (!data || !simulationData) return [];

    const acc = new Map<number, CraftExecution>();
    const subcraftMap = data.subcraftsByItemId ?? {};
    const { chain, result, mainCraft, upgradeMaterials } = simulationData;

    if (chain.keyMaterialId) {
      collectCraftExecutionsForItem(
        chain.keyMaterialId,
        result.variants,
        subcraftMap,
        modes,
        acc,
      );
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

    for (const { item, amount } of upgradeMaterials) {
      if ((modes[item.id] ?? "buy") === "craft") {
        collectCraftExecutionsForItem(item.id, amount, subcraftMap, modes, acc);
      }
    }

    for (const craft of acc.values()) {
      if (craft.laborPerBatch > 0) continue;
      const subEntry = Object.values(subcraftMap)
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
  }, [data, modes, proficiencyMap, simulationData]);

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

  if (!data || !equip) {
    return (
      <p className="text-muted-foreground text-sm">
        Could not detect tier/piece for this item.
      </p>
    );
  }

  const { item } = data;
  const mainCraft = data.crafts[0] ?? null;
  const exportModes = serializeCraftModes(modes);

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
                craft: undefined,
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
              Uses market or profile override by default. Enter a local value to override this simulation.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              step="0.01"
              value={localSalePrice}
              onChange={(e) => setLocalSalePrice(e.target.value)}
              placeholder={defaultSalePrice > 0 ? String(defaultSalePrice) : "0"}
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
                <span className="font-medium text-foreground">
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
                    <span>{(craft.laborPerBatch * craft.batches).toLocaleString()}L</span>
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
              subcraftMap={data.subcraftsByItemId ?? {}}
              modes={modes}
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
  const hasCraftable = materials.some(({ item }) => !!subcraftMap[item.id]?.length);

  return (
    <div
      className={`rounded-md border ${depth > 0 ? "bg-muted/20 border-dashed" : ""} p-3`}
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => toggleCollapsed(craft.id)}
            className="text-muted-foreground hover:text-foreground shrink-0 text-xs"
            aria-label={isCollapsed ? "Expand craft" : "Collapse craft"}
          >
            {isCollapsed ? "▶" : "▼"}
          </button>
          <p className={`truncate font-semibold ${depth > 0 ? "text-sm" : ""}`}>
            {craft.name}
          </p>
          <ProficiencyBadge proficiency={craft.proficiency} />
          {craft.labor > 0 && (
            <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
              {getDiscountedLabor(
                craft.labor,
                craft.proficiency,
                proficiencyMap,
              )}{" "}
              labor
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {hasPrices && (
            <p className="text-sm font-medium tabular-nums">
              <span className="text-muted-foreground mr-1 text-xs font-normal">
                materials
              </span>
              <span className="text-primary">
                {total.toLocaleString(undefined, { maximumFractionDigits: 0 })}g
              </span>
            </p>
          )}
          {depth === 0 && (
            <Link
              to="/craft/$itemId"
              params={{ itemId }}
              className="text-muted-foreground text-xs hover:underline"
            >
              Full craft →
            </Link>
          )}
        </div>
      </div>

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
            ? deepCraftCost(item.id, subcraftMap, priceMap, overrideMap, modes)
            : 0;
          const unit = mode === "craft" && isCraftable ? craftUnit : buyUnit;
          const lineTotal = unit * amount;
          const hasPrice = isCustom || !!price;
          const totalDiff =
            isCraftable && hasPrice ? (buyUnit - craftUnit) * amount : null;
          const subEntry = isCraftable
            ? pickPreferredCraft(subcraftMap[item.id]!, item.id)
            : null;
          const subLabor = subEntry
            ? getChosenMaterialLabor(item.id, subcraftMap, proficiencyMap, modes)
            : 0;

          return (
            <Fragment key={item.id}>
              <li className="hover:bg-muted/40 flex items-center gap-2 rounded px-1 py-1 text-sm">
                <ItemIcon icon={item.icon} name={item.name} />
                <span className="min-w-0 flex-1 truncate">
                  {item.name}
                  {amount > 1 && (
                    <span className="text-muted-foreground ml-1 text-xs">
                      ×{amount}
                    </span>
                  )}
                </span>

                {isCraftable && (
                  <span className="inline-flex overflow-hidden rounded-full border text-xs">
                    <button
                      onClick={() =>
                        setModes((prev) => ({ ...prev, [item.id]: "buy" }))
                      }
                      className={`px-2.5 py-0.5 transition-colors ${
                        mode === "buy"
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Buy
                    </button>
                    <button
                      onClick={() =>
                        setModes((prev) => ({ ...prev, [item.id]: "craft" }))
                      }
                      className={`px-2.5 py-0.5 transition-colors ${
                        mode === "craft"
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Craft
                    </button>
                  </span>
                )}

                {(hasPrice || mode === "craft") && (
                  <span className="text-muted-foreground shrink-0 tabular-nums">
                    {isCustom && mode === "buy" && (
                      <span className="text-primary mr-1 text-xs">(custom)</span>
                    )}
                    {mode === "craft" && isCraftable && subLabor > 0 && (
                      <span className="mr-1 text-xs text-amber-500">
                        {subLabor.toLocaleString(undefined, {
                          maximumFractionDigits: 0,
                        })}
                        L +
                      </span>
                    )}
                    <span className="text-foreground/70">
                      {unit.toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })}
                      g
                    </span>
                    {amount > 1 && (
                      <span className="text-foreground ml-1.5 font-medium">
                        ={" "}
                        {lineTotal.toLocaleString(undefined, {
                          maximumFractionDigits: 0,
                        })}
                        g
                      </span>
                    )}
                  </span>
                )}

                {totalDiff !== null && (
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
                      ? `↓ ${totalDiff.toLocaleString(undefined, { maximumFractionDigits: 0 })}g`
                      : totalDiff < 0
                        ? `↑ ${Math.abs(totalDiff).toLocaleString(undefined, { maximumFractionDigits: 0 })}g`
                        : "="}
                  </span>
                )}
              </li>

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

          {depth === 0 && hasCraftable && (
            <div className="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-0.5 border-t pt-2 text-xs">
              <span>
                <span className="font-medium text-green-600 dark:text-green-400">
                  ↓ Xg
                </span>{" "}
                craft saves gold
              </span>
              <span>
                <span className="font-medium text-red-500">↑ Xg</span> craft costs
                more
              </span>
              <span>
                <span className="font-medium text-amber-500">XL</span> labor to
                craft
              </span>
              <span>toggle Buy / Craft per ingredient</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function gold(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 }) + "g";
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

function StatCard({
  label,
  value,
  variant,
}: {
  label: string;
  value: string;
  variant?: "positive" | "negative" | "neutral";
}) {
  const colorClass =
    variant === "positive"
      ? "text-green-600 dark:text-green-400"
      : variant === "negative"
        ? "text-red-500"
        : "";

  return (
    <div className="bg-muted/50 rounded-md border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className={`mt-1 font-medium tabular-nums ${colorClass}`}>{value}</p>
    </div>
  );
}
