import type { inferProcedureOutput } from "@trpc/server";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  notFound,
  useNavigate,
} from "@tanstack/react-router";
import { Info, Pencil } from "lucide-react";
import { z } from "zod";

import type { AppRouter } from "@acme/api";
import { Button } from "@acme/ui/button";
import { Input } from "@acme/ui/input";
import { toast } from "@acme/ui/toast";
import { Tooltip } from "@acme/ui/tooltip";

import type {
  ModesMap,
  PriceMap,
  SelectedCraftMap,
  SubcraftMap,
} from "~/lib/craft-optimizer";
import { InlineState } from "~/component/inline-state";
import { ItemDescription } from "~/component/item-description";
import { ItemIcon } from "~/component/item-icon";
import { MetricGrid } from "~/component/metric";
import {
  PageHeading,
  PageSection,
  PageShell,
} from "~/component/page-composition";
import { RecipeNavigator } from "~/component/recipe-navigator";
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
  validateSearch: z.object({
    listId: z.string().uuid().optional(),
    qty: z.coerce.number().int().min(1).optional(),
    sub: z.string().optional(),
    sel: z.string().optional(),
  }),
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

function parseCraftModes(value: string | undefined): ModesMap {
  if (!value) return {};
  return Object.fromEntries(
    value
      .split(",")
      .map(Number)
      .filter(Number.isInteger)
      .map((itemId) => [itemId, "craft"] as const),
  );
}

function parseRecipeChoices(value: string | undefined): SelectedCraftMap {
  if (!value) return {};
  return Object.fromEntries(
    value
      .split(",")
      .map((part) => part.split(":").map(Number))
      .filter(
        (pair): pair is [number, number] =>
          pair.length === 2 &&
          Number.isInteger(pair[0]) &&
          Number.isInteger(pair[1]),
      )
      .map(([itemId, craftId]) => [itemId, craftId]),
  );
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
    <PageShell>
      <Link
        to="/craft"
        search={{ listId }}
        className="text-muted-foreground mb-6 flex text-sm hover:underline"
      >
        ← Back to Craft
      </Link>
      <Suspense
        fallback={
          <InlineState kind="loading">Loading Craft Plan...</InlineState>
        }
      >
        <CraftPlanPage listId={listId} />
      </Suspense>
    </PageShell>
  );
}

