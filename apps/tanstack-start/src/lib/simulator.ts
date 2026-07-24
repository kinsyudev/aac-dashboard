import type { Piece, Tier } from "./salvage.ts";
import {
  jewelrySalvageValuesByTier,
  piecesMap,
  salvageValuesByTierByPiece,
  tiers,
  variantsByTier,
  weaponSalvageValuesByTier,
} from "./salvage.ts";

export type EquipCategory = "armor" | "weapon" | "jewelry";

export const GLOWING_PROC_RATE = 1 / 20;

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
  return {
    tier: detectedTier,
    piece: null,
    category: "weapon",
    pieceToken: null,
  };
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

interface BaseSimulationInput {
  /** Tier of the RNG item being rolled. */
  rngTier: Tier;
  /** Detected equip info for salvage lookups. */
  equip: DetectedEquip;
  /** Price per mana wisp in gold. */
  wispPrice: number;
}

interface BaseSimulationResult {
  /** Number of variants at the RNG tier. */
  variants: number;
  /** Fresh-craft success rate as a fraction (e.g. 0.1429). */
  successRate: number;
  /** Expected attempts represented by this strategy's success model. */
  expectedAttempts: number;
  /** Extra independent chance from Glowing proc, or 0 when disabled. */
  glowingProcChance: number;
  /** Grand total cost for the strategy. */
  totalCost: number;
  /** Wisps from salvaging the final sealed ayanad piece. */
  salvageWisps: number;
  /** Revenue if salvaged (wisps x wisp price). */
  revenueSalvage: number;
  /** Profit if salvaged. */
  profitSalvage: number;
  /** Expected profit per RNG attempt if the successful item is salvaged. */
  expectedValueSalvage: number;
  /** Total labor for the strategy. */
  totalLabor: number;
  /** Gold per labor point (salvage path). */
  silverPerLaborSalvage: number;
}

export interface SalvageLoopSimulationInput extends BaseSimulationInput {
  /** Extra gold/material cost for one sealed Delphinad attempt. */
  costPerAttempt: number;
  /** Material cost to go from the successful revealed Delphinad to Ayanad. */
  sealedUpgradeCost: number;
  /** Total labor for one attempt. */
  laborPerAttempt: number;
  /** Labor for the upgrade craft step after rolling the correct variant. */
  sealedUpgradeLabor: number;
  /** Mana wisps needed to recreate the base Epherium item for another attempt. */
  seedWispsPerAttempt: number;
  /** Whether to include the independent 1/20 house-crafting Glowing proc. */
  glowingProcEnabled?: boolean;
}

export interface SalvageLoopSimulationResult extends BaseSimulationResult {
  strategy: "salvage";
  /** Cost of a single attempt through the chain. */
  costPerAttempt: number;
  /** Expected total cost of attempts to get one success. */
  expectedAttemptsCost: number;
  /** Expected failed sealed craft attempts before one success. */
  failedAttempts: number;
  /** Wisps recovered per failed attempt (salvage at rngTier). */
  failSalvageWisps: number;
  /** Gross gold value of a failed salvage. */
  failRecoveryPerAttempt: number;
  /** Total gross gold value recovered from all expected failures. */
  totalFailRecovery: number;
  /** Surplus wisps after recreating the next attempt's base item. */
  failSurplusWisps: number;
  /** Net gold value kept per failed attempt after reseeding. */
  failNetRecoveryPerAttempt: number;
  /** Total net gold value kept from all expected failures. */
  totalFailNetRecovery: number;
  /** Upfront gold value of the wisps needed for the first base item. */
  initialSeedCost: number;
  /** Cost of the final upgrade (variant → sealed ayanad). */
  sealedUpgradeCost: number;
}

export interface ResealLoopSimulationInput extends BaseSimulationInput {
  /** Upfront gold value of the wisps needed for the first base item. */
  initialSeedCost: number;
  /** Material cost to craft the first sealed Delphinad item, excluding the seed. */
  initialSealedCraftCost: number;
  /** Labor to craft the first seed item, if crafted. */
  initialSeedLabor: number;
  /** Labor to craft the first sealed Delphinad item, excluding the seed. */
  initialSealedCraftLabor: number;
  /** Cost of one Delphinad mana seal consumed per failed retry. */
  manaSealCost: number;
  /** Labor to obtain one Delphinad mana seal when crafted. */
  manaSealLabor: number;
  /** Material cost to go from the successful revealed Delphinad to Ayanad. */
  sealedUpgradeCost: number;
  /** Labor for the upgrade craft step after rolling the correct variant. */
  sealedUpgradeLabor: number;
  /** Whether to include the independent 1/20 house-crafting Glowing proc. */
  glowingProcEnabled?: boolean;
}

export interface ResealLoopSimulationResult extends BaseSimulationResult {
  strategy: "reseal";
  /** Expected mana-seal retries after the initial sealed craft. */
  failedRetries: number;
  initialSeedCost: number;
  initialSealedCraftCost: number;
  initialSetupCost: number;
  manaSealCost: number;
  totalManaSealRetryCost: number;
  sealedUpgradeCost: number;
}

export type SimulationResult =
  | SalvageLoopSimulationResult
  | ResealLoopSimulationResult;

