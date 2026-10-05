import { db } from "@acme/db/client";

import { applyCustomCrafts } from "./custom-crafts";

async function main() {
  console.log("Applying custom crafts...");
  await applyCustomCrafts(db);
  console.log("Done!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
