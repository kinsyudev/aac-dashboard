import type { inferProcedureOutput } from "@trpc/server";
import { Suspense, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Info, Pencil } from "lucide-react";
import { z } from "zod";

import type { AppRouter } from "@acme/api";
import { Button } from "@acme/ui/button";
import { Input } from "@acme/ui/input";
import { toast } from "@acme/ui/toast";

import type {
  ModesMap,
  PriceMap,
  SelectedCraftMap,
  SubcraftMap,
} from "~/lib/craft-optimizer";
import { ItemDescription } from "~/component/item-description";
import { ItemIcon } from "~/component/item-icon";
import { StatCard } from "~/component/stat-card";
import { pickPreferredCraft } from "~/lib/craft-helpers";
import {
  getItemPrice,
  getProducedAmount,
  getSelectedEntry,
  hasItemPrice,
  isCurrencyMaterial,
  parseFinitePrice,
} from "~/lib/craft-optimizer";
import {
  buildCraftPagePlan,
  getRecipeChoiceCost,
  normalizeCraftCount,
} from "~/lib/craft-page-plan";
import { buildMetaTags, buildPageTitle, getItemIconUrl } from "~/lib/metadata";
import { useTRPC } from "~/lib/trpc";
import { useUserData } from "~/lib/useUserData";

export const Route = createFileRoute("/craft/$itemId")({
  params: {
    parse: (p) => ({ itemId: z.coerce.number().int().parse(p.itemId) }),
    stringify: (p) => ({ itemId: String(p.itemId) }),
  },
  validateSearch: z.object({ listId: z.string().uuid().optional() }),
  loader: async ({ context, params }) => {
    const data = await context.queryClient.fetchQuery(
      context.trpc.crafts.forItem.queryOptions(params.itemId),
    );
    if (!data) {
      notFound({ throw: true });
      throw new Error("Craft detail loader reached an impossible state.");
    }
    return data;
  },
  head: ({ loaderData }) =>
    loaderData
      ? {
          meta: buildMetaTags({
            title: buildPageTitle(loaderData.item.name, "Craft"),
            description: `Plan Crafts for ${loaderData.item.name}.`,
            image: getItemIconUrl(loaderData.item.icon),
          }),
        }
      : {},
  component: RouteComponent,
});

type PageData = NonNullable<
  inferProcedureOutput<AppRouter["crafts"]["forItem"]>
>;
type CraftEntry = PageData["crafts"][number];

function formatCurrency(gold: number): string {
  return `${gold.toLocaleString(undefined, { maximumFractionDigits: 2 })}g`;
}

function getPriceSource(
  itemId: number,
  priceMap: PriceMap,
  overrideMap: Map<number, number>,
): string {
  if (overrideMap.has(itemId)) return "Price Override";
  const price = priceMap.get(itemId);
  if (parseFinitePrice(price?.avg24h) != null) return "Latest 24h Market Data";
  if (parseFinitePrice(price?.avg7d) != null) return "Latest 7d Market Data";
  if (parseFinitePrice(price?.avg30d) != null) return "Latest 30d Market Data";
  return "Missing Price";
}

function serializeModes(modes: ModesMap) {
  const ids = Object.entries(modes)
    .filter(([, mode]) => mode === "craft")
    .map(([id]) => Number(id))
    .filter(Number.isInteger)
    .sort((a, b) => a - b);
  return ids.length ? ids.join(",") : undefined;
}

function serializeRecipes(selected: SelectedCraftMap) {
  const choices = Object.entries(selected)
    .map(([itemId, craftId]) => [Number(itemId), craftId] as const)
    .filter(
      ([itemId, craftId]) =>
        Number.isInteger(itemId) && Number.isInteger(craftId),
    )
    .sort(([left], [right]) => left - right)
    .map(([itemId, craftId]) => `${itemId}:${craftId}`);
  return choices.length ? choices.join(",") : undefined;
}

