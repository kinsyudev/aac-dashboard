import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import type { ProficiencyMap } from "~/lib/proficiency";
import { useTRPC } from "~/lib/trpc";

export type OverrideMap = Map<number, number>;

export interface UserData {
  proficiencyMap: ProficiencyMap;
  overrideMap: OverrideMap;
}

/**
 * Reads user-specific data (proficiencies + price overrides) from the cache
 * populated by the root loader's prefetch. Returns empty maps if the user is
 * unauthed or data hasn't loaded yet — downstream consumers can treat this as
 * "no discounts, no overrides".
 */
export function useUserData(): UserData {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.profile.getUserData.queryOptions());

  return useMemo<UserData>(() => {
    const proficiencyMap: ProficiencyMap = new Map(
      data?.proficiencies.map((p) => [p.proficiency, p.value]) ?? [],
    );
    const overrideMap: OverrideMap = new Map(
      data?.overrides.map((o) => [o.itemId, parseFloat(o.price)]) ?? [],
    );
    return { proficiencyMap, overrideMap };
  }, [data]);
}
