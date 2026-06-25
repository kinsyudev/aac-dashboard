import type { ReactNode } from "react";
import { Suspense, useMemo, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Info, Trophy } from "lucide-react";

import { Badge } from "@acme/ui/badge";
import { Button } from "@acme/ui/button";
import { Input } from "@acme/ui/input";
import { Label } from "@acme/ui/label";

import type {
  CuratedTradePackData,
  PriceMap,
  RewardItemName,
  TradePack,
  TradePackCraftData,
  TradePackFilters,
  TradePackMetrics,
  TradePackResult,
  TradePackRunSummary,
} from "~/lib/trade-packs";
import tradePackData from "~/data/trade-packs.generated.json";
import {
  calculatePackMetrics,
  filterTradePacks,
  getTopPacksByProfitSilverPerLabor,
  getTopPacksByRevenue,
  summarizePackRun,
} from "~/lib/trade-packs";
import { useTRPC } from "~/lib/trpc";
import { useUserData } from "~/lib/useUserData";

const curatedData = tradePackData as CuratedTradePackData;
const allPacks = dedupeTradePacks(curatedData.packs);
const STATIC_TURN_IN_LABOR = 110;
type PackTypeFilter = "all" | "normal" | "larder" | "fish-food";
const FISH_FOOD_ITEM_IDS = new Set([9000362, 9000414]);
const packTypeOptions = [
  { value: "all", label: "All types" },
  { value: "normal", label: "Normal packs" },
  { value: "larder", label: "Larders" },
  { value: "fish-food", label: "Fish Food" },
] satisfies { value: PackTypeFilter; label: string }[];
const recipeItemIds = [
  ...new Set(
    allPacks
      .filter((pack) => !pack.isLarder && !pack.isFreePack)
      .map((pack) => pack.itemId),
  ),
];
const originOptions = uniqueSorted(allPacks.map((pack) => pack.origin));
const destinationOptions = uniqueSorted(
  allPacks.map((pack) => pack.destination),
);
const rewardOptions = uniqueSorted(allPacks.map((pack) => pack.rewardItemName));
export const Route = createFileRoute("/trade-packs")({
  head: () => ({
    meta: [
      { title: "Trade Packs | AAC Dashboard" },
      {
        name: "description",
        content:
          "Compare trade pack revenue, profit, and silver per labor by route, destination, and reward type.",
      },
    ],
  }),
  loader: async ({ context }) => {
    await context.queryClient.fetchQuery(
      context.trpc.auth.requireMember.queryOptions(),
    );
  },
  component: TradePacksPage,
});

function TradePacksPage() {
  return (
    <main className="mx-auto w-full max-w-[1600px] px-4 py-10 sm:px-6 lg:px-8 2xl:px-10">
      <div className="mb-6 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Trade Packs</h1>
          <Badge variant="secondary">
            {allPacks.length.toLocaleString()} packs
          </Badge>
        </div>
        <p className="text-muted-foreground max-w-3xl text-sm">
          Compare pack revenue, material cost, profit, and silver per labor from
          current market prices and your saved overrides.
        </p>
      </div>

      <Suspense
        fallback={
          <p className="text-muted-foreground text-sm">
            Loading trade packs...
          </p>
        }
      >
        <TradePacksContent />
      </Suspense>
    </main>
  );
}

