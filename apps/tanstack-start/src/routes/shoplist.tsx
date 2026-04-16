import type { inferProcedureOutput } from "@trpc/server";
import type React from "react";
import { Fragment, Suspense, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import type { AppRouter } from "@acme/api";
import { Button } from "@acme/ui/button";
import { Input } from "@acme/ui/input";
import { toast } from "@acme/ui/toast";

import type { ProficiencyMap } from "~/lib/proficiency";
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
import { pickPreferredCraft } from "~/lib/craft-helpers";
import { getDiscountedLabor } from "~/lib/proficiency";
import {
  getSimulationChain,
  pickCheapestCraftForItem,
  useAyanadUpgradeData,
} from "~/lib/simulator-upgrade";
import { useTRPC } from "~/lib/trpc";
import { useUserData } from "~/lib/useUserData";

const searchSchema = z
  .object({
    craft: z.coerce.number().int().optional(),
    simItem: z.coerce.number().int().optional(),
    qty: z.coerce.number().int().min(1).default(1),
    attempts: z.coerce.number().int().min(1).optional(),
    sub: z.string().optional(),
    listId: z.string().uuid().optional(),
  })
  .refine((value) => value.craft != null || value.simItem != null, {
    message: "craft or simItem is required",
  });

export const Route = createFileRoute("/shoplist")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({
    craftId: search.craft,
    simItemId: search.simItem,
  }),
  loader: async ({ context, deps }) => {
    const { trpc, queryClient } = context;
    if (deps.simItemId != null) {
      await queryClient.fetchQuery(
        trpc.crafts.forItem.queryOptions(deps.simItemId),
      );
      return;
    }
    if (deps.craftId == null) return;
    await queryClient.fetchQuery(
      trpc.crafts.forCraft.queryOptions(deps.craftId),
    );
  },
  component: ShoplistPage,
  errorComponent: () => <p>Craft not found.</p>,
});

function ShoplistPage() {
  const { craft: craftId, simItem: simItemId } = Route.useSearch();
  if (craftId == null && simItemId == null) {
    return (
      <main className="container py-16">
        <p>Craft not found.</p>
      </main>
    );
  }
  return (
    <main className="container py-16">
      <Suspense fallback={<p>Loading...</p>}>
        <ShoplistDetail craftId={craftId} simItemId={simItemId} />
      </Suspense>
    </main>
  );
}

// ─── Types ───────────────────────────────────────────────────────────────────

type ForCraftOutput = NonNullable<
  inferProcedureOutput<AppRouter["crafts"]["forCraft"]>
>;
type ForItemOutput = NonNullable<
  inferProcedureOutput<AppRouter["crafts"]["forItem"]>
>;
type SubcraftEntry =
  | ForCraftOutput["subcraftsByItemId"][number][number]
  | ForItemOutput["subcraftsByItemId"][number][number];
type SubcraftMap = Record<number, SubcraftEntry[]>;
type PriceMap = Map<number, { avg24h: string | null; avg7d: string | null }>;
type OverrideMap = Map<number, number>;
interface RecipeEntry {
  craft: {
    id: number;
    name: string;
    labor: number;
    proficiency: string | null;
  };
  materials: {
    item: { id: number; name: string; icon: string | null };
    amount: number;
  }[];
  products: { item: { id: number }; amount: number }[];
}

// ─── Flat shopping list ───────────────────────────────────────────────────────

interface ShoppingListItem {
  item: { id: number; name: string; icon: string | null };
  totalAmount: number;
}

