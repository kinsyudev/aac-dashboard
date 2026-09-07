export interface MarketSnapshot {
  itemId: number;
  itemName: string;
  fetchedAt: string;
  avg24h: string | null;
  vol24h: string | null;
}

export interface AnomalyOptions {
  scanDays: number;
  recentDays: number;
  baselineDays: number;
  minHistoricalWindows: number;
  minRatio: number;
  minAnomalyScore: number;
  minUnits: number;
  minGold: number;
  analysisEnd: Date;
}

export interface MarketAnomaly {
  itemId: number;
  itemName: string;
  startedAt: string;
  endedAt: string;
  recentTotal: number;
  baselineMedian: number;
  ratio: number;
  anomalyScore: number;
  recentUnits: number;
  recentGold: number | null;
  priceChangePct: number | null;
  elevatedDays: number;
  accelerationRatio: number;
  historicalWindows: number;
}

export interface VolumeAnomalyReport {
  unitAnomalies: MarketAnomaly[];
  goldAnomalies: MarketAnomaly[];
}

interface MetricSnapshot {
  itemId: number;
  itemName: string;
  fetchedAt: string;
  timestamp: number;
  units: number | null;
  price: number | null;
  gold: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAD_SCALE = 1.4826;

function parseNonNegativeNumber(value: string | null): number | null {
  if (value == null) return null;

  const parsed = Number.parseFloat(value.replaceAll(",", ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const middleValue = sorted[middle];

  if (middleValue == null) return 0;
  if (sorted.length % 2 === 1) return middleValue;

  return ((sorted[middle - 1] ?? middleValue) + middleValue) / 2;
}

function isDailyWindow(snapshots: MetricSnapshot[]): boolean {
  return snapshots.every((snapshot, index) => {
    const previous = snapshots[index - 1];
    if (!previous) return true;

    const gap = snapshot.timestamp - previous.timestamp;
    return gap > 0 && gap <= DAY_MS * 1.5;
  });
}

function total(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

function multiple(observed: number, baseline: number): number {
  if (baseline === 0) {
    return observed > 0 ? Number.POSITIVE_INFINITY : 1;
  }
  return observed / baseline;
}

function robustScore(observed: number, historical: number[]): number {
  const historicalMedian = median(historical);
  const mad = median(
    historical.map((value) => Math.abs(value - historicalMedian)),
  );

  if (mad === 0) {
    return observed > historicalMedian ? Number.POSITIVE_INFINITY : 0;
  }

  return (observed - historicalMedian) / (MAD_SCALE * mad);
}

function rollingTotals(
  snapshots: MetricSnapshot[],
  metric: "units" | "gold",
  windowDays: number,
): number[] {
  const totals: number[] = [];

  for (let index = 0; index <= snapshots.length - windowDays; index++) {
    const window = snapshots.slice(index, index + windowDays);
    if (!isDailyWindow(window)) continue;

    const values = window
      .map((snapshot) => snapshot[metric])
      .filter((value): value is number => value != null);
    if (values.length === windowDays) totals.push(total(values));
  }

  return totals;
}

function descendingValue(value: number): number {
  return Number.isFinite(value) ? value : Number.MAX_VALUE;
}

function findMetricAnomalies(
  snapshots: MetricSnapshot[],
  metric: "units" | "gold",
  options: AnomalyOptions,
): MarketAnomaly[] {
  const minimum = metric === "units" ? options.minUnits : options.minGold;
  const grouped = new Map<number, MetricSnapshot[]>();
  const strongestByItem = new Map<number, MarketAnomaly>();
  const analysisStart =
    options.analysisEnd.getTime() - options.scanDays * DAY_MS;

  for (const snapshot of snapshots) {
    const itemSnapshots = grouped.get(snapshot.itemId) ?? [];
    itemSnapshots.push(snapshot);
    grouped.set(snapshot.itemId, itemSnapshots);
  }

  for (const itemSnapshots of grouped.values()) {
    itemSnapshots.sort((a, b) => a.timestamp - b.timestamp);
    const eligible = itemSnapshots.filter(
      (snapshot) => snapshot.timestamp <= options.analysisEnd.getTime(),
    );

    for (
      let startIndex = 0;
      startIndex <= eligible.length - options.recentDays;
      startIndex++
    ) {
      const recent = eligible.slice(
        startIndex,
        startIndex + options.recentDays,
      );
      const first = recent[0];
      const last = recent.at(-1);

      if (!first || !last || first.timestamp < analysisStart) continue;
      if (!isDailyWindow(recent)) continue;

      const recentValues = recent
        .map((snapshot) => snapshot[metric])
        .filter((value): value is number => value != null);
      if (recentValues.length !== options.recentDays) continue;

      const recentTotal = total(recentValues);
      if (recentTotal < minimum) continue;

      const baselineStart = first.timestamp - options.baselineDays * DAY_MS;
      const baseline = eligible.filter(
        (snapshot) =>
          snapshot.timestamp >= baselineStart &&
          snapshot.timestamp < first.timestamp,
      );
      const historicalTotals = rollingTotals(
        baseline,
        metric,
        options.recentDays,
      );
      if (historicalTotals.length < options.minHistoricalWindows) continue;

      const baselineMedian = median(historicalTotals);
      const ratio = multiple(recentTotal, baselineMedian);
      const anomalyScore = robustScore(recentTotal, historicalTotals);
      if (ratio < options.minRatio || anomalyScore < options.minAnomalyScore) {
        continue;
      }

      const recentUnitValues = recent
        .map((snapshot) => snapshot.units)
        .filter((value): value is number => value != null);
      if (recentUnitValues.length !== options.recentDays) continue;

      const recentGoldValues = recent
        .map((snapshot) => snapshot.gold)
        .filter((value): value is number => value != null);
      const baselinePrices = baseline
        .map((snapshot) => snapshot.price)
        .filter((value): value is number => value != null && value > 0);
      const recentUnits = total(recentUnitValues);
      const recentGold =
        recentGoldValues.length === options.recentDays
          ? total(recentGoldValues)
          : null;
      const recentWeightedPrice =
        recentGold != null && recentUnits > 0 ? recentGold / recentUnits : null;
      const baselinePrice = median(baselinePrices);
      const priceChangePct =
        recentWeightedPrice != null && baselinePrice > 0
          ? ((recentWeightedPrice - baselinePrice) / baselinePrice) * 100
          : null;
      const dailyUnitBaseline = median(
        baseline
          .map((snapshot) => snapshot.units)
          .filter((value): value is number => value != null),
      );
      const elevatedDays = recentUnitValues.filter(
        (value) => multiple(value, dailyUnitBaseline) >= options.minRatio,
      ).length;
      const firstUnits = recentUnitValues[0] ?? 0;
      const lastUnits = recentUnitValues.at(-1) ?? 0;
      const anomaly: MarketAnomaly = {
        itemId: first.itemId,
        itemName: first.itemName,
        startedAt: first.fetchedAt,
        endedAt: last.fetchedAt,
        recentTotal,
        baselineMedian,
        ratio,
        anomalyScore,
        recentUnits,
        recentGold,
        priceChangePct,
        elevatedDays,
        accelerationRatio: multiple(lastUnits, firstUnits),
        historicalWindows: historicalTotals.length,
      };
      const previous = strongestByItem.get(first.itemId);

      if (
        !previous ||
        descendingValue(anomaly.anomalyScore) >
          descendingValue(previous.anomalyScore) ||
        (anomaly.anomalyScore === previous.anomalyScore &&
          descendingValue(anomaly.ratio) > descendingValue(previous.ratio))
      ) {
        strongestByItem.set(first.itemId, anomaly);
      }
    }
  }

  return [...strongestByItem.values()].sort(
    (a, b) =>
      descendingValue(b.anomalyScore) - descendingValue(a.anomalyScore) ||
      descendingValue(b.ratio) - descendingValue(a.ratio) ||
      b.recentTotal - a.recentTotal,
  );
}

export function findVolumeAnomalies(
  rows: MarketSnapshot[],
  options: AnomalyOptions,
): VolumeAnomalyReport {
  const snapshots = rows.flatMap((row): MetricSnapshot[] => {
    const timestamp = new Date(row.fetchedAt).getTime();
    const units = parseNonNegativeNumber(row.vol24h);
    const price = parseNonNegativeNumber(row.avg24h);

    if (!Number.isFinite(timestamp)) return [];

    return [
      {
        itemId: row.itemId,
        itemName: row.itemName,
        fetchedAt: row.fetchedAt,
        timestamp,
        units,
        price,
        gold: units != null && price != null ? units * price : null,
      },
    ];
  });

  return {
    unitAnomalies: findMetricAnomalies(snapshots, "units", options),
    goldAnomalies: findMetricAnomalies(snapshots, "gold", options),
  };
}
