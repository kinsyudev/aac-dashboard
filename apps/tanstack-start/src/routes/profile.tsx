import { Suspense, useRef, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import type { Proficiency } from "@acme/db/schema";
import { Button } from "@acme/ui/button";
import { Input } from "@acme/ui/input";
import { toast } from "@acme/ui/toast";

import { ItemIcon } from "~/component/item-icon";
import { ProficiencyBadge } from "~/component/proficiency";
import { getRank, PROFICIENCY_CATEGORIES } from "~/lib/proficiency";
import { useTRPC } from "~/lib/trpc";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Profile | AAC Dashboard" },
      {
        name: "description",
        content:
          "Manage proficiencies and item price overrides used across your crafting and shopping tools.",
      },
    ],
  }),
  loader: ({ context }) => {
    const { trpc, queryClient } = context;
    void queryClient.prefetchQuery(
      trpc.profile.getPriceOverrides.queryOptions(),
    );
    void queryClient.prefetchQuery(
      trpc.profile.getProficiencies.queryOptions(),
    );
  },
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <main className="container py-16">
      <h1 className="mb-8 text-3xl font-bold">Profile</h1>
      <section className="mb-12">
        <h2 className="mb-4 text-xl font-semibold">Proficiencies</h2>
        <p className="text-muted-foreground mb-6 text-sm">
          Set your proficiency levels to calculate accurate labor costs for
          crafting.
        </p>
        <Suspense fallback={<p>Loading...</p>}>
          <ProficiencyEditor />
        </Suspense>
      </section>
      <section>
        <h2 className="mb-4 text-xl font-semibold">Price Overrides</h2>
        <p className="text-muted-foreground mb-6 text-sm">
          Set custom prices for crafting materials. These will be used instead
          of market prices when calculating craft costs.
        </p>
        <Suspense fallback={<p>Loading...</p>}>
          <PriceOverrides />
        </Suspense>
      </section>
    </main>
  );
}

function formatDiff(custom: number, market: number) {
  if (market <= 0) return null;
  const diff = custom - market;
  const pct = (diff / market) * 100;
  const sign = diff >= 0 ? "+" : "";
  return {
    gold: `${sign}${diff.toLocaleString(undefined, { maximumFractionDigits: 2 })}g`,
    pct: `${sign}${pct.toFixed(1)}%`,
    positive: diff <= 0,
  };
}

