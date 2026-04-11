import type React from "react";
import { Fragment, Suspense, useMemo, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import type { inferProcedureOutput } from "@trpc/server";
import { z } from "zod";

import type { AppRouter } from "@acme/api";

import { useTRPC } from "~/lib/trpc";

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
    if (!data) throw notFound();
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

function ItemDescription({ text }: { text: string }) {
  const lines = text
    .replace(/\|ni;/g, "")
    .replace(/\|nd;/g, "")
    .replace(/\|r/g, "\n")
    .split("\n")
    .map((l) => l.trim());

  const elements: React.ReactNode[] = [];
  let listBuffer: string[] = [];

  const flushList = (key: number) => {
    if (listBuffer.length > 0) {
      elements.push(
        <ul key={key} className="list-disc pl-4">
          {listBuffer.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>,
      );
      listBuffer = [];
    }
  };

  lines.forEach((line, i) => {
    if (!line) {
      flushList(i);
      return;
    }
    if (line.startsWith("- ")) {
      listBuffer.push(line.slice(2));
    } else {
      flushList(i);
      elements.push(<p key={i}>{line}</p>);
    }
  });
  flushList(lines.length);

  return (
    <div className="text-muted-foreground flex flex-col gap-1 text-sm">
      {elements}
    </div>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="bg-muted/50 rounded-md border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}

type PageData = NonNullable<inferProcedureOutput<AppRouter["crafts"]["forItem"]>>;
type CraftEntry = PageData["crafts"][number];
type SubcraftEntry = PageData["subcraftsByItemId"][number][number];
type PriceMap = Map<number, { avg24h: string | null; avg7d: string | null }>;
type OverrideMap = Map<number, number>;
type SubcraftMap = Record<number, SubcraftEntry[]>;

function pickPreferredCraft(entries: SubcraftEntry[], itemId: number): SubcraftEntry {
  return [...entries].sort((a, b) => {
    const amt = (e: SubcraftEntry) =>
      e.products.find((p) => p.item.id === itemId)?.amount ?? 999;
    return amt(a) - amt(b);
  })[0]!;
}

function ItemIcon({
  icon,
  name,
  size = "sm",
}: {
  icon: string | null;
  name: string;
  size?: "sm" | "lg";
}) {
  const cls = size === "lg" ? "h-16 w-16" : "h-5 w-5";
  return icon ? (
    <img
      src={`https://aa-classic.com/game/icons/${icon}`}
      alt={name}
      className={`${cls} shrink-0`}
    />
  ) : (
    <div className={`bg-muted ${cls} shrink-0 rounded`} />
  );
}

function CraftRecipe({
  entry,
  priceMap,
  overrideMap,
  subcraftMap = {},
  depth = 0,
}: {
  entry: CraftEntry | SubcraftEntry;
  priceMap: PriceMap;
  overrideMap: OverrideMap;
  subcraftMap?: SubcraftMap;
  depth?: number;
}) {
  const { craft, materials } = entry;
  const [modes, setModes] = useState<Record<number, "buy" | "craft">>({});

  const getMode = (itemId: number): "buy" | "craft" => modes[itemId] ?? "buy";

  const getCraftCostPerUnit = (itemId: number): number => {
    const subEntries = subcraftMap[itemId];
    if (!subEntries) return 0;
    const sub = pickPreferredCraft(subEntries, itemId);
    const batchCost = sub.materials.reduce((sum, { item, amount }) => {
      const custom = overrideMap.get(item.id);
      const price = priceMap.get(item.id);
      const u =
        custom != null ? custom : parseFloat(price?.avg24h ?? price?.avg7d ?? "0");
      return sum + u * amount;
    }, 0);
    const produced = sub.products.find((p) => p.item.id === itemId)?.amount ?? 1;
    return batchCost / produced;
  };

  const total = materials.reduce((sum, { item, amount }) => {
    const isCraftable = depth < 4 && !!subcraftMap[item.id];
    const custom = overrideMap.get(item.id);
    const price = priceMap.get(item.id);
    const buyUnit =
      custom != null ? custom : parseFloat(price?.avg24h ?? price?.avg7d ?? "0");
    const unit =
      getMode(item.id) === "craft" && isCraftable
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
      {/* Header */}
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <p className={`font-semibold ${depth > 0 ? "text-sm" : ""} truncate`}>
            {craft.name}
          </p>
          {craft.labor > 0 && (
            <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
              {craft.labor} labor
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

      {/* Materials */}
      <ul className="flex flex-col gap-1">
        {materials.map(({ item, amount }) => {
          const isCraftable = depth < 4 && !!subcraftMap[item.id];
          const mode = getMode(item.id);
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
          const totalDiff = isCraftable && hasPrice ? (buyUnit - craftUnit) * amount : null;
          const subEntry = isCraftable
            ? pickPreferredCraft(subcraftMap[item.id]!, item.id)
            : null;
          const subLabor = subEntry?.craft.labor ?? 0;

          return (
            <Fragment key={item.id}>
              <li className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/40">
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
                      onClick={() =>
                        setModes((m) => ({ ...m, [item.id]: "buy" }))
                      }
                      className={`px-2.5 py-0.5 transition-colors ${
                        mode === "buy"
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Buy
                    </button>
                    <button
                      onClick={() =>
                        setModes((m) => ({ ...m, [item.id]: "craft" }))
                      }
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
                      <span className="text-amber-500 mr-1 text-xs">
                        {subLabor}L +
                      </span>
                    )}
                    <span className="text-foreground/70">
                      {unit.toLocaleString(undefined, { maximumFractionDigits: 0 })}g
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

              {mode === "craft" && isCraftable && (
                <li className="border-muted-foreground/20 my-0.5 ml-3 border-l-2 pl-3">
                  <CraftRecipe
                    entry={subEntry!}
                    priceMap={priceMap}
                    overrideMap={overrideMap}
                    subcraftMap={subcraftMap}
                    depth={depth + 1}
                  />
                </li>
              )}
            </Fragment>
          );
        })}
      </ul>

      {/* Legend — only on top-level cards that have craftable ingredients */}
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
            <span className="font-medium text-amber-500">XL</span> labor to craft
          </span>
          <span>toggle Buy / Craft per ingredient</span>
        </div>
      )}
    </div>
  );
}

function ItemDetail({ itemId }: { itemId: number }) {
  const trpc = useTRPC();
  const { data } = useSuspenseQuery(trpc.crafts.forItem.queryOptions(itemId));

  const priceMap: PriceMap = useMemo(
    () => new Map(data?.prices.map((p) => [p.itemId, p])),
    [data],
  );
  const overrideMap: OverrideMap = useMemo(
    () => new Map(data?.overrides.map((o) => [o.itemId, parseFloat(o.price)])),
    [data],
  );

  if (!data) return <p>Item not found.</p>;

  const { item, crafts } = data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        {item.icon && <ItemIcon icon={item.icon} name={item.name} size="lg" />}
        <div>
          <h1 className="text-3xl font-bold">{item.name}</h1>
          <p className="text-muted-foreground text-sm">{item.category}</p>
        </div>
      </div>

      {item.description && <ItemDescription text={item.description} />}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {item.level > 0 && <StatCard label="Level" value={item.level} />}
        {item.levelRequirement > 0 && (
          <StatCard label="Level Req." value={item.levelRequirement} />
        )}
        <StatCard label="Sellable" value={item.sellable ? "Yes" : "No"} />
        {item.maxStackSize > 1 && (
          <StatCard label="Max Stack" value={item.maxStackSize} />
        )}
      </div>

      {crafts.length > 0 && (
        <div className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold">Crafts</h2>
          {crafts.map((entry) => (
            <CraftRecipe
              key={entry.craft.id}
              entry={entry}
              priceMap={priceMap}
              overrideMap={overrideMap}
              subcraftMap={data.subcraftsByItemId ?? {}}
            />
          ))}
        </div>
      )}
    </div>
  );
}
