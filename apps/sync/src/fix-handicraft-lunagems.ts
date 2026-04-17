import { eq, inArray, or, sql } from "@acme/db";
import { db } from "@acme/db/client";
import { crafts, items } from "@acme/db/schema";
import type { AnyColumn } from "@acme/db";

const TARGET_PROFICIENCY = "Handicrafts" as const;
const MATCH_TERMS = ["lunagem", "lunafrost"] as const;

function containsAnyTarget(column: AnyColumn) {
  return or(
    ...MATCH_TERMS.map((term) => sql`lower(${column}) like ${`%${term}%`}`),
  );
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
    .where(
      or(
        containsAnyTarget(crafts.name),
        containsAnyTarget(items.name),
      ),
    )
    .orderBy(crafts.id);

  if (candidates.length === 0) {
    console.log("No lunagem/lunafrost crafts found.");
    return;
  }

  console.log(
    `Found ${candidates.length} lunagem/lunafrost crafts. Updating all to ${TARGET_PROFICIENCY}.`,
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