function CraftPlanPage({ listId }: { listId?: string }) {
  const data = Route.useLoaderData();
  const { qty, sub, sel } = Route.useSearch();
  const navigate = useNavigate({ from: "/craft/$itemId" });
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { proficiencyMap, overrideMap } = useUserData();
  const [craftCountText, setCraftCountText] = useState(() => String(qty ?? 1));
  const [rootCraftId, setRootCraftId] = useState<number | null>(
    () => parseRecipeChoices(sel)[data.item.id] ?? null,
  );
  const [modes, setModes] = useState<ModesMap>(() => parseCraftModes(sub));
  const [selectedCrafts, setSelectedCrafts] = useState<SelectedCraftMap>(() =>
    parseRecipeChoices(sel),
  );
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

  useEffect(() => {
    const recipes = {
      ...selectedCrafts,
      ...(rootCraftId == null ? {} : { [data.item.id]: rootCraftId }),
    };
    const nextQty = normalizeCraftCount(Number(craftCountText));
    const nextSub = serializeModes(modes);
    const nextSel = serializeRecipes(recipes);
    if (qty === nextQty && sub === nextSub && sel === nextSel) return;
    void navigate({
      search: (previous) => ({
        ...previous,
        qty: nextQty,
        sub: nextSub,
        sel: nextSel,
      }),
      replace: true,
    });
  }, [
    craftCountText,
    data.item.id,
    modes,
    navigate,
    qty,
    rootCraftId,
    sel,
    selectedCrafts,
    sub,
  ]);

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
  const productionPath = plan.breadcrumb.map((level, index, levels) => ({
    id: level.itemId,
    name:
      index === 0
        ? data.item.name
        : (levels[index - 1]?.entry.materials.find(
            (material) => material.item.id === level.itemId,
          )?.item.name ?? level.entry.craft.name),
  }));
  const focusedItemName = productionPath.at(-1)?.name ?? data.item.name;

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
      <PageHeading
        title={data.item.name}
        subtitle={`Craft Plan · ${data.item.category}`}
        identity={
          data.item.icon ? (
            <ItemIcon icon={data.item.icon} name={data.item.name} size="lg" />
          ) : undefined
        }
      />
      {data.item.description ? (
        <ItemDescription text={data.item.description} />
      ) : null}

      <PageSection
        title="Crafting Summary"
        description={`${plan.craftCount} Craft${plan.craftCount === 1 ? "" : "s"} produces ${plan.summary.totalOutput.toLocaleString()} ${data.item.name}.`}
        actions={
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
        }
      >
        {plan.summary.missingPriceItems.length ? (
          <InlineState kind="incomplete" title="Incomplete Plan">
            Missing Price: {plan.summary.missingPriceItems.join(", ")}.
          </InlineState>
        ) : null}
        <MetricGrid>
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
        </MetricGrid>
        <label className="text-muted-foreground flex items-center gap-2 text-sm whitespace-nowrap">
          Sale price
          <Tooltip content={salePriceSource}>
            <button type="button" aria-label={salePriceSource}>
              <Info className="size-3.5" aria-hidden="true" />
            </button>
          </Tooltip>
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
      </PageSection>

      <PageSection
        title="Craft Tree"
        description="Navigate the Materials selected for crafting."
      >
        <nav aria-label="Craft tree">
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
      </PageSection>

      <PageSection
        title="Crafting"
        description={`Currently inspecting ${plan.focused.entry.craft.name}.`}
      >
        <RecipeNavigator
          path={productionPath}
          focusedItemName={focusedItemName}
          choices={focusedChoices.map((entry) => {
            const cost = getRecipeChoiceCost(entry, priceMap, overrideMap);
            const output = getProducedAmount(entry, plan.focused.itemId);
            const selected = entry.craft.id === plan.focused.entry.craft.id;
            return {
              id: entry.craft.id,
              name: entry.craft.name,
              output,
              labor: entry.craft.labor,
              cost:
                cost == null
                  ? "Missing Price"
                  : `${formatCurrency(cost)} Craft Cost`,
              costPerItem:
                output > 1 && cost != null
                  ? `${formatCurrency(cost / output)} / Item`
                  : undefined,
              selected,
              recommended: selected && focusedSelectedId == null,
            };
          })}
          materials={plan.focused.entry.materials.map(({ item, amount }) => {
            const currency = isCurrencyMaterial(item);
            const unitPrice = currency
              ? null
              : getItemPrice(item.id, priceMap, overrideMap);
            const priced =
              !currency && hasItemPrice(item.id, priceMap, overrideMap);
            const isEditingOverride = editingOverrideItemId === item.id;
            return {
              id: item.id,
              name: currency ? "Currency" : item.name,
              amount:
                plan.focusedMaterialQuantities.find(
                  (material) => material.itemId === item.id,
                )?.amount ?? amount,
              mode: modes[item.id] ?? "buy",
              craftable:
                !currency && Boolean(data.subcraftsByItemId[item.id]?.length),
              identity: currency ? undefined : (
                <ItemIcon icon={item.icon} name={item.name} size="md" />
              ),
              price: currency ? (
                `${formatCurrency(amount / 10_000)} / Craft`
              ) : (
                <div className="flex flex-col items-end gap-1 text-sm">
                  <span className="inline-flex items-center gap-1">
                    {priced
                      ? `${formatCurrency(unitPrice ?? 0)} each`
                      : "Missing Price"}
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto px-0 py-0"
                      aria-label={`${overrideMap.has(item.id) ? "Edit" : "Set"} price override for ${item.name}`}
                      onClick={() => {
                        setEditingOverrideItemId(item.id);
                        setOverrideDraft(
                          String(overrideMap.get(item.id) ?? unitPrice ?? ""),
                        );
                      }}
                    >
                      <Pencil className="size-3" aria-hidden="true" />
                    </Button>
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {overrideMap.has(item.id)
                      ? "Price Override"
                      : priced
                        ? "Market Data"
                        : "No Price Override or Market Data"}
                  </span>
                  {isEditingOverride ? (
                    <span className="flex flex-wrap justify-end gap-1">
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
                          setPriceOverride.mutate({ itemId: item.id, price });
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
                </div>
              ),
            };
          })}
          onFocus={(itemId) =>
            setFocusPath((previous) =>
              previous.slice(0, previous.indexOf(itemId) + 1),
            )
          }
          onRecipeChoice={setRecipe}
          onAcquisitionMode={(itemId, mode) => {
            setModes((previous) => ({ ...previous, [itemId]: mode }));
            if (mode === "buy") {
              setFocusPath((previous) =>
                previous.includes(itemId)
                  ? previous.slice(0, previous.indexOf(itemId))
                  : previous,
              );
            }
          }}
          onInspect={(itemId) =>
            setFocusPath((previous) => [
              ...previous.slice(0, previous.indexOf(plan.focused.itemId) + 1),
              itemId,
            ])
          }
        />
      </PageSection>
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
