import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { dbEnv } from "../env";
import * as schema from "./schema";

const queryClient = postgres(dbEnv().DATABASE_URL);

export const db = drizzle({
  client: queryClient,
  schema,
  casing: "snake_case",
});
