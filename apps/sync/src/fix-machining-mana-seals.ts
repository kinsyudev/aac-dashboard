import { eq, inArray, or, sql } from "@acme/db";
import { db } from "@acme/db/client";
import { crafts, items } from "@acme/db/schema";
import type { AnyColumn } from "@acme/db";

const TARGET_PROFICIENCY = "Machining" as const;
const MATCH_PATTERN = "% Mana Seal";

function endsWithManaSeal(column: AnyColumn) {
  return sql`lower(${column}) like ${MATCH_PATTERN.toLowerCase()}`;
}

async function main() {
  const candidates = await db
    .select({
      id: crafts.id,
      craftName: crafts.name,
      productName: items.name,
      currentProficiency: crafts.proficiency,
    })
    .from(crafts)
    .leftJoin(items, eq(crafts.primaryProductId, items.id))
    .where(or(endsWithManaSeal(crafts.name), endsWithManaSeal(items.name)))
    .orderBy(crafts.id);

  if (candidates.length === 0) {
    console.log("No Mana Seal crafts found.");
    return;
  }

  console.log(
    `Found ${candidates.length} Mana Seal crafts. Updating all to ${TARGET_PROFICIENCY}.`,
  );

  for (const candidate of candidates) {
    console.log(
      `- #${candidate.id}: ${candidate.craftName} | product=${candidate.productName ?? "?"} | current=${candidate.currentProficiency ?? "null"}`,
    );
  }

  await db
    .update(crafts)
    .set({ proficiency: TARGET_PROFICIENCY })
    .where(
      inArray(
        crafts.id,
        candidates.map((candidate) => candidate.id),
      ),
    );

  console.log(`Updated ${candidates.length} crafts to ${TARGET_PROFICIENCY}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
