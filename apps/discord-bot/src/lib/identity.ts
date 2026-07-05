import { and, eq } from "@acme/db";
import type { db as appDb } from "@acme/db/client";
import { account } from "@acme/db/schema";

export async function findDashboardUserIdForDiscordUser(
  database: typeof appDb,
  discordUserId: string,
) {
  const row = await database.query.account.findFirst({
    columns: { userId: true },
    where: and(
      eq(account.providerId, "discord"),
      eq(account.accountId, discordUserId),
    ),
  });

  return row?.userId ?? null;
}
