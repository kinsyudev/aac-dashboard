import type { Proficiency } from "@acme/db/schema";

export const PROFICIENCY_CATEGORIES: {
  label: string;
  proficiencies: Proficiency[];
}[] = [
  {
    label: "Harvesting",
    proficiencies: [
      "Husbandry",
      "Farming",
      "Fishing",
      "Logging",
      "Gathering",
      "Mining",
    ],
  },
  {
    label: "Crafting",
    proficiencies: [
      "Alchemy",
      "Cooking",
      "Handicrafts",
      "Machining",
      "Metalwork",
      "Printing",
      "Masonry",
      "Tailoring",
      "Leatherwork",
      "Weaponry",
      "Carpentry",
    ],
  },
  {
    label: "Special",
    proficiencies: [
      "Construction",
      "Larceny",
      "Commerce",
      "Artistry",
      "Exploration",
    ],
  },
];

export const RANKS: { name: string; min: number; laborReduction: number }[] = [
  { name: "Famed", min: 230000, laborReduction: 40 },
  { name: "Celebrity", min: 180000, laborReduction: 30 },
  { name: "Virtuoso", min: 150000, laborReduction: 25 },
  { name: "Herald", min: 130000, laborReduction: 20 },
  { name: "Adept", min: 110000, laborReduction: 20 },
  { name: "Champion", min: 90000, laborReduction: 15 },
  { name: "Authority", min: 70000, laborReduction: 15 },
  { name: "Master", min: 50000, laborReduction: 15 },
  { name: "Expert", min: 40000, laborReduction: 15 },
  { name: "Journeyman", min: 30000, laborReduction: 15 },
  { name: "Apprentice", min: 20000, laborReduction: 10 },
  { name: "Novice", min: 10000, laborReduction: 5 },
];

export function getRank(value: number) {
  return RANKS.find((r) => value >= r.min) ?? null;
}

export type ProficiencyMap = Map<string, number>;

/** Returns the labor-reduction fraction (0..1) for a given proficiency. */
export function getDiscount(
  proficiency: string | null | undefined,
  profs: ProficiencyMap,
): number {
  if (!proficiency) return 0;
  const value = profs.get(proficiency) ?? 0;
  const rank = getRank(value);
  return rank ? rank.laborReduction / 100 : 0;
}

/** Apply proficiency discount to a labor cost. Rounds up to the nearest integer. */
export function getDiscountedLabor(
  labor: number,
  proficiency: string | null | undefined,
  profs: ProficiencyMap,
): number {
  if (labor <= 0) return labor;
  const discount = getDiscount(proficiency, profs);
  if (discount <= 0) return labor;
  return Math.ceil(labor * (1 - discount));
}