function buildShoppingList(
  materials: {
    item: { id: number; name: string; icon: string | null };
    amount: number;
  }[],
  craftModeSet: Set<number>,
  subcraftMap: SubcraftMap,
  depth: number,
  acc: Map<number, ShoppingListItem>,
  scaleFactor: number,
): void {
  for (const { item, amount } of materials) {
    const scaled = amount * scaleFactor;
    const isCraftable = depth < 4 && !!subcraftMap[item.id];
    if (craftModeSet.has(item.id) && isCraftable) {
      const subEntries = subcraftMap[item.id];
      if (!subEntries?.length) continue;
      const sub = pickPreferredCraft(subEntries, item.id);
      const produced =
        sub.products.find((p) => p.item.id === item.id)?.amount ?? 1;
      buildShoppingList(
        sub.materials,
        craftModeSet,
        subcraftMap,
        depth + 1,
        acc,
        scaled / produced,
      );
    } else {
      const existing = acc.get(item.id);
      if (existing) {
        existing.totalAmount += scaled;
      } else {
        acc.set(item.id, { item, totalAmount: scaled });
      }
    }
  }
}

function buildLaborByProficiency(
  craft: { labor: number; proficiency: string | null },
  materials: { item: { id: number }; amount: number }[],
  craftModeSet: Set<number>,
  subcraftMap: SubcraftMap,
  depth: number,
  scaleFactor: number,
  acc: Map<string, number>,
  proficiencyMap: ProficiencyMap,
): void {
  const batches = Math.ceil(scaleFactor);
  if (craft.labor > 0) {
    const key = craft.proficiency ?? "Unknown";
    const perBatch = getDiscountedLabor(
      craft.labor,
      craft.proficiency,
      proficiencyMap,
    );
    acc.set(key, (acc.get(key) ?? 0) + batches * perBatch);
  }
  for (const { item, amount } of materials) {
    const scaled = amount * scaleFactor;
    const isCraftable = depth < 4 && !!subcraftMap[item.id];
    if (craftModeSet.has(item.id) && isCraftable) {
      const subEntries = subcraftMap[item.id];
      if (!subEntries?.length) continue;
      const sub = pickPreferredCraft(subEntries, item.id);
      const produced =
        sub.products.find((p) => p.item.id === item.id)?.amount ?? 1;
      buildLaborByProficiency(
        sub.craft,
        sub.materials,
        craftModeSet,
        subcraftMap,
        depth + 1,
        scaled / produced,
        acc,
        proficiencyMap,
      );
    }
  }
}

// ─── Share button ─────────────────────────────────────────────────────────────

function ShareButton() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      className="bg-muted hover:bg-muted/80 rounded-md border px-3 py-1.5 text-sm transition-colors"
    >
      {copied ? "Copied!" : "Copy Link"}
    </button>
  );
}

// ─── Recipe display ───────────────────────────────────────────────────────────

