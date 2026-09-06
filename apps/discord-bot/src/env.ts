import { createEnv } from "@t3-oss/env-core";
import { z } from "zod/v4";

export function botEnv(options: { skipValidation?: boolean } = {}) {
  return createEnv({
    server: {
      AAC_DISCORD_BOT_TOKEN: z.string().min(1),
      AAC_DISCORD_GUILD_ID: z.string().min(1).optional(),
      DATABASE_URL: z.string().min(1),
      NODE_ENV: z.enum(["development", "production"]).optional(),
    },
    runtimeEnv: process.env,
    skipValidation:
      options.skipValidation ??
      (!!process.env.CI || process.env.npm_lifecycle_event === "lint"),
  });
}
