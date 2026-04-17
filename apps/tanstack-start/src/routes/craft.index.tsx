import { Suspense, useDeferredValue, useMemo, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";

import { Badge } from "@acme/ui/badge";

import type { RecentItem } from "~/lib/recent-searches";
import {
  ItemSearchResultList,
  RecentItemList,
  SearchPageShell,
} from "~/component/item-search";
import { useRecentSearches } from "~/lib/recent-searches";
import { useTRPC } from "~/lib/trpc";

export const Route = createFileRoute("/craft/")({
  validateSearch: z.object({
    listId: z.string().uuid().optional(),
  }),
  head: () => ({
    meta: [
      { title: "Craft | AAC Dashboard" },
      {
        name: "description",
        content:
          "Search craftable items, inspect recipes, and jump into ArcheAge Classic crafting cost breakdowns.",
      },
    ],
  }),
  loader: ({ context }) => {
    const { trpc, queryClient } = context;
    void queryClient.prefetchQuery(trpc.items.craftable.queryOptions());
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { listId } = Route.useSearch();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const { recents, add, remove } = useRecentSearches();

  return (
    <SearchPageShell
      title="Craft"
      query={query}
      onQueryChange={setQuery}
      placeholder="Search craftable items..."
    >
      {deferredQuery.trim() ? (
        <Suspense
          fallback={<p className="text-muted-foreground text-sm">Loading...</p>}
        >
          <SearchResults query={deferredQuery} onSelect={add} listId={listId} />
        </Suspense>
      ) : (
        <RecentItemList
          recents={recents}
          onRemove={remove}
          renderLink={(item, content) => (
            <Link
              to="/craft/$itemId"
              params={{ itemId: item.id }}
              search={{ listId }}
            >
              {content}
            </Link>
          )}
          getBadge={(item) =>
            item.labor != null && item.labor > 0 ? (
              <Badge variant="secondary">{item.labor} labor</Badge>
            ) : null
          }
        />
      )}
    </SearchPageShell>
  );
}

function SearchResults({
  query,
  onSelect,
  listId,
}: {
  query: string;
  onSelect: (item: RecentItem) => void;
  listId?: string;
}) {
  const trpc = useTRPC();
  const { data: allItems } = useSuspenseQuery(
    trpc.items.craftable.queryOptions(),
  );

  const results = useMemo(() => {
    const q = query.toLowerCase();
    return allItems.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q),
    );
  }, [allItems, query]);

  if (results.length === 0) {
    return <p className="text-muted-foreground text-sm">No items found.</p>;
  }

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
        <Link
          to="/craft/$itemId"
          params={{ itemId: item.id }}
          search={{ listId }}
          onClick={() =>
            onSelect({
              id: item.id,
              name: item.name,
              icon: item.icon,
              labor: item.labor,
            })
          }
        >
          {content}
        </Link>
      )}
    />
  );
}
