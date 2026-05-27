import type { inferProcedureOutput } from "@trpc/server";
import { Fragment, Suspense, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { z } from "zod";

import type { AppRouter } from "@acme/api";
import { Checkbox } from "@acme/ui/checkbox";

import type { ProficiencyMap } from "~/lib/proficiency";
import type {
  ResealLoopSimulationResult,
  SalvageLoopSimulationResult,
  SimulationResult,
} from "~/lib/simulator";
import type { SimulationChain } from "~/lib/simulator-upgrade";
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
import { resolveDelphinadManaSealName } from "~/lib/mana-seal";
import { buildMetaTags, buildPageTitle, getItemIconUrl } from "~/lib/metadata";
import { getDiscountedLabor } from "~/lib/proficiency";
import { piecesMap } from "~/lib/salvage";
import {
  computeResealLoopSimulation,
  computeSimulation,
  detectPieceAndTier,
} from "~/lib/simulator";
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
type SimulatorStrategy = "salvage" | "reseal";

interface CraftExecution {
  craftId: number;
  name: string;
  proficiency: string | null;
  batches: number;
  laborPerBatch: number;
}

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

function serializeCraftEntry(entry: CraftEntry | SubcraftEntry | null) {
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
          item.id,
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
  const batches = requiredUnits / produced;

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

function addCraftExecution(
  craft: CraftEntry["craft"],
  batches: number,
  proficiencyMap: ProficiencyMap,
  acc: Map<number, CraftExecution>,
) {
  if (batches <= 0) return;

  const existing = acc.get(craft.id);
  if (existing) {
    existing.batches += batches;
    return;
  }

  acc.set(craft.id, {
    craftId: craft.id,
    name: craft.name,
    proficiency: craft.proficiency,
    batches,
    laborPerBatch: getDiscountedLabor(
      craft.labor,
      craft.proficiency,
      proficiencyMap,
    ),
  });
}

function addSelectedCraftExecutionForUnits(
  entry: CraftEntry,
  itemId: number,
  requiredUnits: number,
  proficiencyMap: ProficiencyMap,
  acc: Map<number, CraftExecution>,
): number {
  const produced =
    entry.products.find((product) => product.item.id === itemId)?.amount ?? 1;
  const batches = requiredUnits / produced;
  addCraftExecution(entry.craft, batches, proficiencyMap, acc);
  return batches;
}

function fillMissingCraftLabor(
  acc: Map<number, CraftExecution>,
  subcraftMap: SubcraftMap,
  proficiencyMap: ProficiencyMap,
) {
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
  const [activeStrategy, setActiveStrategy] =
    useState<SimulatorStrategy>("reseal");
  const [glowingProcEnabled, setGlowingProcEnabled] = useState(false);
  const [debugCopyState, setDebugCopyState] = useState<string | null>(null);

  const priceMap: PriceMap = useMemo(
    () => new Map(data.prices.map((p) => [p.itemId, p])),
    [data],
  );

  const equip = useMemo(() => detectPieceAndTier(data.item.name), [data]);

  const wisp = useMemo(
    () => findWispInChain(data, priceMap, overrideMap),
    [data, priceMap, overrideMap],
  );
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
      new Map([...priceMap, ...ayanadPriceMap]),
      overrideMap,
      modes,
    );
  }, [
    ayanadCraftData,
    ayanadItem,
    ayanadPriceMap,
    data.item,
    equip,
    modes,
    overrideMap,
    priceMap,
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
    if (!mainCraft || !equip) return {};
    const materials = [
      ...mainCraft.materials,
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
    mainCraft,
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
      ? ayanadCraft.materials.filter(
          ({ item }) => !isConsumedUpgradeGearMaterial(item, data.item, equip),
        )
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
    const laborPerAttempt = seedLabor + sealedCraftLabor;

    const salvageResult = computeSimulation({
      costPerAttempt,
      sealedUpgradeCost,
      rngTier: equip.tier,
      equip,
      wispPrice: wisp.price,
      sellPrice: effectiveSalePrice,
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
                sellPrice: effectiveSalePrice,
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
    effectiveSalePrice,
    glowingProcEnabled,
    ayanadCraft,
    ayanadSubcraftMap,
    manaSealCraft,
    manaSealCraftQuery.data,
    manaSealItem,
    manaSealName,
    manaSealPriceMap,
  ]);

  const craftExecutions = useMemo(() => {
    if (!simulationData) return [];

    const acc = new Map<number, CraftExecution>();
    const subcraftMap = data.subcraftsByItemId;
    const detailStrategy =
      activeStrategy === "reseal" && simulationData.reseal.result
        ? "reseal"
        : "salvage";
    const result =
      detailStrategy === "reseal"
        ? (simulationData.reseal.result ?? simulationData.salvage)
        : simulationData.salvage;
    const {
      chain,
      mainCraft,
      ayanadCraft,
      attemptMaterials,
      upgradeMaterials,
    } = simulationData.base;
    const attemptBatches =
      detailStrategy === "reseal" ? 1 : result.expectedAttempts;

    if (chain.keyMaterialId) {
      collectCraftExecutionsForItem(
        chain.keyMaterialId,
        attemptBatches,
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
          amount * attemptBatches,
          subcraftMap,
          priceMap,
          overrideMap,
          proficiencyMap,
          effectiveModes,
          acc,
        );
      }
    }

    addCraftExecution(mainCraft.craft, attemptBatches, proficiencyMap, acc);

    if (detailStrategy === "reseal" && simulationData.reseal.result) {
      const sealSubcraftMap = manaSealCraftQuery.data?.subcraftsByItemId ?? {};
      const sealCraft = simulationData.reseal.sealCraft;
      if (sealCraft && simulationData.reseal.sealItem) {
        const sealBatches = addSelectedCraftExecutionForUnits(
          sealCraft,
          simulationData.reseal.sealItem.id,
          simulationData.reseal.result.failedRetries,
          proficiencyMap,
          acc,
        );

        for (const { item, amount } of sealCraft.materials) {
          if ((effectiveModes[item.id] ?? "buy") === "craft") {
            collectCraftExecutionsForItem(
              item.id,
              amount * sealBatches,
              sealSubcraftMap,
              manaSealPriceMap,
              overrideMap,
              proficiencyMap,
              effectiveModes,
              acc,
            );
          }
        }
      }
    }

    if (ayanadCraft) {
      addCraftExecution(ayanadCraft.craft, 1, proficiencyMap, acc);
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

    fillMissingCraftLabor(acc, upgradeSubcraftMap, proficiencyMap);
    fillMissingCraftLabor(
      acc,
      manaSealCraftQuery.data?.subcraftsByItemId ?? {},
      proficiencyMap,
    );

    return [...acc.values()].sort((a, b) => b.batches - a.batches);
  }, [
    activeStrategy,
    ayanadCraftData,
    data,
    effectiveModes,
    manaSealCraftQuery.data,
    manaSealPriceMap,
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
  const detailStrategy =
    activeStrategy === "reseal" && simulationData?.reseal.result
      ? "reseal"
      : "salvage";
  const detailResult =
    detailStrategy === "reseal"
      ? simulationData?.reseal.result
      : simulationData?.salvage;
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
      selectedStrategy: detailStrategy,
      salePrice: {
        localSalePrice,
        defaultSalePrice,
        effectiveSalePrice,
        ayanadMarketPrice,
        ayanadItem: ayanadItem
          ? { id: ayanadItem.id, name: ayanadItem.name }
          : null,
      },
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
                  item.id,
                  data.subcraftsByItemId,
                  priceMap,
                  overrideMap,
                  effectiveModes,
                ),
                unitLabor: getChosenMaterialLabor(
                  item.id,
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
                  item.id,
                  ayanadSubcraftMap ?? data.subcraftsByItemId,
                  priceMap,
                  overrideMap,
                  effectiveModes,
                ),
                unitLabor: getChosenMaterialLabor(
                  item.id,
                  ayanadSubcraftMap ?? data.subcraftsByItemId,
                  priceMap,
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
              totalEvSalvage: reseal.revenueSalvage - reseal.totalCost,
              evPerAttemptSalvage:
                (reseal.revenueSalvage - reseal.totalCost) /
                reseal.expectedAttempts,
              silverPerLaborSalvage:
                ((reseal.revenueSalvage - reseal.totalCost) * 100) /
                reseal.totalLabor,
            }
          : null,
      },
      craftExecutions,
      laborByProficiency: Object.fromEntries(laborByProficiency),
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
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Crafts being done</h2>
            <div className="flex items-center gap-2">
              {simulationData && (
                <div className="bg-muted flex rounded-md p-1">
                  <button
                    type="button"
                    onClick={() => setActiveStrategy("salvage")}
                    className={`rounded px-2.5 py-1 text-xs font-medium ${
                      detailStrategy === "salvage"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Salvage Loop
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveStrategy("reseal")}
                    disabled={!simulationData.reseal.result}
                    className={`rounded px-2.5 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
                      detailStrategy === "reseal"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Reseal Loop
                  </button>
                </div>
              )}
              {detailResult && (
                <p className="text-muted-foreground text-sm">
                  {detailStrategy === "reseal"
                    ? "Expected failed retries: "
                    : "Expected attempts: "}
                  <span className="text-foreground font-medium">
                    ×
                    {detailStrategy === "reseal" &&
                    "failedRetries" in detailResult
                      ? formatCount(detailResult.failedRetries)
                      : formatCount(detailResult.expectedAttempts)}
                  </span>
                </p>
              )}
            </div>
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
                      {formatCount(craft.laborPerBatch * craft.batches)}L
                    </span>
                  )}
                  <span>×{formatCount(craft.batches)}</span>
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
        <SimulationResults
          salvage={simulationData.salvage}
          reseal={simulationData.reseal}
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
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total cost" value={gold(result.totalCost)} />
        <StatCard
          label="EV / attempt (salvage)"
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
}: {
  result: SalvageLoopSimulationResult;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <StatCard label="Cost per attempt" value={gold(result.costPerAttempt)} />
      <StatCard
        label={`Expected attempts (×${formatCount(result.expectedAttempts)})`}
        value={gold(result.expectedAttemptsCost)}
      />
      <StatCard
        label="EV / attempt (salvage)"
        value={gold(result.expectedValueSalvage)}
        variant={resultVariant(result.expectedValueSalvage)}
      />
      <StatCard
        label="EV / attempt (sell)"
        value={gold(result.expectedValueSell)}
        variant={resultVariant(result.expectedValueSell)}
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
        label={`Net fail recovery (×${formatCount(result.failedAttempts)})`}
        value={`${result.failSurplusWisps} × ${formatCount(result.failedAttempts)} = ${gold(result.totalFailNetRecovery)}`}
        variant="positive"
      />
      <StatCard label="Salvage wisps" value={`${result.salvageWisps}`} />
      <StatCard label="Revenue (salvage)" value={gold(result.revenueSalvage)} />
      <StatCard
        label={`Total EV (salvage ×${formatCount(result.expectedAttempts)})`}
        value={gold(result.profitSalvage)}
        variant={resultVariant(result.profitSalvage)}
      />
      <StatCard label="Revenue (sell)" value={gold(result.revenueSell)} />
      <StatCard
        label={`Total EV (sell ×${formatCount(result.expectedAttempts)})`}
        value={gold(result.profitSell)}
        variant={resultVariant(result.profitSell)}
      />
      <StatCard
        label="Silver/labor (salvage)"
        value={result.silverPerLaborSalvage.toFixed(2)}
        variant={resultVariant(result.silverPerLaborSalvage)}
      />
      <StatCard
        label="Silver/labor (sell)"
        value={result.silverPerLaborSell.toFixed(2)}
        variant={resultVariant(result.silverPerLaborSell)}
      />
    </div>
  );
}

