import assert from "node:assert/strict";
import { test } from "node:test";

import type { MarketSnapshot } from "./volume-spikes";
import { findVolumeAnomalies } from "./volume-spikes";

function row(day: number, volume: string | null, price = "2"): MarketSnapshot {
  return {
    itemId: 1,
    itemName: "Test Item",
    fetchedAt: `2026-07-${String(day).padStart(2, "0")}T00:00:00.000Z`,
    avg24h: price,
    vol24h: volume,
  };
}

const options = {
  scanDays: 14,
  recentDays: 3,
  baselineDays: 14,
  minHistoricalWindows: 5,
  minRatio: 2,
  minAnomalyScore: 4,
  minUnits: 10,
  minGold: 100,
  analysisEnd: new Date("2026-07-12T00:00:00.000Z"),
};

void test("detects abnormal recent cumulative units and Gold turnover", () => {
  const report = findVolumeAnomalies(
    [
      row(1, "10"),
      row(2, "11"),
      row(3, "10"),
      row(4, "12"),
      row(5, "10"),
      row(6, "11"),
      row(7, "10"),
      row(8, "12"),
      row(9, "10"),
      row(10, "40", "3"),
      row(11, "50", "3"),
      row(12, "60", "3"),
    ],
    options,
  );

  const unitAnomaly = report.unitAnomalies[0];
  assert.ok(unitAnomaly);
  assert.equal(unitAnomaly.recentTotal, 100);
  assert.equal(unitAnomaly.recentUnits, 100);
  assert.equal(unitAnomaly.recentGold, 290);
  assert.equal(unitAnomaly.elevatedDays, 2);
  assert.equal(unitAnomaly.accelerationRatio, 5);
  assert.ok(unitAnomaly.ratio > 3);
  assert.ok(unitAnomaly.anomalyScore > 4);
  assert.ok(Math.abs((unitAnomaly.priceChangePct ?? 0) - 45) < 0.001);

  assert.equal(report.goldAnomalies.length, 1);
});

void test("does not require every recent day to cross the ratio threshold", () => {
  const report = findVolumeAnomalies(
    [
      row(1, "10"),
      row(2, "10"),
      row(3, "10"),
      row(4, "10"),
      row(5, "10"),
      row(6, "10"),
      row(7, "10"),
      row(8, "10"),
      row(9, "10"),
      row(10, "15"),
      row(11, "20"),
      row(12, "100"),
    ],
    { ...options, minGold: 0 },
  );

  const anomaly = report.unitAnomalies[0];
  assert.ok(anomaly);
  assert.equal(anomaly.elevatedDays, 2);
  assert.equal(anomaly.recentTotal, 135);
});

void test("rejects high ratios without a statistically unusual score", () => {
  const report = findVolumeAnomalies(
    [
      row(1, "1"),
      row(2, "2"),
      row(3, "4"),
      row(4, "8"),
      row(5, "16"),
      row(6, "32"),
      row(7, "64"),
      row(8, "128"),
      row(9, "256"),
      row(10, "300"),
      row(11, "300"),
      row(12, "300"),
    ],
    { ...options, minAnomalyScore: 100, minGold: 0 },
  );

  assert.equal(report.unitAnomalies.length, 0);
});

void test("requires enough complete historical comparison windows", () => {
  const report = findVolumeAnomalies(
    [
      row(5, "10"),
      row(6, "10"),
      row(7, "10"),
      row(10, "100"),
      row(11, "100"),
      row(12, "100"),
    ],
    { ...options, minGold: 0 },
  );

  assert.deepEqual(report, { unitAnomalies: [], goldAnomalies: [] });
});
