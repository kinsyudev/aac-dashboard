import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { oAuthProxy } from "better-auth/plugins";

import { and, eq } from "@acme/db";
import { db } from "@acme/db/client";
import { account, appUserRole } from "@acme/db/schema";

const DISCORD_API_BASE_URL = "https://discord.com/api/v10";

interface DiscordGuildMemberResponse {
  roles?: string[];
}

function isDiscordCallbackContext(
  context: { path?: string; params?: Record<string, string | undefined> } | null,
) {
  return context?.path === "/callback/:id" && context.params?.id === "discord";
}

async function fetchDiscordGuildMember(input: {
  accessToken: string;
  guildId: string;
}) {
  const response = await fetch(
    `${DISCORD_API_BASE_URL}/users/@me/guilds/${input.guildId}/member`,
    {
      headers: {
        authorization: `Bearer ${input.accessToken}`,
      },
    },
  );

  if (
    response.status === 401 ||
    response.status === 403 ||
    response.status === 404
  ) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Discord guild member lookup failed: ${response.status}`);
  }

  return (await response.json()) as DiscordGuildMemberResponse;
}

async function ensureDiscordAccess(input: {
  accessToken: string | null | undefined;
  guildId: string;
  requiredRoleId: string;
}) {
  if (!input.accessToken) {
    return false;
  }

  const member = await fetchDiscordGuildMember({
    accessToken: input.accessToken,
    guildId: input.guildId,
  });

  if (!member?.roles?.includes(input.requiredRoleId)) {
    return false;
  }

  return true;
}

export function initAuth<
  TExtraPlugins extends BetterAuthPlugin[] = [],
>(options: {
  baseUrl: string;
  productionUrl: string;
  secret: string | undefined;

  discordClientId: string;
  discordClientSecret: string;
  allowedDiscordIds: Set<string>;
  requiredDiscordGuildId: string;
  requiredDiscordRoleId: string;
  extraPlugins?: TExtraPlugins;
}) {
  const config = {
    database: drizzleAdapter(db, {
      provider: "pg",
    }),
    baseURL: options.baseUrl,
    secret: options.secret,
    databaseHooks: {
      session: {
        create: {
          before: async (sessionData, context) => {
            if (!isDiscordCallbackContext(context)) {
              return;
            }

            const discordAccount = await db.query.account.findFirst({
              columns: {
                accountId: true,
                accessToken: true,
              },
              where: and(
                eq(account.userId, sessionData.userId),
                eq(account.providerId, "discord"),
              ),
            });

            if (!discordAccount) {
              return false;
            }

            if (options.allowedDiscordIds.has(discordAccount.accountId)) {
              return;
            }

            const hasDiscordAccess = await ensureDiscordAccess({
              accessToken: discordAccount.accessToken,
              guildId: options.requiredDiscordGuildId,
              requiredRoleId: options.requiredDiscordRoleId,
            });

            if (!hasDiscordAccess) {
              return false;
            }

            await db
              .insert(appUserRole)
              .values({
                userId: sessionData.userId,
                role: "member",
              })
              .onConflictDoNothing();
          },
        },
      },
    },
    plugins: [
      oAuthProxy({
        productionURL: options.productionUrl,
      }),
      ...(options.extraPlugins ?? []),
    ],
    socialProviders: {
      discord: {
        clientId: options.discordClientId,
        clientSecret: options.discordClientSecret,
        redirectURI: `${options.baseUrl}/api/auth/callback/discord`,
        scope: ["guilds.members.read"],
      },
    },
    trustedOrigins: [],
    onAPIError: {
      onError(error, ctx) {
        console.error("BETTER AUTH API ERROR", error, ctx);
      },
    },
  } satisfies BetterAuthOptions;

  return betterAuth(config);
}

export type Auth = ReturnType<typeof initAuth>;
export type Session = Auth["$Infer"]["Session"];
