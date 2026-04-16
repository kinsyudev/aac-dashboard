import type { Dispatch, SetStateAction } from "react";
import { useMemo, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";

import { Button } from "@acme/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@acme/ui/dropdown-menu";
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
const STOCK_INPUT_CLASS_NAME =
  "bg-background w-24 rounded-md border px-3 py-1.5 text-sm tabular-nums";

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

function setDraftValue(
  setDrafts: Dispatch<SetStateAction<Record<number, string>>>,
  id: number,
  value: string,
) {
  setDrafts((drafts) => ({
    ...drafts,
    [id]: value,
  }));
}

function formatSourceSummary(list: {
  sourceType: "craft" | "simulator";
  sourceQuantity: number;
  craftModeItemIds: number[];
}) {
  const quantityLabel =
    list.sourceType === "simulator"
      ? `${list.sourceQuantity.toLocaleString()} attempt${
          list.sourceQuantity === 1 ? "" : "s"
        }`
      : `${list.sourceQuantity.toLocaleString()} craft${
          list.sourceQuantity === 1 ? "" : "s"
        }`;
  const modeLabel =
    list.craftModeItemIds.length > 0
      ? `${list.craftModeItemIds.length} subcraft selection${
          list.craftModeItemIds.length === 1 ? "" : "s"
        }`
      : "default subcrafts";

  return {
    sourceLabel:
      list.sourceType === "simulator" ? "Simulator list" : "Craft list",
    quantityLabel,
    modeLabel,
  };
}

function ShoppingListDetailPage() {
  const { listId } = Route.useParams();
  const trpc = useTRPC();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const listQueryOptions = trpc.shoppingLists.getById.queryOptions(listId);
  const { data } = useSuspenseQuery(listQueryOptions);
  const { overrideMap } = useUserData();

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
  const setupSummary = useMemo(
    () => formatSourceSummary(data.list),
    [data.list],
  );

  const invalidate = async () => {
    await Promise.all([
      queryClient.refetchQueries({
        queryKey: listQueryOptions.queryKey,
        exact: true,
      }),
      queryClient.invalidateQueries(
        trpc.shoppingLists.listMineAndShared.pathFilter(),
      ),
    ]);
  };

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
                    stockQuantity: Math.min(
                      item.totalQuantity,
                      obtainedQuantity,
                    ),
                    remainingQuantity: Math.max(
                      0,
                      item.totalQuantity -
                        Math.min(item.totalQuantity, obtainedQuantity) -
                        item.usedQuantity,
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
                    stockCount: Math.min(craft.totalCount, completedCount),
                    remainingCount: Math.max(
                      0,
                      craft.totalCount -
                        Math.min(craft.totalCount, completedCount) -
                        craft.usedCount,
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
  const pendingCraftId = updateCraftProgress.isPending
    ? updateCraftProgress.variables.craftId
    : null;

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
      (sum, item) => sum + item.totalQuantity,
      0,
    );
    const accountedItems = materialItems.reduce(
      (sum, item) => sum + item.totalQuantity - item.remainingQuantity,
      0,
    );
    const requiredCrafts = data.crafts.reduce(
      (sum, craft) => sum + craft.totalCount,
      0,
    );
    const accountedCrafts = data.crafts.reduce(
      (sum, craft) => sum + craft.totalCount - craft.remainingCount,
      0,
    );
    return {
      accountedItems,
      requiredItems,
      accountedCrafts,
      requiredCrafts,
      itemPct:
        requiredItems === 0
          ? 0
          : Math.round((accountedItems / requiredItems) * 100),
      craftPct:
        requiredCrafts === 0
          ? 0
          : Math.round((accountedCrafts / requiredCrafts) * 100),
    };
  }, [data.crafts, materialItems]);

  const coinCompletion = useMemo(() => {
    if (!coinRow) return null;
    const required = coinRow.totalQuantity;
    const obtained = coinRow.stockQuantity;
    return {
      required,
      obtained,
      percent: required === 0 ? 0 : Math.round((obtained / required) * 100),
    };
  }, [coinRow]);

  const outstandingBuyCost = useMemo(
    () =>
      materialItems.reduce((sum, itemRow) => {
        const remainingQuantity = itemRow.remainingQuantity;
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
        const leftRemaining = left.remainingQuantity;
        const rightRemaining = right.remainingQuantity;
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

  const commitItemProgress = (itemId: number, totalQuantity: number) => {
    const raw = itemDrafts[itemId];
    if (raw === undefined) return;
    const item = data.items.find((entry) => entry.itemId === itemId);
    const parsed = item && isCoinItem(item) ? parseGoldInput(raw) : Number(raw);
    const obtainedQuantity = Math.min(
      totalQuantity,
      Math.max(0, Number.isFinite(parsed) ? parsed : 0),
    );
    const current = item;
    setItemDrafts((drafts) => {
      const next = { ...drafts };
      delete next[itemId];
      return next;
    });
    if (!current || current.stockQuantity === obtainedQuantity) return;
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

  const commitCraftProgress = (craftId: number, totalCount: number) => {
    const raw = craftDrafts[craftId];
    if (raw === undefined) return;
    const parsed = Number(raw);
    const completedCount = Math.min(
      totalCount,
      Math.max(0, Number.isFinite(parsed) ? parsed : 0),
    );
    const current = data.crafts.find((craft) => craft.craftId === craftId);
    setCraftDrafts((drafts) => {
      const next = { ...drafts };
      delete next[craftId];
      return next;
    });
    if (!current || current.stockCount === completedCount) return;
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
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
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
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              <StatPill label={setupSummary.sourceLabel} />
              <StatPill label={setupSummary.quantityLabel} />
              <StatPill label={setupSummary.modeLabel} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
                <EditIcon />
                Edit
              </Link>
            </Button>
            <HeaderActionMenu
              canDelete={data.isOwner}
              duplicateFreshPending={
                duplicate.isPending && duplicate.variables.mode === "fresh"
              }
              duplicateWithProgressPending={
                duplicate.isPending && duplicate.variables.mode === "copyState"
              }
              deletePending={deleteList.isPending}
              onDelete={handleDelete}
              onDuplicateFresh={() =>
                duplicate.mutate({ listId, mode: "fresh" })
              }
              onDuplicateWithProgress={() =>
                duplicate.mutate({ listId, mode: "copyState" })
              }
            />
          </div>
        </div>

        <section className="rounded-xl border p-5">
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-lg font-semibold">Progress</h2>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-[1.35fr_0.95fr]">
            <div className="flex flex-col gap-4">
              <ProgressMeter
                label="Items accounted for"
                percent={completion.itemPct}
                summary={`${completion.accountedItems.toLocaleString()} / ${completion.requiredItems.toLocaleString()}`}
              />
              <ProgressMeter
                label="Crafts accounted for"
                percent={completion.craftPct}
                summary={`${completion.accountedCrafts.toLocaleString()} / ${completion.requiredCrafts.toLocaleString()}`}
              />
              {coinRow ? (
                <div className="flex items-end justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <ProgressMeter
                      label="Coins"
                      percent={coinCompletion?.percent ?? 0}
                      summary={`${formatCoinValue(
                        coinCompletion?.obtained ?? 0,
                      )} / ${formatCoinValue(coinCompletion?.required ?? 0)}`}
                    />
                  </div>
                  <div className="text-right">
                    <p className="text-muted-foreground text-[11px] tracking-wide uppercase">
                      Gold input
                    </p>
                    <div className="mt-1 flex items-center justify-end gap-2">
                      <input
                        type="number"
                        min="0"
                        max={formatGoldInput(coinRow.totalQuantity)}
                        step="0.0001"
                        disabled={!data.canWrite}
                        className={`${STOCK_INPUT_CLASS_NAME} w-28`}
                        value={
                          itemDrafts[coinRow.itemId] ??
                          formatGoldInput(coinRow.stockQuantity)
                        }
                        onChange={(event) =>
                          setDraftValue(
                            setItemDrafts,
                            coinRow.itemId,
                            event.target.value,
                          )
                        }
                        onBlur={() =>
                          commitItemProgress(
                            coinRow.itemId,
                            coinRow.totalQuantity,
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
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!data.canWrite}
                        loading={
                          updateItemProgress.isPending &&
                          updateItemProgress.variables.itemId === coinRow.itemId
                        }
                        onClick={() => {
                          setDraftValue(
                            setItemDrafts,
                            coinRow.itemId,
                            formatGoldInput(coinRow.totalQuantity),
                          );
                          updateItemProgress.mutate({
                            listId,
                            itemId: coinRow.itemId,
                            obtainedQuantity: coinRow.totalQuantity,
                          });
                        }}
                      >
                        Fill
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
              <p className="text-muted-foreground text-sm">
                Invited writers can update raw and crafted stock.
              </p>
            </div>
            <div className="bg-muted/30 rounded-lg px-4 py-3">
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
              {coinRow ? (
                <p className="text-muted-foreground mt-3 text-xs">
                  Input is in gold. `1` = `1g`, `0.01` = `1s`, `0.0001` = `1c`.
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <section className="grid gap-2 lg:grid-cols-[1.3fr_1fr]">
          <div className="rounded-xl border p-5">
            <h2 className="text-lg font-semibold">Shopping Items</h2>
            <div className="mt-4 flex flex-col gap-2">
              {sortedItems.map((itemRow) => (
                <div
                  key={itemRow.itemId}
                  className={`flex items-center justify-between gap-4 rounded-lg px-2 py-2 transition-opacity ${
                    itemRow.remainingQuantity === 0 ? "opacity-45" : ""
                  }`}
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
                        {itemRow.remainingQuantity.toLocaleString()} remaining •{" "}
                        {itemRow.stockQuantity.toLocaleString()} stock •{" "}
                        {itemRow.usedQuantity.toLocaleString()} used •{" "}
                        {itemRow.totalQuantity.toLocaleString()} total
                      </p>
                      <ItemCost
                        itemId={itemRow.itemId}
                        remainingQuantity={itemRow.remainingQuantity}
                        overrideMap={overrideMap}
                        priceMap={priceMap}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min="0"
                      max={String(itemRow.totalQuantity)}
                      disabled={!data.canWrite}
                      className={STOCK_INPUT_CLASS_NAME}
                      value={
                        itemDrafts[itemRow.itemId] ??
                        String(itemRow.stockQuantity)
                      }
                      onChange={(event) =>
                        setDraftValue(
                          setItemDrafts,
                          itemRow.itemId,
                          event.target.value,
                        )
                      }
                      onBlur={() =>
                        commitItemProgress(
                          itemRow.itemId,
                          itemRow.totalQuantity,
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
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!data.canWrite}
                      loading={
                        updateItemProgress.isPending &&
                        updateItemProgress.variables.itemId === itemRow.itemId
                      }
                      onClick={() => {
                        setDraftValue(
                          setItemDrafts,
                          itemRow.itemId,
                          String(itemRow.totalQuantity),
                        );
                        updateItemProgress.mutate({
                          listId,
                          itemId: itemRow.itemId,
                          obtainedQuantity: itemRow.totalQuantity,
                        });
                      }}
                    >
                      Fill
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <section className="rounded-xl border p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Craft Stock</h2>
                {updateCraftProgress.isPending ? (
                  <span className="text-muted-foreground text-xs font-medium">
                    Saving craft stock...
                  </span>
                ) : null}
              </div>
              <div className="mt-4 flex flex-col gap-1">
                {data.crafts.map((craftRow) => (
                  <div
                    key={craftRow.craftId}
                    className={`flex items-center justify-between gap-4 rounded-lg px-2 py-2 transition-opacity ${
                      craftRow.remainingCount === 0 ? "opacity-45" : ""
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <ItemIcon
                        icon={craftRow.product?.icon ?? null}
                        name={craftRow.product?.name ?? craftRow.craft.name}
                        size="md"
                      />
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {craftRow.craft.name}
                        </p>
                        <p className="text-muted-foreground text-sm tabular-nums">
                          {craftRow.remainingCount.toLocaleString()} remaining •{" "}
                          {craftRow.stockCount.toLocaleString()} stock •{" "}
                          {craftRow.usedCount.toLocaleString()} used •{" "}
                          {craftRow.totalCount.toLocaleString()} total
                        </p>
                        {pendingCraftId === craftRow.craftId ? (
                          <p className="text-muted-foreground mt-1 text-xs">
                            Saving...
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        max={String(craftRow.totalCount)}
                        disabled={!data.canWrite}
                        className={STOCK_INPUT_CLASS_NAME}
                        value={
                          craftDrafts[craftRow.craftId] ??
                          String(craftRow.stockCount)
                        }
                        onChange={(event) =>
                          setDraftValue(
                            setCraftDrafts,
                            craftRow.craftId,
                            event.target.value,
                          )
                        }
                        onBlur={() =>
                          commitCraftProgress(
                            craftRow.craftId,
                            craftRow.totalCount,
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
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!data.canWrite}
                        loading={
                          updateCraftProgress.isPending &&
                          updateCraftProgress.variables.craftId ===
                            craftRow.craftId
                        }
                        onClick={() => {
                          setDraftValue(
                            setCraftDrafts,
                            craftRow.craftId,
                            String(craftRow.totalCount),
                          );
                          updateCraftProgress.mutate({
                            listId,
                            craftId: craftRow.craftId,
                            completedCount: craftRow.totalCount,
                          });
                        }}
                      >
                        Fill
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

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
                        variant="ghost"
                        loading={
                          removeMember.isPending &&
                          removeMember.variables.userId === member.userId
                        }
                        loadingText="Removing..."
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
                    loading={
                      createInvite.isPending &&
                      createInvite.variables.role === "read"
                    }
                    loadingText="Creating..."
                    onClick={() =>
                      createInvite.mutate({ listId, role: "read" })
                    }
                  >
                    Read invite
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={
                      createInvite.isPending &&
                      createInvite.variables.role === "write"
                    }
                    loadingText="Creating..."
                    onClick={() =>
                      createInvite.mutate({ listId, role: "write" })
                    }
                  >
                    Write invite
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
                              variant="ghost"
                              loading={
                                revokeInvite.isPending &&
                                revokeInvite.variables.inviteId === invite.id
                              }
                              loadingText="Revoking..."
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
                            variant="ghost"
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

function HeaderActionMenu({
  canDelete,
  duplicateFreshPending,
  duplicateWithProgressPending,
  deletePending,
  onDelete,
  onDuplicateFresh,
  onDuplicateWithProgress,
}: {
  canDelete: boolean;
  duplicateFreshPending: boolean;
  duplicateWithProgressPending: boolean;
  deletePending: boolean;
  onDelete: () => void;
  onDuplicateFresh: () => void;
  onDuplicateWithProgress: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline">
          <OverflowIcon />
          <span className="sr-only">More actions</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={duplicateFreshPending}
          onClick={onDuplicateFresh}
        >
          {duplicateFreshPending ? "Duplicating..." : "Duplicate fresh"}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={duplicateWithProgressPending}
          onClick={onDuplicateWithProgress}
        >
          {duplicateWithProgressPending
            ? "Duplicating..."
            : "Duplicate with progress"}
        </DropdownMenuItem>
        {canDelete ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={deletePending}
              onClick={onDelete}
              className="text-destructive focus:text-destructive"
            >
              Delete
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StatPill({ label }: { label: string }) {
  return (
    <span className="bg-muted text-muted-foreground rounded-full px-3 py-1 font-medium">
      {label}
    </span>
  );
}

function EditIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 11.5 2 14l2.5-.5L12 6 10 4 2.5 11.5Z" />
      <path d="m9.5 4.5 2 2" />
      <path d="M8.5 14H14" />
    </svg>
  );
}

function OverflowIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4"
      fill="currentColor"
    >
      <circle cx="3" cy="8" r="1.25" />
      <circle cx="8" cy="8" r="1.25" />
      <circle cx="13" cy="8" r="1.25" />
    </svg>
  );
}

function ItemCost({
  itemId,
  remainingQuantity,
  overrideMap,
  priceMap,
}: {
  itemId: number;
  remainingQuantity: number;
  overrideMap: Map<number, number>;
  priceMap: Map<number, { avg24h: string | null; avg7d: string | null }>;
}) {
  const override = overrideMap.get(itemId);
  const market = priceMap.get(itemId);
  const unitPrice =
    override != null
      ? coerceFiniteNumber(override)
      : coerceFiniteNumber(market?.avg24h ?? market?.avg7d);

  if (unitPrice <= 0) {
    return (
      <p className="text-muted-foreground text-xs">
        No market price data available.
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
      g total •{" "}
      {unitPrice.toLocaleString(undefined, {
        maximumFractionDigits: 2,
      })}
      g each
      {override != null ? " (override)" : ""}
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
