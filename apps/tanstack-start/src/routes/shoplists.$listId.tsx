import { useMemo, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";

import { Button } from "@acme/ui/button";
import { Input } from "@acme/ui/input";
import { toast } from "@acme/ui/toast";

import { ItemIcon } from "~/component/item-icon";
import { useTRPC } from "~/lib/trpc";
import { useUserData } from "~/lib/useUserData";

export const Route = createFileRoute("/shoplists/$listId")({
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      context.trpc.shoppingLists.getById.queryOptions(params.listId),
    );
  },
  component: ShoppingListDetailPage,
});

const COIN_ITEM_ID = 500;

function coerceFiniteNumber(value: number | string | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  const parsed = Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function isCoinItem(item: { itemId: number; item: { name: string } }) {
  return item.itemId === COIN_ITEM_ID || item.item.name === "Coin";
}

function formatCoinValue(value: number) {
  const copper = Math.max(0, Math.round(value));
  const gold = Math.floor(copper / 10000);
  const silver = Math.floor((copper % 10000) / 100);
  const remainingCopper = copper % 100;

  return `${gold.toLocaleString()}g ${silver}s ${remainingCopper}c`;
}

function formatGoldInput(value: number) {
  const goldValue = Math.max(0, value) / 10000;
  return goldValue.toFixed(4).replace(/\.?0+$/, "");
}

function parseGoldInput(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed * 10000));
}

