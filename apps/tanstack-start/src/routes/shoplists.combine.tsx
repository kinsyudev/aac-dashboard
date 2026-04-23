import { useMemo } from "react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";

import type { RouterOutputs } from "@acme/api";
import { Button } from "@acme/ui/button";

import { ItemIcon } from "~/component/item-icon";
import { buildMetaTags, buildPageTitle } from "~/lib/metadata";
import { useTRPC } from "~/lib/trpc";
import { useUserData } from "~/lib/useUserData";

export const Route = createFileRoute("/shoplists/combine")({
  validateSearch: z.object({
    ids: z.string().optional(),
  }),
  loaderDeps: ({ search }) => ({
    listIds: parseListIds(search.ids),
  }),
  loader: ({ context, deps }) => {
    if (deps.listIds.length >= 2) {
      void context.queryClient.prefetchQuery(
        context.trpc.shoppingLists.getCombined.queryOptions({
          listIds: deps.listIds,
        }),
      );
    }
  },
  head: () => ({
    meta: buildMetaTags({
      title: buildPageTitle("Combined Shopping List"),
      description:
        "View combined required and remaining materials across multiple shopping lists.",
    }),
  }),
  component: CombinedShoppingListsPage,
});

type CombinedData = RouterOutputs["shoppingLists"]["getCombined"];
type CombinedItem = CombinedData["items"][number];

const COIN_ITEM_ID = 500;

