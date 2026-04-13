import { reactStartCookies } from "better-auth/react-start";

import { initAuth } from "@acme/auth";

import { env } from "~/env";
import { getBaseUrl } from "~/lib/url";

export const auth = initAuth({
  baseUrl: getBaseUrl(),
  productionUrl: `https://${env.RAILWAY_PUBLIC_DOMAIN ?? "aac.kinsyu.dev"}`,
  secret: env.AUTH_SECRET,
  discordClientId: env.AUTH_DISCORD_ID,
  discordClientSecret: env.AUTH_DISCORD_SECRET,
  allowedDiscordIds: new Set(
    env.AUTH_ALLOWED_DISCORD_IDS.split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  ),

  extraPlugins: [reactStartCookies()],
});
