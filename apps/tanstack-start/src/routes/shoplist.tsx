import type { inferProcedureOutput } from "@trpc/server";
import type React from "react";
import { Fragment, Suspense, useEffect, useMemo, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import type { AppRouter } from "@acme/api";

import { ItemIcon } from "~/component/item-icon";
import { ProficiencyBadge } from "~/component/proficiency";
import { pickPreferredCraft } from "~/lib/craft-helpers";
import { getDiscountedLabor } from "~/lib/proficiency";
import type { ProficiencyMap } from "~/lib/proficiency";
import { useTRPC } from "~/lib/trpc";
import { useUserData } from "~/lib/useUserData";

export const Route = createFileRoute("/shoplist")({
  validateSearch: z.object({
    craft: z.coerce.number().int(),
    qty: z.coerce.number().int().min(1).default(1),
    sub: z.string().optional(),
  }),
  loaderDeps: ({ search }) => ({ craftId: search.craft }),
  loader: async ({ context, deps }) => {
    const { trpc, queryClient } = context;
    await queryClient.fetchQuery(
      trpc.crafts.forCraft.queryOptions(deps.craftId),
    );
  },
  component: ShoplistPage,
  errorComponent: () => <p>Craft not found.</p>,
});

function ShoplistPage() {
  const { craft: craftId } = Route.useSearch();
  return (
    <main className="container py-16">
      <Suspense fallback={<p>Loading...</p>}>
        <ShoplistDetail craftId={craftId} />
      </Suspense>
    </main>
  );
}

// ─── Types ───────────────────────────────────────────────────────────────────

type ForCraftOutput = NonNullable<
  inferProcedureOutput<AppRouter["crafts"]["forCraft"]>
>;
type SubcraftEntry = ForCraftOutput["subcraftsByItemId"][number][number];
type SubcraftMap = Record<number, SubcraftEntry[]>;
type PriceMap = Map<number, { avg24h: string | null; avg7d: string | null }>;
type OverrideMap = Map<number, number>;


// ─── Flat shopping list ───────────────────────────────────────────────────────

type ShoppingListItem = {
  item: { id: number; name: string; icon: string | null };
  totalAmount: number;
};

function buildShoppingList(
  materials: { item: { id: number; name: string; icon: string | null }; amount: number }[],
  craftModeSet: Set<number>,
  subcraftMap: SubcraftMap,
  depth: number,
  acc: Map<number, ShoppingListItem>,
  scaleFactor: number,
): void {
  for (const { item, amount } of materials) {
    const scaled = amount * scaleFactor;
    const isCraftable = depth < 4 && !!subcraftMap[item.id];
    if (craftModeSet.has(item.id) && isCraftable) {
      const sub = pickPreferredCraft(subcraftMap[item.id]!, item.id);
      const produced = sub.products.find((p) => p.item.id === item.id)?.amount ?? 1;
      buildShoppingList(
        sub.materials,
        craftModeSet,
        subcraftMap,
        depth + 1,
        acc,
        scaled / produced,
      );
    } else {
      const existing = acc.get(item.id);
      if (existing) {
        existing.totalAmount += scaled;
      } else {
        acc.set(item.id, { item, totalAmount: scaled });
      }
    }
  }
}

function buildLaborByProficiency(
  craft: { labor: number; proficiency: string | null },
  materials: { item: { id: number }; amount: number }[],
  craftModeSet: Set<number>,
  subcraftMap: SubcraftMap,
  depth: number,
  scaleFactor: number,
  acc: Map<string, number>,
  proficiencyMap: ProficiencyMap,
): void {
  const batches = Math.ceil(scaleFactor);
  if (craft.labor > 0) {
    const key = craft.proficiency ?? "Unknown";
    const perBatch = getDiscountedLabor(
      craft.labor,
      craft.proficiency,
      proficiencyMap,
    );
    acc.set(key, (acc.get(key) ?? 0) + batches * perBatch);
  }
  for (const { item, amount } of materials) {
    const scaled = amount * scaleFactor;
    const isCraftable = depth < 4 && !!subcraftMap[item.id];
    if (craftModeSet.has(item.id) && isCraftable) {
      const sub = pickPreferredCraft(subcraftMap[item.id]!, item.id);
      const produced =
        sub.products.find((p) => p.item.id === item.id)?.amount ?? 1;
      buildLaborByProficiency(
        sub.craft,
        sub.materials,
        craftModeSet,
        subcraftMap,
        depth + 1,
        scaled / produced,
        acc,
        proficiencyMap,
      );
    }
  }
}

// ─── Share button ─────────────────────────────────────────────────────────────

function ShareButton() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      className="bg-muted hover:bg-muted/80 rounded-md border px-3 py-1.5 text-sm transition-colors"
    >
      {copied ? "Copied!" : "Copy Link"}
    </button>
  );
}

