import { sql } from "@acme/db";
import { db } from "@acme/db/client";
import { prices } from "@acme/db/schema";

const SPREADSHEET_ID = "1VezKZkoRFzTnB0hLpTroTRFG40NH5vEpfMjWtWCCXIc";
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv`;

interface PriceRow {
  itemId: number;
  itemName: string;
  avg24h: string | null;
  vol24h: string | null;
  avg7d: string | null;
  vol7d: string | null;
  avg30d: string | null;
  vol30d: string | null;
}

function toDailyTimestamp(value = new Date()) {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  ).toISOString();
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

function parseRows(csv: string): PriceRow[] {
  const lines = csv.split("\n").filter((l) => l.trim().length > 0);
  const rows: PriceRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line == null) continue;

    const fields = parseCSVLine(line);
    const rawId = fields[0]?.trim();
    if (!rawId || isNaN(Number(rawId))) continue;

    rows.push({
      itemId: Number(rawId),
      itemName: fields[1]?.trim() ?? "",
      avg24h: fields[2]?.trim() ?? null,
      vol24h: fields[3]?.trim() ?? null,
      avg7d: fields[4]?.trim() ?? null,
      vol7d: fields[5]?.trim() ?? null,
      avg30d: fields[6]?.trim() ?? null,
      vol30d: fields[7]?.trim() ?? null,
    });
  }

  return rows;
}

async function main() {
  console.log("Fetching price spreadsheet...");

  const resp = await fetch(CSV_URL, { redirect: "follow" });
  if (!resp.ok) {
    throw new Error(`Failed to fetch spreadsheet: ${resp.status} ${resp.statusText}`);
  }

  const csv = await resp.text();
  const rows = parseRows(csv);
  console.log(`Parsed ${rows.length} price rows from spreadsheet`);

  if (rows.length === 0) {
    console.warn("No price rows parsed, skipping sync");
    return;
  }

  const fetchedAt = toDailyTimestamp();
  const BATCH_SIZE = 500;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await db
      .insert(prices)
      .values(
        batch.map((r) => ({
          itemId: r.itemId,
          itemName: r.itemName,
          avg24h: r.avg24h,
          vol24h: r.vol24h,
          avg7d: r.avg7d,
          vol7d: r.vol7d,
          avg30d: r.avg30d,
          vol30d: r.vol30d,
          fetchedAt,
        })),
      )
      .onConflictDoUpdate({
        target: [prices.itemId, prices.fetchedAt],
        set: {
          itemName: sql`excluded.item_name`,
          avg24h: sql`excluded.avg_24h`,
          vol24h: sql`excluded.vol_24h`,
          avg7d: sql`excluded.avg_7d`,
          vol7d: sql`excluded.vol_7d`,
          avg30d: sql`excluded.avg_30d`,
          vol30d: sql`excluded.vol_30d`,
        },
      });
  }

  console.log(`Synced ${rows.length} price rows`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
