import { useCallback, useState } from "react";

import type { SimulatorWispKey } from "./simulator-catalog";

export const SIMULATOR_RECIPE_PREFERENCES_STORAGE_KEY =
  "simulator:recipe-selection:v1";
export const SIMULATOR_CRAFT_MODE_STORAGE_KEY = "simulator:craft-modes:v1";

export type SimulatorCraftMode = "buy" | "craft";

export type SimulatorRecipePreferences = Partial<
  Record<SimulatorWispKey, number>
>;
export type SimulatorCraftModePreferences = Partial<
  Record<SimulatorWispKey, Partial<Record<number, SimulatorCraftMode>>>
>;

export function parseSimulatorRecipePreferences(
  value: string | null,
): SimulatorRecipePreferences {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed)
        .map(([key, raw]) => {
          const entryValue =
            typeof raw === "number"
              ? raw
              : typeof raw === "string"
                ? Number(raw)
                : Number.NaN;
          return [key, entryValue] as const;
        })
        .filter((entry): entry is [SimulatorWispKey, number] =>
          Number.isFinite(entry[1]),
        )
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  } catch {
    return {};
  }
}

export function serializeSimulatorRecipePreferences(
  preferences: SimulatorRecipePreferences,
): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(preferences)
        .filter((entry): entry is [SimulatorWispKey, number] =>
          Number.isFinite(entry[1]),
        )
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
}

export function parseSimulatorCraftModePreferences(
  value: string | null,
): SimulatorCraftModePreferences {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed)
        .map(([wispKey, rawModes]) => {
          if (
            !rawModes ||
            typeof rawModes !== "object" ||
            Array.isArray(rawModes)
          ) {
            return [wispKey, {}] as const;
          }

          const normalizedModes = Object.fromEntries(
            Object.entries(rawModes)
              .map(([itemId, mode]) => {
                const numericItemId = Number(itemId);
                return [numericItemId, mode] as const;
              })
              .filter(
                (
                  entry,
                ): entry is [number, SimulatorCraftMode] =>
                  Number.isInteger(entry[0]) &&
                  (entry[1] === "buy" || entry[1] === "craft"),
              )
              .sort(([a], [b]) => a - b),
          );

          return [wispKey, normalizedModes] as const;
        })
        .filter(([, modes]) => Object.keys(modes).length > 0)
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  } catch {
    return {};
  }
}

export function serializeSimulatorCraftModePreferences(
  preferences: SimulatorCraftModePreferences,
): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(preferences)
        .map(([wispKey, modes]) => {
          if (!modes) return [wispKey, {}] as const;

          const normalizedModes = Object.fromEntries(
            Object.entries(modes)
              .map(([itemId, mode]) => [Number(itemId), mode] as const)
              .filter(
                (
                  entry,
                ): entry is [number, SimulatorCraftMode] =>
                  Number.isInteger(entry[0]) &&
                  (entry[1] === "buy" || entry[1] === "craft"),
              )
              .sort(([a], [b]) => a - b),
          );

          return [wispKey, normalizedModes] as const;
        })
        .filter(([, modes]) => Object.keys(modes).length > 0)
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
}

export function pickPreferredSimulatorRecipe<T extends { craft: { id: number } }>(
  entries: T[],
  wispKey: SimulatorWispKey,
  preferences: SimulatorRecipePreferences,
  getCost: (entry: T) => number,
): { selected: T; cheapest: T; source: "saved" | "cheapest" } | null {
  if (entries.length === 0) return null;

  const cheapest = [...entries].sort((a, b) => getCost(a) - getCost(b))[0];
  if (!cheapest) return null;

  const savedCraftId = preferences[wispKey];
  const saved = entries.find((entry) => entry.craft.id === savedCraftId);

  return saved
    ? { selected: saved, cheapest, source: "saved" }
    : { selected: cheapest, cheapest, source: "cheapest" };
}

function readPreferences(): SimulatorRecipePreferences {
  try {
    return parseSimulatorRecipePreferences(
      localStorage.getItem(SIMULATOR_RECIPE_PREFERENCES_STORAGE_KEY),
    );
  } catch {
    return {};
  }
}

function writePreferences(preferences: SimulatorRecipePreferences) {
  try {
    localStorage.setItem(
      SIMULATOR_RECIPE_PREFERENCES_STORAGE_KEY,
      serializeSimulatorRecipePreferences(preferences),
    );
  } catch {
    // localStorage can be unavailable in private or SSR-like environments.
  }
}

function readCraftModePreferences(): SimulatorCraftModePreferences {
  try {
    return parseSimulatorCraftModePreferences(
      localStorage.getItem(SIMULATOR_CRAFT_MODE_STORAGE_KEY),
    );
  } catch {
    return {};
  }
}

function writeCraftModePreferences(preferences: SimulatorCraftModePreferences) {
  try {
    localStorage.setItem(
      SIMULATOR_CRAFT_MODE_STORAGE_KEY,
      serializeSimulatorCraftModePreferences(preferences),
    );
  } catch {
    // localStorage can be unavailable in private or SSR-like environments.
  }
}

export function useSimulatorRecipePreferences() {
  const [preferences, setPreferences] =
    useState<SimulatorRecipePreferences>(readPreferences);

  const setRecipePreference = useCallback(
    (wispKey: SimulatorWispKey, craftId: number) => {
      setPreferences((prev) => {
        const next = { ...prev, [wispKey]: craftId };
        writePreferences(next);
        return next;
      });
    },
    [],
  );

  return { preferences, setRecipePreference };
}

export function useSimulatorCraftModePreferences(wispKey: SimulatorWispKey) {
  const [preferences, setPreferences] = useState<SimulatorCraftModePreferences>(
    readCraftModePreferences,
  );

  const modes = preferences[wispKey] ?? {};

  const setCraftModePreference = useCallback(
    (itemId: number, mode: SimulatorCraftMode) => {
      setPreferences((prev) => {
        const next = {
          ...prev,
          [wispKey]: { ...(prev[wispKey] ?? {}), [itemId]: mode },
        };
        writeCraftModePreferences(next);
        return next;
      });
    },
    [wispKey],
  );

  return { modes, setCraftModePreference };
}
