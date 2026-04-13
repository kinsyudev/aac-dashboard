import { buildStaticApiCache } from "./static-api-cache";

buildStaticApiCache()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => process.exit(0));
