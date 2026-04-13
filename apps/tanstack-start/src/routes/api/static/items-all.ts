import { createFileRoute } from "@tanstack/react-router";

import { auth } from "~/auth/server";
import { isAllowedUserId } from "~/lib/allowed-user.server";
import { createStaticApiResponse } from "~/lib/static-api.server";

async function handler(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!(await isAllowedUserId(session.user.id))) {
    return new Response("Forbidden", { status: 403 });
  }

  return createStaticApiResponse(request, "items-all");
}

export const Route = createFileRoute("/api/static/items-all" as never)({
  server: {
    handlers: {
      GET: ({ request }) => handler(request),
    },
  },
});
