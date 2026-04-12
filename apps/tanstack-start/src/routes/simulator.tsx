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
  loader: ({ context }) => {
    const { trpc, queryClient } = context;
    void queryClient.prefetchQuery(trpc.items.craftable.queryOptions());
  },
  component: SimulatorPage,
});

// ─── Page ────────────────────────────────────────────────────────────────────

function SimulatorPage() {
  const [query, setQuery] = useState("Sealed Ayanad");
  const deferred = useDeferredValue(query);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [wispPrice, setWispPrice] = useState<string>("");

  return (
    <main className="container py-16">
      <h1 className="mb-2 text-3xl font-bold">Craft Simulator</h1>
      <p className="text-muted-foreground mb-6 text-sm">
        Search for a sealed item to simulate profitability of the craft chain.
      </p>

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Input
            placeholder="Search items... (e.g. Sealed Ayanad Cuirass)"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedItemId(null);
            }}
            className="max-w-md"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium whitespace-nowrap">
            Wisp price (gold)
          </label>
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="e.g. 3.5"
            value={wispPrice}
            onChange={(e) => setWispPrice(e.target.value)}
            className="w-32"
          />
        </div>
      </div>

      {selectedItemId ? (
        <div className="flex flex-col gap-4">
          <button
            onClick={() => setSelectedItemId(null)}
            className="text-muted-foreground self-start text-sm hover:underline"
          >
            ← Back to results
          </button>
          <Suspense
            fallback={
              <p className="text-muted-foreground text-sm">
                Loading craft data...
              </p>
            }
          >
            <SimulatorDetail
              itemId={selectedItemId}
              wispPrice={parseFloat(wispPrice) || 0}
            />
          </Suspense>
        </div>
      ) : (
        deferred.trim().length >= 2 && (
          <Suspense
            fallback={
              <p className="text-muted-foreground text-sm">Loading...</p>
            }
          >
            <SearchResults
              query={deferred}
              onSelect={setSelectedItemId}
            />
          </Suspense>
        )
      )}
    </main>
  );
}

// ─── Search results (lightweight list, no craft data fetched) ────────────────

function SearchResults({
  query,
  onSelect,
}: {
  query: string;
  onSelect: (id: number) => void;
}) {
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
    <ul className="flex flex-col divide-y">
      {results.map((item) => (
        <li key={item.id}>
          <button
            onClick={() => onSelect(item.id)}
            className="hover:bg-muted/50 flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors"
          >
            <ItemIcon icon={item.icon} name={item.name} size="md" />
            <span className="flex-1 font-medium">{item.name}</span>
            <span className="text-muted-foreground text-xs">
              {item.category}
            </span>
          </button>
        </li>
      ))}
    </ul>
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
      ? deepCraftCost(item.id, subcraftMap, priceMap, overrideMap, new Set(visited))
      : getItemPrice(item.id, priceMap, overrideMap);
    return sum + unitCost * amount;
  }, 0);

  return batchCost / produced;
}

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
        deepCraftLabor(item.id, subcraftMap, proficiencyMap, new Set(visited)) *
        amount;
    }
  }

  return labor / produced;
}

// ─── Simulator detail (fetches craft data for ONE item) ──────────────────────