function SelectedCraftTree({
  rootEntry,
  rootItemId,
  rootName,
  subcraftMap,
  modes,
  selectedCrafts,
  focusPath,
  onFocus,
}: {
  rootEntry: CraftEntry;
  rootItemId: number;
  rootName: string;
  subcraftMap: SubcraftMap<CraftEntry>;
  modes: ModesMap;
  selectedCrafts: SelectedCraftMap;
  focusPath: number[];
  onFocus: (path: number[]) => void;
}) {
  const renderNode = (
    entry: CraftEntry,
    itemId: number,
    itemName: string,
    path: number[],
    visited: Set<number>,
  ) => {
    const active = path.join(":") === focusPath.join(":");
    const children = entry.materials.flatMap(({ item }) => {
      if (modes[item.id] !== "craft" || visited.has(item.id)) return [];
      const child = getSelectedEntry(item.id, subcraftMap, selectedCrafts);
      return child
        ? [{ entry: child, itemId: item.id, itemName: item.name }]
        : [];
    });

    return (
      <li key={path.join(":")} className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => onFocus(path)}
          aria-current={active ? "page" : undefined}
          className={`w-fit text-left text-sm hover:underline ${
            active ? "text-foreground font-semibold" : "text-muted-foreground"
          }`}
        >
          {itemName}
        </button>
        {children.length ? (
          <ul className="border-muted ml-2 flex flex-col gap-1 border-l pl-3">
            {children.map((child) =>
              renderNode(
                child.entry,
                child.itemId,
                child.itemName,
                [...path, child.itemId],
                new Set([...visited, child.itemId]),
              ),
            )}
          </ul>
        ) : null}
      </li>
    );
  };

  return (
    <ul className="flex flex-col gap-1">
      {renderNode(
        rootEntry,
        rootItemId,
        rootName,
        [rootItemId],
        new Set([rootItemId]),
      )}
    </ul>
  );
}

function RouteComponent() {
  const { listId } = Route.useSearch();
  return (
    <main className="container py-8 sm:py-16">
      <Link
        to="/craft"
        search={{ listId }}
        className="text-muted-foreground mb-6 flex text-sm hover:underline"
      >
        ← Back to Craft
      </Link>
      <Suspense fallback={<p>Loading...</p>}>
        <CraftPlanPage listId={listId} />
      </Suspense>
    </main>
  );
}

