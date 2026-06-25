type ShoplistSourceKind = "empty" | "craft" | "simulator";

interface ShoplistSummary {
  id: string;
  name: string;
  updatedAt: Date;
  sourceKind: ShoplistSourceKind;
}

type SharedShoplistSummary = ShoplistSummary & {
  role: "read" | "write";
};
type AppendableShoplistSummary = ShoplistSummary & {
  sourceKind: "empty" | "craft";
};
type AppendableSharedShoplistSummary = SharedShoplistSummary & {
  sourceKind: "empty" | "craft";
  role: "write";
};

export interface ShoplistDestination {
  id: string;
  name: string;
  updatedAt: Date;
  sourceKind: "empty" | "craft";
  access: "owned" | "shared";
}

function isAppendableSourceKind(
  sourceKind: ShoplistSourceKind,
): sourceKind is "empty" | "craft" {
  return sourceKind === "empty" || sourceKind === "craft";
}

function isAppendableShoplist(
  list: ShoplistSummary,
): list is AppendableShoplistSummary {
  return isAppendableSourceKind(list.sourceKind);
}

function isAppendableSharedShoplist(
  list: SharedShoplistSummary,
): list is AppendableSharedShoplistSummary {
  return list.role === "write" && isAppendableSourceKind(list.sourceKind);
}

export function getAppendableShoplistDestinations(data: {
  owned: ShoplistSummary[];
  shared: SharedShoplistSummary[];
}): ShoplistDestination[] {
  const owned = data.owned.filter(isAppendableShoplist).map((list) => ({
    id: list.id,
    name: list.name,
    updatedAt: list.updatedAt,
    sourceKind: list.sourceKind,
    access: "owned" as const,
  }));

  const shared = data.shared.filter(isAppendableSharedShoplist).map((list) => ({
    id: list.id,
    name: list.name,
    updatedAt: list.updatedAt,
    sourceKind: list.sourceKind,
    access: "shared" as const,
  }));

  return [...owned, ...shared];
}
