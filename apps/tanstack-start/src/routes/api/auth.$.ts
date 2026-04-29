import { createFileRoute } from "@tanstack/react-router";

import { auth } from "~/auth/server";

async function handleAuthRequest(request: Request) {
  const response = await auth.handler(request);
  const url = new URL(request.url);
  const isDiscordCallback = url.pathname === "/api/auth/callback/discord";
  const isDeniedCallback = response.status === 401 || response.status === 403;

  if (!isDiscordCallback || !isDeniedCallback) {
    return response;
  }

  let error = response.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN";
  let message =
    response.status === 401
      ? "You must sign in with Discord before you can access this application."
      : "Your Discord account is not allowed to access this application.";

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = (await response
      .clone()
      .json()
      .catch(() => null)) as { code?: string; message?: string } | null;

    if (payload?.code) {
      error = payload.code;
    }

    if (payload?.message) {
      message = payload.message;
    }
  }

  const redirectUrl = new URL("/auth/error", url);
  redirectUrl.searchParams.set("error", error);
  redirectUrl.searchParams.set("message", message);

  const headers = new Headers();
  for (const [key, value] of response.headers.entries()) {
    if (key.toLowerCase() === "set-cookie") {
      headers.append(key, value);
    }
  }
  headers.set("location", redirectUrl.toString());

  return new Response(null, {
    status: 302,
    headers,
  });
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleAuthRequest(request),
      POST: ({ request }) => handleAuthRequest(request),
    },
  },
});
