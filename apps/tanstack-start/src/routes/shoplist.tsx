import type { inferProcedureOutput } from "@trpc/server";
import type React from "react";
import { Fragment, Suspense, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import type { AppRouter } from "@acme/api";

import { ItemIcon } from "~/component/item-icon";
import { ProficiencyBadge } from "~/component/proficiency";
import { pickPreferredCraft } from "~/lib/craft-helpers";
import { getDiscountedLabor } from "~/lib/proficiency";
import type { ProficiencyMap } from "~/lib/proficiency";
import { useTRPC } from "~/lib/trpc";
import { useUserData } from "~/lib/useUserData";

const searchSchema = z
  .object({
    craft: z.coerce.number().int().optional(),
    simItem: z.coerce.number().int().optional(),
    qty: z.coerce.number().int().min(1).default(1),
    attempts: z.coerce.number().int().min(1).optional(),
    sub: z.string().optional(),
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
  return (
    <main className="container py-16">
      <Suspense fallback={<p>Loading...</p>}>
        <ShoplistDetail craftId={craftId} simItemId={simItemId} />
      </Suspense>
    </main>
  );
}

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

type Material = {
  item: { id: number; name: string; icon: string | null };
  amount: number;
};

type RecipeEntry = {
  craft: {
    id: number;
    name: string;
    labor: number;
    proficiency: string | null;
  };
  materials: Material[];
  products: {
    item: { id: number };
    amount: number;
  }[];
};

type ShoppingListItem = {
  item: { id: number; name: string; icon: string | null };
  totalAmount: number;
};

function getItemPrice(
  itemId: number,
  priceMap: PriceMap,
  overrideMap: OverrideMap,
): number {
  const custom = overrideMap.get(itemId);
  if (custom != null) return custom;
  const price = priceMap.get(itemId);
  return parseFloat(price?.avg24h ?? price?.avg7d ?? "0");
}

function buildShoppingList(
  materials: Material[],
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
      const sub = pickPreferredCraft(subcraftMap[item.id]!, item.id);
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
      if (existing) existing.totalAmount += scaled;
      else acc.set(item.id, { item, totalAmount: scaled });
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
      const sub = pickPreferredCraft(subcraftMap[item.id]!, item.id);
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

function getSimulationChain(
  mainCraft: {
    materials: Material[];
  },
  subcraftMap: SubcraftMap,
): { keyMaterialId: number | null; keyMaterialName: string | null } {
  const tierList = [
    "illustrious",
    "magnificent",
    "epherium",
    "delphinad",
    "ayanad",
  ] as const;

  for (const mat of mainCraft.materials) {
    const name = mat.item.name.toLowerCase();
    if (tierList.some((tier) => name.includes(tier))) {
      return { keyMaterialId: mat.item.id, keyMaterialName: mat.item.name };
    }
  }

  for (const mat of mainCraft.materials) {
    if (subcraftMap[mat.item.id]?.length) {
      return { keyMaterialId: mat.item.id, keyMaterialName: mat.item.name };
    }
  }

  return { keyMaterialId: null, keyMaterialName: null };
}

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

function RecipeTree({
  entry,
  priceMap,
  overrideMap,
  proficiencyMap,
  subcraftMap,
  craftModeSet,
  toggleMode,
  depth = 0,
}: {
  entry: RecipeEntry | SubcraftEntry;
  priceMap: PriceMap;
  overrideMap: OverrideMap;
  proficiencyMap: ProficiencyMap;
  subcraftMap: SubcraftMap;
  craftModeSet: Set<number>;
  toggleMode: (itemId: number) => void;
  depth?: number;
}) {
  const { craft, materials } = entry;

  const getCraftCostPerUnit = (itemId: number): number => {
    const subEntries = subcraftMap[itemId];
    if (!subEntries) return 0;
    const sub = pickPreferredCraft(subEntries, itemId);
    const batchCost = sub.materials.reduce((sum, { item, amount }) => {
      return sum + getItemPrice(item.id, priceMap, overrideMap) * amount;
    }, 0);
    const produced =
      sub.products.find((p) => p.item.id === itemId)?.amount ?? 1;
    return batchCost / produced;
  };

  const total = materials.reduce((sum, { item, amount }) => {
    const isCraftable = depth < 4 && !!subcraftMap[item.id];
    const buyUnit = getItemPrice(item.id, priceMap, overrideMap);
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
    <div
      className={`rounded-md border ${depth > 0 ? "bg-muted/20 border-dashed" : ""} p-3`}
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <p className={`truncate font-semibold ${depth > 0 ? "text-sm" : ""}`}>
            {craft.name}
          </p>
          <ProficiencyBadge proficiency={craft.proficiency} />
          {craft.labor > 0 && (
            <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
              {getDiscountedLabor(
                craft.labor,
                craft.proficiency,
                proficiencyMap,
              )}{" "}
              labor
            </span>
          )}
        </div>
        {hasPrices && (
          <p className="shrink-0 text-sm font-medium tabular-nums">
            <span className="text-muted-foreground mr-1 text-xs font-normal">
              materials
            </span>
            <span className="text-primary">
              {total.toLocaleString(undefined, { maximumFractionDigits: 0 })}g
            </span>
          </p>
        )}
      </div>

      <ul className="flex flex-col gap-1">
        {materials.map(({ item, amount }) => {
          const isCraftable = depth < 4 && !!subcraftMap[item.id];
          const mode = craftModeSet.has(item.id) ? "craft" : "buy";
          const customPrice = overrideMap.get(item.id);
          const price = priceMap.get(item.id);
          const isCustom = customPrice != null;
          const buyUnit = getItemPrice(item.id, priceMap, overrideMap);
          const craftUnit = isCraftable ? getCraftCostPerUnit(item.id) : 0;
          const unit = mode === "craft" && isCraftable ? craftUnit : buyUnit;
          const lineTotal = unit * amount;
          const hasPrice = isCustom || !!price;
          const totalDiff =
            isCraftable && hasPrice ? (buyUnit - craftUnit) * amount : null;
          const subEntry = isCraftable
            ? pickPreferredCraft(subcraftMap[item.id]!, item.id)
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
              <li className="hover:bg-muted/40 flex items-center gap-2 rounded px-1 py-1 text-sm">
                <ItemIcon icon={item.icon} name={item.name} />
                <span className="min-w-0 flex-1 truncate">
                  {item.name}
                  {amount > 1 && (
                    <span className="text-muted-foreground ml-1 text-xs">
                      ×{amount}
                    </span>
                  )}
                </span>

                {isCraftable && (
                  <span className="inline-flex overflow-hidden rounded-full border text-xs">
                    <button
                      onClick={() => toggleMode(item.id)}
                      className={`px-2.5 py-0.5 transition-colors ${
                        mode === "buy"
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Buy
                    </button>
                    <button
                      onClick={() => toggleMode(item.id)}
                      className={`px-2.5 py-0.5 transition-colors ${
                        mode === "craft"
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Craft
                    </button>
                  </span>
                )}

                {(hasPrice || mode === "craft") && (
                  <span className="text-muted-foreground shrink-0 tabular-nums">
                    {isCustom && mode === "buy" && (
                      <span className="text-primary mr-1 text-xs">(custom)</span>
                    )}
                    {mode === "craft" && isCraftable && subLabor > 0 && (
                      <span className="mr-1 text-xs text-amber-500">
                        {subLabor}L +
                      </span>
                    )}
                    <span className="text-foreground/70">
                      {unit.toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })}
                      g
                    </span>
                    {amount > 1 && (
                      <span className="text-foreground ml-1.5 font-medium">
                        ={" "}
                        {lineTotal.toLocaleString(undefined, {
                          maximumFractionDigits: 0,
                        })}
                        g
                      </span>
                    )}
                  </span>
                )}

                {totalDiff !== null && (
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
                )}
              </li>

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
                    depth={depth + 1}
                  />
                </li>
              )}
            </Fragment>
          );
        })}
      </ul>

      {depth === 0 && hasCraftable && (
        <div className="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-0.5 border-t pt-2 text-xs">
          <span>
            <span className="font-medium text-green-600 dark:text-green-400">
              ↓ Xg
            </span>{" "}
            craft saves gold
          </span>
          <span>
            <span className="font-medium text-red-500">↑ Xg</span> craft costs
            more
          </span>
          <span>
            <span className="font-medium text-amber-500">XL</span> labor to
            craft
          </span>
          <span>toggle Buy / Craft per ingredient</span>
        </div>
      )}
    </div>
  );
}

function ShoplistDetail({
  craftId,
  simItemId,
}: {
  craftId?: number;
  simItemId?: number;
}) {
  const trpc = useTRPC();
  const navigate = useNavigate({ from: "/shoplist" });
  const { qty, sub, attempts } = Route.useSearch();
  const isSimulator = simItemId != null;

  const craftQuery = useQuery({
    ...trpc.crafts.forCraft.queryOptions(craftId ?? -1),
    enabled: !isSimulator && craftId != null,
  });
  const simulatorQuery = useQuery({
    ...trpc.crafts.forItem.queryOptions(simItemId ?? -1),
    enabled: isSimulator && simItemId != null,
  });

  const craftData = craftQuery.data ?? null;
  const simulatorData = simulatorQuery.data ?? null;
  const { proficiencyMap, overrideMap } = useUserData();

  const [localQty, setLocalQty] = useState(qty);
  useEffect(() => {
    setLocalQty(qty);
  }, [qty]);

  const priceMap: PriceMap = useMemo(() => {
    const prices = isSimulator ? simulatorData?.prices : craftData?.prices;
    return new Map(prices?.map((p) => [p.itemId, p]) ?? []);
  }, [craftData, isSimulator, simulatorData]);

  const craftModeSet = useMemo(
    () => new Set((sub ?? "").split(",").filter(Boolean).map(Number)),
    [sub],
  );

  const toggleMode = (itemId: number) => {
    const next = new Set(craftModeSet);
    if (next.has(itemId)) next.delete(itemId);
    else next.add(itemId);
    const newSub = [...next].sort((a, b) => a - b).join(",") || undefined;
    void navigate({ search: (prev) => ({ ...prev, sub: newSub }) });
  };

  const commitQty = (val: number) => {
    const clamped = Math.max(1, Math.floor(val));
    void navigate({ search: (prev) => ({ ...prev, qty: clamped }) });
  };

  const craftSubcraftMap = craftData?.subcraftsByItemId ?? {};
  const craftScaledEntry = useMemo(
    () =>
      craftData
        ? {
            craft: craftData.craft,
            materials: craftData.materials.map((m) => ({
              ...m,
              amount: m.amount * qty,
            })),
            products: craftData.products,
          }
        : null,
    [craftData, qty],
  );
  const craftShoppingList = useMemo(() => {
    if (!craftData) return [];
    const acc = new Map<number, ShoppingListItem>();
    buildShoppingList(
      craftData.materials,
      craftModeSet,
      craftSubcraftMap,
      0,
      acc,
      qty,
    );
    return [...acc.values()].sort((a, b) => a.item.name.localeCompare(b.item.name));
  }, [craftData, craftModeSet, craftSubcraftMap, qty]);
  const craftLaborByProficiency = useMemo(() => {
    const acc = new Map<string, number>();
    if (!craftData) return acc;
    buildLaborByProficiency(
      craftData.craft,
      craftData.materials,
      craftModeSet,
      craftSubcraftMap,
      0,
      qty,
      acc,
      proficiencyMap,
    );
    return acc;
  }, [craftData, craftModeSet, craftSubcraftMap, proficiencyMap, qty]);

  const simulatorMainCraft = simulatorData?.crafts[0] ?? null;
  const simulatorSubcraftMap = simulatorData?.subcraftsByItemId ?? {};
  const expectedAttempts = attempts ?? 1;
  const simulatorChain = useMemo(
    () =>
      simulatorMainCraft
        ? getSimulationChain(simulatorMainCraft, simulatorSubcraftMap)
        : { keyMaterialId: null, keyMaterialName: null },
    [simulatorMainCraft, simulatorSubcraftMap],
  );
  const attemptEntry = useMemo(
    () =>
      simulatorChain.keyMaterialId != null
        ? pickPreferredCraft(
            simulatorSubcraftMap[simulatorChain.keyMaterialId]!,
            simulatorChain.keyMaterialId,
          )
        : null,
    [simulatorChain.keyMaterialId, simulatorSubcraftMap],
  );
  const scaledAttemptEntry = useMemo(
    () =>
      attemptEntry
        ? {
            craft: attemptEntry.craft,
            materials: attemptEntry.materials.map((m) => ({
              ...m,
              amount: m.amount * expectedAttempts,
            })),
            products: attemptEntry.products,
          }
        : null,
    [attemptEntry, expectedAttempts],
  );
  const finalUpgradeEntry = useMemo(
    () =>
      simulatorMainCraft
        ? {
            craft: simulatorMainCraft.craft,
            materials: simulatorMainCraft.materials.filter(
              ({ item }) => item.id !== simulatorChain.keyMaterialId,
            ),
            products: simulatorMainCraft.products,
          }
        : null,
    [simulatorChain.keyMaterialId, simulatorMainCraft],
  );
  const simulatorShoppingList = useMemo(() => {
    if (!simulatorData || !finalUpgradeEntry) return [];
    const acc = new Map<number, ShoppingListItem>();
    if (attemptEntry && simulatorChain.keyMaterialId != null) {
      buildShoppingList(
        [
          {
            item: {
              id: simulatorChain.keyMaterialId,
              name: simulatorChain.keyMaterialName ?? "",
              icon: null,
            },
            amount: expectedAttempts,
          },
        ],
        craftModeSet,
        simulatorSubcraftMap,
        0,
        acc,
        1,
      );
    }
    buildShoppingList(
      finalUpgradeEntry.materials,
      craftModeSet,
      simulatorSubcraftMap,
      0,
      acc,
      1,
    );
    return [...acc.values()].sort((a, b) => a.item.name.localeCompare(b.item.name));
  }, [
    attemptEntry,
    craftModeSet,
    expectedAttempts,
    finalUpgradeEntry,
    simulatorChain.keyMaterialId,
    simulatorChain.keyMaterialName,
    simulatorData,
    simulatorSubcraftMap,
  ]);
  const simulatorLaborByProficiency = useMemo(() => {
    const acc = new Map<string, number>();
    if (!finalUpgradeEntry) return acc;
    if (attemptEntry) {
      buildLaborByProficiency(
        attemptEntry.craft,
        attemptEntry.materials,
        craftModeSet,
        simulatorSubcraftMap,
        0,
        expectedAttempts,
        acc,
        proficiencyMap,
      );
    }
    buildLaborByProficiency(
      finalUpgradeEntry.craft,
      finalUpgradeEntry.materials,
      craftModeSet,
      simulatorSubcraftMap,
      0,
      1,
      acc,
      proficiencyMap,
    );
    return acc;
  }, [
    attemptEntry,
    craftModeSet,
    expectedAttempts,
    finalUpgradeEntry,
    proficiencyMap,
    simulatorSubcraftMap,
  ]);

  if (!isSimulator && !craftData) return <p>Craft not found.</p>;
  if (isSimulator && !simulatorData) return <p>Craft not found.</p>;

  if (!isSimulator) {
    const data = craftData!;
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
        recipeSections={
          craftScaledEntry
            ? [{ title: "Recipe", entry: craftScaledEntry, note: null }]
            : []
        }
        shoppingList={craftShoppingList}
        laborByProficiency={craftLaborByProficiency}
        priceMap={priceMap}
        overrideMap={overrideMap}
        subcraftMap={craftSubcraftMap}
        craftModeSet={craftModeSet}
        proficiencyMap={proficiencyMap}
        toggleMode={toggleMode}
      />
    );
  }

  const data = simulatorData!;
  if (!finalUpgradeEntry) return <p>Craft not found.</p>;

  return (
    <ShoplistLayout
      backLink={
        <Link
          to="/simulator/$itemId"
          params={{ itemId: data.item.id }}
          className="text-muted-foreground flex items-center gap-1 text-sm hover:underline"
        >
          ← {data.item.name}
        </Link>
      }
      title={data.item.name}
      subtitle="Simulator export"
      icon={data.item.icon}
      quantityLabel="Expected attempts"
      localQty={localQty}
      setLocalQty={setLocalQty}
      commitQty={(val) => {
        const clamped = Math.max(1, Math.floor(val));
        void navigate({ search: (prev) => ({ ...prev, attempts: clamped }) });
      }}
      recipeSections={[
        ...(scaledAttemptEntry
          ? [{ title: "Attempt chain", entry: scaledAttemptEntry, note: null }]
          : []),
        {
          title: "Final upgrade",
          entry: finalUpgradeEntry,
          note: simulatorChain.keyMaterialName
            ? `Consumes 1 successful ${simulatorChain.keyMaterialName} from the attempt chain.`
            : null,
        },
      ]}
      shoppingList={simulatorShoppingList}
      laborByProficiency={simulatorLaborByProficiency}
      priceMap={priceMap}
      overrideMap={overrideMap}
      subcraftMap={simulatorSubcraftMap}
      craftModeSet={craftModeSet}
      proficiencyMap={proficiencyMap}
      toggleMode={toggleMode}
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
  subcraftMap,
  craftModeSet,
  proficiencyMap,
  toggleMode,
}: {
  backLink: React.ReactNode;
  title: string;
  subtitle: string;
  icon: string | null;
  quantityLabel: string;
  localQty: number;
  setLocalQty: (value: number) => void;
  commitQty: (value: number) => void;
  recipeSections: { title: string; entry: RecipeEntry; note: string | null }[];
  shoppingList: ShoppingListItem[];
  laborByProficiency: Map<string, number>;
  priceMap: PriceMap;
  overrideMap: OverrideMap;
  subcraftMap: SubcraftMap;
  craftModeSet: Set<number>;
  proficiencyMap: ProficiencyMap;
  toggleMode: (itemId: number) => void;
}) {
  const totalLabor = useMemo(
    () => [...laborByProficiency.values()].reduce((sum, value) => sum + value, 0),
    [laborByProficiency],
  );

  const totalCost = useMemo(
    () =>
      shoppingList.reduce((sum, { item, totalAmount }) => {
        const unit = getItemPrice(item.id, priceMap, overrideMap);
        return sum + unit * Math.ceil(totalAmount);
      }, 0),
    [overrideMap, priceMap, shoppingList],
  );

  return (
    <div className="flex flex-col gap-6">
      {backLink}

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {icon && <ItemIcon icon={icon} name={title} size="lg" />}
          <div>
            <h1 className="text-3xl font-bold">{title}</h1>
            <p className="text-muted-foreground text-sm">{subtitle}</p>
          </div>
        </div>
        <ShareButton />
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm font-medium" htmlFor="shoplist-qty">
          {quantityLabel}
        </label>
        <input
          id="shoplist-qty"
          type="number"
          min="1"
          value={localQty}
          onChange={(e) => setLocalQty(Number(e.target.value))}
          onBlur={() => commitQty(localQty)}
          onKeyDown={(e) => e.key === "Enter" && commitQty(localQty)}
          className="bg-background w-24 rounded-md border px-3 py-1.5 text-sm tabular-nums"
        />
      </div>

      <div className="flex flex-col gap-4">
        {recipeSections.map((section) => (
          <div key={section.title} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">{section.title}</h2>
              {section.note && (
                <p className="text-muted-foreground text-sm">{section.note}</p>
              )}
            </div>
            <RecipeTree
              entry={section.entry}
              priceMap={priceMap}
              overrideMap={overrideMap}
              proficiencyMap={proficiencyMap}
              subcraftMap={subcraftMap}
              craftModeSet={craftModeSet}
              toggleMode={toggleMode}
            />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Shopping List</h2>
          <div className="flex items-center gap-4">
            {totalLabor > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {[...laborByProficiency.entries()].map(([prof, labor]) => (
                  <ProficiencyBadge
                    key={prof}
                    proficiency={prof}
                    suffix={` ${labor.toLocaleString()}`}
                  />
                ))}
              </div>
            )}
            {totalCost > 0 && (
              <p className="text-sm tabular-nums">
                <span className="text-muted-foreground mr-1 text-xs">total</span>
                <span className="text-primary font-medium">
                  {totalCost.toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })}
                  g
                </span>
              </p>
            )}
          </div>
        </div>
        <ul className="flex flex-col gap-1 rounded-md border p-3">
          {shoppingList.map(({ item, totalAmount }) => {
            const custom = overrideMap.get(item.id);
            const unit = getItemPrice(item.id, priceMap, overrideMap);
            const qtyCeil = Math.ceil(totalAmount);
            const lineTotal = unit * qtyCeil;
            return (
              <li
                key={item.id}
                className="hover:bg-muted/40 flex items-center gap-2 rounded px-1 py-1 text-sm"
              >
                <ItemIcon icon={item.icon} name={item.name} />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  <span className="text-foreground font-medium">
                    ×{qtyCeil.toLocaleString()}
                  </span>
                  {unit > 0 && (
                    <span className="ml-2">
                      {custom != null && (
                        <span className="text-primary mr-1 text-xs">
                          (custom)
                        </span>
                      )}
                      {lineTotal.toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })}
                      g
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
