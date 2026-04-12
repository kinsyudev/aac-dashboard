import type { Piece, Tier } from "./salvage";
import {
  jewelrySalvageValuesByTier,
  piecesMap,
  salvageValuesByTierByPiece,
  tiers,
  variantsByTier,
  weaponSalvageValuesByTier,
} from "./salvage";

export type EquipCategory = "armor" | "weapon" | "jewelry";

export interface DetectedEquip {
  tier: Tier;
  piece: Piece | null;
  category: EquipCategory;
  /** The piece-name token that matched (e.g. "cuirass", "hood"). */
  pieceToken: string | null;
}

/**
 * Parse an item name like "Sealed Ayanad Cuirass" into tier + piece.
 * Returns null when neither tier nor piece can be identified.
 */
export function detectPieceAndTier(name: string): DetectedEquip | null {
  const lower = name.toLowerCase();

  let detectedTier: Tier | null = null;
  for (const t of tiers) {
    if (lower.includes(t)) {
      detectedTier = t;
      break;
    }
  }
  if (!detectedTier) return null;

  for (const [piece, tokens] of Object.entries(piecesMap)) {
    for (const token of tokens) {
      if (lower.includes(token)) {
        return {
          tier: detectedTier,
          piece: piece as Piece,
          category: "armor",
          pieceToken: token,
        };
      }
    }
  }

  // Not armor — guess weapon vs jewelry from common keywords
  const jewelryTokens = [
    "ring",
    "earring",
    "necklace",
    "bracelet",
    "pendant",
    "locket",
  ];
  for (const t of jewelryTokens) {
    if (lower.includes(t)) {
      return {
        tier: detectedTier,
        piece: null,
        category: "jewelry",
        pieceToken: t,
      };
    }
  }

  // Default to weapon if we found a tier but no armor/jewelry match
  return { tier: detectedTier, piece: null, category: "weapon", pieceToken: null };
}

/**
 * Get the salvage value (in mana wisps) for a given tier + equip.
 */
export function getSalvageWisps(
  tier: Tier,
  piece: Piece | null,
  category: EquipCategory,
): number {
  if (category === "armor" && piece) {
    return salvageValuesByTierByPiece[tier][piece];
  }
  if (category === "jewelry") {
    return jewelrySalvageValuesByTier[tier];
  }
  return weaponSalvageValuesByTier[tier];
}

export interface SimulationInput {
  /** Total material cost for ONE attempt through the chain (Epherium → Sealed Delphinad). */
  costPerAttempt: number;
  /** Material cost to go from the successful variant to Sealed Ayanad. */
  sealedUpgradeCost: number;
  /** Tier where the RNG happens (e.g. "delphinad"). */
  rngTier: Tier;
  /** Detected equip info for salvage lookups. */
  equip: DetectedEquip;
  /** Price per mana wisp in gold. */
  wispPrice: number;
  /** Market price of the final sealed ayanad item (for sell comparison). */
  sellPrice: number;
  /** Total labor for one attempt (Epherium + Sealed Delphinad crafts). */
  laborPerAttempt: number;
  /** Labor for the Sealed Ayanad craft step. */
  sealedUpgradeLabor: number;
}

export interface SimulationResult {
  /** Number of variants at the RNG tier. */
  variants: number;
  /** Success rate as a fraction (e.g. 0.1429). */
  successRate: number;
  /** Cost of a single attempt through the chain. */
  costPerAttempt: number;
  /** Expected total cost of attempts to get one success. */
  expectedAttemptsCost: number;
  /** Wisps recovered per failed attempt (salvage at rngTier). */
  failSalvageWisps: number;
  /** Gold recovered per failed attempt. */
  failRecoveryPerAttempt: number;
  /** Total gold recovered from all expected failures. */
  totalFailRecovery: number;
  /** Cost of the final upgrade (variant → sealed ayanad). */
  sealedUpgradeCost: number;
  /** Grand total cost including all attempts + upgrade - failure recovery. */
  totalCost: number;
  /** Wisps from salvaging the final sealed ayanad piece. */
  salvageWisps: number;
  /** Revenue if salvaged (wisps × wisp price). */
  revenueSalvage: number;
  /** Revenue if sold on market. */
  revenueSell: number;
  /** Profit if salvaged. */
  profitSalvage: number;
  /** Profit if sold. */
  profitSell: number;
  /** Total labor across all expected attempts + final upgrade. */
  totalLabor: number;
  /** Silver (gold) per labor point (salvage path). */
  silverPerLaborSalvage: number;
  /** Silver (gold) per labor point (sell path). */
  silverPerLaborSell: number;
}

export function computeSimulation(input: SimulationInput): SimulationResult {
  const variants = variantsByTier[input.rngTier];
  const successRate = 1 / variants;
  const expectedAttempts = variants;
  const failedAttempts = expectedAttempts - 1;

  const expectedAttemptsCost = input.costPerAttempt * expectedAttempts;

  // Failed attempts produce wrong-variant pieces at the RNG tier — salvage them
  const failSalvageWisps = getSalvageWisps(
    input.rngTier,
    input.equip.piece,
    input.equip.category,
  );
  const failRecoveryPerAttempt = failSalvageWisps * input.wispPrice;
  const totalFailRecovery = failRecoveryPerAttempt * failedAttempts;

  const totalCost =
    expectedAttemptsCost + input.sealedUpgradeCost - totalFailRecovery;

  // Revenue from the final piece
  const nextTierIndex = tiers.indexOf(input.rngTier) + 1;
  const salvageTier =
    nextTierIndex < tiers.length ? tiers[nextTierIndex]! : input.rngTier;
  const salvageWisps = getSalvageWisps(
    salvageTier,
    input.equip.piece,
    input.equip.category,
  );
  const revenueSalvage = salvageWisps * input.wispPrice;
  const revenueSell = input.sellPrice;

  const profitSalvage = revenueSalvage - totalCost;
  const profitSell = revenueSell - totalCost;

  const totalLabor =
    input.laborPerAttempt * expectedAttempts + input.sealedUpgradeLabor;

  const silverPerLaborSalvage = totalLabor > 0 ? profitSalvage / totalLabor : 0;
  const silverPerLaborSell = totalLabor > 0 ? profitSell / totalLabor : 0;

  return {
    variants,
    successRate,
    costPerAttempt: input.costPerAttempt,
    expectedAttemptsCost,
    failSalvageWisps,
    failRecoveryPerAttempt,
    totalFailRecovery,
    sealedUpgradeCost: input.sealedUpgradeCost,
    totalCost,
    salvageWisps,
    revenueSalvage,
    revenueSell,
    profitSalvage,
    profitSell,
    totalLabor,
    silverPerLaborSalvage,
    silverPerLaborSell,
  };
}
