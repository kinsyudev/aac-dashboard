import type { inferProcedureOutput } from "@trpc/server";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Fragment, useMemo, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";

import type { AppRouter } from "@acme/api";
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

import type {
  ModesMap,
  PriceMap,
  SelectedCraftMap,
} from "~/lib/craft-optimizer";
import { ItemIcon } from "~/component/item-icon";
import { ProficiencyBadge } from "~/component/proficiency";
import {
  CraftModeToggle,
  RecipeCardShell,
  RecipeCollapseToggle,
  RecipeHeader,
  RecipeItemRow,
  RecipeLegend,
} from "~/component/recipe-breakdown";
import {
  buildCraftRequirementSummary,
  computeManualCraftMetrics,
  getItemPrice,
  getSelectedEntry,
  MAX_CRAFT_DEPTH,
} from "~/lib/craft-optimizer";
import { buildMetaTags, buildPageTitle, getItemIconUrl } from "~/lib/metadata";
import { useTRPC } from "~/lib/trpc";
import { useUserData } from "~/lib/useUserData";

export const Route = createFileRoute("/shoplists/$listId")({
  loader: ({ context, params }) => {
    return context.queryClient.fetchQuery(
      context.trpc.shoppingLists.getById.queryOptions(params.listId),
    );
  },
  head: ({ loaderData }) => ({
    meta: buildMetaTags({
      title: buildPageTitle(loaderData?.list.name, "Shopping Lists"),
      description: loaderData?.list.primarySourceItem?.name
        ? `Track remaining materials and shared progress for ${loaderData.list.name} built around ${loaderData.list.primarySourceItem.name}.`
        : `Track remaining materials and shared progress for ${loaderData?.list.name}.`,
      image: getItemIconUrl(loaderData?.list.primarySourceItem?.icon),
    }),
  }),
  component: ShoppingListDetailPage,
});

const COIN_ITEM_ID = 500;
const STOCK_INPUT_CLASS_NAME =
  "bg-background w-24 rounded-md border px-3 py-1.5 text-sm tabular-nums";

type ForItemOutput = NonNullable<
  inferProcedureOutput<AppRouter["crafts"]["forItem"]>
>;
type InlineRecipeEntry = ForItemOutput["crafts"][number];
type InlineSubcraftEntry = ForItemOutput["subcraftsByItemId"][number][number];
type InlineSubcraftMap = Record<number, InlineSubcraftEntry[]>;
type InlineRecipeLike = InlineRecipeEntry;

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
  sourceKind: "empty" | "craft" | "simulator";
  rootCount: number;
  totalQuantity: number;
  craftModeItemIds: number[];
}) {
  const quantityLabel =
    list.sourceKind === "empty"
      ? "No roots yet"
      : list.sourceKind === "simulator"
        ? `${list.totalQuantity.toLocaleString()} attempt${
            list.totalQuantity === 1 ? "" : "s"
          }`
        : `${list.rootCount.toLocaleString()} root craft${
            list.rootCount === 1 ? "" : "s"
          }`;
  const detailLabel =
    list.sourceKind === "craft"
      ? `${list.totalQuantity.toLocaleString()} total craft${
          list.totalQuantity === 1 ? "" : "s"
        }`
      : null;
  const modeLabel =
    list.craftModeItemIds.length > 0
      ? `${list.craftModeItemIds.length} subcraft selection${
          list.craftModeItemIds.length === 1 ? "" : "s"
        }`
      : "default subcrafts";

  return {
    sourceLabel:
      list.sourceKind === "empty"
        ? "Empty list"
        : list.sourceKind === "simulator"
          ? "Simulator list"
          : "Craft list",
    quantityLabel,
    detailLabel,
    modeLabel,
  };
}

function RowLinkOrContent({
  children,
  itemId,
  to,
}: {
  children: ReactNode;
  itemId?: number | null;
  to: "/item/$itemId" | "/craft/$itemId";
}) {
  if (!itemId) {
    return <div className="flex min-w-0 items-center gap-3">{children}</div>;
  }

  return (
    <Link
      to={to}
      params={{ itemId }}
      className="flex min-w-0 items-center gap-3 rounded-md transition outline-none hover:opacity-80 focus-visible:ring-2"
    >
      {children}
    </Link>
  );
}

