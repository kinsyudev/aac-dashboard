import { createFileRoute } from "@tanstack/react-router";
import { and, asc, eq } from "@acme/db";
import { db } from "@acme/db/client";
import { account, appUserRole, user } from "@acme/db/schema";

import { auth } from "~/auth/server";
import { DEV_IMPERSONATION_COOKIE } from "@acme/api/authz";

function devOnly() {
  return process.env.NODE_ENV === "development";
}

function parseCookieValue(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey !== name) continue;
    return decodeURIComponent(rawValue.join("="));
  }

  return null;
}

function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

function buildImpersonationCookie(userId: string | null) {
  if (!userId) {
    return `${DEV_IMPERSONATION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }

  return `${DEV_IMPERSONATION_COOKIE}=${encodeURIComponent(userId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`;
}

async function requireRealSession(request: Request) {
  if (!devOnly()) {
    return null;
  }

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return null;
  }

  return session;
}

async function listUsers(request: Request) {
  const session = await requireRealSession(request);
  if (!session) {
    return new Response("Not found", { status: 404 });
  }

  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      image: user.image,
      role: appUserRole.role,
      discordAccountId: account.accountId,
    })
    .from(user)
    .leftJoin(appUserRole, eq(appUserRole.userId, user.id))
    .leftJoin(
      account,
      and(eq(account.userId, user.id), eq(account.providerId, "discord")),
    )
    .orderBy(asc(user.name));

  const currentImpersonatedUserId = parseCookieValue(
    request,
    DEV_IMPERSONATION_COOKIE,
  );

  return json({
    actorUserId: session.user.id,
    currentImpersonatedUserId,
    users: rows,
  });
}

async function setImpersonation(request: Request) {
  const session = await requireRealSession(request);
  if (!session) {
    return new Response("Not found", { status: 404 });
  }

  const body = (await request.json()) as { userId?: string };
  const requestedUserId = body.userId?.trim();

  if (!requestedUserId) {
    return new Response("Missing userId", { status: 400 });
  }

  const impersonatedUser = await db.query.user.findFirst({
    columns: { id: true },
    where: eq(user.id, requestedUserId),
  });

  if (!impersonatedUser) {
    return new Response("User not found", { status: 404 });
  }

  console.info("[dev][impersonation] set", {
    actorUserId: session.user.id,
    impersonatedUserId: impersonatedUser.id,
  });

  return json(
    {
      ok: true,
      impersonatedUserId: impersonatedUser.id,
    },
    {
      headers: {
        "set-cookie": buildImpersonationCookie(impersonatedUser.id),
      },
    },
  );
}

async function clearImpersonation(request: Request) {
  const session = await requireRealSession(request);
  if (!session) {
    return new Response("Not found", { status: 404 });
  }

  console.info("[dev][impersonation] clear", {
    actorUserId: session.user.id,
  });

  return json(
    { ok: true },
    {
      headers: {
        "set-cookie": buildImpersonationCookie(null),
      },
    },
  );
}

export const Route = createFileRoute("/api/dev/impersonation" as never)({
  server: {
    handlers: {
      GET: ({ request }) => listUsers(request),
      POST: ({ request }) => setImpersonation(request),
      DELETE: ({ request }) => clearImpersonation(request),
    },
  },
});
