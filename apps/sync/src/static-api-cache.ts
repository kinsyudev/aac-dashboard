import { mkdir, rename, writeFile } from "node:fs/promises";

import { asc } from "@acme/db";
import { db } from "@acme/db/client";
import { crafts, items } from "@acme/db/schema";

const STATIC_API_CACHE_DIR = "/tmp/aac-dashboard-static-api";
const UNSUPPORTED_CRAFT_NAME_PREFIXES = ["trash_"];

function hasUnsupportedCraftName(name: string) {
  const normalized = name.trim().toLowerCase();
  return UNSUPPORTED_CRAFT_NAME_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix),
  );
}

async function writeJsonFile(filename: string, value: unknown) {
  await mkdir(STATIC_API_CACHE_DIR, { recursive: true });

  const finalPath = `${STATIC_API_CACHE_DIR}/${filename}`;
  const tempPath = `${finalPath}.tmp`;

  await writeFile(tempPath, JSON.stringify(value));
  await rename(tempPath, finalPath);
}

export async function buildStaticApiCache() {
  const [allItems, allCrafts] = await Promise.all([
    db
      .select()
      .from(items)
      .orderBy(asc(items.category), asc(items.name)),
    db
      .select()
      .from(crafts)
      .then((rows) =>
        rows.filter((craft) => !hasUnsupportedCraftName(craft.name)),
      ),
  ]);

  await Promise.all([
    writeJsonFile("items-all.json", allItems),
    writeJsonFile("crafts-all.json", allCrafts),
  ]);
}
