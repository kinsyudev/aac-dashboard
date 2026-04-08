import { Suspense, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { Input } from "@acme/ui/input";

import { useTRPC } from "~/lib/trpc";

export const Route = createFileRoute("/craft/")({
  loader: ({ context }) => {
    const { trpc, queryClient } = context;
    void queryClient.prefetchQuery(
      trpc.items.byName.queryOptions("Sealed Delphinad%"),
    );
  },
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <main className="container py-16">
      <h1 className="mb-6 text-3xl font-bold">Craft</h1>
      <Suspense fallback={<p>Loading items...</p>}>
        <ItemSearch />
      </Suspense>
    </main>
  );
}

function ItemSearch() {
  const trpc = useTRPC();
  const { data: allItems } = useSuspenseQuery(
    trpc.items.byName.queryOptions("Sealed Delphinad%"),
  );

  const [query, setQuery] = useState("");

  const filtered = allItems.filter((item) =>
    item.name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-4">
      <Input
        placeholder="Search Sealed Delphinad items..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="max-w-sm"
      />
      <ul className="flex flex-col gap-1">
        {filtered.map((item) => (
          <li key={item.id}>
            <Link
              to="/craft/$itemId"
              params={{ itemId: item.id }}
              className="hover:text-primary flex cursor-pointer items-center gap-2 text-left"
            >
              {item.icon && (
                <img
                  src={`https://aa-classic.com/game/icons/${item.icon}`}
                  alt={item.name}
                  className="h-8 w-8 shrink-0"
                />
              )}
              <span>{item.name}</span>
              {item.labor != null && (
                <span className="text-muted-foreground ml-auto text-sm">
                  {item.labor} labor
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
