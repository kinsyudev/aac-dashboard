import type { Config } from "drizzle-kit";

import { dbEnv } from "./env";

const nonPoolingUrl = dbEnv().DATABASE_URL.replace(":6543", ":5432");

export default {
  schema: "./src/schema.ts",
  dialect: "postgresql",
  dbCredentials: { url: nonPoolingUrl },
  casing: "snake_case",
} satisfies Config;
