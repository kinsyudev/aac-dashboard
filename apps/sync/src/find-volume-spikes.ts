import { gte, sql } from "@acme/db";
import { db } from "@acme/db/client";
import { prices } from "@acme/db/schema";

import type { MarketAnomaly } from "./volume-spikes";
import { findVolumeAnomalies } from "./volume-spikes";

const DAY_MS = 24 * 60 * 60 * 1000;

interface CliOptions {
  scanDays: number;
  recentDays: number;
  baselineDays: number;
  minHistoricalWindows: number;
  minRatio: number;
  minAnomalyScore: number;
  minUnits: number;
  minGold: number;
  limit: number;
}

function usage(): string {
  return [
    "Usage: pnpm market:volume-spikes [options]",
    "",
    "Options:",
    "  --scan-days N             Recent period to search for anomalies (default: 14)",
    "  --recent-days N           Recent cumulative window (default: 3)",
    "  --baseline-days N         Historical comparison period (default: 42)",
    "  --min-history-windows N   Required historical windows (default: 14)",
    "  --min-ratio N             Minimum recent/baseline multiple (default: 2)",
    "  --min-anomaly-score N     Minimum robust MAD score (default: 4)",
    "  --min-units N             Ignore recent totals below this value (default: 10)",
    "  --min-gold N              Ignore recent turnover below this value (default: 100)",
    "  --limit N                 Maximum rows in each table (default: 25)",
    "  --help                     Show this help",
  ].join("\n");
}

function positiveNumber(name: string, raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return value;
}

function nonNegativeNumber(name: string, raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return value;
}

export function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    scanDays: 14,
    recentDays: 3,
    baselineDays: 42,
    minHistoricalWindows: 14,
    minRatio: 2,
    minAnomalyScore: 4,
    minUnits: 10,
    minGold: 100,
    limit: 25,
  };

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--help") {
      console.log(usage());
      process.exit(0);
    }

    const raw = args[++index];
    switch (argument) {
      case "--scan-days":
        options.scanDays = positiveNumber(argument, raw);
        break;
      case "--recent-days":
        options.recentDays = positiveNumber(argument, raw);
        break;
      case "--baseline-days":
        options.baselineDays = positiveNumber(argument, raw);
        break;
      case "--min-history-windows":
        options.minHistoricalWindows = positiveNumber(argument, raw);
        break;
      case "--min-ratio":
        options.minRatio = positiveNumber(argument, raw);
        break;
      case "--min-anomaly-score":
        options.minAnomalyScore = nonNegativeNumber(argument, raw);
        break;
      case "--min-units":
        options.minUnits = nonNegativeNumber(argument, raw);
        break;
      case "--min-gold":
        options.minGold = nonNegativeNumber(argument, raw);
        break;
      case "--limit":
        options.limit = positiveNumber(argument, raw);
        break;
      default:
        throw new Error(
          `Unknown option: ${argument ?? "<missing>"}\n\n${usage()}`,
        );
    }
  }

  for (const name of [
    "scanDays",
    "recentDays",
    "baselineDays",
    "minHistoricalWindows",
    "limit",
  ] as const) {
    if (!Number.isInteger(options[name])) {
      throw new Error(
        `--${name.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} must be an integer`,
      );
    }
  }

  return options;
}

function formatNumber(value: number, maximumFractionDigits = 0): string {
  return value.toLocaleString("en-US", { maximumFractionDigits });
}

function formatMultiple(value: number): string {
  return Number.isFinite(value) ? `${formatNumber(value, 1)}x` : "∞";
}

function formatScore(value: number): string {
  return Number.isFinite(value) ? formatNumber(value, 1) : "∞";
}

function printAnomalies(
  title: string,
  anomalies: MarketAnomaly[],
  limit: number,
  metric: "units" | "gold",
) {
  console.log(`\n${title}`);
  if (anomalies.length === 0) {
    console.log("No anomalies found.");
    return;
  }

  console.table(
    anomalies.slice(0, limit).map((anomaly) => ({
      item: `${anomaly.itemName} (${anomaly.itemId})`,
      period: `${anomaly.startedAt.slice(0, 10)} → ${anomaly.endedAt.slice(0, 10)}`,
      recent:
        metric === "gold"
          ? `${formatNumber(anomaly.recentTotal, 2)}g`
          : formatNumber(anomaly.recentTotal, 2),
      baseline:
        metric === "gold"
          ? `${formatNumber(anomaly.baselineMedian, 2)}g`
          : formatNumber(anomaly.baselineMedian, 2),
      ratio: formatMultiple(anomaly.ratio),
      score: formatScore(anomaly.anomalyScore),
      recentGold:
        anomaly.recentGold == null
          ? "—"
          : `${formatNumber(anomaly.recentGold, 2)}g`,
      priceChange:
        anomaly.priceChangePct == null
          ? "—"
          : `${anomaly.priceChangePct >= 0 ? "+" : ""}${formatNumber(anomaly.priceChangePct, 1)}%`,
      elevatedDays: anomaly.elevatedDays,
      acceleration: formatMultiple(anomaly.accelerationRatio),
      historyWindows: anomaly.historicalWindows,
    })),
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const latestRow = await db
    .select({ latestFetchedAt: sql<string | null>`max(${prices.fetchedAt})` })
    .from(prices);
  const latestFetchedAt = latestRow[0]?.latestFetchedAt;

  if (!latestFetchedAt) {
    console.log("No Market Data snapshots found.");
    return;
  }

  const analysisEnd = new Date(latestFetchedAt);
  const queryStart = new Date(
    analysisEnd.getTime() -
      (options.baselineDays + options.scanDays + options.recentDays + 1) *
        DAY_MS,
  ).toISOString();
  const rows = await db
    .select({
      itemId: prices.itemId,
      itemName: prices.itemName,
      fetchedAt: prices.fetchedAt,
      avg24h: prices.avg24h,
      vol24h: prices.vol24h,
    })
    .from(prices)
    .where(gte(prices.fetchedAt, queryStart));

  const report = findVolumeAnomalies(rows, { ...options, analysisEnd });
  console.log(
    `Analyzed ${rows.length.toLocaleString("en-US")} snapshots through ${latestFetchedAt.slice(0, 10)}. ` +
      `Scanning ${options.recentDays}-day totals in the last ${options.scanDays} days against rolling ` +
      `${options.recentDays}-day windows from each Item's preceding ${options.baselineDays} days.`,
  );
  console.log(
    `Thresholds: ${options.minRatio}x historical median and robust MAD score ≥ ${options.minAnomalyScore}.`,
  );
  printAnomalies(
    "Abnormal cumulative unit volume",
    report.unitAnomalies,
    options.limit,
    "units",
  );
  printAnomalies(
    "Abnormal cumulative Gold turnover (24h average price × 24h volume)",
    report.goldAnomalies,
    options.limit,
    "gold",
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