function ShoppingListDetailPage() {
  const { listId } = Route.useParams();
  const trpc = useTRPC();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const listQueryOptions = trpc.shoppingLists.getById.queryOptions(listId);
  const { data } = useSuspenseQuery(listQueryOptions);
  const { overrideMap } = useUserData();

  const [name, setName] = useState(data.list.name);
  const [quantity, setQuantity] = useState(String(data.list.sourceQuantity));
  const [syncedName, setSyncedName] = useState(data.list.name);
  const [syncedQuantity, setSyncedQuantity] = useState(
    data.list.sourceQuantity,
  );
  if (
    syncedName !== data.list.name ||
    syncedQuantity !== data.list.sourceQuantity
  ) {
    setSyncedName(data.list.name);
    setSyncedQuantity(data.list.sourceQuantity);
    setName(data.list.name);
    setQuantity(String(data.list.sourceQuantity));
  }
  const [itemDrafts, setItemDrafts] = useState<Record<number, string>>({});
  const [craftDrafts, setCraftDrafts] = useState<Record<number, string>>({});
  const inviteBase =
    typeof window === "undefined" ? "" : window.location.origin;
  const itemIds = useMemo(
    () => data.items.map((item) => item.itemId),
    [data.items],
  );
  const { data: prices = [] } = useQuery({
    ...trpc.items.pricesBatch.queryOptions(itemIds),
    enabled: itemIds.length > 0,
  });

  const priceMap = useMemo(
    () => new Map(prices.map((price) => [price.itemId, price])),
    [prices],
  );
  const coinRow = useMemo(
    () => data.items.find((item) => isCoinItem(item)) ?? null,
    [data.items],
  );
  const materialItems = useMemo(
    () => data.items.filter((item) => !isCoinItem(item)),
    [data.items],
  );

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries(listQueryOptions),
      queryClient.invalidateQueries(
        trpc.shoppingLists.listMineAndShared.pathFilter(),
      ),
    ]);
  };

  const updateDefinition = useMutation(
    trpc.shoppingLists.updateDefinition.mutationOptions({
      onSuccess: async () => {
        await invalidate();
        toast.success("Shopping list updated.");
      },
      onError: () => toast.error("Failed to update shopping list."),
    }),
  );

  const updateItemProgress = useMutation(
    trpc.shoppingLists.updateItemProgress.mutationOptions({
      onMutate: async ({ itemId, obtainedQuantity }) => {
        await queryClient.cancelQueries(listQueryOptions);
        const previous = queryClient.getQueryData(listQueryOptions.queryKey);
        queryClient.setQueryData(listQueryOptions.queryKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((item) =>
              item.itemId === itemId
                ? {
                    ...item,
                    obtainedQuantity: Math.min(
                      item.requiredQuantity,
                      obtainedQuantity,
                    ),
                  }
                : item,
            ),
          };
        });
        return { previous };
      },
      onError: (_error, _variables, context) => {
        if (context?.previous) {
          queryClient.setQueryData(listQueryOptions.queryKey, context.previous);
        }
        toast.error("Failed to update item progress.");
      },
      onSettled: invalidate,
    }),
  );

  const updateCraftProgress = useMutation(
    trpc.shoppingLists.updateCraftProgress.mutationOptions({
      onMutate: async ({ craftId, completedCount }) => {
        await queryClient.cancelQueries(listQueryOptions);
        const previous = queryClient.getQueryData(listQueryOptions.queryKey);
        queryClient.setQueryData(listQueryOptions.queryKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            crafts: old.crafts.map((craft) =>
              craft.craftId === craftId
                ? {
                    ...craft,
                    completedCount: Math.min(
                      craft.requiredCount,
                      completedCount,
                    ),
                  }
                : craft,
            ),
          };
        });
        return { previous };
      },
      onError: (_error, _variables, context) => {
        if (context?.previous) {
          queryClient.setQueryData(listQueryOptions.queryKey, context.previous);
        }
        toast.error("Failed to update craft progress.");
      },
      onSettled: invalidate,
    }),
  );

  const createInvite = useMutation(
    trpc.shoppingLists.createInvite.mutationOptions({
      onSuccess: async (invite) => {
        await invalidate();
        await navigator.clipboard.writeText(`${inviteBase}${invite.inviteUrl}`);
        toast.success("Invite created and copied.");
      },
      onError: () => toast.error("Failed to create invite."),
    }),
  );

  const revokeInvite = useMutation(
    trpc.shoppingLists.revokeInvite.mutationOptions({
      onSuccess: async () => {
        await invalidate();
        toast.success("Invite revoked.");
      },
      onError: () => toast.error("Failed to revoke invite."),
    }),
  );

  const removeMember = useMutation(
    trpc.shoppingLists.removeMember.mutationOptions({
      onSuccess: async () => {
        await invalidate();
        toast.success("Member removed.");
      },
      onError: () => toast.error("Failed to remove member."),
    }),
  );

  const duplicate = useMutation(
    trpc.shoppingLists.duplicate.mutationOptions({
      onSuccess: async (result) => {
        await invalidate();
        toast.success("Shopping list duplicated.");
        await navigate({
          to: "/shoplists/$listId",
          params: { listId: result.id },
        });
      },
      onError: () => toast.error("Failed to duplicate shopping list."),
    }),
  );

  const deleteList = useMutation(
    trpc.shoppingLists.delete.mutationOptions({
      onSuccess: async () => {
        await invalidate();
        toast.success("Shopping list deleted.");
        await navigate({ to: "/shoplists" });
      },
      onError: () => toast.error("Failed to delete shopping list."),
    }),
  );

  const handleDelete = () => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Delete "${data.list.name}"? This cannot be undone.`,
      );
      if (!confirmed) return;
    }
    deleteList.mutate({ listId });
  };

  const completion = useMemo(() => {
    const requiredItems = materialItems.reduce(
      (sum, item) => sum + item.requiredQuantity,
      0,
    );
    const obtainedItems = materialItems.reduce(
      (sum, item) => sum + item.obtainedQuantity,
      0,
    );
    const requiredCrafts = data.crafts.reduce(
      (sum, craft) => sum + craft.requiredCount,
      0,
    );
    const completedCrafts = data.crafts.reduce(
      (sum, craft) => sum + craft.completedCount,
      0,
    );
    return {
      obtainedItems,
      requiredItems,
      completedCrafts,
      requiredCrafts,
      itemPct:
        requiredItems === 0
          ? 0
          : Math.round((obtainedItems / requiredItems) * 100),
      craftPct:
        requiredCrafts === 0
          ? 0
          : Math.round((completedCrafts / requiredCrafts) * 100),
    };
  }, [data.crafts, materialItems]);

  const coinCompletion = useMemo(() => {
    if (!coinRow) return null;
    const required = coinRow.requiredQuantity;
    const obtained = coinRow.obtainedQuantity;
    return {
      required,
      obtained,
      percent: required === 0 ? 0 : Math.round((obtained / required) * 100),
    };
  }, [coinRow]);

  const outstandingBuyCost = useMemo(
    () =>
      materialItems.reduce((sum, itemRow) => {
        const remainingQuantity = Math.max(
          0,
          itemRow.requiredQuantity - itemRow.obtainedQuantity,
        );
        const override = overrideMap.get(itemRow.itemId);
        const market = priceMap.get(itemRow.itemId);
        const unitPrice =
          override != null
            ? coerceFiniteNumber(override)
            : coerceFiniteNumber(market?.avg24h ?? market?.avg7d);
        return sum + remainingQuantity * unitPrice;
      }, 0),
    [materialItems, overrideMap, priceMap],
  );

  const sortedItems = useMemo(
    () =>
      [...materialItems].sort((left, right) => {
        const leftRemaining = Math.max(
          0,
          left.requiredQuantity - left.obtainedQuantity,
        );
        const rightRemaining = Math.max(
          0,
          right.requiredQuantity - right.obtainedQuantity,
        );
        const leftOverride = overrideMap.get(left.itemId);
        const rightOverride = overrideMap.get(right.itemId);
        const leftUnitPrice =
          leftOverride != null
            ? coerceFiniteNumber(leftOverride)
            : coerceFiniteNumber(
                priceMap.get(left.itemId)?.avg24h ??
                  priceMap.get(left.itemId)?.avg7d,
              );
        const rightUnitPrice =
          rightOverride != null
            ? coerceFiniteNumber(rightOverride)
            : coerceFiniteNumber(
                priceMap.get(right.itemId)?.avg24h ??
                  priceMap.get(right.itemId)?.avg7d,
              );
        const costDelta =
          rightRemaining * rightUnitPrice - leftRemaining * leftUnitPrice;
        return costDelta !== 0
          ? costDelta
          : left.item.name.localeCompare(right.item.name);
      }),
    [materialItems, overrideMap, priceMap],
  );

  const commitItemProgress = (itemId: number, requiredQuantity: number) => {
    const raw = itemDrafts[itemId];
    if (raw === undefined) return;
    const item = data.items.find((entry) => entry.itemId === itemId);
    const parsed =
      item && isCoinItem(item) ? parseGoldInput(raw) : Number(raw);
    const obtainedQuantity = Math.min(
      requiredQuantity,
      Math.max(0, Number.isFinite(parsed) ? parsed : 0),
    );
    const current = item;
    setItemDrafts((drafts) => {
      const next = { ...drafts };
      delete next[itemId];
      return next;
    });
    if (!current || current.obtainedQuantity === obtainedQuantity) return;
    updateItemProgress.mutate({ listId, itemId, obtainedQuantity });
  };

  const resetItemDraft = (itemId: number) => {
    setItemDrafts((drafts) => {
      if (!(itemId in drafts)) return drafts;
      const next = { ...drafts };
      delete next[itemId];
      return next;
    });
  };

  const commitCraftProgress = (craftId: number, requiredCount: number) => {
    const raw = craftDrafts[craftId];
    if (raw === undefined) return;
    const parsed = Number(raw);
    const completedCount = Math.min(
      requiredCount,
      Math.max(0, Number.isFinite(parsed) ? parsed : 0),
    );
    const current = data.crafts.find((craft) => craft.craftId === craftId);
    setCraftDrafts((drafts) => {
      const next = { ...drafts };
      delete next[craftId];
      return next;
    });
    if (!current || current.completedCount === completedCount) return;
    updateCraftProgress.mutate({ listId, craftId, completedCount });
  };

  const resetCraftDraft = (craftId: number) => {
    setCraftDrafts((drafts) => {
      if (!(craftId in drafts)) return drafts;
      const next = { ...drafts };
      delete next[craftId];
      return next;
    });
  };

  return (
    <main className="container py-16">
      <div className="flex flex-col gap-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Link
              to="/shoplists"
              className="text-muted-foreground text-sm hover:underline"
            >
              ← Back to lists
            </Link>
            <h1 className="mt-3 text-3xl font-bold">{data.list.name}</h1>
            <p className="text-muted-foreground mt-2 text-sm">
              Owned by {data.owner.name} •{" "}
              {data.role === "owner" ? "owner" : data.role}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => duplicate.mutate({ listId, mode: "fresh" })}
            >
              Duplicate fresh
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => duplicate.mutate({ listId, mode: "copyState" })}
            >
              Duplicate with progress
            </Button>
            {data.isOwner ? (
              <Button
                size="sm"
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteList.isPending}
              >
                Delete
              </Button>
            ) : null}
            <Button asChild size="sm">
              <Link
                to="/shoplist"
                search={{
                  craft: data.list.sourceCraftId,
                  simItem:
                    data.list.sourceType === "simulator"
                      ? (data.list.sourceItemId ?? undefined)
                      : undefined,
                  qty:
                    data.list.sourceType === "craft"
                      ? data.list.sourceQuantity
                      : 1,
                  attempts:
                    data.list.sourceType === "simulator"
                      ? data.list.sourceQuantity
                      : undefined,
                  sub: data.list.craftModeItemIds.join(",") || undefined,
                  listId,
                }}
              >
                Edit definition
              </Link>
            </Button>
          </div>
        </div>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border p-5">
            <h2 className="text-lg font-semibold">Definition</h2>
            <p className="text-muted-foreground mt-2 text-sm">
              Writers can rename the list and change the top-level{" "}
              {data.list.sourceType === "simulator"
                ? "attempt count"
                : "craft quantity"}
              . Use the editor to adjust craft selections.
            </p>
            <div className="mt-4 flex flex-col gap-3">
              <label className="text-sm">
                <span className="mb-1 block font-medium">Name</span>
                <Input
                  value={name}
                  disabled={!data.canWrite}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">
                  {data.list.sourceType === "simulator"
                    ? "Expected attempts"
                    : "Craft quantity"}
                </span>
                <Input
                  type="number"
                  min="1"
                  disabled={!data.canWrite}
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={!data.canWrite}
                  onClick={() =>
                    updateDefinition.mutate({
                      listId,
                      name: name.trim(),
                      quantity: Math.max(1, Number(quantity) || 1),
                    })
                  }
                >
                  Save changes
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-xl border p-5">
            <h2 className="text-lg font-semibold">Progress</h2>
            <div className="mt-4 flex flex-col gap-4">
              <ProgressMeter
                label="Items obtained"
                percent={completion.itemPct}
                summary={`${completion.obtainedItems.toLocaleString()} / ${completion.requiredItems.toLocaleString()}`}
              />
              <ProgressMeter
                label="Crafts completed"
                percent={completion.craftPct}
                summary={`${completion.completedCrafts.toLocaleString()} / ${completion.requiredCrafts.toLocaleString()}`}
              />
              <p className="text-muted-foreground text-sm">
                Invited writers can update both counters.
              </p>
              {coinRow ? (
                <div className="rounded-lg border px-4 py-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <ProgressMeter
                        label="Coins"
                        percent={coinCompletion?.percent ?? 0}
                        summary={`${formatCoinValue(
                          coinCompletion?.obtained ?? 0,
                        )} / ${formatCoinValue(
                          coinCompletion?.required ?? 0,
                        )}`}
                      />
                    </div>
                    <Input
                      type="number"
                      min="0"
                      max={formatGoldInput(coinRow.requiredQuantity)}
                      step="0.0001"
                      disabled={!data.canWrite}
                      className="w-32"
                      value={
                        itemDrafts[coinRow.itemId] ??
                        formatGoldInput(coinRow.obtainedQuantity)
                      }
                      onChange={(event) =>
                        setItemDrafts((drafts) => ({
                          ...drafts,
                          [coinRow.itemId]: event.target.value,
                        }))
                      }
                      onBlur={() =>
                        commitItemProgress(
                          coinRow.itemId,
                          coinRow.requiredQuantity,
                        )
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.currentTarget.blur();
                        }
                        if (event.key === "Escape") {
                          resetItemDraft(coinRow.itemId);
                          event.currentTarget.blur();
                        }
                      }}
                    />
                  </div>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Remaining{" "}
                    {formatCoinValue(
                      coinRow.requiredQuantity - coinRow.obtainedQuantity,
                    )}
                  </p>
                  <p className="text-muted-foreground mt-3 text-xs">
                    Input is in gold. `1` = `1g`, `0.01` = `1s`, `0.0001` = `1c`.
                  </p>
                </div>
              ) : null}
              <div className="rounded-lg border px-4 py-3">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">
                  Buy remaining
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {outstandingBuyCost.toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })}
                  g
                </p>
                <p className="text-muted-foreground mt-1 text-sm">
                  Based on your profile overrides first, then latest market
                  prices.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <div className="rounded-xl border p-5">
            <h2 className="text-lg font-semibold">Shopping Items</h2>
            <div className="mt-4 flex flex-col gap-2">
              {sortedItems.map((itemRow) => (
                <div
                  key={itemRow.itemId}
                  className="flex items-center justify-between gap-4 rounded-lg border px-3 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <ItemIcon
                      icon={itemRow.item.icon}
                      name={itemRow.item.name}
                      size="md"
                    />
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {itemRow.item.name}
                      </p>
                      <p className="text-muted-foreground text-sm">
                        {itemRow.obtainedQuantity} / {itemRow.requiredQuantity}
                      </p>
                      <ItemCost
                        itemId={itemRow.itemId}
                        requiredQuantity={itemRow.requiredQuantity}
                        obtainedQuantity={itemRow.obtainedQuantity}
                        overrideMap={overrideMap}
                        priceMap={priceMap}
                      />
                    </div>
                  </div>
                  <Input
                    type="number"
                    min="0"
                    max={String(itemRow.requiredQuantity)}
                    disabled={!data.canWrite}
                    className="w-28"
                    value={
                      itemDrafts[itemRow.itemId] ??
                      String(itemRow.obtainedQuantity)
                    }
                    onChange={(event) =>
                      setItemDrafts((drafts) => ({
                        ...drafts,
                        [itemRow.itemId]: event.target.value,
                      }))
                    }
                    onBlur={() =>
                      commitItemProgress(
                        itemRow.itemId,
                        itemRow.requiredQuantity,
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      }
                      if (event.key === "Escape") {
                        resetItemDraft(itemRow.itemId);
                        event.currentTarget.blur();
                      }
                    }}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-xl border p-5">
              <h2 className="text-lg font-semibold">Craft Progress</h2>
              <div className="mt-4 flex flex-col gap-2">
                {data.crafts.map((craftRow) => (
                  <div
                    key={craftRow.craftId}
                    className="flex items-center justify-between gap-4 rounded-lg border px-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {craftRow.craft.name}
                      </p>
                      <p className="text-muted-foreground text-sm">
                        {craftRow.completedCount} / {craftRow.requiredCount}
                      </p>
                    </div>
                    <Input
                      type="number"
                      min="0"
                      max={String(craftRow.requiredCount)}
                      disabled={!data.canWrite}
                      className="w-28"
                      value={
                        craftDrafts[craftRow.craftId] ??
                        String(craftRow.completedCount)
                      }
                      onChange={(event) =>
                        setCraftDrafts((drafts) => ({
                          ...drafts,
                          [craftRow.craftId]: event.target.value,
                        }))
                      }
                      onBlur={() =>
                        commitCraftProgress(
                          craftRow.craftId,
                          craftRow.requiredCount,
                        )
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.currentTarget.blur();
                        }
                        if (event.key === "Escape") {
                          resetCraftDraft(craftRow.craftId);
                          event.currentTarget.blur();
                        }
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border p-5">
              <h2 className="text-lg font-semibold">People</h2>
              <div className="mt-4 flex flex-col gap-3">
                <MemberRow
                  name={data.owner.name}
                  image={data.owner.image}
                  subtitle="Owner"
                />
                {data.members.map((member) => (
                  <div
                    key={member.userId}
                    className="flex items-center justify-between gap-3 rounded-lg border px-3 py-3"
                  >
                    <MemberRow
                      name={member.user.name}
                      image={member.user.image}
                      subtitle={member.role}
                    />
                    {data.isOwner ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          removeMember.mutate({ listId, userId: member.userId })
                        }
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            {data.isOwner ? (
              <div className="rounded-xl border p-5">
                <h2 className="text-lg font-semibold">Invites</h2>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      createInvite.mutate({ listId, role: "read" })
                    }
                  >
                    Create read invite
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      createInvite.mutate({ listId, role: "write" })
                    }
                  >
                    Create write invite
                  </Button>
                </div>
                <div className="mt-4 flex flex-col gap-2">
                  {data.invites.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      No invite links created yet.
                    </p>
                  ) : (
                    data.invites.map((invite) => (
                      <div
                        key={invite.id}
                        className="flex flex-col gap-2 rounded-lg border px-3 py-3 text-sm"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-medium">{invite.role} invite</p>
                            <p className="text-muted-foreground">
                              {invite.consumedAt
                                ? "Accepted"
                                : invite.revokedAt
                                  ? "Revoked"
                                  : "Pending"}
                            </p>
                          </div>
                          {!invite.consumedAt && !invite.revokedAt ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                revokeInvite.mutate({
                                  listId,
                                  inviteId: invite.id,
                                })
                              }
                            >
                              Revoke
                            </Button>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              navigator.clipboard.writeText(
                                `${inviteBase}${invite.inviteUrl}`,
                              )
                            }
                          >
                            Copy link
                          </Button>
                          <code className="bg-muted rounded px-2 py-1 text-xs">
                            {invite.inviteUrl}
                          </code>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}

function ItemCost({
  itemId,
  requiredQuantity,
  obtainedQuantity,
  overrideMap,
  priceMap,
}: {
  itemId: number;
  requiredQuantity: number;
  obtainedQuantity: number;
  overrideMap: Map<number, number>;
  priceMap: Map<number, { avg24h: string | null; avg7d: string | null }>;
}) {
  const remainingQuantity = Math.max(0, requiredQuantity - obtainedQuantity);
  const override = overrideMap.get(itemId);
  const market = priceMap.get(itemId);
  const unitPrice =
    override != null
      ? coerceFiniteNumber(override)
      : coerceFiniteNumber(market?.avg24h ?? market?.avg7d);

  if (unitPrice <= 0) {
    return (
      <p className="text-muted-foreground text-xs">
        No price data for remaining materials.
      </p>
    );
  }

  const lineCost = remainingQuantity * unitPrice;

  return (
    <p className="text-muted-foreground text-xs tabular-nums">
      {remainingQuantity.toLocaleString()} remaining •{" "}
      {lineCost.toLocaleString(undefined, {
        maximumFractionDigits: 0,
      })}
      g{override != null ? " (override)" : ""}
    </p>
  );
}

function ProgressMeter({
  label,
  percent,
  summary,
}: {
  label: string;
  percent: number;
  summary?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-sm">
        <div className="flex flex-col">
          <span>{label}</span>
          {summary ? (
            <span className="text-muted-foreground text-xs">{summary}</span>
          ) : null}
        </div>
        <span className="font-medium">{percent}%</span>
      </div>
      <div className="bg-muted h-2 rounded-full">
        <div
          className="bg-primary h-2 rounded-full transition-all"
          style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
        />
      </div>
    </div>
  );
}

function MemberRow({
  name,
  image,
  subtitle,
}: {
  name: string;
  image: string | null;
  subtitle: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {image ? (
        <img
          src={image}
          alt={name}
          className="h-9 w-9 rounded-full border object-cover"
        />
      ) : (
        <div className="bg-muted flex h-9 w-9 items-center justify-center rounded-full border text-sm">
          {name.slice(0, 1).toUpperCase()}
        </div>
      )}
      <div className="min-w-0">
        <p className="truncate font-medium">{name}</p>
        <p className="text-muted-foreground text-sm">{subtitle}</p>
      </div>
    </div>
  );
}
