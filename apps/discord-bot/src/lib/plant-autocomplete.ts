export interface PlantAutocompleteQuery {
  focusedName: string;
  query: string;
}

export interface PlantAutocompleteSuggestion {
  name: string;
  value: string;
}

export interface PlantAutocompleteSources {
  crops: (query: string) => Promise<PlantAutocompleteSuggestion[]>;
  farms: (query: string) => Promise<PlantAutocompleteSuggestion[]>;
}

export function getPlantAutocompleteSuggestions(
  input: PlantAutocompleteQuery,
  sources: PlantAutocompleteSources,
) {
  if (input.focusedName === "crop") return sources.crops(input.query);
  if (input.focusedName === "farm") return sources.farms(input.query);
  return Promise.resolve([]);
}

export function findFarmSuggestions(
  farms: { name: string; slug: string }[],
  rawQuery: string,
) {
  const query = rawQuery.trim().toLowerCase();
  return farms
    .filter(
      (farm) =>
        farm.slug.toLowerCase().includes(query) ||
        farm.name.toLowerCase().includes(query),
    )
    .slice(0, 25)
    .map((farm) => ({
      name: (farm.name === farm.slug
        ? farm.name
        : `${farm.name} (${farm.slug})`
      ).slice(0, 100),
      value: farm.slug,
    }));
}
