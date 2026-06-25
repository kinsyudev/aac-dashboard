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

export function getAppendableShoplistDestinations(data: {
  owned: ShoplistSummary[];
  shared: SharedShoplistSummary[];
}): ShoplistDestination[] {
  const owned = data.owned
    .filter((list) => isAppendableSourceKind(list.sourceKind))
    .map((list) => ({
      id: list.id,
      name: list.name,
      updatedAt: list.updatedAt,
      sourceKind: list.sourceKind,
      access: "owned" as const,
    }));

  const shared = data.shared
    .filter(
      (list) =>
        list.role === "write" && isAppendableSourceKind(list.sourceKind),
    )
    .map((list) => ({
      id: list.id,
      name: list.name,
      updatedAt: list.updatedAt,
      sourceKind: list.sourceKind,
      access: "shared" as const,
    }));

  return [...owned, ...shared];
}
