import type { Session } from "@acme/auth";
import { authEnv } from "@acme/auth/env";
import { and, eq } from "@acme/db";
import { db } from "@acme/db/client";
import { account, appRoleEnum, appUserRole } from "@acme/db/schema";

const bypassDiscordIds = new Set(
  authEnv()
    .AUTH_ALLOWED_DISCORD_IDS.split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);

export type AppRole = (typeof appRoleEnum.enumValues)[number];

function logAuthzDebug(event: string, details: Record<string, unknown>) {
  console.info("[authz][viewer]", event, details);
}

export interface Viewer {
  session: Session | null;
  userId: string | null;
  discordAccountId: string | null;
  isAuthenticated: boolean;
  isBypass: boolean;
  role: AppRole | null;
  effectiveRole: "admin" | AppRole | null;
  canAccessMember: boolean;
  canAccessAdmin: boolean;
}

export async function getDiscordAccountForUser(userId: string) {
  return db.query.account.findFirst({
    columns: {
      accountId: true,
      accessToken: true,
      providerId: true,
      scope: true,
      userId: true,
    },
    where: and(eq(account.userId, userId), eq(account.providerId, "discord")),
  });
}

export async function ensureAppRole(
  userId: string,
  role: AppRole = "member",
) {
  await db.insert(appUserRole).values({ userId, role }).onConflictDoNothing();
}

export function getBypassDiscordIds() {
  return bypassDiscordIds;
}

export async function resolveViewer(session: Session | null): Promise<Viewer> {
  if (!session?.user) {
    logAuthzDebug("resolve:anonymous", {});
    return {
      session: null,
      userId: null,
      discordAccountId: null,
      isAuthenticated: false,
      isBypass: false,
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
  const role = roleRow?.role ?? null;
  const effectiveRole = isBypass ? "admin" : role;

  logAuthzDebug("resolve:authenticated", {
    userId,
    discordAccountId,
    isBypass,
    storedRole: role,
    effectiveRole,
    canAccessMember: effectiveRole === "member" || effectiveRole === "admin",
    canAccessAdmin: effectiveRole === "admin",
  });

  return {
    session,
    userId,
    discordAccountId,
    isAuthenticated: true,
    isBypass,
    role,
    effectiveRole,
    canAccessMember: effectiveRole === "member" || effectiveRole === "admin",
    canAccessAdmin: effectiveRole === "admin",
  };
}
