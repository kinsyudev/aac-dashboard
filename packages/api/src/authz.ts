import type { Session } from "@acme/auth";
import type { appRoleEnum } from "@acme/db/schema";
import { ensureDiscordAccess } from "@acme/auth";
import { authEnv } from "@acme/auth/env";
import { and, eq } from "@acme/db";
import { db } from "@acme/db/client";
import { account, appUserRole, user } from "@acme/db/schema";

const bypassDiscordIds = new Set(
  authEnv()
    .AUTH_ALLOWED_DISCORD_IDS.split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);

export type AppRole = (typeof appRoleEnum.enumValues)[number];
export const DEV_IMPERSONATION_COOKIE = "aac_dev_impersonate_user_id";

function logAuthzDebug(event: string, details: Record<string, unknown>) {
  console.info("[authz][viewer]", event, details);
}

function getCookieValue(headers: Headers, name: string) {
  const cookieHeader = headers.get("cookie");
  if (!cookieHeader) return null;

  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey !== name) continue;
    return decodeURIComponent(rawValue.join("="));
  }

  return null;
}

export interface Viewer {
  session: Session | null;
  actorSession: Session | null;
  userId: string | null;
  actorUserId: string | null;
  discordAccountId: string | null;
  isAuthenticated: boolean;
  isBypass: boolean;
  isImpersonating: boolean;
  role: AppRole | null;
  effectiveRole: "admin" | AppRole | null;
  canAccessMember: boolean;
  canAccessAdmin: boolean;
}

export async function getDiscordAccountForUser(userId: string) {
  return db.query.account.findFirst({
    columns: {
      id: true,
      accountId: true,
      accessToken: true,
      refreshToken: true,
      providerId: true,
      scope: true,
      userId: true,
    },
    where: and(eq(account.userId, userId), eq(account.providerId, "discord")),
  });
}

export async function ensureAppRole(userId: string, role: AppRole = "member") {
  await db.insert(appUserRole).values({ userId, role }).onConflictDoNothing();
}

export function getBypassDiscordIds() {
  return bypassDiscordIds;
}

export async function resolveSessionForRequest(
  headers: Headers,
  actorSession: Session | null,
) {
  if (process.env.NODE_ENV !== "development" || !actorSession?.user) {
    return actorSession;
  }

  const impersonatedUserId = getCookieValue(headers, DEV_IMPERSONATION_COOKIE);

  if (!impersonatedUserId || impersonatedUserId === actorSession.user.id) {
    return actorSession;
  }

  const impersonatedUser = await db.query.user.findFirst({
    where: eq(user.id, impersonatedUserId),
  });

  if (!impersonatedUser) {
    logAuthzDebug("impersonation:missing-user", {
      actorUserId: actorSession.user.id,
      impersonatedUserId,
    });
    return actorSession;
  }

  logAuthzDebug("impersonation:applied", {
    actorUserId: actorSession.user.id,
    impersonatedUserId,
  });

  return {
    ...actorSession,
    user: impersonatedUser,
  };
}

export async function resolveViewer(
  session: Session | null,
  actorSession: Session | null = session,
): Promise<Viewer> {
  if (!session?.user) {
    logAuthzDebug("resolve:anonymous", {});
    return {
      session: null,
      actorSession,
      userId: null,
      actorUserId: actorSession?.user.id ?? null,
      discordAccountId: null,
      isAuthenticated: false,
      isBypass: false,
      isImpersonating: false,
      role: null,
      effectiveRole: null,
      canAccessMember: false,
      canAccessAdmin: false,
    };
  }

  const userId = session.user.id;
  const [discordAccount, roleRow] = await Promise.all([
    getDiscordAccountForUser(userId),
    db.query.appUserRole.findFirst({
      columns: { role: true },
      where: eq(appUserRole.userId, userId),
    }),
  ]);

  const discordAccountId = discordAccount?.accountId ?? null;
  const isBypass =
    discordAccountId != null && bypassDiscordIds.has(discordAccountId);
  let role = roleRow?.role ?? null;

  if (!isBypass && role == null && discordAccount != null) {
    const hasDiscordAccess = await ensureDiscordAccess({
      accountRowId: discordAccount.id,
      discordAccountId: discordAccount.accountId,
      accessToken: discordAccount.accessToken,
      refreshToken: discordAccount.refreshToken,
      guildId: authEnv().AUTH_DISCORD_GUILD_ID,
      requiredRoleId: authEnv().AUTH_DISCORD_ROLE_ID,
    });

    logAuthzDebug("resolve:discord-fallback", {
      userId,
      discordAccountId,
      hasDiscordAccess,
    });

    if (hasDiscordAccess) {
      role = "member";
      await ensureAppRole(userId, role);
      logAuthzDebug("resolve:auto-provision-role", {
        userId,
        role,
      });
    }
  }

  const effectiveRole = isBypass ? "admin" : role;
  const actorUserId = actorSession?.user.id ?? userId;
  const isImpersonating = actorUserId !== userId;

  logAuthzDebug("resolve:authenticated", {
    userId,
    actorUserId,
    discordAccountId,
    isBypass,
    isImpersonating,
    storedRole: role,
    effectiveRole,
    canAccessMember: effectiveRole === "member" || effectiveRole === "admin",
    canAccessAdmin: effectiveRole === "admin",
  });

  return {
    session,
    actorSession,
    userId,
    actorUserId,
    discordAccountId,
    isAuthenticated: true,
    isBypass,
    isImpersonating,
    role,
    effectiveRole,
    canAccessMember: effectiveRole === "member" || effectiveRole === "admin",
    canAccessAdmin: effectiveRole === "admin",
  };
}