function RecipeTree({
  entry,
  priceMap,
  overrideMap,
  proficiencyMap,
  subcraftMap,
  craftModeSet,
  toggleMode,
  collapsedCraftIds,
  toggleCollapsed,
  depth = 0,
}: {
  entry: RecipeEntry | SubcraftEntry;
  priceMap: PriceMap;
  overrideMap: OverrideMap;
  proficiencyMap: ProficiencyMap;
  subcraftMap: SubcraftMap;
  craftModeSet: Set<number>;
  toggleMode: (itemId: number) => void;
  collapsedCraftIds: Set<number>;
  toggleCollapsed: (craftId: number) => void;
  depth?: number;
}) {
  const { craft, materials } = entry;
  const isCollapsed = collapsedCraftIds.has(craft.id);

  const getCraftCostPerUnit = (itemId: number): number => {
    const subEntries = subcraftMap[itemId];
    if (!subEntries) return 0;
    const sub = pickPreferredCraft(subEntries, itemId);
    const batchCost = sub.materials.reduce((sum, { item, amount }) => {
      const custom = overrideMap.get(item.id);
      const price = priceMap.get(item.id);
      const u = custom ?? parseFloat(price?.avg24h ?? price?.avg7d ?? "0");
      return sum + u * amount;
    }, 0);
    const produced =
      sub.products.find((p) => p.item.id === itemId)?.amount ?? 1;
    return batchCost / produced;
  };

  const total = materials.reduce((sum, { item, amount }) => {
    const isCraftable = depth < 4 && !!subcraftMap[item.id];
    const custom = overrideMap.get(item.id);
    const price = priceMap.get(item.id);
    const buyUnit = custom ?? parseFloat(price?.avg24h ?? price?.avg7d ?? "0");
    const unit =
      craftModeSet.has(item.id) && isCraftable
        ? getCraftCostPerUnit(item.id)
        : buyUnit;
    return sum + unit * amount;
  }, 0);

  const hasPrices = priceMap.size > 0 || overrideMap.size > 0;
  const hasCraftable = materials.some(
    ({ item }) => depth < 4 && !!subcraftMap[item.id],
  );

  return (
    <RecipeCardShell depth={depth}>
      <RecipeHeader
        depth={depth}
        title={craft.name}
        proficiency={craft.proficiency}
        laborLabel={
          craft.labor > 0
            ? `${getDiscountedLabor(craft.labor, craft.proficiency, proficiencyMap)} labor`
            : null
        }
        materialsLabel={
          hasPrices
            ? `${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}g`
            : null
        }
        collapseToggle={
          <RecipeCollapseToggle
            collapsed={isCollapsed}
            onToggle={() => toggleCollapsed(craft.id)}
          />
        }
      />

      {!isCollapsed && (
        <>
          <ul className="flex flex-col gap-1">
            {materials.map(({ item, amount }) => {
              const isCraftable = depth < 4 && !!subcraftMap[item.id];
              const mode = craftModeSet.has(item.id) ? "craft" : "buy";
              const customPrice = overrideMap.get(item.id);
              const price = priceMap.get(item.id);
              const isCustom = customPrice != null;
              const buyUnit = isCustom
                ? customPrice
                : parseFloat(price?.avg24h ?? price?.avg7d ?? "0");
              const craftUnit = isCraftable ? getCraftCostPerUnit(item.id) : 0;
              const unit =
                mode === "craft" && isCraftable ? craftUnit : buyUnit;
              const lineTotal = unit * amount;
              const hasPrice = isCustom || !!price;
              const totalDiff =
                isCraftable && hasPrice ? (buyUnit - craftUnit) * amount : null;
              const subEntry = isCraftable
                ? pickPreferredCraft(subcraftMap[item.id] ?? [], item.id)
                : null;
              const subLabor = subEntry
                ? getDiscountedLabor(
                    subEntry.craft.labor,
                    subEntry.craft.proficiency,
                    proficiencyMap,
                  )
                : 0;

              return (
                <Fragment key={item.id}>
                  <RecipeItemRow
                    icon={<ItemIcon icon={item.icon} name={item.name} />}
                    name={item.name}
                    amount={amount}
                    controls={
                      isCraftable ? (
                        <CraftModeToggle
                          mode={mode}
                          onBuy={() => toggleMode(item.id)}
                          onCraft={() => toggleMode(item.id)}
                        />
                      ) : null
                    }
                    value={
                      hasPrice || mode === "craft" ? (
                        <span className="text-muted-foreground shrink-0 tabular-nums">
                          {isCustom && mode === "buy" ? (
                            <span className="text-primary mr-1 text-xs">
                              (custom)
                            </span>
                          ) : null}
                          {mode === "craft" && isCraftable && subLabor > 0 ? (
                            <span className="mr-1 text-xs text-amber-500">
                              {subLabor}L +
                            </span>
                          ) : null}
                          <span className="text-foreground/70">
                            {unit.toLocaleString(undefined, {
                              maximumFractionDigits: 0,
                            })}
                            g
                          </span>
                          {amount > 1 ? (
                            <span className="text-foreground ml-1.5 font-medium">
                              ={" "}
                              {lineTotal.toLocaleString(undefined, {
                                maximumFractionDigits: 0,
                              })}
                              g
                            </span>
                          ) : null}
                        </span>
                      ) : null
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
                            ? `↓ ${totalDiff.toLocaleString(undefined, { maximumFractionDigits: 0 })}g`
                            : totalDiff < 0
                              ? `↑ ${Math.abs(totalDiff).toLocaleString(undefined, { maximumFractionDigits: 0 })}g`
                              : "="}
                        </span>
                      ) : null
                    }
                  />

                  {mode === "craft" && isCraftable && subEntry && (
                    <li className="border-muted-foreground/20 my-0.5 ml-3 border-l-2 pl-3">
                      <RecipeTree
                        entry={subEntry}
                        priceMap={priceMap}
                        overrideMap={overrideMap}
                        proficiencyMap={proficiencyMap}
                        subcraftMap={subcraftMap}
                        craftModeSet={craftModeSet}
                        toggleMode={toggleMode}
                        collapsedCraftIds={collapsedCraftIds}
                        toggleCollapsed={toggleCollapsed}
                        depth={depth + 1}
                      />
                    </li>
                  )}
                </Fragment>
              );
            })}
          </ul>

          {depth === 0 && hasCraftable ? <RecipeLegend /> : null}
        </>
      )}
    </RecipeCardShell>
  );
}