function AddOverrideForm({ onAdded }: { onAdded: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<{
    id: number;
    name: string;
    icon: string | null;
  } | null>(null);
  const [price, setPrice] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { data: searchResults } = useQuery({
    ...trpc.items.search.queryOptions(search),
    enabled: search.length >= 2,
  });

  const setOverride = useMutation(
    trpc.profile.setPriceOverride.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(
          trpc.profile.getPriceOverrides.pathFilter(),
        );
        setSelected(null);
        setSearch("");
        setPrice("");
        onAdded();
        toast.success("Price override saved.");
      },
      onError: () => toast.error("Failed to save override."),
    }),
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    const parsed = parseFloat(price);
    if (!parsed || parsed <= 0) return;
    setOverride.mutate({ itemId: selected.id, price: parsed });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end"
    >
      <div className="relative flex-1">
        <label className="text-muted-foreground mb-1 block text-xs">Item</label>
        {selected ? (
          <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
            {selected.icon && (
              <ItemIcon icon={selected.icon} name={selected.name} />
            )}
            <span className="flex-1">{selected.name}</span>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              ×
            </button>
          </div>
        ) : (
          <div className="relative" ref={dropdownRef}>
            <Input
              placeholder="Search items..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setShowDropdown(true);
              }}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
            />
            {showDropdown && searchResults && searchResults.length > 0 && (
              <div className="bg-popover absolute z-10 mt-1 w-full rounded-md border shadow-md">
                {searchResults.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="hover:bg-accent flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
                    onMouseDown={() => {
                      setSelected(item);
                      setSearch("");
                      setShowDropdown(false);
                    }}
                  >
                    {item.icon && (
                      <ItemIcon icon={item.icon} name={item.name} />
                    )}
                    {item.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="w-40">
        <label className="text-muted-foreground mb-1 block text-xs">
          Custom price (g)
        </label>
        <Input
          type="number"
          min="0"
          step="0.01"
          placeholder="e.g. 1.5"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </div>
      <Button
        type="submit"
        disabled={!selected || !price || setOverride.isPending}
      >
        Save
      </Button>
    </form>
  );
}

function PriceOverrides() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: overrides } = useSuspenseQuery(
    trpc.profile.getPriceOverrides.queryOptions(),
  );

  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const setOverride = useMutation(
    trpc.profile.setPriceOverride.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(
          trpc.profile.getPriceOverrides.pathFilter(),
        );
        setEditingItemId(null);
        toast.success("Price override saved.");
      },
      onError: () => toast.error("Failed to save override."),
    }),
  );

  const deleteOverride = useMutation(
    trpc.profile.deletePriceOverride.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(
          trpc.profile.getPriceOverrides.pathFilter(),
        );
        toast.success("Override removed.");
      },
      onError: () => toast.error("Failed to remove override."),
    }),
  );

  const startEdit = (itemId: number, currentPrice: string) => {
    setEditingItemId(itemId);
    setEditPrice(parseFloat(currentPrice).toString());
  };

  const saveEdit = (itemId: number) => {
    const parsed = parseFloat(editPrice);
    if (!parsed || parsed <= 0) return;
    setOverride.mutate({ itemId, price: parsed });
  };

  return (
    <div>
      {showAdd ? (
        <AddOverrideForm onAdded={() => setShowAdd(false)} />
      ) : (
        <Button
          variant="outline"
          className="mb-6"
          onClick={() => setShowAdd(true)}
        >
          + Add Override
        </Button>
      )}

      {overrides.length === 0 ? (
        <p className="text-muted-foreground text-sm">No price overrides set.</p>
      ) : (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-muted-foreground px-4 py-3 text-left font-medium">
                  Item
                </th>
                <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                  Custom Price
                </th>
                <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                  vs 24h Avg
                </th>
                <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                  vs 7d Avg
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {overrides.map((o) => {
                const custom = parseFloat(o.price);
                const avg24h = parseFloat(o.marketPrice?.avg24h ?? "0");
                const avg7d = parseFloat(o.marketPrice?.avg7d ?? "0");
                const diff24h = formatDiff(custom, avg24h);
                const diff7d = formatDiff(custom, avg7d);
                const isEditing = editingItemId === o.itemId;

                return (
                  <tr key={o.itemId} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <ItemIcon
                          icon={o.itemIcon ?? null}
                          name={o.itemName}
                          size="md"
                        />
                        <span className="font-medium">{o.itemName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-2">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={editPrice}
                            onChange={(e) => setEditPrice(e.target.value)}
                            className="w-28 text-right"
                            autoFocus
                          />
                          <Button
                            size="sm"
                            onClick={() => saveEdit(o.itemId)}
                            disabled={setOverride.isPending}
                          >
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingItemId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <span className="font-medium">
                          {custom.toLocaleString(undefined, {
                            maximumFractionDigits: 2,
                          })}
                          g
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {diff24h ? (
                        <div className="flex flex-col items-end">
                          <span
                            className={
                              diff24h.positive
                                ? "text-green-600"
                                : "text-red-500"
                            }
                          >
                            {diff24h.gold}
                            <span
                              className={`ml-1 text-xs ${diff24h.positive ? "text-green-800" : "text-red-800"}`}
                            >
                              ({diff24h.pct})
                            </span>
                          </span>
                          <span className="text-muted-foreground text-xs">
                            avg{" "}
                            {avg24h.toLocaleString(undefined, {
                              maximumFractionDigits: 2,
                            })}
                            g
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {diff7d ? (
                        <div className="flex flex-col items-end">
                          <span
                            className={
                              diff7d.positive
                                ? "text-green-600"
                                : "text-red-500"
                            }
                          >
                            {diff7d.gold}
                            <span
                              className={`ml-1 text-xs ${diff7d.positive ? "text-green-800" : "text-red-800"}`}
                            >
                              ({diff7d.pct})
                            </span>
                          </span>
                          <span className="text-muted-foreground text-xs">
                            avg{" "}
                            {avg7d.toLocaleString(undefined, {
                              maximumFractionDigits: 2,
                            })}
                            g
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {!isEditing && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => startEdit(o.itemId, o.price)}
                          >
                            Edit
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => deleteOverride.mutate(o.itemId)}
                          disabled={deleteOverride.isPending}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ProficiencyEditor() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: saved } = useSuspenseQuery(
    trpc.profile.getProficiencies.queryOptions(),
  );

  const savedMap = new Map(saved.map((p) => [p.proficiency, p.value]));
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const queryOptions = trpc.profile.getProficiencies.queryOptions();

  const setProficiency = useMutation(
    trpc.profile.setProficiency.mutationOptions({
      onMutate: async ({ proficiency, value }) => {
        await queryClient.cancelQueries(queryOptions);
        const previous = queryClient.getQueryData(queryOptions.queryKey);
        queryClient.setQueryData(queryOptions.queryKey, (old) => {
          if (!old) return [];
          const existing = old.find((p) => p.proficiency === proficiency);
          if (existing) {
            return old.map((p) =>
              p.proficiency === proficiency ? { ...p, value } : p,
            );
          }
          return [...old, { proficiency, value, updatedAt: new Date() }];
        });
        return { previous };
      },
      onError: (_err, _vars, ctx) => {
        if (ctx?.previous) {
          queryClient.setQueryData(queryOptions.queryKey, ctx.previous);
        }
        toast.error("Failed to save proficiency.");
      },
      onSuccess: () => toast.success("Proficiency saved."),
      onSettled: () => queryClient.invalidateQueries(queryOptions),
    }),
  );

  const handleBlur = (proficiency: Proficiency) => {
    const raw = drafts[proficiency];
    if (raw === undefined) return;
    const parsed = parseInt(raw, 10);
    if (isNaN(parsed) || parsed < 0) return;
    const clamped = Math.min(parsed, 300000);
    setProficiency.mutate({ proficiency, value: clamped });
    setDrafts((d) => {
      const next = { ...d };
      delete next[proficiency];
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {PROFICIENCY_CATEGORIES.map(({ label, proficiencies }) => (
        <div key={label}>
          <h3 className="text-muted-foreground mb-3 text-sm font-medium tracking-wide uppercase">
            {label}
          </h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {proficiencies.map((prof) => {
              const savedVal = savedMap.get(prof) ?? 0;
              const displayVal = drafts[prof] ?? savedVal.toString();
              const rank = getRank(
                drafts[prof] !== undefined
                  ? parseInt(drafts[prof], 10)
                  : savedVal,
              );

              return (
                <div
                  key={prof}
                  className="flex items-center gap-3 rounded-md border px-3 py-2"
                >
                  <ProficiencyBadge proficiency={prof} showIcon />
                  <div className="ml-auto flex items-center gap-2">
                    {rank ? (
                      <span className="text-muted-foreground text-xs">
                        {rank.name} ({rank.laborReduction}% off)
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                    <Input
                      type="number"
                      min="0"
                      max="300000"
                      step="1000"
                      className="w-28 text-right"
                      value={displayVal}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [prof]: e.target.value }))
                      }
                      onBlur={() => handleBlur(prof)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.currentTarget.blur();
                        }
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
