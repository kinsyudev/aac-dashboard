import { sql } from "@acme/db";
import { db } from "@acme/db/client";
import { craftMaterials, craftProducts, crafts, items } from "@acme/db/schema";

import { buildStaticApiCache } from "./static-api-cache";

const BASE_URL = "https://aa-classic.com/data";
const HEADERS: Record<string, string> = {
  accept: "*/*",
  "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
  "cache-control": "no-cache",
  pragma: "no-cache",
  referer: "https://aa-classic.com/database",
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
};

const AUTH_COOKIE = process.env.AAC_AUTH;
if (!AUTH_COOKIE) {
  console.error("Set AAC_AUTH env var to your auth JWT token");
  process.exit(1);
}

// --- API types ---

interface ItemIndex {
  id: number;
  name: string;
}

interface ItemDetail {
  id: number;
  name: string;
  description: string | null;
  category_name: string;
  level: number;
  price: number;
  refund: number;
  bind_id: number;
  sellable: boolean;
  impl_id: number;
  fixed_grade: number;
  gradable: boolean;
  max_stack_size: number;
  level_requirement: number;
  level_limit: number;
  icon_filename: string;
  over_icon_filename: string | null;
}

interface CraftIndex {
  id: number;
  name: string;
}

interface CraftDetail {
  id: number;
  name: string;
  labor: number;
  cast_delay_ms: number;
  primary_product_id: number;
  products: { item_id: number; amount: number; rate: number }[];
  materials: { item_id: number; amount: number }[];
}

// --- Config ---

const BATCH = 200;
const CONCURRENCY = 20;

// --- Helpers ---

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { ...HEADERS, cookie: `auth=${AUTH_COOKIE}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function fetchBatch<T>(paths: string[]): Promise<(T | null)[]> {
  const results = Array<T | null>(paths.length).fill(null);
  let idx = 0;

  async function worker() {
    while (idx < paths.length) {
      const i = idx++;
      const path = paths[i];
      if (path == null) {
        continue;
      }

      try {
        results[i] = await api<T>(path);
      } catch (e) {
        console.warn(
          `  Failed ${path}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results;
}

// --- Main ---

