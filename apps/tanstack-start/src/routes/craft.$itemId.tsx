import type { inferProcedureOutput } from "@trpc/server";
import type { Dispatch, SetStateAction } from "react";
import { Fragment, Suspense, useMemo, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";

import type { AppRouter } from "@acme/api";
import { Input } from "@acme/ui/input";

import type { ProficiencyMap } from "~/lib/proficiency";
import { ItemDescription } from "~/component/item-description";
import { ItemIcon } from "~/component/item-icon";
import {
  CraftModeToggle,
  RecipeCardShell,
  RecipeCollapseToggle,
  RecipeHeader,
  RecipeItemRow,
  RecipeLegend,
} from "~/component/recipe-breakdown";
import { StatCard } from "~/component/stat-card";
import { pickPreferredCraft } from "~/lib/craft-helpers";
import { getDiscountedLabor } from "~/lib/proficiency";
import { useTRPC } from "~/lib/trpc";
import { useUserData } from "~/lib/useUserData";

export const Route = createFileRoute("/craft/$itemId")({
  params: {
    parse: (p) => ({ itemId: z.coerce.number().int().parse(p.itemId) }),
    stringify: (p) => ({ itemId: String(p.itemId) }),
  },
  loader: async ({ context, params }) => {
    const { trpc, queryClient } = context;
    const data = await queryClient.fetchQuery(
      trpc.crafts.forItem.queryOptions(params.itemId),
    );
    if (!data) return;
  },
  component: RouteComponent,
  notFoundComponent: () => <p>Item not found.</p>,
});

function RouteComponent() {
  const { itemId } = Route.useParams();
  return (
    <main className="container py-16">
      <Link
        to="/craft"
        className="text-muted-foreground mb-6 flex items-center gap-1 text-sm hover:underline"
      >
        ← Back to list
      </Link>
      <Suspense fallback={<p>Loading...</p>}>
        <ItemDetail itemId={itemId} />
      </Suspense>
    </main>
  );
}

type PageData = NonNullable<
  inferProcedureOutput<AppRouter["crafts"]["forItem"]>
>;
type CraftEntry = PageData["crafts"][number];
type SubcraftEntry = PageData["subcraftsByItemId"][number][number];
type PriceMap = Map<number, { avg24h: string | null; avg7d: string | null }>;
type OverrideMap = Map<number, number>;
type SubcraftMap = Record<number, SubcraftEntry[]>;
type CraftMode = "buy" | "craft";
type ModesMap = Record<number, CraftMode>;

function formatGold(value: number): string {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}g`;
}

function formatSilverPerLabor(value: number): string {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} s/L`;
}

