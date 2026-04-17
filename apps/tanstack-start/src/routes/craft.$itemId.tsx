import type { inferProcedureOutput } from "@trpc/server";
import type { Dispatch, SetStateAction } from "react";
import { Fragment, Suspense, useMemo, useState } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { z } from "zod";

import type { AppRouter } from "@acme/api";
import { Button } from "@acme/ui/button";
import { Input } from "@acme/ui/input";

import type {
  CraftMode,
  ModesMap,
  OptimizationObjective,
  OverrideMap,
  PriceMap,
  ProficiencyMap,
  SelectedCraftMap,
  SubcraftMap,
} from "~/lib/craft-optimizer";
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
import {
  buildAutoPlan,
  computeManualCraftMetrics,
  getItemPrice,
  getSelectedEntry,
  hasItemPrice,
  MAX_CRAFT_DEPTH,
  parseFinitePrice,
} from "~/lib/craft-optimizer";
import { buildMetaTags, buildPageTitle, getItemIconUrl } from "~/lib/metadata";
import { useUserData } from "~/lib/useUserData";

export const Route = createFileRoute("/craft/$itemId")({
  params: {
    parse: (p) => ({ itemId: z.coerce.number().int().parse(p.itemId) }),
    stringify: (p) => ({ itemId: String(p.itemId) }),
  },
  validateSearch: z.object({
    listId: z.string().uuid().optional(),
  }),
  loader: async ({ context, params }) => {
    const { trpc, queryClient } = context;
    const data = await queryClient.fetchQuery(
      trpc.crafts.forItem.queryOptions(params.itemId),
    );
    if (!data) {
      notFound({ throw: true });
      throw new Error("Craft detail loader reached an impossible state.");
    }
    return data;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const item = loaderData.item;
    return {
      meta: buildMetaTags({
        title: buildPageTitle(item.name, "Craft"),
        description: `Inspect recipe costs, materials, and craft-path choices for ${item.name}.`,
        image: getItemIconUrl(item.icon),
      }),
    };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { listId } = Route.useSearch();
  return (
    <main className="container py-16">
      <Link
        to="/craft"
        search={{ listId }}
        className="text-muted-foreground mb-6 flex items-center gap-1 text-sm hover:underline"
      >
        ← Back to list
      </Link>
      <Suspense fallback={<p>Loading...</p>}>
        <ItemDetail listId={listId} />
      </Suspense>
    </main>
  );
}

type PageData = NonNullable<
  inferProcedureOutput<AppRouter["crafts"]["forItem"]>
>;
type CraftEntry = PageData["crafts"][number];
type SubcraftEntry = PageData["subcraftsByItemId"][number][number];
type AnyCraftEntry = CraftEntry | SubcraftEntry;
type PageSubcraftMap = SubcraftMap<AnyCraftEntry>;

function serializeCraftModeSearch(modes: ModesMap): string | undefined {
  const craftedItemIds = Object.entries(modes)
    .filter(([, mode]) => mode === "craft")
    .map(([itemId]) => Number(itemId))
    .filter(Number.isInteger)
    .sort((a, b) => a - b);

  if (!craftedItemIds.length) return undefined;
  return craftedItemIds.join(",");
}

function serializeSelectedCraftsSearch(
  selectedCrafts: SelectedCraftMap,
): string | undefined {
  const entries = Object.entries(selectedCrafts)
    .map(([itemId, craftId]) => [Number(itemId), craftId] as const)
    .filter(
      ([itemId, craftId]) =>
        Number.isInteger(itemId) && Number.isInteger(craftId),
    )
    .sort(([left], [right]) => left - right)
    .map(([itemId, craftId]) => `${itemId}:${craftId}`);

  if (!entries.length) return undefined;
  return entries.join(",");
}

function formatGold(value: number): string {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}g`;
}

function formatSilverPerLabor(value: number): string {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} s/L`;
}

function getVariant(value: number): "positive" | "negative" | "neutral" {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

function formatSilverPerLaborValue(
  state: "finite" | "infinite" | "none",
  value: number | null,
): string {
  if (state === "infinite") return "∞ s/L";
  if (state === "finite" && value != null) return formatSilverPerLabor(value);
  return "—";
}

function getSilverPerLaborVariant(
  state: "finite" | "infinite" | "none",
  value: number | null,
): "positive" | "negative" | "neutral" {
  if (state === "infinite") return "positive";
  if (state === "finite" && value != null) return getVariant(value);
  return "neutral";
}

function CraftRecipe({
  entry,
  producedItemId,
  priceMap,
  overrideMap,
  proficiencyMap,
  subcraftMap = {},
  depth = 0,
  modes,
  setModes,
  selectedCrafts,
  setSelectedCrafts,
  collapsedCraftIds,
  toggleCollapsed,
  listId,
}: {
  entry: AnyCraftEntry;
  producedItemId: number;
  priceMap: PriceMap;
  overrideMap: OverrideMap;
  proficiencyMap: ProficiencyMap;
  subcraftMap?: PageSubcraftMap;
  depth?: number;
  modes?: ModesMap;
  setModes?: Dispatch<SetStateAction<ModesMap>>;
  selectedCrafts?: SelectedCraftMap;
  setSelectedCrafts?: Dispatch<SetStateAction<SelectedCraftMap>>;
  collapsedCraftIds?: Set<number>;
  toggleCollapsed?: (craftId: number) => void;
  listId?: string;
}) {
  const { craft, materials } = entry;
  const [localModes, setLocalModes] = useState<ModesMap>({});
  const resolvedModes = modes ?? localModes;
  const updateModes = setModes ?? setLocalModes;
  const [localSelectedCrafts, setLocalSelectedCrafts] =
    useState<SelectedCraftMap>({});
  const resolvedSelectedCrafts = selectedCrafts ?? localSelectedCrafts;
  const updateSelectedCrafts = setSelectedCrafts ?? setLocalSelectedCrafts;
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

  const defaultSalePrice = getItemPrice(producedItemId, priceMap, overrideMap);
  const localSaleOverride = parseFinitePrice(localSalePrice);
  const effectiveSalePrice =
    localSalePrice.trim() !== "" &&
    localSaleOverride != null &&
    localSaleOverride >= 0
      ? localSaleOverride
      : defaultSalePrice;

  const metrics = useMemo(
    () =>
      computeManualCraftMetrics(
        entry,
        producedItemId,
        effectiveSalePrice,
        {
          subcraftMap,
          priceMap,
          overrideMap,
          proficiencyMap,
          maxDepth: MAX_CRAFT_DEPTH,
        },
        resolvedModes,
        resolvedSelectedCrafts,
        depth,
      ),
    [
      depth,
      effectiveSalePrice,
      entry,
      overrideMap,
      priceMap,
      producedItemId,
      proficiencyMap,
      resolvedModes,
      resolvedSelectedCrafts,
      subcraftMap,
    ],
  );

  const applyAutoPlan = (objective: OptimizationObjective) => {
    const candidateEntries: AnyCraftEntry[] =
      depth === 0 ? [entry] : (subcraftMap[producedItemId] ?? [entry]);
    const plan = buildAutoPlan(
      candidateEntries,
      producedItemId,
      effectiveSalePrice,
      {
        subcraftMap,
        priceMap,
        overrideMap,
        proficiencyMap,
        maxDepth: MAX_CRAFT_DEPTH,
      },
      objective,
    );
    if (!plan) return;

    updateModes((prev) => ({
      ...prev,
      ...plan.modes,
    }));
    updateSelectedCrafts((prev) => ({
      ...prev,
      ...(depth > 0 ? { [producedItemId]: plan.entry.craft.id } : {}),
      ...plan.selectedCrafts,
    }));
  };

  const hasPrices = priceMap.size > 0 || overrideMap.size > 0;
  const hasCraftable = materials.some(
    ({ item }) => depth < MAX_CRAFT_DEPTH && !!subcraftMap[item.id]?.length,
  );

  return (
    <RecipeCardShell depth={depth}>
      <RecipeHeader
        depth={depth}
        title={craft.name}
        laborLabel={craft.labor > 0 ? `${metrics.directLabor} labor` : null}
        materialsLabel={hasPrices ? formatGold(metrics.materialsCost) : null}
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
              search={{
                craft: craft.id,
                qty: 1,
                sub: serializeCraftModeSearch(resolvedModes),
                sel: serializeSelectedCraftsSearch(resolvedSelectedCrafts),
                listId,
              }}
              className="text-muted-foreground text-xs hover:underline"
            >
              Shoplist →
            </Link>
          ) : null
        }
      />

      {!isCollapsed && (
        <>
          {hasCraftable ? (
            <div className="mb-3 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => applyAutoPlan("profit")}
              >
                Most profitable
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => applyAutoPlan("silverPerLabor")}
              >
                Best silver / labor
              </Button>
            </div>
          ) : null}

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
                <StatCard
                  label="Cost / unit"
                  value={formatGold(metrics.costPerUnit)}
                />
                <StatCard
                  label="Profit / unit"
                  value={formatGold(metrics.profitPerUnit)}
                  variant={getVariant(metrics.profitPerUnit)}
                />
                <StatCard
                  label="Silver / labor"
                  value={formatSilverPerLaborValue(
                    metrics.silverPerLaborState,
                    metrics.silverPerLabor,
                  )}
                  variant={getSilverPerLaborVariant(
                    metrics.silverPerLaborState,
                    metrics.silverPerLabor,
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard
                  label="Batch cost"
                  value={formatGold(metrics.materialsCost)}
                />
                <StatCard
                  label="Items / batch"
                  value={metrics.producedAmount.toLocaleString()}
                />
                <StatCard
                  label="Labor / batch"
                  value={metrics.totalLaborPerBatch.toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}
                />
                <StatCard
                  label="Labor / unit"
                  value={metrics.laborPerUnit.toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}
                />
              </div>
            </div>
          )}

          {/* Materials */}
          <ul className="flex flex-col gap-1">
            {materials.map(({ item, amount }) => {
              const isCraftable =
                depth < MAX_CRAFT_DEPTH && !!subcraftMap[item.id]?.length;
              const mode = getMode(item.id);
              const customPrice = overrideMap.get(item.id);
              const isCustom = customPrice != null;
              const buyUnit = getItemPrice(item.id, priceMap, overrideMap);
              const selectedSubEntry = isCraftable
                ? getSelectedEntry(item.id, subcraftMap, resolvedSelectedCrafts)
                : null;
              const craftedMetrics = selectedSubEntry
                ? computeManualCraftMetrics(
                    selectedSubEntry,
                    item.id,
                    getItemPrice(item.id, priceMap, overrideMap),
                    {
                      subcraftMap,
                      priceMap,
                      overrideMap,
                      proficiencyMap,
                      maxDepth: MAX_CRAFT_DEPTH,
                    },
                    resolvedModes,
                    resolvedSelectedCrafts,
                    depth + 1,
                  )
                : null;
              const craftUnit = craftedMetrics?.costPerUnit ?? 0;
              const unit =
                mode === "craft" && isCraftable ? craftUnit : buyUnit;
              const lineTotal = unit * amount;
              const hasPrice = hasItemPrice(item.id, priceMap, overrideMap);
              const totalDiff =
                isCraftable && hasPrice ? (buyUnit - craftUnit) * amount : null;
              const subLabor = craftedMetrics?.laborPerUnit ?? 0;

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

                  {mode === "craft" && isCraftable && selectedSubEntry && (
                    <li className="border-muted-foreground/20 my-0.5 ml-3 border-l-2 pl-3">
                      <CraftRecipe
                        entry={selectedSubEntry}
                        producedItemId={item.id}
                        priceMap={priceMap}
                        overrideMap={overrideMap}
                        proficiencyMap={proficiencyMap}
                        subcraftMap={subcraftMap}
                        depth={depth + 1}
                        modes={resolvedModes}
                        setModes={updateModes}
                        selectedCrafts={resolvedSelectedCrafts}
                        setSelectedCrafts={updateSelectedCrafts}
                        collapsedCraftIds={resolvedCollapsedCraftIds}
                        toggleCollapsed={updateCollapsed}
                        listId={listId}
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

function ItemDetail({ listId }: { listId?: string }) {
  const data = Route.useLoaderData();
  const { proficiencyMap, overrideMap } = useUserData();

  const priceMap: PriceMap = useMemo(
    () => new Map(data.prices.map((p) => [p.itemId, p])),
    [data],
  );

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
              producedItemId={item.id}
              priceMap={priceMap}
              overrideMap={overrideMap}
              proficiencyMap={proficiencyMap}
              subcraftMap={data.subcraftsByItemId}
              listId={listId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