function getFinalRevenue(input: BaseSimulationInput) {
  const nextTierIndex = tiers.indexOf(input.rngTier) + 1;
  const salvageTier = tiers[nextTierIndex] ?? input.rngTier;
  const salvageWisps = getSalvageWisps(
    salvageTier,
    input.equip.piece,
    input.equip.category,
  );
  const revenueSalvage = salvageWisps * input.wispPrice;

  return { salvageWisps, revenueSalvage };
}

export function getEffectiveCraftSuccessRate(
  variants: number,
  procRate: number,
): number {
  const variantSuccessRate = 1 / variants;
  if (procRate <= 0) return variantSuccessRate;
  return 1 - (1 - variantSuccessRate) * (1 - procRate);
}

function getGlowingProcChance(enabled: boolean | undefined): number {
  return enabled ? GLOWING_PROC_RATE : 0;
}

function getBaseResult(
  input: BaseSimulationInput,
  totalCost: number,
  totalLabor: number,
  successRate = 1 / variantsByTier[input.rngTier],
  expectedAttempts = 1 / successRate,
  glowingProcChance = 0,
): BaseSimulationResult {
  const variants = variantsByTier[input.rngTier];
  const { salvageWisps, revenueSalvage } = getFinalRevenue(input);

  const profitSalvage = revenueSalvage - totalCost;
  const expectedValueSalvage = profitSalvage / expectedAttempts;

  return {
    variants,
    successRate,
    expectedAttempts,
    glowingProcChance,
    totalCost,
    salvageWisps,
    revenueSalvage,
    profitSalvage,
    expectedValueSalvage,
    totalLabor,
    silverPerLaborSalvage:
      totalLabor > 0 ? (profitSalvage * 100) / totalLabor : 0,
  };
}

export function computeSalvageLoopSimulation(
  input: SalvageLoopSimulationInput,
): SalvageLoopSimulationResult {
  const variants = variantsByTier[input.rngTier];
  const glowingProcChance = getGlowingProcChance(input.glowingProcEnabled);
  const successRate = getEffectiveCraftSuccessRate(variants, glowingProcChance);
  const expectedAttempts = 1 / successRate;
  const failedAttempts = expectedAttempts - 1;

  const expectedAttemptsCost = input.costPerAttempt * expectedAttempts;

  const failSalvageWisps = getSalvageWisps(
    input.rngTier,
    input.equip.piece,
    input.equip.category,
  );
  const failRecoveryPerAttempt = failSalvageWisps * input.wispPrice;
  const totalFailRecovery = failRecoveryPerAttempt * failedAttempts;
  const failSurplusWisps = Math.max(
    0,
    failSalvageWisps - input.seedWispsPerAttempt,
  );
  const failNetRecoveryPerAttempt = failSurplusWisps * input.wispPrice;
  const totalFailNetRecovery = failNetRecoveryPerAttempt * failedAttempts;
  const initialSeedCost = input.seedWispsPerAttempt * input.wispPrice;

  const totalCost =
    initialSeedCost +
    expectedAttemptsCost +
    input.sealedUpgradeCost -
    totalFailNetRecovery;
  const totalLabor =
    input.laborPerAttempt * expectedAttempts + input.sealedUpgradeLabor;

  return {
    strategy: "salvage",
    ...getBaseResult(
      input,
      totalCost,
      totalLabor,
      successRate,
      expectedAttempts,
      glowingProcChance,
    ),
    costPerAttempt: input.costPerAttempt,
    expectedAttemptsCost,
    failedAttempts,
    failSalvageWisps,
    failRecoveryPerAttempt,
    totalFailRecovery,
    failSurplusWisps,
    failNetRecoveryPerAttempt,
    totalFailNetRecovery,
    initialSeedCost,
    sealedUpgradeCost: input.sealedUpgradeCost,
  };
}

export function computeResealLoopSimulation(
  input: ResealLoopSimulationInput,
): ResealLoopSimulationResult {
  const variants = variantsByTier[input.rngTier];
  const glowingProcChance = getGlowingProcChance(input.glowingProcEnabled);
  const successRate = getEffectiveCraftSuccessRate(variants, glowingProcChance);
  const failedRetries = (1 - successRate) * variants;
  const expectedAttempts = 1 + failedRetries;
  const initialSetupCost = input.initialSeedCost + input.initialSealedCraftCost;
  const totalManaSealRetryCost = input.manaSealCost * failedRetries;
  const totalCost =
    initialSetupCost + totalManaSealRetryCost + input.sealedUpgradeCost;
  const totalLabor =
    input.initialSeedLabor +
    input.initialSealedCraftLabor +
    input.manaSealLabor * failedRetries +
    input.sealedUpgradeLabor;

  return {
    strategy: "reseal",
    ...getBaseResult(
      input,
      totalCost,
      totalLabor,
      successRate,
      expectedAttempts,
      glowingProcChance,
    ),
    failedRetries,
    initialSeedCost: input.initialSeedCost,
    initialSealedCraftCost: input.initialSealedCraftCost,
    initialSetupCost,
    manaSealCost: input.manaSealCost,
    totalManaSealRetryCost,
    sealedUpgradeCost: input.sealedUpgradeCost,
  };
}

export const computeSimulation = computeSalvageLoopSimulation;