async function main() {
  const fullRefresh = process.argv.includes("--full-refresh");

  if (fullRefresh) {
    console.log("Clearing existing data...");
    await db.delete(craftMaterials);
    await db.delete(craftProducts);
    await db.delete(crafts);
    await db.delete(items);
  }

  // ── Items ──────────────────────────────────────────────────────────────────

  console.log("Fetching item index...");
  const remoteItems = await api<ItemIndex[]>("/items/_index.json");

  const existingItemIds = new Set(
    (await db.select({ id: items.id }).from(items)).map((r) => r.id),
  );
  const missingItems = remoteItems.filter((i) => !existingItemIds.has(i.id));
  console.log(
    `Items: ${remoteItems.length} remote, ${existingItemIds.size} in DB, ${missingItems.length} to sync`,
  );

  let itemsDone = 0;
  for (let i = 0; i < missingItems.length; i += BATCH) {
    const chunk = missingItems.slice(i, i + BATCH);
    const details = await fetchBatch<ItemDetail>(
      chunk.map((item) => `/items/${item.id}.json`),
    );

    const valid = details.filter((d): d is ItemDetail => d !== null);
    if (valid.length > 0) {
      await db
        .insert(items)
        .values(
          valid.map((d) => ({
            id: d.id,
            name: d.name,
            description: d.description,
            category: d.category_name,
            level: d.level,
            price: d.price,
            refund: d.refund,
            bindId: d.bind_id,
            sellable: d.sellable,
            implId: d.impl_id,
            fixedGrade: d.fixed_grade,
            gradable: d.gradable,
            maxStackSize: d.max_stack_size,
            levelRequirement: d.level_requirement,
            levelLimit: d.level_limit,
            icon: d.icon_filename,
            overIcon: d.over_icon_filename,
          })),
        )
        .onConflictDoUpdate({
          target: items.id,
          set: {
            name: sql`excluded.name`,
            description: sql`excluded.description`,
            category: sql`excluded.category`,
            level: sql`excluded.level`,
            price: sql`excluded.price`,
            refund: sql`excluded.refund`,
            bindId: sql`excluded.bind_id`,
            sellable: sql`excluded.sellable`,
            implId: sql`excluded.impl_id`,
            fixedGrade: sql`excluded.fixed_grade`,
            gradable: sql`excluded.gradable`,
            maxStackSize: sql`excluded.max_stack_size`,
            levelRequirement: sql`excluded.level_requirement`,
            levelLimit: sql`excluded.level_limit`,
            icon: sql`excluded.icon`,
            overIcon: sql`excluded.over_icon`,
          },
        });
    }

    itemsDone += chunk.length;
    console.log(`  ${itemsDone}/${missingItems.length} processed, ${valid.length}/${chunk.length} inserted`);
  }

  const totalItems = await db.$count(items);
  console.log(`Items done: ${totalItems} total in DB`);

  // ── Crafts ─────────────────────────────────────────────────────────────────

  console.log("Fetching craft index...");
  const remoteCrafts = await api<CraftIndex[]>("/crafts/_index.json");

  const existingCraftIds = new Set(
    (await db.select({ id: crafts.id }).from(crafts)).map((r) => r.id),
  );
  const missingCrafts = remoteCrafts.filter((c) => !existingCraftIds.has(c.id));
  console.log(
    `Crafts: ${remoteCrafts.length} remote, ${existingCraftIds.size} in DB, ${missingCrafts.length} to sync`,
  );

  const knownItemIds = new Set(
    (await db.select({ id: items.id }).from(items)).map((r) => r.id),
  );

  let craftsDone = 0;
  for (let i = 0; i < missingCrafts.length; i += BATCH) {
    const chunk = missingCrafts.slice(i, i + BATCH);
    const details = await fetchBatch<CraftDetail>(
      chunk.map((c) => `/crafts/${c.id}.json`),
    );

    const insertable = details.filter((d): d is CraftDetail => d !== null);

    if (insertable.length > 0) {
      await db
        .insert(crafts)
        .values(
          insertable.map((d) => ({
            id: d.id,
            name: d.name,
            labor: d.labor,
            castDelayMs: d.cast_delay_ms,
            // null if the primary product couldn't be fetched — craft is still usable via craft_products
            primaryProductId: knownItemIds.has(d.primary_product_id) ? d.primary_product_id : null,
          })),
        )
        .onConflictDoUpdate({
          target: crafts.id,
          set: {
            name: sql`excluded.name`,
            labor: sql`excluded.labor`,
            castDelayMs: sql`excluded.cast_delay_ms`,
            primaryProductId: sql`excluded.primary_product_id`,
          },
        });

      const allProducts = insertable.flatMap((d) =>
        d.products
          .filter((p) => knownItemIds.has(p.item_id))
          .map((p) => ({ craftId: d.id, itemId: p.item_id, amount: p.amount, rate: p.rate })),
      );
      if (allProducts.length > 0) {
        await db.insert(craftProducts).values(allProducts).onConflictDoNothing();
      }

      const allMaterials = insertable.flatMap((d) =>
        d.materials
          .filter((m) => knownItemIds.has(m.item_id))
          .map((m) => ({ craftId: d.id, itemId: m.item_id, amount: m.amount })),
      );
      if (allMaterials.length > 0) {
        await db.insert(craftMaterials).values(allMaterials).onConflictDoNothing();
      }
    }

    craftsDone += chunk.length;
    console.log(`  ${craftsDone}/${missingCrafts.length} processed, ${insertable.length}/${chunk.length} inserted`);
  }

  const totalCrafts = await db.$count(crafts);
  const totalProducts = await db.$count(craftProducts);
  const totalMaterials = await db.$count(craftMaterials);
  console.log(`Crafts done: ${totalCrafts} crafts, ${totalProducts} products, ${totalMaterials} materials`);
  console.log("Building static API cache...");
  await buildStaticApiCache();
  console.log("Done!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