function CraftPlanPage({ listId }: { listId?: string }) {
  const data = Route.useLoaderData();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { proficiencyMap, overrideMap } = useUserData();
  const [craftCountText, setCraftCountText] = useState("1");
  const [rootCraftId, setRootCraftId] = useState<number | null>(null);
  const [modes, setModes] = useState<ModesMap>({});
  const [selectedCrafts, setSelectedCrafts] = useState<SelectedCraftMap>({});
  const [salePriceText, setSalePriceText] = useState("");
  const [focusPath, setFocusPath] = useState<number[]>([data.item.id]);
  const [editingOverrideItemId, setEditingOverrideItemId] = useState<
    number | null
  >(null);
  const [overrideDraft, setOverrideDraft] = useState("");
  const priceMap: PriceMap = useMemo(
    () => new Map(data.prices.map((price) => [price.itemId, price])),
    [data.prices],
  );
  const setPriceOverride = useMutation(
    trpc.profile.setPriceOverride.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(
          trpc.profile.getUserData.pathFilter(),
        );
        setEditingOverrideItemId(null);
        toast.success("Price override saved.");
      },
      onError: () => toast.error("Failed to save price override."),
    }),
  );

  const recommendedRoot = useMemo(
    () =>
      data.crafts.length ? pickPreferredCraft(data.crafts, data.item.id) : null,
    [data.crafts, data.item.id],
  );
  const rootEntry =
    data.crafts.find((entry) => entry.craft.id === rootCraftId) ??
    recommendedRoot;
  if (!rootEntry) {
    return (
      <p className="text-muted-foreground">
        No supported Recipes are available.
      </p>
    );
  }
  const parsedSalePrice = parseFinitePrice(salePriceText);
  const latestSalePrice = hasItemPrice(data.item.id, priceMap, overrideMap)
    ? getItemPrice(data.item.id, priceMap, overrideMap)
    : null;
  const salePriceSource = getPriceSource(data.item.id, priceMap, overrideMap);
  const effectiveSalePrice =
    parsedSalePrice != null && parsedSalePrice >= 0
      ? parsedSalePrice
      : latestSalePrice;
  const plan = buildCraftPagePlan({
    rootEntry,
    rootItemId: data.item.id,
    craftCount: normalizeCraftCount(Number(craftCountText)),
    subcraftMap: data.subcraftsByItemId as SubcraftMap<CraftEntry>,
    modes,
    selectedCrafts,
    priceMap,
    overrideMap,
    proficiencyMap,
    salePrice: effectiveSalePrice ?? undefined,
    focusPath,
  });
  const focusedChoices =
    plan.focused.itemId === data.item.id
      ? data.crafts
      : (data.subcraftsByItemId[plan.focused.itemId] ?? []);
  const focusedSelectedId =
    plan.focused.itemId === data.item.id
      ? rootCraftId
      : selectedCrafts[plan.focused.itemId];

  const setRecipe = (craftId: number) => {
    if (plan.focused.itemId === data.item.id) {
      setRootCraftId(craftId);
      setFocusPath([data.item.id]);
      return;
    }
    setSelectedCrafts((previous) => ({
      ...previous,
      [plan.focused.itemId]: craftId,
    }));
    setFocusPath((previous) =>
      previous.slice(0, previous.indexOf(plan.focused.itemId) + 1),
    );
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex min-w-0 flex-wrap items-center gap-4">
        {data.item.icon ? (
          <ItemIcon icon={data.item.icon} name={data.item.name} size="lg" />
        ) : null}
        <div className="min-w-0">
          <h1 className="truncate text-3xl font-bold">{data.item.name}</h1>
          <p className="text-muted-foreground text-sm">
            Craft Plan · {data.item.category}
          </p>
        </div>
      </header>
      {data.item.description ? (
        <ItemDescription text={data.item.description} />
      ) : null}

      <section
        className="flex flex-col gap-4 rounded-lg border p-4"
        aria-label="Plan summary"
      >
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <h2 className="font-semibold">Whole Plan</h2>
            <p className="text-muted-foreground text-sm">
              {plan.craftCount} Craft{plan.craftCount === 1 ? "" : "s"} produces{" "}
              {plan.summary.totalOutput.toLocaleString()} {data.item.name}.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            Crafts
            <Input
              aria-label="Number of Crafts"
              type="number"
              min="1"
              step="1"
              value={craftCountText}
              onChange={(event) => setCraftCountText(event.target.value)}
              onBlur={() =>
                setCraftCountText(
                  String(normalizeCraftCount(Number(craftCountText))),
                )
              }
              className="w-24 tabular-nums"
            />
          </label>
        </div>
        {plan.summary.missingPriceItems.length ? (
          <p className="rounded bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            Incomplete Plan — Missing Price:{" "}
            {plan.summary.missingPriceItems.join(", ")}.
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard
            label="Craft Cost"
            value={
              plan.summary.craftCost == null
                ? "—"
                : formatCurrency(plan.summary.craftCost)
            }
          />
          <StatCard
            label="Total Labor"
            value={plan.summary.totalLabor.toLocaleString()}
          />
          <StatCard
            label="Sale Price"
            value={
              effectiveSalePrice == null
                ? "Missing Price"
                : formatCurrency(effectiveSalePrice)
            }
          />
          <StatCard
            label="Profit Before Fees / Labor"
            value={
              plan.summary.profitPerLabor == null
                ? "—"
                : `${plan.summary.profitPerLabor.toLocaleString(undefined, { maximumFractionDigits: 2 })} Silver / Labor`
            }
          />
          {plan.summary.costPerItem != null ? (
            <StatCard
              label="Cost per Item"
              value={formatCurrency(plan.summary.costPerItem)}
            />
          ) : null}
          {plan.summary.profitPerItem != null ? (
            <StatCard
              label="Profit Before Fees per Item"
              value={formatCurrency(plan.summary.profitPerItem)}
            />
          ) : null}
        </div>
        <label className="text-muted-foreground flex items-center gap-2 text-sm whitespace-nowrap">
          Sale price
          <span title={salePriceSource} aria-label={salePriceSource}>
            <Info className="size-3.5" aria-hidden="true" />
          </span>
          <Input
            aria-label="Sale price"
            title={salePriceSource}
            type="number"
            min="0"
            step="0.01"
            value={salePriceText}
            onChange={(event) => setSalePriceText(event.target.value)}
            placeholder={
              latestSalePrice == null
                ? "Missing Price"
                : String(latestSalePrice)
            }
            className="w-28 shrink-0"
          />
        </label>
      </section>

      <nav aria-label="Craft tree" className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Craft tree
        </span>
        <SelectedCraftTree
          rootEntry={rootEntry}
          rootItemId={data.item.id}
          rootName={data.item.name}
          subcraftMap={data.subcraftsByItemId as SubcraftMap<CraftEntry>}
          modes={modes}
          selectedCrafts={selectedCrafts}
          focusPath={plan.breadcrumb.map((level) => level.itemId)}
          onFocus={setFocusPath}
        />
      </nav>

      <section
        className="flex min-w-0 flex-col gap-4"
        aria-label="Focused Recipe"
      >
        <div>
          <div>
            <h2 className="text-xl font-semibold">
              {plan.focused.entry.craft.name}
            </h2>
          </div>
        </div>
        {focusedChoices.length > 1 ? (
          <div className="grid gap-2" aria-label="Recipe choices">
            <p className="text-sm font-medium">Choose a Recipe</p>
            {focusedChoices.map((entry) => {
              const cost = getRecipeChoiceCost(entry, priceMap, overrideMap);
              const output = getProducedAmount(entry, plan.focused.itemId);
              const selected = entry.craft.id === plan.focused.entry.craft.id;
              const product = entry.products.find(
                (candidate) => candidate.item.id === plan.focused.itemId,
              );
              return (
                <button
                  type="button"
                  key={entry.craft.id}
                  onClick={() => setRecipe(entry.craft.id)}
                  aria-pressed={selected}
                  className={`rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    selected
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/50 hover:bg-muted"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <ItemIcon
                      icon={product?.item.icon ?? null}
                      name={product?.item.name ?? entry.craft.name}
                      size="md"
                    />
                    <span>
                      <span className="font-medium">{entry.craft.name}</span>
                      <span className="block text-xs">
                        {selected && focusedSelectedId == null
                          ? "Recommendation · "
                          : ""}
                        {output} output / Craft · {entry.craft.labor} Labor ·{" "}
                        {cost == null
                          ? "Missing Price"
                          : `${formatCurrency(cost)} Craft Cost`}
                        {output > 1 && cost != null
                          ? ` · ${formatCurrency(cost / output)} per Item`
                          : ""}
                      </span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
        <div className="grid gap-2" aria-label="Recipe materials">
          {plan.focused.entry.materials.map(({ item, amount }) => {
            const currency = isCurrencyMaterial(item);
            const craftable = Boolean(data.subcraftsByItemId[item.id]?.length);
            const mode = modes[item.id] ?? "buy";
            const unitPrice = currency
              ? null
              : getItemPrice(item.id, priceMap, overrideMap);
            const priced =
              !currency && hasItemPrice(item.id, priceMap, overrideMap);
            const isEditingOverride = editingOverrideItemId === item.id;
            return (
              <div
                key={item.id}
                className="grid gap-2 border-b py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center"
              >
                <div className="flex min-w-0 items-center gap-2">
                  {currency ? null : (
                    <ItemIcon icon={item.icon} name={item.name} size="md" />
                  )}
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {currency ? "Currency" : item.name}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {currency
                        ? `${formatCurrency(amount / 10_000)} per Craft`
                        : plan.focused.crafts > 1
                          ? `${(plan.focusedMaterialQuantities.find((material) => material.itemId === item.id)?.amount ?? amount).toLocaleString()} needed for ${plan.focused.crafts} Crafts · `
                          : ""}
                      {currency ? "" : `${amount.toLocaleString()} per Craft`}
                      {!currency ? (
                        <span className="ml-1 inline-flex items-center gap-1">
                          ·{" "}
                          {priced
                            ? `${formatCurrency(unitPrice ?? 0)} each`
                            : "Missing Price"}
                          <Button
                            type="button"
                            variant="link"
                            size="sm"
                            className="h-auto px-0 py-0"
                            aria-label={`${overrideMap.has(item.id) ? "Edit" : "Set"} price override for ${item.name}`}
                            title={
                              overrideMap.has(item.id)
                                ? "Edit price override"
                                : "Set price override"
                            }
                            onClick={() => {
                              setEditingOverrideItemId(item.id);
                              setOverrideDraft(
                                String(
                                  overrideMap.get(item.id) ?? unitPrice ?? "",
                                ),
                              );
                            }}
                          >
                            <Pencil className="size-3" aria-hidden="true" />
                          </Button>
                        </span>
                      ) : null}
                      {isEditingOverride ? (
                        <span className="mt-1 flex items-center gap-1">
                          <Input
                            aria-label={`${item.name} price override`}
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={overrideDraft}
                            onChange={(event) =>
                              setOverrideDraft(event.target.value)
                            }
                            className="h-7 w-24 text-xs"
                          />
                          <Button
                            type="button"
                            size="sm"
                            className="h-7"
                            disabled={setPriceOverride.isPending}
                            onClick={() => {
                              const price = parseFinitePrice(overrideDraft);
                              if (price == null || price <= 0) {
                                toast.error("Enter a positive Gold price.");
                                return;
                              }
                              setPriceOverride.mutate({
                                itemId: item.id,
                                price,
                              });
                            }}
                          >
                            Save
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7"
                            onClick={() => setEditingOverrideItemId(null)}
                          >
                            Cancel
                          </Button>
                        </span>
                      ) : null}
                    </p>
                  </div>
                </div>
                <div>
                  {!currency && craftable ? (
                    <span className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant={mode === "buy" ? "default" : "ghost"}
                        onClick={() => {
                          setModes((previous) => ({
                            ...previous,
                            [item.id]: "buy",
                          }));
                          setFocusPath((previous) =>
                            previous.includes(item.id)
                              ? previous.slice(0, previous.indexOf(item.id))
                              : previous,
                          );
                        }}
                      >
                        Buy
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={mode === "craft" ? "default" : "ghost"}
                        onClick={() =>
                          setModes((previous) => ({
                            ...previous,
                            [item.id]: "craft",
                          }))
                        }
                      >
                        Craft
                      </Button>
                    </span>
                  ) : null}
                </div>
                <div>
                  {!currency && craftable && mode === "craft" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setFocusPath((previous) => [
                          ...previous.slice(
                            0,
                            previous.indexOf(plan.focused.itemId) + 1,
                          ),
                          item.id,
                        ])
                      }
                    >
                      Inspect
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>
      <Link
        to="/shoplist"
        search={{
          craft: rootEntry.craft.id,
          qty: plan.craftCount,
          sub: serializeModes(modes),
          sel: serializeRecipes({
            ...selectedCrafts,
            ...(rootCraftId != null ? { [data.item.id]: rootCraftId } : {}),
          }),
          listId,
        }}
        className="text-sm hover:underline"
      >
        Continue this Plan in Shopping List →
      </Link>
    </div>
  );
}
