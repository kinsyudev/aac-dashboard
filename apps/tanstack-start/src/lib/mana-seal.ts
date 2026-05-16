import type { Piece } from "~/lib/salvage";
import type { DetectedEquip } from "~/lib/simulator";

type WeaponType = "1h" | "2h" | "Wooden" | "Musical";

type AccessoryType = "Large" | "Small";

type WeaponMap = Record<WeaponType, string[]>;

export const weaponMap = {
  "1h": ["Dagger", "Sword", "Katana", "Axe", "Club", "Shortspear"],
  "2h": ["Greatsword", "Nodachi", "Greataxe", "Greatclub", "Longspear"],
  Musical: ["Lute", "Flute"],
  Wooden: ["Bow", "Scepter", "Staff", "Shield"],
} as const satisfies WeaponMap;

type SealMap =
  | Record<"armor", Record<Piece, string>>
  | Record<"weapon", Record<WeaponType, string>>
  | Record<"jewelry", Record<AccessoryType, string>>;
export const sealToGearMap = {
  armor: {
    head: "Medium Mana Seal",
    chest: "Chest Mana Seal",
    waist: "Small Mana Seal",
    wrists: "Small Mana Seal",
    hands: "Medium Mana Seal",
    legs: "Pants Mana Seal",
    feet: "Medium Mana Seal",
  },
  weapon: {
    Musical: "Musical Mana Seal",
    "1h": "One-Hander Metal Mana Seal",
    "2h": "Two-Hander Metal Mana Seal",
    Wooden: "Wooden Mana Seal",
  },
  jewelry: {
    Large: "Large Jewelry Mana Seal",
    Small: "Small Jewelry Mana Seal",
  },
} as const satisfies SealMap;

export interface ManaSealItemContext {
  name: string;
  category: string;
  equip: DetectedEquip;
}

function getArmorMaterial(
  category: string,
): "Cloth" | "Leather" | "Plate" | null {
  const lower = category.toLowerCase();
  if (lower.includes("cloth")) return "Cloth";
  if (lower.includes("leather")) return "Leather";
  if (lower.includes("plate")) return "Plate";
  return null;
}

function getWeaponType(name: string, category: string): WeaponType | null {
  const searchable = `${name} ${category}`.toLowerCase();

  for (const [weaponType, tokens] of Object.entries(weaponMap)) {
    if (tokens.some((token) => searchable.includes(token.toLowerCase()))) {
      return weaponType as WeaponType;
    }
  }

  return null;
}

function getAccessoryType(
  name: string,
  category: string,
): AccessoryType | null {
  const searchable = `${name} ${category}`.toLowerCase();
  if (searchable.includes("necklace")) return "Large";
  if (searchable.includes("ring") || searchable.includes("earring")) {
    return "Small";
  }
  return null;
}

export function resolveDelphinadManaSealName(
  context: ManaSealItemContext,
): string | null {
  const { category, equip, name } = context;

  if (equip.tier !== "delphinad") return null;

  if (equip.category === "armor") {
    if (!equip.piece) return null;

    const armorMaterial = getArmorMaterial(category);
    if (!armorMaterial) return null;

    return `Delphinad ${armorMaterial} ${sealToGearMap.armor[equip.piece]}`;
  }

  if (equip.category === "weapon") {
    const weaponType = getWeaponType(name, category);
    if (!weaponType) return null;

    return `Delphinad ${sealToGearMap.weapon[weaponType]}`;
  }

  const accessoryType = getAccessoryType(name, category);
  if (!accessoryType) return null;

  return `Delphinad ${sealToGearMap.jewelry[accessoryType]}`;
}
