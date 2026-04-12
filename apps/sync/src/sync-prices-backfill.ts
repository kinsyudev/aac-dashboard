import { sql } from "@acme/db";
import { db } from "@acme/db/client";
import { items, prices } from "@acme/db/schema";

const API_BASE_URL = "https://api.sermeatball.com";
const TARGET_PERIOD = "1d";
const CONCURRENCY = 10;
const INSERT_BATCH_SIZE = 500;

interface ApiPriceRow {
  item_id: number;
  item_name: string;
  volume: number | string | null;
  average: number | string | null;
  period: string;
  last_cache_time: string;
}

interface BackfillRow {
  itemId: number;
  itemName: string;
  avg24h: string | null;
  vol24h: string | null;
  avg7d: null;
  vol7d: null;
  avg30d: null;
  vol30d: null;
  fetchedAt: string;
}

function normalizeTimestamp(value: string): string | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function toNullableString(value: number | string | null): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function buildRows(
  apiRows: ApiPriceRow[],
  earliestExisting: string | null,
): BackfillRow[] {
  const earliestParsedMs =
    earliestExisting == null ? Number.POSITIVE_INFINITY : new Date(earliestExisting).getTime();
  const earliestMs = Number.isFinite(earliestParsedMs)
    ? earliestParsedMs
    : Number.POSITIVE_INFINITY;
  const deduped = new Map<string, BackfillRow>();

  for (const row of apiRows) {
    if (row.period !== TARGET_PERIOD) continue;

    const fetchedAt = normalizeTimestamp(row.last_cache_time);
    if (!fetchedAt) continue;

    const fetchedMs = new Date(fetchedAt).getTime();
    if (!Number.isFinite(fetchedMs) || fetchedMs >= earliestMs) continue;

    const key = `${row.item_id}:${fetchedAt}`;
    if (deduped.has(key)) continue;

    deduped.set(key, {
      itemId: row.item_id,
      itemName: row.item_name,
      avg24h: toNullableString(row.average),
      vol24h: toNullableString(row.volume),
      avg7d: null,
      vol7d: null,
      avg30d: null,
      vol30d: null,
      fetchedAt,
    });
  }

  return [...deduped.values()].sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt));
}

async function fetchApiRows(itemId: number): Promise<ApiPriceRow[]> {
  const response = await fetch(`${API_BASE_URL}/prices/${itemId}`, { redirect: "follow" });

  if (response.status === 404) {
    return [];
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch item ${itemId}: ${response.status} ${response.statusText}`);
  }

  const data: unknown = await response.json();
  return Array.isArray(data) ? (data as ApiPriceRow[]) : [];
}

async function insertRows(rows: BackfillRow[]) {
  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + INSERT_BATCH_SIZE);
    await db.insert(prices).values(batch).onConflictDoNothing();
  }
}

async function main() {
  console.log("Loading items and existing price boundaries...");

  const [allItems, earliestRows] = await Promise.all([
    db.select({ id: items.id }).from(items),
    db
      .select({
        itemId: prices.itemId,
        earliestFetchedAt: sql<string>`min(${prices.fetchedAt})`,
      })
      .from(prices)
      .groupBy(prices.itemId),
  ]);

  const earliestByItemId = new Map<number, string | null>(
    earliestRows.map((row) => [row.itemId, row.earliestFetchedAt]),
  );

  console.log(`Found ${allItems.length} items to evaluate for backfill`);

  let nextIndex = 0;
  let processed = 0;
  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  async function worker() {
    while (nextIndex < allItems.length) {
      const currentIndex = nextIndex++;
      const item = allItems[currentIndex];

      if (!item) continue;

      try {
        const apiRows = await fetchApiRows(item.id);
        if (apiRows.length === 0) {
          skipped++;
        } else {
          const rowsToInsert = buildRows(apiRows, earliestByItemId.get(item.id) ?? null);
          if (rowsToInsert.length === 0) {
            skipped++;
          } else {
            await insertRows(rowsToInsert);
            inserted += rowsToInsert.length;
          }
        }
      } catch (error) {
        failed++;
        console.warn(
          `Failed item ${item.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        processed++;

        if (processed % 100 === 0 || processed === allItems.length) {
          console.log(
            `Processed ${processed}/${allItems.length} items; inserted ${inserted} rows; skipped ${skipped}; failed ${failed}`,
          );
        }
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  console.log(
    `Backfill complete. Processed ${processed} items; inserted ${inserted} rows; skipped ${skipped}; failed ${failed}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => process.exit(0));
