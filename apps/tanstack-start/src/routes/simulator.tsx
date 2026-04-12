import type { inferProcedureOutput } from "@trpc/server";
import { Suspense, useDeferredValue, useMemo, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import type { AppRouter } from "@acme/api";
import { Input } from "@acme/ui/input";

import { ItemIcon } from "~/component/item-icon";
import { pickPreferredCraft } from "~/lib/craft-helpers";
import { getDiscountedLabor } from "~/lib/proficiency";
import type { ProficiencyMap } from "~/lib/proficiency";
import { computeSimulation, detectPieceAndTier } from "~/lib/simulator";
import type { SimulationResult } from "~/lib/simulator";
import { useTRPC } from "~/lib/trpc";
import { useUserData } from "~/lib/useUserData";

export const Route = createFileRoute("/simulator")({
  component: SimulatorPage,
});

function SimulatorPage() {
  const [query, setQuery] = useState("Sealed Ayanad");
  const deferred = useDeferredValue(query);

  return (
    <main className="container py-16">
      <h1 className="mb-2 text-3xl font-bold">Craft Simulator</h1>
      <p className="text-muted-foreground mb-6 text-sm">
        Search for a sealed item to simulate profitability of the craft chain.
      </p>

      <Input
        placeholder="Search items... (e.g. Sealed Ayanad Cuirass)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mb-6 max-w-md"
      />

      {deferred.trim().length >= 2 && (
        <Suspense
          fallback={
            <p className="text-muted-foreground text-sm">Loading...</p>
          }
        >
          <SearchResults query={deferred} />
        </Suspense>
      )}
    </main>
  );
}

// ─── Search results ──────────────────────────────────────────────────────────

function SearchResults({ query }: { query: string }) {
  const trpc = useTRPC();
  const { data: allItems } = useSuspenseQuery(
    trpc.items.craftable.queryOptions(),
  );

  const results = useMemo(() => {
    const q = query.toLowerCase();
    return allItems.filter((item) => item.name.toLowerCase().includes(q));
  }, [allItems, query]);

  if (results.length === 0) {
    return <p className="text-muted-foreground text-sm">No items found.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {results.map((item) => (
        <Suspense
          key={item.id}
          fallback={
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-3">
                <ItemIcon icon={item.icon} name={item.name} />
                <span className="font-medium">{item.name}</span>
                <span className="text-muted-foreground text-sm">
                  Loading craft data...
                </span>
              </div>
            </div>
          }
        >
          <SimulatorCard itemId={item.id} itemName={item.name} />
        </Suspense>
      ))}
    </div>
  );
}

// ─── Types ───────────────────────────────────────────────────────────────────

type ForItemOutput = NonNullable<
  inferProcedureOutput<AppRouter["crafts"]["forItem"]>
>;
type PriceMap = Map<number, { avg24h: string | null; avg7d: string | null }>;
type OverrideMap = Map<number, number>;
type SubcraftMap = ForItemOutput["subcraftsByItemId"];

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

/**
 * Compute the total material cost of a craft (non-recursive — materials only).
 */
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

/**
 * Walk the BFS subcraftsByItemId tree to compute the total recursive cost of
 * crafting one unit of `itemId`, including all sub-material costs.
 */
function deepCraftCost(
  itemId: number,
  subcraftMap: SubcraftMap,
  priceMap: PriceMap,
  overrideMap: OverrideMap,
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
    const unitCost = subEntries?.length
      ? deepCraftCost(item.id, subcraftMap, priceMap, overrideMap, visited)
      : getItemPrice(item.id, priceMap, overrideMap);
    return sum + unitCost * amount;
  }, 0);

  return batchCost / produced;
}

/**
 * Walk the BFS tree to compute total labor for crafting one unit of `itemId`.
 */
function deepCraftLabor(
  itemId: number,
  subcraftMap: SubcraftMap,
  proficiencyMap: ProficiencyMap,
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
    if (subEntries?.length) {
      labor +=
        deepCraftLabor(item.id, subcraftMap, proficiencyMap, visited) * amount;
    }
  }

  return labor / produced;
}

// ─── Simulator card ──────────────────────────────────────────────────────────

