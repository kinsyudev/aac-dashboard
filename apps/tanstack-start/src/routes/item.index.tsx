import { Suspense, useDeferredValue, useMemo, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { Badge } from "@acme/ui/badge";
import { Input } from "@acme/ui/input";

import type { RecentItem } from "~/lib/recent-searches";
import { ItemIcon } from "~/component/item-icon";
import { useRecentSearches } from "~/lib/recent-searches";
import { useTRPC } from "~/lib/trpc";

export const Route = createFileRoute("/item/")({
  head: () => ({
    meta: [
      { title: "Items | AAC Dashboard" },
      {
        name: "description",
        content:
          "Browse ArcheAge Classic items, inspect price history and volume, and explore recipes that make or consume each item.",
      },
    ],
  }),
  loader: ({ context }) => {
    const { trpc, queryClient } = context;
    void queryClient.prefetchQuery(trpc.items.all.queryOptions());
  },
  component: RouteComponent,
});

function RouteComponent() {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const { recents, add, remove } = useRecentSearches("item:recent-searches");

  return (
    <main className="container py-16">
      <h1 className="mb-6 text-3xl font-bold">Items</h1>
      <div className="flex flex-col gap-4">
        <Input
          placeholder="Search all items..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-sm"
        />
        {deferredQuery.trim() ? (
          <Suspense
            fallback={
              <p className="text-muted-foreground text-sm">Loading...</p>
            }
          >
            <SearchResults query={deferredQuery} onSelect={add} />
          </Suspense>
        ) : (
          <RecentList recents={recents} onRemove={remove} />
        )}
      </div>
    </main>
  );
}

function SearchResults({
  query,
  onSelect,
}: {
  query: string;
  onSelect: (item: RecentItem) => void;
}) {
  const trpc = useTRPC();
  const { data: allItems } = useSuspenseQuery(trpc.items.all.queryOptions());

  const searchIndex = useMemo(() => buildSearchIndex(allItems), [allItems]);
  const results = useMemo(() => searchIndex.search(query), [searchIndex, query]);

  if (results.length === 0) {
    return <p className="text-muted-foreground text-sm">No items found.</p>;
  }

  return (
    <ul className="flex flex-col divide-y">
      {results.map((item) => (
        <li key={item.id}>
          <Link
            to="/item/$itemId"
            params={{ itemId: item.id }}
            onClick={() =>
              onSelect({
                id: item.id,
                name: item.name,
                icon: item.icon,
                labor: null,
              })
            }
            className="hover:bg-muted/50 flex items-center gap-3 rounded-md px-2 py-2 transition-colors"
          >
            <ItemIcon icon={item.icon} name={item.name} size="md" />
            <span className="flex-1 font-medium">{item.name}</span>
            <span className="text-muted-foreground text-xs">
              {item.category}
            </span>
            {item.sellable && <Badge variant="secondary">Sellable</Badge>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length >= 2);
}

function buildSearchIndex<
  T extends {
    id: number;
    name: string;
    category: string;
  },
>(items: T[]) {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const buckets = new Map<string, number[]>();

  const addToBucket = (key: string, itemId: number) => {
    const existing = buckets.get(key);
    if (existing) {
      if (existing[existing.length - 1] !== itemId) {
        existing.push(itemId);
      }
      return;
    }
    buckets.set(key, [itemId]);
  };

  for (const item of items) {
    const tokens = new Set([
      ...tokenize(item.name),
      ...tokenize(item.category),
      item.id.toString(),
    ]);

    for (const token of tokens) {
      const maxPrefixLength = Math.min(token.length, 32);
      for (let length = 2; length <= maxPrefixLength; length += 1) {
        addToBucket(token.slice(0, length), item.id);
      }
    }
  }

  return {
    search(rawQuery: string) {
      const terms = tokenize(rawQuery.trim());
      if (terms.length === 0) return [];

      const candidateBuckets = terms
        .map((term) => buckets.get(term) ?? [])
        .sort((left, right) => left.length - right.length);

      if (candidateBuckets.some((bucket) => bucket.length === 0)) {
        return [];
      }

      const remainingSets = candidateBuckets
        .slice(1)
        .map((bucket) => new Set(bucket));

      const matches: T[] = [];
      for (const itemId of candidateBuckets[0] ?? []) {
        if (remainingSets.every((set) => set.has(itemId))) {
          const item = itemsById.get(itemId);
          if (item) matches.push(item);
        }
        if (matches.length >= 100) break;
      }

      return matches;
    },
  };
}

function RecentList({
  recents,
  onRemove,
}: {
  recents: RecentItem[];
  onRemove: (id: number) => void;
}) {
  if (recents.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">No recent searches yet.</p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
        Recent
      </p>
      <ul className="flex flex-col divide-y">
        {recents.map((item) => (
          <li key={item.id} className="flex items-center gap-3">
            <Link
              to="/item/$itemId"
              params={{ itemId: item.id }}
              className="hover:bg-muted/50 flex flex-1 items-center gap-3 rounded-md px-2 py-2 transition-colors"
            >
              <ItemIcon icon={item.icon} name={item.name} size="md" />
              <span className="flex-1 font-medium">{item.name}</span>
            </Link>
            <button
              onClick={() => onRemove(item.id)}
              className="text-muted-foreground hover:text-foreground px-2 text-sm transition-colors"
              aria-label="Remove"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
