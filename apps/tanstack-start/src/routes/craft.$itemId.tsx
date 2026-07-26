import type { inferProcedureOutput } from "@trpc/server";
import { Suspense, useMemo, useState } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { z } from "zod";

import type { AppRouter } from "@acme/api";
import { Button } from "@acme/ui/button";
import { Input } from "@acme/ui/input";

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
import { getProducedAmount, parseFinitePrice } from "~/lib/craft-optimizer";
import {
  buildCraftPagePlan,
  getRecipeChoiceCost,
  getRecipeSignature,
  normalizeCraftCount,
} from "~/lib/craft-page-plan";
import { buildMetaTags, buildPageTitle, getItemIconUrl } from "~/lib/metadata";
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
  const copper = Math.round(gold * 10_000);
  const wholeGold = Math.floor(copper / 10_000);
  const silver = Math.floor((copper % 10_000) / 100);
  const remainder = copper % 100;
  return `${wholeGold.toLocaleString()} Gold ${silver} Silver ${remainder} Copper`;
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
  const { proficiencyMap, overrideMap } = useUserData();
  const [craftCountText, setCraftCountText] = useState("1");
  const [rootCraftId, setRootCraftId] = useState<number | null>(null);
  const [modes, setModes] = useState<ModesMap>({});
  const [selectedCrafts, setSelectedCrafts] = useState<SelectedCraftMap>({});
  const [salePriceText, setSalePriceText] = useState("");
  const [focusPath, setFocusPath] = useState<number[]>([data.item.id]);
  const priceMap: PriceMap = useMemo(
    () => new Map(data.prices.map((price) => [price.itemId, price])),
    [data.prices],
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
    salePrice:
      parsedSalePrice != null && parsedSalePrice >= 0
        ? parsedSalePrice
        : undefined,
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
        <label className="text-muted-foreground flex max-w-sm items-center gap-2 text-sm">
          Temporary Sale Price (Gold)
          <Input
            aria-label="Temporary Sale Price"
            type="number"
            min="0"
            step="0.01"
            value={salePriceText}
            onChange={(event) => setSalePriceText(event.target.value)}
          />
        </label>
      </section>

      <nav
        aria-label="Craft path"
        className="flex flex-wrap items-center gap-1 text-sm"
      >
        {plan.breadcrumb.map((level, index) => (
          <span key={level.itemId} className="flex items-center gap-1">
            {index > 0 ? (
              <span className="text-muted-foreground">/</span>
            ) : null}
            <Button
              type="button"
              variant="link"
              className="h-auto px-1 py-0"
              onClick={() =>
                setFocusPath(
                  plan.breadcrumb
                    .slice(0, index + 1)
                    .map((part) => part.itemId),
                )
              }
            >
              {level.itemId === data.item.id
                ? data.item.name
                : level.entry.products.find(
                      (product) => product.item.id === level.itemId,
                    )?.item.id === level.itemId
                  ? level.entry.craft.name
                  : `Item ${level.itemId}`}
            </Button>
          </span>
        ))}
      </nav>

      <section
        className="flex min-w-0 flex-col gap-4"
        aria-label="Focused Recipe"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">
              {plan.focused.entry.craft.name}
            </h2>
            <p className="text-muted-foreground text-sm">
              One focused Recipe level
            </p>
          </div>
          <label className="text-sm">
            Recipe Choice{" "}
            <select
              aria-label="Recipe Choice"
              value={focusedSelectedId ?? ""}
              onChange={(event) => setRecipe(Number(event.target.value))}
              className="bg-background ml-2 rounded border px-2 py-1"
            >
              {focusedSelectedId == null ? (
                <option value="">
                  Recommendation: {plan.focused.entry.craft.name}
                </option>
              ) : null}
              {focusedChoices.map((entry) => (
                <option key={entry.craft.id} value={entry.craft.id}>
                  {entry.craft.name} ·{" "}
                  {getProducedAmount(entry, plan.focused.itemId)} output
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid gap-2">
          {focusedChoices.map((entry) => {
            const cost = getRecipeChoiceCost(entry, priceMap, overrideMap);
            const output = getProducedAmount(entry, plan.focused.itemId);
            return (
              <div
                key={entry.craft.id}
                className="text-muted-foreground rounded border px-3 py-2 text-sm"
              >
                <span className="text-foreground font-medium">
                  {entry.craft.name}
                </span>{" "}
                · {output} output / Craft · {entry.craft.labor} Labor ·{" "}
                {cost == null
                  ? "Missing Price"
                  : `${formatCurrency(cost)} Craft Cost`}
                {output > 1 && cost != null
                  ? ` · ${formatCurrency(cost / output)} per Item`
                  : ""}
                <span className="block text-xs">
                  {getRecipeSignature(entry)}
                </span>
              </div>
            );
          })}
        </div>
        <div className="grid gap-2" aria-label="Recipe materials">
          {plan.focused.entry.materials.map(({ item, amount }) => {
            const craftable = Boolean(data.subcraftsByItemId[item.id]?.length);
            const mode = modes[item.id] ?? "buy";
            return (
              <div
                key={item.id}
                className="grid gap-2 rounded border p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center"
              >
                <div>
                  <p className="font-medium">{item.name}</p>
                  <p className="text-muted-foreground text-xs">
                    {(
                      plan.focusedMaterialQuantities.find(
                        (material) => material.itemId === item.id,
                      )?.amount ?? amount
                    ).toLocaleString()}{" "}
                    needed for {plan.focused.crafts} Craft
                    {plan.focused.crafts === 1 ? "" : "s"} ·{" "}
                    {amount.toLocaleString()} per Craft
                  </p>
                </div>
                <div>
                  {craftable ? (
                    <span className="inline-flex rounded border">
                      <button
                        type="button"
                        className={
                          mode === "buy"
                            ? "bg-primary text-primary-foreground px-2 py-1"
                            : "px-2 py-1"
                        }
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
                      </button>
                      <button
                        type="button"
                        className={
                          mode === "craft"
                            ? "bg-primary text-primary-foreground px-2 py-1"
                            : "px-2 py-1"
                        }
                        onClick={() =>
                          setModes((previous) => ({
                            ...previous,
                            [item.id]: "craft",
                          }))
                        }
                      >
                        Craft
                      </button>
                    </span>
                  ) : (
                    "Buy"
                  )}
                </div>
                <div>
                  {craftable && mode === "craft" ? (
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
