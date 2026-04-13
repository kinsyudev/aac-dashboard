import { authEnv } from "@acme/auth/env";
import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { account } from "@acme/db/schema";

const allowedDiscordIds = new Set(
  authEnv()
    .AUTH_ALLOWED_DISCORD_IDS.split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);

let allowedUserIds = new Set<string>();

async function refreshAllowedUserIds() {
  const accounts = await db.query.account.findMany({
    where: eq(account.providerId, "discord"),
  });

  allowedUserIds = new Set(
    accounts
      .filter((entry) => allowedDiscordIds.has(entry.accountId))
      .map((entry) => entry.userId),
  );
}

const initialAllowedUserLoad = refreshAllowedUserIds();
setInterval(() => void refreshAllowedUserIds(), 60_000);

export async function isAllowedUserId(userId: string) {
  await initialAllowedUserLoad;
  return allowedUserIds.has(userId);
}