// ─── Main detail component ────────────────────────────────────────────────────

function ShoplistDetail({
  craftId,
  simItemId,
}: {
  craftId?: number;
  simItemId?: number;
}) {
  const trpc = useTRPC();
  const navigate = useNavigate({ from: "/shoplist" });
  const queryClient = useQueryClient();
  const { qty, sub, attempts, listId } = Route.useSearch();
  const isSimulator = simItemId != null;

  const craftQuery = useQuery({
    ...trpc.crafts.forCraft.queryOptions(craftId ?? -1),
    enabled: !isSimulator && craftId != null,
  });
  const simulatorQuery = useQuery({
    ...trpc.crafts.forItem.queryOptions(simItemId ?? -1),
    enabled: isSimulator,
  });
  const existingList = useQuery({
    ...trpc.shoppingLists.getById.queryOptions(listId ?? ""),
    enabled: !!listId,
  });

  const craftData = craftQuery.data ?? null;
  const simulatorData = simulatorQuery.data ?? null;
  const { proficiencyMap, overrideMap } = useUserData();

  const effectiveQty = isSimulator ? (attempts ?? 1) : qty;
  const [localQty, setLocalQty] = useState(effectiveQty);
  const [listName, setListName] = useState("");

  useEffect(() => {
    setLocalQty(effectiveQty);
  }, [effectiveQty]);

  useEffect(() => {
    if (existingList.data?.list.name) {
      setListName(existingList.data.list.name);
      return;
    }
    if (isSimulator && simulatorData?.item.name) {
      setListName(`${simulatorData.item.name} attempt plan`);
      return;
    }
    if (craftData?.item?.name) {
      setListName(craftData.item.name);
      return;
    }
    setListName("");
  }, [
    craftData?.item?.name,
    existingList.data?.list.name,
    isSimulator,
    simulatorData?.item.name,
  ]);

  const priceMap: PriceMap = useMemo(() => {
    const prices = isSimulator ? simulatorData?.prices : craftData?.prices;
    return new Map(prices?.map((p) => [p.itemId, p]) ?? []);
  }, [craftData?.prices, isSimulator, simulatorData?.prices]);

  const craftModeSet = useMemo(
    () => new Set<number>((sub ?? "").split(",").filter(Boolean).map(Number)),
    [sub],
  );
  const craftModes = useMemo(
    () =>
      Object.fromEntries(
        Array.from(craftModeSet).map((itemId) => [itemId, "craft" as const]),
      ),
    [craftModeSet],
  );
  const [collapsedCraftIds, setCollapsedCraftIds] = useState<Set<number>>(
    () => new Set(),
  );

  const toggleMode = (itemId: number) => {
    const next = new Set(craftModeSet);
    if (next.has(itemId)) next.delete(itemId);
    else next.add(itemId);
    const serializedSub = Array.from(next)
      .sort((a, b) => a - b)
      .join(",");
    const newSub = serializedSub === "" ? undefined : serializedSub;
    void navigate({ search: (prev) => ({ ...prev, sub: newSub }) });
  };
  const toggleCollapsed = (craftId: number) => {
    setCollapsedCraftIds((prev) => {
      const next = new Set(prev);
      if (next.has(craftId)) next.delete(craftId);
      else next.add(craftId);
      return next;
    });
  };

  const commitQty = (value: number) => {
    const clamped = Math.max(1, Math.floor(value));
    if (isSimulator) {
      void navigate({ search: (prev) => ({ ...prev, attempts: clamped }) });
      return;
    }
    void navigate({ search: (prev) => ({ ...prev, qty: clamped }) });
  };

  const simulatorSubcraftMap = simulatorData?.subcraftsByItemId ?? {};
  const { ayanadItem, ayanadCraftData } = useAyanadUpgradeData(
    simulatorData?.item.name ?? null,
  );
  const simulatorMainCraft = useMemo(() => {
    if (!simulatorData?.crafts.length) return null;
    if (craftId != null) {
      return (
        simulatorData.crafts.find((entry) => entry.craft.id === craftId) ??
        simulatorData.crafts[0] ??
        null
      );
    }
    return simulatorData.crafts[0] ?? null;
  }, [craftId, simulatorData?.crafts]);
  const ayanadCraft = useMemo(() => {
    if (!ayanadCraftData?.crafts.length || ayanadItem == null) return null;
    return pickCheapestCraftForItem(
      ayanadCraftData.crafts,
      ayanadItem.id,
      ayanadCraftData.subcraftsByItemId,
      priceMap,
      overrideMap,
      craftModes,
    );
  }, [ayanadCraftData, ayanadItem, craftModes, overrideMap, priceMap]);

  const craftSubcraftMap = craftData?.subcraftsByItemId ?? {};

  const createCraftList = useMutation(
    trpc.shoppingLists.createFromCraft.mutationOptions(),
  );
  const createSimulatorList = useMutation(
    trpc.shoppingLists.createFromSimulator.mutationOptions(),
  );
  const updateList = useMutation(
    trpc.shoppingLists.updateDefinition.mutationOptions(),
  );

  const persistList = useMutation({
    mutationFn: async () => {
      const craftModeItemIds = Array.from(craftModeSet);
      if (isSimulator) {
        if (!simItemId || !simulatorMainCraft) {
          throw new Error("Simulator source unavailable.");
        }
        if (listId) {
          return updateList.mutateAsync({
            listId,
            name: listName.trim() || undefined,
            sourceType: "simulator",
            itemId: simItemId,
            craftId: simulatorMainCraft.craft.id,
            quantity: effectiveQty,
            craftModeItemIds,
          });
        }
        return createSimulatorList.mutateAsync({
          itemId: simItemId,
          craftId: simulatorMainCraft.craft.id,
          attempts: effectiveQty,
          craftModeItemIds,
          name: listName.trim() || undefined,
        });
      }

      if (!craftId) {
        throw new Error("Craft source unavailable.");
      }

      if (listId) {
        return updateList.mutateAsync({
          listId,
          name: listName.trim() || undefined,
          sourceType: "craft",
          craftId,
          quantity: effectiveQty,
          craftModeItemIds,
        });
      }

      return createCraftList.mutateAsync({
        craftId,
        quantity: effectiveQty,
        craftModeItemIds,
        name: listName.trim() || undefined,
      });
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries(
          trpc.shoppingLists.listMineAndShared.pathFilter(),
        ),
        queryClient.invalidateQueries(trpc.shoppingLists.getById.pathFilter()),
      ]);
      toast.success(
        listId ? "Shopping list updated." : "Shopping list created.",
      );
      await navigate({
        to: "/shoplists/$listId",
        params: { listId: result.id },
      });
    },
    onError: () => {
      toast.error(
        listId
          ? "Failed to update shopping list."
          : "Failed to create shopping list.",
      );
    },
  });

  if (!isSimulator && !craftData) return <p>Craft not found.</p>;
  if (isSimulator && (!simulatorData || !simulatorMainCraft)) {
    return <p>Craft not found.</p>;
  }

  if (!isSimulator) {
    if (!craftData) {
      return <p>Craft not found.</p>;
    }
    const data = craftData;
    const scaledEntry: RecipeEntry = {
      craft: data.craft,
      materials: data.materials.map((material) => ({
        ...material,
        amount: material.amount * qty,
      })),
      products: data.products,
    };
    const shoppingList = (() => {
      const acc = new Map<number, ShoppingListItem>();
      buildShoppingList(
        data.materials,
        craftModeSet,
        craftSubcraftMap,
        0,
        acc,
        qty,
      );
      return Array.from(acc.values()).sort((a, b) =>
        a.item.name.localeCompare(b.item.name),
      );
    })();
    const laborByProficiency = (() => {
      const acc = new Map<string, number>();
      buildLaborByProficiency(
        data.craft,
        data.materials,
        craftModeSet,
        craftSubcraftMap,
        0,
        qty,
        acc,
        proficiencyMap,
      );
      return acc;
    })();

    return (
      <ShoplistLayout
        backLink={
          data.item ? (
            <Link
              to="/craft/$itemId"
              params={{ itemId: data.item.id }}
              className="text-muted-foreground flex items-center gap-1 text-sm hover:underline"
            >
              ← {data.item.name}
            </Link>
          ) : null
        }
        title={data.item?.name ?? data.craft.name}
        subtitle={data.craft.name}
        icon={data.item?.icon ?? null}
        quantityLabel="Number of crafts"
        localQty={localQty}
        setLocalQty={setLocalQty}
        commitQty={commitQty}
        recipeSections={[
          {
            title: "Recipe",
            entry: scaledEntry,
            note: null,
            subcraftMap: craftSubcraftMap,
          },
        ]}
        shoppingList={shoppingList}
        laborByProficiency={laborByProficiency}
        priceMap={priceMap}
        overrideMap={overrideMap}
        craftModeSet={craftModeSet}
        proficiencyMap={proficiencyMap}
        toggleMode={toggleMode}
        collapsedCraftIds={collapsedCraftIds}
        toggleCollapsed={toggleCollapsed}
        listName={listName}
        setListName={setListName}
        listId={listId}
        persistList={persistList.mutate}
        persistListPending={persistList.isPending}
      />
    );
  }

  const simulatorSource = simulatorData;
  const simulatorCraft = simulatorMainCraft;
  if (!simulatorSource || !simulatorCraft) {
    return <p>Craft not found.</p>;
  }

  const simulatorChain = getSimulationChain(
    simulatorCraft,
    simulatorSubcraftMap,
  );
  const scaledAttemptEntry: RecipeEntry = {
    craft: simulatorCraft.craft,
    materials: simulatorCraft.materials.map((material) => ({
      ...material,
      amount: material.amount * effectiveQty,
    })),
    products: simulatorCraft.products,
  };
  const finalUpgradeSubcraftMap =
    ayanadCraftData?.subcraftsByItemId ?? simulatorSubcraftMap;
  const finalUpgradeEntry: RecipeEntry | null = ayanadCraft
    ? {
        craft: ayanadCraft.craft,
        materials: ayanadCraft.materials.filter(({ item }) => {
          const lower = item.name.toLowerCase();
          return !(lower.includes("delphinad") || lower.includes("ayanad"));
        }),
        products: ayanadCraft.products,
      }
    : null;
  const simulatorShoppingList = (() => {
    const acc = new Map<number, ShoppingListItem>();
    buildShoppingList(
      simulatorCraft.materials,
      craftModeSet,
      simulatorSubcraftMap,
      0,
      acc,
      effectiveQty,
    );
    if (finalUpgradeEntry) {
      buildShoppingList(
        finalUpgradeEntry.materials,
        craftModeSet,
        finalUpgradeSubcraftMap,
        0,
        acc,
        1,
      );
    }
    return Array.from(acc.values()).sort((a, b) =>
      a.item.name.localeCompare(b.item.name),
    );
  })();
  const simulatorLaborByProficiency = (() => {
    const acc = new Map<string, number>();
    buildLaborByProficiency(
      simulatorCraft.craft,
      simulatorCraft.materials,
      craftModeSet,
      simulatorSubcraftMap,
      0,
      effectiveQty,
      acc,
      proficiencyMap,
    );
    if (finalUpgradeEntry) {
      buildLaborByProficiency(
        finalUpgradeEntry.craft,
        finalUpgradeEntry.materials,
        craftModeSet,
        finalUpgradeSubcraftMap,
        0,
        1,
        acc,
        proficiencyMap,
      );
    }
    return acc;
  })();

  return (
    <ShoplistLayout
      backLink={
        <Link
          to="/simulator/$itemId"
          params={{ itemId: simItemId }}
          className="text-muted-foreground flex items-center gap-1 text-sm hover:underline"
        >
          ← {simulatorSource.item.name}
        </Link>
      }
      title={simulatorSource.item.name}
      subtitle="Simulator export"
      icon={simulatorSource.item.icon}
      quantityLabel="Expected attempts"
      localQty={localQty}
      setLocalQty={setLocalQty}
      commitQty={commitQty}
      recipeSections={[
        {
          title: "Attempt chain",
          entry: scaledAttemptEntry,
          note: null,
          subcraftMap: simulatorSubcraftMap,
        },
        ...(finalUpgradeEntry
          ? [
              {
                title: "Final upgrade",
                entry: finalUpgradeEntry,
                note: simulatorChain.keyMaterialName
                  ? `Consumes 1 successful ${simulatorChain.keyMaterialName} from the attempt chain.`
                  : null,
                subcraftMap: finalUpgradeSubcraftMap,
              },
            ]
          : []),
      ]}
      shoppingList={simulatorShoppingList}
      laborByProficiency={simulatorLaborByProficiency}
      priceMap={priceMap}
      overrideMap={overrideMap}
      craftModeSet={craftModeSet}
      proficiencyMap={proficiencyMap}
      toggleMode={toggleMode}
      collapsedCraftIds={collapsedCraftIds}
      toggleCollapsed={toggleCollapsed}
      listName={listName}
      setListName={setListName}
      listId={listId}
      persistList={persistList.mutate}
      persistListPending={persistList.isPending}
    />
  );
}

