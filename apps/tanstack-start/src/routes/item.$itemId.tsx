import type { inferProcedureOutput } from "@trpc/server";
import { Suspense, useDeferredValue, useMemo, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";

import type { AppRouter } from "@acme/api";
import type { ChartConfig } from "@acme/ui/chart";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@acme/ui/accordion";
import { Badge } from "@acme/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@acme/ui/card";
import { ChartContainer, ChartTooltip, Recharts } from "@acme/ui/chart";
import { Input } from "@acme/ui/input";

import { ItemDescription } from "~/component/item-description";
import { ItemIcon } from "~/component/item-icon";
import { ProficiencyBadge } from "~/component/proficiency";
import { getDiscountedLabor } from "~/lib/proficiency";
import { useTRPC } from "~/lib/trpc";
import { useUserData } from "~/lib/useUserData";

export const Route = createFileRoute("/item/$itemId")({
  params: {
    parse: (params) => ({
      itemId: z.coerce.number().int().parse(params.itemId),
    }),
    stringify: (params) => ({ itemId: String(params.itemId) }),
  },
  loader: async ({ context, params }) => {
    const { trpc, queryClient } = context;
    const data = await queryClient.fetchQuery(
      trpc.items.detail.queryOptions(params.itemId),
    );
    if (!data) return;
  },
  component: RouteComponent,
  notFoundComponent: () => <p>Item not found.</p>,
});

type ItemDetailData = NonNullable<
  inferProcedureOutput<AppRouter["items"]["detail"]>
>;
type RecipeEntry = ItemDetailData["craftedBy"][number];
type PriceSummary = ItemDetailData["latestPrices"][number];
interface HistoryChartPoint {
  label: string;
  fullLabel: string;
  price: number | null;
  volume: number | null;
}

interface RecipeGroup {
  proficiency: string | null;
  entries: RecipeEntry[];
}

function parseMetric(value: string | null) {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatGold(value: number) {
  return `${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}g`;
}

const { Area, AreaChart, CartesianGrid, XAxis, YAxis } = Recharts;

function formatVolume(value: number) {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: value >= 100 ? 0 : 1,
  });
}

function formatCompact(value: number) {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatSnapshotLabel(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
      }).format(date);
}

function formatSnapshotTooltipLabel(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(date);
}

function collapseHistoryByDay(data: ItemDetailData["priceHistory"]) {
  const dailySnapshots = new Map<string, (typeof data)[number]>();

  for (const snapshot of data) {
    const dayKey = snapshot.fetchedAt.slice(0, 10);
    if (!dayKey) continue;
    dailySnapshots.set(dayKey, snapshot);
  }

  return [...dailySnapshots.values()];
}

