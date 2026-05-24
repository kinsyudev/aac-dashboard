export const GRADES = [
  "grand",
  "rare",
  "arcane",
  "heroic",
  "unique",
  "celestial",
  "divine",
  "epic",
  "legendary",
  "mythic",
] as const;

export type Grade = (typeof GRADES)[number];
export type GearKind = "costume" | "undergarment";
export type GearSubtype = "healing" | "magic" | "melee" | "ranged";
export type PlannerSubtype = GearSubtype | "any";

export type PlannerMaterialId =
  | "clearSynthiumStone"
  | "vividSynthiumStone"
  | "lucidSynthiumStone"
  | "radiantSynthiumStone"
  | "clearSynthiumShard"
  | "vividSynthiumShard"
  | "lucidSynthiumShard"
  | "radiantSynthiumShard"
  | "charcoalStabilizer"
  | "misagonsCrystal"
  | "serendipityStone"
  | "brilliantMornstone";

export interface PlannerMaterialAmount {
  id: PlannerMaterialId;
  amount: number;
}

export interface SynthesisMilestone {
  grade: Grade;
  progress: number;
  materials: PlannerMaterialAmount[];
  craftGold: number;
}

export interface PlannerStat {
  id: string;
  label: string;
  kinds: GearKind[];
  unlockGradeByKind: Partial<Record<GearKind, Grade>>;
  subtypes?: GearSubtype[];
}

export const SUBTYPE_ORDER: GearSubtype[] = [
  "healing",
  "magic",
  "melee",
  "ranged",
];

export const MATERIAL_LABELS: Record<PlannerMaterialId, string> = {
  clearSynthiumStone: "Clear Synthium Stone",
  vividSynthiumStone: "Vivid Synthium Stone",
  lucidSynthiumStone: "Lucid Synthium Stone",
  radiantSynthiumStone: "Radiant Synthium Stone",
  clearSynthiumShard: "Clear Synthium Shard",
  vividSynthiumShard: "Vivid Synthium Shard",
  lucidSynthiumShard: "Lucid Synthium Shard",
  radiantSynthiumShard: "Radiant Synthium Shard",
  charcoalStabilizer: "Charcoal Stabilizer",
  misagonsCrystal: "Misagon's Crystal",
  serendipityStone: "Serendipity Stone",
  brilliantMornstone: "Brilliant Mornstone",
};

export const MATERIAL_PRICE_LOOKUP_NAMES: Record<PlannerMaterialId, string[]> =
  {
    clearSynthiumStone: ["Clear Synthium Stone"],
    vividSynthiumStone: ["Vivid Synthium Stone"],
    lucidSynthiumStone: ["Lucid Synthium Stone"],
    radiantSynthiumStone: ["Radiant Synthium Stone"],
    clearSynthiumShard: ["Clear Synthium Shard"],
    vividSynthiumShard: ["Vivid Synthium Shard"],
    lucidSynthiumShard: ["Lucid Synthium Shard"],
    radiantSynthiumShard: ["Radiant Synthium Shard"],
    charcoalStabilizer: ["Charcoal Stabilizer"],
    misagonsCrystal: ["Misagon's Crystal", "Misagon's Crystals"],
    serendipityStone: ["Serendipity Stone"],
    brilliantMornstone: ["Brilliant Mornstone"],
  };

export const PRICE_LOOKUP_ITEM_NAMES = [
  ...new Set(Object.values(MATERIAL_PRICE_LOOKUP_NAMES).flat()),
];

export const SYNTHESIS_MILESTONES: SynthesisMilestone[] = [
  {
    grade: "grand",
    progress: 0,
    materials: [{ id: "clearSynthiumStone", amount: 4 }],
    craftGold: 100,
  },
  {
    grade: "rare",
    progress: 0,
    materials: [{ id: "clearSynthiumStone", amount: 8 }],
    craftGold: 200,
  },
  {
    grade: "arcane",
    progress: 0,
    materials: [
      { id: "vividSynthiumStone", amount: 12 },
      { id: "charcoalStabilizer", amount: 240 },
    ],
    craftGold: 558,
  },
  {
    grade: "heroic",
    progress: 0,
    materials: [
      { id: "vividSynthiumStone", amount: 16 },
      { id: "charcoalStabilizer", amount: 320 },
    ],
    craftGold: 744,
  },
  {
    grade: "unique",
    progress: 0,
    materials: [
      { id: "lucidSynthiumStone", amount: 20 },
      { id: "charcoalStabilizer", amount: 800 },
      { id: "misagonsCrystal", amount: 20 },
    ],
    craftGold: 1540,
  },
  {
    grade: "celestial",
    progress: 0,
    materials: [
      { id: "lucidSynthiumStone", amount: 24 },
      { id: "charcoalStabilizer", amount: 960 },
      { id: "misagonsCrystal", amount: 24 },
    ],
    craftGold: 1848,
  },
  {
    grade: "divine",
    progress: 0,
    materials: [
      { id: "lucidSynthiumStone", amount: 28 },
      { id: "charcoalStabilizer", amount: 1120 },
      { id: "misagonsCrystal", amount: 28 },
    ],
    craftGold: 2156,
  },
  {
    grade: "epic",
    progress: 0,
    materials: [
      { id: "lucidSynthiumStone", amount: 32 },
      { id: "charcoalStabilizer", amount: 1280 },
      { id: "misagonsCrystal", amount: 32 },
    ],
    craftGold: 2464,
  },
  {
    grade: "legendary",
    progress: 0,
    materials: [
      { id: "radiantSynthiumStone", amount: 36 },
      { id: "charcoalStabilizer", amount: 2160 },
      { id: "misagonsCrystal", amount: 108 },
    ],
    craftGold: 4194,
  },
  {
    grade: "mythic",
    progress: 0,
    materials: [
      { id: "radiantSynthiumStone", amount: 40 },
      { id: "charcoalStabilizer", amount: 2400 },
      { id: "misagonsCrystal", amount: 120 },
    ],
    craftGold: 4780,
  },
  {
    grade: "mythic",
    progress: 100,
    materials: [
      { id: "radiantSynthiumStone", amount: 44 },
      { id: "charcoalStabilizer", amount: 2640 },
      { id: "misagonsCrystal", amount: 132 },
    ],
    craftGold: 5258,
  },
];