function parseFinitePrice(value: string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getMarketPrice(
  price: { avg24h: string | null; avg7d: string | null } | null | undefined,
): number {
  return parseFinitePrice(price?.avg24h) ?? parseFinitePrice(price?.avg7d) ?? 0;
}

function getItemPrice(
  itemId: number,
  priceMap: PriceMap,
  overrideMap: OverrideMap,
): number {
  return overrideMap.get(itemId) ?? getMarketPrice(priceMap.get(itemId));
}

function getProducedAmount(
  entry: CraftEntry | SubcraftEntry,
  itemId: number,
): number {
  return (
    entry.products.find((product) => product.item.id === itemId)?.amount ?? 1
  );
}

function getPreferredSubcraft(
  itemId: number,
  subcraftMap: SubcraftMap,
): SubcraftEntry | null {
  const entries = subcraftMap[itemId];
  return entries?.length ? pickPreferredCraft(entries, itemId) : null;
}

function getCraftCostPerUnit(
  itemId: number,
  subcraftMap: SubcraftMap,
  priceMap: PriceMap,
  overrideMap: OverrideMap,
  modes: ModesMap,
  maxDepth = 4,
  visited = new Set<number>(),
): number {
  if (visited.has(itemId) || maxDepth <= 0) {
    return getItemPrice(itemId, priceMap, overrideMap);
  }

  const subEntry = getPreferredSubcraft(itemId, subcraftMap);
  if (!subEntry) return getItemPrice(itemId, priceMap, overrideMap);

  const nextVisited = new Set(visited);
  nextVisited.add(itemId);

  const batchCost = subEntry.materials.reduce((sum, { item, amount }) => {
    const shouldCraft =
      !!subcraftMap[item.id]?.length && (modes[item.id] ?? "buy") === "craft";
    const unitCost = shouldCraft
      ? getCraftCostPerUnit(
          item.id,
          subcraftMap,
          priceMap,
          overrideMap,
          modes,
          maxDepth - 1,
          nextVisited,
        )
      : getItemPrice(item.id, priceMap, overrideMap);
    return sum + unitCost * amount;
  }, 0);

  return batchCost / getProducedAmount(subEntry, itemId);
}

function getCraftLaborPerUnit(
  itemId: number,
  subcraftMap: SubcraftMap,
  proficiencyMap: ProficiencyMap,
  modes: ModesMap,
  maxDepth = 4,
  visited = new Set<number>(),
): number {
  if (visited.has(itemId) || maxDepth <= 0) return 0;

  const subEntry = getPreferredSubcraft(itemId, subcraftMap);
  if (!subEntry) return 0;

  const nextVisited = new Set(visited);
  nextVisited.add(itemId);

  let labor = getDiscountedLabor(
    subEntry.craft.labor,
    subEntry.craft.proficiency,
    proficiencyMap,
  );

  for (const { item, amount } of subEntry.materials) {
    const shouldCraft =
      !!subcraftMap[item.id]?.length && (modes[item.id] ?? "buy") === "craft";
    if (!shouldCraft) continue;
    labor +=
      getCraftLaborPerUnit(
        item.id,
        subcraftMap,
        proficiencyMap,
        modes,
        maxDepth - 1,
        nextVisited,
      ) * amount;
  }

  return labor / getProducedAmount(subEntry, itemId);
}

function getVariant(value: number): "positive" | "negative" | "neutral" {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

function CraftRecipe({
  entry,
  itemId,
  priceMap,
  overrideMap,
  proficiencyMap,
  subcraftMap = {},
  depth = 0,
  modes,
  setModes,
  collapsedCraftIds,
  toggleCollapsed,
}: {
  entry: CraftEntry | SubcraftEntry;
  itemId: number;
  priceMap: PriceMap;
  overrideMap: OverrideMap;
  proficiencyMap: ProficiencyMap;
  subcraftMap?: SubcraftMap;
  depth?: number;
  modes?: ModesMap;
  setModes?: Dispatch<SetStateAction<ModesMap>>;
  collapsedCraftIds?: Set<number>;
  toggleCollapsed?: (craftId: number) => void;
}) {
  const { craft, materials } = entry;
  const [localModes, setLocalModes] = useState<ModesMap>({});
  const resolvedModes = modes ?? localModes;
  const updateModes = setModes ?? setLocalModes;
  const [localSalePrice, setLocalSalePrice] = useState("");
  const [localCollapsedCraftIds, setLocalCollapsedCraftIds] = useState<
    Set<number>
  >(() => new Set());
  const resolvedCollapsedCraftIds = collapsedCraftIds ?? localCollapsedCraftIds;
  const updateCollapsed =
    toggleCollapsed ??
    ((craftId: number) =>
      setLocalCollapsedCraftIds((prev) => {
        const next = new Set(prev);
        if (next.has(craftId)) next.delete(craftId);
        else next.add(craftId);
        return next;
      }));
  const isCollapsed = resolvedCollapsedCraftIds.has(craft.id);

  const getMode = (materialItemId: number): CraftMode =>
    resolvedModes[materialItemId] ?? "buy";

  const producedAmount = getProducedAmount(entry, itemId);
  const directLabor = getDiscountedLabor(
    craft.labor,
    craft.proficiency,
    proficiencyMap,
  );

  const materialsCost = materials.reduce((sum, { item, amount }) => {
    const isCraftable = depth < 4 && !!subcraftMap[item.id]?.length;
    const unit =
      getMode(item.id) === "craft" && isCraftable
        ? getCraftCostPerUnit(
            item.id,
            subcraftMap,
            priceMap,
            overrideMap,
            resolvedModes,
            4 - depth,
          )
        : getItemPrice(item.id, priceMap, overrideMap);
    return sum + unit * amount;
  }, 0);

  const subcraftLabor = materials.reduce((sum, { item, amount }) => {
    const isCraftable = depth < 4 && !!subcraftMap[item.id]?.length;
    if (getMode(item.id) !== "craft" || !isCraftable) return sum;
    return (
      sum +
      getCraftLaborPerUnit(
        item.id,
        subcraftMap,
        proficiencyMap,
        resolvedModes,
        4 - depth,
      ) *
        amount
    );
  }, 0);

  const totalLaborPerBatch = directLabor + subcraftLabor;
  const costPerUnit = producedAmount > 0 ? materialsCost / producedAmount : 0;
  const laborPerUnit =
    producedAmount > 0 ? totalLaborPerBatch / producedAmount : 0;

  const defaultSalePrice = getItemPrice(itemId, priceMap, overrideMap);
  const localSaleOverride = parseFinitePrice(localSalePrice);
  const effectiveSalePrice =
    localSalePrice.trim() !== "" &&
    localSaleOverride != null &&
    localSaleOverride >= 0
      ? localSaleOverride
      : defaultSalePrice;
  const profitPerUnit = effectiveSalePrice - costPerUnit;
  const silverPerLabor =
    laborPerUnit > 0 ? (profitPerUnit * 100) / laborPerUnit : null;

  const hasPrices = priceMap.size > 0 || overrideMap.size > 0;
  const hasCraftable = materials.some(
    ({ item }) => depth < 4 && !!subcraftMap[item.id]?.length,
  );

  return (
    <RecipeCardShell depth={depth}>
      <RecipeHeader
        depth={depth}
        title={craft.name}
        laborLabel={craft.labor > 0 ? `${directLabor} labor` : null}
        materialsLabel={hasPrices ? formatGold(materialsCost) : null}
        collapseToggle={
          <RecipeCollapseToggle
            collapsed={isCollapsed}
            onToggle={() => updateCollapsed(craft.id)}
          />
        }
        action={
          depth === 0 ? (
            <Link
              to="/shoplist"
              search={{ craft: craft.id, qty: 1 }}
              className="text-muted-foreground text-xs hover:underline"
            >
              Shoplist →
            </Link>
          ) : null
        }
      />

      {!isCollapsed && (
        <>
          {depth === 0 && (
            <div className="mb-4 flex flex-col gap-3 rounded-md border p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-sm font-medium">Sale price</p>
                  <p className="text-muted-foreground text-xs">
                    Uses profile override or market price by default. This input
                    is temporary to this craft card.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={localSalePrice}
                    onChange={(event) => setLocalSalePrice(event.target.value)}
                    placeholder={
                      defaultSalePrice > 0 ? String(defaultSalePrice) : "0"
                    }
                    className="w-32 tabular-nums"
                    aria-label={`${craft.name} sale price`}
                  />
                  <span className="text-muted-foreground text-sm">g</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard
                  label="Sale price"
                  value={formatGold(effectiveSalePrice)}
                />
                <StatCard label="Cost / unit" value={formatGold(costPerUnit)} />
                <StatCard
                  label="Profit / unit"
                  value={formatGold(profitPerUnit)}
                  variant={getVariant(profitPerUnit)}
                />
                <StatCard
                  label="Silver / labor"
                  value={
                    silverPerLabor == null
                      ? "—"
                      : formatSilverPerLabor(silverPerLabor)
                  }
                  variant={
                    silverPerLabor == null
                      ? "neutral"
                      : getVariant(silverPerLabor)
                  }
                />
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard
                  label="Batch cost"
                  value={formatGold(materialsCost)}
                />
                <StatCard
                  label="Items / batch"
                  value={producedAmount.toLocaleString()}
                />
                <StatCard
                  label="Labor / batch"
                  value={totalLaborPerBatch.toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}
                />
                <StatCard
                  label="Labor / unit"
                  value={laborPerUnit.toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}
                />
              </div>
            </div>
          )}

          {/* Materials */}
          <ul className="flex flex-col gap-1">
            {materials.map(({ item, amount }) => {
              const isCraftable = depth < 4 && !!subcraftMap[item.id]?.length;
              const mode = getMode(item.id);
              const customPrice = overrideMap.get(item.id);
              const isCustom = customPrice != null;
              const buyUnit = getItemPrice(item.id, priceMap, overrideMap);
              const craftUnit = isCraftable
                ? getCraftCostPerUnit(
                    item.id,
                    subcraftMap,
                    priceMap,
                    overrideMap,
                    resolvedModes,
                    4 - depth,
                  )
                : 0;
              const unit =
                mode === "craft" && isCraftable ? craftUnit : buyUnit;
              const lineTotal = unit * amount;
              const hasPrice = isCustom || priceMap.has(item.id);
              const totalDiff =
                isCraftable && hasPrice ? (buyUnit - craftUnit) * amount : null;
              const subEntry = isCraftable
                ? pickPreferredCraft(subcraftMap[item.id] ?? [], item.id)
                : null;
              const subLabor = subEntry
                ? getCraftLaborPerUnit(
                    item.id,
                    subcraftMap,
                    proficiencyMap,
                    resolvedModes,
                    4 - depth,
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
                            updateModes((m) => ({ ...m, [item.id]: "buy" }))
                          }
                          onCraft={() =>
                            updateModes((m) => ({ ...m, [item.id]: "craft" }))
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
                                maximumFractionDigits: 2,
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
                      <CraftRecipe
                        entry={subEntry}
                        itemId={itemId}
                        priceMap={priceMap}
                        overrideMap={overrideMap}
                        proficiencyMap={proficiencyMap}
                        subcraftMap={subcraftMap}
                        depth={depth + 1}
                        modes={resolvedModes}
                        setModes={updateModes}
                        collapsedCraftIds={resolvedCollapsedCraftIds}
                        toggleCollapsed={updateCollapsed}
                      />
                    </li>
                  )}
                </Fragment>
              );
            })}
          </ul>

          {/* Legend — only on top-level cards that have craftable ingredients */}
          {depth === 0 && hasCraftable ? <RecipeLegend /> : null}
        </>
      )}
    </RecipeCardShell>
  );
}