// ─── Recipe display ───────────────────────────────────────────────────────────

function RecipeTree({
  entry,
  priceMap,
  overrideMap,
  proficiencyMap,
  subcraftMap,
  craftModeSet,
  toggleMode,
  depth = 0,
}: {
  entry: {
    craft: ForCraftOutput["craft"];
    materials: ForCraftOutput["materials"];
    products: ForCraftOutput["products"];
  } | SubcraftEntry;
  priceMap: PriceMap;
  overrideMap: OverrideMap;
  proficiencyMap: ProficiencyMap;
  subcraftMap: SubcraftMap;
  craftModeSet: Set<number>;
  toggleMode: (itemId: number) => void;
  depth?: number;
}) {
  const { craft, materials } = entry;

  const getCraftCostPerUnit = (itemId: number): number => {
    const subEntries = subcraftMap[itemId];
    if (!subEntries) return 0;
    const sub = pickPreferredCraft(subEntries, itemId);
    const batchCost = sub.materials.reduce((sum, { item, amount }) => {
      const custom = overrideMap.get(item.id);
      const price = priceMap.get(item.id);
      const u =
        custom != null
          ? custom
          : parseFloat(price?.avg24h ?? price?.avg7d ?? "0");
      return sum + u * amount;
    }, 0);
    const produced =
      sub.products.find((p) => p.item.id === itemId)?.amount ?? 1;
    return batchCost / produced;
  };

  const total = materials.reduce((sum, { item, amount }) => {
    const isCraftable = depth < 4 && !!subcraftMap[item.id];
    const custom = overrideMap.get(item.id);
    const price = priceMap.get(item.id);
    const buyUnit =
      custom != null
        ? custom
        : parseFloat(price?.avg24h ?? price?.avg7d ?? "0");
    const unit =
      craftModeSet.has(item.id) && isCraftable
        ? getCraftCostPerUnit(item.id)
        : buyUnit;
    return sum + unit * amount;
  }, 0);

  const hasPrices = priceMap.size > 0 || overrideMap.size > 0;
  const hasCraftable = materials.some(
    ({ item }) => depth < 4 && !!subcraftMap[item.id],
  );

  return (
    <div
      className={`rounded-md border ${depth > 0 ? "bg-muted/20 border-dashed" : ""} p-3`}
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <p className={`font-semibold ${depth > 0 ? "text-sm" : ""} truncate`}>
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
        {hasPrices && (
          <p className="shrink-0 text-sm font-medium tabular-nums">
            <span className="text-muted-foreground mr-1 text-xs font-normal">
              materials
            </span>
            <span className="text-primary">
              {total.toLocaleString(undefined, { maximumFractionDigits: 0 })}g
            </span>
          </p>
        )}
      </div>

      <ul className="flex flex-col gap-1">
        {materials.map(({ item, amount }) => {
          const isCraftable = depth < 4 && !!subcraftMap[item.id];
          const mode = craftModeSet.has(item.id) ? "craft" : "buy";
          const customPrice = overrideMap.get(item.id);
          const price = priceMap.get(item.id);
          const isCustom = customPrice != null;
          const buyUnit = isCustom
            ? customPrice
            : parseFloat(price?.avg24h ?? price?.avg7d ?? "0");
          const craftUnit = isCraftable ? getCraftCostPerUnit(item.id) : 0;
          const unit = mode === "craft" && isCraftable ? craftUnit : buyUnit;
          const lineTotal = unit * amount;
          const hasPrice = isCustom || !!price;
          const totalDiff =
            isCraftable && hasPrice ? (buyUnit - craftUnit) * amount : null;
          const subEntry = isCraftable
            ? pickPreferredCraft(subcraftMap[item.id]!, item.id)
            : null;
          const subLabor = subEntry
            ? getDiscountedLabor(
                subEntry.craft.labor,
                subEntry.craft.proficiency,
                proficiencyMap,
              )
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
                      onClick={() => toggleMode(item.id)}
                      className={`px-2.5 py-0.5 transition-colors ${
                        mode === "buy"
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Buy
                    </button>
                    <button
                      onClick={() => toggleMode(item.id)}
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
                        {subLabor}L +
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
                  <RecipeTree
                    entry={subEntry}
                    priceMap={priceMap}
                    overrideMap={overrideMap}
                    proficiencyMap={proficiencyMap}
                    subcraftMap={subcraftMap}
                    craftModeSet={craftModeSet}
                    toggleMode={toggleMode}
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
    </div>
  );
}

// ─── Main detail component ────────────────────────────────────────────────────

function ShoplistDetail({ craftId }: { craftId: number }) {
  const trpc = useTRPC();
  const navigate = useNavigate({ from: "/shoplist" });
  const { qty, sub } = Route.useSearch();

  const { data } = useSuspenseQuery(trpc.crafts.forCraft.queryOptions(craftId));
  const { proficiencyMap, overrideMap } = useUserData();

  const [localQty, setLocalQty] = useState(qty);
  useEffect(() => { setLocalQty(qty); }, [qty]);

  const priceMap: PriceMap = useMemo(
    () => new Map(data?.prices.map((p) => [p.itemId, p])),
    [data],
  );

  const craftModeSet = useMemo(
    () => new Set((sub ?? "").split(",").filter(Boolean).map(Number)),
    [sub],
  );

  const toggleMode = (itemId: number) => {
    const next = new Set(craftModeSet);
    if (next.has(itemId)) next.delete(itemId);
    else next.add(itemId);
    const newSub = [...next].join(",") || undefined;
    void navigate({ search: (prev) => ({ ...prev, sub: newSub }) });
  };

  const commitQty = (val: number) => {
    const clamped = Math.max(1, Math.floor(val));
    void navigate({ search: (prev) => ({ ...prev, qty: clamped }) });
  };

  if (!data) return <p>Craft not found.</p>;

  const subcraftMap = data.subcraftsByItemId ?? {};

  // Scale materials by qty for the recipe tree display
  const scaledEntry = useMemo(
    () => ({
      craft: data.craft,
      materials: data.materials.map((m) => ({ ...m, amount: m.amount * qty })),
      products: data.products,
    }),
    [data, qty],
  );

  // Build flat shopping list
  const shoppingList = useMemo(() => {
    const acc = new Map<number, ShoppingListItem>();
    buildShoppingList(data.materials, craftModeSet, subcraftMap, 0, acc, qty);
    return [...acc.values()].sort((a, b) =>
      a.item.name.localeCompare(b.item.name),
    );
  }, [data.materials, craftModeSet, subcraftMap, qty]);

  const laborByProficiency = useMemo(() => {
    const acc = new Map<string, number>();
    buildLaborByProficiency(
      data.craft,
      data.materials,
      craftModeSet,
      subcraftMap,
      0,
      qty,
      acc,
      proficiencyMap,
    );
    return acc;
  }, [data.craft, data.materials, craftModeSet, subcraftMap, qty, proficiencyMap]);

  const totalLabor = useMemo(
    () => [...laborByProficiency.values()].reduce((s, v) => s + v, 0),
    [laborByProficiency],
  );

  const totalCost = shoppingList.reduce((sum, { item, totalAmount }) => {
    const custom = overrideMap.get(item.id);
    const price = priceMap.get(item.id);
    const unit =
      custom != null
        ? custom
        : parseFloat(price?.avg24h ?? price?.avg7d ?? "0");
    return sum + unit * Math.ceil(totalAmount);
  }, 0);

  return (
    <div className="flex flex-col gap-6">
      {/* Back link */}
      {data.item && (
        <Link
          to="/craft/$itemId"
          params={{ itemId: data.item.id }}
          className="text-muted-foreground flex items-center gap-1 text-sm hover:underline"
        >
          ← {data.item.name}
        </Link>
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {data.item?.icon && (
            <ItemIcon icon={data.item.icon} name={data.item.name} size="lg" />
          )}
          <div>
            <h1 className="text-3xl font-bold">
              {data.item?.name ?? data.craft.name}
            </h1>
            <p className="text-muted-foreground text-sm">{data.craft.name}</p>
          </div>
        </div>
        <ShareButton />
      </div>

      {/* Quantity input */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium" htmlFor="shoplist-qty">
          Number of crafts
        </label>
        <input
          id="shoplist-qty"
          type="number"
          min="1"
          value={localQty}
          onChange={(e) => setLocalQty(Number(e.target.value))}
          onBlur={() => commitQty(localQty)}
          onKeyDown={(e) => e.key === "Enter" && commitQty(localQty)}
          className="bg-background w-24 rounded-md border px-3 py-1.5 text-sm tabular-nums"
        />
      </div>

      {/* Recipe tree */}
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Recipe</h2>
        <RecipeTree
          entry={scaledEntry}
          priceMap={priceMap}
          overrideMap={overrideMap}
          proficiencyMap={proficiencyMap}
          subcraftMap={subcraftMap}
          craftModeSet={craftModeSet}
          toggleMode={toggleMode}
        />
      </div>

      {/* Flat shopping list */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Shopping List</h2>
          <div className="flex items-center gap-4">
            {totalLabor > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {[...laborByProficiency.entries()].map(([prof, labor]) => (
                  <ProficiencyBadge
                    key={prof}
                    proficiency={prof}
                    suffix={` ${labor.toLocaleString()}`}
                  />
                ))}
              </div>
            )}
            {totalCost > 0 && (
              <p className="text-sm tabular-nums">
                <span className="text-muted-foreground mr-1 text-xs">total</span>
                <span className="text-primary font-medium">
                  {totalCost.toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })}
                  g
                </span>
              </p>
            )}
          </div>
        </div>
        <ul className="flex flex-col gap-1 rounded-md border p-3">
          {shoppingList.map(({ item, totalAmount }) => {
            const custom = overrideMap.get(item.id);
            const price = priceMap.get(item.id);
            const unit =
              custom != null
                ? custom
                : parseFloat(price?.avg24h ?? price?.avg7d ?? "0");
            const qty_ceil = Math.ceil(totalAmount);
            const lineTotal = unit * qty_ceil;
            return (
              <li
                key={item.id}
                className="hover:bg-muted/40 flex items-center gap-2 rounded px-1 py-1 text-sm"
              >
                <ItemIcon icon={item.icon} name={item.name} />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  <span className="text-foreground font-medium">
                    ×{qty_ceil.toLocaleString()}
                  </span>
                  {unit > 0 && (
                    <span className="ml-2">
                      {custom != null && (
                        <span className="text-primary mr-1 text-xs">
                          (custom)
                        </span>
                      )}
                      {lineTotal.toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })}
                      g
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
