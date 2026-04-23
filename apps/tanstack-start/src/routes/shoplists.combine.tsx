import { useMemo } from "react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";

import type { RouterOutputs } from "@acme/api";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@acme/ui/accordion";
import { Badge } from "@acme/ui/badge";
import { Button } from "@acme/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@acme/ui/card";
import { Progress } from "@acme/ui/progress";
import { ScrollArea } from "@acme/ui/scroll-area";
import { Separator } from "@acme/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@acme/ui/table";

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
type PriceMap = Map<
  number,
  { avg24h: string | null; avg7d: string | null; avg30d: string | null }
>;

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

function getCompletionPercent(
  totalQuantity: number,
  remainingQuantity: number,
) {
  if (totalQuantity <= 0) return 0;
  const accounted = Math.max(0, totalQuantity - remainingQuantity);
  return Math.round((accounted / totalQuantity) * 100);
}

function CombinedShoppingListsPage() {
  const { ids } = Route.useSearch();
  const listIds = useMemo(() => parseListIds(ids), [ids]);

  if (listIds.length < 2) {
    return (
      <main className="container py-16">
        <Card className="mx-auto max-w-2xl">
          <CardHeader>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>Combined Shopping List</CardTitle>
                <CardDescription className="mt-2">
                  Select at least two shopping lists to build a read-only
                  combined view.
                </CardDescription>
              </div>
              <Button asChild variant="outline">
                <Link to="/shoplists">Choose lists</Link>
              </Button>
            </div>
          </CardHeader>
        </Card>
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
  const overallProgress = getCompletionPercent(totalRequired, totalRemaining);

  return (
    <main className="container py-8 md:py-12">
      <div className="flex flex-col gap-6">
        <Card className="overflow-hidden">
          <CardHeader className="border-b">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <Link
                  to="/shoplists"
                  className="text-muted-foreground text-sm hover:underline"
                >
                  Back to lists
                </Link>
                <CardTitle className="mt-2 text-2xl sm:text-3xl">
                  Combined Shopping List
                </CardTitle>
                <CardDescription className="mt-2 max-w-2xl">
                  A read-only rollup of materials still needed across{" "}
                  {data.lists.length.toLocaleString()} selected lists.
                </CardDescription>
              </div>
              <div className="shrink-0">
                <Button asChild variant="outline">
                  <Link to="/shoplists">Change selection</Link>
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 pt-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">Materials covered</span>
                <span className="font-medium tabular-nums">
                  {overallProgress}%
                </span>
              </div>
              <Progress value={overallProgress} />
              <p className="text-muted-foreground text-sm">
                {totalRemaining.toLocaleString()} remaining from{" "}
                {totalRequired.toLocaleString()} required materials.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <MetricPanel
                label="Material types"
                value={materialItems.length.toLocaleString()}
                detail="Unique non-currency items"
              />
              <MetricPanel
                label="Buy remaining"
                value={`${outstandingBuyCost.toLocaleString(undefined, {
                  maximumFractionDigits: 0,
                })}g`}
                detail="Overrides, then market price"
              />
            </div>
          </CardContent>
        </Card>

        <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex min-w-0 flex-col gap-4">
            <SelectedListsCard lists={data.lists} />
            <CombinedItemsCard
              items={sortedItems}
              overrideMap={overrideMap}
              priceMap={priceMap}
            />
          </div>

          <aside className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:flex xl:flex-col">
            <MetricCard
              label="Selected lists"
              value={data.lists.length.toLocaleString()}
              detail="Owned and shared lists"
            />
            <MetricCard
              label="Materials required"
              value={totalRequired.toLocaleString()}
              detail="Coin excluded"
            />
            <MetricCard
              label="Materials remaining"
              value={totalRemaining.toLocaleString()}
              detail={`${overallProgress}% accounted for`}
            />
            {coinRow ? <CoinCard coinRow={coinRow} /> : null}
          </aside>
        </section>
      </div>
    </main>
  );
}

function getLineCost(
  item: CombinedItem,
  priceMap: PriceMap,
  overrideMap: Map<number, number>,
) {
  const override = overrideMap.get(item.itemId);
  const market = priceMap.get(item.itemId);
  const unitPrice =
    override != null ? coerceFiniteNumber(override) : getMarketPrice(market);

  return item.remainingQuantity * unitPrice;
}

function getUnitPrice(
  item: CombinedItem,
  priceMap: PriceMap,
  overrideMap: Map<number, number>,
) {
  const override = overrideMap.get(item.itemId);
  const market = priceMap.get(item.itemId);
  return override != null
    ? coerceFiniteNumber(override)
    : getMarketPrice(market);
}

function MetricCard({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="gap-1 px-4">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <p className="text-muted-foreground text-xs">{detail}</p>
      </CardContent>
    </Card>
  );
}

function MetricPanel({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-muted/35 rounded-lg border px-4 py-3">
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-muted-foreground mt-1 text-xs">{detail}</p>
    </div>
  );
}

function SelectedListsCard({ lists }: { lists: CombinedData["lists"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Selected Lists</CardTitle>
        <CardDescription>
          These source lists are only read for this view.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {lists.map((list) => (
            <Link
              key={list.id}
              to="/shoplists/$listId"
              params={{ listId: list.id }}
              className="hover:bg-muted/45 flex min-w-0 items-center gap-3 rounded-lg border p-3 transition"
            >
              <ItemIcon
                icon={list.primarySourceItem?.icon ?? null}
                name={list.primarySourceItem?.name ?? list.name}
                size="md"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{list.name}</p>
                <p className="text-muted-foreground text-xs">
                  {list.sourceKind === "empty"
                    ? "Empty list"
                    : list.sourceKind === "simulator"
                      ? `${list.totalQuantity.toLocaleString()} attempts`
                      : `${list.rootCount.toLocaleString()} root crafts`}
                </p>
              </div>
              <Badge className="shrink-0" variant="outline">
                {list.role}
              </Badge>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function CombinedItemsCard({
  items,
  overrideMap,
  priceMap,
}: {
  items: CombinedItem[];
  overrideMap: Map<number, number>;
  priceMap: PriceMap;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Combined Items</CardTitle>
        <CardDescription>
          Sorted by estimated remaining buy cost, then item name.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-3 sm:px-6">
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No material items found in the selected lists.
          </p>
        ) : (
          <>
            <div className="hidden lg:block">
              <CombinedItemsTable
                items={items}
                overrideMap={overrideMap}
                priceMap={priceMap}
              />
            </div>
            <div className="grid gap-3 lg:hidden">
              {items.map((item) => (
                <CombinedItemMobileCard
                  key={item.itemId}
                  item={item}
                  overrideMap={overrideMap}
                  priceMap={priceMap}
                />
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function CombinedItemsTable({
  items,
  overrideMap,
  priceMap,
}: {
  items: CombinedItem[];
  overrideMap: Map<number, number>;
  priceMap: PriceMap;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="min-w-48">Item</TableHead>
          <TableHead className="text-right">Remaining</TableHead>
          <TableHead className="text-right">Required</TableHead>
          <TableHead className="min-w-36">Progress</TableHead>
          <TableHead className="text-right">Est. cost</TableHead>
          <TableHead className="min-w-64">Sources</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <CombinedItemTableRow
            key={item.itemId}
            item={item}
            overrideMap={overrideMap}
            priceMap={priceMap}
          />
        ))}
      </TableBody>
    </Table>
  );
}

function CombinedItemTableRow({
  item,
  overrideMap,
  priceMap,
}: {
  item: CombinedItem;
  overrideMap: Map<number, number>;
  priceMap: PriceMap;
}) {
  const unitPrice = getUnitPrice(item, priceMap, overrideMap);
  const lineCost = item.remainingQuantity * unitPrice;
  const progress = getCompletionPercent(
    item.totalQuantity,
    item.remainingQuantity,
  );

  return (
    <TableRow className="align-top">
      <TableCell>
        <Link
          to="/item/$itemId"
          params={{ itemId: item.itemId }}
          className="flex min-w-0 items-center gap-3 rounded-md outline-none hover:opacity-80 focus-visible:ring-2"
        >
          <ItemIcon icon={item.item.icon} name={item.item.name} size="md" />
          <span className="min-w-0 truncate font-medium">{item.item.name}</span>
        </Link>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {item.remainingQuantity.toLocaleString()}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {item.totalQuantity.toLocaleString()}
      </TableCell>
      <TableCell>
        <Progress value={progress} />
        <p className="text-muted-foreground mt-1 text-xs tabular-nums">
          {progress}% accounted
        </p>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {unitPrice > 0 ? (
          <>
            {lineCost.toLocaleString(undefined, {
              maximumFractionDigits: 0,
            })}
            g
          </>
        ) : (
          <span className="text-muted-foreground">No price</span>
        )}
      </TableCell>
      <TableCell>
        <ContributionAccordion item={item} />
      </TableCell>
    </TableRow>
  );
}

function CombinedItemMobileCard({
  item,
  overrideMap,
  priceMap,
}: {
  item: CombinedItem;
  overrideMap: Map<number, number>;
  priceMap: PriceMap;
}) {
  const unitPrice = getUnitPrice(item, priceMap, overrideMap);
  const lineCost = item.remainingQuantity * unitPrice;
  const progress = getCompletionPercent(
    item.totalQuantity,
    item.remainingQuantity,
  );

  return (
    <div className="min-w-0 rounded-lg border p-3">
      <div className="flex min-w-0 items-start gap-3">
        <Link
          to="/item/$itemId"
          params={{ itemId: item.itemId }}
          className="flex min-w-0 flex-1 items-center gap-3"
        >
          <ItemIcon icon={item.item.icon} name={item.item.name} size="md" />
          <div className="min-w-0">
            <p className="truncate font-medium">{item.item.name}</p>
            <p className="text-muted-foreground text-sm tabular-nums">
              {item.remainingQuantity.toLocaleString()} remaining
            </p>
          </div>
        </Link>
        <Badge
          className="shrink-0"
          variant={item.remainingQuantity === 0 ? "secondary" : "outline"}
        >
          {progress}%
        </Badge>
      </div>
      <div className="mt-3 space-y-2">
        <Progress value={progress} />
        <div className="text-muted-foreground flex items-center justify-between gap-3 text-xs tabular-nums">
          <span>{item.totalQuantity.toLocaleString()} required</span>
          <span>
            {unitPrice > 0
              ? `${lineCost.toLocaleString(undefined, {
                  maximumFractionDigits: 0,
                })}g`
              : "No price"}
          </span>
        </div>
      </div>
      <ContributionAccordion item={item} />
    </div>
  );
}

function ContributionAccordion({ item }: { item: CombinedItem }) {
  const preview = item.contributions
    .slice(0, 2)
    .map((contribution) => contribution.listName)
    .join(", ");
  const hiddenCount = Math.max(0, item.contributions.length - 2);

  return (
    <Accordion type="single" collapsible className="mt-2">
      <AccordionItem value="sources" className="rounded-lg">
        <AccordionTrigger className="min-w-0 px-3 py-2 text-xs">
          <span className="min-w-0 truncate">
            {item.contributions.length} source
            {item.contributions.length === 1 ? "" : "s"}
            {preview ? `: ${preview}` : ""}
            {hiddenCount > 0 ? ` +${hiddenCount}` : ""}
          </span>
        </AccordionTrigger>
        <AccordionContent className="[&>div]:p-0">
          <ScrollArea className={item.contributions.length > 3 ? "h-56" : ""}>
            <div className="divide-y">
              {item.contributions.map((contribution) => (
                <div key={contribution.listId} className="p-3">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <Link
                      to="/shoplists/$listId"
                      params={{ listId: contribution.listId }}
                      className="min-w-0 truncate font-medium hover:underline"
                    >
                      {contribution.listName}
                    </Link>
                    <Badge className="shrink-0" variant="secondary">
                      {contribution.remainingQuantity.toLocaleString()} left
                    </Badge>
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs tabular-nums">
                    {contribution.stockQuantity.toLocaleString()} stock /{" "}
                    {contribution.usedQuantity.toLocaleString()} used /{" "}
                    {contribution.totalQuantity.toLocaleString()} total
                  </p>
                </div>
              ))}
            </div>
          </ScrollArea>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

function CoinCard({ coinRow }: { coinRow: CombinedItem }) {
  const progress = getCompletionPercent(
    coinRow.totalQuantity,
    coinRow.remainingQuantity,
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Coins</CardTitle>
            <CardDescription>Tracked separately from materials</CardDescription>
          </div>
          <Badge variant="outline">{progress}%</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Progress value={progress} />
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Remaining</span>
            <span className="font-medium tabular-nums">
              {formatCoinValue(coinRow.remainingQuantity)}
            </span>
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Required</span>
            <span className="font-medium tabular-nums">
              {formatCoinValue(coinRow.totalQuantity)}
            </span>
          </div>
        </div>
        <ContributionAccordion item={coinRow} />
      </CardContent>
    </Card>
  );
}
