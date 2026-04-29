import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { oAuthProxy } from "better-auth/plugins";

import { authEnv } from "@acme/auth/env";
import { and, eq } from "@acme/db";
import { db } from "@acme/db/client";
import { account, appUserRole } from "@acme/db/schema";

const DISCORD_API_BASE_URL = "https://discord.com/api/v10";

interface DiscordGuildMemberResponse {
  roles?: string[];
}

interface DiscordGuildMemberLookupResult {
  member: DiscordGuildMemberResponse | null;
  status: number;
}

function logAuthDebug(event: string, details: Record<string, unknown>) {
  console.info("[auth][discord-rbac]", event, details);
}

export function isDiscordBypassUser(
  allowedDiscordIds: Set<string>,
  discordAccountId: string | null | undefined,
) {
  return (
    discordAccountId != null && allowedDiscordIds.has(discordAccountId)
  );
}

function isDiscordCallbackContext(
  context: { path?: string; params?: Record<string, string | undefined> } | null,
) {
  return context?.path === "/callback/:id" && context.params?.id === "discord";
}

async function fetchDiscordGuildMember(input: {
  accessToken: string;
  guildId: string;
}): Promise<DiscordGuildMemberLookupResult> {
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
    return {
      member: null,
      status: response.status,
    };
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
  return {
    member,
    status: response.status,
  };
}

async function fetchDiscordGuildMemberWithBot(input: {
  botToken: string;
  discordAccountId: string;
  guildId: string;
}): Promise<DiscordGuildMemberLookupResult> {
  logAuthDebug("guild-member-fetch-bot:start", {
    guildId: input.guildId,
    discordAccountId: input.discordAccountId,
  });

  const response = await fetch(
    `${DISCORD_API_BASE_URL}/guilds/${input.guildId}/members/${input.discordAccountId}`,
    {
      headers: {
        authorization: `Bot ${input.botToken}`,
      },
    },
  );

  if (
    response.status === 401 ||
    response.status === 403 ||
    response.status === 404
  ) {
    logAuthDebug("guild-member-fetch-bot:missing", {
      guildId: input.guildId,
      discordAccountId: input.discordAccountId,
      status: response.status,
    });
    return {
      member: null,
      status: response.status,
    };
  }

  if (!response.ok) {
    logAuthDebug("guild-member-fetch-bot:error", {
      guildId: input.guildId,
      discordAccountId: input.discordAccountId,
      status: response.status,
    });
    throw new Error(`Discord bot guild member lookup failed: ${response.status}`);
  }

  const member = (await response.json()) as DiscordGuildMemberResponse;
  logAuthDebug("guild-member-fetch-bot:success", {
    guildId: input.guildId,
    discordAccountId: input.discordAccountId,
    roleCount: member.roles?.length ?? 0,
  });
  return {
    member,
    status: response.status,
  };
}

async function refreshDiscordAccessToken(input: {
  accountId: string;
  refreshToken: string | null | undefined;
}) {
  if (!input.refreshToken) {
    logAuthDebug("token-refresh:missing-refresh-token", {
      accountId: input.accountId,
    });
    return null;
  }

  const env = authEnv();
  const body = new URLSearchParams({
    client_id: env.AUTH_DISCORD_ID,
    client_secret: env.AUTH_DISCORD_SECRET,
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  });

  logAuthDebug("token-refresh:start", {
    accountId: input.accountId,
  });

  const response = await fetch(`${DISCORD_API_BASE_URL}/oauth2/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    logAuthDebug("token-refresh:error", {
      accountId: input.accountId,
      status: response.status,
    });
    return null;
  }

  const refreshed = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };

  await db
    .update(account)
    .set({
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token ?? input.refreshToken,
      accessTokenExpiresAt: refreshed.expires_in
        ? new Date(Date.now() + refreshed.expires_in * 1000)
        : null,
      scope: refreshed.scope ?? null,
      updatedAt: new Date(),
    })
    .where(eq(account.id, input.accountId));

  logAuthDebug("token-refresh:success", {
    accountId: input.accountId,
    hasNewRefreshToken: refreshed.refresh_token != null,
  });

  return {
    accessToken: refreshed.access_token,
  };
}

export async function ensureDiscordAccess(input: {
  accountRowId?: string | null;
  discordAccountId?: string | null;
  accessToken: string | null | undefined;
  refreshToken?: string | null | undefined;
  guildId: string;
  requiredRoleId: string;
}) {
  const env = authEnv();
  const guildId = input.guildId.trim();
  const requiredRoleId = input.requiredRoleId.trim();
  let lookup: DiscordGuildMemberLookupResult | null = null;

  if (env.AUTH_DISCORD_BOT_TOKEN && input.discordAccountId) {
    lookup = await fetchDiscordGuildMemberWithBot({
      botToken: env.AUTH_DISCORD_BOT_TOKEN,
      discordAccountId: input.discordAccountId,
      guildId,
    });
  }

  if (lookup == null) {
    if (!input.accessToken) {
      logAuthDebug("discord-access:no-access-token", {
        guildId,
        requiredRoleId,
      });
      return false;
    }

    let accessToken = input.accessToken;
    lookup = await fetchDiscordGuildMember({
      accessToken,
      guildId,
    });

    if (lookup.status === 401 && input.accountRowId) {
      const refreshed = await refreshDiscordAccessToken({
        accountId: input.accountRowId,
        refreshToken: input.refreshToken,
      });

      if (refreshed?.accessToken) {
        accessToken = refreshed.accessToken;
        lookup = await fetchDiscordGuildMember({
          accessToken,
          guildId,
        });
      }
    }
  }

  const hasRequiredRole =
    lookup.member?.roles?.includes(requiredRoleId) ?? false;

  logAuthDebug("discord-access:evaluated", {
    guildId,
    requiredRoleId,
    isGuildMember: lookup.member != null,
    hasRequiredRole,
    returnedRoleIds: lookup.member?.roles ?? [],
    finalStatus: lookup.status,
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
                id: true,
                accountId: true,
                accessToken: true,
                refreshToken: true,
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
              throw new APIError("UNAUTHORIZED", {
                message: "A Discord account is required to sign in.",
              });
            }

            if (
              isDiscordBypassUser(
                options.allowedDiscordIds,
                discordAccount.accountId,
              )
            ) {
              logAuthDebug("session-create:allow-bypass", {
                userId: sessionData.userId,
                discordAccountId: discordAccount.accountId,
              });
              return;
            }

            const hasDiscordAccess = await ensureDiscordAccess({
              accountRowId: discordAccount.id,
              discordAccountId: discordAccount.accountId,
              accessToken: discordAccount.accessToken,
              refreshToken: discordAccount.refreshToken,
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
              throw new APIError("FORBIDDEN", {
                message:
                  "Your Discord account is not allowed to access this application.",
              });
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
      errorURL: "/auth/error",
      onError(error, ctx) {
        console.error("BETTER AUTH API ERROR", error, ctx);
      },
    },
  } satisfies BetterAuthOptions;

  return betterAuth(config);
}

export type Auth = ReturnType<typeof initAuth>;
export type Session = Auth["$Infer"]["Session"];
