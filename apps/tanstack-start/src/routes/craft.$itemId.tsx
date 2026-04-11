import type React from "react";
import { Suspense, useMemo } from "react";
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
type PriceMap = Map<number, { avg24h: string | null; avg7d: string | null }>;
type OverrideMap = Map<number, number>;

function CraftRecipe({
  entry,
  priceMap,
  overrideMap,
}: {
  entry: CraftEntry;
  priceMap: PriceMap;
  overrideMap: OverrideMap;
}) {
  const { craft, materials } = entry;

  const total = materials.reduce((sum, { item, amount }) => {
    const customPrice = overrideMap.get(item.id);
    const price = priceMap.get(item.id);
    const unit =
      customPrice != null
        ? customPrice
        : parseFloat(price?.avg24h ?? price?.avg7d ?? "0");
    return sum + unit * amount;
  }, 0);

  const hasPrices = priceMap.size > 0 || overrideMap.size > 0;

  return (
    <div className="rounded-md border p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <p className="font-medium">{craft.name}</p>
          {craft.labor > 0 && (
            <span className="text-muted-foreground text-sm">
              {craft.labor} labor
            </span>
          )}
        </div>
        {hasPrices && (
          <p className="text-sm font-medium">
            Total:{" "}
            <span className="text-primary">
              {total.toLocaleString(undefined, { maximumFractionDigits: 0 })}g
            </span>
          </p>
        )}
      </div>
      <ul className="flex flex-col gap-2">
        {materials.map(({ item, amount }) => {
          const customPrice = overrideMap.get(item.id);
          const price = priceMap.get(item.id);
          const isCustom = customPrice != null;
          const unit = isCustom
            ? customPrice
            : parseFloat(price?.avg24h ?? price?.avg7d ?? "0");
          const lineTotal = unit * amount;
          const hasPrice = isCustom || !!price;

          return (
            <li key={item.id} className="flex items-center gap-2 text-sm">
              {item.icon ? (
                <img
                  src={`https://aa-classic.com/game/icons/${item.icon}`}
                  alt={item.name}
                  className="h-8 w-8 shrink-0"
                />
              ) : (
                <div className="bg-muted h-8 w-8 shrink-0 rounded" />
              )}
              <span className="flex-1">
                {item.name}
                {amount > 1 && (
                  <span className="text-muted-foreground ml-1">×{amount}</span>
                )}
              </span>
              {hasPrice && (
                <span className="text-muted-foreground tabular-nums">
                  {isCustom && (
                    <span className="text-primary mr-1 text-xs">(custom)</span>
                  )}
                  {unit.toLocaleString(undefined, { maximumFractionDigits: 0 })}g
                  {amount > 1 && (
                    <span className="text-foreground ml-2 font-medium">
                      ={" "}
                      {lineTotal.toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })}
                      g
                    </span>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
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
        {item.icon && (
          <img
            src={`https://aa-classic.com/game/icons/${item.icon}`}
            alt={item.name}
            className="h-16 w-16 shrink-0"
          />
        )}
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
            />
          ))}
        </div>
      )}
    </div>
  );
}