function ShoplistLayout({
  backLink,
  title,
  subtitle,
  icon,
  quantityLabel,
  localQty,
  setLocalQty,
  commitQty,
  recipeSections,
  shoppingList,
  laborByProficiency,
  priceMap,
  overrideMap,
  craftModeSet,
  proficiencyMap,
  toggleMode,
  collapsedCraftIds,
  toggleCollapsed,
  listName,
  setListName,
  listId,
  persistList,
  persistListPending,
}: {
  backLink: React.ReactNode;
  title: string;
  subtitle: string;
  icon: string | null;
  quantityLabel: string;
  localQty: number;
  setLocalQty: (value: number) => void;
  commitQty: (value: number) => void;
  recipeSections: {
    title: string;
    entry: RecipeEntry;
    note: string | null;
    subcraftMap: SubcraftMap;
  }[];
  shoppingList: ShoppingListItem[];
  laborByProficiency: Map<string, number>;
  priceMap: PriceMap;
  overrideMap: OverrideMap;
  craftModeSet: Set<number>;
  proficiencyMap: ProficiencyMap;
  toggleMode: (itemId: number) => void;
  collapsedCraftIds: Set<number>;
  toggleCollapsed: (craftId: number) => void;
  listName: string;
  setListName: (value: string) => void;
  listId?: string;
  persistList: () => void;
  persistListPending: boolean;
}) {
  const totalLabor = useMemo(
    () =>
      Array.from(laborByProficiency.values()).reduce(
        (sum, value) => sum + value,
        0,
      ),
    [laborByProficiency],
  );
  const totalCost = useMemo(
    () =>
      shoppingList.reduce((sum, { item, totalAmount }) => {
        const custom = overrideMap.get(item.id);
        const price = priceMap.get(item.id);
        const unit = custom ?? parseFloat(price?.avg24h ?? price?.avg7d ?? "0");
        return sum + unit * Math.ceil(totalAmount);
      }, 0),
    [overrideMap, priceMap, shoppingList],
  );

  return (
    <div className="flex flex-col gap-6">
      {backLink}

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {icon ? <ItemIcon icon={icon} name={title} size="lg" /> : null}
          <div>
            <h1 className="text-3xl font-bold">{title}</h1>
            <p className="text-muted-foreground text-sm">{subtitle}</p>
          </div>
        </div>
        <ShareButton />
      </div>

      <section className="rounded-lg border p-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <label className="flex-1">
            <span className="mb-1 block text-sm font-medium">
              Saved list name
            </span>
            <Input
              value={listName}
              onChange={(event) => setListName(event.target.value)}
              placeholder={title}
            />
          </label>
          <div className="flex gap-2">
            {listId ? (
              <Button asChild variant="outline">
                <Link to="/shoplists/$listId" params={{ listId }}>
                  Back to saved list
                </Link>
              </Button>
            ) : null}
            <Button
              onClick={persistList}
              loading={persistListPending}
              loadingText={listId ? "Updating..." : "Creating..."}
            >
              {listId ? "Update multiplayer list" : "Create multiplayer list"}
            </Button>
          </div>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <label className="text-sm font-medium" htmlFor="shoplist-qty">
          {quantityLabel}
        </label>
        <input
          id="shoplist-qty"
          type="number"
          min="1"
          value={localQty}
          onChange={(event) => setLocalQty(Number(event.target.value))}
          onBlur={() => commitQty(localQty)}
          onKeyDown={(event) => event.key === "Enter" && commitQty(localQty)}
          className="bg-background w-24 rounded-md border px-3 py-1.5 text-sm tabular-nums"
        />
      </div>

      {recipeSections.map((section) => (
        <div key={section.title} className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">{section.title}</h2>
          {section.note ? (
            <p className="text-muted-foreground text-sm">{section.note}</p>
          ) : null}
          <RecipeTree
            entry={section.entry}
            priceMap={priceMap}
            overrideMap={overrideMap}
            proficiencyMap={proficiencyMap}
            subcraftMap={section.subcraftMap}
            craftModeSet={craftModeSet}
            toggleMode={toggleMode}
            collapsedCraftIds={collapsedCraftIds}
            toggleCollapsed={toggleCollapsed}
          />
        </div>
      ))}

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Shopping List</h2>
          <div className="flex items-center gap-4">
            {totalLabor > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {Array.from(laborByProficiency.entries()).map(
                  ([prof, labor]) => (
                    <ProficiencyBadge
                      key={prof}
                      proficiency={prof}
                      suffix={` ${labor.toLocaleString()}`}
                    />
                  ),
                )}
              </div>
            ) : null}
            {totalCost > 0 ? (
              <p className="text-sm tabular-nums">
                <span className="text-muted-foreground mr-1 text-xs">
                  total
                </span>
                <span className="text-primary font-medium">
                  {totalCost.toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })}
                  g
                </span>
              </p>
            ) : null}
          </div>
        </div>
        <ul className="flex flex-col gap-1 rounded-md border p-3">
          {shoppingList.map(({ item, totalAmount }) => {
            const custom = overrideMap.get(item.id);
            const price = priceMap.get(item.id);
            const unit =
              custom ?? parseFloat(price?.avg24h ?? price?.avg7d ?? "0");
            const roundedQuantity = Math.ceil(totalAmount);
            const lineTotal = unit * roundedQuantity;
            return (
              <li
                key={item.id}
                className="hover:bg-muted/40 flex items-center gap-2 rounded px-1 py-1 text-sm"
              >
                <ItemIcon icon={item.icon} name={item.name} />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  <span className="text-foreground font-medium">
                    ×{roundedQuantity.toLocaleString()}
                  </span>
                  {unit > 0 ? (
                    <span className="ml-2">
                      {custom != null ? (
                        <span className="text-primary mr-1 text-xs">
                          (custom)
                        </span>
                      ) : null}
                      {lineTotal.toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })}
                      g
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
