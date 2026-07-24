import assert from "node:assert/strict";
import { test } from "node:test";

import {
  computeResealLoopSimulation,
  computeSalvageLoopSimulation,
} from "./simulator.ts";

const delphinadCuirass = {
  tier: "delphinad",
  piece: "chest",
  category: "armor",
  pieceToken: "cuirass",
} as const;

function assertClose(actual: number, expected: number) {
  assert.ok(
    Math.abs(actual - expected) < 0.000_000_001,
    `expected ${actual} to be within tolerance of ${expected}`,
  );
}

void test("salvage loop without glowing preserves the existing Delphinad expectation", () => {
  const result = computeSalvageLoopSimulation({
    rngTier: "delphinad",
    equip: delphinadCuirass,
    wispPrice: 1,
    costPerAttempt: 100,
    sealedUpgradeCost: 200,
    laborPerAttempt: 10,
    sealedUpgradeLabor: 20,
    seedWispsPerAttempt: 24,
  });

  assertClose(result.successRate, 1 / 7);
  assert.equal(result.expectedAttempts, 7);
  assert.equal(result.failedAttempts, 6);
  assert.equal(result.glowingProcChance, 0);
  assert.equal(result.expectedAttemptsCost, 700);
  assert.equal("expectedValueSell" in result, false);
  assert.equal("profitSell" in result, false);
  assert.equal("silverPerLaborSell" in result, false);
});

void test("salvage loop with glowing uses target variant or independent 1/20 proc", () => {
  const result = computeSalvageLoopSimulation({
    rngTier: "delphinad",
    equip: delphinadCuirass,
    wispPrice: 1,
    costPerAttempt: 100,
    sealedUpgradeCost: 200,
    laborPerAttempt: 10,
    sealedUpgradeLabor: 20,
    seedWispsPerAttempt: 24,
    glowingProcEnabled: true,
  });

  assertClose(result.successRate, 13 / 70);
  assertClose(result.expectedAttempts, 70 / 13);
  assertClose(result.failedAttempts, 57 / 13);
  assert.equal(result.glowingProcChance, 1 / 20);
  assertClose(result.expectedAttemptsCost, (70 / 13) * 100);
});

void test("reseal loop without glowing preserves the existing failed retry expectation", () => {
  const result = computeResealLoopSimulation({
    rngTier: "delphinad",
    equip: delphinadCuirass,
    wispPrice: 1,
    initialSeedCost: 24,
    initialSealedCraftCost: 100,
    initialSeedLabor: 5,
    initialSealedCraftLabor: 10,
    manaSealCost: 20,
    manaSealLabor: 2,
    sealedUpgradeCost: 200,
    sealedUpgradeLabor: 20,
  });

  assertClose(result.successRate, 1 / 7);
  assert.equal(result.expectedAttempts, 7);
  assert.equal(result.failedRetries, 6);
  assert.equal(result.glowingProcChance, 0);
  assert.equal(result.totalManaSealRetryCost, 120);
  assert.equal("expectedValueSell" in result, false);
  assert.equal("profitSell" in result, false);
  assert.equal("silverPerLaborSell" in result, false);
});

void test("reseal loop with glowing applies the proc only to the initial sealed craft", () => {
  const result = computeResealLoopSimulation({
    rngTier: "delphinad",
    equip: delphinadCuirass,
    wispPrice: 1,
    initialSeedCost: 24,
    initialSealedCraftCost: 100,
    initialSeedLabor: 5,
    initialSealedCraftLabor: 10,
    manaSealCost: 20,
    manaSealLabor: 2,
    sealedUpgradeCost: 200,
    sealedUpgradeLabor: 20,
    glowingProcEnabled: true,
  });

  assertClose(result.successRate, 13 / 70);
  assertClose(result.expectedAttempts, 67 / 10);
  assertClose(result.failedRetries, 5.7);
  assert.equal(result.glowingProcChance, 1 / 20);
  assertClose(result.totalManaSealRetryCost, 114);
  assertClose(result.expectedValueSalvage, 262 / (67 / 10));
});