function SimulatorCard({
  itemId,
  itemName,
}: {
  itemId: number;
  itemName: string;
}) {
  const trpc = useTRPC();
  const { data } = useSuspenseQuery(trpc.crafts.forItem.queryOptions(itemId));
  const { proficiencyMap, overrideMap } = useUserData();
  const [wispPriceOverride, setWispPriceOverride] = useState<string>("");

  const equip = useMemo(() => detectPieceAndTier(itemName), [itemName]);

  const priceMap: PriceMap = useMemo(
    () => new Map(data?.prices.map((p) => [p.itemId, p])),
    [data],
  );

  const simulation = useMemo<SimulationResult | null>(() => {
    if (!data || !equip || data.crafts.length === 0) return null;

    const subcraftMap = data.subcraftsByItemId ?? {};

    // The main craft for this sealed item
    const mainCraft = data.crafts[0]!;

    // Find the "key material" — the item that comes from the RNG tier
    // e.g. for "Sealed Ayanad Cuirass", the key material is "Ayanad Quake Cuirass"
    // which itself comes from opening a "Sealed Delphinad Cuirass"
    //
    // We identify it as a material whose name contains the next-lower tier
    const tierIndex = [
      "illustrious",
      "magnificent",
      "epherium",
      "delphinad",
      "ayanad",
    ].indexOf(equip.tier);

    // Cost of the final sealed upgrade craft (materials excluding the key piece)
    const sealedUpgradeCost = craftMaterialCost(
      mainCraft.materials,
      priceMap,
      overrideMap,
    );
    const sealedUpgradeLabor = getDiscountedLabor(
      mainCraft.craft.labor,
      mainCraft.craft.proficiency,
      proficiencyMap,
    );

    // Find the key material (the unsealed variant piece)
    // It should be a material whose name matches one tier below
    const prevTier = tierIndex > 0
      ? ["illustrious", "magnificent", "epherium", "delphinad", "ayanad"][tierIndex - 1]
      : null;

    let keyMaterialId: number | null = null;
    let keyMaterialCost = 0;

    if (prevTier) {
      for (const mat of mainCraft.materials) {
        if (mat.item.name.toLowerCase().includes(prevTier)) {
          keyMaterialId = mat.item.id;
          break;
        }
      }
    }

    // The cost per attempt is the cost to craft the key material's precursor chain
    // e.g. for Ayanad Quake Cuirass, we need Sealed Delphinad Cuirass → which needs Epherium Quake Cuirass
    // The RNG tier is prevTier (e.g. "delphinad")
    const rngTier = prevTier as typeof equip.tier | null;

    if (keyMaterialId && rngTier) {
      // Cost to produce the key material by crafting its full chain
      keyMaterialCost = deepCraftCost(
        keyMaterialId,
        subcraftMap,
        priceMap,
        overrideMap,
      );
    }

    // costPerAttempt = cost to get one "attempt" at the RNG
    // This means crafting the sealed piece at the RNG tier
    // For Sealed Delphinad: cost = Epherium piece + other mats
    // We approximate: if keyMaterial has subcrafts, walk those
    const keyMaterialEntries = keyMaterialId ? subcraftMap[keyMaterialId] : null;
    let costPerAttempt = 0;
    let laborPerAttempt = 0;

    if (keyMaterialEntries?.length && keyMaterialId) {
      const keyEntry = pickPreferredCraft(keyMaterialEntries, keyMaterialId);
      // Cost to craft the sealed piece that produces the key material
      costPerAttempt = craftMaterialCost(
        keyEntry.materials,
        priceMap,
        overrideMap,
      );
      laborPerAttempt = getDiscountedLabor(
        keyEntry.craft.labor,
        keyEntry.craft.proficiency,
        proficiencyMap,
      );

      // Add subcraft costs for each material of the sealed piece
      for (const mat of keyEntry.materials) {
        const subEntries = subcraftMap[mat.item.id];
        if (subEntries?.length) {
          const subCost = deepCraftCost(
            mat.item.id,
            subcraftMap,
            priceMap,
            overrideMap,
          );
          costPerAttempt +=
            (subCost - getItemPrice(mat.item.id, priceMap, overrideMap)) *
            mat.amount;
          laborPerAttempt += deepCraftLabor(
            mat.item.id,
            subcraftMap,
            proficiencyMap,
          ) * mat.amount;
        }
      }
    } else {
      // Fallback: use key material market price as cost per attempt
      costPerAttempt = keyMaterialCost || sealedUpgradeCost;
    }

    // Wisp price: use override or try to estimate from materials
    const wispPrice = wispPriceOverride
      ? parseFloat(wispPriceOverride) || 0
      : 0;

    // Sell price: market price of the sealed item itself
    const sellPrice = getItemPrice(itemId, priceMap, overrideMap);

    if (!rngTier) return null;

    return computeSimulation({
      costPerAttempt,
      sealedUpgradeCost,
      rngTier,
      equip,
      wispPrice,
      sellPrice,
      laborPerAttempt,
      sealedUpgradeLabor,
    });
  }, [data, equip, priceMap, overrideMap, proficiencyMap, wispPriceOverride, itemId]);

  if (!data || !equip) {
    return (
      <div className="rounded-lg border p-4">
        <p className="text-muted-foreground text-sm">
          Could not detect tier/piece for "{itemName}".
        </p>
      </div>
    );
  }

  const { item } = data;

  return (
    <div className="flex flex-col gap-4 rounded-lg border p-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {item.icon && <ItemIcon icon={item.icon} name={item.name} size="lg" />}
          <div>
            <h2 className="text-xl font-bold">{item.name}</h2>
            <p className="text-muted-foreground text-xs">
              {equip.category} &middot; {equip.tier}
              {equip.piece && ` \u00b7 ${equip.piece}`}
            </p>
          </div>
        </div>
        <Link
          to="/craft/$itemId"
          params={{ itemId: item.id }}
          className="text-muted-foreground text-xs hover:underline"
        >
          View craft →
        </Link>
      </div>

      {/* Wisp price input */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium" htmlFor={`wisp-${itemId}`}>
          Wisp price (gold)
        </label>
        <Input
          id={`wisp-${itemId}`}
          type="number"
          min="0"
          step="0.01"
          placeholder="Enter wisp price..."
          value={wispPriceOverride}
          onChange={(e) => setWispPriceOverride(e.target.value)}
          className="w-36"
        />
      </div>

      {/* Simulation results */}
      {simulation ? (
        <SimulationResults result={simulation} />
      ) : (
        <p className="text-muted-foreground text-sm">
          Enter a wisp price to see simulation results.
        </p>
      )}
    </div>
  );
}

// ─── Simulation results display ──────────────────────────────────────────────

function gold(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 }) + "g";
}

