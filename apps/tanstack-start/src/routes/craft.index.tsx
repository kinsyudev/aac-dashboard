import { Suspense, useDeferredValue, useMemo, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { Badge } from "@acme/ui/badge";
import { Input } from "@acme/ui/input";

import { useTRPC } from "~/lib/trpc";
import { useRecentSearches, type RecentItem } from "~/lib/recent-searches";

export const Route = createFileRoute("/craft/")({
  loader: ({ context }) => {
    const { trpc, queryClient } = context;
    void queryClient.prefetchQuery(trpc.items.craftable.queryOptions());
  },
  component: RouteComponent,
});

function RouteComponent() {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const { recents, add, remove } = useRecentSearches();

  return (
    <main className="container py-16">
      <h1 className="mb-6 text-3xl font-bold">Craft</h1>
      <div className="flex flex-col gap-4">
        <Input
          placeholder="Search craftable items..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-sm"
        />
        {deferredQuery.trim() ? (
          <Suspense fallback={<p className="text-muted-foreground text-sm">Loading...</p>}>
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
  const { data: allItems } = useSuspenseQuery(trpc.items.craftable.queryOptions());

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
    <ul className="flex flex-col divide-y">
      {results.map((item) => (
        <li key={item.id}>
          <Link
            to="/craft/$itemId"
            params={{ itemId: item.id }}
            onClick={() =>
              onSelect({
                id: item.id,
                name: item.name,
                icon: item.icon,
                labor: item.labor,
              })
            }
            className="hover:bg-muted/50 flex items-center gap-3 rounded-md px-2 py-2 transition-colors"
          >
            {item.icon ? (
              <img
                src={`https://aa-classic.com/game/icons/${item.icon}`}
                alt={item.name}
                className="h-8 w-8 shrink-0"
              />
            ) : (
              <div className="bg-muted h-8 w-8 shrink-0 rounded" />
            )}
            <span className="flex-1 font-medium">{item.name}</span>
            <span className="text-muted-foreground text-xs">{item.category}</span>
            {item.labor != null && item.labor > 0 && (
              <Badge variant="secondary">{item.labor} labor</Badge>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
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
      <p className="text-muted-foreground text-xs font-semibold uppercase tracking-widest">
        Recent
      </p>
      <ul className="flex flex-col divide-y">
        {recents.map((item) => (
          <li key={item.id} className="flex items-center gap-3">
            <Link
              to="/craft/$itemId"
              params={{ itemId: item.id }}
              className="hover:bg-muted/50 flex flex-1 items-center gap-3 rounded-md px-2 py-2 transition-colors"
            >
              {item.icon ? (
                <img
                  src={`https://aa-classic.com/game/icons/${item.icon}`}
                  alt={item.name}
                  className="h-8 w-8 shrink-0"
                />
              ) : (
                <div className="bg-muted h-8 w-8 shrink-0 rounded" />
              )}
              <span className="flex-1 font-medium">{item.name}</span>
              {item.labor != null && item.labor > 0 && (
                <Badge variant="secondary">{item.labor} labor</Badge>
              )}
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