function ResealLoopDetails({
  result,
  sealName,
}: {
  result: ResealLoopSimulationResult;
  sealName: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <StatCard label="Initial seed" value={gold(result.initialSeedCost)} />
      <StatCard
        label="Initial sealed craft"
        value={gold(result.initialSealedCraftCost)}
      />
      <StatCard label="Initial setup" value={gold(result.initialSetupCost)} />
      <StatCard
        label={`Mana seal retries (×${formatCount(result.failedRetries)})`}
        value={gold(result.totalManaSealRetryCost)}
      />
      <StatCard label="Mana seal per fail" value={gold(result.manaSealCost)} />
      <StatCard label="Mana seal" value={sealName} />
      <StatCard
        label="Sealed upgrade cost"
        value={gold(result.sealedUpgradeCost)}
      />
      <StatCard label="Salvage wisps" value={`${result.salvageWisps}`} />
      <StatCard label="Revenue (salvage)" value={gold(result.revenueSalvage)} />
      <StatCard
        label="EV / attempt (salvage)"
        value={gold(result.expectedValueSalvage)}
        variant={resultVariant(result.expectedValueSalvage)}
      />
      <StatCard label="Revenue (sell)" value={gold(result.revenueSell)} />
      <StatCard
        label="EV / attempt (sell)"
        value={gold(result.expectedValueSell)}
        variant={resultVariant(result.expectedValueSell)}
      />
      <StatCard
        label={`Total EV (salvage ×${formatCount(result.expectedAttempts)})`}
        value={gold(result.profitSalvage)}
        variant={resultVariant(result.profitSalvage)}
      />
      <StatCard
        label={`Total EV (sell ×${formatCount(result.expectedAttempts)})`}
        value={gold(result.profitSell)}
        variant={resultVariant(result.profitSell)}
      />
      <StatCard
        label="Silver/labor (salvage)"
        value={result.silverPerLaborSalvage.toFixed(2)}
        variant={resultVariant(result.silverPerLaborSalvage)}
      />
      <StatCard
        label="Silver/labor (sell)"
        value={result.silverPerLaborSell.toFixed(2)}
        variant={resultVariant(result.silverPerLaborSell)}
      />
    </div>
  );
}

function SimulationResults({
  salvage,
  reseal,
}: {
  salvage: SalvageLoopSimulationResult;
  reseal: ResealStrategyData;
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
        <SalvageLoopDetails result={salvage} />
      </div>

      {reseal.result && reseal.sealName ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Reseal Loop details</h2>
          <ResealLoopDetails
            result={reseal.result}
            sealName={reseal.sealName}
          />
        </div>
      ) : null}
    </div>
  );
}