function SimulatorDetail({
  itemId,
  wispPrice,
}: {
  itemId: number;
  wispPrice: number;
}) {
  const trpc = useTRPC();
  const { data } = useSuspenseQuery(trpc.crafts.forItem.queryOptions(itemId));
  const { proficiencyMap, overrideMap } = useUserData();

  const priceMap: PriceMap = useMemo(
    () => new Map(data?.prices.map((p) => [p.itemId, p])),
    [data],
  );

  const equip = useMemo(
    () => (data ? detectPieceAndTier(data.item.name) : null),
    [data],
  );

  const simulation = useMemo<SimulationResult | null>(() => {
    if (!data || !equip || data.crafts.length === 0) return null;

    const subcraftMap = data.subcraftsByItemId ?? {};
    const mainCraft = data.crafts[0]!;

    const tierList = [
      "illustrious",
      "magnificent",
      "epherium",
      "delphinad",
      "ayanad",
    ] as const;
    const tierIndex = tierList.indexOf(equip.tier);
    const prevTier = tierIndex > 0 ? tierList[tierIndex - 1] : null;

    if (!prevTier) return null;

    // The sealed upgrade craft cost (all materials for Sealed Ayanad craft)
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

    // Find the key material (the unsealed variant piece, e.g. "Delphinad Quake Cuirass")
    let keyMaterialId: number | null = null;
    for (const mat of mainCraft.materials) {
      if (mat.item.name.toLowerCase().includes(prevTier)) {
        keyMaterialId = mat.item.id;
        break;
      }
    }

    // Cost per attempt = cost to craft one sealed piece at the RNG tier
    // This includes crafting the precursor (e.g. Epherium piece) and the sealed piece itself
    let costPerAttempt = 0;
    let laborPerAttempt = 0;

    if (keyMaterialId) {
      // The key material (e.g. "Delphinad Quake Cuirass") is produced by opening
      // a sealed piece. Walk its craft chain to find the full cost.
      const keyEntries = subcraftMap[keyMaterialId];
      if (keyEntries?.length) {
        const keyEntry = pickPreferredCraft(keyEntries, keyMaterialId);

        // Cost = all materials of the craft that produces the key material
        for (const mat of keyEntry.materials) {
          const subEntries = subcraftMap[mat.item.id];
          const unitCost = subEntries?.length
            ? deepCraftCost(mat.item.id, subcraftMap, priceMap, overrideMap)
            : getItemPrice(mat.item.id, priceMap, overrideMap);
          costPerAttempt += unitCost * mat.amount;
        }

        laborPerAttempt = getDiscountedLabor(
          keyEntry.craft.labor,
          keyEntry.craft.proficiency,
          proficiencyMap,
        );
        for (const mat of keyEntry.materials) {
          const subEntries = subcraftMap[mat.item.id];
          if (subEntries?.length) {
            laborPerAttempt +=
              deepCraftLabor(mat.item.id, subcraftMap, proficiencyMap) *
              mat.amount;
          }
        }
      } else {
        // No subcraft data — use market price as fallback
        costPerAttempt = getItemPrice(keyMaterialId, priceMap, overrideMap);
      }
    }

    // Sell price of the final sealed item
    const sellPrice = getItemPrice(itemId, priceMap, overrideMap);

    const rngTier = prevTier as (typeof tierList)[number];

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
  }, [data, equip, priceMap, overrideMap, proficiencyMap, wispPrice, itemId]);

  if (!data || !equip) {
    return (
      <p className="text-muted-foreground text-sm">
        Could not detect tier/piece for this item.
      </p>
    );
  }

  const { item } = data;

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {item.icon && (
            <ItemIcon icon={item.icon} name={item.name} size="lg" />
          )}
          <div>
            <h2 className="text-2xl font-bold">{item.name}</h2>
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

      {/* Results */}
      {simulation ? (
        <SimulationResults result={simulation} hasWispPrice={wispPrice > 0} />
      ) : (
        <p className="text-muted-foreground text-sm">
          Could not compute simulation — craft chain may not match expected
          pattern.
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

function SimulationResults({
  result,
  hasWispPrice,
}: {
  result: SimulationResult;
  hasWispPrice: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {!hasWispPrice && (
        <p className="text-sm text-amber-600 dark:text-amber-400">
          Enter a wisp price above to see gold values for salvage recovery and
          profit.
        </p>
      )}

      {/* Summary cards */}
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

      {/* Detail breakdown */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard
          label="Cost per attempt"
          value={gold(result.costPerAttempt)}
        />
        <StatCard
          label={`Expected attempts (\u00d7${result.variants})`}
          value={gold(result.expectedAttemptsCost)}
        />
        <StatCard
          label={`Fail recovery (\u00d7${result.variants - 1})`}
          value={`${result.failSalvageWisps} wisps/fail = ${gold(result.totalFailRecovery)}`}
          variant="positive"
        />
        <StatCard
          label="Net cost per fail"
          value={gold(result.costPerAttempt - result.failRecoveryPerAttempt)}
        />
        <StatCard
          label="Sealed upgrade cost"
          value={gold(result.sealedUpgradeCost)}
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
