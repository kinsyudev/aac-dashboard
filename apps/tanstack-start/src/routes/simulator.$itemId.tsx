import type { inferProcedureOutput } from "@trpc/server";
import { Suspense, useMemo } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
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

// ─── Types ───────────────────────────────────────────────────────────────────

type ForItemOutput = NonNullable<
  inferProcedureOutput<AppRouter["crafts"]["forItem"]>
>;
type PriceMap = Map<number, { avg24h: string | null; avg7d: string | null }>;
type OverrideMap = Map<number, number>;
type SubcraftMap = ForItemOutput["subcraftsByItemId"];

// ─── Price helpers ───────────────────────────────────────────────────────────

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
      ? deepCraftCost(
          item.id,
          subcraftMap,
          priceMap,
          overrideMap,
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
        deepCraftLabor(
          item.id,
          subcraftMap,
          proficiencyMap,
          new Set(visited),
        ) * amount;
    }
  }

  return labor / produced;
}

// ─── Wisp detection ──────────────────────────────────────────────────────────

/**
 * Walk the craft chain to find the mana wisp item used in the base craft.
 * Returns { id, name, price } of the wisp item, or null.
 */
function findWispInChain(
  data: ForItemOutput,
  priceMap: PriceMap,
  overrideMap: OverrideMap,
): { id: number; name: string; price: number } | null {
  const subcraftMap = data.subcraftsByItemId ?? {};

  // Collect ALL materials from all crafts and subcrafts
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

  // Find the mana wisp item
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

// ─── Detail page ─────────────────────────────────────────────────────────────

function SimulatorDetail({ itemId }: { itemId: number }) {
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

  const wisp = useMemo(
    () => (data ? findWispInChain(data, priceMap, overrideMap) : null),
    [data, priceMap, overrideMap],
  );

  const simulation = useMemo<SimulationResult | null>(() => {
    if (!data || !equip || data.crafts.length === 0 || !wisp) return null;

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

    // Sealed upgrade craft cost (all materials for the final craft step)
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

    // Find the key material (e.g. "Delphinad Quake Cuirass")
    let keyMaterialId: number | null = null;
    for (const mat of mainCraft.materials) {
      if (mat.item.name.toLowerCase().includes(prevTier)) {
        keyMaterialId = mat.item.id;
        break;
      }
    }

    // Cost per attempt = cost to produce the key material through the full chain
    let costPerAttempt = 0;
    let laborPerAttempt = 0;

    if (keyMaterialId) {
      const keyEntries = subcraftMap[keyMaterialId];
      if (keyEntries?.length) {
        const keyEntry = pickPreferredCraft(keyEntries, keyMaterialId);

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
      wispPrice: wisp.price,
      sellPrice,
      laborPerAttempt,
      sealedUpgradeLabor,
    });
  }, [data, equip, wisp, priceMap, overrideMap, proficiencyMap, itemId]);

  if (!data || !equip) {
    return (
      <p className="text-muted-foreground text-sm">
        Could not detect tier/piece for this item.
      </p>
    );
  }

  const { item } = data;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {item.icon && (
            <ItemIcon icon={item.icon} name={item.name} size="lg" />
          )}
          <div>
            <h1 className="text-3xl font-bold">{item.name}</h1>
            <p className="text-muted-foreground text-sm">
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

      {/* Wisp info */}
      {wisp && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Wisp type:</span>
          <span className="font-medium">{wisp.name}</span>
          <span className="text-muted-foreground">&middot;</span>
          <span className="font-medium tabular-nums">
            {wisp.price > 0
              ? `${wisp.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}g`
              : "no price data"}
          </span>
        </div>
      )}

      {/* Results */}
      {simulation ? (
        <SimulationResults result={simulation} />
      ) : (
        <p className="text-muted-foreground text-sm">
          {!wisp
            ? "Could not detect mana wisp type from craft chain."
            : wisp.price === 0
              ? "No market price found for " + wisp.name + ". Set a price override in your profile."
              : "Could not compute simulation \u2014 craft chain may not match expected pattern."}
        </p>
      )}
    </div>
  );
}

// ─── Display components ──────────────────────────────────────────────────────

function gold(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 }) + "g";
}

function pct(value: number): string {
  return (value * 100).toFixed(1) + "%";
}

function SimulationResults({ result }: { result: SimulationResult }) {
  return (
    <div className="flex flex-col gap-4">
      {/* Summary */}
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

      {/* Breakdown */}
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
          value={`${result.failSalvageWisps} wisps = ${gold(result.totalFailRecovery)}`}
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
