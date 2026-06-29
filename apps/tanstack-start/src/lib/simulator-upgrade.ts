import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { getMatchingAyanadName } from "~/lib/simulator-upgrade-pricing";
import { useTRPC } from "~/lib/trpc";

export * from "~/lib/simulator-upgrade-pricing";

export function useAyanadUpgradeData(itemName: string | null) {
  const trpc = useTRPC();
  const ayanadItemName = useMemo(
    () => (itemName ? getMatchingAyanadName(itemName) : null),
    [itemName],
  );
  const ayanadItemQuery = useQuery({
    ...trpc.items.byName.queryOptions(ayanadItemName ?? ""),
    enabled: !!ayanadItemName,
  });
  const ayanadItem = useMemo(
    () =>
      ayanadItemQuery.data?.find((item) => item.name === ayanadItemName) ??
      null,
    [ayanadItemName, ayanadItemQuery.data],
  );
  const ayanadCraftQuery = useQuery({
    ...trpc.crafts.forItem.queryOptions(ayanadItem?.id ?? -1),
    enabled: ayanadItem?.id != null,
  });

  return {
    ayanadItemName,
    ayanadItem,
    ayanadCraftData: ayanadCraftQuery.data ?? null,
  };
}