export const SALVAGE_OUTPUTS: Partial<Record<Grade, PlannerMaterialAmount[]>> =
  {
    arcane: [
      { id: "clearSynthiumShard", amount: 60 },
      { id: "vividSynthiumShard", amount: 60 },
    ],
    heroic: [
      { id: "clearSynthiumShard", amount: 60 },
      { id: "vividSynthiumShard", amount: 160 },
    ],
    unique: [
      { id: "clearSynthiumShard", amount: 60 },
      { id: "vividSynthiumShard", amount: 200 },
      { id: "lucidSynthiumShard", amount: 140 },
    ],
    celestial: [
      { id: "clearSynthiumShard", amount: 60 },
      { id: "vividSynthiumShard", amount: 230 },
      { id: "lucidSynthiumShard", amount: 310 },
    ],
    divine: [
      { id: "clearSynthiumShard", amount: 60 },
      { id: "vividSynthiumShard", amount: 230 },
      { id: "lucidSynthiumShard", amount: 530 },
    ],
    legendary: [
      { id: "clearSynthiumShard", amount: 60 },
      { id: "vividSynthiumShard", amount: 230 },
      { id: "lucidSynthiumShard", amount: 770 },
      { id: "radiantSynthiumShard", amount: 260 },
    ],
    mythic: [
      { id: "clearSynthiumShard", amount: 60 },
      { id: "vividSynthiumShard", amount: 230 },
      { id: "lucidSynthiumShard", amount: 770 },
      { id: "radiantSynthiumShard", amount: 560 },
    ],
  };

