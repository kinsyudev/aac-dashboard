import type React from "react";
import { Suspense } from "react";
import { useQueries, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { z } from "zod";

import { useTRPC } from "~/lib/trpc";

export const Route = createFileRoute("/craft/$itemId")({
  params: {
    parse: (p) => ({ itemId: z.coerce.number().int().parse(p.itemId) }),
    stringify: (p) => ({ itemId: String(p.itemId) }),
  },
  loader: async ({ context, params }) => {
    const { trpc, queryClient } = context;
    const [item, craftsForItem] = await Promise.all([
      queryClient.fetchQuery(trpc.items.byId.queryOptions(params.itemId)),
      queryClient.fetchQuery(trpc.crafts.byItemId.queryOptions(params.itemId)),
    ]);
    if (!item) throw notFound();
    const craftDetails = await Promise.all(
      craftsForItem.map((craft) =>
        queryClient.fetchQuery(trpc.crafts.byId.queryOptions(craft.id)),
      ),
    );
    const materialItemIds = [
      ...new Set(
        craftDetails.flatMap((d) => d?.materials.map((m) => m.item.id) ?? []),
      ),
    ];
    await Promise.all([
      ...materialItemIds.map((id) =>
        queryClient.prefetchQuery(trpc.items.price.queryOptions(id)),
      ),
      queryClient.prefetchQuery(trpc.profile.getPriceOverrides.queryOptions()),
    ]);
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

function CraftRecipe({ craftId }: { craftId: number }) {
  const trpc = useTRPC();
  const { data } = useSuspenseQuery(trpc.crafts.byId.queryOptions(craftId));
  const { data: overrides } = useSuspenseQuery(
    trpc.profile.getPriceOverrides.queryOptions(),
  );

  const priceQueries = useQueries({
    queries:
      data?.materials.map(({ item }) => trpc.items.price.queryOptions(item.id)) ?? [],
  });

  if (!data) return null;

  const { craft, materials } = data;

  const overrideMap = new Map(overrides?.map((o) => [o.itemId, parseFloat(o.price)]));

  const total = materials.reduce((sum, { item, amount }, i) => {
    const customPrice = overrideMap.get(item.id);
    const price = priceQueries[i]?.data;
    const unit =
      customPrice != null
        ? customPrice
        : parseFloat(price?.avg24h ?? price?.avg7d ?? "0");
    return sum + unit * amount;
  }, 0);

  const hasPrices =
    priceQueries.some((q) => q.data) || overrideMap.size > 0;

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
        {materials.map(({ item, amount }, i) => {
          const customPrice = overrideMap.get(item.id);
          const price = priceQueries[i]?.data;
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
                      = {lineTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}g
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
  const { data: item } = useSuspenseQuery(trpc.items.byId.queryOptions(itemId));
  const { data: craftsForItem } = useSuspenseQuery(
    trpc.crafts.byItemId.queryOptions(itemId),
  );

  if (!item) return <p>Item not found.</p>;

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
        {item.labor != null && item.labor > 0 && (
          <StatCard label="Labor" value={item.labor} />
        )}
        <StatCard label="Sellable" value={item.sellable ? "Yes" : "No"} />
        {item.maxStackSize > 1 && (
          <StatCard label="Max Stack" value={item.maxStackSize} />
        )}
      </div>

      {craftsForItem.length > 0 && (
        <div className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold">Crafts</h2>
          {craftsForItem.map((craft) => (
            <Suspense key={craft.id} fallback={<p>Loading recipe...</p>}>
              <CraftRecipe craftId={craft.id} />
            </Suspense>
          ))}
        </div>
      )}
    </div>
  );
}