function TradePacksContent() {
  const trpc = useTRPC();
  const { overrideMap, proficiencyMap } = useUserData();
  const { data } = useSuspenseQuery(
    trpc.tradePacks.dataForItems.queryOptions({
      itemIds: recipeItemIds.length > 0 ? recipeItemIds : [0],
    }),
  );
  const [gildaStarValue, setGildaStarValue] = useState("4");
  const [larderCostPerPack, setLarderCostPerPack] = useState("0");
  const [larderLaborPerPack, setLarderLaborPerPack] = useState("75");
  const [origin, setOrigin] = useState("all");
  const [destination, setDestination] = useState("all");
  const [packType, setPackType] = useState<PackTypeFilter>("all");
  const [rewardItemName, setRewardItemName] = useState<RewardItemName | "all">(
    "all",
  );
  const [routeOrigin, setRouteOrigin] = useState("");
  const [routeDestination, setRouteDestination] = useState("");
  const [selectedPackKey, setSelectedPackKey] = useState("");
  const [packCount, setPackCount] = useState("1");

  const priceMap = useMemo<PriceMap>(
    () => new Map(data.prices.map((price) => [price.itemId, price])),
    [data.prices],
  );
  const craftMap = useMemo(
    () => buildCraftMap(data.craftsByItemId),
    [data.craftsByItemId],
  );
  const numericInputs = useMemo(
    () => ({
      gildaStarValue: parseNonNegativeNumber(gildaStarValue, 4),
      larderCostPerPack: parseNonNegativeNumber(larderCostPerPack, 0),
      larderLaborPerPack: parseNonNegativeNumber(larderLaborPerPack, 75),
      turnInLabor: STATIC_TURN_IN_LABOR,
    }),
    [gildaStarValue, larderCostPerPack, larderLaborPerPack],
  );
  const filteredPacks = useMemo(() => {
    const filters: TradePackFilters = {
      origin,
      destination,
      rewardItemName,
    };
    return filterByPackType(filterTradePacks(allPacks, filters), packType);
  }, [destination, origin, packType, rewardItemName]);
  const calculationRows = useMemo(
    () =>
      filteredPacks.map((pack) =>
        calculatePackSafely({
          pack,
          craftMap,
          priceMap,
          overrideMap,
          proficiencyMap,
          gildaStarValue: numericInputs.gildaStarValue,
          larderCostPerPack: numericInputs.larderCostPerPack,
          larderLaborPerPack: numericInputs.larderLaborPerPack,
          turnInLabor: numericInputs.turnInLabor,
        }),
      ),
    [
      craftMap,
      filteredPacks,
      numericInputs.gildaStarValue,
      numericInputs.larderCostPerPack,
      numericInputs.larderLaborPerPack,
      numericInputs.turnInLabor,
      overrideMap,
      priceMap,
      proficiencyMap,
    ],
  );
  const availableResults = useMemo(
    () =>
      calculationRows.flatMap((row) =>
        row.result === null ? [] : [row.result],
      ),
    [calculationRows],
  );
  const unavailableCount = calculationRows.length - availableResults.length;
  const topBySilverPerLabor = useMemo(
    () => getTopPacksByProfitSilverPerLabor(availableResults, 10),
    [availableResults],
  );
  const topByRevenue = useMemo(
    () => getTopPacksByRevenue(availableResults, 10),
    [availableResults],
  );
  const routeOriginOptions = useMemo(
    () => uniqueSorted(filteredPacks.map((pack) => pack.origin)),
    [filteredPacks],
  );
  const effectiveRouteOrigin = routeOriginOptions.includes(routeOrigin)
    ? routeOrigin
    : (routeOriginOptions[0] ?? "");
  const routeDestinationOptions = useMemo(
    () =>
      uniqueSorted(
        filteredPacks
          .filter((pack) => pack.origin === effectiveRouteOrigin)
          .map((pack) => pack.destination),
      ),
    [effectiveRouteOrigin, filteredPacks],
  );
  const effectiveRouteDestination = routeDestinationOptions.includes(
    routeDestination,
  )
    ? routeDestination
    : (routeDestinationOptions[0] ?? "");
  const packsForRoute = useMemo(
    () =>
      filteredPacks.filter(
        (pack) =>
          pack.origin === effectiveRouteOrigin &&
          pack.destination === effectiveRouteDestination,
      ),
    [effectiveRouteDestination, effectiveRouteOrigin, filteredPacks],
  );
  const routeCalculationRows = useMemo(
    () =>
      packsForRoute.map((pack) =>
        calculatePackSafely({
          pack,
          craftMap,
          priceMap,
          overrideMap,
          proficiencyMap,
          gildaStarValue: numericInputs.gildaStarValue,
          larderCostPerPack: numericInputs.larderCostPerPack,
          larderLaborPerPack: numericInputs.larderLaborPerPack,
          turnInLabor: numericInputs.turnInLabor,
        }),
      ),
    [
      craftMap,
      numericInputs.gildaStarValue,
      numericInputs.larderCostPerPack,
      numericInputs.larderLaborPerPack,
      numericInputs.turnInLabor,
      overrideMap,
      packsForRoute,
      priceMap,
      proficiencyMap,
    ],
  );
  const bestRouteResult = useMemo(
    () =>
      getTopPacksByProfitSilverPerLabor(
        routeCalculationRows.flatMap((row) =>
          row.result === null ? [] : [row.result],
        ),
        1,
      )[0] ?? null,
    [routeCalculationRows],
  );
  const selectedPack = useMemo(() => {
    const matchingPack = packsForRoute.find(
      (pack) => getPackKey(pack) === selectedPackKey,
    );
    return matchingPack ?? packsForRoute[0] ?? null;
  }, [packsForRoute, selectedPackKey]);
  const selectedCalculation = useMemo(
    () =>
      selectedPack
        ? calculatePackSafely({
            pack: selectedPack,
            craftMap,
            priceMap,
            overrideMap,
            proficiencyMap,
            gildaStarValue: numericInputs.gildaStarValue,
            larderCostPerPack: numericInputs.larderCostPerPack,
            larderLaborPerPack: numericInputs.larderLaborPerPack,
            turnInLabor: numericInputs.turnInLabor,
          })
        : null,
    [
      craftMap,
      numericInputs.gildaStarValue,
      numericInputs.larderCostPerPack,
      numericInputs.larderLaborPerPack,
      numericInputs.turnInLabor,
      overrideMap,
      priceMap,
      proficiencyMap,
      selectedPack,
    ],
  );
  const runSummary = useMemo(() => {
    if (!selectedCalculation?.result) return null;
    return summarizePackRun(
      selectedCalculation.result.metrics,
      parsePositiveInteger(packCount, 1),
    );
  }, [packCount, selectedCalculation]);

  return (
    <div className="space-y-6">
      <section className="grid gap-4 rounded-md border p-4 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <h2 className="text-base font-semibold">Inputs</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Values are in gold unless the label says labor. Commerce
            proficiency discounts both pack craft labor and the fixed 110
            turn-in labor.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField
            id="gilda-star-value"
            label="Gilda value"
            helpText="Used as the gold value for each Gilda Star paid by a pack."
            value={gildaStarValue}
            onChange={setGildaStarValue}
            min={0}
            step="0.01"
          />
          <NumberField
            id="larder-cost"
            label="Larder cost"
            helpText="Your estimated gold cost per larder pack. Larders do not have recipe data in the current database."
            value={larderCostPerPack}
            onChange={setLarderCostPerPack}
            min={0}
            step="0.01"
          />
          <NumberField
            id="larder-labor"
            label="Larder labor"
            helpText="Base labor spent making each larder. Commerce proficiency discounts this and the fixed turn-in labor."
            value={larderLaborPerPack}
            onChange={setLarderLaborPerPack}
            min={0}
            step="1"
          />
        </div>
      </section>

      <section className="grid gap-4 rounded-md border p-4 lg:grid-cols-[1fr_1.4fr]">
        <div>
          <h2 className="text-base font-semibold">Filters</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Rankings use the current filters and hide unavailable normal packs.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <Badge variant="outline">
              {filteredPacks.length.toLocaleString()} matched
            </Badge>
            <Badge variant="outline">
              {availableResults.length.toLocaleString()} priced
            </Badge>
            {unavailableCount > 0 ? (
              <Badge variant="secondary">
                {unavailableCount.toLocaleString()} unavailable
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SelectField
            id="origin-filter"
            label="Origin"
            value={origin}
            onChange={setOrigin}
            options={[
              { value: "all", label: "All origins" },
              ...originOptions.map((option) => ({
                value: option,
                label: option,
              })),
            ]}
          />
          <SelectField
            id="destination-filter"
            label="Destination"
            value={destination}
            onChange={setDestination}
            options={[
              { value: "all", label: "All destinations" },
              ...destinationOptions.map((option) => ({
                value: option,
                label: option,
              })),
            ]}
          />
          <SelectField
            id="reward-filter"
            label="Reward"
            value={rewardItemName}
            onChange={setRewardItemName}
            options={[
              { value: "all", label: "All rewards" },
              ...rewardOptions.map((option) => ({
                value: option,
                label: option,
              })),
            ]}
          />
          <SelectField
            id="pack-type-filter"
            label="Pack type"
            value={packType}
            onChange={setPackType}
            options={packTypeOptions}
          />
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <RankingTable
          title="Best Silver/Labor"
          description="Top 10 by profit silver per labor."
          rows={topBySilverPerLabor}
        />
        <RankingTable
          title="Best Revenue"
          description="Top 10 by single-pack revenue."
          rows={topByRevenue}
        />
      </section>

      <section className="rounded-md border p-4">
        <div className="mb-4 flex flex-col gap-1">
          <h2 className="text-base font-semibold">Route Calculator</h2>
          <p className="text-muted-foreground text-sm">
            Pick an origin, destination, pack, and count to inspect total
            revenue, cost, profit, labor, and silver per labor.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1.5fr_auto_0.5fr]">
          <SelectField
            id="route-origin-selector"
            label="Origin"
            value={effectiveRouteOrigin}
            onChange={(value) => {
              setRouteOrigin(value);
              setRouteDestination("");
              setSelectedPackKey("");
            }}
            options={routeOriginOptions.map((option) => ({
              value: option,
              label: option,
            }))}
          />
          <SelectField
            id="route-destination-selector"
            label="Destination"
            value={effectiveRouteDestination}
            onChange={(value) => {
              setRouteDestination(value);
              setSelectedPackKey("");
            }}
            options={routeDestinationOptions.map((option) => ({
              value: option,
              label: option,
            }))}
          />
          <SelectField
            id="pack-selector"
            label="Pack"
            value={selectedPack ? getPackKey(selectedPack) : ""}
            onChange={setSelectedPackKey}
            options={packsForRoute.map((pack) => ({
              value: getPackKey(pack),
              label: `${pack.name} - ${pack.rewardItemName}`,
            }))}
          />
          <div className="flex items-end">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={bestRouteResult === null}
              onClick={() => {
                if (bestRouteResult === null) return;
                setSelectedPackKey(getPackKey(bestRouteResult.pack));
              }}
            >
              <Trophy className="size-4" aria-hidden="true" />
              Best
            </Button>
          </div>
          <NumberField
            id="pack-count"
            label="Count"
            value={packCount}
            onChange={setPackCount}
            min={1}
            step="1"
          />
        </div>

        {selectedCalculation?.result && runSummary ? (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">
                {selectedCalculation.result.pack.name}
              </span>
              <Badge variant="secondary">
                {selectedCalculation.result.pack.rewardItemName}
              </Badge>
              {selectedCalculation.result.pack.isLarder ? (
                <Badge variant="outline">Larder</Badge>
              ) : null}
              {selectedCalculation.result.pack.isFreePack ? (
                <Badge variant="outline">Free pack</Badge>
              ) : null}
            </div>
            <MetricsSummary summary={runSummary} />
          </div>
        ) : (
          <div className="text-muted-foreground mt-4 rounded-md border border-dashed p-4 text-sm">
            {selectedCalculation?.unavailableReason ??
              "No pack is available for this route."}
          </div>
        )}
      </section>
    </div>
  );
}

function NumberField({
  id,
  label,
  helpText,
  value,
  onChange,
  min,
  step,
}: {
  id: string;
  label: string;
  helpText?: string;
  value: string;
  onChange: (value: string) => void;
  min?: number;
  step?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        {helpText ? <InfoTooltip text={helpText} /> : null}
      </div>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        step={step}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </div>
  );
}

function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={text}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 rounded-full outline-none focus-visible:ring-[3px]"
      >
        <Info className="size-3.5" aria-hidden="true" />
      </button>
      <span className="bg-popover text-popover-foreground pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-64 -translate-x-1/2 rounded-md border px-3 py-2 text-xs leading-relaxed shadow-md group-focus-within:block group-hover:block">
        {text}
      </span>
    </span>
  );
}

