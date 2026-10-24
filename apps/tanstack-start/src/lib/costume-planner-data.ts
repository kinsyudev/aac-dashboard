import { STAT_POOLS } from "./costume-planner-pools.ts";

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

// A new stat line opens on reaching these grades (client: item_rnd_attr_category_properties.max_unit_modifier_num
// is 1 at grand and rare, 2 at arcane, 3 at heroic, 4 from unique to epic and 5 at legendary and mythic).
export const STAT_LINE_THRESHOLDS: Record<GearKind, Grade[]> = {
  costume: ["grand", "arcane", "heroic", "unique", "legendary"],
  undergarment: ["grand", "arcane", "heroic", "unique", "legendary"],
};

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

export type SynthiumTier = "clear" | "vivid" | "lucid" | "radiant";

export interface SynthesisBar {
  stone: SynthiumTier;
  stones: number;
  fee: number;
}

export interface PlannerStat {
  id: string;
  label: string;
  kinds: GearKind[];
  // earliest grade any role's item can roll it at
  unlockGradeByKind: Partial<Record<GearKind, Grade>>;
  // roles this stat ties the item to; absent when every role rolls it alike
  subtypesByKind: Partial<Record<GearKind, GearSubtype[]>>;
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

// Experience bar of each grade: what it takes to fill it and reach the next grade. The client's req_exp is
// cumulative (400, 1,200, 2,400 ... 26,400), so a grade's bar is the difference to the previous grade's, and every
// synthium stone gives 100 exp (gain_exp): a mythic item shows XP 0/4400, i.e. 44 stones. A fresh item starts at
// basic. Stone tiers and fees come from the planner's earlier synthesis table, which priced every stone as crafted
// up from Clear (its charcoal and Misagon's Crystal amounts match those recipes); that crafting, including its 10g
// per step, is now part of the stone price (see SYNTHIUM_CRAFTS), so the fee here is the remainder.
export const BASIC_SYNTHESIS_BAR: SynthesisBar = {
  stone: "clear",
  stones: 4,
  fee: 100,
};

export const SYNTHESIS_BARS: Record<Grade, SynthesisBar> = {
  grand: { stone: "clear", stones: 8, fee: 200 },
  rare: { stone: "vivid", stones: 12, fee: 438 },
  arcane: { stone: "vivid", stones: 16, fee: 584 },
  heroic: { stone: "lucid", stones: 20, fee: 1140 },
  unique: { stone: "lucid", stones: 24, fee: 1368 },
  celestial: { stone: "lucid", stones: 28, fee: 1596 },
  divine: { stone: "lucid", stones: 32, fee: 1824 },
  epic: { stone: "radiant", stones: 36, fee: 3114 },
  legendary: { stone: "radiant", stones: 40, fee: 3580 },
  mythic: { stone: "radiant", stones: 44, fee: 3938 },
};

export const SYNTHIUM_STONE_IDS: Record<SynthiumTier, PlannerMaterialId> = {
  clear: "clearSynthiumStone",
  vivid: "vividSynthiumStone",
  lucid: "lucidSynthiumStone",
  radiant: "radiantSynthiumStone",
};

// Stone crafting recipes from the client DB: market stones upgrade one tier at a time (8000429, 8000430,
// 8000597); bound stones come from Activity Tokens (8000551-8000553) or upgrade the same way with less charcoal
// (8000487, 8000488, 8000598). Bound Radiant has no direct token recipe.
export const SYNTHIUM_CRAFTS = {
  upgrade: {
    vivid: { gold: 10, charcoal: 20, misagon: 0 },
    lucid: { gold: 10, charcoal: 20, misagon: 1 },
    radiant: { gold: 10, charcoal: 20, misagon: 2 },
  },
  boundUpgrade: {
    vivid: { gold: 10, charcoal: 5, misagon: 0 },
    lucid: { gold: 10, charcoal: 5, misagon: 1 },
    radiant: { gold: 10, charcoal: 5, misagon: 2 },
  },
  boundFromTokens: { clear: 5, vivid: 10, lucid: 20 },
} as const;

// Brilliant Mornstone salvage outputs per grade (client: item_conv_* tables).
export const SALVAGE_OUTPUTS: Partial<Record<Grade, PlannerMaterialAmount[]>> =
  {
    grand: [{ id: "clearSynthiumShard", amount: 20 }],
    rare: [{ id: "clearSynthiumShard", amount: 60 }],
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
    epic: [
      { id: "clearSynthiumShard", amount: 60 },
      { id: "vividSynthiumShard", amount: 230 },
      { id: "lucidSynthiumShard", amount: 770 },
    ],
    legendary: [
      { id: "clearSynthiumShard", amount: 60 },
      { id: "vividSynthiumShard", amount: 230 },
      { id: "lucidSynthiumShard", amount: 770 },
      { id: "radiantSynthiumShard", amount: 280 },
    ],
    mythic: [
      { id: "clearSynthiumShard", amount: 60 },
      { id: "vividSynthiumShard", amount: 230 },
      { id: "lucidSynthiumShard", amount: 770 },
      { id: "radiantSynthiumShard", amount: 580 },
    ],
  };

const STAT_LABELS: [id: string, label: string][] = [
  ["physical-defense", "Physical Defense"],
  ["magic-defense", "Magic Defense"],
  ["max-health", "Max Health"],
  ["move-speed", "Move Speed"],
  ["stealth-detection", "Stealth Detection"],
  ["pve-magic-skills", "PvE Magic Skills"],
  ["pve-melee-skills", "PvE Melee Skills"],
  ["pve-ranged-skills", "PvE Ranged Skills"],
  ["backstab-melee-damage", "Backstab Melee Damage"],
  ["backstab-magic-damage", "Backstab Magic Damage"],
  ["backstab-ranged-damage", "Backstab Ranged Damage"],
  ["received-damage", "Received Damage"],
  ["melee-attack", "Melee Attack"],
  ["ranged-attack", "Ranged Attack"],
  ["magic-attack", "Magic Attack"],
  ["healing-power", "Healing Power"],
  ["pve-damage-reduction", "PvE Damage Reduction"],
  ["received-healing", "Received Healing"],
  ["cast-time", "Cast Time"],
  ["evasion", "Evasion"],
  ["parry-rate", "Parry Rate"],
  ["shield-block-rate", "Shield Block Rate"],
  ["resilience", "Resilience"],
  ["toughness", "Toughness"],
  ["focus", "Focus"],
  ["defense-penetration", "Defense Penetration"],
  ["magic-defense-penetration", "Magic Defense Penetration"],
  ["received-magic-damage", "Received Magic Damage"],
  ["received-melee-damage", "Received Melee Damage"],
  ["received-ranged-damage", "Received Ranged Damage"],
  ["shield-defense-penetration-rate", "Shield Defense Penetration Rate"],
  ["magic-critical-damage", "Magic Critical Damage"],
  ["melee-critical-damage", "Melee Critical Damage"],
  ["ranged-critical-damage", "Ranged Critical Damage"],
  ["critical-heal-bonus", "Critical Heal Bonus"],
  ["melee-skill-damage", "Melee Skill Damage"],
  ["magic-skill-damage", "Magic Skill Damage"],
  ["ranged-skill-damage", "Ranged Skill Damage"],
  ["healing", "Healing"],
  ["melee-critical-rate", "Melee Critical Rate"],
  ["magic-critical-rate", "Magic Critical Rate"],
  ["ranged-critical-rate", "Ranged Critical Rate"],
  ["critical-heal-rate", "Critical Heal Rate"],
];

// Stats that name a role. Each is tied to the roles whose item rolls it earliest (other roles get it only at a
// late grade or at weight 1), unless every role gets it at the same grade.
const ROLE_STAT_IDS = new Set([
  "melee-attack",
  "ranged-attack",
  "magic-attack",
  "healing-power",
  "melee-critical-damage",
  "ranged-critical-damage",
  "magic-critical-damage",
  "critical-heal-bonus",
  "melee-critical-rate",
  "ranged-critical-rate",
  "magic-critical-rate",
  "critical-heal-rate",
  "pve-melee-skills",
  "pve-ranged-skills",
  "pve-magic-skills",
  "backstab-melee-damage",
  "backstab-ranged-damage",
  "backstab-magic-damage",
]);

export const PLANNER_STATS: PlannerStat[] = STAT_LABELS.map(([id, label]) => {
  const kinds: GearKind[] = [];
  const unlockGradeByKind: Partial<Record<GearKind, Grade>> = {};
  const subtypesByKind: Partial<Record<GearKind, GearSubtype[]>> = {};

  for (const kind of ["costume", "undergarment"] as const) {
    const byRole = SUBTYPE_ORDER.flatMap((role) => {
      const entry = STAT_POOLS[kind][role].find(([statId]) => statId === id);
      return entry ? [{ role, weight: entry[1], unlock: entry[2] }] : [];
    });
    if (!byRole.length) continue;

    kinds.push(kind);
    const earliest = (entries: typeof byRole): number =>
      Math.min(...entries.map((entry) => GRADES.indexOf(entry.unlock)));
    const unlockIndex = earliest(byRole);
    unlockGradeByKind[kind] = GRADES[unlockIndex];

    if (ROLE_STAT_IDS.has(id)) {
      const rollable = byRole.filter((entry) => entry.weight > 1);
      const roleIndex = earliest(rollable);
      const roles = rollable
        .filter((entry) => GRADES.indexOf(entry.unlock) === roleIndex)
        .map((entry) => entry.role);
      if (roles.length < SUBTYPE_ORDER.length) subtypesByKind[kind] = roles;
    }
  }

  return { id, label, kinds, unlockGradeByKind, subtypesByKind };
});