function getInlineSelectedEntry(
  itemId: number,
  entries: InlineRecipeEntry[],
  selectedCrafts: SelectedCraftMap,
): InlineRecipeEntry | null {
  const selectedCraftId = selectedCrafts[itemId];
  if (selectedCraftId != null) {
    const selected = entries.find(
      (entry) => entry.craft.id === selectedCraftId,
    );
    if (selected) return selected;
  }
  return entries[0] ?? null;
}

function ShoppingListDetailPage() {
  const { listId } = Route.useParams();
  const trpc = useTRPC();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const listQueryOptions = trpc.shoppingLists.getById.queryOptions(listId);
  const { data } = useSuspenseQuery(listQueryOptions);
  const { proficiencyMap, overrideMap } = useUserData();

  const [itemDrafts, setItemDrafts] = useState<Record<number, string>>({});
  const [craftDrafts, setCraftDrafts] = useState<Record<number, string>>({});
  const [sourceDrafts, setSourceDrafts] = useState<Record<string, string>>({});
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [expandedRecipeItemIds, setExpandedRecipeItemIds] = useState<
    Set<number>
  >(() => new Set());
  const [recipeCraftModes, setRecipeCraftModes] = useState<
    Record<number, ModesMap>
  >(() => ({}));
  const [recipeSelectedCrafts, setRecipeSelectedCrafts] = useState<
    Record<number, SelectedCraftMap>
  >(() => ({}));
  const [collapsedRecipeCraftIds, setCollapsedRecipeCraftIds] = useState<
    Record<number, Set<number>>
  >(() => ({}));
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
  const { data: craftableItems = [] } = useQuery(
    trpc.items.craftable.queryOptions(),
  );

  const priceMap = useMemo(
    () => new Map(prices.map((price) => [price.itemId, price])),
    [prices],
  );
  const craftableItemIds = useMemo(
    () => new Set(craftableItems.map((item) => item.id)),
    [craftableItems],
  );
  const savedCraftModes = useMemo<ModesMap>(
    () =>
      Object.fromEntries(
        data.list.craftModeItemIds.map((itemId) => [itemId, "craft" as const]),
      ),
    [data.list.craftModeItemIds],
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
  const renameList = useMutation(
    trpc.shoppingLists.rename.mutationOptions({
      onSuccess: async () => {
        setNameDraft(null);
        await invalidate();
      },
      onError: () => toast.error("Failed to rename shopping list."),
    }),
  );
  const updateSourceQuantity = useMutation(
    trpc.shoppingLists.updateSourceQuantity.mutationOptions({
      onSuccess: invalidate,
      onError: () => toast.error("Failed to update source quantity."),
    }),
  );
  const removeSource = useMutation(
    trpc.shoppingLists.removeSource.mutationOptions({
      onSuccess: invalidate,
      onError: () => toast.error("Failed to remove source."),
    }),
  );
  const resetProgress = useMutation(
    trpc.shoppingLists.resetProgress.mutationOptions({
      onMutate: async () => {
        await queryClient.cancelQueries(listQueryOptions);
        const previous = queryClient.getQueryData(listQueryOptions.queryKey);
        queryClient.setQueryData(listQueryOptions.queryKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((item) => ({
              ...item,
              stockQuantity: 0,
              remainingQuantity: Math.max(
                0,
                item.totalQuantity - item.usedQuantity,
              ),
            })),
            crafts: old.crafts.map((craft) => ({
              ...craft,
              stockCount: 0,
              remainingCount: Math.max(0, craft.totalCount - craft.usedCount),
            })),
          };
        });
        setItemDrafts({});
        setCraftDrafts({});
        return { previous };
      },
      onError: (_error, _variables, context) => {
        if (context?.previous) {
          queryClient.setQueryData(listQueryOptions.queryKey, context.previous);
        }
        toast.error("Failed to reset progress.");
      },
      onSuccess: () => toast.success("Shopping list progress reset."),
      onSettled: invalidate,
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

  const commitName = () => {
    const nextName = (nameDraft ?? data.list.name).trim();
    if (!nextName || nextName === data.list.name) {
      setNameDraft(null);
      return;
    }
    renameList.mutate({ listId, name: nextName });
  };

  const handleResetProgress = () => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Reset all material and craft progress for "${data.list.name}" to 0?`,
      );
      if (!confirmed) return;
    }
    resetProgress.mutate({ listId });
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
        const unitPrice = getItemPrice(itemRow.itemId, priceMap, overrideMap);
        return sum + remainingQuantity * unitPrice;
      }, 0),
    [materialItems, overrideMap, priceMap],
  );

  const sortedItems = useMemo(
    () =>
      [...materialItems].sort((left, right) => {
        const leftRemaining = left.remainingQuantity;
        const rightRemaining = right.remainingQuantity;
        const leftUnitPrice = getItemPrice(left.itemId, priceMap, overrideMap);
        const rightUnitPrice = getItemPrice(
          right.itemId,
          priceMap,
          overrideMap,
        );
        const costDelta =
          rightRemaining * rightUnitPrice - leftRemaining * leftUnitPrice;
        return costDelta !== 0
          ? costDelta
          : left.item.name.localeCompare(right.item.name);
      }),
    [materialItems, overrideMap, priceMap],
  );

  const toggleRecipeExpansion = (itemId: number) => {
    setExpandedRecipeItemIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const setInlineCraftModes = (itemId: number, modes: ModesMap) => {
    setRecipeCraftModes((current) => ({
      ...current,
      [itemId]: modes,
    }));
  };

  const setInlineSelectedCrafts = (
    itemId: number,
    selectedCrafts: SelectedCraftMap,
  ) => {
    setRecipeSelectedCrafts((current) => ({
      ...current,
      [itemId]: selectedCrafts,
    }));
  };

  const toggleInlineCollapsedCraft = (itemId: number, craftId: number) => {
    setCollapsedRecipeCraftIds((current) => {
      const nextSet = new Set(current[itemId] ?? []);
      if (nextSet.has(craftId)) nextSet.delete(craftId);
      else nextSet.add(craftId);
      return {
        ...current,
        [itemId]: nextSet,
      };
    });
  };

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

  const commitSourceQuantity = (sourceId: string, currentQuantity: number) => {
    const raw = sourceDrafts[sourceId];
    if (raw === undefined) return;
    const parsed = Number(raw);
    const quantity = Math.max(
      1,
      Math.floor(Number.isFinite(parsed) ? parsed : 1),
    );
    setSourceDrafts((drafts) => {
      const next = { ...drafts };
      delete next[sourceId];
      return next;
    });
    if (quantity === currentQuantity) return;
    updateSourceQuantity.mutate({ listId, sourceId, quantity });
  };

  const resetSourceDraft = (sourceId: string) => {
    setSourceDrafts((drafts) => {
      if (!(sourceId in drafts)) return drafts;
      const next = { ...drafts };
      delete next[sourceId];
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
              {setupSummary.detailLabel ? (
                <StatPill label={setupSummary.detailLabel} />
              ) : null}
              <StatPill label={setupSummary.modeLabel} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {data.list.sourceKind === "simulator" && data.sources[0] ? (
              <Button asChild size="sm">
                <Link
                  to="/shoplist"
                  search={{
                    craft: data.sources[0].craftId,
                    simItem: data.sources[0].itemId ?? undefined,
                    qty: 1,
                    attempts: data.sources[0].quantity,
                    strategy:
                      data.sources[0].sourceType === "resealSimulator"
                        ? "reseal"
                        : "salvage",
                    sub: data.list.craftModeItemIds.join(",") || undefined,
                    listId,
                  }}
                >
                  <EditIcon />
                  Edit Simulator Setup
                </Link>
              </Button>
            ) : null}
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
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <label className="flex-1">
                <span className="mb-1 block text-sm font-medium">
                  List name
                </span>
                <Input
                  value={nameDraft ?? data.list.name}
                  disabled={!data.canWrite}
                  onChange={(event) => setNameDraft(event.target.value)}
                  onBlur={commitName}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur();
                    }
                    if (event.key === "Escape") {
                      setNameDraft(null);
                      event.currentTarget.blur();
                    }
                  }}
                />
              </label>
              <Button asChild size="sm" variant="outline">
                <Link to="/craft" search={{ listId }}>
                  Add craft
                </Link>
              </Button>
            </div>

            <div className="flex flex-col gap-3">
              {data.sources.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  This list has no root crafts yet. Add one to generate the
                  shared shopping list.
                </p>
              ) : (
                data.sources.map((source) => (
                  <div
                    key={source.id}
                    className="flex flex-col gap-3 rounded-lg border px-4 py-3 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <ItemIcon
                        icon={source.item?.icon ?? null}
                        name={source.item?.name ?? source.craft.name}
                        size="md"
                      />
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {source.item?.name ?? source.craft.name}
                        </p>
                        <p className="text-muted-foreground truncate text-sm">
                          {source.craft.name}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="1"
                        disabled={!data.canWrite}
                        className={STOCK_INPUT_CLASS_NAME}
                        value={
                          sourceDrafts[source.id] ?? String(source.quantity)
                        }
                        onChange={(event) =>
                          setSourceDrafts((drafts) => ({
                            ...drafts,
                            [source.id]: event.target.value,
                          }))
                        }
                        onBlur={() =>
                          commitSourceQuantity(source.id, source.quantity)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.currentTarget.blur();
                          }
                          if (event.key === "Escape") {
                            resetSourceDraft(source.id);
                            event.currentTarget.blur();
                          }
                        }}
                      />
                      <Button asChild size="sm" variant="ghost">
                        <Link
                          to="/shoplist"
                          search={{
                            craft: source.craftId,
                            qty: source.quantity,
                            sub:
                              data.list.craftModeItemIds.join(",") || undefined,
                            listId,
                            sourceId: source.id,
                          }}
                        >
                          Review
                        </Link>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!data.canWrite}
                        loading={
                          removeSource.isPending &&
                          removeSource.variables.sourceId === source.id
                        }
                        loadingText="Removing..."
                        onClick={() =>
                          removeSource.mutate({ listId, sourceId: source.id })
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="rounded-xl border p-5">
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-lg font-semibold">Progress</h2>
            <Button
              size="sm"
              variant="outline"
              disabled={!data.canWrite}
              loading={resetProgress.isPending}
              loadingText="Resetting..."
              onClick={handleResetProgress}
            >
              Reset to 0
            </Button>
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
              {sortedItems.map((itemRow) => {
                const canShowRecipes =
                  itemRow.remainingQuantity > 0 &&
                  craftableItemIds.has(itemRow.itemId);
                const isRecipeExpanded = expandedRecipeItemIds.has(
                  itemRow.itemId,
                );

                return (
                  <div key={itemRow.itemId} className="flex flex-col gap-2">
                    <div
                      className={`flex items-center justify-between gap-4 rounded-lg px-2 py-2 transition-opacity ${
                        itemRow.remainingQuantity === 0 ? "opacity-45" : ""
                      }`}
                    >
                      <RowLinkOrContent
                        to="/item/$itemId"
                        itemId={itemRow.itemId}
                      >
                        <ItemIcon
                          icon={itemRow.item.icon}
                          name={itemRow.item.name}
                          size="md"
                        />
                        <div className="min-w-0">
                          <p className="truncate font-medium hover:underline">
                            {itemRow.item.name}
                          </p>
                          <p className="text-muted-foreground text-sm">
                            {itemRow.remainingQuantity.toLocaleString()}{" "}
                            remaining • {itemRow.stockQuantity.toLocaleString()}{" "}
                            stock • {itemRow.usedQuantity.toLocaleString()} used
                            • {itemRow.totalQuantity.toLocaleString()} total
                          </p>
                          <ItemCost
                            itemId={itemRow.itemId}
                            remainingQuantity={itemRow.remainingQuantity}
                            overrideMap={overrideMap}
                            priceMap={priceMap}
                          />
                        </div>
                      </RowLinkOrContent>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {canShowRecipes ? (
                          <Button
                            type="button"
                            size="sm"
                            variant={isRecipeExpanded ? "secondary" : "outline"}
                            onClick={() =>
                              toggleRecipeExpansion(itemRow.itemId)
                            }
                          >
                            {isRecipeExpanded ? "Hide recipes" : "Recipes"}
                          </Button>
                        ) : null}
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
                            updateItemProgress.variables.itemId ===
                              itemRow.itemId
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

                    {isRecipeExpanded && canShowRecipes ? (
                      <div className="pl-2">
                        <InlineRecipePreview
                          itemId={itemRow.itemId}
                          itemName={itemRow.item.name}
                          remainingQuantity={itemRow.remainingQuantity}
                          initialModes={savedCraftModes}
                          modes={recipeCraftModes[itemRow.itemId]}
                          selectedCrafts={recipeSelectedCrafts[itemRow.itemId]}
                          collapsedCraftIds={
                            collapsedRecipeCraftIds[itemRow.itemId]
                          }
                          priceMap={priceMap}
                          overrideMap={overrideMap}
                          proficiencyMap={proficiencyMap}
                          setModes={(modes) =>
                            setInlineCraftModes(itemRow.itemId, modes)
                          }
                          setSelectedCrafts={(selectedCrafts) =>
                            setInlineSelectedCrafts(
                              itemRow.itemId,
                              selectedCrafts,
                            )
                          }
                          toggleCollapsed={(craftId) =>
                            toggleInlineCollapsedCraft(itemRow.itemId, craftId)
                          }
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
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
                    <RowLinkOrContent
                      to="/craft/$itemId"
                      itemId={craftRow.product?.id}
                    >
                      <ItemIcon
                        icon={craftRow.product?.icon ?? null}
                        name={craftRow.product?.name ?? craftRow.craft.name}
                        size="md"
                      />
                      <div className="min-w-0">
                        <p className="truncate font-medium hover:underline">
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
                    </RowLinkOrContent>
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

function InlineRecipePreview({
  itemId,
  itemName,
  remainingQuantity,
  initialModes,
  modes,
  selectedCrafts,
  collapsedCraftIds,
  priceMap,
  overrideMap,
  proficiencyMap,
  setModes,
  setSelectedCrafts,
  toggleCollapsed,
}: {
  itemId: number;
  itemName: string;
  remainingQuantity: number;
  initialModes: ModesMap;
  modes?: ModesMap;
  selectedCrafts?: SelectedCraftMap;
  collapsedCraftIds?: Set<number>;
  priceMap: PriceMap;
  overrideMap: Map<number, number>;
  proficiencyMap: Map<string, number>;
  setModes: (modes: ModesMap) => void;
  setSelectedCrafts: (selectedCrafts: SelectedCraftMap) => void;
  toggleCollapsed: (craftId: number) => void;
}) {
  const trpc = useTRPC();
  const effectiveModes = modes ?? initialModes;
  const effectiveSelectedCrafts = selectedCrafts ?? {};
  const craftQuery = useQuery(trpc.crafts.forItem.queryOptions(itemId));
  const craftData = craftQuery.data ?? null;

  if (craftQuery.isLoading) {
    return (
      <div className="bg-muted/20 rounded-lg border px-3 py-3 text-sm">
        Loading recipes for {itemName}...
      </div>
    );
  }

  if (craftQuery.isError) {
    return (
      <div className="bg-muted/20 rounded-lg border px-3 py-3 text-sm">
        Could not load recipes for {itemName}.
      </div>
    );
  }

  if (!craftData || craftData.crafts.length === 0) {
    return (
      <div className="bg-muted/20 rounded-lg border px-3 py-3 text-sm">
        No recipes available.
      </div>
    );
  }

  const selectedEntry =
    getInlineSelectedEntry(itemId, craftData.crafts, effectiveSelectedCrafts) ??
    craftData.crafts[0];
  if (!selectedEntry) {
    return (
      <div className="bg-muted/20 rounded-lg border px-3 py-3 text-sm">
        No recipes available.
      </div>
    );
  }

  const mergedPriceMap: PriceMap = new Map([
    ...priceMap,
    ...craftData.prices.map((price) => [price.itemId, price] as const),
  ]);
  const summary = buildCraftRequirementSummary({
    entry: selectedEntry,
    producedItemId: itemId,
    requiredQuantity: remainingQuantity,
    subcraftMap: craftData.subcraftsByItemId,
    modes: effectiveModes,
    selectedCrafts: effectiveSelectedCrafts,
    priceMap: mergedPriceMap,
    overrideMap,
    proficiencyMap,
  });
  const buyCost =
    remainingQuantity * getItemPrice(itemId, mergedPriceMap, overrideMap);
  const craftCost = summary.materialCost;
  const diff = craftCost - buyCost;

  const selectTopRecipe = (craftId: number) => {
    setSelectedCrafts({
      ...effectiveSelectedCrafts,
      [itemId]: craftId,
    });
  };
  const setItemMode = (modeItemId: number, mode: "buy" | "craft") => {
    setModes({
      ...effectiveModes,
      [modeItemId]: mode,
    });
  };

  return (
    <div className="bg-muted/10 rounded-lg border px-3 py-3">
      <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-semibold">Recipe preview</p>
          <p className="text-muted-foreground text-xs">
            {remainingQuantity.toLocaleString()} needed •{" "}
            {summary.batches.toLocaleString()} batch
            {summary.batches === 1 ? "" : "es"} • produces{" "}
            {summary.producedQuantity.toLocaleString()}
            {summary.producedQuantity > remainingQuantity
              ? ` (${(
                  summary.producedQuantity - remainingQuantity
                ).toLocaleString()} extra)`
              : ""}
          </p>
        </div>
        {craftData.crafts.length > 1 ? (
          <label className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Recipe</span>
            <select
              className="bg-background rounded-md border px-2 py-1 text-sm"
              value={selectedEntry.craft.id}
              onChange={(event) => selectTopRecipe(Number(event.target.value))}
            >
              {craftData.crafts.map((entry) => (
                <option key={entry.craft.id} value={entry.craft.id}>
                  {entry.craft.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(260px,0.75fr)]">
        <InlineRecipeTree
          entry={selectedEntry}
          producedItemId={itemId}
          priceMap={mergedPriceMap}
          overrideMap={overrideMap}
          proficiencyMap={proficiencyMap}
          subcraftMap={craftData.subcraftsByItemId}
          modes={effectiveModes}
          selectedCrafts={effectiveSelectedCrafts}
          setItemMode={setItemMode}
          setSelectedCrafts={setSelectedCrafts}
          collapsedCraftIds={collapsedCraftIds ?? new Set()}
          toggleCollapsed={toggleCollapsed}
        />

        <div className="flex flex-col gap-3">
          <div className="rounded-md border p-3">
            <p className="text-sm font-semibold">Buy vs craft</p>
            <div className="mt-2 flex flex-col gap-1 text-sm tabular-nums">
              <p className="flex justify-between gap-3">
                <span className="text-muted-foreground">Buy remaining</span>
                <span>
                  {buyCost.toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })}
                  g
                </span>
              </p>
              <p className="flex justify-between gap-3">
                <span className="text-muted-foreground">Craft materials</span>
                <span>
                  {craftCost.toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })}
                  g
                </span>
              </p>
              <p className="flex justify-between gap-3 font-medium">
                <span>Difference</span>
                <span
                  className={
                    diff <= 0
                      ? "text-green-600 dark:text-green-400"
                      : "text-red-500"
                  }
                >
                  {diff <= 0 ? "Saves " : "Costs "}
                  {Math.abs(diff).toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })}
                  g
                </span>
              </p>
            </div>
          </div>

          <div className="rounded-md border p-3">
            <p className="text-sm font-semibold">Raw materials</p>
            {summary.materials.length === 0 ? (
              <p className="text-muted-foreground mt-2 text-sm">
                No raw materials.
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1">
                {summary.materials.map((material) => {
                  const materialItem = material.item as {
                    id: number;
                    name?: string | null;
                    icon?: string | null;
                  };
                  const materialName =
                    materialItem.name ?? `Item ${materialItem.id}`;
                  return (
                    <RecipeItemRow
                      key={materialItem.id}
                      icon={
                        <ItemIcon
                          icon={materialItem.icon ?? null}
                          name={materialName}
                        />
                      }
                      name={materialName}
                      amount={material.totalAmount}
                      value={
                        <span className="text-muted-foreground tabular-nums">
                          {(
                            material.totalAmount *
                            getItemPrice(
                              materialItem.id,
                              mergedPriceMap,
                              overrideMap,
                            )
                          ).toLocaleString(undefined, {
                            maximumFractionDigits: 0,
                          })}
                          g
                        </span>
                      }
                    />
                  );
                })}
              </ul>
            )}
          </div>

          {summary.laborByProficiency.length > 0 ? (
            <div className="rounded-md border p-3">
              <p className="text-sm font-semibold">Labor</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {summary.laborByProficiency.map((entry) => (
                  <span
                    key={entry.proficiency}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs"
                  >
                    <ProficiencyBadge proficiency={entry.proficiency} />
                    <span className="tabular-nums">
                      {entry.labor.toLocaleString()}L
                    </span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <RecipeLegend />
    </div>
  );
}

function InlineRecipeTree({
  entry,
  producedItemId,
  priceMap,
  overrideMap,
  proficiencyMap,
  subcraftMap,
  modes,
  selectedCrafts,
  setItemMode,
  setSelectedCrafts,
  collapsedCraftIds,
  toggleCollapsed,
  depth = 0,
}: {
  entry: InlineRecipeLike;
  producedItemId: number;
  priceMap: PriceMap;
  overrideMap: Map<number, number>;
  proficiencyMap: Map<string, number>;
  subcraftMap: InlineSubcraftMap;
  modes: ModesMap;
  selectedCrafts: SelectedCraftMap;
  setItemMode: (itemId: number, mode: "buy" | "craft") => void;
  setSelectedCrafts: (selectedCrafts: SelectedCraftMap) => void;
  collapsedCraftIds: Set<number>;
  toggleCollapsed: (craftId: number) => void;
  depth?: number;
}) {
  const isCollapsed = collapsedCraftIds.has(entry.craft.id);
  const metrics = computeManualCraftMetrics(
    entry,
    producedItemId,
    getItemPrice(producedItemId, priceMap, overrideMap),
    {
      subcraftMap,
      priceMap,
      overrideMap,
      proficiencyMap,
      maxDepth: MAX_CRAFT_DEPTH,
    },
    modes,
    selectedCrafts,
    depth,
  );

  return (
    <RecipeCardShell depth={depth}>
      <RecipeHeader
        depth={depth}
        title={entry.craft.name}
        proficiency={entry.craft.proficiency}
        laborLabel={
          entry.craft.labor > 0
            ? `${metrics.directLabor.toLocaleString()} labor`
            : null
        }
        materialsLabel={`${metrics.materialsCost.toLocaleString(undefined, {
          maximumFractionDigits: 0,
        })}g`}
        collapseToggle={
          <RecipeCollapseToggle
            collapsed={isCollapsed}
            onToggle={() => toggleCollapsed(entry.craft.id)}
          />
        }
      />

      {!isCollapsed ? (
        <ul className="flex flex-col gap-1">
          {entry.materials.map(({ item, amount }) => {
            const isCraftable =
              depth < MAX_CRAFT_DEPTH && !!subcraftMap[item.id]?.length;
            const mode = modes[item.id] ?? "buy";
            const subEntry = isCraftable
              ? getSelectedEntry(item.id, subcraftMap, selectedCrafts)
              : null;
            const buyUnit = getItemPrice(item.id, priceMap, overrideMap);
            const craftedMetrics = subEntry
              ? computeManualCraftMetrics(
                  subEntry,
                  item.id,
                  buyUnit,
                  {
                    subcraftMap,
                    priceMap,
                    overrideMap,
                    proficiencyMap,
                    maxDepth: MAX_CRAFT_DEPTH,
                  },
                  modes,
                  selectedCrafts,
                  depth + 1,
                )
              : null;
            const craftUnit = craftedMetrics?.costPerUnit ?? 0;
            const unit = mode === "craft" && isCraftable ? craftUnit : buyUnit;
            const totalDiff =
              isCraftable && buyUnit > 0
                ? (buyUnit - craftUnit) * amount
                : null;

            return (
              <Fragment key={item.id}>
                <RecipeItemRow
                  icon={<ItemIcon icon={item.icon} name={item.name} />}
                  name={item.name}
                  amount={amount}
                  controls={
                    isCraftable ? (
                      <span className="inline-flex items-center gap-2">
                        <CraftModeToggle
                          mode={mode}
                          onBuy={() => setItemMode(item.id, "buy")}
                          onCraft={() => setItemMode(item.id, "craft")}
                        />
                        {mode === "craft" &&
                        (subcraftMap[item.id]?.length ?? 0) > 1 ? (
                          <select
                            className="bg-background rounded-md border px-2 py-0.5 text-xs"
                            value={subEntry?.craft.id ?? ""}
                            onChange={(event) =>
                              setSelectedCrafts({
                                ...selectedCrafts,
                                [item.id]: Number(event.target.value),
                              })
                            }
                          >
                            {(subcraftMap[item.id] ?? []).map((candidate) => (
                              <option
                                key={candidate.craft.id}
                                value={candidate.craft.id}
                              >
                                {candidate.craft.name}
                              </option>
                            ))}
                          </select>
                        ) : null}
                      </span>
                    ) : null
                  }
                  value={
                    <span className="text-muted-foreground tabular-nums">
                      {unit.toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })}
                      g
                    </span>
                  }
                  diff={
                    totalDiff !== null ? (
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium tabular-nums ${
                          totalDiff > 0
                            ? "bg-green-500/10 text-green-600 dark:text-green-400"
                            : totalDiff < 0
                              ? "bg-red-500/10 text-red-500"
                              : "text-muted-foreground"
                        }`}
                      >
                        {totalDiff > 0
                          ? `↓ ${totalDiff.toLocaleString(undefined, {
                              maximumFractionDigits: 0,
                            })}g`
                          : totalDiff < 0
                            ? `↑ ${Math.abs(totalDiff).toLocaleString(
                                undefined,
                                {
                                  maximumFractionDigits: 0,
                                },
                              )}g`
                            : "="}
                      </span>
                    ) : null
                  }
                />

                {mode === "craft" && isCraftable && subEntry ? (
                  <li className="border-muted-foreground/20 my-0.5 ml-3 border-l-2 pl-3">
                    <InlineRecipeTree
                      entry={subEntry}
                      producedItemId={item.id}
                      priceMap={priceMap}
                      overrideMap={overrideMap}
                      proficiencyMap={proficiencyMap}
                      subcraftMap={subcraftMap}
                      modes={modes}
                      selectedCrafts={selectedCrafts}
                      setItemMode={setItemMode}
                      setSelectedCrafts={setSelectedCrafts}
                      collapsedCraftIds={collapsedCraftIds}
                      toggleCollapsed={toggleCollapsed}
                      depth={depth + 1}
                    />
                  </li>
                ) : null}
              </Fragment>
            );
          })}
        </ul>
      ) : null}
    </RecipeCardShell>
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
  priceMap: Map<
    number,
    { avg24h: string | null; avg7d: string | null; avg30d: string | null }
  >;
}) {
  const override = overrideMap.get(itemId);
  const unitPrice = getItemPrice(itemId, priceMap, overrideMap);

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