function SelectField<TValue extends string>({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: TValue;
  onChange: (value: TValue) => void;
  options: readonly { value: TValue; label: string }[];
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value as TValue)}
        className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function RankingTable({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows: TradePackResult[];
}) {
  return (
    <section className="rounded-md border">
      <div className="border-b p-4">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{description}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr className="text-left">
              <Th>#</Th>
              <Th>Pack</Th>
              <Th>Reward</Th>
              <Th align="right">s/L</Th>
              <Th align="right">Profit</Th>
              <Th>Route</Th>
              <Th align="right">Revenue</Th>
              <Th align="right">Cost</Th>
              <Th align="right">Labor</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? (
              rows.map((row, index) => (
                <tr
                  key={`${getPackKey(row.pack)}-${index}`}
                  className="border-t"
                >
                  <Td>{index + 1}</Td>
                  <Td>
                    <div className="font-medium">{row.pack.name}</div>
                    <div className="text-muted-foreground text-xs">
                      Item {row.pack.itemId}
                    </div>
                  </Td>
                  <Td>
                    <Badge variant="outline">{row.pack.rewardItemName}</Badge>
                  </Td>
                  <Td align="right">
                    {formatSilverPerLabor(row.metrics.silverPerLabor)}
                  </Td>
                  <Td align="right">{formatGold(row.metrics.profit)}</Td>
                  <Td>{row.pack.route}</Td>
                  <Td align="right">{formatGold(row.metrics.revenue)}</Td>
                  <Td align="right">{formatGold(row.metrics.cost)}</Td>
                  <Td align="right">{formatNumber(row.metrics.labor)}</Td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={9}
                  className="text-muted-foreground px-4 py-8 text-center"
                >
                  No priced packs match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MetricsSummary({ summary }: { summary: TradePackRunSummary }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
      <Metric label="Packs" value={summary.count.toLocaleString()} />
      <Metric label="Revenue" value={formatGold(summary.revenue)} />
      <Metric label="Cost" value={formatGold(summary.cost)} />
      <Metric label="Profit" value={formatGold(summary.profit)} />
      <Metric label="Labor" value={formatNumber(summary.labor)} />
      <Metric
        label="Silver/Labor"
        value={formatSilverPerLabor(summary.silverPerLabor)}
      />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={`px-4 py-3 font-medium ${
        align === "right" ? "text-right" : ""
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
}: {
  children: ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td
      className={`px-4 py-3 align-top ${align === "right" ? "text-right" : ""}`}
    >
      {children}
    </td>
  );
}

function buildCraftMap(
  craftsByItemId: Record<
    number,
    {
      craft: { id: number; labor: number; proficiency: string | null };
      materials: { item: { id: number }; amount: number }[];
    }[]
  >,
): Map<number, TradePackCraftData> {
  const craftMap = new Map<number, TradePackCraftData>();
  for (const [itemId, entries] of Object.entries(craftsByItemId)) {
    const entry = [...entries].sort(
      (left, right) => left.craft.id - right.craft.id,
    )[0];
    if (!entry) continue;
    craftMap.set(Number(itemId), {
      labor: entry.craft.labor,
      proficiency: entry.craft.proficiency,
      materials: entry.materials.map((material) => ({
        itemId: material.item.id,
        amount: material.amount,
      })),
    });
  }
  return craftMap;
}

function calculatePackSafely({
  pack,
  craftMap,
  priceMap,
  overrideMap,
  proficiencyMap,
  gildaStarValue,
  larderCostPerPack,
  larderLaborPerPack,
  turnInLabor,
}: {
  pack: TradePack;
  craftMap: Map<number, TradePackCraftData>;
  priceMap: PriceMap;
  overrideMap: Map<number, number>;
  proficiencyMap: Map<string, number>;
  gildaStarValue: number;
  larderCostPerPack: number;
  larderLaborPerPack: number;
  turnInLabor: number;
}): { result: TradePackResult | null; unavailableReason?: string } {
  const craft =
    pack.isLarder || pack.isFreePack
      ? null
      : (craftMap.get(pack.itemId) ?? null);

  if (!pack.isLarder && !pack.isFreePack && craft === null) {
    return {
      result: null,
      unavailableReason: `Missing craft data for trade pack item ${pack.itemId}`,
    };
  }

  try {
    const metrics = calculatePackMetrics({
      pack,
      craft,
      priceMap,
      overrideMap,
      proficiencyMap,
      gildaStarValue,
      larderCostPerPack,
      larderLaborPerPack,
      turnInLabor,
    });

    return { result: { pack, metrics } };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.startsWith("Missing craft data for trade pack item ") ||
        error.message.startsWith("Missing material price for trade pack item "))
    ) {
      return {
        result: null,
        unavailableReason: error.message,
      };
    }
    throw error;
  }
}

function dedupeTradePacks(packs: TradePack[]): TradePack[] {
  const seen = new Set<string>();
  return packs.filter((pack) => {
    const key = getPackKey(pack);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function filterByPackType(
  packs: TradePack[],
  packType: PackTypeFilter,
): TradePack[] {
  if (packType === "all") return packs;
  return packs.filter((pack) => getPackType(pack) === packType);
}

function getPackType(pack: TradePack): Exclude<PackTypeFilter, "all"> {
  if (pack.isLarder) return "larder";
  if (FISH_FOOD_ITEM_IDS.has(pack.itemId) || pack.name.includes("Fish Food")) {
    return "fish-food";
  }
  return "normal";
}

function uniqueSorted<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function getPackKey(pack: TradePack): string {
  return [
    pack.itemId,
    pack.name,
    pack.origin,
    pack.destination,
    pack.rewardItemName,
    pack.payout,
    pack.isLarder,
    pack.isFreePack,
  ].join(":");
}

function parseNonNegativeNumber(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
}

function parsePositiveInteger(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function formatGold(value: number): string {
  return `${value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })}g`;
}

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatSilverPerLabor(
  value: TradePackMetrics["silverPerLabor"],
): string {
  if (value == null) return "n/a";
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} s/L`;
}
