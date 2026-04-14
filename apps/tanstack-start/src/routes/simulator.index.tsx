import { Suspense, useDeferredValue, useMemo, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { Badge } from "@acme/ui/badge";

import { ItemSearchResultList, SearchPageShell } from "~/component/item-search";
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
    <SearchPageShell
      title="Craft Simulator"
      description="Select a sealed item to simulate profitability of the craft chain."
      query={query}
      onQueryChange={setQuery}
      placeholder="Search items... (e.g. Sealed Delphinad Cuirass)"
      inputClassName="max-w-md"
    >
      {deferred.trim().length >= 2 ? (
        <Suspense
          fallback={<p className="text-muted-foreground text-sm">Loading...</p>}
        >
          <SearchResults query={deferred} />
        </Suspense>
      ) : null}
    </SearchPageShell>
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
      return name.includes(SEALED_DELPHINAD_PREFIX) && name.includes(q);
    });
  }, [allItems, query]);

  return (
    <ItemSearchResultList
      items={results}
      emptyMessage="No items found."
      getMeta={(item) => item.category}
      getBadge={(item) =>
        item.labor > 0 ? (
          <Badge variant="secondary">{item.labor} labor</Badge>
        ) : null
      }
      renderLink={(item, content) => (
        <Link to="/simulator/$itemId" params={{ itemId: item.id }}>
          {content}
        </Link>
      )}
    />
  );
}
