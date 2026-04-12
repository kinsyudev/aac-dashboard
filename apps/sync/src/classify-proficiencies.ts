import fs from "fs";
import Anthropic from "@anthropic-ai/sdk";

import { eq, isNull } from "@acme/db";
import { db } from "@acme/db/client";
import { crafts, items, proficiencyEnum } from "@acme/db/schema";

type Proficiency = (typeof proficiencyEnum.enumValues)[number];

const PROFICIENCIES = proficiencyEnum.enumValues;
const BATCH_SIZE = 75;
const SKIPPED_FILE = "skipped-crafts.jsonl";

const client = new Anthropic();

interface CraftRow {
  id: number;
  name: string;
  primaryProductName: string | null;
  primaryProductCategory: string | null;
}

interface ClassifyResult {
  classified: Map<number, Proficiency>;
  skipped: CraftRow[];
}

async function classifyBatch(batch: CraftRow[]): Promise<ClassifyResult> {
  const lines = batch.map((c) =>
    `id=${c.id} | craft="${c.name}" | product="${c.primaryProductName ?? "?"}" | category="${c.primaryProductCategory ?? "?"}"`,
  );

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `You are classifying ArcheAge 3.0 crafting recipes into proficiency categories.

Valid proficiency values (exact spelling required):
${PROFICIENCIES.join(", ")}

For each craft below, output one line: <id>=<Proficiency>
If a craft clearly does not belong to any proficiency (e.g. it is a game system recipe, not a player craft), output <id>=SKIP

Crafts:
${lines.join("\n")}`,
      },
    ],
  });

  const firstContentBlock = response.content[0];
  const text =
    firstContentBlock?.type === "text" ? firstContentBlock.text : "";

  const classified = new Map<number, Proficiency>();
  const skippedIds = new Set<number>();

  for (const line of text.split("\n")) {
    const match = /^(?:id=)?(\d+)=(.+)$/.exec(line.trim());
    if (!match) continue;
    const [, rawId, rawValue] = match;
    if (!rawId || !rawValue) continue;

    const id = parseInt(rawId, 10);
    const value = rawValue.trim();
    if (value === "SKIP") {
      skippedIds.add(id);
    } else if (PROFICIENCIES.includes(value as Proficiency)) {
      classified.set(id, value as Proficiency);
    } else {
      console.warn(`  Unknown value "${value}" for craft ${id}`);
      skippedIds.add(id);
    }
  }

  // Any craft Claude didn't mention at all also goes to skipped
  const skipped = batch.filter((c) => !classified.has(c.id));

  return { classified, skipped };
}

async function main() {
  const unclassified = await db
    .select({
      id: crafts.id,
      name: crafts.name,
      primaryProductName: items.name,
      primaryProductCategory: items.category,
    })
    .from(crafts)
    .leftJoin(items, eq(crafts.primaryProductId, items.id))
    .where(isNull(crafts.proficiency));

  if (unclassified.length === 0) {
    console.log("All crafts already classified.");
    return;
  }

  console.log(`Classifying ${unclassified.length} crafts in batches of ${BATCH_SIZE}...`);

  // Clear skipped file for this run
  fs.writeFileSync(SKIPPED_FILE, "");

  let totalClassified = 0;
  let totalSkipped = 0;

  for (let i = 0; i < unclassified.length; i += BATCH_SIZE) {
    const batch = unclassified.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(unclassified.length / BATCH_SIZE);
    process.stdout.write(`Batch ${batchNum}/${totalBatches}... `);

    const { classified, skipped } = await classifyBatch(batch);

    for (const [id, proficiency] of classified) {
      await db.update(crafts).set({ proficiency }).where(eq(crafts.id, id));
    }

    // Append skipped items to file
    for (const item of skipped) {
      fs.appendFileSync(SKIPPED_FILE, JSON.stringify(item) + "\n");
    }

    totalClassified += classified.size;
    totalSkipped += skipped.length;
    console.log(`→ ${classified.size} classified, ${skipped.length} skipped`);
  }

  console.log(`\nDone. ${totalClassified} classified, ${totalSkipped} skipped.`);
  console.log(`Skipped items written to ${SKIPPED_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
