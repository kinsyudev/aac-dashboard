import { Suspense, useDeferredValue, useMemo, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { Badge } from "@acme/ui/badge";
import { Input } from "@acme/ui/input";

import { ItemIcon } from "~/component/item-icon";
import { useTRPC } from "~/lib/trpc";

const SEALED_DELPHINAD_PREFIX = "sealed delphinad";

export const Route = createFileRoute("/simulator/")({
  head: () => ({
    meta: [
      { title: "Simulator | AAC Dashboard" },
      {
        name: "description",
        content:
          "Simulate ArcheAge Classic sealed craft chains and compare profitability before you spend resources.",
      },
    ],
  }),
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(
      context.trpc.items.craftable.queryOptions(),
    );
  },
  component: SimulatorIndex,
});

function SimulatorIndex() {
  const [query, setQuery] = useState("Sealed Delphinad");
  const deferred = useDeferredValue(query);

  return (
    <main className="container py-16">
      <h1 className="mb-2 text-3xl font-bold">Craft Simulator</h1>
      <p className="text-muted-foreground mb-6 text-sm">
        Select a sealed item to simulate profitability of the craft chain.
      </p>

      <Input
        placeholder="Search items... (e.g. Sealed Delphinad Cuirass)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mb-6 max-w-md"
      />

      {deferred.trim().length >= 2 && (
        <Suspense
          fallback={<p className="text-muted-foreground text-sm">Loading...</p>}
        >
          <SearchResults query={deferred} />
        </Suspense>
      )}
    </main>
  );
}

function SearchResults({ query }: { query: string }) {
  const trpc = useTRPC();
  const { data: allItems } = useSuspenseQuery(
    trpc.items.craftable.queryOptions(),
  );

  const results = useMemo(() => {
    const q = query.toLowerCase();
    return allItems.filter((item) => {
      const name = item.name.toLowerCase();
      return (
        name.includes(SEALED_DELPHINAD_PREFIX) &&
        name.includes(q)
      );
    });
  }, [allItems, query]);

  if (results.length === 0) {
    return <p className="text-muted-foreground text-sm">No items found.</p>;
  }

  return (
    <ul className="flex flex-col divide-y">
      {results.map((item) => (
        <li key={item.id}>
          <Link
            to="/simulator/$itemId"
            params={{ itemId: item.id }}
            className="hover:bg-muted/50 flex items-center gap-3 rounded-md px-2 py-2 transition-colors"
          >
            <ItemIcon icon={item.icon} name={item.name} size="md" />
            <span className="flex-1 font-medium">{item.name}</span>
            <span className="text-muted-foreground text-xs">
              {item.category}
            </span>
            {item.labor != null && item.labor > 0 && (
              <Badge variant="secondary">{item.labor} labor</Badge>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