function pct(value: number): string {
  return (value * 100).toFixed(1) + "%";
}

function SimulationResults({ result }: { result: SimulationResult }) {
  return (
    <div className="flex flex-col gap-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Success rate" value={`1/${result.variants} (${pct(result.successRate)})`} />
        <StatCard label="Total cost" value={gold(result.totalCost)} />
        <StatCard
          label="Profit (salvage)"
          value={gold(result.profitSalvage)}
          variant={result.profitSalvage > 0 ? "positive" : result.profitSalvage < 0 ? "negative" : "neutral"}
        />
        <StatCard
          label="Profit (sell)"
          value={gold(result.profitSell)}
          variant={result.profitSell > 0 ? "positive" : result.profitSell < 0 ? "negative" : "neutral"}
        />
      </div>

      {/* Detail breakdown */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label="Cost per attempt" value={gold(result.costPerAttempt)} />
        <StatCard
          label={`Expected attempts (×${result.variants})`}
          value={gold(result.expectedAttemptsCost)}
        />
        <StatCard
          label={`Fail recovery (×${result.variants - 1})`}
          value={gold(result.totalFailRecovery)}
          variant="positive"
        />
        <StatCard label="Sealed upgrade cost" value={gold(result.sealedUpgradeCost)} />
        <StatCard label="Salvage wisps" value={`${result.salvageWisps}`} />
        <StatCard label="Revenue (salvage)" value={gold(result.revenueSalvage)} />
        <StatCard label="Revenue (sell)" value={gold(result.revenueSell)} />
        <StatCard label="Total labor" value={result.totalLabor.toLocaleString()} />
        <StatCard
          label="Silver/labor (salvage)"
          value={result.silverPerLaborSalvage.toFixed(2)}
          variant={result.silverPerLaborSalvage > 0 ? "positive" : result.silverPerLaborSalvage < 0 ? "negative" : "neutral"}
        />
        <StatCard
          label="Silver/labor (sell)"
          value={result.silverPerLaborSell.toFixed(2)}
          variant={result.silverPerLaborSell > 0 ? "positive" : result.silverPerLaborSell < 0 ? "negative" : "neutral"}
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