function ItemDetail({ itemId }: { itemId: number }) {
  const trpc = useTRPC();
  const { data } = useSuspenseQuery(trpc.crafts.forItem.queryOptions(itemId));
  const { proficiencyMap, overrideMap } = useUserData();

  const priceMap: PriceMap = useMemo(
    () => new Map(data?.prices.map((p) => [p.itemId, p])),
    [data],
  );

  if (!data) return <p>Item not found.</p>;

  const { item, crafts } = data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        {item.icon && <ItemIcon icon={item.icon} name={item.name} size="lg" />}
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">{item.name}</h1>
            <Link
              to="/item/$itemId"
              params={{ itemId: item.id }}
              className="text-muted-foreground text-sm hover:underline"
            >
              View item page
            </Link>
          </div>
          <p className="text-muted-foreground text-sm">{item.category}</p>
        </div>
      </div>

      {item.description && <ItemDescription text={item.description} />}

      {crafts.length > 0 && (
        <div className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold">Crafts</h2>
          {crafts.map((entry) => (
            <CraftRecipe
              key={entry.craft.id}
              entry={entry}
              itemId={item.id}
              priceMap={priceMap}
              overrideMap={overrideMap}
              proficiencyMap={proficiencyMap}
              subcraftMap={data.subcraftsByItemId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