function getRecipeSearchText(entry: RecipeEntry) {
  return [
    entry.craft.name,
    entry.craft.proficiency,
    ...entry.materials.map((material) => material.item.name),
    ...entry.products.map((product) => product.item.name),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function groupRecipesByProficiency(entries: RecipeEntry[]) {
  const groups = new Map<string, RecipeGroup>();

  for (const entry of entries) {
    const key = entry.craft.proficiency ?? "Unknown";
    const group = groups.get(key);

    if (group) {
      group.entries.push(entry);
      continue;
    }

    groups.set(key, {
      proficiency: entry.craft.proficiency,
      entries: [entry],
    });
  }

  return [...groups.values()].sort((left, right) => {
    if (left.proficiency == null) return 1;
    if (right.proficiency == null) return -1;
    return left.proficiency.localeCompare(right.proficiency);
  });
}

function RouteComponent() {
  const { itemId } = Route.useParams();

  return (
    <main className="container py-16">
      <Link
        to="/item"
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

function ItemStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border px-4 py-3">
      <p className="text-muted-foreground text-xs uppercase">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function MarketHistoryTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: {
    name?: string | number;
    value?: string | number | readonly (string | number)[];
    color?: string;
    payload?: HistoryChartPoint;
  }[];
}) {
  if (!active || !payload?.length) return null;

  const point = payload[0]?.payload;
  if (!point) return null;

  const priceEntry = payload.find((entry) => entry.name === "price");
  const volumeEntry = payload.find((entry) => entry.name === "volume");
  const priceRawValue = priceEntry?.value ?? 0;
  const volumeRawValue = volumeEntry?.value ?? 0;
  const priceColor = priceEntry?.color ?? "var(--color-price)";
  const volumeColor = volumeEntry?.color ?? "var(--color-volume)";
  const priceValue =
    point.price ??
    Number(Array.isArray(priceRawValue) ? priceRawValue[0] : priceRawValue);
  const volumeValue =
    point.volume ??
    Number(Array.isArray(volumeRawValue) ? volumeRawValue[0] : volumeRawValue);

  return (
    <div className="border-border/60 bg-background/95 min-w-[220px] rounded-xl border p-3 shadow-xl backdrop-blur">
      <p className="text-sm font-semibold">{point.fullLabel}</p>
      <p className="text-muted-foreground mb-3 text-xs">Market snapshot</p>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2">
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{
                backgroundColor: priceColor,
              }}
            />
            <span className="text-sm font-medium">Price</span>
          </div>
          <span className="font-mono text-sm tabular-nums">
            {formatGold(priceValue)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2">
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{
                backgroundColor: volumeColor,
              }}
            />
            <span className="text-sm font-medium">Volume</span>
          </div>
          <span className="font-mono text-sm tabular-nums">
            {formatVolume(volumeValue)}
          </span>
        </div>
      </div>
    </div>
  );
}

function CombinedHistoryChart({ data }: { data: HistoryChartPoint[] }) {
  const chartConfig = {
    price: {
      label: "Price",
      color: "oklch(0.62 0.19 168)",
    },
    volume: {
      label: "Volume",
      color: "oklch(0.62 0.17 248)",
    },
  } satisfies ChartConfig;

  const latestPoint = data.at(-1);
  const latestPrice = latestPoint?.price ?? 0;
  const latestVolume = latestPoint?.volume ?? 0;
  const priceValues = data
    .map((point) => point.price)
    .filter((value): value is number => value != null);
  const volumeValues = data
    .map((point) => point.volume)
    .filter((value): value is number => value != null);
  const highPrice = priceValues.length > 0 ? Math.max(...priceValues) : 0;
  const lowPrice = priceValues.length > 0 ? Math.min(...priceValues) : 0;
  const highVolume = volumeValues.length > 0 ? Math.max(...volumeValues) : 0;
  const lowVolume = volumeValues.length > 0 ? Math.min(...volumeValues) : 0;

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle>Market History</CardTitle>
        <CardDescription>
          24h average price and 24h traded volume over time.
        </CardDescription>
        <div className="grid gap-3 pt-2 text-sm sm:grid-cols-2">
          <div className="rounded-lg border px-3 py-2">
            <p className="text-muted-foreground text-xs uppercase">Price</p>
            <p className="font-medium">{formatGold(latestPrice)}</p>
            <p className="text-muted-foreground text-xs">
              High {formatGold(highPrice)} • Low {formatGold(lowPrice)}
            </p>
          </div>
          <div className="rounded-lg border px-3 py-2">
            <p className="text-muted-foreground text-xs uppercase">Volume</p>
            <p className="font-medium">{formatVolume(latestVolume)}</p>
            <p className="text-muted-foreground text-xs">
              High {formatVolume(highVolume)} • Low {formatVolume(lowVolume)}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {data.length > 0 ? (
          <ChartContainer config={chartConfig} className="h-[320px] w-full">
            <AreaChart
              accessibilityLayer
              data={data}
              margin={{ left: 8, right: 8, top: 12, bottom: 0 }}
            >
              <defs>
                <linearGradient id="area-price" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="var(--color-price)"
                    stopOpacity={0.45}
                  />
                  <stop
                    offset="95%"
                    stopColor="var(--color-price)"
                    stopOpacity={0.05}
                  />
                </linearGradient>
                <linearGradient id="area-volume" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="var(--color-volume)"
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="95%"
                    stopColor="var(--color-volume)"
                    stopOpacity={0.03}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={24}
              />
              <YAxis
                yAxisId="price"
                orientation="left"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width={72}
                tickFormatter={(value) => formatGold(Number(value))}
              />
              <YAxis
                yAxisId="volume"
                orientation="right"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width={56}
                tickFormatter={(value) => formatCompact(Number(value))}
              />
              <ChartTooltip cursor={false} content={<MarketHistoryTooltip />} />
              <Area
                yAxisId="volume"
                dataKey="volume"
                name="volume"
                type="monotone"
                fill="url(#area-volume)"
                fillOpacity={1}
                stroke="var(--color-volume)"
                strokeWidth={2}
                connectNulls
              />
              <Area
                yAxisId="price"
                dataKey="price"
                name="price"
                type="monotone"
                fill="url(#area-price)"
                fillOpacity={1}
                stroke="var(--color-price)"
                strokeWidth={2}
                connectNulls
              />
            </AreaChart>
          </ChartContainer>
        ) : (
          <p className="text-muted-foreground text-sm">
            No chart data available.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function RecipeCard({
  entry,
  highlightedItemId,
  priceMap,
  craftableItemIds,
  showOutputs,
}: {
  entry: RecipeEntry;
  highlightedItemId: number;
  priceMap: Map<number, PriceSummary>;
  craftableItemIds: Set<number>;
  showOutputs: boolean;
}) {
  const { proficiencyMap, overrideMap } = useUserData();
  const materialTotal = entry.materials.reduce((sum, material) => {
    const override = overrideMap.get(material.item.id);
    const latestPrice = priceMap.get(material.item.id);
    const unitPrice =
      override ??
      parseMetric(latestPrice?.avg24h ?? null) ??
      parseMetric(latestPrice?.avg7d ?? null) ??
      0;

    return sum + unitPrice * material.amount;
  }, 0);

  return (
    <AccordionItem value={String(entry.craft.id)}>
      <AccordionTrigger className="px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-semibold">
                {entry.craft.name}
              </h3>
              {entry.craft.labor > 0 && (
                <Badge variant="secondary">
                  {getDiscountedLabor(
                    entry.craft.labor,
                    entry.craft.proficiency,
                    proficiencyMap,
                  )}{" "}
                  labor
                </Badge>
              )}
            </div>
            <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-xs sm:text-sm">
              <span>Materials {formatGold(materialTotal)}</span>
              <span>•</span>
              <span>
                {entry.materials.length}{" "}
                {entry.materials.length === 1 ? "material" : "materials"}
              </span>
              {showOutputs && entry.products.length > 0 && (
                <>
                  <span>•</span>
                  <span>
                    {entry.products.length}{" "}
                    {entry.products.length === 1 ? "product" : "products"}
                  </span>
                </>
              )}
            </div>
          </div>
          {entry.craft.proficiency && (
            <Badge variant="outline" className="shrink-0">
              {entry.craft.proficiency}
            </Badge>
          )}
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <div className="space-y-4">
          <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
            {entry.craft.primaryProductId ? (
              <Link
                to="/craft/$itemId"
                params={{ itemId: entry.craft.primaryProductId }}
                className="hover:underline"
              >
                Open craft view
              </Link>
            ) : (
              <span>No craft detail page</span>
            )}
            <span>•</span>
            <span>Materials {formatGold(materialTotal)}</span>
          </div>

          {showOutputs && entry.products.length > 0 && (
            <div className="space-y-2">
              <p className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
                Produces
              </p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {entry.products.map((product) => (
                  <li key={`${entry.craft.id}-${product.item.id}`}>
                    <div
                      className={`hover:bg-muted/40 flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${
                        product.item.id === highlightedItemId
                          ? "border-primary"
                          : ""
                      }`}
                    >
                      <Link
                        to="/item/$itemId"
                        params={{ itemId: product.item.id }}
                        className="flex min-w-0 flex-1 items-center gap-3"
                      >
                        <ItemIcon
                          icon={product.item.icon}
                          name={product.item.name}
                          size="md"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">
                            {product.item.name}
                          </p>
                          <p className="text-muted-foreground text-xs">
                            ×{product.amount}
                            {product.rate != null && product.rate < 100
                              ? ` • ${product.rate}%`
                              : ""}
                          </p>
                        </div>
                      </Link>
                      {craftableItemIds.has(product.item.id) && (
                        <Link
                          to="/craft/$itemId"
                          params={{ itemId: product.item.id }}
                          className="text-muted-foreground shrink-0 text-xs font-medium hover:underline"
                        >
                          Craft
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
              Materials
            </p>
            <ul className="flex flex-col gap-2">
              {entry.materials.map((material) => {
                const override = overrideMap.get(material.item.id);
                const latestPrice = priceMap.get(material.item.id);
                const unitPrice =
                  override ??
                  parseMetric(latestPrice?.avg24h ?? null) ??
                  parseMetric(latestPrice?.avg7d ?? null);

                return (
                  <li key={`${entry.craft.id}-${material.item.id}`}>
                    <div
                      className={`hover:bg-muted/40 flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${
                        material.item.id === highlightedItemId
                          ? "border-primary"
                          : ""
                      }`}
                    >
                      <Link
                        to="/item/$itemId"
                        params={{ itemId: material.item.id }}
                        className="flex min-w-0 flex-1 items-center gap-3"
                      >
                        <ItemIcon
                          icon={material.item.icon}
                          name={material.item.name}
                          size="md"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate font-medium">
                              {material.item.name}
                            </p>
                            {craftableItemIds.has(material.item.id) && (
                              <Badge variant="outline" className="shrink-0">
                                Craftable
                              </Badge>
                            )}
                          </div>
                          <p className="text-muted-foreground text-xs">
                            {material.item.category}
                          </p>
                        </div>
                      </Link>
                      <div className="text-right text-sm tabular-nums">
                        <p>×{material.amount}</p>
                        <p className="text-muted-foreground text-xs">
                          {unitPrice != null
                            ? formatGold(unitPrice)
                            : "No price"}
                        </p>
                      </div>
                      {craftableItemIds.has(material.item.id) && (
                        <Link
                          to="/craft/$itemId"
                          params={{ itemId: material.item.id }}
                          className="text-muted-foreground shrink-0 text-xs font-medium hover:underline"
                        >
                          Craft
                        </Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

function RecipeSection({
  title,
  description,
  entries,
  itemId,
  priceMap,
  craftableItemIds,
  showOutputs,
  emptyMessage,
}: {
  title: string;
  description: string;
  entries: RecipeEntry[];
  itemId: number;
  priceMap: Map<number, PriceSummary>;
  craftableItemIds: Set<number>;
  showOutputs: boolean;
  emptyMessage: string;
}) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const normalizedSearch = deferredSearch.trim().toLowerCase();

  const filteredGroups = useMemo(() => {
    const filteredEntries =
      normalizedSearch.length === 0
        ? entries
        : entries.filter((entry) =>
            getRecipeSearchText(entry).includes(normalizedSearch),
          );

    return groupRecipesByProficiency(filteredEntries);
  }, [entries, normalizedSearch]);

  const totalMatches = filteredGroups.reduce(
    (sum, group) => sum + group.entries.length,
    0,
  );
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">{title}</h2>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
        {entries.length > 0 && (
          <div className="w-full sm:max-w-sm">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search recipes, proficiencies, materials..."
              aria-label={`${title} search`}
            />
          </div>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">{emptyMessage}</p>
      ) : totalMatches > 0 ? (
        <div className="space-y-3">
          <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline">
              {totalMatches} {totalMatches === 1 ? "recipe" : "recipes"}
            </Badge>
            <Badge variant="outline">
              {filteredGroups.length}{" "}
              {filteredGroups.length === 1 ? "proficiency" : "proficiencies"}
            </Badge>
          </div>
          <Accordion
            key={normalizedSearch || "all"}
            type="multiple"
            className="grid gap-4"
          >
            {filteredGroups.map((group) => {
              const groupLabel = group.proficiency ?? "Unknown";

              return (
                <AccordionItem key={groupLabel} value={groupLabel}>
                  <AccordionTrigger className="rounded-xl">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
                      {group.proficiency ? (
                        <ProficiencyBadge proficiency={group.proficiency} />
                      ) : (
                        <Badge variant="secondary">Unknown</Badge>
                      )}
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium">
                          {group.entries.length}{" "}
                          {group.entries.length === 1 ? "recipe" : "recipes"}
                        </span>
                        <span className="text-muted-foreground hidden sm:inline">
                          •
                        </span>
                        <span className="text-muted-foreground">
                          {showOutputs
                            ? "Consumes this item"
                            : "Produces this item"}
                        </span>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <Accordion type="multiple" className="grid gap-3">
                      {group.entries.map((entry) => (
                        <RecipeCard
                          key={entry.craft.id}
                          entry={entry}
                          highlightedItemId={itemId}
                          priceMap={priceMap}
                          craftableItemIds={craftableItemIds}
                          showOutputs={showOutputs}
                        />
                      ))}
                    </Accordion>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          No recipes match “{deferredSearch.trim()}”.
        </p>
      )}
    </section>
  );
}

function ItemDetail({ itemId }: { itemId: number }) {
  const trpc = useTRPC();
  const { data } = useSuspenseQuery(trpc.items.detail.queryOptions(itemId));

  const priceMap = useMemo(
    () => new Map(data?.latestPrices.map((price) => [price.itemId, price])),
    [data],
  );
  const craftableItemIds = useMemo(
    () => new Set(data?.craftableItemIds ?? []),
    [data],
  );

  if (!data) return <p>Item not found.</p>;

  const dailyHistory = collapseHistoryByDay(data.priceHistory);
  const latestSnapshot = dailyHistory.at(-1);
  const historyPoints: HistoryChartPoint[] = dailyHistory
    .map((snapshot) => ({
      label: formatSnapshotLabel(snapshot.fetchedAt),
      fullLabel: formatSnapshotTooltipLabel(snapshot.fetchedAt),
      price: parseMetric(snapshot.avg24h),
      volume: parseMetric(snapshot.vol24h),
    }))
    .filter((point) => point.price != null || point.volume != null);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-center gap-4">
          <ItemIcon icon={data.item.icon} name={data.item.name} size="lg" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-bold">{data.item.name}</h1>
              {data.item.sellable && <Badge>Sellable</Badge>}
            </div>
            <p className="text-muted-foreground text-sm">
              {data.item.category}
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ItemStat
            label="24h Price"
            value={
              parseMetric(latestSnapshot?.avg24h ?? null) != null
                ? formatGold(parseMetric(latestSnapshot?.avg24h ?? null) ?? 0)
                : "N/A"
            }
          />
          <ItemStat
            label="24h Volume"
            value={
              parseMetric(latestSnapshot?.vol24h ?? null) != null
                ? formatVolume(parseMetric(latestSnapshot?.vol24h ?? null) ?? 0)
                : "N/A"
            }
          />
          <ItemStat
            label="7d Price"
            value={
              parseMetric(latestSnapshot?.avg7d ?? null) != null
                ? formatGold(parseMetric(latestSnapshot?.avg7d ?? null) ?? 0)
                : "N/A"
            }
          />
          <ItemStat
            label="30d Price"
            value={
              parseMetric(latestSnapshot?.avg30d ?? null) != null
                ? formatGold(parseMetric(latestSnapshot?.avg30d ?? null) ?? 0)
                : "N/A"
            }
          />
        </div>
      </div>

      {data.item.description && (
        <ItemDescription text={data.item.description} />
      )}

      <CombinedHistoryChart data={historyPoints} />

      <RecipeSection
        title="Crafting Recipes"
        description="Recipes that produce this item, grouped by proficiency."
        entries={data.craftedBy}
        itemId={itemId}
        priceMap={priceMap}
        craftableItemIds={craftableItemIds}
        showOutputs={false}
        emptyMessage="No crafting recipes found for this item."
      />

      <RecipeSection
        title="Used In Recipes"
        description="Recipes that consume this item as a material, grouped by proficiency."
        entries={data.usedIn}
        itemId={itemId}
        priceMap={priceMap}
        craftableItemIds={craftableItemIds}
        showOutputs
        emptyMessage="This item is not used in any tracked crafting recipes."
      />
    </div>
  );
}
