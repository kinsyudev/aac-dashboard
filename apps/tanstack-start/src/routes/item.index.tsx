import { Suspense, useDeferredValue, useMemo, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { Badge } from "@acme/ui/badge";

import type { RecentItem } from "~/lib/recent-searches";
import {
  ItemSearchResultList,
  RecentItemList,
  SearchPageShell,
} from "~/component/item-search";
import { useRecentSearches } from "~/lib/recent-searches";
import { itemsAllQueryOptions } from "~/lib/static-api-client";

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
    void context.queryClient.prefetchQuery(itemsAllQueryOptions());
  },
  component: RouteComponent,
});

function RouteComponent() {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const { recents, add, remove } = useRecentSearches("item:recent-searches");

  return (
    <SearchPageShell
      title="Items"
      query={query}
      onQueryChange={setQuery}
      placeholder="Search all items..."
    >
      {deferredQuery.trim() ? (
        <Suspense
          fallback={<p className="text-muted-foreground text-sm">Loading...</p>}
        >
          <SearchResults query={deferredQuery} onSelect={add} />
        </Suspense>
      ) : (
        <RecentItemList
          recents={recents}
          onRemove={remove}
          renderLink={(item, content) => (
            <Link to="/item/$itemId" params={{ itemId: item.id }}>
              {content}
            </Link>
          )}
        />
      )}
    </SearchPageShell>
  );
}

function SearchResults({
  query,
  onSelect,
}: {
  query: string;
  onSelect: (item: RecentItem) => void;
}) {
  const { data: allItems } = useSuspenseQuery(itemsAllQueryOptions());

  const searchIndex = useMemo(() => buildSearchIndex(allItems), [allItems]);
  const results = useMemo(
    () => searchIndex.search(query),
    [searchIndex, query],
  );

  if (results.length === 0) {
    return <p className="text-muted-foreground text-sm">No items found.</p>;
  }

  return (
    <ItemSearchResultList
      items={results}
      emptyMessage="No items found."
      getMeta={(item) => item.category}
      getBadge={(item) =>
        item.sellable ? <Badge variant="secondary">Sellable</Badge> : null
      }
      renderLink={(item, content) => (
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
        >
          {content}
        </Link>
      )}
    />
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