function parseListIds(ids: string | undefined) {
  return Array.from(
    new Set(
      (ids ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  );
}

function coerceFiniteNumber(value: number | string | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  const parsed = Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseFinitePrice(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getMarketPrice(
  price:
    | {
        avg24h: string | null;
        avg7d: string | null;
        avg30d: string | null;
      }
    | null
    | undefined,
) {
  return (
    parseFinitePrice(price?.avg24h) ??
    parseFinitePrice(price?.avg7d) ??
    parseFinitePrice(price?.avg30d) ??
    0
  );
}

function isCoinItem(item: CombinedItem) {
  return item.itemId === COIN_ITEM_ID || item.item.name === "Coin";
}

function formatCoinValue(value: number) {
  const copper = Math.max(0, Math.round(value));
  const gold = Math.floor(copper / 10000);
  const silver = Math.floor((copper % 10000) / 100);
  const remainingCopper = copper % 100;

  return `${gold.toLocaleString()}g ${silver}s ${remainingCopper}c`;
}

function CombinedShoppingListsPage() {
  const { ids } = Route.useSearch();
  const listIds = useMemo(() => parseListIds(ids), [ids]);

  if (listIds.length < 2) {
    return (
      <main className="container py-16">
        <div className="flex max-w-2xl flex-col gap-4">
          <Link
            to="/shoplists"
            className="text-muted-foreground text-sm hover:underline"
          >
            ← Back to lists
          </Link>
          <h1 className="text-3xl font-bold">Combined Shopping List</h1>
          <p className="text-muted-foreground text-sm">
            Select at least two shopping lists to build a read-only combined
            view.
          </p>
          <div>
            <Button asChild>
              <Link to="/shoplists">Choose lists</Link>
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return <CombinedShoppingListsContent listIds={listIds} />;
}

function CombinedShoppingListsContent({ listIds }: { listIds: string[] }) {
  const trpc = useTRPC();
  const { overrideMap } = useUserData();
  const { data } = useSuspenseQuery(
    trpc.shoppingLists.getCombined.queryOptions({ listIds }),
  );
  const coinRow = useMemo(
    () => data.items.find((item) => isCoinItem(item)) ?? null,
    [data.items],
  );
  const materialItems = useMemo(
    () => data.items.filter((item) => !isCoinItem(item)),
    [data.items],
  );
  const itemIds = useMemo(
    () => materialItems.map((item) => item.itemId),
    [materialItems],
  );
  const { data: prices = [] } = useQuery({
    ...trpc.items.pricesBatch.queryOptions(itemIds),
    enabled: itemIds.length > 0,
  });
  const priceMap = useMemo(
    () => new Map(prices.map((price) => [price.itemId, price])),
    [prices],
  );
  const sortedItems = useMemo(
    () =>
      [...materialItems].sort((left, right) => {
        const leftCost = getLineCost(left, priceMap, overrideMap);
        const rightCost = getLineCost(right, priceMap, overrideMap);
        return rightCost !== leftCost
          ? rightCost - leftCost
          : left.item.name.localeCompare(right.item.name);
      }),
    [materialItems, overrideMap, priceMap],
  );
  const totalRequired = materialItems.reduce(
    (sum, item) => sum + item.totalQuantity,
    0,
  );
  const totalRemaining = materialItems.reduce(
    (sum, item) => sum + item.remainingQuantity,
    0,
  );
  const outstandingBuyCost = materialItems.reduce(
    (sum, item) => sum + getLineCost(item, priceMap, overrideMap),
    0,
  );

  return (
    <main className="container py-16">
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <Link
              to="/shoplists"
              className="text-muted-foreground text-sm hover:underline"
            >
              ← Back to lists
            </Link>
            <h1 className="mt-3 text-3xl font-bold">Combined Shopping List</h1>
            <p className="text-muted-foreground mt-2 text-sm">
              Read-only totals across {data.lists.length.toLocaleString()}{" "}
              selected lists.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link to="/shoplists">Change selection</Link>
          </Button>
        </div>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SummaryTile
            label="Selected lists"
            value={data.lists.length.toLocaleString()}
          />
          <SummaryTile
            label="Material types"
            value={materialItems.length.toLocaleString()}
          />
          <SummaryTile
            label="Materials required"
            value={totalRequired.toLocaleString()}
          />
          <SummaryTile
            label="Materials remaining"
            value={totalRemaining.toLocaleString()}
          />
        </section>

        <section className="rounded-xl border p-5">
          <h2 className="text-lg font-semibold">Selected Lists</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {data.lists.map((list) => (
              <Link
                key={list.id}
                to="/shoplists/$listId"
                params={{ listId: list.id }}
                className="hover:bg-muted flex max-w-full items-center gap-2 rounded-md border px-3 py-2 text-sm transition"
              >
                {list.primarySourceItem?.icon ? (
                  <ItemIcon
                    icon={list.primarySourceItem.icon}
                    name={list.primarySourceItem.name ?? list.name}
                  />
                ) : null}
                <span className="truncate font-medium">{list.name}</span>
                <span className="text-muted-foreground shrink-0">
                  {list.role}
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
          <div className="rounded-xl border p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Combined Items</h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  Sorted by remaining estimated cost, then item name.
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              {sortedItems.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No material items found in the selected lists.
                </p>
              ) : (
                sortedItems.map((item) => (
                  <CombinedItemRow
                    key={item.itemId}
                    item={item}
                    overrideMap={overrideMap}
                    priceMap={priceMap}
                  />
                ))
              )}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <section className="rounded-xl border p-5">
              <p className="text-muted-foreground text-xs tracking-wide uppercase">
                Estimated buy remaining
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {outstandingBuyCost.toLocaleString(undefined, {
                  maximumFractionDigits: 0,
                })}
                g
              </p>
              <p className="text-muted-foreground mt-1 text-sm">
                Based on your profile overrides first, then latest market
                prices.
              </p>
            </section>

            {coinRow ? (
              <section className="rounded-xl border p-5">
                <h2 className="text-lg font-semibold">Coins</h2>
                <p className="text-muted-foreground mt-2 text-sm">
                  {formatCoinValue(coinRow.remainingQuantity)} remaining •{" "}
                  {formatCoinValue(coinRow.totalQuantity)} total required
                </p>
                <ContributionList item={coinRow} />
              </section>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}

function getLineCost(
  item: CombinedItem,
  priceMap: Map<
    number,
    { avg24h: string | null; avg7d: string | null; avg30d: string | null }
  >,
  overrideMap: Map<number, number>,
) {
  const override = overrideMap.get(item.itemId);
  const market = priceMap.get(item.itemId);
  const unitPrice =
    override != null ? coerceFiniteNumber(override) : getMarketPrice(market);

  return item.remainingQuantity * unitPrice;
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border px-4 py-3">
      <p className="text-muted-foreground text-xs tracking-wide uppercase">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function CombinedItemRow({
  item,
  overrideMap,
  priceMap,
}: {
  item: CombinedItem;
  overrideMap: Map<number, number>;
  priceMap: Map<
    number,
    { avg24h: string | null; avg7d: string | null; avg30d: string | null }
  >;
}) {
  const override = overrideMap.get(item.itemId);
  const market = priceMap.get(item.itemId);
  const unitPrice =
    override != null ? coerceFiniteNumber(override) : getMarketPrice(market);
  const lineCost = item.remainingQuantity * unitPrice;

  return (
    <div className="hover:bg-muted/40 rounded-lg px-2 py-2">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <Link
          to="/item/$itemId"
          params={{ itemId: item.itemId }}
          className="flex min-w-0 items-center gap-3 rounded-md transition outline-none hover:opacity-80 focus-visible:ring-2"
        >
          <ItemIcon icon={item.item.icon} name={item.item.name} size="md" />
          <div className="min-w-0">
            <p className="truncate font-medium hover:underline">
              {item.item.name}
            </p>
            <p className="text-muted-foreground text-sm tabular-nums">
              {item.remainingQuantity.toLocaleString()} remaining •{" "}
              {item.totalQuantity.toLocaleString()} total required
            </p>
            {unitPrice > 0 ? (
              <p className="text-muted-foreground text-xs tabular-nums">
                {lineCost.toLocaleString(undefined, {
                  maximumFractionDigits: 0,
                })}
                g total •{" "}
                {unitPrice.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}
                g each
                {override != null ? " (override)" : ""}
              </p>
            ) : (
              <p className="text-muted-foreground text-xs">
                No market price data available.
              </p>
            )}
          </div>
        </Link>
        <div className="flex flex-wrap justify-start gap-1.5 md:justify-end">
          {item.contributions.map((contribution) => (
            <span
              key={contribution.listId}
              className="bg-muted text-muted-foreground rounded-full px-2 py-1 text-xs"
            >
              {contribution.listName}:{" "}
              {contribution.remainingQuantity.toLocaleString()} left
            </span>
          ))}
        </div>
      </div>
      <ContributionList item={item} />
    </div>
  );
}

function ContributionList({ item }: { item: CombinedItem }) {
  return (
    <details className="mt-3">
      <summary className="text-muted-foreground cursor-pointer text-sm">
        List contributions
      </summary>
      <div className="mt-2 grid gap-2">
        {item.contributions.map((contribution) => (
          <div
            key={contribution.listId}
            className="rounded-md border px-3 py-2 text-sm"
          >
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <Link
                to="/shoplists/$listId"
                params={{ listId: contribution.listId }}
                className="font-medium hover:underline"
              >
                {contribution.listName}
              </Link>
              <p className="text-muted-foreground tabular-nums">
                {contribution.remainingQuantity.toLocaleString()} remaining •{" "}
                {contribution.stockQuantity.toLocaleString()} stock •{" "}
                {contribution.usedQuantity.toLocaleString()} used •{" "}
                {contribution.totalQuantity.toLocaleString()} total
              </p>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
