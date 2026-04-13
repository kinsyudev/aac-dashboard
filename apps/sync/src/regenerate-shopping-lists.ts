import { db } from "@acme/db/client";
import { asc, eq } from "@acme/db";
import { shoppingLists } from "@acme/db/schema";

import {
  getExistingProgress,
  regenerateListState,
} from "../../../packages/api/src/lib/shopping-list-state";

async function regenerateShoppingLists(listId?: string) {
  const baseQuery = db
    .select()
    .from(shoppingLists)
    .orderBy(asc(shoppingLists.updatedAt));
  const rows = listId
    ? await baseQuery.where(eq(shoppingLists.id, listId))
    : await baseQuery;

  if (rows.length === 0) {
    console.log(
      listId
        ? `No shopping list found for ${listId}.`
        : "No shopping lists found to regenerate.",
    );
    return;
  }

  for (const list of rows) {
    await db.transaction(async (tx) => {
      const progress = await getExistingProgress(tx, list.id);
      await regenerateListState(tx, list, progress);
    });

    console.log(`Regenerated ${list.id} (${list.name})`);
  }

  console.log(`Done. Regenerated ${rows.length} shopping list(s).`);
}

const listId = process.argv[2];

regenerateShoppingLists(listId)
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => process.exit(0));
