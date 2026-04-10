export const piecesMap = {
  head: ["hood", "cap", "helm"],
  chest: ["shirt", "jerkin", "cuirass"],
  waist: ["sash", "belt", "tassets"],
  wrists: ["sleeves", "guards", "vambraces"],
  hands: ["gloves", "fists", "gauntlets"],
  legs: ["pants", "breeches", "greaves"],
  feet: ["shoes", "boots", "sabatons"],
} as const;

export type Piece = keyof typeof piecesMap;

export const tiers = [
  "illustrious",
  "magnificent",
  "epherium",
  "delphinad",
  "ayanad",
] as const;

export type Tier = (typeof tiers)[number];

export const salvageValuesByTierByPiece = {
  illustrious: {
    head: 2.5,
    chest: 4,
    waist: 1.5,
    wrists: 1.5,
    hands: 2.5,
    legs: 3,
    feet: 2.5,
  },
  magnificent: {
    head: 5,
    chest: 8,
    waist: 3,
    wrists: 3,
    hands: 5,
    legs: 6,
    feet: 5,
  },
  epherium: {
    head: 15,
    chest: 24,
    waist: 9,
    wrists: 9,
    hands: 15,
    legs: 18,
    feet: 15,
  },
  delphinad: {
    head: 75,
    chest: 120,
    waist: 45,
    wrists: 45,
    hands: 75,
    legs: 90,
    feet: 75,
  },
  ayanad: {
    head: 438,
    chest: 700,
    waist: 263,
    wrists: 263,
    hands: 438,
    legs: 525,
    feet: 438,
  },
} satisfies Record<Tier, Record<Piece, number>>;

export const weaponSalvageValuesByTier = {
  illustrious: 1,
  magnificent: 2,
  epherium: 6,
  delphinad: 30,
  ayanad: 175,
} satisfies Record<Tier, number>;

export const jewelrySalvageValuesByTier = {
  illustrious: 1,
  magnificent: 2,
  epherium: 6,
  delphinad: 30,
  ayanad: 175,
} satisfies Record<Tier, number>;

export const variantsByTier = {
  illustrious: 4,
  magnificent: 4,
  epherium: 7,
  delphinad: 7,
  ayanad: 7,
} satisfies Record<Tier, number>;
