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

function logAuthDebug(event: string, details: Record<string, unknown>) {
  console.info("[auth][discord-rbac]", event, details);
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
  logAuthDebug("guild-member-fetch:start", {
    guildId: input.guildId,
  });

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
    logAuthDebug("guild-member-fetch:missing", {
      guildId: input.guildId,
      status: response.status,
    });
    return null;
  }

  if (!response.ok) {
    logAuthDebug("guild-member-fetch:error", {
      guildId: input.guildId,
      status: response.status,
    });
    throw new Error(`Discord guild member lookup failed: ${response.status}`);
  }

  const member = (await response.json()) as DiscordGuildMemberResponse;
  logAuthDebug("guild-member-fetch:success", {
    guildId: input.guildId,
    roleCount: member.roles?.length ?? 0,
  });
  return member;
}

async function ensureDiscordAccess(input: {
  accessToken: string | null | undefined;
  guildId: string;
  requiredRoleId: string;
}) {
  if (!input.accessToken) {
    logAuthDebug("discord-access:no-access-token", {
      guildId: input.guildId,
      requiredRoleId: input.requiredRoleId,
    });
    return false;
  }

  const member = await fetchDiscordGuildMember({
    accessToken: input.accessToken,
    guildId: input.guildId,
  });

  const hasRequiredRole = member?.roles?.includes(input.requiredRoleId) ?? false;

  logAuthDebug("discord-access:evaluated", {
    guildId: input.guildId,
    requiredRoleId: input.requiredRoleId,
    isGuildMember: member != null,
    hasRequiredRole,
  });

  if (!hasRequiredRole) {
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

            logAuthDebug("session-create:discord-callback", {
              userId: sessionData.userId,
              path: context?.path ?? null,
              providerId: context?.params?.id ?? null,
            });

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
              logAuthDebug("session-create:deny-no-discord-account", {
                userId: sessionData.userId,
              });
              return false;
            }

            if (options.allowedDiscordIds.has(discordAccount.accountId)) {
              logAuthDebug("session-create:allow-bypass", {
                userId: sessionData.userId,
                discordAccountId: discordAccount.accountId,
              });
              return;
            }

            const hasDiscordAccess = await ensureDiscordAccess({
              accessToken: discordAccount.accessToken,
              guildId: options.requiredDiscordGuildId,
              requiredRoleId: options.requiredDiscordRoleId,
            });

            if (!hasDiscordAccess) {
              logAuthDebug("session-create:deny-discord-gate", {
                userId: sessionData.userId,
                discordAccountId: discordAccount.accountId,
                guildId: options.requiredDiscordGuildId,
                requiredRoleId: options.requiredDiscordRoleId,
              });
              return false;
            }

            await db
              .insert(appUserRole)
              .values({
                userId: sessionData.userId,
                role: "member",
              })
              .onConflictDoNothing();

            logAuthDebug("session-create:allow-member", {
              userId: sessionData.userId,
              discordAccountId: discordAccount.accountId,
              assignedRole: "member",
            });
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