export const PLANNER_STATS: PlannerStat[] = [
  stat("physical-defense", "Physical Defense", ["costume", "undergarment"], {
    costume: "grand",
    undergarment: "grand",
  }),
  stat("magic-defense", "Magic Defense", ["costume", "undergarment"], {
    costume: "grand",
    undergarment: "grand",
  }),
  stat("max-health", "Max Health", ["costume", "undergarment"], {
    costume: "grand",
    undergarment: "grand",
  }),
  stat("move-speed", "Move Speed", ["costume"], { costume: "grand" }),
  stat("stealth-detection", "Stealth Detection", ["costume"], {
    costume: "grand",
  }),
  stat(
    "pve-magic-skills",
    "PvE Magic Skills",
    ["costume"],
    { costume: "grand" },
    ["magic"],
  ),
  stat(
    "pve-melee-skills",
    "PvE Melee Skills",
    ["costume"],
    { costume: "grand" },
    ["melee"],
  ),
  stat(
    "pve-ranged-skills",
    "PvE Ranged Skills",
    ["costume"],
    { costume: "grand" },
    ["ranged"],
  ),
  stat(
    "backstab-melee-damage",
    "Backstab Melee Damage",
    ["costume", "undergarment"],
    { costume: "grand", undergarment: "grand" },
    ["melee"],
  ),
  stat(
    "backstab-magic-damage",
    "Backstab Magic Damage",
    ["costume", "undergarment"],
    { costume: "grand", undergarment: "grand" },
    ["magic"],
  ),
  stat(
    "backstab-ranged-damage",
    "Backstab Ranged Damage",
    ["costume", "undergarment"],
    { costume: "grand", undergarment: "grand" },
    ["ranged"],
  ),
  stat("received-damage", "Received Damage", ["costume"], {
    costume: "grand",
  }),
  stat(
    "melee-attack",
    "Melee Attack",
    ["costume", "undergarment"],
    { costume: "arcane", undergarment: "grand" },
    ["melee"],
  ),
  stat(
    "ranged-attack",
    "Ranged Attack",
    ["costume", "undergarment"],
    { costume: "arcane", undergarment: "grand" },
    ["ranged"],
  ),
  stat(
    "magic-attack",
    "Magic Attack",
    ["costume", "undergarment"],
    { costume: "arcane", undergarment: "grand" },
    ["magic"],
  ),
  stat(
    "healing-power",
    "Healing Power",
    ["costume", "undergarment"],
    { costume: "arcane", undergarment: "grand" },
    ["healing"],
  ),
  stat("pve-damage-reduction", "PvE Damage Reduction", ["costume"], {
    costume: "arcane",
  }),
  stat("received-healing", "Received Healing", ["costume"], {
    costume: "arcane",
  }),
  stat("cast-time", "Cast Time", ["costume"], { costume: "arcane" }),
  stat("evasion", "Evasion", ["costume"], { costume: "unique" }),
  stat("parry-rate", "Parry Rate", ["costume"], {
    costume: "unique",
  }),
  stat("shield-block-rate", "Shield Block Rate", ["costume"], {
    costume: "unique",
  }),
  stat("resilience", "Resilience", ["costume", "undergarment"], {
    costume: "unique",
    undergarment: "arcane",
  }),
  stat("toughness", "Toughness", ["costume", "undergarment"], {
    costume: "unique",
    undergarment: "arcane",
  }),
  stat("focus", "Focus", ["costume", "undergarment"], {
    costume: "unique",
    undergarment: "arcane",
  }),
  stat(
    "defense-penetration",
    "Defense Penetration",
    ["costume", "undergarment"],
    {
      costume: "celestial",
      undergarment: "arcane",
    },
  ),
  stat(
    "magic-defense-penetration",
    "Magic Defense Penetration",
    ["costume", "undergarment"],
    {
      costume: "celestial",
      undergarment: "arcane",
    },
  ),
  stat(
    "received-magic-damage",
    "Received Magic Damage",
    ["costume", "undergarment"],
    {
      costume: "divine",
      undergarment: "unique",
    },
  ),
  stat(
    "received-melee-damage",
    "Received Melee Damage",
    ["costume", "undergarment"],
    {
      costume: "divine",
      undergarment: "unique",
    },
  ),
  stat(
    "received-ranged-damage",
    "Received Ranged Damage",
    ["costume", "undergarment"],
    {
      costume: "divine",
      undergarment: "unique",
    },
  ),
  stat(
    "shield-defense-penetration-rate",
    "Shield Defense Penetration Rate",
    ["undergarment"],
    { undergarment: "unique" },
  ),
  stat(
    "magic-critical-damage",
    "Magic Critical Damage",
    ["costume"],
    { costume: "divine" },
    ["magic"],
  ),
  stat(
    "melee-critical-damage",
    "Melee Critical Damage",
    ["costume"],
    { costume: "divine" },
    ["melee"],
  ),
  stat(
    "ranged-critical-damage",
    "Ranged Critical Damage",
    ["costume"],
    { costume: "divine" },
    ["ranged"],
  ),
  stat(
    "critical-heal-bonus",
    "Critical Heal Bonus",
    ["costume"],
    { costume: "divine" },
    ["healing"],
  ),
  stat(
    "melee-skill-damage",
    "Melee Skill Damage",
    ["costume", "undergarment"],
    { costume: "epic", undergarment: "divine" },
    ["melee"],
  ),
  stat(
    "magic-skill-damage",
    "Magic Skill Damage",
    ["costume", "undergarment"],
    { costume: "epic", undergarment: "divine" },
    ["magic"],
  ),
  stat(
    "ranged-skill-damage",
    "Ranged Skill Damage",
    ["costume", "undergarment"],
    { costume: "epic", undergarment: "divine" },
    ["ranged"],
  ),
  stat(
    "healing",
    "Healing",
    ["costume", "undergarment"],
    { costume: "epic", undergarment: "divine" },
    ["healing"],
  ),
  stat(
    "melee-critical-rate",
    "Melee Critical Rate",
    ["costume", "undergarment"],
    { costume: "legendary", undergarment: "legendary" },
    ["melee"],
  ),
  stat(
    "magic-critical-rate",
    "Magic Critical Rate",
    ["costume", "undergarment"],
    { costume: "legendary", undergarment: "legendary" },
    ["magic"],
  ),
  stat(
    "ranged-critical-rate",
    "Ranged Critical Rate",
    ["costume", "undergarment"],
    { costume: "legendary", undergarment: "legendary" },
    ["ranged"],
  ),
  stat(
    "critical-heal-rate",
    "Critical Heal Rate",
    ["costume", "undergarment"],
    { costume: "legendary", undergarment: "legendary" },
    ["healing"],
  ),
];

function stat(
  id: string,
  label: string,
  kinds: GearKind[],
  unlockGradeByKind: Partial<Record<GearKind, Grade>>,
  subtypes?: GearSubtype[],
): PlannerStat {
  return {
    id,
    label,
    kinds,
    unlockGradeByKind,
    subtypes,
  };
}
